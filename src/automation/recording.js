'use strict';

const crypto = require('crypto');
const { AutomationError } = require('./errors');
const { mapImagePointToNormalized } = require('./coordinates');
const { deepFreeze } = require('./store');

function validSize(size) {
  return !!(
    size &&
    Number.isInteger(size.width) &&
    size.width > 0 &&
    Number.isInteger(size.height) &&
    size.height > 0
  );
}

function createRecordingService(options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const ttlMs = Number.isInteger(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : 300000;
  const records = new Map();

  function key(profileId, scriptId) {
    return profileId + '\u0000' + scriptId;
  }

  function requireRecord(request) {
    const recordKey = key(request.profileId, request.scriptId);
    const record = records.get(recordKey);
    if (
      !record ||
      record.captureId !== request.captureId ||
      record.ownerId !== request.ownerId ||
      now() >= record.expiresAt
    ) {
      if (record && now() >= record.expiresAt) records.delete(recordKey);
      throw new AutomationError('capture-expired');
    }
    return record;
  }

  async function begin(profileId, scriptId, ownerId) {
    if (typeof ownerId !== 'string' || !ownerId) throw new AutomationError('capture-failed');
    const captured = await opts.backend.capture(profileId);
    if (
      !captured ||
      !Buffer.isBuffer(captured.png) ||
      !validSize(captured.imageSize) ||
      !validSize(captured.contentSize)
    ) {
      throw new AutomationError('capture-failed');
    }
    const createdAt = now();
    const record = {
      captureId: crypto.randomBytes(16).toString('hex'),
      profileId: profileId,
      scriptId: scriptId,
      ownerId: ownerId,
      pngDataUrl: 'data:image/png;base64,' + captured.png.toString('base64'),
      imageSize: { width: captured.imageSize.width, height: captured.imageSize.height },
      contentSize: { width: captured.contentSize.width, height: captured.contentSize.height },
      createdAt: createdAt,
      expiresAt: createdAt + ttlMs
    };
    records.set(key(profileId, scriptId), record);
    return deepFreeze({
      capture: {
        captureId: record.captureId,
        pngDataUrl: record.pngDataUrl,
        imageSize: record.imageSize,
        contentSize: record.contentSize,
        expiresAt: record.expiresAt
      },
      points: opts.store.getCoordinates(profileId, scriptId)
    });
  }

  function addPoint(request) {
    const record = requireRecord(request || {});
    if (
      !Number.isFinite(request.imageX) ||
      !Number.isFinite(request.imageY) ||
      request.imageX < 0 ||
      request.imageX >= record.imageSize.width ||
      request.imageY < 0 ||
      request.imageY >= record.imageSize.height
    ) {
      throw new AutomationError('coordinates-invalid');
    }
    const points = opts.store.getCoordinates(request.profileId, request.scriptId).slice();
    const normalized = mapImagePointToNormalized(
      { x: request.imageX, y: request.imageY },
      record.imageSize,
      record.contentSize
    );
    const point = {
      order: points.length + 1,
      normalizedX: normalized.normalizedX,
      normalizedY: normalized.normalizedY
    };
    points.push(point);
    return deepFreeze({
      point: point,
      points: opts.store.setCoordinates(request.profileId, request.scriptId, points)
    });
  }

  function clearProfile(profileId) {
    let count = 0;
    Array.from(records.keys()).forEach(function (recordKey) {
      if (recordKey.indexOf(profileId + '\u0000') === 0 && records.delete(recordKey)) count++;
    });
    return count;
  }

  function clearOwner(ownerId) {
    let count = 0;
    records.forEach(function (record, recordKey) {
      if (record.ownerId === ownerId && records.delete(recordKey)) count++;
    });
    return count;
  }

  return Object.freeze({
    begin: begin,
    addPoint: addPoint,
    getCoordinates: function (profileId, scriptId) {
      return opts.store.getCoordinates(profileId, scriptId);
    },
    clearCoordinates: function (profileId, scriptId) {
      records.delete(key(profileId, scriptId));
      return opts.store.clearCoordinates(profileId, scriptId);
    },
    clearProfile: clearProfile,
    clearOwner: clearOwner,
    clearAll: function () {
      const count = records.size;
      records.clear();
      return count;
    }
  });
}

module.exports = { createRecordingService: createRecordingService };
