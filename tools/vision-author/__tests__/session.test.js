'use strict';

const helpers = require('./helpers');

function captureResult(label) {
  return Object.freeze({
    png: Buffer.from('png-' + label),
    imageSize: Object.freeze({ width: 1920, height: 1080 }),
    contentSize: Object.freeze({ width: 1920, height: 1080 }),
    capturedAt: 1000
  });
}

describe('BridgeSession Profile and frame identity', () => {
  function setup(overrides) {
    const options = overrides || {};
    const profiles = options.profiles || [
      { id: 'p_aaaaaaaa', name: '账号 A', secret: 'must-not-leak' }
    ];
    const backend = options.backend || {
      getWindowState: jest.fn(function () {
        return {
          available: true,
          gameReady: false,
          contentSize: { width: 1920, height: 1080 }
        };
      }),
      capture: jest.fn(async function () { return captureResult('a'); })
    };
    const frameFactory = options.frameFactory || jest.fn(function (capture, profile, epoch) {
      const frameId = 'frame-' + capture.png.toString('utf8');
      return {
        frameId: frameId,
        profile: Object.freeze({ id: profile.id, name: profile.name }),
        selectionEpoch: epoch,
        png: Buffer.from(capture.png),
        contract: Object.freeze({ valid: true, failures: Object.freeze([]) }),
        publicFrame: Object.freeze({
          frameId: frameId,
          profile: Object.freeze({ id: profile.id, name: profile.name }),
          selectionEpoch: epoch,
          pngDataUrl: 'data:image/png;base64,' + capture.png.toString('base64'),
          imageSize: capture.imageSize,
          contentSize: capture.contentSize,
          capturedAt: capture.capturedAt,
          contract: Object.freeze({ valid: true, failures: Object.freeze([]) })
        })
      };
    });
    const { createBridgeSession } = require('../bridge/session');
    return {
      backend: backend,
      session: createBridgeSession({
        profileStore: { getAll: function () { return profiles.slice(); }, get: id => profiles.find(p => p.id === id) || null },
        backend: backend,
        frameFactory: frameFactory
      })
    };
  }

  test('returns an allowlisted Profile catalog and allows objective capture when GAME_READY=false', async () => {
    const context = setup();
    const listed = context.session.listProfiles();
    expect(listed).toEqual({
      profiles: [{ id: 'p_aaaaaaaa', name: '账号 A', available: true }]
    });
    expect(JSON.stringify(listed)).not.toMatch(/secret|gameReady|session|partition/i);

    const result = await context.session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 3 });
    expect(context.backend.capture).toHaveBeenCalledWith('p_aaaaaaaa');
    expect(result.frame).toEqual(expect.objectContaining({
      frameId: expect.any(String),
      profile: { id: 'p_aaaaaaaa', name: '账号 A' },
      selectionEpoch: 3,
      imageSize: { width: 1920, height: 1080 },
      contentSize: { width: 1920, height: 1080 }
    }));
  });

  test('rejects non-catalog and objectively unavailable profiles without capture', async () => {
    const context = setup({
      backend: {
        getWindowState: jest.fn(function () { return { available: true, gameReady: true, contentSize: null }; }),
        capture: jest.fn()
      }
    });
    expect(context.session.listProfiles().profiles[0].available).toBe(false);
    await expect(context.session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 1 })).rejects.toMatchObject({ code: 'profile-unavailable' });
    await expect(context.session.capture({ profileId: 'p_bogus', selectionEpoch: 1 })).rejects.toMatchObject({ code: 'profile-not-found' });
    expect(context.backend.capture).not.toHaveBeenCalled();
  });

  test('enforces bridge capture single-flight with no queue', async () => {
    const pending = helpers.deferred();
    const backend = {
      getWindowState: jest.fn(function () {
        return { available: true, contentSize: { width: 1920, height: 1080 } };
      }),
      capture: jest.fn(function () { return pending.promise; })
    };
    const context = setup({ backend: backend });
    context.session.listProfiles();
    const first = context.session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 1 });
    await expect(context.session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 1 })).rejects.toMatchObject({ code: 'capture-busy' });
    expect(backend.capture).toHaveBeenCalledTimes(1);
    pending.resolve(captureResult('pending'));
    await first;
    expect(backend.capture).toHaveBeenCalledTimes(1);
  });

  test('only the acknowledged displayed frame can be pinned and release clears it', async () => {
    const context = setup();
    context.session.listProfiles();
    const capture = await context.session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 7 });
    const identity = {
      frameId: capture.frame.frameId,
      profileId: 'p_aaaaaaaa',
      selectionEpoch: 7
    };
    expect(function () { context.session.freezeFrame(identity); }).toThrow(
      expect.objectContaining({ code: 'frame-stale' })
    );
    expect(context.session.markDisplayed(identity)).toEqual({ displayedFrameId: capture.frame.frameId });
    const frozen = context.session.freezeFrame(identity);
    expect(frozen.frame).toEqual(expect.objectContaining({
      frameId: capture.frame.frameId,
      profile: { id: 'p_aaaaaaaa', name: '账号 A' }
    }));
    expect(context.session.snapshot().frozenFrameId).toBe(capture.frame.frameId);
    expect(context.session.releaseFrame({ frameId: capture.frame.frameId })).toEqual({ released: true });
    expect(context.session.snapshot()).toEqual(expect.objectContaining({
      displayedFrameId: null,
      frozenFrameId: null
    }));
  });

  test('session close and frozen release clear frame/preview/grant state without touching Profile windows', async () => {
    const writer = { clearSession: jest.fn() };
    const context = setup();
    const { createBridgeSession } = require('../bridge/session');
    const session = createBridgeSession({
      sessionId: 'cleanup-session',
      profileStore: {
        getAll: function () { return [{ id: 'p_aaaaaaaa', name: 'A' }]; },
        get: function () { return { id: 'p_aaaaaaaa', name: 'A' }; }
      },
      backend: context.backend,
      writer: writer,
      frameFactory: function (capture, profile, epoch) {
        return {
          frameId: 'cleanup-frame', profile: profile, selectionEpoch: epoch,
          png: capture.png, contract: { valid: true, failures: [] },
          publicFrame: {
            frameId: 'cleanup-frame', profile: profile, selectionEpoch: epoch,
            pngDataUrl: 'data:image/png;base64,' + capture.png.toString('base64'),
            imageSize: capture.imageSize, contentSize: capture.contentSize,
            capturedAt: capture.capturedAt, contract: { valid: true, failures: [] }
          }
        };
      }
    });
    session.listProfiles();
    await session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 1 });
    const identity = { frameId: 'cleanup-frame', profileId: 'p_aaaaaaaa', selectionEpoch: 1 };
    session.markDisplayed(identity);
    session.freezeFrame(identity);
    session.releaseFrame({ frameId: 'cleanup-frame' });
    expect(writer.clearSession).toHaveBeenCalledWith('cleanup-session');
    session.close();
    expect(session.snapshot()).toEqual({
      capturePending: false,
      displayedFrameId: null,
      frozenFrameId: null,
      previewId: null,
      closed: true
    });
  });
});
