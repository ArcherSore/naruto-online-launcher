'use strict';

const helpers = require('./helpers');

function result(profileId, epoch, frameId) {
  return {
    frame: {
      frameId: frameId,
      profile: { id: profileId, name: profileId },
      selectionEpoch: epoch,
      pngDataUrl: 'data:image/png;base64,cG5n',
      imageSize: { width: 1920, height: 1080 },
      contentSize: { width: 1920, height: 1080 },
      capturedAt: 1,
      contract: { valid: true, failures: [] }
    }
  };
}

describe('Vision Author renderer state races', () => {
  beforeEach(function () { jest.useFakeTimers(); });
  afterEach(function () { jest.useRealTimers(); });

  test('drops a late frame after rapid Profile switch', async () => {
    const first = helpers.deferred();
    const bridge = {
      capture: jest.fn(function (request) {
        return request.profileId === 'p_aaaaaaaa'
          ? first.promise
          : Promise.resolve(result('p_bbbbbbbb', request.selectionEpoch, 'frame-b'));
      }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    controller.selectProfile('p_bbbbbbbb');
    first.resolve(result('p_aaaaaaaa', 1, 'late-a'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().selectedProfileId).toBe('p_bbbbbbbb');
    expect(controller.getState().displayedFrameId).toBe(null);
    expect(bridge.markDisplayed).not.toHaveBeenCalledWith(expect.objectContaining({ frameId: 'late-a' }));

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().displayedFrameId).toBe('frame-b');
  });

  test('Freeze racing an in-flight response keeps the previous displayed frame', async () => {
    const second = helpers.deferred();
    let call = 0;
    const bridge = {
      capture: jest.fn(function (request) {
        call += 1;
        return call === 1
          ? Promise.resolve(result(request.profileId, request.selectionEpoch, 'old'))
          : second.promise;
      }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(async request => ({ frame: { frameId: request.frameId } })),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    const freezing = controller.freeze();
    second.resolve(result('p_aaaaaaaa', 1, 'late'));
    await freezing;
    await Promise.resolve();
    expect(controller.getState()).toEqual(expect.objectContaining({
      mode: 'FROZEN',
      displayedFrameId: 'old',
      frozenFrameId: 'old'
    }));
  });

  test('disconnect and capture failure produce finite recoverable states', async () => {
    const bridge = {
      capture: jest.fn()
        .mockRejectedValueOnce({ code: 'capture-failed', safeMessage: '失败', recovery: '重试' })
        .mockResolvedValueOnce(result('p_aaaaaaaa', 1, 'recovered')),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    expect(controller.getState().error).toEqual(expect.objectContaining({ code: 'capture-failed', recovery: '重试' }));
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().displayedFrameId).toBe('recovered');
    controller.disconnect({ code: 'connection-closed', safeMessage: '断开', recovery: '重启' });
    expect(controller.getState()).toEqual(expect.objectContaining({
      mode: 'DISCONNECTED',
      error: expect.objectContaining({ code: 'connection-closed', recovery: '重启' })
    }));
    const count = bridge.capture.mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect(bridge.capture).toHaveBeenCalledTimes(count);
  });
});

