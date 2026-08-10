'use strict';

const EventEmitter = require('events');
const path = require('path');

function createApp(repoRoot) {
  const app = new EventEmitter();
  app.isPackaged = false;
  app.getAppPath = jest.fn(() => repoRoot);
  app.quit = jest.fn();
  return app;
}

describe('Vision Author developer bootstrap', () => {
  test.each([
    ['packaged', { isPackaged: true }],
    ['non-browser', { processType: 'renderer' }],
    ['not-default-app', { defaultApp: false }],
    ['wrong-repo', { appPath: 'D:\\other-repo' }]
  ])('fails closed for %s environment', (_label, override) => {
    const bootstrap = require('../launcher-bootstrap');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const app = createApp(repoRoot);
    if (override.isPackaged !== undefined) app.isPackaged = override.isPackaged;
    if (override.appPath) app.getAppPath.mockReturnValue(override.appPath);
    const processObject = {
      type: override.processType || 'browser',
      defaultApp: override.defaultApp === undefined ? true : override.defaultApp
    };
    const result = bootstrap.validateDeveloperEnvironment({
      app: app,
      processObject: processObject,
      repoRoot: repoRoot
    });
    expect(result.ok).toBe(false);
  });

  test('waits until all ready listeners finish synchronous initialization before pipe and child start', () => {
    const bootstrap = require('../launcher-bootstrap');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const app = createApp(repoRoot);
    const deferredCallbacks = [];
    const events = [];
    const controller = bootstrap.createLauncherBootstrap({
      app: app,
      processObject: { type: 'browser', defaultApp: true, env: {} },
      repoRoot: repoRoot,
      defer: callback => deferredCallbacks.push(callback),
      initializeRuntime: function () { events.push('runtime-ready'); return { close: jest.fn() }; },
      createServer: function () { events.push('server-created'); return { start: async () => events.push('server-started'), close: jest.fn() }; },
      spawnAuthor: function () { events.push('child-started'); return Object.assign(new EventEmitter(), { kill: jest.fn() }); }
    });
    controller.install();
    app.on('ready', function () { events.push('formal-ready-listener'); });

    app.emit('ready');
    expect(events).toEqual(['formal-ready-listener']);
    expect(deferredCallbacks).toHaveLength(1);
    deferredCallbacks[0]();
    return Promise.resolve().then(function () {
      expect(events).toEqual([
        'formal-ready-listener',
        'runtime-ready',
        'server-created',
        'server-started',
        'child-started'
      ]);
    });
  });

  test('no ready event means single-instance failure creates no pipe or child', () => {
    const bootstrap = require('../launcher-bootstrap');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const app = createApp(repoRoot);
    const createServer = jest.fn();
    const spawnAuthor = jest.fn();
    const controller = bootstrap.createLauncherBootstrap({
      app: app,
      processObject: { type: 'browser', defaultApp: true, env: {} },
      repoRoot: repoRoot,
      createServer: createServer,
      spawnAuthor: spawnAuthor
    });
    controller.install();
    app.quit();
    expect(createServer).not.toHaveBeenCalled();
    expect(spawnAuthor).not.toHaveBeenCalled();
  });

  test('cleans bootstrap secrets/options from child env and couples both lifecycles', async () => {
    const bootstrap = require('../launcher-bootstrap');
    expect(bootstrap.cleanChildEnv({
      NODE_OPTIONS: '--require secret.js',
      VISION_AUTHOR_BOOTSTRAP: '1',
      SAFE: 'yes'
    })).toEqual({ SAFE: 'yes' });

    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const app = createApp(repoRoot);
    const deferredCallbacks = [];
    const server = { start: jest.fn(async () => {}), close: jest.fn(async () => {}) };
    const runtime = { close: jest.fn() };
    const child = Object.assign(new EventEmitter(), { kill: jest.fn() });
    const controller = bootstrap.createLauncherBootstrap({
      app: app,
      processObject: { type: 'browser', defaultApp: true, env: {} },
      repoRoot: repoRoot,
      defer: callback => deferredCallbacks.push(callback),
      initializeRuntime: () => runtime,
      createServer: () => server,
      spawnAuthor: () => child
    });
    controller.install();
    app.emit('ready');
    deferredCallbacks[0]();
    await Promise.resolve();

    child.emit('exit', 0);
    await Promise.resolve();
    expect(server.close).toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalled();

    app.emit('before-quit');
    expect(child.kill).not.toHaveBeenCalled();
  });

  test('pipe startup failure launches no child and clears runtime state once', async () => {
    const bootstrap = require('../launcher-bootstrap');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const app = createApp(repoRoot);
    const runtime = { close: jest.fn() };
    const spawnAuthor = jest.fn();
    const controller = bootstrap.createLauncherBootstrap({
      app: app,
      processObject: { type: 'browser', defaultApp: true, env: {} },
      repoRoot: repoRoot,
      initializeRuntime: function () { return runtime; },
      createServer: function () {
        return { start: jest.fn(async function () { throw new Error('raw pipe failure'); }), close: jest.fn() };
      },
      spawnAuthor: spawnAuthor
    });
    expect(await controller.start()).toBe(false);
    expect(spawnAuthor).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});
