'use strict';

const { createCancellationController } = require('../cancellation');
const { createCoordinator } = require('../coordinator');
const { createVisionApi } = require('../vision/api');

function makeVision(overrides) {
  const opts = overrides || {};
  const coordinator = opts.coordinator || createCoordinator();
  const acquired = opts.acquired || coordinator.tryAcquire('p_aaaaaaaa', 'run-1');
  const controller = opts.controller || createCancellationController();
  const backend = opts.backend || {
    capture: jest.fn(async function () {
      return Object.freeze({
        png: Buffer.from('png'),
        imageSize: Object.freeze({ width: 4, height: 4 }),
        contentSize: Object.freeze({ width: 4, height: 4 }),
        capturedAt: 1
      });
    })
  };
  const decoded = {
    bitmap: Buffer.alloc(64),
    imageSize: { width: 4, height: 4 },
    contentSize: { width: 4, height: 4 },
    capturedAt: 1
  };
  const matcher = opts.matcher || {
    match: jest.fn(async function () {
      return { rect: { x: 1, y: 1, width: 2, height: 2 }, confidence: 1 };
    })
  };
  const api = createVisionApi({
    profileId: 'p_aaaaaaaa',
    scriptId: 'script-a',
    lease: acquired.lease,
    signal: controller.signal,
    deadlineAt: opts.deadlineAt || Date.now() + 10000,
    coordinator: coordinator,
    profileExists: function () { return true; },
    backend: backend,
    loader: opts.loader || {
      load: jest.fn(function () {
        return Object.freeze({
          identity: Object.freeze({ scriptId: 'script-a', templateId: 'target' }),
          width: 2,
          height: 2,
          bitmap: Buffer.alloc(16)
        });
      })
    },
    codec: opts.codec || { decodeCapture: jest.fn(function () { return decoded; }) },
    matcher: matcher,
    now: opts.now || Date.now,
    setTimeout: opts.setTimeout,
    clearTimeout: opts.clearTimeout
  });
  return { api: api, backend: backend, controller: controller, matcher: matcher };
}

describe('Vision API find contract', () => {
  test('exposes exactly three frozen methods and returns a deeply frozen click-compatible result', async () => {
    const runtime = makeVision();
    expect(Object.keys(runtime.api).sort()).toEqual(['find', 'waitFor', 'waitUntilGone']);
    expect(Object.isFrozen(runtime.api)).toBe(true);
    const result = await runtime.api.find('target', { threshold: 1, roi: { x: 0, y: 0, width: 4, height: 4 } });
    expect(result).toEqual({
      rect: { x: 1, y: 1, width: 2, height: 2 },
      center: { normalizedX: 0.625, normalizedY: 0.625 },
      confidence: 1
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rect)).toBe(true);
    expect(Object.isFrozen(result.center)).toBe(true);
  });

  test('captures freshly for every find and returns null only for a valid no-match', async () => {
    const runtime = makeVision({ matcher: { match: jest.fn(async function () { return null; }) } });
    await expect(runtime.api.find('target')).resolves.toBeNull();
    await expect(runtime.api.find('target')).resolves.toBeNull();
    expect(runtime.backend.capture).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['', {}, 'vision-template-id-invalid'],
    ['target', null, 'vision-input-invalid'],
    ['target', { unknown: true }, 'vision-input-invalid'],
    ['target', { threshold: NaN }, 'vision-input-invalid'],
    ['target', { threshold: 2 }, 'vision-input-invalid'],
    ['target', { timeoutMs: 10 }, 'vision-input-invalid']
  ])('strictly rejects template/options before capture', async (templateId, options, code) => {
    const runtime = makeVision();
    await expect(runtime.api.find(templateId, options)).rejects.toMatchObject({ code: code });
    expect(runtime.backend.capture).not.toHaveBeenCalled();
  });

  test('validates ROI against the same captured image and never disguises capture errors as no-match', async () => {
    const runtime = makeVision();
    await expect(runtime.api.find('target', { roi: { x: 3, y: 3, width: 2, height: 2 } }))
      .rejects.toMatchObject({ code: 'vision-input-invalid' });
    expect(runtime.matcher.match).not.toHaveBeenCalled();

    const failed = makeVision({
      backend: { capture: jest.fn(async function () { throw new Error('raw capture'); }) }
    });
    await expect(failed.api.find('target')).rejects.toMatchObject({ code: 'capture-failed' });
  });
});

module.exports = { makeVision: makeVision };

