'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AutomationError } = require('./errors');

const CONFIG_LIMIT = 256 * 1024;
const COORDINATES_LIMIT = 64 * 1024;
const MAX_POINTS = 100;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite-number');
    return value;
  }
  if (typeof value !== 'object' || Buffer.isBuffer(value)) throw new Error('non-json-value');
  if (seen.has(value)) throw new Error('circular-value');
  seen.add(value);
  let cloned;
  if (Array.isArray(value)) {
    cloned = value.map(function (item) {
      return cloneJsonValue(item, seen);
    });
  } else {
    if (!isPlainObject(value)) throw new Error('non-plain-object');
    cloned = {};
    Object.keys(value).forEach(function (key) {
      cloned[key] = cloneJsonValue(value[key], seen);
    });
  }
  seen.delete(value);
  return cloned;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) {
    deepFreeze(value[key]);
  });
  return Object.freeze(value);
}

function cloneConfig(value) {
  if (!isPlainObject(value)) throw new AutomationError('config-invalid');
  try {
    return cloneJsonValue(value, new Set());
  } catch (_) {
    throw new AutomationError('config-invalid');
  }
}

function cloneCoordinates(points) {
  if (!Array.isArray(points) || points.length > MAX_POINTS) {
    throw new AutomationError('coordinates-invalid');
  }
  return points.map(function (point, index) {
    if (
      !isPlainObject(point) ||
      Object.keys(point).some(function (key) {
        return ['order', 'normalizedX', 'normalizedY'].indexOf(key) === -1;
      }) ||
      point.order !== index + 1 ||
      !Number.isFinite(point.normalizedX) ||
      !Number.isFinite(point.normalizedY) ||
      point.normalizedX < 0 ||
      point.normalizedX >= 1 ||
      point.normalizedY < 0 ||
      point.normalizedY >= 1
    ) {
      throw new AutomationError('coordinates-invalid');
    }
    return {
      order: point.order,
      normalizedX: point.normalizedX,
      normalizedY: point.normalizedY
    };
  });
}

function createAutomationStore(options) {
  const opts = options || {};
  if (typeof opts.rootDir !== 'string' || !path.isAbsolute(opts.rootDir)) {
    throw new TypeError('rootDir must be absolute');
  }
  const profileExists = opts.profileExists;
  const scriptExists = opts.scriptExists;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;

  function validateIdentity(profileId, scriptId) {
    if (
      typeof profileId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(profileId) ||
      typeof profileExists !== 'function' ||
      !profileExists(profileId)
    ) {
      throw new AutomationError('profile-not-found');
    }
    if (
      typeof scriptId !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scriptId) ||
      typeof scriptExists !== 'function' ||
      !scriptExists(scriptId)
    ) {
      throw new AutomationError('script-not-found');
    }
  }

  function filePath(profileId, scriptId, fileName) {
    validateIdentity(profileId, scriptId);
    return path.join(opts.rootDir, 'profiles', profileId, 'scripts', scriptId, fileName);
  }

  function readEnvelope(profileId, scriptId, fileName, limit, invalidCode, payloadName) {
    const target = filePath(profileId, scriptId, fileName);
    let raw;
    try {
      if (!fs.existsSync(target)) return payloadName === 'config' ? {} : [];
      const stats = fs.statSync(target);
      if (!stats.isFile() || stats.size > limit) throw new AutomationError(invalidCode);
      raw = fs.readFileSync(target, 'utf8');
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('storage-read-failed');
    }
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (_) {
      throw new AutomationError(invalidCode);
    }
    if (
      !isPlainObject(envelope) ||
      envelope.schemaVersion !== 1 ||
      envelope.profileId !== profileId ||
      envelope.scriptId !== scriptId ||
      typeof envelope.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(envelope.updatedAt))
    ) {
      throw new AutomationError(invalidCode);
    }
    const cloned =
      payloadName === 'config'
        ? cloneConfig(envelope.config)
        : cloneCoordinates(envelope.points);
    return deepFreeze(cloned);
  }

  function writeEnvelope(profileId, scriptId, fileName, limit, envelope) {
    const target = filePath(profileId, scriptId, fileName);
    const encoded = JSON.stringify(envelope, null, 2);
    if (Buffer.byteLength(encoded, 'utf8') > limit) {
      throw new AutomationError(fileName === 'config.json' ? 'config-invalid' : 'coordinates-invalid');
    }
    const directory = path.dirname(target);
    const temp = path.join(
      directory,
      '.' + fileName + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'
    );
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temp, encoded, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temp, target);
    } catch (_) {
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      } catch (_) {
        // The original file remains the authoritative value.
      }
      throw new AutomationError('storage-write-failed');
    }
  }

  function getConfig(profileId, scriptId) {
    return deepFreeze(
      readEnvelope(profileId, scriptId, 'config.json', CONFIG_LIMIT, 'config-invalid', 'config')
    );
  }

  function setConfig(profileId, scriptId, config) {
    const cloned = cloneConfig(config);
    writeEnvelope(profileId, scriptId, 'config.json', CONFIG_LIMIT, {
      schemaVersion: 1,
      profileId: profileId,
      scriptId: scriptId,
      updatedAt: new Date(now()).toISOString(),
      config: cloned
    });
    return deepFreeze(cloned);
  }

  function getCoordinates(profileId, scriptId) {
    return deepFreeze(
      readEnvelope(
        profileId,
        scriptId,
        'coordinates.json',
        COORDINATES_LIMIT,
        'coordinates-invalid',
        'points'
      )
    );
  }

  function setCoordinates(profileId, scriptId, points) {
    const cloned = cloneCoordinates(points);
    writeEnvelope(profileId, scriptId, 'coordinates.json', COORDINATES_LIMIT, {
      schemaVersion: 1,
      profileId: profileId,
      scriptId: scriptId,
      updatedAt: new Date(now()).toISOString(),
      points: cloned
    });
    return deepFreeze(cloned);
  }

  function clearFile(profileId, scriptId, fileName) {
    const target = filePath(profileId, scriptId, fileName);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (_) {
      throw new AutomationError('storage-write-failed');
    }
  }

  return Object.freeze({
    getConfig: getConfig,
    setConfig: setConfig,
    clearConfig: function (profileId, scriptId) {
      clearFile(profileId, scriptId, 'config.json');
      return deepFreeze({});
    },
    getCoordinates: getCoordinates,
    setCoordinates: setCoordinates,
    clearCoordinates: function (profileId, scriptId) {
      clearFile(profileId, scriptId, 'coordinates.json');
      return deepFreeze([]);
    }
  });
}

module.exports = {
  CONFIG_LIMIT: CONFIG_LIMIT,
  COORDINATES_LIMIT: COORDINATES_LIMIT,
  MAX_POINTS: MAX_POINTS,
  createAutomationStore: createAutomationStore,
  deepFreeze: deepFreeze
};
