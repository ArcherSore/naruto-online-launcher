/**
 * 游戏 BrowserWindow 的通用生命周期。
 *
 * 腾讯 URL 分类、认证子窗、页面探针和恢复状态由 TencentLaunchFlow 负责；
 * 本模块只处理 load/close/crash 等不依赖站点的窗口事件。这里不读取凭据、
 * 不注入页面、不修改导航，也不清理 Profile Session。
 */

'use strict';

const logger = require('../utils/logger');
const ManagerWindow = require('../ui/manager/ManagerWindow');

const CRASH_WINDOW_MS = 10 * 60 * 1000;
const CRASH_RELOAD_LIMIT = 3;

function profileLabel(profile, profileId) {
  if (profile && typeof profile.name === 'string' && profile.name.length > 0) {
    return profile.name;
  }
  return profileId;
}

function sendWindowStatus(profileId, isOpen) {
  ManagerWindow.send('game-window:status', { profileId: profileId, open: isOpen });
}

function clearEntryTimers(entry) {
  if (!entry) return;
  if (entry.failLoadTimer) {
    clearTimeout(entry.failLoadTimer);
    entry.failLoadTimer = null;
  }
  if (entry.closeTimer) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
  }
}

function flushSession(session) {
  if (!session || !session.cookies || typeof session.cookies.flushStore !== 'function') {
    return Promise.resolve();
  }
  try {
    return Promise.resolve(session.cookies.flushStore()).catch(function () {});
  } catch (_) {
    return Promise.resolve();
  }
}

function optimizeRenderer(win) {
  try {
    if (typeof win.webContents.getOSProcessId !== 'function') return;
    const rendererPid = win.webContents.getOSProcessId();
    if (!(rendererPid > 0)) return;
    const cpuOptimizer = require('./CpuOptimizer');
    const { loadConfig } = require('../config/settings');
    const cfg = loadConfig();
    Promise.resolve(
      cpuOptimizer.optimizeRenderer(rendererPid, {
        preset: cfg.optimizationPreset || 'balanced'
      })
    ).catch(function (error) {
      logger.debug('CpuOptimizer: failed (non-fatal) - ' + error.message);
    });
  } catch (error) {
    logger.debug('CpuOptimizer: skipped - ' + error.message);
  }
}

/**
 * @param {Electron.BrowserWindow} win
 * @param {Object} ctx
 * @returns {{detach:function()}}
 */