describe('Vision API finite waits', () => {
  test('waitFor checks immediately, polls without overlap and returns the first match', async () => {
    const matcher = {
      match: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ rect: { x: 1, y: 1, width: 2, height: 2 }, confidence: 1 })
    };
    const runtime = makeVision({ matcher: matcher, deadlineAt: Date.now() + 2000 });
    const pending = runtime.api.waitFor('target', { timeoutMs: 500, pollIntervalMs: 50 });
    await new Promise(function (resolve) { setImmediate(resolve); });
    expect(runtime.backend.capture).toHaveBeenCalledTimes(1);
    const result = await pending;
    expect(result.rect).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(runtime.backend.capture).toHaveBeenCalledTimes(2);
  });

  test('waitUntilGone returns true only after a valid no-match and errors are not gone', async () => {
    const matcher = {
      match: jest.fn()
        .mockResolvedValueOnce({ rect: { x: 1, y: 1, width: 2, height: 2 }, confidence: 1 })
        .mockResolvedValueOnce(null)
    };
    const runtime = makeVision({ matcher: matcher, deadlineAt: Date.now() + 2000 });
    await expect(runtime.api.waitUntilGone('target', { timeoutMs: 500, pollIntervalMs: 50 }))
      .resolves.toBe(true);
    expect(runtime.backend.capture).toHaveBeenCalledTimes(2);

    const failed = makeVision({
      backend: { capture: jest.fn(async function () { throw new Error('capture failed'); }) }
    });
    await expect(failed.api.waitUntilGone('target', { timeoutMs: 200, pollIntervalMs: 50 }))
      .rejects.toMatchObject({ code: 'capture-failed' });
  });

  test('does not overlap a slow capture and stops capture after terminal', async () => {
    let resolveFirst;
    const validFrame = {
      png: Buffer.from('png'), imageSize: { width: 4, height: 4 },
      contentSize: { width: 4, height: 4 }, capturedAt: 1
    };
    const backend = {
      capture: jest.fn()
        .mockImplementationOnce(function () {
          return new Promise(function (resolve) { resolveFirst = resolve; });
        })
        .mockResolvedValue(validFrame)
    };
    const matcher = {
      match: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ rect: { x: 1, y: 1, width: 2, height: 2 }, confidence: 1 })
    };
    const runtime = makeVision({ backend: backend, matcher: matcher, deadlineAt: Date.now() + 2000 });
    const pending = runtime.api.waitFor('target', { timeoutMs: 500, pollIntervalMs: 50 });
    await new Promise(function (resolve) { setTimeout(resolve, 70); });
    expect(backend.capture).toHaveBeenCalledTimes(1);
    resolveFirst(validFrame);
    await pending;
    expect(backend.capture).toHaveBeenCalledTimes(2);
    await new Promise(function (resolve) { setTimeout(resolve, 70); });
    expect(backend.capture).toHaveBeenCalledTimes(2);
  });

  test('throws vision-timeout while the run is active and does not start a later round', async () => {
    const runtime = makeVision({
      matcher: { match: jest.fn(async function () { return null; }) },
      deadlineAt: Date.now() + 2000
    });
    await expect(runtime.api.waitFor('target', { timeoutMs: 60, pollIntervalMs: 50 }))
      .rejects.toMatchObject({ code: 'vision-timeout' });
    const captures = runtime.backend.capture.mock.calls.length;
    await new Promise(function (resolve) { setTimeout(resolve, 70); });
    expect(runtime.backend.capture).toHaveBeenCalledTimes(captures);
    expect(captures).toBeLessThanOrEqual(2);
  });

  test.each([
    [{ timeoutMs: 0 }, 'vision-input-invalid'],
    [{ timeoutMs: 60001 }, 'vision-input-invalid'],
    [{ pollIntervalMs: 49 }, 'vision-input-invalid'],
    [{ timeoutMs: 100, pollIntervalMs: 101 }, 'vision-input-invalid'],
    [{ timeoutMs: 1.5 }, 'vision-input-invalid']
  ])('rejects invalid wait timing before capture', async (options, code) => {
    const runtime = makeVision();
    await expect(runtime.api.waitFor('target', options)).rejects.toMatchObject({ code: code });
    expect(runtime.backend.capture).not.toHaveBeenCalled();
  });

  test.each([
    ['user-stop', 'run-cancelled'],
    ['timeout', 'run-timeout']
  ])('run signal %s wins over local timeout and stops polling', async (reason, code) => {
    const runtime = makeVision({
      matcher: { match: jest.fn(async function () { return null; }) },
      deadlineAt: Date.now() + 2000
    });
    const pending = runtime.api.waitFor('target', { timeoutMs: 500, pollIntervalMs: 50 });
    await new Promise(function (resolve) { setImmediate(resolve); });
    runtime.controller.abort(reason);
    await expect(pending).rejects.toMatchObject({ code: code });
    const captures = runtime.backend.capture.mock.calls.length;
    await new Promise(function (resolve) { setTimeout(resolve, 70); });
    expect(runtime.backend.capture).toHaveBeenCalledTimes(captures);
  });
});
