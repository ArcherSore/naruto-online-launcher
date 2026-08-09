'use strict';

const { AutomationError } = require('./errors');

function validSize(size) {
  return !!(
    size &&
    Number.isInteger(size.width) &&
    size.width > 0 &&
    Number.isInteger(size.height) &&
    size.height > 0
  );
}

function mapNormalizedPoint(point, contentSize) {
  if (
    !point ||
    !Number.isFinite(point.normalizedX) ||
    !Number.isFinite(point.normalizedY) ||
    point.normalizedX < 0 ||
    point.normalizedX >= 1 ||
    point.normalizedY < 0 ||
    point.normalizedY >= 1
  ) {
    throw new AutomationError('coordinates-invalid');
  }
  if (!validSize(contentSize)) throw new AutomationError('window-unavailable');
  return Object.freeze({
    x: Math.min(contentSize.width - 1, Math.floor(point.normalizedX * contentSize.width)),
    y: Math.min(contentSize.height - 1, Math.floor(point.normalizedY * contentSize.height))
  });
}

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

  async function capture(profileId) {
    const target = resolveTarget(profileId);
    const contentSize = readContentSize(target);
    try {
      const image = await target.webContents.capturePage();
      resolveTarget(profileId);
      if (!image || typeof image.toPNG !== 'function' || typeof image.getSize !== 'function') {
        throw new Error('invalid-image');
      }
      const imageSize = image.getSize();
      if (!validSize(imageSize)) throw new Error('invalid-image-size');
      const png = image.toPNG();
      if (!Buffer.isBuffer(png)) throw new Error('invalid-png');
      return Object.freeze({
        png: Buffer.from(png),
        imageSize: Object.freeze({ width: imageSize.width, height: imageSize.height }),
        contentSize: contentSize,
        capturedAt: now()
      });
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      throw new AutomationError('capture-failed');
    }
  }

  async function click(profileId, normalizedPoint) {
    const target = resolveTarget(profileId);
    const point = mapNormalizedPoint(normalizedPoint, readContentSize(target));
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
            Object.assign({ x: point.x, y: point.y }, events[index])
          );
        }
      })();
      await Promise.race([dispatch, timeout, unexpectedDetach]);
      result = Object.freeze({ dispatchedAt: now(), contentPoint: point });
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
    capture: capture,
    click: click
  });
}

module.exports = {
  createAutomationBackend: createAutomationBackend,
  mapNormalizedPoint: mapNormalizedPoint,
  validSize: validSize
};
