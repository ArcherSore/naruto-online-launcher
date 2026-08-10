'use strict';

const path = require('path');
const { createRegistry } = require('./registry');
const { createAutomationStore } = require('./store');
const { createCoordinator } = require('./coordinator');
const { createAutomationBackend } = require('./backend');
const { createAutomationApi } = require('./api');
const { createRunner } = require('./runner');
const { AutomationError } = require('./errors');
const { createVisionCodec } = require('./vision/codec');
const { createVisionTemplateLoader } = require('./vision/template-loader');
const { createVisionMatcher } = require('./vision/matcher');
const { createVisionApi } = require('./vision/api');

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
  let serviceActive = true;
  let profileChangeUnsubscribe = null;
  const knownProfileIds = new Set(
    typeof opts.profileStore.getAll === 'function'
      ? opts.profileStore.getAll().map(function (profile) { return profile && profile.id; }).filter(Boolean)
      : []
  );
  const unsubscribeClose = opts.launcher.onAutomationTargetClosed(function (profileId) {
    runner.cancelProfile(profileId, 'window-closed');
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
      }
    });
    runner.listStatuses().forEach(function (status) {
      if (
        (status.status === 'running' || status.status === 'stopping') &&
        !profileExists(status.profileId)
      ) {
        runner.cancelProfile(status.profileId, 'window-closed');
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
    listStatuses: runner.listStatuses,
    onStatus: runner.onStatus,
    cancelProfile: runner.cancelProfile,
    shutdown: function () {
      if (!serviceActive) return runner.shutdown();
      serviceActive = false;
      unsubscribeClose();
      if (profileChangeUnsubscribe) profileChangeUnsubscribe();
      return runner.shutdown();
    }
  });
}

module.exports = { createAutomationService: createAutomationService };
