'use strict';

const crypto = require('crypto');
const { readPngSize, createVisionCodec } = require('../../../src/automation/vision/codec');
const { validSize } = require('../../../src/automation/coordinates');

const CANONICAL_SIZE = Object.freeze({ width: 1920, height: 1080 });

function sameSize(left, right) {
  return !!left && !!right && left.width === right.width && left.height === right.height;
}

function createCaptureFrame(capture, profile, selectionEpoch, options) {
  const opts = options || {};
  const failures = [];
  const safeProfile = profile && typeof profile.id === 'string' && typeof profile.name === 'string'
    ? Object.freeze({ id: profile.id, name: profile.name })
    : Object.freeze({ id: '', name: '' });
  if (!profile || safeProfile.id !== opts.expectedProfileId && opts.expectedProfileId) {
    failures.push('profile-mismatch');
  }
  if (!capture || !Number.isFinite(capture.capturedAt)) failures.push('captured-at-invalid');
  if (!capture || !validSize(capture.imageSize) || !sameSize(capture.imageSize, CANONICAL_SIZE)) {
    failures.push('image-size-not-canonical');
  }
  if (!capture || !validSize(capture.contentSize) || !sameSize(capture.contentSize, CANONICAL_SIZE)) {
    failures.push('content-size-not-canonical');
  }

  let decoded = null;
  if (!capture || !Buffer.isBuffer(capture.png)) {
    failures.push('png-invalid');
  } else {
    try {
      const pngSize = readPngSize(capture.png);
      if (!capture.imageSize || !sameSize(pngSize, capture.imageSize)) {
        failures.push('png-image-size-mismatch');
      }
      const codec = opts.codec || createVisionCodec();
      decoded = codec.decodeCapture(capture);
    } catch (_) {
      if (failures.indexOf('png-invalid') === -1) failures.push('png-invalid');
    }
  }

  const uniqueFailures = Object.freeze(Array.from(new Set(failures)));
  const contract = Object.freeze({ valid: uniqueFailures.length === 0, failures: uniqueFailures });
  const frameId = opts.frameId || 'frame-' + crypto.randomBytes(16).toString('hex');
  const png = capture && Buffer.isBuffer(capture.png) ? Buffer.from(capture.png) : Buffer.alloc(0);
  const imageSize = capture && validSize(capture.imageSize)
    ? Object.freeze({ width: capture.imageSize.width, height: capture.imageSize.height })
    : Object.freeze({ width: 0, height: 0 });
  const contentSize = capture && validSize(capture.contentSize)
    ? Object.freeze({ width: capture.contentSize.width, height: capture.contentSize.height })
    : Object.freeze({ width: 0, height: 0 });
  const publicFrame = Object.freeze({
    frameId: frameId,
    profile: safeProfile,
    selectionEpoch: selectionEpoch,
    pngDataUrl: 'data:image/png;base64,' + png.toString('base64'),
    imageSize: imageSize,
    contentSize: contentSize,
    capturedAt: capture && Number.isFinite(capture.capturedAt) ? capture.capturedAt : null,
    contract: contract
  });
  return Object.freeze({
    frameId: frameId,
    profile: safeProfile,
    selectionEpoch: selectionEpoch,
    png: png,
    imageSize: imageSize,
    contentSize: contentSize,
    capturedAt: publicFrame.capturedAt,
    decoded: decoded,
    contract: contract,
    publicFrame: publicFrame
  });
}

function frozenPublicFrame(frame) {
  return Object.freeze({
    frameId: frame.frameId,
    profile: frame.profile,
    imageSize: frame.imageSize || frame.publicFrame.imageSize,
    contentSize: frame.contentSize || frame.publicFrame.contentSize,
    capturedAt: frame.capturedAt === undefined ? frame.publicFrame.capturedAt : frame.capturedAt,
    contract: frame.contract
  });
}

