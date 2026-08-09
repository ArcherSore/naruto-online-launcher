'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function fail(message) {
  process.stderr.write('PACKAGED_AUTOMATION_SMOKE ' + JSON.stringify({ ok: false, error: message }) + '\n');
  process.exitCode = 1;
}

async function run() {
  const appPath = path.resolve(process.argv[2] || '');
  if (!appPath || !fs.existsSync(appPath)) throw new Error('packaged-app-missing');
  const automationRoot = path.join(appPath, 'automation-scripts');
  const sourceRoot = path.join(appPath, 'src', 'automation');
  const createRegistry = require(path.join(sourceRoot, 'registry')).createRegistry;
  const createAutomationStore = require(path.join(sourceRoot, 'store')).createAutomationStore;
  const createCoordinator = require(path.join(sourceRoot, 'coordinator')).createCoordinator;
  const createAutomationApi = require(path.join(sourceRoot, 'api')).createAutomationApi;
  const createRunner = require(path.join(sourceRoot, 'runner')).createRunner;
  const registry = createRegistry({ rootDir: automationRoot });
  registry.scan();
  const catalog = registry.list();
  if (catalog.length !== 1 || catalog[0].id !== 'demo-click') {
    throw new Error('packaged-catalog-mismatch');
  }

  const profileId = 'p_packagedsmoke';
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-packaged-automation-'));
  const clicks = [];
  const profileExists = function (candidate) { return candidate === profileId; };
  const coordinator = createCoordinator();
  const store = createAutomationStore({
    rootDir: dataRoot,
    profileExists: profileExists,
    scriptExists: function (scriptId) { return registry.has(scriptId); }
  });
  const backend = Object.freeze({
    capture: function () { throw new Error('not-used'); },
    getWindowState: function () {
      return Object.freeze({ available: true, gameReady: false, contentSize: { width: 400, height: 240 } });
    },
    click: function (_profileId, point) {
      clicks.push({ order: clicks.length + 1, normalizedX: point.normalizedX, at: Date.now() });
      return Promise.resolve(Object.freeze({ dispatchedAt: Date.now() }));
    }
  });
  const logger = Object.freeze({
    createBoundLogger: function () {
      const noop = function () {};
      return Object.freeze({ debug: noop, info: noop, warn: noop, error: noop });
    }
  });
  const runner = createRunner({
    registry: registry,
    store: store,
    coordinator: coordinator,
    profileExists: profileExists,
    targetAvailable: function () {
      return backend.getWindowState(profileId).available === true;
    },
    logger: logger,
    timeoutMs: 10000,
    createApi: function (runOptions) {
      return createAutomationApi(Object.assign({}, runOptions, {
        coordinator: coordinator,
        store: store,
        backend: backend,
        profileExists: profileExists
      }));
    }
  });

  try {
    store.setCoordinates(profileId, 'demo-click', [
      { order: 1, normalizedX: 0.25, normalizedY: 0.5 },
      { order: 2, normalizedX: 0.75, normalizedY: 0.5 }
    ]);
    const started = runner.start(profileId, 'demo-click');
    if (!started.ok) throw new Error(started.error || 'packaged-run-start-failed');
    await runner.waitForRun(started.status.runId);
    const status = runner.getStatus(profileId, 'demo-click');
    const intervalMs = clicks.length === 2 ? clicks[1].at - clicks[0].at : null;
    const ok = status.status === 'succeeded' && clicks.length === 2 &&
      clicks[0].order === 1 && clicks[1].order === 2 && intervalMs >= 850 && intervalMs <= 1500;
    process.stdout.write('PACKAGED_AUTOMATION_SMOKE ' + JSON.stringify({
      ok: ok,
      executable: path.basename(process.execPath),
      catalog: catalog,
      status: status.status,
      clickCount: clicks.length,
      intervalMs: intervalMs
    }) + '\n');
    if (!ok) process.exitCode = 1;
  } finally {
    await runner.shutdown();
    if (fs.existsSync(dataRoot)) fs.rmdirSync(dataRoot, { recursive: true });
  }
}

run().catch(function (error) {
  fail(error && error.message ? error.message : 'packaged-runtime-failed');
});
