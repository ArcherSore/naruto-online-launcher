'use strict';

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const fixtures = require('../../../tests/helpers/automation-fixtures');
const { createAutomationService } = require('../index');
const visionFixtures = require('./vision-fixtures');

function target() {
  const debuggerApi = {
    isAttached: function () { return false; },
    attach: function () {},
    detach: function () {},
    sendCommand: function () { return Promise.resolve(); },
    on: function () {},
    removeListener: function () {}
  };
  const webContents = {
    isDestroyed: function () { return false; },
    debugger: debuggerApi,
    capturePage: function () {
      return Promise.resolve({
        toPNG: function () { return Buffer.from('png'); },
        getSize: function () { return { width: 400, height: 240 }; }
      });
    }
  };
  return {
    window: {
      isDestroyed: function () { return false; },
      isFocused: function () { return false; },
      isVisible: function () { return false; },
      isMinimized: function () { return false; },
      getContentSize: function () { return [400, 240]; },
      webContents: webContents
    },
    webContents: webContents,
    gameReady: true
  };
}

describe('automation service lifecycle cleanup', () => {
  afterEach(function () {
    fixtures.cleanupTempRoots();
  });

  test('cancels only an invalidated Profile and clears window/app lifecycle state', async () => {
    const appRoot = fixtures.createTempRoot('launcher-automation-service-');
    const userData = fixtures.createTempUserData();
    const scriptsRoot = path.join(appRoot, 'automation-scripts');
    fixtures.createScriptPackage(scriptsRoot, 'long-wait', {
      entrySource: "module.exports = async function (context) { await context.automation.wait(60000); };\n"
    });
    const profiles = new Map([
      ['p_aaaaaaaa', { id: 'p_aaaaaaaa' }],
      ['p_bbbbbbbb', { id: 'p_bbbbbbbb' }]
    ]);
    let profileChanged;
    let targetClosed;
    const service = createAutomationService({
      app: {
        getAppPath: function () { return appRoot; },
        getPath: function (name) { return name === 'userData' ? userData : appRoot; }
      },
      profileStore: {
        get: function (profileId) { return profiles.get(profileId) || null; },
        onChange: function (listener) { profileChanged = listener; }
      },
      launcher: {
        getAutomationTarget: function (profileId) { return profiles.has(profileId) ? target() : null; },
        onAutomationTargetClosed: function (listener) {
          targetClosed = listener;
          return function () {};
        }
      },
      logger: {
        createBoundLogger: function () {
          const noop = function () {};
          return { debug: noop, info: noop, warn: noop, error: noop };
        }
      }
    });

    const first = service.start('p_aaaaaaaa', 'long-wait');
    const second = service.start('p_bbbbbbbb', 'long-wait');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    profiles.delete('p_aaaaaaaa');
    profileChanged();
    await new Promise(function (resolve) { setImmediate(resolve); });
    expect(service.listStatuses()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        profileId: 'p_aaaaaaaa', status: 'failed',
        error: expect.objectContaining({ code: 'window-unavailable' })
      }),
      expect.objectContaining({ profileId: 'p_bbbbbbbb', status: 'running' })
    ]));

    targetClosed('p_bbbbbbbb');
    await new Promise(function (resolve) { setImmediate(resolve); });
    expect(service.status('p_bbbbbbbb', 'long-wait')).toEqual(expect.objectContaining({
      status: 'failed', error: expect.objectContaining({ code: 'window-unavailable' })
    }));
    await service.shutdown();
  });

  test('injects only the frozen Vision v1 surface without a GAME_READY gate', async () => {
    const appRoot = fixtures.createTempRoot('launcher-automation-service-vision-');
    const userData = fixtures.createTempUserData();
    const scriptsRoot = path.join(appRoot, 'automation-scripts');
    fixtures.createScriptPackage(scriptsRoot, 'context-check', {
      entrySource: [
        "module.exports = async function (context) {",
        "  var keys = Object.keys(context).sort().join(',');",
        "  var vision = context.vision;",
        "  if (keys !== 'automation,config,log,profileId,signal,vision') throw new Error(keys);",
        "  if (!Object.isFrozen(vision)) throw new Error('vision-not-frozen');",
        "  if (Object.keys(vision).sort().join(',') !== 'find,waitFor,waitUntilGone') throw new Error('vision-surface');",
        "};\n"
      ].join('\n')
    });
    const profile = { id: 'p_aaaaaaaa' };
    const gameTarget = target();
    gameTarget.gameReady = false;
    const service = createAutomationService({
      app: {
        getAppPath: function () { return appRoot; },
        getPath: function () { return userData; }
      },
      profileStore: {
        get: function (profileId) { return profileId === profile.id ? profile : null; },
        getAll: function () { return [profile]; }
      },
      launcher: {
        getAutomationTarget: function () { return gameTarget; },
        onAutomationTargetClosed: function () { return function () {}; }
      },
      logger: {
        createBoundLogger: function () {
          const noop = function () {};
          return Object.freeze({ debug: noop, info: noop, warn: noop, error: noop });
        }
      }
    });
    const started = service.start(profile.id, 'context-check');
    expect(started.ok).toBe(true);
    await new Promise(function (resolve) { setImmediate(resolve); });
    expect(service.status(profile.id, 'context-check').status).toBe('succeeded');
    await service.shutdown();
  });

  test('isolates a template failure while another Profile can find and click its own template', async () => {
    const appRoot = fixtures.createTempRoot('launcher-automation-service-isolation-');
    const userData = fixtures.createTempUserData();
    const scriptsRoot = path.join(appRoot, 'automation-scripts');
    fixtures.createScriptPackage(scriptsRoot, 'package-a', {
      manifest: { id: 'script-a' },
      entrySource: "module.exports = async function (context) { await context.vision.find('missing'); };\n"
    });
    const packageB = fixtures.createScriptPackage(scriptsRoot, 'package-b', {
      manifest: { id: 'script-b' },
      entrySource: [
        "module.exports = async function (context) {",
        "  var found = await context.vision.find('shared-target', { threshold: 1 });",
        "  if (!found) throw new Error('no-match');",
        "  await context.automation.click(found.center);",
        "};\n"
      ].join('\n')
    });
    const templateRoot = path.join(packageB, 'assets', 'vision');
    fs.mkdirSync(templateRoot, { recursive: true });
    const png = visionFixtures.encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
    fs.writeFileSync(path.join(templateRoot, 'shared-target.png'), png);
    const previousCreate = electron.nativeImage.createFromBuffer;
    electron.nativeImage.createFromBuffer = jest.fn(function () {
      return {
        isEmpty: function () { return false; },
        getSize: function () { return { width: 1, height: 1 }; },
        toBitmap: function () { return Buffer.from([1, 2, 3, 255]); }
      };
    });
    const clicks = { p_bbbbbbbb: 0 };

    function profileTarget(profileId) {
      const debuggerApi = {
        isAttached: function () { return false; }, attach: function () {}, detach: function () {},
        on: function () {}, removeListener: function () {},
        sendCommand: function () { if (profileId === 'p_bbbbbbbb') clicks.p_bbbbbbbb += 1; return Promise.resolve(); }
      };
      const webContents = {
        isDestroyed: function () { return false; }, debugger: debuggerApi,
        capturePage: function () {
          return Promise.resolve({
            toPNG: function () { return Buffer.from(png); },
            getSize: function () { return { width: 1, height: 1 }; }
          });
        }
      };
      return {
        window: {
          isDestroyed: function () { return false; }, isFocused: function () { return false; },
          isVisible: function () { return false; }, isMinimized: function () { return false; },
          getContentSize: function () { return [1, 1]; }
        },
        webContents: webContents,
        contentSize: { width: 1, height: 1 },
        gameReady: false
      };
    }

    const profiles = new Map([
      ['p_aaaaaaaa', { id: 'p_aaaaaaaa' }],
      ['p_bbbbbbbb', { id: 'p_bbbbbbbb' }]
    ]);
    const targets = new Map([
      ['p_aaaaaaaa', profileTarget('p_aaaaaaaa')],
      ['p_bbbbbbbb', profileTarget('p_bbbbbbbb')]
    ]);
    const service = createAutomationService({
      app: {
        getAppPath: function () { return appRoot; },
        getPath: function () { return userData; }
      },
      profileStore: {
        get: function (profileId) { return profiles.get(profileId) || null; },
        getAll: function () { return Array.from(profiles.values()); }
      },
      launcher: {
        getAutomationTarget: function (profileId) { return targets.get(profileId) || null; },
        onAutomationTargetClosed: function () { return function () {}; }
      },
      logger: {
        createBoundLogger: function () {
          const noop = function () {};
          return Object.freeze({ debug: noop, info: noop, warn: noop, error: noop });
        }
      }
    });
    try {
      const failed = service.start('p_aaaaaaaa', 'script-a');
      const succeeded = service.start('p_bbbbbbbb', 'script-b');
      expect(failed.ok).toBe(true);
      expect(succeeded.ok).toBe(true);
      await new Promise(function (resolve) { setTimeout(resolve, 30); });
      expect(service.status('p_aaaaaaaa', 'script-a')).toEqual(expect.objectContaining({
        status: 'failed', error: expect.objectContaining({ code: 'vision-template-not-found' })
      }));
      expect(service.status('p_bbbbbbbb', 'script-b').status).toBe('succeeded');
      expect(clicks.p_bbbbbbbb).toBe(3);
    } finally {
      await service.shutdown();
      if (previousCreate === undefined) delete electron.nativeImage.createFromBuffer;
      else electron.nativeImage.createFromBuffer = previousCreate;
    }
  });

  test('runs the in-launcher Vision acceptance check through the formal APIs and Profile lease', async () => {
    const appRoot = fixtures.createTempRoot('launcher-automation-service-manual-vision-');
    const userData = fixtures.createTempUserData();
    const scriptsRoot = path.join(appRoot, 'automation-scripts');
    const packageRoot = fixtures.createScriptPackage(scriptsRoot, 'package-directory', {
      manifest: { id: 'demo-click' }
    });
    const visionRoot = path.join(packageRoot, 'assets', 'vision');
    fs.mkdirSync(visionRoot, { recursive: true });
    const png = visionFixtures.encodePng(1, 1, Buffer.from([7, 8, 9, 255]));
    fs.writeFileSync(path.join(visionRoot, 'target.png'), png);
    const previousCreate = electron.nativeImage.createFromBuffer;
    electron.nativeImage.createFromBuffer = jest.fn(function () {
      return {
        isEmpty: function () { return false; },
        getSize: function () { return { width: 1, height: 1 }; },
        toBitmap: function () { return Buffer.from([7, 8, 9, 255]); }
      };
    });
    const events = [];
    const gameTarget = target();
    gameTarget.contentSize = { width: 1, height: 1 };
    gameTarget.window.getContentSize = function () { return [1, 1]; };
    gameTarget.webContents.capturePage = function () {
      return Promise.resolve({
        toPNG: function () { return Buffer.from(png); },
        getSize: function () { return { width: 1, height: 1 }; }
      });
    };
    gameTarget.webContents.debugger.sendCommand = function (method, payload) {
      events.push({ method: method, payload: payload });
      return Promise.resolve();
    };
    const profile = { id: 'p_aaaaaaaa' };
    const service = createAutomationService({
      app: {
        getAppPath: function () { return appRoot; },
        getPath: function () { return userData; }
      },
      profileStore: {
        get: function (profileId) { return profileId === profile.id ? profile : null; },
        getAll: function () { return [profile]; }
      },
      launcher: {
        getAutomationTarget: function () { return gameTarget; },
        onAutomationTargetClosed: function () { return function () {}; }
      },
      logger: {
        createBoundLogger: function () {
          const noop = function () {};
          return Object.freeze({ debug: noop, info: noop, warn: noop, error: noop });
        }
      }
    });
    try {
      expect(service.listVisionTemplates(profile.id, 'demo-click')).toEqual(['target']);
      const result = await service.testVision(profile.id, 'demo-click', {
        templateId: 'target',
        roi: { x: 0, y: 0, width: 1, height: 1 },
        threshold: 1,
        click: true
      });
      expect(result).toEqual({
        found: true,
        match: {
          rect: { x: 0, y: 0, width: 1, height: 1 },
          center: { normalizedX: 0.5, normalizedY: 0.5 },
          confidence: 1
        },
        clicked: true
      });
      expect(events).toHaveLength(3);
      expect(events.every(function (event) {
        return event.method === 'Input.dispatchMouseEvent' &&
          event.payload.x === 0 && event.payload.y === 0;
      })).toBe(true);
    } finally {
      await service.shutdown();
      if (previousCreate === undefined) delete electron.nativeImage.createFromBuffer;
      else electron.nativeImage.createFromBuffer = previousCreate;
    }
  });
});
