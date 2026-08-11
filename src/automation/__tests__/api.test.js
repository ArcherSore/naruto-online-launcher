'use strict';

const { createCancellationController } = require('../cancellation');
const { createCoordinator } = require('../coordinator');
const { createAutomationBackend, mapNormalizedPoint } = require('../backend');
const { createAutomationApi, createRunBoundAction } = require('../api');

function deferred() {
  let resolve;
  const promise = new Promise(function (resolvePromise) { resolve = resolvePromise; });
  return { promise: promise, resolve: resolve };
}

function makeTarget(options) {
  const opts = options || {};
  const listeners = Object.create(null);
  const cdp = {
    isAttached: jest.fn(function () { return false; }),
    attach: jest.fn(),
    detach: jest.fn(),
    sendCommand: jest.fn(function () { return Promise.resolve(); }),
    on: jest.fn(function (event, listener) { listeners[event] = listener; }),
    removeListener: jest.fn(function (event, listener) {
      if (listeners[event] === listener) delete listeners[event];
    })
  };
  const png = Buffer.from('png');
  const image = {
    toPNG: jest.fn(function () { return png; }),
    getSize: jest.fn(function () { return { width: 200, height: 100 }; })
  };
  const webContents = {
    isDestroyed: jest.fn(function () { return false; }),
    capturePage: jest.fn(function () {
      return Promise.resolve(image);
    }),
    debugger: cdp
  };
  const window = {
    isDestroyed: jest.fn(function () { return false; }),
    isFocused: jest.fn(function () { return false; }),
    isVisible: jest.fn(function () { return false; }),
    isMinimized: jest.fn(function () { return false; }),
    getContentSize: jest.fn(function () { return [101, 51]; }),
    webContents: webContents
  };
  return {
    window: window,
    webContents: webContents,
    gameReady: opts.gameReady !== false,
    cdp: cdp,
    image: image,
    png: png,
    emitDetach: function () {
      if (listeners.detach) listeners.detach({}, 'target closed');
    }
  };
}

