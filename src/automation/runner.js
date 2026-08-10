'use strict';

const crypto = require('crypto');
const { createCancellationController } = require('./cancellation');
const { AutomationError, toSafeError } = require('./errors');
const { deepFreeze } = require('./store');

function createRunner(options) {
  const opts = options || {};
  const timeoutMs =
    Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 300000;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const statuses = new Map();
  const activeByProfile = new Map();
  const runs = new Map();
  const listeners = new Set();

  function pair(profileId, scriptId) {
    return profileId + '\u0000' + scriptId;
  }

  function snapshot(run) {
    if (!run) return null;
    return Object.freeze({
      runId: run.runId,
      profileId: run.profileId,
      scriptId: run.scriptId,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      error: run.error
        ? Object.freeze({ code: run.error.code, safeMessage: run.error.safeMessage })
        : null
    });
  }

  function publish(run) {
    statuses.set(pair(run.profileId, run.scriptId), run);
    const safe = snapshot(run);
    listeners.forEach(function (listener) {
      try {
        listener(safe);
      } catch (_) {
        // Status observers cannot change run state.
      }
    });
    return safe;
  }

  function finalize(run, status, error) {
    if (run.terminal) return snapshot(run);
    run.terminal = true;
    run.status = status;
    run.endedAt = now();
    run.error = error || null;
    if (run.timeout) clearTimeout(run.timeout);
    opts.coordinator.release(run.lease);
    if (activeByProfile.get(run.profileId) === run) activeByProfile.delete(run.profileId);
    return publish(run);
  }

  function terminalForReason(run, reason) {
    if (reason === 'timeout') {
      return finalize(run, 'failed', toSafeError(new AutomationError('run-timeout')));
    }
    if (reason === 'window-closed') {
      return finalize(run, 'failed', toSafeError(new AutomationError('window-unavailable')));
    }
    return finalize(run, 'cancelled', toSafeError(new AutomationError('run-cancelled')));
  }

  function requestTermination(run, reason) {
    if (!run || run.terminal || run.terminationReason) return false;
    run.terminationReason = reason;
    if ((reason === 'user-stop' || reason === 'app-quit') && run.status === 'running') {
      run.status = 'stopping';
      publish(run);
    }
    run.controller.abort(reason);
    run.resolveTermination(reason);
    return true;
  }

  function execute(run, script, context) {
    const scriptSettlement = Promise.resolve()
      .then(function () { return script.run(context); })
      .then(
        function () { return { type: 'resolved' }; },
        function (error) { return { type: 'rejected', error: error }; }
      );
    const terminationSettlement = run.terminationPromise.then(function (reason) {
      return { type: 'terminated', reason: reason };
    });

    return Promise.race([scriptSettlement, terminationSettlement]).then(async function (winner) {
      if (typeof opts.coordinator.whenIdle === 'function') {
        try {
          await opts.coordinator.whenIdle(run.lease);
        } catch (_) {
          // The script/API settlement below remains the authoritative result.
        }
      }
      if (run.terminal) return snapshot(run);
      if (run.terminationReason) return terminalForReason(run, run.terminationReason);
      if (winner.type === 'terminated') return terminalForReason(run, winner.reason);
      if (winner.type === 'rejected') {
        return finalize(run, 'failed', toSafeError(winner.error, 'script-failed'));
      }
      return finalize(run, 'succeeded', null);
    });
  }

  function start(profileId, scriptId) {
    if (typeof opts.profileExists === 'function' && !opts.profileExists(profileId)) {
      return { ok: false, error: 'profile-not-found' };
    }
    const script = opts.registry.get(scriptId);
    if (!script) return { ok: false, error: 'script-not-found' };
    if (typeof opts.targetAvailable === 'function') {
      try {
        if (!opts.targetAvailable(profileId)) {
          return { ok: false, error: 'window-unavailable' };
        }
      } catch (_) {
        return { ok: false, error: 'window-unavailable' };
      }
    }

    const runId = crypto.randomBytes(16).toString('hex');
    const acquired = opts.coordinator.tryAcquire(profileId, runId);
    if (!acquired.ok) return acquired;
    let config;
    try {
      config = deepFreeze(opts.store.getConfig(profileId, scriptId));
    } catch (error) {
      opts.coordinator.release(acquired.lease);
      return { ok: false, error: toSafeError(error, 'config-invalid').code };
    }

    const startedAt = now();
    const controller = createCancellationController();
    let resolveTermination;
    const terminationPromise = new Promise(function (resolve) {
      resolveTermination = resolve;
    });
    const run = {
      runId: runId,
      profileId: profileId,
      scriptId: scriptId,
      status: 'running',
      startedAt: startedAt,
      endedAt: null,
      deadlineAt: startedAt + timeoutMs,
      error: null,
      controller: controller,
      lease: acquired.lease,
      terminal: false,
      terminationReason: null,
      terminationPromise: terminationPromise,
      resolveTermination: resolveTermination,
      timeout: null,
      promise: null
    };
    const logger = opts.logger && typeof opts.logger.createBoundLogger === 'function'
      ? opts.logger.createBoundLogger({ runId: runId, profileId: profileId, scriptId: scriptId })
      : Object.freeze({ debug: function () {}, info: function () {}, warn: function () {}, error: function () {} });
    const runOptions = {
      profileId: profileId,
      scriptId: scriptId,
      lease: run.lease,
      signal: controller.signal,
      deadlineAt: run.deadlineAt,
      coordinator: opts.coordinator,
      store: opts.store,
      profileExists: opts.profileExists
    };
    const automation = opts.createApi(runOptions);
    const vision = typeof opts.createVision === 'function'
      ? opts.createVision(runOptions)
      : Object.freeze({
        find: function () { return Promise.reject(new AutomationError('script-failed')); },
        waitFor: function () { return Promise.reject(new AutomationError('script-failed')); },
        waitUntilGone: function () { return Promise.reject(new AutomationError('script-failed')); }
      });
    const context = Object.freeze({
      profileId: profileId,
      config: config,
      signal: controller.signal,
      log: logger,
      automation: automation,
      vision: vision
    });
    activeByProfile.set(profileId, run);
    runs.set(runId, run);
    publish(run);
    run.timeout = setTimeout(function () {
      requestTermination(run, 'timeout');
    }, timeoutMs);
    if (run.timeout && typeof run.timeout.unref === 'function') run.timeout.unref();
    run.promise = execute(run, script, context);
    return { ok: true, status: snapshot(run) };
  }

  function getStatus(profileId, scriptId) {
    const run = statuses.get(pair(profileId, scriptId));
    if (run) return snapshot(run);
    return Object.freeze({
      runId: null,
      profileId: profileId,
      scriptId: scriptId,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      error: null
    });
  }

  function stop(profileId, runId) {
    const active = activeByProfile.get(profileId);
    if (active) {
      if (active.runId !== runId) return { ok: false, error: 'run-not-active' };
      requestTermination(active, 'user-stop');
      return { ok: true, status: snapshot(active) };
    }
    const previous = runs.get(runId);
    if (previous && previous.profileId === profileId && previous.terminal) {
      return { ok: true, status: snapshot(previous) };
    }
    return { ok: false, error: 'run-not-active' };
  }

  function cancelProfile(profileId, reason) {
    const run = activeByProfile.get(profileId);
    if (!run) return false;
    const allowed = ['window-closed', 'app-quit', 'timeout'];
    return requestTermination(run, allowed.indexOf(reason) === -1 ? 'window-closed' : reason);
  }

  return Object.freeze({
    start: start,
    stop: stop,
    getStatus: getStatus,
    listStatuses: function () {
      return Object.freeze(Array.from(statuses.values()).map(snapshot));
    },
    waitForRun: function (runId) {
      const run = runs.get(runId);
      return run && run.promise ? run.promise : Promise.resolve();
    },
    onStatus: function (listener) {
      if (typeof listener === 'function') listeners.add(listener);
      return function () { return listeners.delete(listener); };
    },
    cancelProfile: cancelProfile,
    shutdown: function () {
      activeByProfile.forEach(function (run) {
        requestTermination(run, 'app-quit');
      });
      return Promise.all(Array.from(activeByProfile.values()).map(function (run) {
        return run.promise;
      }));
    }
  });
}

module.exports = { createRunner: createRunner };
