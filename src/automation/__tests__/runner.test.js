'use strict';

const { createCoordinator } = require('../coordinator');
const { createRunner } = require('../runner');

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
      'automation', 'config', 'log', 'profileId', 'signal'
    ]);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.config.nested)).toBe(true);
    expect(context.automation).toBe(api);
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
});
