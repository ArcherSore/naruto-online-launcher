'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRegistry } = require('../../src/automation/registry');
const { createAutomationStore } = require('../../src/automation/store');
const { createCoordinator } = require('../../src/automation/coordinator');
const { createAutomationBackend } = require('../../src/automation/backend');
const { createAutomationApi } = require('../../src/automation/api');
const { createRunner } = require('../../src/automation/runner');
const { createVisionCodec } = require('../../src/automation/vision/codec');
const { createVisionTemplateLoader } = require('../../src/automation/vision/template-loader');
const { createVisionMatcher } = require('../../src/automation/vision/matcher');
const { createVisionApi } = require('../../src/automation/vision/api');

function noop() {}

function createRuntime(options) {
  const opts = options || {};
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-automation-runtime-'));
  const scriptsRoot = path.join(__dirname, '..', '..', 'automation-scripts');
  const registry = createRegistry({ rootDir: scriptsRoot });
  registry.scan();
  if (!registry.has('demo-click')) throw new Error('demo-click was not registered');

  const profileExists = function (profileId) { return profileId === opts.profileId; };
  const coordinator = createCoordinator();
  const visionCodec = createVisionCodec();
  const visionLoader = createVisionTemplateLoader({ registry: registry, codec: visionCodec });
  const visionMatcher = createVisionMatcher();
  let runOverride = null;
  const runnerRegistry = Object.freeze({
    get: function (scriptId) {
      const record = registry.get(scriptId);
      if (!record || !runOverride) return record;
      return Object.freeze(Object.assign({}, record, { run: runOverride }));
    }
  });
  const store = createAutomationStore({
    rootDir: rootDir,
    profileExists: profileExists,
    scriptExists: function (scriptId) { return registry.has(scriptId); }
  });
  const backend = createAutomationBackend({
    targetProvider: function (profileId) {
      if (!profileExists(profileId) || opts.window.isDestroyed()) return null;
      return { window: opts.window, webContents: opts.window.webContents, gameReady: false };
    },
    actionTimeoutMs: opts.actionTimeoutMs || 10000
  });
  const runner = createRunner({
    registry: runnerRegistry,
    store: store,
    coordinator: coordinator,
    timeoutMs: opts.timeoutMs || 15000,
    profileExists: profileExists,
    targetAvailable: function (profileId) {
      return backend.getWindowState(profileId).available === true;
    },
    logger: {
      createBoundLogger: function () {
        return Object.freeze({ debug: noop, info: noop, warn: noop, error: noop });
      }
    },
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

  async function finishRun(started) {
    if (!started.ok) throw new Error('run start failed: ' + started.error);
    await runner.waitForRun(started.status.runId);
    const status = runner.getStatus(opts.profileId, 'demo-click');
    if (status.status !== 'succeeded') {
      throw new Error('run failed: ' + (status.error ? status.error.code : status.status));
    }
    return status;
  }

  return Object.freeze({
    registry: registry,
    store: store,
    runner: runner,
    runDemo: async function (points, config) {
      runOverride = null;
      store.setCoordinates(opts.profileId, 'demo-click', points);
      store.setConfig(opts.profileId, 'demo-click', config || {});
      return finishRun(runner.start(opts.profileId, 'demo-click'));
    },
    runVisionClick: async function (visionOptions) {
      const call = visionOptions || {};
      let result = null;
      runOverride = async function (context) {
        result = await context.vision.find(call.templateId || 'sample-target', {
          roi: call.roi,
          threshold: call.threshold === undefined ? 0.99 : call.threshold
        });
        if (!result) throw new Error('vision-no-match');
        await context.automation.click(result.center);
      };
      try {
        const status = await finishRun(runner.start(opts.profileId, 'demo-click'));
        return Object.freeze({ status: status, result: result });
      } finally {
        runOverride = null;
      }
    },
    cleanup: function () {
      runner.shutdown();
      if (fs.existsSync(rootDir)) fs.rmdirSync(rootDir, { recursive: true });
    }
  });
}

module.exports = { createRuntime: createRuntime };
