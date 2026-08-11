'use strict';

const { validSize } = require('../../../src/automation/coordinates');

function captureError(code) {
  const error = new Error(code || 'capture-failed');
  error.code = code || 'capture-failed';
  return error;
}

function readWindowHandle(win) {
  if (!win || typeof win.getNativeWindowHandle !== 'function') throw captureError();
  const handle = win.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || handle.length < 4) throw captureError();
  if (handle.length >= 8 && typeof handle.readBigUInt64LE === 'function') {
    return handle.readBigUInt64LE(0).toString(10);
  }
  return String(handle.readUInt32LE(0));
}

function captureGeometry(target) {
  if (
    !target ||
    !target.window ||
    !validSize(target.contentSize) ||
    typeof target.window.getContentSize !== 'function' ||
    typeof target.window.getSize !== 'function'
  ) {
    throw captureError();
  }
  const contentDip = target.window.getContentSize();
  const outerDip = target.window.getSize();
  if (
    !Array.isArray(contentDip) ||
    !Array.isArray(outerDip) ||
    contentDip[0] <= 0 ||
    contentDip[1] <= 0 ||
    outerDip[0] < contentDip[0] ||
    outerDip[1] < contentDip[1]
  ) {
    throw captureError();
  }
  const scaleX = target.contentSize.width / contentDip[0];
  const scaleY = target.contentSize.height / contentDip[1];
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    throw captureError();
  }
  return Object.freeze({
    sourceIdPrefix: 'window:' + readWindowHandle(target.window) + ':',
    thumbnailSize: Object.freeze({
      width: Math.ceil(outerDip[0] * scaleX),
      height: Math.ceil(outerDip[1] * scaleY)
    }),
    contentSize: Object.freeze({
      width: target.contentSize.width,
      height: target.contentSize.height
    })
  });
}

function cropClientImage(image, contentSize) {
  if (!image || typeof image.getSize !== 'function' || typeof image.crop !== 'function') {
    throw captureError();
  }
  const imageSize = image.getSize();
  if (!validSize(imageSize)) throw captureError();
  const extraWidth = imageSize.width - contentSize.width;
  const extraHeight = imageSize.height - contentSize.height;
  if (extraWidth < 0 || extraHeight < 0) throw captureError();

  // Windows 的标准 BrowserWindow 左右和底边等宽，剩余的顶部区域是标题栏。
  const sideBorder = Math.floor(extraWidth / 2);
  const crop = {
    x: sideBorder,
    y: extraHeight - sideBorder,
    width: contentSize.width,
    height: contentSize.height
  };
  if (
    crop.y < 0 ||
    crop.x + crop.width > imageSize.width ||
    crop.y + crop.height > imageSize.height
  ) {
    throw captureError();
  }
  const result = image.crop(crop);
  if (
    !result ||
    typeof result.isEmpty !== 'function' ||
    result.isEmpty() ||
    typeof result.getSize !== 'function'
  ) {
    throw captureError();
  }
  const resultSize = result.getSize();
  if (resultSize.width !== contentSize.width || resultSize.height !== contentSize.height) {
    throw captureError();
  }
  return result;
}

function createDesktopCaptureProvider(options) {
  const opts = options || {};
  const desktopCapturer = opts.desktopCapturer;
  if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
    throw new TypeError('desktopCapturer is required');
  }
  return async function captureDesktopWindow(target) {
    const geometry = captureGeometry(target);
    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: geometry.thumbnailSize,
        fetchWindowIcons: false
      });
    } catch (_) {
      throw captureError();
    }
    const source = Array.isArray(sources)
      ? sources.find(function (entry) {
          if (!entry || typeof entry.id !== 'string') return false;
          if (entry.id.indexOf(geometry.sourceIdPrefix) !== 0) return false;
          return /^\d+$/.test(entry.id.slice(geometry.sourceIdPrefix.length));
        })
      : null;
    if (!source || !source.thumbnail) throw captureError();
    return cropClientImage(source.thumbnail, geometry.contentSize);
  };
}

module.exports = {
  captureGeometry: captureGeometry,
  cropClientImage: cropClientImage,
  createDesktopCaptureProvider: createDesktopCaptureProvider,
  readWindowHandle: readWindowHandle
};
