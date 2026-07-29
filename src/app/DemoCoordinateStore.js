/**
 * Debug-only storage for the fixed demo-click script.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SCHEMA_VERSION = 1;
const SCRIPT_ID = 'demo-click';
const MAX_POINTS = 2;

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertEnabled() {
  if (process.env.SHINOBI_DEBUG !== '1') {
    throw createError('debug-disabled', 'demo coordinate storage requires SHINOBI_DEBUG=1');
  }
}

function safeProfileId(profileId) {
  if (typeof profileId !== 'string' || !profileId) {
    throw createError('invalid-profile-id', 'profileId must be a non-empty string');
  }
  return profileId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function getBaseDir(options) {
  if (options && typeof options.baseDir === 'string' && options.baseDir) {
    return options.baseDir;
  }
  return path.join(app.getPath('userData'), 'automation-demo', SCRIPT_ID);
}

function getFilePath(profileId, options) {
  return path.join(getBaseDir(options), safeProfileId(profileId) + '.json');
}

function emptyRecording(profileId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    scriptId: SCRIPT_ID,
    profileId: profileId,
    updatedAt: null,
    points: []
  };
}

function normalizeRecording(raw, profileId) {
  const recording = emptyRecording(profileId);
  if (
    !raw ||
    raw.schemaVersion !== SCHEMA_VERSION ||
    raw.scriptId !== SCRIPT_ID ||
    raw.profileId !== profileId ||
    !Array.isArray(raw.points)
  ) {
    return recording;
  }

  raw.points.slice(0, MAX_POINTS).forEach(function (point, index) {
    if (
      point &&
      typeof point.normalizedX === 'number' &&
      Number.isFinite(point.normalizedX) &&
      point.normalizedX >= 0 &&
      point.normalizedX < 1 &&
      typeof point.normalizedY === 'number' &&
      Number.isFinite(point.normalizedY) &&
      point.normalizedY >= 0 &&
      point.normalizedY < 1
    ) {
      recording.points.push({
        order: index + 1,
        normalizedX: point.normalizedX,
        normalizedY: point.normalizedY
      });
    }
  });
  recording.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  return recording;
}

async function load(profileId, options) {
  assertEnabled();
  const filePath = getFilePath(profileId, options);
  try {
    const raw = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    return normalizeRecording(raw, profileId);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) {
      return emptyRecording(profileId);
    }
    throw error;
  }
}

async function save(recording, options) {
  assertEnabled();
  const normalized = normalizeRecording(recording, recording && recording.profileId);
  normalized.updatedAt = new Date().toISOString();
  const filePath = getFilePath(normalized.profileId, options);
  const temporaryPath = filePath + '.tmp';
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(temporaryPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  await fs.promises.rename(temporaryPath, filePath);
  return normalized;
}

async function reset(profileId, options) {
  assertEnabled();
  return save(emptyRecording(profileId), options);
}

async function append(profileId, normalizedPoint, options) {
  assertEnabled();
  const recording = await load(profileId, options);
  if (recording.points.length >= MAX_POINTS) {
    throw createError('point-limit-reached', 'demo-click accepts at most two points');
  }
  const next = normalizeRecording(
    {
      schemaVersion: SCHEMA_VERSION,
      scriptId: SCRIPT_ID,
      profileId: profileId,
      points: recording.points.concat([
        {
          order: recording.points.length + 1,
          normalizedX: normalizedPoint && normalizedPoint.normalizedX,
          normalizedY: normalizedPoint && normalizedPoint.normalizedY
        }
      ])
    },
    profileId
  );
  if (next.points.length !== recording.points.length + 1) {
    throw createError('invalid-normalized-point', 'normalized point is invalid');
  }
  return save(next, options);
}

async function clear(profileId, options) {
  assertEnabled();
  const filePath = getFilePath(profileId, options);
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  return emptyRecording(profileId);
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  SCRIPT_ID: SCRIPT_ID,
  MAX_POINTS: MAX_POINTS,
  getFilePath: getFilePath,
  load: load,
  reset: reset,
  append: append,
  clear: clear
};
