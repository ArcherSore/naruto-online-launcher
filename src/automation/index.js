'use strict';

const crypto = require('crypto');
const path = require('path');
const { createRegistry } = require('./registry');
const { createAutomationStore } = require('./store');
const { createCoordinator } = require('./coordinator');
const { createAutomationBackend } = require('./backend');
const { createAutomationApi } = require('./api');
const { createRecordingService } = require('./recording');
const { createRunner } = require('./runner');
const { AutomationError } = require('./errors');
const { createVisionCodec } = require('./vision/codec');
const { createVisionTemplateLoader } = require('./vision/template-loader');
const { createVisionMatcher } = require('./vision/matcher');
const { createVisionApi } = require('./vision/api');
const { createCancellationController } = require('./cancellation');

function createAutomationService(options) {
  const opts = options || {};
  if (!opts.app || !opts.profileStore || !opts.launcher || !opts.logger) {
    throw new TypeError('app, profileStore, launcher and logger are required');
  }
  const profileExists = function (profileId) {
    return !!opts.profileStore.get(profileId);
  };
  const registry = createRegistry({ app: opts.app });
  registry.scan();
  const coordinator = createCoordinator();
  const store = createAutomationStore({
    rootDir: path.join(opts.app.getPath('userData'), 'automation-data'),
    profileExists: profileExists,
    scriptExists: function (scriptId) { return registry.has(scriptId); }
  });
  const backend = createAutomationBackend({
    targetProvider: opts.launcher.getAutomationTarget
  });
  const visionCodec = createVisionCodec();
  const visionLoader = createVisionTemplateLoader({ registry: registry, codec: visionCodec });
  const visionMatcher = createVisionMatcher();
  function createRunApi(runOptions) {
    return createAutomationApi(Object.assign({}, runOptions, {
      coordinator: coordinator,
      store: store,
      backend: backend,
      profileExists: profileExists
    }));
  }
  function createRunVision(runOptions) {
    return createVisionApi(Object.assign({}, runOptions, {
      coordinator: coordinator,
      backend: backend,
      loader: visionLoader,
      codec: visionCodec,
      matcher: visionMatcher,
      profileExists: profileExists
    }));
  }
  const runner = createRunner({
    registry: registry,
    store: store,
    coordinator: coordinator,
    profileExists: profileExists,
    targetAvailable: function (profileId) {
      return backend.getWindowState(profileId).available === true;
    },
    logger: opts.logger,
    createApi: createRunApi,
    createVision: createRunVision
  });
  const recording = createRecordingService({ backend: backend, store: store });
  const activeVisionTests = new Map();
  let serviceActive = true;
  let profileChangeUnsubscribe = null;
  const knownProfileIds = new Set(
    typeof opts.profileStore.getAll === 'function'
      ? opts.profileStore.getAll().map(function (profile) { return profile && profile.id; }).filter(Boolean)
      : []
  );
  const unsubscribeClose = opts.launcher.onAutomationTargetClosed(function (profileId) {
    runner.cancelProfile(profileId, 'window-closed');
    const activeTest = activeVisionTests.get(profileId);
    if (activeTest) activeTest.controller.abort('window-closed');
    recording.clearProfile(profileId);
  });

  function handleProfileChange() {
    if (!serviceActive) return;
    const currentIds = new Set(
      typeof opts.profileStore.getAll === 'function'
        ? opts.profileStore.getAll().map(function (profile) { return profile && profile.id; }).filter(Boolean)
        : []
    );
    knownProfileIds.forEach(function (profileId) {
      if (!currentIds.has(profileId)) {
        runner.cancelProfile(profileId, 'window-closed');
        const activeTest = activeVisionTests.get(profileId);
        if (activeTest) activeTest.controller.abort('window-closed');
        recording.clearProfile(profileId);
      }
    });
    runner.listStatuses().forEach(function (status) {
      if (
        (status.status === 'running' || status.status === 'stopping') &&
        !profileExists(status.profileId)
      ) {
        runner.cancelProfile(status.profileId, 'window-closed');
        recording.clearProfile(status.profileId);
      }
    });
    knownProfileIds.clear();
    currentIds.forEach(function (profileId) { knownProfileIds.add(profileId); });
  }

  if (typeof opts.profileStore.onChange === 'function') {
    const unsubscribe = opts.profileStore.onChange(handleProfileChange);
    if (typeof unsubscribe === 'function') profileChangeUnsubscribe = unsubscribe;
  }

  function requireProfile(profileId) {
    if (!profileExists(profileId)) throw new AutomationError('profile-not-found');
  }

  function requireScript(scriptId) {
    if (!registry.has(scriptId)) throw new AutomationError('script-not-found');
  }

  async function testVision(profileId, scriptId, request) {
    requireProfile(profileId);
    requireScript(scriptId);
    if (!request || typeof request !== 'object' || typeof request.click !== 'boolean') {
      throw new AutomationError('vision-input-invalid');
    }
    if (!backend.getWindowState(profileId).available) {
      throw new AutomationError('window-unavailable');
    }
    const testId = 'vision-ui-' + crypto.randomBytes(12).toString('hex');
    const acquired = coordinator.tryAcquire(profileId, testId);
    if (!acquired.ok) throw new AutomationError(acquired.error || 'profile-busy');
    const controller = createCancellationController();
    const deadlineAt = Date.now() + 30000;
    const runOptions = {
      profileId: profileId,
      scriptId: scriptId,
      lease: acquired.lease,
      signal: controller.signal,
      deadlineAt: deadlineAt,
      coordinator: coordinator,
      store: store,
      profileExists: profileExists
    };
    const timeout = setTimeout(function () { controller.abort('timeout'); }, 30000);
    if (timeout && typeof timeout.unref === 'function') timeout.unref();

    const operation = (async function () {
      try {
        const vision = createRunVision(runOptions);
        const automation = createRunApi(runOptions);
        const match = await vision.find(request.templateId, {
          roi: request.roi,
          threshold: request.threshold
        });
        let clicked = false;
        if (match && request.click) {
          await automation.click(match.center);
          clicked = true;
        }
        return Object.freeze({ found: !!match, match: match, clicked: clicked });
      } finally {
        clearTimeout(timeout);
        try {
          await coordinator.whenIdle(acquired.lease);
        } finally {
          coordinator.release(acquired.lease);
          activeVisionTests.delete(profileId);
        }
      }
    })();
    activeVisionTests.set(profileId, { controller: controller, promise: operation });
    return operation;
  }

  return Object.freeze({
    listCatalog: registry.list,
    registrationIssues: registry.issues,
    list: function (profileId) {
      requireProfile(profileId);
      return registry.list().map(function (script) {
        return Object.freeze(Object.assign({}, script, {
          status: runner.getStatus(profileId, script.id)
        }));
      });
    },
    windowState: function (profileId) {
      requireProfile(profileId);
      return backend.getWindowState(profileId);
    },
    status: function (profileId, scriptId) {
      requireProfile(profileId);
      requireScript(scriptId);
      return runner.getStatus(profileId, scriptId);
    },
    start: function (profileId, scriptId) {
      return runner.start(profileId, scriptId);
    },
    stop: function (profileId, runId) {
      return runner.stop(profileId, runId);
    },
    getCoordinates: function (profileId, scriptId) {
      requireProfile(profileId);
      requireScript(scriptId);
      return store.getCoordinates(profileId, scriptId);
    },
    beginRecording: function (profileId, scriptId, ownerId) {
      requireProfile(profileId);
      requireScript(scriptId);
      return recording.begin(profileId, scriptId, ownerId);
    },
    addPoint: function (request) {
      requireProfile(request && request.profileId);
      requireScript(request && request.scriptId);
      return recording.addPoint(request);
    },
    listVisionTemplates: function (profileId, scriptId) {
      requireProfile(profileId);
      requireScript(scriptId);
      return visionLoader.list(scriptId);
    },
    testVision: testVision,
    clearCoordinates: function (profileId, scriptId) {
      requireProfile(profileId);
      requireScript(scriptId);
      return recording.clearCoordinates(profileId, scriptId);
    },
    listStatuses: runner.listStatuses,
    onStatus: runner.onStatus,
    cancelProfile: runner.cancelProfile,
    clearOwner: recording.clearOwner,
    shutdown: function () {
      if (!serviceActive) return runner.shutdown();
      serviceActive = false;
      unsubscribeClose();
      if (profileChangeUnsubscribe) profileChangeUnsubscribe();
      recording.clearAll();
      const pendingVisionTests = Array.from(activeVisionTests.values());
      pendingVisionTests.forEach(function (activeTest) {
        activeTest.controller.abort('app-quit');
      });
      return Promise.all([
        runner.shutdown(),
        Promise.all(pendingVisionTests.map(function (activeTest) {
          return activeTest.promise.catch(function () {});
        }))
      ]).then(function () {});
    }
  });
}

module.exports = { createAutomationService: createAutomationService };