describe('Automation API v1 happy path', () => {
  test('maps validated normalized coordinates using execution-time content size', () => {
    expect(
      mapNormalizedPoint(
        { normalizedX: 0.5, normalizedY: 0.5 },
        { width: 101, height: 51 }
      )
    ).toEqual({ x: 50, y: 25 });
    expect(function () {
      mapNormalizedPoint({ normalizedX: 1, normalizedY: 0 }, { width: 10, height: 10 });
    }).toThrow(expect.objectContaining({ code: 'coordinates-invalid' }));
  });

  test('captures a fresh PNG and exposes only the safe window-state DTO', async () => {
    const target = makeTarget();
    const backend = createAutomationBackend({
      targetProvider: function () { return target; },
      now: function () { return 123; }
    });
    const capture = await backend.capture('p_aaaaaaaa');
    expect(capture).toEqual({
      png: Buffer.from('png'),
      imageSize: { width: 200, height: 100 },
      contentSize: { width: 101, height: 51 },
      capturedAt: 123
    });
    expect(capture.png).not.toBe(target.png);
    expect(backend.getWindowState('p_aaaaaaaa')).toEqual({
      available: true,
      gameReady: true,
      focused: false,
      visible: false,
      minimized: false,
      contentSize: { width: 101, height: 51 },
      capturedAt: 123
    });
    expect(JSON.stringify(backend.getWindowState('p_aaaaaaaa'))).not.toMatch(
      /url|title|session|partition|cookie|webContents/i
    );
  });

  test('can return the captured native image without synchronously encoding PNG', async () => {
    const target = makeTarget();
    const backend = createAutomationBackend({
      targetProvider: function () { return target; },
      now: function () { return 234; }
    });

    const capture = await backend.captureImage('p_aaaaaaaa');

    expect(capture).toEqual({
      image: target.image,
      imageSize: { width: 200, height: 100 },
      contentSize: { width: 101, height: 51 },
      capturedAt: 234
    });
    expect(target.image.toPNG).not.toHaveBeenCalled();
  });

  test('lets the developer capture provider avoid a compositor capturePage request', async () => {
    const target = makeTarget();
    const imageProvider = jest.fn(async function (resolvedTarget, profileId) {
      expect(resolvedTarget).toBe(target);
      expect(profileId).toBe('p_aaaaaaaa');
      return target.image;
    });
    const backend = createAutomationBackend({
      targetProvider: function () { return target; },
      imageProvider: imageProvider
    });

    await expect(backend.captureImage('p_aaaaaaaa')).resolves.toEqual(
      expect.objectContaining({ image: target.image })
    );
    expect(imageProvider).toHaveBeenCalledTimes(1);
    expect(target.webContents.capturePage).not.toHaveBeenCalled();
  });

  test('keeps readiness diagnostic while capture and click use an available target', async () => {
    const target = makeTarget({ gameReady: false });
    const backend = createAutomationBackend({
      targetProvider: function () { return target; },
      now: function () { return 789; }
    });

    await expect(backend.capture('p_aaaaaaaa')).resolves.toEqual(
      expect.objectContaining({
        png: Buffer.from('png'),
        contentSize: { width: 101, height: 51 }
      })
    );
    await expect(backend.click('p_aaaaaaaa', {
      normalizedX: 0.5,
      normalizedY: 0.5
    })).resolves.toEqual({ dispatchedAt: 789, contentPoint: { x: 50, y: 25 } });
    expect(backend.getWindowState('p_aaaaaaaa')).toEqual(
      expect.objectContaining({ available: true, gameReady: false })
    );
  });

  test('keeps canonical contentPoint while scaling the dispatched CDP viewport coordinate', async () => {
    const target = makeTarget();
    target.window.getContentSize.mockReturnValue([960, 540]);
    target.contentSize = { width: 1920, height: 1080 };
    const backend = createAutomationBackend({
      targetProvider: function () { return target; },
      now: function () { return 321; }
    });

    await expect(backend.click('p_aaaaaaaa', {
      normalizedX: 0.5,
      normalizedY: 0.5
    })).resolves.toEqual({ dispatchedAt: 321, contentPoint: { x: 960, y: 540 } });
    target.cdp.sendCommand.mock.calls.forEach(function (call) {
      expect({ x: call[1].x, y: call[1].y }).toEqual({ x: 480.25, y: 270.25 });
    });
    expect(backend.getWindowState('p_aaaaaaaa').contentSize).toEqual({
      width: 1920,
      height: 1080
    });
  });
  test('still rejects missing, destroyed, and invalid-size objective targets', async () => {
    await expect(createAutomationBackend({ targetProvider: function () { return null; } })
      .capture('p_aaaaaaaa')).rejects.toMatchObject({ code: 'window-unavailable' });

    const destroyed = makeTarget({ gameReady: false });
    destroyed.webContents.isDestroyed.mockReturnValue(true);
    await expect(createAutomationBackend({ targetProvider: function () { return destroyed; } })
      .click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'window-unavailable' });

    const invalidSize = makeTarget({ gameReady: false });
    invalidSize.window.getContentSize.mockReturnValue([0, 51]);
    await expect(createAutomationBackend({ targetProvider: function () { return invalidSize; } })
      .capture('p_aaaaaaaa')).rejects.toMatchObject({ code: 'window-unavailable' });

    const driftedCanonicalTarget = makeTarget({ gameReady: false });
    driftedCanonicalTarget.contentSize = null;
    await expect(createAutomationBackend({ targetProvider: function () {
      return driftedCanonicalTarget;
    } }).capture('p_aaaaaaaa')).rejects.toMatchObject({ code: 'window-unavailable' });
  });

  test('dispatches atomic CDP 1.3 move/press/release and owned detach without focus', async () => {
    const target = makeTarget();
    const backend = createAutomationBackend({
      targetProvider: function () { return target; },
      now: function () { return 456; }
    });
    const result = await backend.click('p_aaaaaaaa', {
      normalizedX: 0.5,
      normalizedY: 0.5
    });
    expect(result).toEqual({ dispatchedAt: 456, contentPoint: { x: 50, y: 25 } });
    expect(target.cdp.attach).toHaveBeenCalledWith('1.3');
    expect(target.cdp.sendCommand.mock.calls.map(function (call) { return call[1].type; })).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased'
    ]);
    expect(target.cdp.sendCommand.mock.calls[0][1]).toEqual({
      type: 'mouseMoved', x: 50, y: 25, button: 'none', buttons: 0
    });
    expect(target.cdp.detach).toHaveBeenCalledTimes(1);
    expect(target.window.focus).toBeUndefined();
    expect(target.window.show).toBeUndefined();
  });

  test('exposes exactly four frozen actions bound to the current lease', async () => {
    const target = makeTarget();
    const coordinator = createCoordinator();
    const lease = coordinator.tryAcquire('p_aaaaaaaa', 'run-1').lease;
    const controller = createCancellationController();
    const api = createAutomationApi({
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      lease: lease,
      signal: controller.signal,
      deadlineAt: Date.now() + 10000,
      coordinator: coordinator,
      profileExists: function () { return true; },
      backend: createAutomationBackend({ targetProvider: function () { return target; } })
    });
    expect(Object.keys(api).sort()).toEqual([
      'capture', 'click', 'getWindowState', 'wait'
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    await api.click({ normalizedX: 0.25, normalizedY: 0.25 });
  });

  test('fences queued actions after cancellation but lets the active atomic click clean up', async () => {
    const coordinator = createCoordinator();
    const lease = coordinator.tryAcquire('p_aaaaaaaa', 'run-1').lease;
    const controller = createCancellationController();
    let finishFirst;
    const backend = {
      click: jest.fn(function () {
        return new Promise(function (resolve) { finishFirst = resolve; });
      })
    };
    const api = createAutomationApi({
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      lease: lease,
      signal: controller.signal,
      deadlineAt: Date.now() + 10000,
      coordinator: coordinator,
      profileExists: function () { return true; },
      backend: backend
    });
    const first = api.click({ normalizedX: 0.25, normalizedY: 0.5 });
    const queued = api.click({ normalizedX: 0.75, normalizedY: 0.5 });
    await Promise.resolve();
    controller.abort('user-stop');
    finishFirst({ dispatchedAt: 1 });
    await expect(first).resolves.toEqual({ dispatchedAt: 1 });
    await expect(queued).rejects.toMatchObject({ code: 'run-cancelled' });
    expect(backend.click).toHaveBeenCalledTimes(1);
  });

  test('maps DevTools, attach, unexpected detach, dispatch, and action timeout distinctly', async () => {
    const occupied = makeTarget();
    occupied.cdp.isAttached.mockReturnValue(true);
    await expect(createAutomationBackend({ targetProvider: function () { return occupied; } })
      .click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'cdp-already-attached' });

    const attachFailed = makeTarget();
    attachFailed.cdp.attach.mockImplementation(function () { throw new Error('raw attach'); });
    await expect(createAutomationBackend({ targetProvider: function () { return attachFailed; } })
      .click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'cdp-attach-failed' });

    const detached = makeTarget();
    detached.cdp.sendCommand.mockImplementation(function () {
      return new Promise(function () { setImmediate(detached.emitDetach); });
    });
    await expect(createAutomationBackend({ targetProvider: function () { return detached; } })
      .click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'cdp-detached' });

    const dispatchFailed = makeTarget();
    dispatchFailed.cdp.sendCommand.mockRejectedValue(new Error('cookie=secret'));
    await expect(createAutomationBackend({ targetProvider: function () { return dispatchFailed; } })
      .click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'cdp-dispatch-failed' });

    const timedOut = makeTarget();
    timedOut.cdp.sendCommand.mockReturnValue(new Promise(function () {}));
    await expect(createAutomationBackend({
      targetProvider: function () { return timedOut; },
      actionTimeoutMs: 10
    }).click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'action-timeout' });
    expect(timedOut.cdp.detach).toHaveBeenCalledTimes(1);
  });

  test('reports window-unavailable when the target closes during dispatch', async () => {
    const target = makeTarget();
    let calls = 0;
    target.cdp.sendCommand.mockImplementation(function () {
      calls++;
      if (calls === 1) return Promise.resolve();
      target.webContents.isDestroyed.mockReturnValue(true);
      return Promise.reject(new Error('target closed with cookie=secret'));
    });
    await expect(createAutomationBackend({ targetProvider: function () { return target; } })
      .click('p_aaaaaaaa', { normalizedX: 0.5, normalizedY: 0.5 }))
      .rejects.toMatchObject({ code: 'window-unavailable' });
  });
});

