'use strict';

const helpers = require('./helpers');

function frame(profileId, epoch, id) {
  return {
    frame: {
      frameId: id,
      profile: { id: profileId, name: profileId },
      selectionEpoch: epoch,
      pngDataUrl: 'data:image/png;base64,cG5n',
      imageSize: { width: 1920, height: 1080 },
      contentSize: { width: 1920, height: 1080 },
      capturedAt: Date.now(),
      contract: { valid: true, failures: [] }
    }
  };
}

describe('LiveController fixed schedule and Freeze', () => {
  beforeEach(function () { jest.useFakeTimers(); });
  afterEach(function () { jest.useRealTimers(); });

  test('starts at t0, ticks every 1000ms, skips busy ticks and never catches up', async () => {
    const pending = helpers.deferred();
    const starts = [];
    const bridge = {
      capture: jest.fn(function (request) {
        starts.push(Date.now());
        return bridge.capture.mock.calls.length === 1
          ? pending.promise
          : Promise.resolve(frame(request.profileId, request.selectionEpoch, 'frame-2'));
      }),
      markDisplayed: jest.fn(async function (request) { return { displayedFrameId: request.frameId }; }),
      freezeFrame: jest.fn(async function (request) { return { frame: { frameId: request.frameId } }; }),
      releaseFrame: jest.fn(async function () { return { released: true }; })
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });

    controller.selectProfile('p_aaaaaaaa');
    expect(bridge.capture).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3000);
    expect(bridge.capture).toHaveBeenCalledTimes(1);
    expect(controller.getState().skippedTickCount).toBe(3);

    pending.resolve(frame('p_aaaaaaaa', 1, 'frame-1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.capture).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(999);
    expect(bridge.capture).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(bridge.capture).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBe(4000);
  });

  test('Freeze stops all future ticks and pins the acknowledged displayed frame without capture', async () => {
    const bridge = {
      capture: jest.fn(function (request) {
        return Promise.resolve(frame(request.profileId, request.selectionEpoch, 'displayed'));
      }),
      markDisplayed: jest.fn(async function (request) { return { displayedFrameId: request.frameId }; }),
      freezeFrame: jest.fn(async function (request) { return { frame: { frameId: request.frameId } }; }),
      releaseFrame: jest.fn(async function () { return { released: true }; })
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().displayedFrameId).toBe('displayed');

    await controller.freeze();
    expect(controller.getState().mode).toBe('FROZEN');
    expect(bridge.freezeFrame).toHaveBeenCalledWith({
      frameId: 'displayed',
      profileId: 'p_aaaaaaaa',
      selectionEpoch: 1
    });
    const captureCount = bridge.capture.mock.calls.length;
    jest.advanceTimersByTime(30000);
    expect(bridge.capture).toHaveBeenCalledTimes(captureCount);
  });

  test('Resume releases save binding, preserves reference values and starts a new t0 epoch', async () => {
    const bridge = {
      capture: jest.fn(function (request) { return Promise.resolve(frame(request.profileId, request.selectionEpoch, 'frame-' + request.selectionEpoch)); }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(async request => ({ frame: { frameId: request.frameId } })),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    await Promise.resolve();
    controller.setDraftReference({ template: { x: 1, y: 2, width: 3, height: 4 } });
    await controller.freeze();
    await controller.resume();
    expect(bridge.releaseFrame).toHaveBeenCalledWith({ frameId: 'frame-1' });
    expect(controller.getState()).toEqual(expect.objectContaining({
      mode: 'LIVE',
      selectionEpoch: 2,
      displayedFrameId: null,
      referenceOnly: true
    }));
    expect(controller.getState().draft.template).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(bridge.capture).toHaveBeenCalledTimes(2);
  });

  test('maps forward/reverse drags to exact screenshot pixels with floor/ceil boundaries', () => {
    const { mapDragToRect } = require('../app/app');
    const box = { left: 100, top: 50, width: 960, height: 540 };
    const imageSize = { width: 1920, height: 1080 };
    const forward = mapDragToRect(
      { x: 110.2, y: 60.2 },
      { x: 120.1, y: 70.1 },
      box,
      imageSize
    );
    const reverse = mapDragToRect(
      { x: 120.1, y: 70.1 },
      { x: 110.2, y: 60.2 },
      box,
      imageSize
    );
    expect(forward).toEqual({ x: 20, y: 20, width: 21, height: 21 });
    expect(reverse).toEqual(forward);
  });

  test('computes rendered content box and rejects letterbox, zero-area and out-of-range selections', () => {
    const { fitImageBox, mapDragToRect } = require('../app/app');
    const imageSize = { width: 1920, height: 1080 };
    const box = fitImageBox({ left: 0, top: 0, width: 1000, height: 1000 }, imageSize);
    expect(box).toEqual({ left: 0, top: 218.75, width: 1000, height: 562.5 });
    expect(mapDragToRect({ x: 10, y: 100 }, { x: 20, y: 200 }, box, imageSize)).toBe(null);
    expect(mapDragToRect({ x: 10, y: 300 }, { x: 10, y: 300 }, box, imageSize)).toBe(null);
    expect(mapDragToRect({ x: -1, y: 300 }, { x: 20, y: 400 }, box, imageSize)).toBe(null);
    expect(mapDragToRect({ x: 0, y: 218.75 }, { x: 1000, y: 781.25 }, box, imageSize)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    });
  });

  test('keeps Template and ROI independent and binds both to the current frozen frame', async () => {
    const bridge = {
      capture: jest.fn(function (request) { return Promise.resolve(frame(request.profileId, request.selectionEpoch, 'frozen')); }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(async request => ({ frame: { frameId: request.frameId } })),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    await Promise.resolve();
    await controller.freeze();
    controller.setSelection('template', { x: 1, y: 2, width: 30, height: 40 });
    controller.setSelection('roi', { x: 100, y: 200, width: 300, height: 400 });
    const before = controller.getState().draft;
    controller.setSelection('template', { x: 5, y: 6, width: 7, height: 8 });
    const after = controller.getState().draft;
    expect(after.roi).toEqual(before.roi);
    expect(after.template).toEqual(expect.objectContaining({
      x: 5,
      y: 6,
      width: 7,
      height: 8,
      frozenFrameId: 'frozen',
      referenceOnly: false
    }));
    expect(after.roi.frozenFrameId).toBe('frozen');
  });
});
