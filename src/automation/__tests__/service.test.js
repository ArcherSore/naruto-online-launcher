'use strict';

const path = require('path');
const fixtures = require('../../../tests/helpers/automation-fixtures');
const { createAutomationService } = require('../index');

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
});
