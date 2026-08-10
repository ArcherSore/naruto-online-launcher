'use strict';

const { createRecordingService } = require('../recording');
const { createAutomationBackend } = require('../backend');
const { mapNormalizedPoint } = require('../coordinates');

describe('coordinate recording service', () => {
  function makeStore() {
    return {
      points: [],
      getCoordinates: jest.fn(function () { return this.points.slice(); }),
      setCoordinates: jest.fn(function (_profileId, _scriptId, points) {
        this.points = points.slice();
        return this.points.slice();
      }),
      clearCoordinates: jest.fn(function () { this.points = []; return []; })
    };
  }

  test('begins recording from an available target when gameReady is false', async () => {
    const webContents = {
      isDestroyed: function () { return false; },
      capturePage: async function () {
        return {
          toPNG: function () { return Buffer.from('image'); },
          getSize: function () { return { width: 200, height: 100 }; }
        };
      }
    };
    const window = {
      isDestroyed: function () { return false; },
      getContentSize: function () { return [100, 50]; }
    };
    const backend = createAutomationBackend({
      targetProvider: function () {
        return { window: window, webContents: webContents, gameReady: false };
      }
    });
    const service = createRecordingService({ backend: backend, store: makeStore() });

    await expect(service.begin('p_aaaaaaaa', 'demo-click', 'manager-1')).resolves.toEqual(
      expect.objectContaining({
        capture: expect.objectContaining({ contentSize: { width: 100, height: 50 } })
      })
    );
  });

  test('binds a PNG capture to profile, script, owner, and five-minute expiry', async () => {
    let now = 1000;
    const store = makeStore();
    const service = createRecordingService({
      backend: {
        capture: jest.fn(async function () {
          return {
            png: Buffer.from('image'),
            imageSize: { width: 200, height: 100 },
            contentSize: { width: 100, height: 50 },
            capturedAt: now
          };
        })
      },
      store: store,
      now: function () { return now; },
      ttlMs: 300000
    });
    const begun = await service.begin('p_aaaaaaaa', 'demo-click', 'manager-1');
    expect(begun.capture).toEqual({
      captureId: expect.any(String),
      pngDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      imageSize: { width: 200, height: 100 },
      contentSize: { width: 100, height: 50 },
      expiresAt: 301000
    });
    expect(JSON.stringify(begun.capture)).not.toContain('ownerId');

    const added = service.addPoint({
      profileId: 'p_aaaaaaaa', scriptId: 'demo-click', ownerId: 'manager-1',
      captureId: begun.capture.captureId, imageX: 100, imageY: 50
    });
    expect(added.point).toEqual({ order: 1, normalizedX: 0.505, normalizedY: 0.51 });
    expect(mapNormalizedPoint(added.point, { width: 100, height: 50 }))
      .toEqual({ x: 50, y: 25 });
    expect(function () {
      service.addPoint({
        profileId: 'p_aaaaaaaa', scriptId: 'demo-click', ownerId: 'manager-2',
        captureId: begun.capture.captureId, imageX: 1, imageY: 1
      });
    }).toThrow(expect.objectContaining({ code: 'capture-expired' }));

    now += 300001;
    expect(function () {
      service.addPoint({
        profileId: 'p_aaaaaaaa', scriptId: 'demo-click', ownerId: 'manager-1',
        captureId: begun.capture.captureId, imageX: 1, imageY: 1
      });
    }).toThrow(expect.objectContaining({ code: 'capture-expired' }));
  });

  test('replaces captures and clears only requested profile records', async () => {
    const store = makeStore();
    const service = createRecordingService({
      backend: {
        capture: async function () {
          return {
            png: Buffer.from('image'), imageSize: { width: 100, height: 100 },
            contentSize: { width: 100, height: 100 }, capturedAt: 1
          };
        }
      },
      store: store
    });
    const first = await service.begin('p_aaaaaaaa', 'demo-click', 'manager-1');
    const second = await service.begin('p_aaaaaaaa', 'demo-click', 'manager-1');
    expect(first.capture.captureId).not.toBe(second.capture.captureId);
    service.clearProfile('p_aaaaaaaa');
    [first, second].forEach(function (record) {
      expect(function () {
        service.addPoint({
          profileId: 'p_aaaaaaaa', scriptId: 'demo-click', ownerId: 'manager-1',
          captureId: record.capture.captureId, imageX: 1, imageY: 1
        });
      }).toThrow(expect.objectContaining({ code: 'capture-expired' }));
    });
  });

  test('round-trips a recorded 1920x1080 content pixel through the normalized mapper', async () => {
    const store = makeStore();
    const service = createRecordingService({
      backend: {
        capture: async function () {
          return {
            png: Buffer.from('image'),
            imageSize: { width: 1920, height: 1080 },
            contentSize: { width: 1920, height: 1080 },
            capturedAt: 1
          };
        }
      },
      store: store
    });
    const begun = await service.begin('p_aaaaaaaa', 'demo-click', 'manager-1');
    const added = service.addPoint({
      profileId: 'p_aaaaaaaa',
      scriptId: 'demo-click',
      ownerId: 'manager-1',
      captureId: begun.capture.captureId,
      imageX: 123,
      imageY: 39
    });

    expect(mapNormalizedPoint(added.point, { width: 1920, height: 1080 }))
      .toEqual({ x: 123, y: 39 });
  });
});
