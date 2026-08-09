'use strict';

const path = require('path');
const { createRegistry } = require('./registry');
const { createAutomationStore } = require('./store');
const { createCoordinator } = require('./coordinator');
const { createAutomationBackend } = require('./backend');
const { createAutomationApi } = require('./api');
const { createRecordingService } = require('./recording');
const { createRunner } = require('./runner');
const { AutomationError } = require('./errors');

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
  const runner = createRunner({
    registry: registry,
    store: store,
    coordinator: coordinator,
    profileExists: profileExists,
    targetAvailable: function (profileId) {
      return backend.getWindowState(profileId).available === true;
    },
    logger: opts.logger,
    createApi: function (runOptions) {
      return createAutomationApi(Object.assign({}, runOptions, {
        coordinator: coordinator,
        store: store,
        backend: backend,
        profileExists: profileExists
      }));
    }
  });
  const recording = createRecordingService({ backend: backend, store: store });
  let serviceActive = true;
  let profileChangeUnsubscribe = null;
  const knownProfileIds = new Set(
    typeof opts.profileStore.getAll === 'function'
      ? opts.profileStore.getAll().map(function (profile) { return profile && profile.id; }).filter(Boolean)
      : []
  );
  const unsubscribeClose = opts.launcher.onAutomationTargetClosed(function (profileId) {
    runner.cancelProfile(profileId, 'window-closed');
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
      return runner.shutdown();
    }
  });
}

module.exports = { createAutomationService: createAutomationService };
