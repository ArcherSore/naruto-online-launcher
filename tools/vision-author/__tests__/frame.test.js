'use strict';

const helpers = require('./helpers');

describe('Frozen frame preview artifacts', () => {
  test('uses a lightweight JPEG for live view and only encodes full PNG when frozen', () => {
    const fullPng = Buffer.from('lossless-full-frame');
    const preview = {
      isEmpty: jest.fn(function () { return false; }),
      getSize: jest.fn(function () { return { width: 960, height: 540 }; }),
      toJPEG: jest.fn(function () { return Buffer.from('small-preview'); })
    };
    const image = {
      isEmpty: jest.fn(function () { return false; }),
      getSize: jest.fn(function () { return { width: 1920, height: 1080 }; }),
      resize: jest.fn(function () { return preview; }),
      toPNG: jest.fn(function () { return fullPng; })
    };
    const { createCaptureFrame, frozenPublicFrame } = require('../bridge/frame');
    const frame = createCaptureFrame({
      image: image,
      imageSize: { width: 1920, height: 1080 },
      contentSize: { width: 1920, height: 1080 },
      capturedAt: 1
    }, { id: 'p_aaaaaaaa', name: 'A' }, 3, { frameId: 'frame-native' });

    expect(frame.publicFrame.imageDataUrl).toBe(
      'data:image/jpeg;base64,' + Buffer.from('small-preview').toString('base64')
    );
    expect(image.resize).toHaveBeenCalledWith({ width: 960, height: 540, quality: 'good' });
    expect(preview.toJPEG).toHaveBeenCalledWith(70);
    expect(image.toPNG).not.toHaveBeenCalled();

    const frozen = frozenPublicFrame(frame);
    expect(frozen.imageDataUrl).toBe(
      'data:image/png;base64,' + fullPng.toString('base64')
    );
    expect(image.toPNG).toHaveBeenCalledTimes(1);
  });

  test('crops the pinned original PNG without scaling and preserves exact source pixels', () => {
    const width = 8;
    const height = 6;
    const bitmap = helpers.makeBitmap(width, height);
    const sourcePng = helpers.visionFixtures.encodePng(width, height, bitmap);
    const frame = {
      frameId: 'frame-a',
      png: sourcePng,
      imageSize: { width: width, height: height },
      contract: { valid: false, failures: ['image-size-not-canonical'] }
    };
    const rect = { x: 2, y: 1, width: 3, height: 2 };
    const { createPreviewArtifact } = require('../bridge/frame');
    const artifact = createPreviewArtifact(frame, rect, {
      nativeImage: helpers.createNativeImageFixture(),
      previewId: 'preview-a',
      now: function () { return 123; }
    });

    expect(artifact.publicPreview).toEqual(expect.objectContaining({
      previewId: 'preview-a',
      frozenFrameId: 'frame-a',
      templateRect: rect,
      imageSize: { width: 3, height: 2 }
    }));
    const decoded = helpers.decodeFixturePng(artifact.png);
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const source = ((rect.y + y) * width + rect.x + x) * 4;
        const target = (y * rect.width + x) * 4;
        expect(decoded.bitmap.slice(target, target + 4)).toEqual(bitmap.slice(source, source + 4));
      }
    }
  });

  test('rejects zero-area/out-of-bounds rects and source dimension drift', () => {
    const nativeImage = helpers.createNativeImageFixture();
    const png = helpers.visionFixtures.encodePng(4, 4, helpers.makeBitmap(4, 4));
    const { createPreviewArtifact } = require('../bridge/frame');
    const frame = { frameId: 'frame-a', png: png, imageSize: { width: 4, height: 4 }, contract: { valid: true, failures: [] } };
    expect(function () {
      createPreviewArtifact(frame, { x: 0, y: 0, width: 0, height: 1 }, { nativeImage: nativeImage });
    }).toThrow(expect.objectContaining({ code: 'selection-invalid' }));
    expect(function () {
      createPreviewArtifact(frame, { x: 3, y: 3, width: 2, height: 2 }, { nativeImage: nativeImage });
    }).toThrow(expect.objectContaining({ code: 'selection-invalid' }));
    expect(function () {
      createPreviewArtifact(Object.assign({}, frame, { imageSize: { width: 5, height: 4 } }), { x: 0, y: 0, width: 1, height: 1 }, { nativeImage: nativeImage });
    }).toThrow(expect.objectContaining({ code: 'frame-contract-invalid' }));
  });

  test('session keeps one current preview and invalidates the old previewId on Template change', async () => {
    const nativeImage = helpers.createNativeImageFixture();
    const png = helpers.visionFixtures.encodePng(4, 4, helpers.makeBitmap(4, 4));
    const capture = { png: png, imageSize: { width: 4, height: 4 }, contentSize: { width: 4, height: 4 }, capturedAt: 1 };
    const backend = {
      getWindowState: function () { return { available: true, contentSize: { width: 1920, height: 1080 } }; },
      capture: jest.fn(async function () { return capture; })
    };
    const { createBridgeSession } = require('../bridge/session');
    const session = createBridgeSession({
      profileStore: {
        getAll: function () { return [{ id: 'p_aaaaaaaa', name: 'A' }]; },
        get: function () { return { id: 'p_aaaaaaaa', name: 'A' }; }
      },
      backend: backend,
      nativeImage: nativeImage,
      frameFactory: function (value, profile, epoch) {
        return {
          frameId: 'frame-a', profile: profile, selectionEpoch: epoch, png: value.png,
          imageSize: value.imageSize, contentSize: value.contentSize, capturedAt: value.capturedAt,
          contract: { valid: false, failures: ['image-size-not-canonical'] },
          publicFrame: {
            frameId: 'frame-a', profile: profile, selectionEpoch: epoch,
            pngDataUrl: 'data:image/png;base64,' + value.png.toString('base64'),
            imageSize: value.imageSize, contentSize: value.contentSize, capturedAt: value.capturedAt,
            contract: { valid: false, failures: ['image-size-not-canonical'] }
          }
        };
      }
    });
    session.listProfiles();
    await session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 1 });
    const identity = { frameId: 'frame-a', profileId: 'p_aaaaaaaa', selectionEpoch: 1 };
    session.markDisplayed(identity);
    session.freezeFrame(identity);
    const first = session.createPreview({ frozenFrameId: 'frame-a', templateRect: { x: 0, y: 0, width: 2, height: 2 } });
    const second = session.createPreview({ frozenFrameId: 'frame-a', templateRect: { x: 1, y: 1, width: 2, height: 2 } });
    expect(second.preview.previewId).not.toBe(first.preview.previewId);
    expect(function () { session.getPreview(first.preview.previewId); }).toThrow(
      expect.objectContaining({ code: 'preview-stale' })
    );
    expect(session.getPreview(second.preview.previewId).png).toEqual(expect.any(Buffer));
  });
});

