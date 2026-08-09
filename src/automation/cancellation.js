'use strict';

function createCancellationController() {
  let aborted = false;
  let reason = null;
  let onabort = null;
  const listeners = [];
  let signal;

  function addEventListener(type, listener, options) {
    if (type !== 'abort' || typeof listener !== 'function') return;
    const exists = listeners.some(function (record) {
      return record.listener === listener;
    });
    if (exists) return;
    listeners.push({ listener: listener, once: !!(options && options.once) });
  }

  function removeEventListener(type, listener) {
    if (type !== 'abort' || typeof listener !== 'function') return;
    for (let index = listeners.length - 1; index >= 0; index--) {
      if (listeners[index].listener === listener) listeners.splice(index, 1);
    }
  }

  signal = {};
  Object.defineProperties(signal, {
    aborted: {
      enumerable: true,
      get: function () {
        return aborted;
      }
    },
    reason: {
      enumerable: true,
      get: function () {
        return reason;
      }
    },
    onabort: {
      enumerable: true,
      get: function () {
        return onabort;
      },
      set: function (listener) {
        onabort = typeof listener === 'function' ? listener : null;
      }
    },
    addEventListener: { enumerable: true, value: addEventListener },
    removeEventListener: { enumerable: true, value: removeEventListener }
  });
  Object.freeze(signal);

  function abort(nextReason) {
    if (aborted) return false;
    aborted = true;
    reason = typeof nextReason === 'string' && nextReason ? nextReason : 'user-stop';
    const event = Object.freeze({ type: 'abort', target: signal, currentTarget: signal });
    const snapshot = listeners.slice();
    snapshot.forEach(function (record) {
      if (record.once) removeEventListener('abort', record.listener);
      try {
        record.listener.call(signal, event);
      } catch (_) {
        // Cancellation must continue even when one trusted listener fails.
      }
    });
    if (typeof onabort === 'function') {
      try {
        onabort.call(signal, event);
      } catch (_) {
        // Cancellation must continue even when onabort fails.
      }
    }
    return true;
  }

  return Object.freeze({ signal: signal, abort: abort });
}

module.exports = { createCancellationController: createCancellationController };