describe('shared run-bound action gate', () => {
  test('preflights lease and cancellation before invoking a queued action', async () => {
    const coordinator = createCoordinator();
    const acquired = coordinator.tryAcquire('p_aaaaaaaa', 'run-1');
    const signal = { aborted: false, reason: null };
    const gate = createRunBoundAction({
      coordinator: coordinator,
      lease: acquired.lease,
      signal: signal,
      profileId: 'p_aaaaaaaa',
      profileExists: function () { return true; }
    });
    const blocker = deferred();
    coordinator.enqueue(acquired.lease, function () { return blocker.promise; });
    const action = jest.fn();
    const queued = gate.enqueue(action);
    signal.aborted = true;
    signal.reason = 'user-stop';
    blocker.resolve();
    await expect(queued).rejects.toMatchObject({ code: 'run-cancelled' });
    expect(action).not.toHaveBeenCalled();
  });

  test('does not add a page-stage or GAME_READY gate and preserves one-profile FIFO', async () => {
    const coordinator = createCoordinator();
    const acquired = coordinator.tryAcquire('p_aaaaaaaa', 'run-1');
    const gate = createRunBoundAction({
      coordinator: coordinator,
      lease: acquired.lease,
      signal: { aborted: false },
      profileId: 'p_aaaaaaaa',
      profileExists: function () { return true; },
      gameReady: function () { return false; }
    });
    const order = [];
    await Promise.all([
      gate.enqueue(async function () { order.push('first'); }),
      gate.enqueue(async function () { order.push('second'); })
    ]);
    expect(order).toEqual(['first', 'second']);
  });
});
