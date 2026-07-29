/**
 * Fixed built-in demo script.
 *
 * It only knows the restricted API passed by Launcher. It cannot access a
 * BrowserWindow, webContents, or arbitrary CDP commands.
 */

'use strict';

const manifest = require('./manifest.json');

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertApi(api) {
  ['loadCoordinates', 'getContentSize', 'clickContent', 'sleep', 'now'].forEach(function (name) {
    if (!api || typeof api[name] !== 'function') {
      throw createError('invalid-demo-api', 'missing restricted demo API: ' + name);
    }
  });
}

function validatePoints(recording) {
  const points = recording && Array.isArray(recording.points) ? recording.points : [];
  if (points.length < 1 || points.length > manifest.maxPoints) {
    throw createError('recording-empty', 'record one or two points before Run');
  }
  return points;
}

async function run(api) {
  assertApi(api);
  const recording = await api.loadCoordinates();
  const points = validatePoints(recording);
  const startedAt = api.now();
  const clicks = [];

  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      const remainingMs = startedAt + index * manifest.intervalMs - api.now();
      if (remainingMs > 0) await api.sleep(remainingMs);
    }

    const contentSize = await api.getContentSize();
    const point = points[index];
    const inputPoint = {
      x: Math.min(contentSize.width - 1, Math.floor(point.normalizedX * contentSize.width)),
      y: Math.min(contentSize.height - 1, Math.floor(point.normalizedY * contentSize.height))
    };
    const result = await api.clickContent(inputPoint.x, inputPoint.y);
    clicks.push({
      order: index + 1,
      normalizedX: point.normalizedX,
      normalizedY: point.normalizedY,
      contentSize: contentSize,
      inputPoint: inputPoint,
      dispatchedAt: result.dispatchedAt,
      evidence: result.evidence
    });
  }

  return {
    scriptId: manifest.id,
    intervalMs: manifest.intervalMs,
    startedAt: startedAt,
    completedAt: api.now(),
    pointCount: points.length,
    clicks: clicks
  };
}

module.exports = {
  manifest: manifest,
  run: run
};
