'use strict';

const { createAutomationApi } = require('../api');
const { createAutomationBackend } = require('../backend');
const { createCancellationController } = require('../cancellation');
const { createCoordinator } = require('../coordinator');
const { createVisionApi } = require('../vision/api');
const { createVisionMatcher } = require('../vision/matcher');
const fixtures = require('./vision-fixtures');

describe('Vision screenshot pixel to CDP coordinate chain', () => {
  test('rejects a captured PNG when the same profile target is replaced during capture', async () => {
    const pending = fixtures.deferred();
    function target(label, capturePage) {
      return {
        label: label,
        window: {
          isDestroyed: function () { return false; },
          getContentSize: function () { return [1920, 1080]; },
          isFocused: function () { return false; },
          isVisible: function () { return true; },
          isMinimized: function () { return false; }
        },
        webContents: {
          isDestroyed: function () { return false; },
          capturePage: jest.fn(capturePage)
        },
        contentSize: { width: 1920, height: 1080 }
      };
    }
    const oldTarget = target('old', function () { return pending.promise; });
    const newTarget = target('new', async function () {
      throw new Error('new target must not be captured');
    });
    let currentTarget = oldTarget;
    const backend = createAutomationBackend({ targetProvider: function () { return currentTarget; } });
    const operation = backend.capture('p_aaaaaaaa');
    currentTarget = newTarget;
    pending.resolve({
      toPNG: function () { return Buffer.from('old-png'); },
      getSize: function () { return { width: 1920, height: 1080 }; }
    });

    await expect(operation).rejects.toMatchObject({ code: 'capture-failed' });
    expect(newTarget.webContents.capturePage).not.toHaveBeenCalled();
  });

  test('rejects a captured PNG when canonical contentSize changes during capture', async () => {
    const pending = fixtures.deferred();
    let contentSize = { width: 1920, height: 1080 };
    const window = {
      isDestroyed: function () { return false; },
      getContentSize: function () { return [1920, 1080]; },
      isFocused: function () { return false; },
      isVisible: function () { return true; },
      isMinimized: function () { return false; }
    };
    const webContents = {
      isDestroyed: function () { return false; },
      capturePage: function () { return pending.promise; }
    };
    const backend = createAutomationBackend({
      targetProvider: function () {
        return { window: window, webContents: webContents, contentSize: contentSize };
      }
    });
    const operation = backend.capture('p_aaaaaaaa');
    contentSize = { width: 960, height: 540 };
    pending.resolve({
      toPNG: function () { return Buffer.from('stale-png'); },
      getSize: function () { return { width: 1920, height: 1080 }; }
    });
    await expect(operation).rejects.toMatchObject({ code: 'capture-failed' });
  });

  test('keeps image/content/DIP spaces separate and clicks the float-sensitive midpoint', async () => {
    const imageSize = { width: 3840, height: 2160 };
    const contentSize = { width: 1920, height: 1080 };
    const bitmap = fixtures.rgba(imageSize.width, imageSize.height);
    const rect = { x: 244, y: 76, width: 4, height: 4 };
    fixtures.paint(bitmap, imageSize, rect, [9, 8, 7, 255]);
    const template = { width: 4, height: 4, bitmap: fixtures.rgba(4, 4, [9, 8, 7, 255]) };
    const commands = [];
    let contractValid = true;
    const cdp = {
      isAttached: function () { return false; },
      attach: function () {},
      detach: function () {},
      on: function () {},
      removeListener: function () {},
      sendCommand: jest.fn(async function (_method, params) { commands.push(params); })
    };
    const target = {
      window: {
        isDestroyed: function () { return false; },
        getContentSize: function () { return [960, 540]; },
        isFocused: function () { return false; },
        isVisible: function () { return true; },
        isMinimized: function () { return false; }
      },
      webContents: {
        isDestroyed: function () { return false; },
        capturePage: async function () {
          return { toPNG: function () { return Buffer.from('captured'); }, getSize: function () { return imageSize; } };
        },
        debugger: cdp
      },
      get contentSize() { return contractValid ? contentSize : null; }
    };
    const backend = createAutomationBackend({ targetProvider: function () { return target; } });
    const coordinator = createCoordinator();
    const acquired = coordinator.tryAcquire('p_aaaaaaaa', 'run-1');
    const controller = createCancellationController();
    const common = {
      profileId: 'p_aaaaaaaa', scriptId: 'script-a', lease: acquired.lease,
      signal: controller.signal, deadlineAt: Date.now() + 10000,
      coordinator: coordinator, profileExists: function () { return true; }, backend: backend
    };
    const vision = createVisionApi(Object.assign({}, common, {
      loader: { load: function () { return template; } },
      codec: {
        decodeCapture: function (capture) {
          return { bitmap: bitmap, imageSize: capture.imageSize, contentSize: capture.contentSize, capturedAt: capture.capturedAt };
        }
      },
      matcher: createVisionMatcher({ slicePixels: 8 })
    }));
    const automation = createAutomationApi(Object.assign({}, common, {
      store: { getCoordinates: function () { return []; } }
    }));

    const found = await vision.find('target', { roi: rect, threshold: 1 });
    await automation.click(found.center);
    expect(commands).toHaveLength(3);
    commands.forEach(function (params) {
      expect({ x: params.x, y: params.y }).toEqual({ x: 61.75, y: 19.75 });
    });

    contractValid = false;
    await expect(automation.click(found.center)).rejects.toMatchObject({ code: 'window-unavailable' });
    expect(commands).toHaveLength(3);
  });
});
