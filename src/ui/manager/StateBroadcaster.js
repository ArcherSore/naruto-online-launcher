/**
 * ui/manager/StateBroadcaster.js — Push de estado para a UI (Fase 3c split)
 *
 * Responsabilidade ÚNICA (SRP): empurrar snapshots de estado (perfis e memória)
 * para o renderer do manager via IPC, em intervalos e em resposta a
 * mudanças. Não cria janelas nem registra handlers de ação — isso é papel do
 * ManagerWindow e IpcRouter.
 *
 * Histórico: era parte do God Object controller.js. Split: este módulo cuida
 * só do broadcast de estado.
 */

'use strict';

const store = require('../../profiles/store');
const mg = require('../../memory/guard');
const ManagerWindow = require('./ManagerWindow');

const SAFE_PROFILE_FIELDS = Object.freeze([
  'id',
  'name',
  'color',
  'notes',
  'tags',
  'favorite',
  'notificationsEnabled',
  'hardwareProfile',
  'createdAt',
  'lastUsed',
  'launchCount',
  'totalPlayMs'
]);

const SAFE_FLOW_FIELDS = Object.freeze([
  'profileId',
  'stage',
  'status',
  'attempts',
  'lastSafeLocation',
  'error',
  'availableActions'
]);

const SAFE_FLOW_STAGES = Object.freeze([
  'BOOTSTRAPPING',
  'SELECTOR_LOADING',
  'SELECTOR_READY',
  'AUTHENTICATING',
  'GAME_NAVIGATING',
  'GAME_LOADING',
  'GAME_READY',
  'SELECTOR_FAILED',
  'AUTH_FAILED',
  'NAVIGATION_FAILED',
  'GAME_FAILED',
  'SESSION_REJECTED',
  'BLOCKED_NAVIGATION',
  'CLOSED'
]);

const SAFE_RECOVERY_ACTIONS = Object.freeze([
  'RELOAD_SELECTOR',
  'REOPEN_AUTH',
  'RETRY_GAME_NAVIGATION',
  'RELOAD_GAME',
  'RETURN_TO_SELECTOR'
]);

const FIXED_FLOW_MESSAGES = Object.freeze({
  SESSION_REJECTED: '会话被腾讯官方拒绝，请重新扫码'
});

function pickFields(value, fields) {
  const source = value && typeof value === 'object' ? value : {};
  return fields.reduce(function (safe, field) {
    if (Object.prototype.hasOwnProperty.call(source, field)) safe[field] = source[field];
    return safe;
  }, {});
}

// Guards anti-duplicação de listeners (v3.6.2)
let _memCb = null,
  _gcCb = null;
let _pushTimer = null;
let _storeChangeCb = null;
let _started = false;

function pushProfiles() {
  const list = store.getAll().map(function (p) {
    const safe = pickFields(p, SAFE_PROFILE_FIELDS);
    if (p.flow && typeof p.flow === 'object') {
      safe.flow = pickFields(p.flow, ['stage', 'status', 'availableActions']);
    }
    return safe;
  });
  ManagerWindow.send('profiles:updated', list);
}

function pushFlowState(snapshot) {
  const safe = pickFields(snapshot, SAFE_FLOW_FIELDS);
  if (typeof safe.profileId !== 'string') return;
  if (SAFE_FLOW_STAGES.indexOf(safe.stage) === -1) return;
  if (Object.prototype.hasOwnProperty.call(FIXED_FLOW_MESSAGES, safe.stage)) {
    safe.userMessage = FIXED_FLOW_MESSAGES[safe.stage];
  }
  if (safe.attempts) {
    safe.attempts = pickFields(safe.attempts, ['selector', 'auth', 'navigation', 'game', 'crash']);
  }
  if (safe.lastSafeLocation) {
    safe.lastSafeLocation = pickFields(safe.lastSafeLocation, ['role', 'origin', 'pathname']);
  }
  if (safe.error) {
    safe.error = pickFields(safe.error, ['stage', 'code', 'safeMessage']);
    if (
      safe.error.code !== null &&
      typeof safe.error.code !== 'string' &&
      typeof safe.error.code !== 'number'
    ) {
      delete safe.error.code;
    }
  }
  if (safe.availableActions) {
    const seen = [];
    safe.availableActions = Array.isArray(safe.availableActions)
      ? safe.availableActions.filter(function (action) {
          if (SAFE_RECOVERY_ACTIONS.indexOf(action) === -1 || seen.indexOf(action) !== -1) {
            return false;
          }
          seen.push(action);
          return true;
        })
      : [];
  }
  ManagerWindow.send('launch-flow:status', safe);
}

function pushMemory() {
  ManagerWindow.send('memory:update', mg.getStats());
}

function pushAll() {
  pushProfiles();
  pushMemory();
}

/**
 * Registra listeners de mudança de estado (memory guard, GC e store changes)
 * e inicia o timer de refresh periódico (30s).
 * Idempotente — seguro chamar múltiplas vezes.
 */
function startAutoRefresh() {
  if (_started) return;
  _started = true;

  if (!_memCb) {
    _memCb = function () {
      pushMemory();
    };
    mg.onMemoryUpdate(_memCb);
  }
  if (!_gcCb) {
    _gcCb = function () {
      pushMemory();
    };
    mg.onGC(_gcCb);
  }
  if (_pushTimer) clearInterval(_pushTimer);
  _pushTimer = setInterval(function () {
    pushMemory();
  }, 30000);
  if (_pushTimer.unref) _pushTimer.unref();

  if (!_storeChangeCb) {
    _storeChangeCb = function () {
      pushProfiles();
    };
    store.onChange(_storeChangeCb);
  }
}

function stopAutoRefresh() {
  if (_pushTimer) {
    clearInterval(_pushTimer);
    _pushTimer = null;
  }
  _started = false;
}

module.exports = {
  pushProfiles: pushProfiles,
  pushMemory: pushMemory,
  pushFlowState: pushFlowState,
  pushAll: pushAll,
  startAutoRefresh: startAutoRefresh,
  stopAutoRefresh: stopAutoRefresh
};
