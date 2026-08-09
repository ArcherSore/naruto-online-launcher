'use strict';

const { AutomationError } = require('./errors');
const { deepFreeze } = require('./store');

function createAutomationApi(options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const setTimer = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const clearTimer = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;

  function cancellationError() {
    return new AutomationError(
      opts.signal && opts.signal.reason === 'timeout' ? 'run-timeout' : 'run-cancelled'
    );
  }

  function preflight() {
    if (!opts.coordinator.owns(opts.lease)) throw new AutomationError('run-cancelled');
    if (opts.signal && opts.signal.aborted) throw cancellationError();
    if (typeof opts.profileExists === 'function' && !opts.profileExists(opts.profileId)) {
      throw new AutomationError('profile-not-found');
    }
  }

  function enqueue(action) {
    return opts.coordinator.enqueue(opts.lease, function () {
      preflight();
      return action();
    });
  }

  function wait(milliseconds) {
    if (
      !Number.isInteger(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 60000 ||
      !Number.isFinite(opts.deadlineAt) ||
      now() + milliseconds > opts.deadlineAt
    ) {
      return Promise.reject(new AutomationError('action-timeout'));
    }
    return enqueue(function () {
      return new Promise(function (resolve, reject) {
        if (opts.signal.aborted) {
          reject(cancellationError());
          return;
        }
        let settled = false;
        const timer = setTimer(function () {
          if (settled) return;
          settled = true;
          opts.signal.removeEventListener('abort', onAbort);
          resolve();
        }, milliseconds);
        function onAbort() {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          opts.signal.removeEventListener('abort', onAbort);
          reject(cancellationError());
        }
        opts.signal.addEventListener('abort', onAbort, { once: true });
      });
    });
  }

  return Object.freeze({
    capture: function () {
      return enqueue(function () { return opts.backend.capture(opts.profileId); });
    },
    getWindowState: function () {
      return enqueue(function () { return opts.backend.getWindowState(opts.profileId); });
    },
    getCoordinates: function () {
      return enqueue(function () {
        return deepFreeze(opts.store.getCoordinates(opts.profileId, opts.scriptId));
      });
    },
    click: function (point) {
      return enqueue(function () { return opts.backend.click(opts.profileId, point); });
    },
    wait: wait
  });
}

module.exports = { createAutomationApi: createAutomationApi };
