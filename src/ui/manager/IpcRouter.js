/**
 * ui/manager/IpcRouter.js — Registro dos handlers IPC (Fase 3c split)
 *
 * Responsabilidade ÚNICA (SRP): registrar os handlers ipcMain.on/handle que
 * conectam o renderer (index.html) aos subsistemas通用 Profile、memory
 * 与安全元数据 inspector。一个 domain 一个明确边界。
 *
 * Histórico: era parte do God Object controller.js (648 linhas). Split: este
 * módulo cuida só do roteamento IPC; ManagerWindow cuida da janela;
 * StateBroadcaster cuida do push de estado.
 */

'use strict';

const { ipcMain, dialog, session } = require('electron');
const fs = require('fs');
const logger = require('../../utils/logger');
const store = require('../../profiles/store');
const mg = require('../../memory/guard');
const partition = require('../../profiles/partition');
const ManagerWindow = require('./ManagerWindow');
const StateBroadcaster = require('./StateBroadcaster');
const AutomationDemo = require('../../app/AutomationDemo');
const FlashProbeRuntime = require('../../flash/FlashProbeRuntime');

let _handlers = {};
let _inspectors = new Map(); // profileId -> inspector instance
// v4.5: Mapa profileId -> launchStartTime (ms) para tracking de tempo de jogo
const _launchTimes = new Map();
let _registered = false;

