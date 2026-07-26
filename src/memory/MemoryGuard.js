/**
 * memory/MemoryGuard.js — Memory monitoring + Light Mode (low-spec)
 *
 * Single Responsibility (SRP): observe and report memory state do
 * main process + detect low-spec machines (Light Mode / Minimal).
 *
 * Does NOT run GC. V8 handles the main process alone — a launcher spends 99%
 * do tempo idle, e o jogo roda num processo renderer isolado que o main nunca
 * touch. Forced GC in main of 50-100MB is a useless optimization (removed).
 */

'use strict';

const os = require('os');
const logger = require('../utils/logger');

const TOTAL_RAM_GB = os.totalmem() / (1024 * 1024 * 1024);
const IS_LOW_SPEC = TOTAL_RAM_GB < 4; // Modo Leve auto-detect
const IS_MINIMAL = TOTAL_RAM_GB < 2; // Minimal Mode — manager-only (sem UI)

const CONFIG = {
  normal: { thresholdMB: 700 },
  lowSpec: { thresholdMB: 450 }
};
const MODE = IS_LOW_SPEC ? CONFIG.lowSpec : CONFIG.normal;

let _thresholdMB = MODE.thresholdMB;
let _forceLowSpec = false;
let _started = false;
const _webContentsByProfile = new Map();
const _memoryListeners = [];
const _gcListeners = [];

// ── Monitoring ──
const _startedAt = Date.now();
let _crashCount = 0;

/** @returns {boolean} Whether low-spec (Light) mode is active */
function isLowSpecMode() {
  return _forceLowSpec || IS_LOW_SPEC;
}

/** @returns {boolean} Whether the machine qualifies for Minimal mode (<2GB RAM) */
function isMinimal() {
  return IS_MINIMAL;
}

/** @returns {number} Current memory threshold in MB before alerts trigger */
function getThreshold() {
  return _thresholdMB;
}

/**
 * Forces or unforces Light Mode. Recalculates threshold.
 * @param {boolean} force
 */
function setForceLowSpec(force) {
  _forceLowSpec = !!force;
  _thresholdMB = isLowSpecMode() ? CONFIG.lowSpec.thresholdMB : CONFIG.normal.thresholdMB;
  try {
    const partition = require('../profiles/partition');
    partition.setLowSpecMode(isLowSpecMode());
  } catch (_) {
    /* partition module may not be loaded yet — ok */
  }
  logger.info(
    'MemoryGuard: Low-spec mode = ' + isLowSpecMode() + ' (threshold ' + _thresholdMB + 'MB)'
  );
}

/**
 * Returns a snapshot of the main process memory state.
 * @returns {Object} stats
 */
function getStats() {
  let totalMB = 0;
  try {
    const mu = process.memoryUsage();
    if (mu && typeof mu.rss === 'number') {
      totalMB = Math.round(mu.rss / 1024 / 1024);
    }
  } catch (e) {
    logger.debug('MemoryGuard: memoryUsage() failed: ' + e.message);
  }
  const uptimeMs = Date.now() - _startedAt;
  return {
    totalMB: totalMB,
    thresholdMB: _thresholdMB,
    isLowSpecMode: isLowSpecMode(),
    isMinimal: isMinimal(),
    systemRAM: Math.round(TOTAL_RAM_GB * 10) / 10,
    timestamp: Date.now(),
    uptimeMs: uptimeMs,
    uptimeHours: Math.round((uptimeMs / 3600000) * 10) / 10,
    crashCount: _crashCount,
    startedAt: _startedAt
  };
}

/** Increments the registered crash counter. */
function reportCrash() {
  _crashCount++;
  logger.warn('MemoryGuard: crash recorded (total: ' + _crashCount + ')');
}

/**
 * Compatibility lifecycle for callers retained by the Tencent branch.
 * Upstream removed forced GC; these methods only maintain observable state.
 */
function start() {
  _started = true;
}

function stop() {
  _started = false;
  _webContentsByProfile.clear();
}

function startWebviewGC() {
  logger.debug('MemoryGuard: renderer GC remains disabled');
}

function registerGameWebContents(profileId, webContents) {
  if (profileId && webContents) _webContentsByProfile.set(profileId, webContents);
}

function unregisterGameWebContents(profileId) {
  _webContentsByProfile.delete(profileId);
}

function getWebviewStats() {
  return Array.from(_webContentsByProfile.keys()).map(function (profileId) {
    return { profileId: profileId, gcEnabled: false };
  });
}

function collect() {
  const result = Object.assign({ collected: false, reason: 'forced-gc-disabled' }, getStats());
  _gcListeners.forEach(function (listener) {
    try {
      listener(result);
    } catch (_) {
      /* listener isolation */
    }
  });
  return result;
}

function onMemoryUpdate(callback) {
  if (typeof callback === 'function') _memoryListeners.push(callback);
}

function onGC(callback) {
  if (typeof callback === 'function') _gcListeners.push(callback);
}

module.exports = {
  // Maintained (do not remove): low-spec detection APIs used by Light Mode
  // on machines with <4GB RAM — getStats, isLowSpecMode, isMinimal, IS_LOW_SPEC,
  // SYSTEM_RAM_GB, getThreshold, setForceLowSpec, reportCrash.
  getStats: getStats,
  isLowSpecMode: isLowSpecMode,
  isMinimal: isMinimal,
  isBatata: isLowSpecMode,
  isRamen: isMinimal,
  getThreshold: getThreshold,
  setForceLowSpec: setForceLowSpec,
  setForceBatata: setForceLowSpec,
  reportCrash: reportCrash,
  start: start,
  stop: stop,
  startWebviewGC: startWebviewGC,
  registerGameWebContents: registerGameWebContents,
  unregisterGameWebContents: unregisterGameWebContents,
  getWebviewStats: getWebviewStats,
  collect: collect,
  onMemoryUpdate: onMemoryUpdate,
  onGC: onGC,
  isStarted: function () {
    return _started;
  },
  IS_LOW_SPEC: IS_LOW_SPEC,
  IS_MINIMAL: IS_MINIMAL,
  SYSTEM_RAM_GB: Math.round(TOTAL_RAM_GB * 10) / 10
};