function attach(win, ctx) {
  if (!win || !win.webContents) throw new TypeError('window is required');
  const options = ctx || {};
  const profileId = options.profileId;
  const profile = options.profile || {};
  const entry = options.entry || null;
  const session = options.ses || win.webContents.session;
  const auditor = options.auditor || null;
  const label = profileLabel(profile, profileId);
  const crashTimestamps = [];
  const listeners = [];
  let forceClosing = false;
  let readyHandled = false;

  function on(target, event, handler) {
    target.on(event, handler);
    listeners.push({ target: target, event: event, handler: handler });
  }

  on(win.webContents, 'render-process-gone', function (_event, details) {
    const reason = details && details.reason;
    const errorCode = details && details.exitCode;
    logger.error('SessionLifecycle: renderer terminated', {
      profileId: profileId,
      profileLabel: label,
      event: 'render-process-gone',
      errorCode: typeof errorCode === 'number' ? errorCode : null
    });

    try {
      require('../profiles/manager').reportCrash(profileId);
    } catch (error) {
      logger.debug('render-process-gone: reportCrash(profile) failed: ' + error.message);
    }
    try {
      require('../memory/guard').reportCrash();
    } catch (error) {
      logger.debug('render-process-gone: reportCrash(memory) failed: ' + error.message);
    }
    if (auditor) {
      try {
        auditor.recordCrash(reason || 'unknown');
      } catch (error) {
        logger.debug('Auditor: recordCrash failed - ' + error.message);
      }
    }

    const isTerminalExit =
      reason === 'clean-exit' ||
      reason === 'killed' ||
      win.isDestroyed() ||
      win.webContents.isDestroyed();
    let retryCount = 0;
    let exhausted = false;

    if (!isTerminalExit) {
      const now = Date.now();
      while (crashTimestamps.length && now - crashTimestamps[0] >= CRASH_WINDOW_MS) {
        crashTimestamps.shift();
      }
      exhausted = crashTimestamps.length >= CRASH_RELOAD_LIMIT;
      if (!exhausted) crashTimestamps.push(now);
      retryCount = Math.min(crashTimestamps.length, CRASH_RELOAD_LIMIT);
      if (!exhausted && auditor) {
        try {
          auditor.recordReload();
        } catch (error) {
          logger.debug('Auditor: recordReload failed - ' + error.message);
        }
      }
    }

    if (typeof options.onRendererGone === 'function') {
      options.onRendererGone({
        reason: reason,
        errorCode: errorCode,
        retryCount: retryCount,
        retryLimit: CRASH_RELOAD_LIMIT,
        retryWindowMs: CRASH_WINDOW_MS,
        exhausted: exhausted
      });
    }
  });

  on(win, 'unresponsive', function () {
    logger.warn('SessionLifecycle: window unresponsive', {
      profileId: profileId,
      profileLabel: label,
      event: 'unresponsive'
    });
    if (typeof options.onUnresponsive === 'function') options.onUnresponsive({});
  });

  on(win, 'responsive', function () {
    logger.info('SessionLifecycle: window responsive', {
      profileId: profileId,
      profileLabel: label,
      event: 'responsive'
    });
    if (typeof options.onResponsive === 'function') options.onResponsive({});
  });

  on(win.webContents, 'did-finish-load', function () {
    flushSession(session);
    optimizeRenderer(win);
    if (typeof options.onLoadFinished === 'function') options.onLoadFinished();
  });

  on(win.webContents, 'did-fail-load', function (_event, code, _description, value, isMainFrame) {
    if (code === -3 || isMainFrame === false || String(value || '').indexOf('data:') === 0) return;
    logger.warn('SessionLifecycle: load failed', {
      profileId: profileId,
      profileLabel: label,
      event: 'did-fail-load',
      errorCode: typeof code === 'number' ? code : null
    });
    if (typeof options.onLoadFailed === 'function') {
      options.onLoadFailed({ errorCode: typeof code === 'number' ? code : null });
    }
  });

  on(win, 'ready-to-show', function () {
    if (readyHandled || win.isDestroyed()) return;
    readyHandled = true;
    win.show();
    sendWindowStatus(profileId, true);
    if (auditor) {
      try {
        auditor.sessionStart();
      } catch (error) {
        logger.debug('Auditor: sessionStart failed - ' + error.message);
      }
    }
    if (typeof options.onOpened === 'function') options.onOpened();
    if (typeof options.onReady === 'function') options.onReady();
  });

  on(win, 'close', function (event) {
    if (forceClosing) return;
    forceClosing = true;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    clearEntryTimers(entry);

    let completed = false;
    function finishClose() {
      if (completed) return;
      completed = true;
      if (entry && entry.closeTimer) {
        clearTimeout(entry.closeTimer);
        entry.closeTimer = null;
      }
      if (!win.isDestroyed()) win.destroy();
    }

    if (entry) {
      entry.closeTimer = setTimeout(finishClose, 500);
      if (entry.closeTimer.unref) entry.closeTimer.unref();
    }
    flushSession(session).then(finishClose);
  });

  on(win, 'closed', function () {
    clearEntryTimers(entry);
    sendWindowStatus(profileId, false);
    if (auditor) {
      try {
        auditor.sessionEnd();
      } catch (error) {
        logger.debug('Auditor: sessionEnd failed - ' + error.message);
      }
    }
    if (typeof options.onClosed === 'function') options.onClosed();
  });

  return {
    detach: function () {
      listeners.forEach(function (listener) {
        if (typeof listener.target.removeListener === 'function') {
          listener.target.removeListener(listener.event, listener.handler);
        }
      });
      clearEntryTimers(entry);
    }
  };
}

module.exports = {
  attach: attach,
  _clearEntryTimers: clearEntryTimers,
  CRASH_RELOAD_LIMIT: CRASH_RELOAD_LIMIT
};
