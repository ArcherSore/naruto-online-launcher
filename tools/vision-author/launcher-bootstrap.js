'use strict';

const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { createBridgeServer } = require('./bridge/server');

function cleanChildEnv(source) {
  const result = Object.assign({}, source || {});
  delete result.NODE_OPTIONS;
  delete result.VISION_AUTHOR_BOOTSTRAP;
  delete result.VISION_AUTHOR_PIPE;
  delete result.VISION_AUTHOR_TOKEN;
  return result;
}

function validateDeveloperEnvironment(options) {
  const opts = options || {};
  const app = opts.app;
  const processObject = opts.processObject || process;
  const repoRoot = path.resolve(opts.repoRoot || path.join(__dirname, '..', '..'));
  if (!app || app.isPackaged === true) return { ok: false, code: 'packaged' };
  if (processObject.type !== 'browser') return { ok: false, code: 'non-browser' };
  if (processObject.defaultApp !== true) return { ok: false, code: 'not-default-app' };
  let appPath;
  try { appPath = path.resolve(app.getAppPath()); } catch (_) { return { ok: false, code: 'app-path' }; }
  if (appPath.toLowerCase() !== repoRoot.toLowerCase()) return { ok: false, code: 'wrong-repo' };
  if (path.resolve(__dirname, '..', '..').toLowerCase() !== repoRoot.toLowerCase()) {
    return { ok: false, code: 'wrong-bootstrap' };
  }
  return { ok: true, repoRoot: repoRoot };
}

function makePipeName(processObject) {
  const source = processObject || process;
  return '\\\\.\\pipe\\naruto-vision-author-' + source.pid + '-' + crypto.randomBytes(16).toString('hex');
}

function initializeDefaultRuntime(repoRoot) {
  const electron = require('electron');
  const profileStore = require(path.join(repoRoot, 'src', 'profiles', 'store'));
  const launcher = require(path.join(repoRoot, 'src', 'app', 'Launcher'));
  const { createAutomationBackend } = require(path.join(repoRoot, 'src', 'automation', 'backend'));
  const { createRegistry } = require(path.join(repoRoot, 'src', 'automation', 'registry'));
  const { createVisionCodec } = require(path.join(repoRoot, 'src', 'automation', 'vision', 'codec'));
  const { createBridgeSession } = require(path.join(repoRoot, 'tools', 'vision-author', 'bridge', 'session'));
  const { createAuthorCatalog } = require(path.join(repoRoot, 'tools', 'vision-author', 'bridge', 'catalog'));
  const { createTemplateWriter } = require(path.join(repoRoot, 'tools', 'vision-author', 'bridge', 'template-writer'));
  const { createDesktopCaptureProvider } = require(path.join(repoRoot, 'tools', 'vision-author', 'bridge', 'desktop-capture'));
  const registry = createRegistry({ app: electron.app });
  registry.scan();
  const backend = createAutomationBackend({
    targetProvider: launcher.getAutomationTarget,
    imageProvider: createDesktopCaptureProvider({ desktopCapturer: electron.desktopCapturer })
  });
  const catalog = createAuthorCatalog({ registry: registry, repoRoot: repoRoot });
  const writer = createTemplateWriter({ catalog: catalog, repoRoot: repoRoot });
  const session = createBridgeSession({
    profileStore: profileStore,
    backend: backend,
    codec: createVisionCodec(),
    catalog: catalog,
    writer: writer
  });
  return {
    app: electron.app,
    profileStore: profileStore,
    launcher: launcher,
    backend: backend,
    registry: registry,
    catalog: catalog,
    writer: writer,
    session: session,
    dispatch: session.dispatch,
    close: session.close
  };
}

function spawnDefaultAuthor(options) {
  const opts = options || {};
  const env = cleanChildEnv(opts.processObject.env);
  env.VISION_AUTHOR_PIPE = opts.pipeName;
  env.VISION_AUTHOR_TOKEN = opts.token;
  const spawn = opts.spawn || childProcess.spawn;
  return spawn(opts.processObject.execPath, [path.join(opts.repoRoot, 'tools', 'vision-author', 'app', 'main.js')], {
    cwd: opts.repoRoot,
    env: env,
    stdio: 'inherit',
    windowsHide: false
  });
}

function createLauncherBootstrap(options) {
  const opts = options || {};
  const app = opts.app;
  const processObject = opts.processObject || process;
  const repoRoot = path.resolve(opts.repoRoot || path.join(__dirname, '..', '..'));
  const defer = typeof opts.defer === 'function' ? opts.defer : setImmediate;
  const environment = validateDeveloperEnvironment({
    app: app,
    processObject: processObject,
    repoRoot: repoRoot
  });
  let installed = false;
  let starting = false;
  let closed = false;
  let runtime = null;
  let server = null;
  let child = null;

  function cleanup() {
    if (closed) return Promise.resolve();
    closed = true;
    const currentChild = child;
    child = null;
    if (currentChild && typeof currentChild.kill === 'function') {
      try { currentChild.kill(); } catch (_) { /* child already exited */ }
    }
    const operations = [];
    if (server && typeof server.close === 'function') {
      try { operations.push(Promise.resolve(server.close())); } catch (_) { /* server already closed */ }
    }
    if (runtime && typeof runtime.close === 'function') {
      try { operations.push(Promise.resolve(runtime.close())); } catch (_) { /* runtime already closed */ }
    }
    server = null;
    runtime = null;
    return Promise.all(operations).then(function () {});
  }

  function start() {
    if (starting || closed || !environment.ok) return Promise.resolve(false);
    starting = true;
    const initializeRuntime = opts.initializeRuntime || function () {
      return initializeDefaultRuntime(repoRoot);
    };
    try {
      runtime = initializeRuntime(repoRoot);
      const pipeName = opts.pipeName || makePipeName(processObject);
      const token = opts.token || crypto.randomBytes(32).toString('hex');
      const createServer = opts.createServer || function (serverOptions) {
        return createBridgeServer(serverOptions);
      };
      server = createServer({
        pipeName: pipeName,
        token: token,
        dispatch: runtime.dispatch,
        onDisconnect: function () { cleanup(); }
      });
      return Promise.resolve(server.start()).then(function () {
        if (closed) return false;
        const spawnAuthor = opts.spawnAuthor || spawnDefaultAuthor;
        child = spawnAuthor({
          repoRoot: repoRoot,
          pipeName: pipeName,
          token: token,
          processObject: processObject
        });
        if (!child || typeof child.once !== 'function') throw new Error('child-start-failed');
        child.once('exit', function () {
          child = null;
          cleanup();
        });
        child.once('error', function () { cleanup(); });
        return true;
      }).catch(function () {
        return cleanup().then(function () { return false; });
      });
    } catch (_) {
      return cleanup().then(function () { return false; });
    }
  }

  function install() {
    if (installed || !environment.ok || !app || typeof app.once !== 'function') return false;
    installed = true;
    app.once('ready', function () { defer(function () { start(); }); });
    app.on('before-quit', function () { cleanup(); });
    return true;
  }

  return Object.freeze({ install: install, start: start, close: cleanup, environment: environment });
}

module.exports = {
  cleanChildEnv: cleanChildEnv,
  createLauncherBootstrap: createLauncherBootstrap,
  initializeDefaultRuntime: initializeDefaultRuntime,
  makePipeName: makePipeName,
  spawnDefaultAuthor: spawnDefaultAuthor,
  validateDeveloperEnvironment: validateDeveloperEnvironment
};
