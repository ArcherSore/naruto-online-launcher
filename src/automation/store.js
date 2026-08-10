'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AutomationError } = require('./errors');

const CONFIG_LIMIT = 256 * 1024;

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
      if (!fs.existsSync(target)) return {};
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
    return deepFreeze(cloneConfig(envelope[payloadName]));
  }

  function writeEnvelope(profileId, scriptId, fileName, limit, envelope) {
    const target = filePath(profileId, scriptId, fileName);
    const encoded = JSON.stringify(envelope, null, 2);
    if (Buffer.byteLength(encoded, 'utf8') > limit) {
      throw new AutomationError('config-invalid');
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
    }
  });
}

module.exports = {
  CONFIG_LIMIT: CONFIG_LIMIT,
  createAutomationStore: createAutomationStore,
  deepFreeze: deepFreeze
};
