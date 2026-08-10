'use strict';

const { createCoordinator } = require('../coordinator');
const { createRunner } = require('../runner');
const { createVisionApi } = require('../vision/api');

function deferred() {
  let resolve;
  const promise = new Promise(function (res) { resolve = res; });
  return { promise: promise, resolve: resolve };
}

function fiveActionApi() {
  return Object.freeze({
    capture: jest.fn(),
    getWindowState: jest.fn(),
    getCoordinates: jest.fn(),
    click: jest.fn(),
    wait: jest.fn()
  });
}

function threeMethodVision() {
  return Object.freeze({
    find: jest.fn(),
    waitFor: jest.fn(),
    waitUntilGone: jest.fn()
  });
}

describe('automation runner happy path', () => {
  test('starts when the target exists even if gameReady remains false', async () => {
    const gameReady = jest.fn(function () { return false; });
    const targetAvailable = jest.fn(function () { return true; });
    const runner = createRunner({
      registry: {
        get: function () { return { manifest: { id: 'demo-click' }, run: async function () {} }; }
      },
      store: { getConfig: function () { return {}; } },
      coordinator: createCoordinator(),
      createApi: fiveActionApi,
      profileExists: function () { return true; },
      targetAvailable: targetAvailable,
      gameReady: gameReady,
      logger: { createBoundLogger: function () { return {}; } }
    });

    const accepted = runner.start('p_aaaaaaaa', 'demo-click');
    expect(accepted.ok).toBe(true);
    expect(targetAvailable).toHaveBeenCalledWith('p_aaaaaaaa');
    expect(gameReady).not.toHaveBeenCalled();
    await runner.waitForRun(accepted.status.runId);
  });

  test('rejects start when the objective target is unavailable', () => {
    const runner = createRunner({
      registry: {
        get: function () { return { manifest: { id: 'demo-click' }, run: async function () {} }; }
      },
      store: { getConfig: function () { return {}; } },
      coordinator: createCoordinator(),
      createApi: fiveActionApi,
      profileExists: function () { return true; },
      targetAvailable: function () { return false; },
      logger: { createBoundLogger: function () { return {}; } }
    });

    expect(runner.start('p_aaaaaaaa', 'demo-click')).toEqual({
      ok: false,
      error: 'window-unavailable'
    });
  });

  test('invokes a registered script through a minimal frozen run context', async () => {
    const contextSeen = deferred();
    const run = jest.fn(async function (context) { contextSeen.resolve(context); });
    const api = fiveActionApi();
    const runner = createRunner({
      registry: { get: function () { return { manifest: { id: 'demo-click' }, run: run }; } },
      store: { getConfig: function () { return { nested: { delayMs: 10 } }; } },
      coordinator: createCoordinator(),
      createApi: function () { return api; },
      createVision: function () { return threeMethodVision(); },
      profileExists: function () { return true; },
      gameReady: function () { return true; },
      logger: {
        createBoundLogger: function () {
          return Object.freeze({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
        }
      },
      now: (function () {
        let value = 100;
        return function () { return value++; };
      })(),
      timeoutMs: 10000
    });

    const accepted = runner.start('p_aaaaaaaa', 'demo-click');
    expect(accepted).toEqual({
      ok: true,
      status: expect.objectContaining({
        runId: expect.any(String),
        profileId: 'p_aaaaaaaa',
        scriptId: 'demo-click',
        status: 'running',
        startedAt: 100,
        endedAt: null,
        error: null
      })
    });
    const context = await contextSeen.promise;
    expect(Object.keys(context).sort()).toEqual([
      'automation', 'config', 'log', 'profileId', 'signal', 'vision'
    ]);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.config.nested)).toBe(true);
    expect(context.automation).toBe(api);
    expect(Object.keys(context.vision).sort()).toEqual(['find', 'waitFor', 'waitUntilGone']);
    expect(Object.isFrozen(context.vision)).toBe(true);
    await runner.waitForRun(accepted.status.runId);
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click')).toEqual(
      expect.objectContaining({ status: 'succeeded', endedAt: expect.any(Number) })
    );
  });

  test('synthesizes idle and retains the last terminal state across queries', async () => {
    const runner = createRunner({
      registry: {
        get: function () { return { manifest: { id: 'demo-click' }, run: async function () {} }; }
      },
      store: { getConfig: function () { return {}; } },
      coordinator: createCoordinator(),
      createApi: fiveActionApi,
      profileExists: function () { return true; },
      gameReady: function () { return true; },
      logger: { createBoundLogger: function () { return {}; } }
    });
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click')).toEqual({
      runId: null,
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      status: 'idle',
      startedAt: null,
      endedAt: null,
      error: null
    });
    const accepted = runner.start('p_aaaaaaaa', 'demo-click');
    await runner.waitForRun(accepted.status.runId);
    const first = runner.getStatus('p_aaaaaaaa', 'demo-click');
    const second = runner.getStatus('p_aaaaaaaa', 'demo-click');
    expect(first.status).toBe('succeeded');
    expect(second).toEqual(first);
    expect(Object.isFrozen(second)).toBe(true);
  });
});

