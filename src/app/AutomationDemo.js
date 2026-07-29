/**
 * 最小内置自动化 Demo：对单个游戏 BrowserWindow 截图并通过 CDP 后台点击。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app, screen } = require('electron');

let captureSequence = 0;
const CDP_PROTOCOL_VERSION = '1.3';
const DEFAULT_SETTLE_DELAY_MS = 500;

function isEnabled(env) {
  const source = env || process.env;
  return source.SHINOBI_DEBUG === '1';
}

function createError(code, message, ErrorType) {
  const error = new (ErrorType || Error)(message);
  error.code = code;
  return error;
}

function validateSize(size, name) {
  if (
    !size ||
    typeof size.width !== 'number' ||
    !Number.isFinite(size.width) ||
    size.width <= 0 ||
    typeof size.height !== 'number' ||
    !Number.isFinite(size.height) ||
    size.height <= 0
  ) {
    throw createError('invalid-' + name + '-size', name + ' size must be positive', RangeError);
  }
}

function mapImagePoint(imageX, imageY, imageSize, contentSize) {
  if (
    typeof imageX !== 'number' ||
    !Number.isFinite(imageX) ||
    typeof imageY !== 'number' ||
    !Number.isFinite(imageY)
  ) {
    throw createError(
      'invalid-coordinate-type',
      'image coordinates must be finite numbers',
      TypeError
    );
  }

  validateSize(imageSize, 'image');
  validateSize(contentSize, 'content');

  if (imageX < 0 || imageX >= imageSize.width || imageY < 0 || imageY >= imageSize.height) {
    throw createError(
      'coordinate-out-of-range',
      'image coordinates are outside the captured image',
      RangeError
    );
  }

  return {
    x: Math.floor((imageX * contentSize.width) / imageSize.width),
    y: Math.floor((imageY * contentSize.height) / imageSize.height)
  };
}

function normalizeImagePoint(imageX, imageY, imageSize, contentSize) {
  const inputPoint = mapImagePoint(imageX, imageY, imageSize, contentSize);
  return {
    normalizedX: inputPoint.x / contentSize.width,
    normalizedY: inputPoint.y / contentSize.height,
    inputPoint: inputPoint
  };
}

function mapNormalizedPoint(normalizedX, normalizedY, contentSize) {
  if (
    typeof normalizedX !== 'number' ||
    !Number.isFinite(normalizedX) ||
    typeof normalizedY !== 'number' ||
    !Number.isFinite(normalizedY)
  ) {
    throw createError(
      'invalid-normalized-coordinate-type',
      'normalized coordinates must be finite numbers',
      TypeError
    );
  }
  validateSize(contentSize, 'content');
  if (normalizedX < 0 || normalizedX >= 1 || normalizedY < 0 || normalizedY >= 1) {
    throw createError(
      'normalized-coordinate-out-of-range',
      'normalized coordinates must be in the range [0, 1)',
      RangeError
    );
  }
  return {
    x: Math.min(contentSize.width - 1, Math.floor(normalizedX * contentSize.width)),
    y: Math.min(contentSize.height - 1, Math.floor(normalizedY * contentSize.height))
  };
}

function readPngSize(png) {
  if (!Buffer.isBuffer(png) || png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw createError('invalid-capture', 'capturePage did not produce a valid PNG');
  }
  const size = {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
  validateSize(size, 'image');
  return size;
}

function getContentSize(win) {
  const raw = win.getContentSize();
  const size = { width: raw[0], height: raw[1] };
  validateSize(size, 'content');
  return size;
}

function assertAvailableWindow(win) {
  if (
    !win ||
    typeof win.isDestroyed !== 'function' ||
    win.isDestroyed() ||
    !win.webContents ||
    typeof win.webContents.capturePage !== 'function'
  ) {
    throw createError('window-unavailable', 'game window is unavailable');
  }
}

function safeProfileId(profileId) {
  return String(profileId || 'profile')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

async function saveImage(image, profileId, label) {
  const png = image.toPNG();
  const imageSize = readPngSize(png);
  const outputDir = path.join(app.getPath('userData'), 'automation-demo');
  captureSequence += 1;
  const filePath = path.join(
    outputDir,
    String(label || 'capture') +
      '-' +
      safeProfileId(profileId) +
      '-' +
      Date.now() +
      '-' +
      captureSequence +
      '.png'
  );

  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.writeFile(filePath, png);

  return {
    filePath: filePath,
    imageSize: imageSize
  };
}

async function capture(win, profileId) {
  if (!isEnabled()) {
    throw createError('debug-disabled', 'automation demo requires SHINOBI_DEBUG=1');
  }
  assertAvailableWindow(win);

  const image = await win.webContents.capturePage();
  const saved = await saveImage(image, profileId, 'capture');
  return {
    filePath: saved.filePath,
    imageSize: saved.imageSize,
    contentSize: getContentSize(win)
  };
}

function getCursorPoint() {
  if (!screen || typeof screen.getCursorScreenPoint !== 'function') return null;
  try {
    const point = screen.getCursorScreenPoint();
    if (
      !point ||
      typeof point.x !== 'number' ||
      !Number.isFinite(point.x) ||
      typeof point.y !== 'number' ||
      !Number.isFinite(point.y)
    ) {
      return null;
    }
    return { x: point.x, y: point.y };
  } catch (_) {
    return null;
  }
}

function isWindowFocused(win) {
  if (!win || typeof win.isFocused !== 'function') return null;
  try {
    return win.isFocused() === true;
  } catch (_) {
    return null;
  }
}

function pointsEqual(left, right) {
  if (!left || !right) return null;
  return left.x === right.x && left.y === right.y;
}

function compareImages(beforeImage, afterImage) {
  if (
    !beforeImage ||
    !afterImage ||
    typeof beforeImage.toBitmap !== 'function' ||
    typeof afterImage.toBitmap !== 'function'
  ) {
    return { available: false };
  }

  try {
    const before = beforeImage.toBitmap();
    const after = afterImage.toBitmap();
    if (
      !Buffer.isBuffer(before) ||
      !Buffer.isBuffer(after) ||
      before.length === 0 ||
      before.length !== after.length ||
      before.length % 4 !== 0
    ) {
      return { available: false };
    }

    let changedPixels = 0;
    for (let offset = 0; offset < before.length; offset += 4) {
      if (
        before[offset] !== after[offset] ||
        before[offset + 1] !== after[offset + 1] ||
        before[offset + 2] !== after[offset + 2] ||
        before[offset + 3] !== after[offset + 3]
      ) {
        changedPixels += 1;
      }
    }
    const totalPixels = before.length / 4;
    return {
      available: true,
      changedPixels: changedPixels,
      totalPixels: totalPixels,
      changedRatio: totalPixels > 0 ? changedPixels / totalPixels : 0
    };
  } catch (_) {
    return { available: false };
  }
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function getCdpDebugger(win) {
  const cdp = win && win.webContents ? win.webContents.debugger : null;
  if (
    !cdp ||
    typeof cdp.isAttached !== 'function' ||
    typeof cdp.attach !== 'function' ||
    typeof cdp.detach !== 'function' ||
    typeof cdp.sendCommand !== 'function'
  ) {
    throw createError('cdp-unavailable', 'webContents.debugger is unavailable');
  }
  if (cdp.isAttached()) {
    throw createError(
      'cdp-already-attached',
      'CDP is already attached; close the game DevTools and retry'
    );
  }
  return cdp;
}

async function dispatchCdpClick(cdp, point) {
  await cdp.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0
  });
  await cdp.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await cdp.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
}

function validateContentPoint(contentX, contentY, contentSize) {
  if (
    typeof contentX !== 'number' ||
    !Number.isFinite(contentX) ||
    typeof contentY !== 'number' ||
    !Number.isFinite(contentY)
  ) {
    throw createError(
      'invalid-content-coordinate-type',
      'content coordinates must be finite numbers',
      TypeError
    );
  }
  if (
    contentX < 0 ||
    contentX >= contentSize.width ||
    contentY < 0 ||
    contentY >= contentSize.height
  ) {
    throw createError(
      'content-coordinate-out-of-range',
      'content coordinates are outside the game content',
      RangeError
    );
  }
}

async function clickContent(win, contentX, contentY, options) {
  if (!isEnabled()) {
    throw createError('debug-disabled', 'automation demo requires SHINOBI_DEBUG=1');
  }
  assertAvailableWindow(win);

  const opts = options || {};
  const profileId = opts.profileId || 'profile';
  const settleDelayMs =
    typeof opts.settleDelayMs === 'number' && opts.settleDelayMs >= 0
      ? opts.settleDelayMs
      : DEFAULT_SETTLE_DELAY_MS;
  const contentSize = opts.contentSize || getContentSize(win);
  validateSize(contentSize, 'content');
  validateContentPoint(contentX, contentY, contentSize);
  const inputPoint = { x: Math.floor(contentX), y: Math.floor(contentY) };
  const beforeImage = await win.webContents.capturePage();
  const beforeCapture = await saveImage(beforeImage, profileId, 'cdp-before');
  const focusBefore = isWindowFocused(win);
  const cursorBefore = getCursorPoint();
  const cdp = getCdpDebugger(win);

  try {
    cdp.attach(CDP_PROTOCOL_VERSION);
  } catch (error) {
    throw createError(
      'cdp-attach-failed',
      error && error.message ? error.message : 'CDP attach failed'
    );
  }

  try {
    var dispatchedAt = Date.now();
    await dispatchCdpClick(cdp, inputPoint);
  } catch (error) {
    throw createError(
      'cdp-dispatch-failed',
      error && error.message ? error.message : 'CDP mouse dispatch failed'
    );
  } finally {
    if (cdp.isAttached()) {
      try {
        cdp.detach();
      } catch (_) {
        // The target may detach itself while the command is completing.
      }
    }
  }

  if (settleDelayMs > 0) await delay(settleDelayMs);

  const cursorAfter = getCursorPoint();
  const focusAfter = isWindowFocused(win);
  const afterImage = await win.webContents.capturePage();
  const afterCapture = await saveImage(afterImage, profileId, 'cdp-after');

  return {
    backend: 'cdp',
    protocolVersion: CDP_PROTOCOL_VERSION,
    dispatchedAt: dispatchedAt,
    imagePoint: opts.imagePoint || null,
    inputPoint: inputPoint,
    imageSize: opts.imageSize || null,
    contentSize: contentSize,
    evidence: {
      beforeFilePath: beforeCapture.filePath,
      afterFilePath: afterCapture.filePath,
      focusBefore: focusBefore,
      focusAfter: focusAfter,
      backgroundFocusPreserved: focusBefore === false && focusAfter === false,
      cursorBefore: cursorBefore,
      cursorAfter: cursorAfter,
      cursorPreserved: pointsEqual(cursorBefore, cursorAfter),
      visualChange: compareImages(beforeImage, afterImage)
    }
  };
}

async function click(win, imageSize, imageX, imageY, options) {
  if (!isEnabled()) {
    throw createError('debug-disabled', 'automation demo requires SHINOBI_DEBUG=1');
  }
  assertAvailableWindow(win);
  const contentSize = getContentSize(win);
  const inputPoint = mapImagePoint(imageX, imageY, imageSize, contentSize);
  const opts = Object.assign({}, options || {}, {
    contentSize: contentSize,
    imagePoint: { x: imageX, y: imageY },
    imageSize: { width: imageSize.width, height: imageSize.height }
  });
  return clickContent(win, inputPoint.x, inputPoint.y, opts);
}

module.exports = {
  isEnabled: isEnabled,
  mapImagePoint: mapImagePoint,
  normalizeImagePoint: normalizeImagePoint,
  mapNormalizedPoint: mapNormalizedPoint,
  compareImages: compareImages,
  getContentSize: getContentSize,
  capture: capture,
  clickContent: clickContent,
  click: click
};
