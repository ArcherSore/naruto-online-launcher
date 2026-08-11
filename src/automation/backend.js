'use strict';

const { AutomationError } = require('./errors');
const { mapNormalizedPoint, validSize } = require('./coordinates');

function createAutomationBackend(options) {
  const opts = options || {};
  if (typeof opts.targetProvider !== 'function') throw new TypeError('targetProvider is required');
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const actionTimeoutMs =
    Number.isInteger(opts.actionTimeoutMs) && opts.actionTimeoutMs > 0
      ? opts.actionTimeoutMs
      : 10000;

  function resolveTarget(profileId) {
    let target;
    try {
      target = opts.targetProvider(profileId);
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('window-unavailable');
    }
    if (
      !target ||
      !target.window ||
      typeof target.window.isDestroyed !== 'function' ||
      target.window.isDestroyed() ||
      !target.webContents ||
      typeof target.webContents.isDestroyed !== 'function' ||
      target.webContents.isDestroyed()
    ) {
      throw new AutomationError('window-unavailable');
    }
    return target;
  }

  function readContentSize(target) {
    if (Object.prototype.hasOwnProperty.call(target, 'contentSize')) {
      if (validSize(target.contentSize)) {
        return Object.freeze({
          width: target.contentSize.width,
          height: target.contentSize.height
        });
      }
      throw new AutomationError('window-unavailable');
    }
    let raw;
    try {
      raw = target.window.getContentSize();
    } catch (_) {
      throw new AutomationError('window-unavailable');
    }
    const size = { width: raw && raw[0], height: raw && raw[1] };
    if (!validSize(size)) throw new AutomationError('window-unavailable');
    return Object.freeze(size);
  }

  function readCdpViewportSize(target) {
    let raw;
    try {
      raw = target.window.getContentSize();
    } catch (_) {
      throw new AutomationError('window-unavailable');
    }
    const size = { width: raw && raw[0], height: raw && raw[1] };
    if (!validSize(size)) throw new AutomationError('window-unavailable');
    return Object.freeze(size);
  }

  function mapContentPointToCdp(contentPoint, contentSize, cdpViewportSize) {
    if (
      contentSize.width === cdpViewportSize.width &&
      contentSize.height === cdpViewportSize.height
    ) {
      return contentPoint;
    }
    return Object.freeze({
      x: ((contentPoint.x + 0.5) * cdpViewportSize.width) / contentSize.width,
      y: ((contentPoint.y + 0.5) * cdpViewportSize.height) / contentSize.height
    });
  }

  function getWindowState(profileId) {
    let target;
    try {
      target = resolveTarget(profileId);
    } catch (_) {
      return Object.freeze({
        available: false,
        gameReady: false,
        focused: false,
        visible: false,
        minimized: false,
        contentSize: null,
        capturedAt: now()
      });
    }
    let contentSize = null;
    try {
      contentSize = readContentSize(target);
    } catch (_) {
      contentSize = null;
    }
    return Object.freeze({
      available: true,
      gameReady: target.gameReady === true,
      focused: target.window.isFocused() === true,
      visible: target.window.isVisible() === true,
      minimized: target.window.isMinimized() === true,
      contentSize: contentSize,
      capturedAt: now()
    });
  }

  async function captureImage(profileId) {
    const target = resolveTarget(profileId);
    const contentSize = readContentSize(target);
    try {
      const image = typeof opts.imageProvider === 'function'
        ? await opts.imageProvider(target, profileId)
        : await target.webContents.capturePage();
      const currentTarget = resolveTarget(profileId);
      const currentContentSize = readContentSize(currentTarget);
      if (
        currentTarget.window !== target.window ||
        currentTarget.webContents !== target.webContents ||
        currentContentSize.width !== contentSize.width ||
        currentContentSize.height !== contentSize.height
      ) {
        throw new Error('capture-target-changed');
      }
      if (!image || typeof image.toPNG !== 'function' || typeof image.getSize !== 'function') {
        throw new Error('invalid-image');
      }
      const imageSize = image.getSize();
      if (!validSize(imageSize)) throw new Error('invalid-image-size');
      return Object.freeze({
        image: image,
        imageSize: Object.freeze({ width: imageSize.width, height: imageSize.height }),
        contentSize: contentSize,
        capturedAt: now()
      });
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('capture-failed');
    }
  }

  async function capture(profileId) {
    try {
      const frame = await captureImage(profileId);
      const png = frame.image.toPNG();
      if (!Buffer.isBuffer(png)) throw new Error('invalid-png');
      return Object.freeze({
        png: Buffer.from(png),
        imageSize: frame.imageSize,
        contentSize: frame.contentSize,
        capturedAt: frame.capturedAt
      });
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('capture-failed');
    }
  }

  async function click(profileId, normalizedPoint) {
    const target = resolveTarget(profileId);
    const contentSize = readContentSize(target);
    const contentPoint = mapNormalizedPoint(normalizedPoint, contentSize);
    const cdpPoint = mapContentPointToCdp(
      contentPoint,
      contentSize,
      readCdpViewportSize(target)
    );
    const cdp = target.webContents.debugger;
    if (
      !cdp ||
      typeof cdp.isAttached !== 'function' ||
      typeof cdp.attach !== 'function' ||
      typeof cdp.detach !== 'function' ||
      typeof cdp.sendCommand !== 'function'
    ) {
      throw new AutomationError('cdp-unavailable');
    }
    if (cdp.isAttached()) throw new AutomationError('cdp-already-attached');

    let owned = false;
    let timer = null;
    let detachListener = null;
    let actionError = null;
    let result = null;
    try {
      try {
        cdp.attach('1.3');
        owned = true;
      } catch (_) {
        throw new AutomationError('cdp-attach-failed');
      }
      let detached = false;
      const unexpectedDetach = new Promise(function (_resolve, reject) {
        if (typeof cdp.on !== 'function') return;
        detachListener = function () {
          detached = true;
          reject(new AutomationError('cdp-detached'));
        };
        cdp.on('detach', detachListener);
      });
      const timeout = new Promise(function (_resolve, reject) {
        timer = setTimeout(function () {
          reject(new AutomationError('action-timeout'));
        }, actionTimeoutMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      });
      const events = [
        { type: 'mouseMoved', button: 'none', buttons: 0 },
        { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
        { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 }
      ];
      const dispatch = (async function () {
        for (let index = 0; index < events.length; index++) {
          if (detached) throw new AutomationError('cdp-detached');
          await cdp.sendCommand(
            'Input.dispatchMouseEvent',
            Object.assign({ x: cdpPoint.x, y: cdpPoint.y }, events[index])
          );
        }
      })();
      await Promise.race([dispatch, timeout, unexpectedDetach]);
      result = Object.freeze({ dispatchedAt: now(), contentPoint: contentPoint });
    } catch (error) {
      if (error instanceof AutomationError) {
        actionError = error;
      } else {
        try {
          resolveTarget(profileId);
          actionError = new AutomationError('cdp-dispatch-failed');
        } catch (targetError) {
          actionError =
            targetError instanceof AutomationError
              ? targetError
              : new AutomationError('window-unavailable');
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (detachListener && typeof cdp.removeListener === 'function') {
        cdp.removeListener('detach', detachListener);
      }
      if (owned) {
        try {
          cdp.detach();
        } catch (_) {
          if (!actionError) actionError = new AutomationError('cdp-detached');
        }
      }
    }
    if (actionError) throw actionError;
    return result;
  }

  return Object.freeze({
    getWindowState: getWindowState,
    captureImage: captureImage,
    capture: capture,
    click: click
  });
}

module.exports = {
  createAutomationBackend: createAutomationBackend,
  mapNormalizedPoint: mapNormalizedPoint,
  validSize: validSize
};