describe('automation runner cancellation, deadline, and isolation', () => {
  function runnerFor(run, options) {
    const opts = options || {};
    return createRunner({
      registry: { get: function () { return { manifest: { id: 'demo-click' }, run: run }; } },
      store: { getConfig: function () { return {}; } },
      coordinator: createCoordinator(),
      createApi: function () { return fiveActionApi(); },
      profileExists: function () { return true; },
      gameReady: function () { return true; },
      logger: { createBoundLogger: function () { return {}; } },
      timeoutMs: opts.timeoutMs || 10000
    });
  }

  test('shows stopping immediately, makes stop idempotent, and rejects a stale terminal runId', async () => {
    const gates = [];
    const runner = runnerFor(function () {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    });
    const first = runner.start('p_aaaaaaaa', 'demo-click');
    await Promise.resolve();
    const firstStop = runner.stop('p_aaaaaaaa', first.status.runId);
    const repeatedStop = runner.stop('p_aaaaaaaa', first.status.runId);
    expect(firstStop.status.status).toBe('stopping');
    expect(repeatedStop.status.status).toBe('stopping');
    await runner.waitForRun(first.status.runId);
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click')).toEqual(
      expect.objectContaining({ status: 'cancelled', error: expect.objectContaining({ code: 'run-cancelled' }) })
    );
    gates[0].resolve();

    const second = runner.start('p_aaaaaaaa', 'demo-click');
    await Promise.resolve();
    expect(runner.stop('p_aaaaaaaa', first.status.runId)).toEqual({
      ok: false,
      error: 'run-not-active'
    });
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click').runId).toBe(second.status.runId);
    runner.stop('p_aaaaaaaa', second.status.runId);
    await runner.waitForRun(second.status.runId);
    gates[1].resolve();
  });

  test('turns a cooperative deadline into failed/run-timeout and preserves the first reason', async () => {
    let seenSignal;
    const runner = runnerFor(function (context) {
      seenSignal = context.signal;
      return new Promise(function (resolve) {
        context.signal.addEventListener('abort', resolve, { once: true });
      });
    }, { timeoutMs: 20 });
    const started = runner.start('p_aaaaaaaa', 'demo-click');
    await runner.waitForRun(started.status.runId);
    expect(seenSignal.reason).toBe('timeout');
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click')).toEqual(
      expect.objectContaining({
        status: 'failed',
        endedAt: expect.any(Number),
        error: expect.objectContaining({ code: 'run-timeout' })
      })
    );
    expect(runner.stop('p_aaaaaaaa', started.status.runId).status.status).toBe('failed');
  });

  test('distinguishes window closure and script rejection without leaking raw errors', async () => {
    let release;
    const closingRunner = runnerFor(function () {
      return new Promise(function (resolve) { release = resolve; });
    });
    const closing = closingRunner.start('p_aaaaaaaa', 'demo-click');
    expect(closingRunner.cancelProfile('p_aaaaaaaa', 'window-closed')).toBe(true);
    await closingRunner.waitForRun(closing.status.runId);
    release();
    expect(closingRunner.getStatus('p_aaaaaaaa', 'demo-click')).toEqual(
      expect.objectContaining({ status: 'failed', error: expect.objectContaining({ code: 'window-unavailable' }) })
    );

    const rejectedRunner = runnerFor(async function () {
      throw new Error('cookie=secret');
    });
    const rejected = rejectedRunner.start('p_bbbbbbbb', 'demo-click');
    await rejectedRunner.waitForRun(rejected.status.runId);
    const status = rejectedRunner.getStatus('p_bbbbbbbb', 'demo-click');
    expect(status.error.code).toBe('script-failed');
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  test('runs different profiles concurrently and keeps their terminal states independent', async () => {
    const gates = Object.create(null);
    const runner = runnerFor(function (context) {
      gates[context.profileId] = deferred();
      return gates[context.profileId].promise;
    });
    const first = runner.start('p_aaaaaaaa', 'demo-click');
    const second = runner.start('p_bbbbbbbb', 'demo-click');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(runner.listStatuses().map(function (status) { return status.status; })).toEqual([
      'running', 'running'
    ]);
    await Promise.resolve();
    gates.p_aaaaaaaa.resolve();
    await runner.waitForRun(first.status.runId);
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click').status).toBe('succeeded');
    expect(runner.getStatus('p_bbbbbbbb', 'demo-click').status).toBe('running');
    gates.p_bbbbbbbb.resolve();
    await runner.waitForRun(second.status.runId);
    expect(runner.getStatus('p_bbbbbbbb', 'demo-click').status).toBe('succeeded');
  });

  test('drops an in-flight Vision capture after cancellation without decode or match', async () => {
    const captureGate = deferred();
    const coordinator = createCoordinator();
    const codec = { decodeCapture: jest.fn() };
    const matcher = { match: jest.fn() };
    const runner = createRunner({
      registry: { get: function () { return { manifest: { id: 'demo-click' }, run: function (context) { return context.vision.waitFor('target'); } }; } },
      store: { getConfig: function () { return {}; } },
      coordinator: coordinator,
      createApi: function () { return fiveActionApi(); },
      createVision: function (runOptions) {
        return createVisionApi(Object.assign({}, runOptions, {
          backend: { capture: function () { return captureGate.promise; } },
          loader: { load: function () { return { width: 1, height: 1, bitmap: Buffer.alloc(4) }; } },
          codec: codec,
          matcher: matcher,
          profileExists: function () { return true; }
        }));
      },
      profileExists: function () { return true; },
      targetAvailable: function () { return true; },
      logger: { createBoundLogger: function () { return {}; } }
    });
    const started = runner.start('p_aaaaaaaa', 'demo-click');
    await new Promise(function (resolve) { setImmediate(resolve); });
    runner.stop('p_aaaaaaaa', started.status.runId);
    captureGate.resolve({
      png: Buffer.from('png'), imageSize: { width: 1, height: 1 },
      contentSize: { width: 1, height: 1 }, capturedAt: 1
    });
    await runner.waitForRun(started.status.runId);
    expect(runner.getStatus('p_aaaaaaaa', 'demo-click')).toEqual(expect.objectContaining({
      status: 'cancelled', error: expect.objectContaining({ code: 'run-cancelled' })
    }));
    expect(codec.decodeCapture).not.toHaveBeenCalled();
    expect(matcher.match).not.toHaveBeenCalled();
  });
});