const PROFILE_INPUT_FIELDS = Object.freeze([
  'name',
  'color',
  'notes',
  'tags',
  'favorite',
  'notificationsEnabled',
  'hardwareProfile'
]);
const PROFILE_OUTPUT_FIELDS = Object.freeze([
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
const RECOVERY_ACTIONS = Object.freeze([
  'RELOAD_SELECTOR',
  'REOPEN_AUTH',
  'RETRY_GAME_NAVIGATION',
  'RELOAD_GAME',
  'RETURN_TO_SELECTOR'
]);

function sanitizeProfileInput(value) {
  const source = value && typeof value === 'object' ? value : {};
  return PROFILE_INPUT_FIELDS.reduce(function (safe, field) {
    if (Object.prototype.hasOwnProperty.call(source, field)) safe[field] = source[field];
    return safe;
  }, {});
}

function sanitizeProfileOutput(value) {
  const source = value && typeof value === 'object' ? value : {};
  return PROFILE_OUTPUT_FIELDS.reduce(function (safe, field) {
    if (Object.prototype.hasOwnProperty.call(source, field)) safe[field] = source[field];
    return safe;
  }, {});
}

/** @param {string} channel @param {*} payload */
function _send(channel, payload) {
  ManagerWindow.send(channel, payload);
}
/** Push current profiles to renderer. */
function _pushProfiles() {
  StateBroadcaster.pushProfiles();
}
/**
 * Get the manager BrowserWindow if available and not destroyed.
 * @returns {Electron.BrowserWindow|null}
 */
function _getWin() {
  var w = ManagerWindow.getManagerWindow();
  return w && !w.isDestroyed() ? w : null;
}

function _isManagerSender(event) {
  const win = _getWin();
  return !!(win && event && event.sender && win.webContents === event.sender);
}

/**
 * Registra TODOS os handlers IPC. Idempotente (guard _registered).
 * @param {Object} handlers - { launchProfile, getMemoryStats, forceGC, ... }
 */
function registerIpcHandlers(handlers) {
  _handlers = handlers || {};
  if (_registered) return; // v3.6.2: anti-duplicação
  _registered = true;

  ipcMain.on('manager:ready', function () {
    StateBroadcaster.pushAll();
  });

  // ── v5.8: Window Always-on-Top toggle ──
  ipcMain.handle('window:toggle-always-on-top', function (_e, on) {
    const win = _getWin();
    if (!win) return { ok: false, error: 'window-unavailable' };
    const next = typeof on === 'boolean' ? on : !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next);
    logger.info('Always-on-top: ' + next);
    return { ok: true, alwaysOnTop: next };
  });
  ipcMain.handle('window:get-always-on-top', function () {
    const win = _getWin();
    if (!win) return false;
    return win.isAlwaysOnTop();
  });

  // ── v5.8: Window minimize / maximize helpers (for the new window controls) ──
  ipcMain.on('window:minimize', function () {
    const win = _getWin();
    if (win) win.minimize();
  });

  // ── v5.0.0: App relaunch (for optimization preset change) ──
  ipcMain.on('app:relaunch', function () {
    logger.info('App relaunch requested (preset change)');
    const { app } = require('electron');
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle('window:toggle-maximize', function () {
    const win = _getWin();
    if (!win) return null;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  // ── Profile CRUD ──
  ipcMain.on('profile:create', function (_e, opts) {
    if (typeof opts !== 'object' || opts === null) return;
    const p = store.create(sanitizeProfileInput(opts));
    if (p) {
      _pushProfiles();
    } else {
      _send('profile:toast', {
        type: 'error',
        msg: '最多只能创建 ' + store.MAX_PROFILES + ' 个 Profile'
      });
    }
  });

  ipcMain.handle('profile:get', function (_e, id) {
    if (typeof id !== 'string') return null;
    const profile = store.get(id);
    return profile ? sanitizeProfileOutput(profile) : null;
  });

  ipcMain.on('profile:update', function (_e, data) {
    if (typeof data !== 'object' || data === null || typeof data.id !== 'string') return;
    // v5.9.15: Whitelist updatable fields to prevent renderer from overwriting
    // internal fields (id, createdAt, stats, launchCount, lastPlayed, etc.)
    const ALLOWED = PROFILE_INPUT_FIELDS;
    var safe = { id: data.id };
    for (var i = 0; i < ALLOWED.length; i++) {
      if (data[ALLOWED[i]] !== undefined) safe[ALLOWED[i]] = data[ALLOWED[i]];
    }
    store.update(safe.id, safe);
    _pushProfiles();
  });

  ipcMain.on('profile:delete', function (_e, id) {
    if (typeof id !== 'string' || !store.get(id)) {
      _send('profile:toast', { type: 'error', msg: '未找到 Profile（ID 无效）' });
      return;
    }
    // P2 FIX: não permite deletar perfil com jogo aberto — store.remove()
    // chama _rmrf na partition dir, o que crasharia o Flash PPAPI em uso.
    try {
      const gameLauncher = require('../../app/Launcher');
      if (gameLauncher.isProfileOpen(id)) {
        _send('profile:toast', {
          type: 'error',
          msg: '请先关闭这个 Profile 的游戏窗口'
        });
        return;
      }
    } catch (_) {
      // gameLauncher não disponível (dev mode sem Electron) — prossegue
    }
    // Limpa inspector se existir (evita leak no Map _inspectors)
    var insp = _inspectors.get(id);
    if (insp) {
      try {
        insp.disable();
      } catch (_) {
        /* ignore */
      }
      _inspectors.delete(id);
    }
    store.remove(id);
    _pushProfiles();
    _send('profile:toast', { type: 'info', msg: 'Profile 已删除' });
  });

  ipcMain.on('profile:reorder', function (_e, order) {
    if (!Array.isArray(order)) return;
    store.reorder(order);
    _pushProfiles();
  });

  ipcMain.on('profile:launch', function (_e, id) {
    if (typeof id !== 'string' || !store.get(id)) {
      _send('profile:toast', { type: 'error', msg: '未找到 Profile' });
      return;
    }
    if (_handlers.launchProfile) _handlers.launchProfile(id);
  });

  ipcMain.on('profile:refresh', function (_e, id) {
    if (typeof id !== 'string' || !store.get(id)) return;
    if (typeof _handlers.refreshProfile === 'function') _handlers.refreshProfile(id);
  });

  ipcMain.handle('profile:get-stats', function (_e, id) {
    if (typeof id !== 'string') return null;
    return store.getStats(id);
  });

  // v5.5: Launch timeline (7-day activity chart data)
  ipcMain.handle('profile:launch-timeline', function (_e, days) {
    var d = typeof days === 'number' && days > 0 ? days : 7;
    return store.getLaunchTimeline(d);
  });
  ipcMain.handle('profile:clear-launch-log', function () {
    store.clearLaunchLog();
    _pushProfiles();
    return { ok: true };
  });
  ipcMain.handle('profile:launch-log-stats', function () {
    return store.getLaunchLogStats();
  });

  ipcMain.on('profile:update-notes', function (_e, data) {
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof data.id !== 'string' ||
      typeof data.notes !== 'string'
    )
      return;
    store.update(data.id, { notes: data.notes.slice(0, 200) });
    _pushProfiles();
  });

  ipcMain.handle('profile:duplicate', function (_e, id) {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' };
    const src = store.get(id);
    if (!src) return { ok: false, error: 'Profile not found' };
    const copy = store.create({
      name: String(src.name) + '（副本）',
      color: src.color,
      notes: src.notes || '',
      tags: src.tags || [],
      favorite: src.favorite === true,
      notificationsEnabled: src.notificationsEnabled !== false,
      hardwareProfile: src.hardwareProfile
    });
    if (!copy) return { ok: false, error: 'Max profiles reached' };
    logger.info('Profile duplicated: source=' + src.name + ' copy=' + copy.name);
    _pushProfiles();
    return { ok: true, profile: copy };
  });

  ipcMain.handle('profile:set-favorite', function (_e, id, fav) {
    if (typeof id !== 'string') return false;
    return store.update(id, { favorite: fav === true });
  });

  // v5.3: Close a running game window by profile ID
  ipcMain.on('profile:close', function (_e, id) {
    if (typeof id !== 'string') return;
    // Track play time before closing
    if (_launchTimes.has(id)) {
      var elapsed = Date.now() - _launchTimes.get(id);
      store.addPlayTime(id, elapsed);
      _launchTimes.delete(id);
    }
    if (_handlers.closeProfile) _handlers.closeProfile(id);
  });

  ipcMain.on('game-window:status', function (_e, data) {
    if (!data || typeof data.profileId !== 'string') return;
    _send('game-window:status', {
      profileId: data.profileId,
      open: data.open === true
    });
  });

  ipcMain.handle('launch-flow:recover', function (event, action) {
    if (typeof action !== 'string' || RECOVERY_ACTIONS.indexOf(action) === -1) {
      return { ok: false, error: 'invalid-action' };
    }
    if (!event || !event.sender || typeof _handlers.requestRecoveryForSender !== 'function') {
      return { ok: false, error: 'recovery-unavailable' };
    }
    try {
      return Promise.resolve(_handlers.requestRecoveryForSender(event.sender, action)).then(
        function (result) {
          return result && typeof result === 'object'
            ? result
            : { ok: result === true, error: result === true ? undefined : 'recovery-rejected' };
        },
        function () {
          return { ok: false, error: 'recovery-failed' };
        }
      );
    } catch (_) {
      return { ok: false, error: 'recovery-failed' };
    }
  });

  if (AutomationDemo.isEnabled()) {
    ipcMain.handle('automation-demo:capture', function (event) {
      if (!event || !event.sender || typeof _handlers.captureAutomationForSender !== 'function') {
        return { ok: false, error: 'automation-unavailable' };
      }
      return Promise.resolve(_handlers.captureAutomationForSender(event.sender)).catch(function () {
        return { ok: false, error: 'capture-failed' };
      });
    });

    ipcMain.handle('automation-demo:click', function (event, imageX, imageY) {
      if (!event || !event.sender || typeof _handlers.clickAutomationForSender !== 'function') {
        return { ok: false, error: 'automation-unavailable' };
      }
      if (
        typeof imageX !== 'number' ||
        !Number.isFinite(imageX) ||
        typeof imageY !== 'number' ||
        !Number.isFinite(imageY)
      ) {
        return { ok: false, error: 'invalid-coordinate-type' };
      }
      try {
        return Promise.resolve(
          _handlers.clickAutomationForSender(event.sender, imageX, imageY)
        ).catch(function () {
          return { ok: false, error: 'click-failed' };
        });
      } catch (_) {
        return { ok: false, error: 'click-failed' };
      }
    });

    ipcMain.handle('automation-demo:manager-capture', function (event, profileId) {
      if (
        !_isManagerSender(event) ||
        typeof profileId !== 'string' ||
        !store.get(profileId) ||
        typeof _handlers.captureAutomationForProfile !== 'function'
      ) {
        return { ok: false, error: 'automation-unavailable' };
      }
      return Promise.resolve(_handlers.captureAutomationForProfile(profileId)).catch(function () {
        return { ok: false, error: 'capture-failed' };
      });
    });

    ipcMain.handle('automation-demo:manager-click', function (event, profileId, imageX, imageY) {
      if (
        !_isManagerSender(event) ||
        typeof profileId !== 'string' ||
        !store.get(profileId) ||
        typeof _handlers.clickAutomationForProfile !== 'function'
      ) {
        return { ok: false, error: 'automation-unavailable' };
      }
      if (
        typeof imageX !== 'number' ||
        !Number.isFinite(imageX) ||
        typeof imageY !== 'number' ||
        !Number.isFinite(imageY)
      ) {
        return { ok: false, error: 'invalid-coordinate-type' };
      }
      return Promise.resolve(_handlers.clickAutomationForProfile(profileId, imageX, imageY)).catch(
        function () {
          return { ok: false, error: 'click-failed' };
        }
      );
    });

    ipcMain.handle('automation-demo:manager-recording-get', function (event, profileId) {
      if (
        !_isManagerSender(event) ||
        typeof profileId !== 'string' ||
        !store.get(profileId) ||
        typeof _handlers.getAutomationRecordingForProfile !== 'function'
      ) {
        return { ok: false, error: 'automation-unavailable' };
      }
      return Promise.resolve(_handlers.getAutomationRecordingForProfile(profileId)).catch(
        function () {
          return { ok: false, error: 'recording-load-failed' };
        }
      );
    });

    ipcMain.handle('automation-demo:manager-recording-begin', function (event, profileId) {
      if (
        !_isManagerSender(event) ||
        typeof profileId !== 'string' ||
        !store.get(profileId) ||
        typeof _handlers.beginAutomationRecordingForProfile !== 'function'
      ) {
        return { ok: false, error: 'automation-unavailable' };
      }
      return Promise.resolve(_handlers.beginAutomationRecordingForProfile(profileId)).catch(
        function () {
          return { ok: false, error: 'recording-begin-failed' };
        }
      );
    });

    ipcMain.handle(
      'automation-demo:manager-record-point',
      function (event, profileId, imageX, imageY) {
        if (
          !_isManagerSender(event) ||
          typeof profileId !== 'string' ||
          !store.get(profileId) ||
          typeof _handlers.recordAutomationPointForProfile !== 'function'
        ) {
          return { ok: false, error: 'automation-unavailable' };
        }
        if (
          typeof imageX !== 'number' ||
          !Number.isFinite(imageX) ||
          typeof imageY !== 'number' ||
          !Number.isFinite(imageY)
        ) {
          return { ok: false, error: 'invalid-coordinate-type' };
        }
        return Promise.resolve(
          _handlers.recordAutomationPointForProfile(profileId, imageX, imageY)
        ).catch(function () {
          return { ok: false, error: 'record-point-failed' };
        });
      }
    );

    ipcMain.handle('automation-demo:manager-recording-clear', function (event, profileId) {
      if (
        !_isManagerSender(event) ||
        typeof profileId !== 'string' ||
        !store.get(profileId) ||
        typeof _handlers.clearAutomationRecordingForProfile !== 'function'
      ) {
        return { ok: false, error: 'automation-unavailable' };
      }
      return Promise.resolve(_handlers.clearAutomationRecordingForProfile(profileId)).catch(
        function () {
          return { ok: false, error: 'recording-clear-failed' };
        }
      );
    });

    ipcMain.handle('automation-demo:manager-run-script', function (event, profileId) {
      if (
        !_isManagerSender(event) ||
        typeof profileId !== 'string' ||
        !store.get(profileId) ||
        typeof _handlers.runAutomationDemoForProfile !== 'function'
      ) {
        return { ok: false, error: 'automation-unavailable' };
      }
      return Promise.resolve(_handlers.runAutomationDemoForProfile(profileId)).catch(function () {
        return { ok: false, error: 'demo-script-failed' };
      });
    });
  }

  if (FlashProbeRuntime.isEnabled()) {
    ipcMain.handle('flash-probe:snapshot', function (event) {
      if (!event || !event.sender || typeof _handlers.snapshotFlashProbeForSender !== 'function') {
        return { ok: false, error: 'flash-probe-unavailable' };
      }
      return Promise.resolve(_handlers.snapshotFlashProbeForSender(event.sender)).catch(
        function () {
          return { ok: false, error: 'snapshot-failed' };
        }
      );
    });
  }

  // ── Memory ──
  ipcMain.handle('memory:stats', function () {
    return mg.getStats();
  });
  ipcMain.handle('memory:force-gc', function () {
    return mg.collect({ manual: true });
  });
  ipcMain.handle('memory:webview-stats', function () {
    return mg.getWebviewStats();
  });

  // ── Diagnostics exporter (v4.9.2) ──
  const diagnostics = require('../../utils/diagnostics');
  ipcMain.handle('diagnostics:export', async function () {
    try {
      const result = await diagnostics.exportZip(_getWin());
      if (result.ok) {
        _send('profile:toast', {
          type: 'success',
          msg:
            '诊断包已导出（' +
            Math.round(result.size / 1024) +
            'KB，' +
            result.entries +
            ' 个文件）'
        });
      } else if (!result.canceled) {
        _send('profile:toast', { type: 'error', msg: '诊断包导出失败：' + result.error });
      }
      return result;
    } catch (e) {
      _send('profile:toast', { type: 'error', msg: '诊断导出失败：' + e.message });
      return { ok: false, error: e.message };
    }
  });

  // ── 安全网络元数据 Inspector ──
  const inspector = require('../../network/inspector');

  ipcMain.handle('inspector:enable', function (_e, profileId) {
    if (typeof profileId !== 'string') return { ok: false, error: 'Invalid profileId' };
    try {
      const profile = store.get(profileId);
      if (!profile) return { ok: false, error: 'Profile not found' };
      const partName = partition.getPartitionName(profile);
      const ses = session.fromPartition(partName);
      let insp = _inspectors.get(profileId);
      if (!insp) {
        insp = inspector.create(ses, profileId);
        _inspectors.set(profileId, insp);
      }
      insp.enable();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('inspector:disable', function (_e, profileId) {
    if (typeof profileId !== 'string') return { ok: false, error: 'Invalid profileId' };
    const insp = _inspectors.get(profileId);
    if (insp) {
      insp.disable();
      _inspectors.delete(profileId); // 释放安全元数据 entries
    }
    return { ok: true };
  });

  ipcMain.handle('inspector:entries', function (_e, profileId, filter) {
    if (typeof profileId !== 'string') return { ok: true, data: { entries: [], stats: null } };
    if (
      filter !== null &&
      filter !== undefined &&
      (typeof filter !== 'object' || Array.isArray(filter))
    ) {
      return { ok: true, data: { entries: [], stats: null } };
    }
    const insp = _inspectors.get(profileId);
    if (!insp) return { ok: true, data: { entries: [], stats: null } };
    const safeEntries = insp.getEntries(filter).map(function (entry) {
      return diagnostics._sanitizeEvent(entry);
    });
    return { ok: true, data: { entries: safeEntries, stats: null } };
  });

  ipcMain.handle('inspector:clear', function (_e, profileId) {
    if (typeof profileId !== 'string') return { ok: false, error: 'Invalid profileId' };
    const insp = _inspectors.get(profileId);
    if (insp) insp.clear();
    return { ok: true };
  });

  // ── DevTools helpers (v4.9.1) ──
  const gameLauncher = require('../game-launcher');
  ipcMain.handle('dev:reload-game', function (_e, profileId) {
    if (typeof profileId !== 'string') return { ok: false, error: 'Invalid profileId' };
    try {
      const wc = gameLauncher.getWebContents(profileId);
      if (!wc || wc.isDestroyed()) return { ok: false, error: 'Window is not open' };
      wc.reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('dev:toggle-devtools', function (_e, profileId) {
    if (typeof profileId !== 'string') return { ok: false, error: 'Invalid profileId' };
    try {
      const wc = gameLauncher.getWebContents(profileId);
      if (!wc || wc.isDestroyed()) return { ok: false, error: 'Window is not open' };
      wc.toggleDevTools();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── i18n ──
  const i18n = require('../../config/i18n');
  ipcMain.handle('i18n:get-lang', function () {
    return i18n.getLanguage();
  });
  ipcMain.handle('i18n:set-lang', function (_e, lang) {
    if (typeof lang !== 'string' || !i18n.SUPPORTED.includes(lang)) return i18n.getLanguage();
    i18n.setLanguage(lang);
    return i18n.getLanguage();
  });
  ipcMain.handle('i18n:get-all', function () {
    return i18n.getAll();
  });
  ipcMain.handle('i18n:t', function (_e, key) {
    if (typeof key !== 'string') return '';
    return i18n.t(key);
  });

  // ── Export / Import ──
  ipcMain.handle('profiles:export', function () {
    return store.exportJSON();
  });

  ipcMain.handle('profiles:import', function (_e, jsonStr) {
    if (typeof jsonStr !== 'string' || jsonStr.length > 2 * 1024 * 1024) {
      return { imported: 0, error: 'Invalid or too large import data' };
    }
    const res = store.importJSON(jsonStr);
    _pushProfiles();
    return res;
  });

  ipcMain.handle('profiles:export-file', async function () {
    const win = _getWin();
    if (!win) return { ok: false };
    const json = store.exportJSON();
    const result = await dialog.showSaveDialog(win, {
      title: '导出 Profile',
      defaultPath: 'naruto-online-profiles.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      fs.writeFileSync(result.filePath, json, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('profiles:import-file', async function () {
    const win = _getWin();
    if (!win) return { ok: false, imported: 0 };
    const result = await dialog.showOpenDialog(win, {
      title: '导入 Profile',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, imported: 0 };
    try {
      const filePath = result.filePaths[0];
      const stat = fs.statSync(filePath);
      if (stat.size > 10 * 1024 * 1024)
        return { ok: false, error: 'File too large (max 10MB)', imported: 0 };
      const raw = fs.readFileSync(filePath, 'utf8');
      const res = store.importJSON(raw);
      _pushProfiles();
      return { ok: true, imported: res.imported, skipped: res.skipped };
    } catch (e) {
      return { ok: false, error: e.message, imported: 0 };
    }
  });

  // Inicia o broadcast periódico de estado (listeners + timer 30s)
  StateBroadcaster.startAutoRefresh();
}

/**
 * Lança o jogo para um perfil (delegado ao game-launcher) com tracking de
 * launchCount + totalPlayMs via store.
 * @param {string} profileId
 * @param {Function} [onOpened]
 * @param {Function} [onClosed]
 */
function launchProfile(profileId, onOpened, onClosed) {
  const gameLauncher = require('../game-launcher');
  gameLauncher.launchProfile(
    profileId,
    function () {
      store.incrementLaunch(profileId);
      // v5.5: registra no launch log para timeline (não pode quebrar o launch)
      try {
        store.recordLaunch(profileId);
      } catch (e) {
        logger.warn('IpcRouter: recordLaunch failed: ' + e.message);
      }
      _launchTimes.set(profileId, Date.now());
      _pushProfiles();
      if (onOpened) onOpened();
    },
    function () {
      const startTime = _launchTimes.get(profileId);
      if (startTime) {
        const playMs = Date.now() - startTime;
        store.addPlayTime(profileId, playMs);
        _launchTimes.delete(profileId);
      }
      _pushProfiles();
      if (onClosed) onClosed();
    }
  );
}

module.exports = {
  registerIpcHandlers: registerIpcHandlers,
  launchProfile: launchProfile
};
