'use strict';

const { nativeImage: defaultNativeImage } = require('electron');
const { AutomationError } = require('../errors');
const { validSize } = require('../coordinates');

const MAX_PNG_BYTES = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngSize(png) {
  if (
    !Buffer.isBuffer(png) ||
    png.length < 33 ||
    png.length > MAX_PNG_BYTES ||
    !png.slice(0, 8).equals(PNG_SIGNATURE) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('invalid-png');
  }
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (!validSize(size) || size.width > 1920 || size.height > 1080) {
    throw new Error('invalid-png-size');
  }
  return size;
}

function createVisionCodec(options) {
  const opts = options || {};
  const nativeImage = opts.nativeImage || defaultNativeImage;

  function decode(png, errorCode) {
    try {
      const pngSize = readPngSize(png);
      if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
        throw new Error('native-image-unavailable');
      }
      const image = nativeImage.createFromBuffer(Buffer.from(png));
      if (!image || typeof image.isEmpty !== 'function' || image.isEmpty()) {
        throw new Error('empty-image');
      }
      if (typeof image.getSize !== 'function' || typeof image.toBitmap !== 'function') {
        throw new Error('invalid-native-image');
      }
      const decodedSize = image.getSize();
      if (
        !validSize(decodedSize) ||
        decodedSize.width !== pngSize.width ||
        decodedSize.height !== pngSize.height
      ) {
        throw new Error('decoder-size-mismatch');
      }
      const bitmap = image.toBitmap();
      if (!Buffer.isBuffer(bitmap) || bitmap.length !== pngSize.width * pngSize.height * 4) {
        throw new Error('invalid-bitmap');
      }
      return Object.freeze({
        width: pngSize.width,
        height: pngSize.height,
        bitmap: Buffer.from(bitmap)
      });
    } catch (_) {
      throw new AutomationError(errorCode);
    }
  }

  function decodeCapture(frame) {
    try {
      if (
        !frame ||
        !Buffer.isBuffer(frame.png) ||
        !validSize(frame.imageSize) ||
        !validSize(frame.contentSize) ||
        !Number.isFinite(frame.capturedAt)
      ) {
        throw new Error('invalid-capture');
      }
      const decoded = decode(frame.png, 'capture-failed');
      if (
        decoded.width !== frame.imageSize.width ||
        decoded.height !== frame.imageSize.height
      ) {
        throw new Error('capture-size-mismatch');
      }
      return Object.freeze({
        bitmap: decoded.bitmap,
        imageSize: Object.freeze({ width: decoded.width, height: decoded.height }),
        contentSize: Object.freeze({
          width: frame.contentSize.width,
          height: frame.contentSize.height
        }),
        capturedAt: frame.capturedAt
      });
    } catch (_) {
      throw new AutomationError('capture-failed');
    }
  }

  return Object.freeze({
    decodeCapture: decodeCapture,
    decodeTemplate: function (png) { return decode(png, 'vision-template-invalid'); }
  });
}

module.exports = {
  MAX_PNG_BYTES: MAX_PNG_BYTES,
  PNG_SIGNATURE: PNG_SIGNATURE,
  createVisionCodec: createVisionCodec,
  readPngSize: readPngSize
};