function frameError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validSelectionRect(rect, imageSize) {
  return !!rect && validSize(imageSize) &&
    Number.isInteger(rect.x) && rect.x >= 0 &&
    Number.isInteger(rect.y) && rect.y >= 0 &&
    Number.isInteger(rect.width) && rect.width > 0 &&
    Number.isInteger(rect.height) && rect.height > 0 &&
    rect.x + rect.width <= imageSize.width &&
    rect.y + rect.height <= imageSize.height;
}

function createPreviewArtifact(frame, templateRect, options) {
  const opts = options || {};
  if (!frame || typeof frame.frameId !== 'string' || !Buffer.isBuffer(frame.png)) {
    throw frameError('frame-stale');
  }
  if (!validSelectionRect(templateRect, frame.imageSize)) throw frameError('selection-invalid');
  const nativeImage = opts.nativeImage || require('electron').nativeImage;
  let source;
  let sourceSize;
  try {
    source = nativeImage.createFromBuffer(Buffer.from(frame.png));
    if (!source || source.isEmpty() || typeof source.crop !== 'function') throw new Error('invalid-source');
    sourceSize = source.getSize();
  } catch (_) {
    throw frameError('frame-contract-invalid');
  }
  if (!sameSize(sourceSize, frame.imageSize)) throw frameError('frame-contract-invalid');

  let crop;
  let png;
  try {
    crop = source.crop({
      x: templateRect.x,
      y: templateRect.y,
      width: templateRect.width,
      height: templateRect.height
    });
    if (!crop || crop.isEmpty() || !sameSize(crop.getSize(), {
      width: templateRect.width,
      height: templateRect.height
    })) {
      throw new Error('invalid-crop');
    }
    if (typeof source.toBitmap === 'function' && typeof crop.toBitmap === 'function') {
      const sourceBitmap = source.toBitmap();
      const cropBitmap = crop.toBitmap();
      if (
        !Buffer.isBuffer(sourceBitmap) ||
        !Buffer.isBuffer(cropBitmap) ||
        cropBitmap.length !== templateRect.width * templateRect.height * 4
      ) {
        throw new Error('invalid-bitmap');
      }
      for (let y = 0; y < templateRect.height; y++) {
        const sourceStart = ((templateRect.y + y) * frame.imageSize.width + templateRect.x) * 4;
        const targetStart = y * templateRect.width * 4;
        if (!sourceBitmap.slice(sourceStart, sourceStart + templateRect.width * 4)
          .equals(cropBitmap.slice(targetStart, targetStart + templateRect.width * 4))) {
          throw new Error('crop-pixel-mismatch');
        }
      }
    }
    png = crop.toPNG();
    const pngSize = readPngSize(png);
    if (!sameSize(pngSize, { width: templateRect.width, height: templateRect.height })) {
      throw new Error('crop-png-size');
    }
  } catch (_) {
    throw frameError('frame-contract-invalid');
  }

  const previewId = opts.previewId || 'preview-' + crypto.randomBytes(16).toString('hex');
  const rect = Object.freeze({
    x: templateRect.x,
    y: templateRect.y,
    width: templateRect.width,
    height: templateRect.height
  });
  const imageSize = Object.freeze({ width: rect.width, height: rect.height });
  const publicPreview = Object.freeze({
    previewId: previewId,
    frozenFrameId: frame.frameId,
    templateRect: rect,
    pngDataUrl: 'data:image/png;base64,' + png.toString('base64'),
    imageSize: imageSize
  });
  return Object.freeze({
    previewId: previewId,
    frozenFrameId: frame.frameId,
    templateRect: rect,
    png: Buffer.from(png),
    imageSize: imageSize,
    createdAt: typeof opts.now === 'function' ? opts.now() : Date.now(),
    publicPreview: publicPreview
  });
}

module.exports = {
  CANONICAL_SIZE: CANONICAL_SIZE,
  createCaptureFrame: createCaptureFrame,
  createPreviewArtifact: createPreviewArtifact,
  frameError: frameError,
  frozenPublicFrame: frozenPublicFrame,
  sameSize: sameSize,
  validSelectionRect: validSelectionRect
};
