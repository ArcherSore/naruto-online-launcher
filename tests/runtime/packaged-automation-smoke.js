'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, nativeImage } = require('electron');

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
  const createVisionCodec = require(path.join(sourceRoot, 'vision', 'codec')).createVisionCodec;
  const createVisionTemplateLoader = require(path.join(sourceRoot, 'vision', 'template-loader')).createVisionTemplateLoader;
  const createVisionMatcher = require(path.join(sourceRoot, 'vision', 'matcher')).createVisionMatcher;
  const createVisionApi = require(path.join(sourceRoot, 'vision', 'api')).createVisionApi;
  const registry = createRegistry({ rootDir: automationRoot });
  registry.scan();
  const catalog = registry.list();
  if (catalog.length !== 1 || catalog[0].id !== 'daily-reward') {
    throw new Error('packaged-catalog-mismatch');
  }

  const profileId = 'p_packagedsmoke';
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-packaged-automation-'));
  const clicks = [];
  const profileExists = function (candidate) { return candidate === profileId; };
  const coordinator = createCoordinator();
  const visionCodec = createVisionCodec();
  const visionLoader = createVisionTemplateLoader({ registry: registry, codec: visionCodec });
  const visionMatcher = createVisionMatcher();
  const templatePng = fs.readFileSync(path.join(
    automationRoot,
    'demo',
    'assets',
    'vision',
    'entry-activity.png'
  ));
  const templateImage = nativeImage.createFromBuffer(templatePng);
  const templateSize = templateImage.getSize();
  let visionResult = null;
  const demoRecord = registry.get('daily-reward');
  const runnerRegistry = Object.freeze({
    get: function (scriptId) {
      if (scriptId !== 'daily-reward') return registry.get(scriptId);
      return Object.freeze(Object.assign({}, demoRecord, {
        run: async function (context) {
          visionResult = await context.vision.find('entry-activity', { threshold: 1 });
          if (!visionResult) throw new Error('packaged-vision-no-match');
          await context.automation.click(visionResult.center);
        }
      }));
    }
  });
  const store = createAutomationStore({
    rootDir: dataRoot,
    profileExists: profileExists,
    scriptExists: function (scriptId) { return registry.has(scriptId); }
  });
  const backend = Object.freeze({
    capture: function () {
      return Promise.resolve(Object.freeze({
        png: Buffer.from(templatePng),
        imageSize: Object.freeze({ width: templateSize.width, height: templateSize.height }),
        contentSize: Object.freeze({ width: templateSize.width, height: templateSize.height }),
        capturedAt: Date.now()
      }));
    },
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
    registry: runnerRegistry,
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
    },
    createVision: function (runOptions) {
      return createVisionApi(Object.assign({}, runOptions, {
        coordinator: coordinator,
        backend: backend,
        loader: visionLoader,
        codec: visionCodec,
        matcher: visionMatcher,
        profileExists: profileExists
      }));
    }
  });

  try {
    const started = runner.start(profileId, 'daily-reward');
    if (!started.ok) throw new Error(started.error || 'packaged-run-start-failed');
    await runner.waitForRun(started.status.runId);
    const status = runner.getStatus(profileId, 'daily-reward');
    const ok = status.status === 'succeeded' && clicks.length === 1 && clicks[0].order === 1 &&
      visionResult && visionResult.rect.x === 0 && visionResult.rect.y === 0 &&
      visionResult.rect.width === templateSize.width && visionResult.rect.height === templateSize.height &&
      visionResult.confidence === 1 &&
      clicks[0].normalizedX === visionResult.center.normalizedX;
    process.stdout.write('PACKAGED_AUTOMATION_SMOKE ' + JSON.stringify({
      ok: ok,
      executable: path.basename(process.execPath),
      catalog: catalog,
      status: status.status,
      clickCount: clicks.length,
      intervalMs: null,
      vision: visionResult
    }) + '\n');
    if (!ok) process.exitCode = 1;
  } finally {
    await runner.shutdown();
    if (fs.existsSync(dataRoot)) fs.rmdirSync(dataRoot, { recursive: true });
  }

  app.exit(process.exitCode || 0);
}

run().catch(function (error) {
  fail(error && error.message ? error.message : 'packaged-runtime-failed');
  app.exit(1);
});
