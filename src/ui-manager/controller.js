/**
 * ui-manager/controller.js — Bridge IPC entre renderer (index.html) e main
 * v3.0.0
 *
 * Cria a janela de gerenciamento (dashboard de contas) e faz o bridge IPC
 * para os subsistemas: profileStore, memoryGuard, eventTimers, vault,
 * partition. A janela usa nodeIntegration (UI interna confiável — só carrega
 * nosso index.html local, nunca conteúdo remoto).
 *
 * v3.0 MUDANÇAS:
 *   - Usa profiles/store.js (não o antigo manager.js)
 *   - Suporte a vault (credenciais) e shadow partitions
 *   - Export/import JSON via IPC
 *   - Push de estado de Modo Batata / Ramen para a UI
 *   - launchProfile delega ao game-launcher com callbacks de hide/show manager
 */

'use strict';

const path = require('path');
const { BrowserWindow, ipcMain, dialog } = require('electron');
const logger = require('../utils/logger');
const store = require('../profiles/store');
const mg = require('../memory/guard');
const et = require('../utilities/event-timers');
const vault = require('../profiles/vault');
const partition = require('../profiles/partition');

let managerWindow = null;
let _handlers = {};
let _pushTimer = null;
// v3.6.2: Guards anti-duplicação de listeners
let _memCb = null, _gcCb = null, _remindCb = null;
// v4.5: Mapa profileId -> launchStartTime (ms) para tracking de tempo de jogo
const _launchTimes = new Map();

/**
 * Cria a janela de gerenciamento.
 */
function createManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.focus();
    return managerWindow;
  }

  managerWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 760,
    minHeight: 580,
    title: 'Shinobi Launcher',
    backgroundColor: '#0f0f14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,        // UI interna confiável (só carrega index.html local)
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  managerWindow.loadFile(path.join(__dirname, 'index.html'));

  managerWindow.once('ready-to-show', function () {
    managerWindow.show();
    logger.info('UI Manager exibida');
    _pushAll();
  });

  // v3.3: SEM TRAY — close behavior inteligente.
  // Se há janelas de jogo abertas: hide (não quit, jogo ainda roda).
  // Se não há jogo: permite close → window-all-closed → app.quit().
  managerWindow.on('close', function (e) {
    const gameLauncher = require('./game-launcher');
    if (gameLauncher.hasOpenWindows()) {
      // Jogo rodando: apenas esconde, volta quando o jogo fechar
      e.preventDefault();
      managerWindow.hide();
      logger.info('Manager oculto (jogo rodando) — volta quando o jogo fechar');
    }
    // else: permite close → dispara window-all-closed → app.quit()
  });

  managerWindow.on('closed', function () { managerWindow = null; });

  return managerWindow;
}

function getManagerWindow() { return managerWindow; }

function showManager() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show();
    managerWindow.focus();
    _pushAll();
  } else {
    createManagerWindow();
  }
}

function hideManager() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.hide();
  }
}

// ── Push helpers ──

function _send(channel, payload) {
  if (!managerWindow || managerWindow.isDestroyed()) return;
  try { managerWindow.webContents.send(channel, payload); } catch (_) { /* ignore */ }
}

function _pushProfiles() {
  const list = store.getAll().map(function (p) {
    return Object.assign({}, p, {
      hasVault: vault.hasCredentials(p.id),
      shadow: partition.shouldUseShadow(p),
    });
  });
  _send('profiles:updated', list);
}

function _pushMemory() { _send('memory:update', mg.getStats()); }
function _pushEvents(region) {
  const regions = region ? [region] : _activeRegions();
  const all = {};
  regions.forEach(function (r) { all[r] = et.getUpcoming(r); });
  _send('events:update', { byRegion: all, userOffset: et.getUserOffsetHours() });
}

function _pushAll() {
  _pushProfiles();
  _pushMemory();
  _pushEvents();
}

function _activeRegions() {
  const seen = [];
  store.getAll().forEach(function (p) { if (p.region && seen.indexOf(p.region) === -1) seen.push(p.region); });
  return seen.length ? seen : ['br'];
}

// ── IPC registration ──

function registerIpcHandlers(handlers) {
  _handlers = handlers || {};

  ipcMain.on('manager:ready', function () { _pushAll(); });

  // ── Profile CRUD ──
  ipcMain.on('profile:create', function (_e, opts) {
    const p = store.create(opts);
    if (p) {
      _pushProfiles();
      _pushEvents();
    } else {
      _send('profile:toast', { type: 'error', msg: 'Limite de ' + store.MAX_PROFILES + ' contas atingido' });
    }
  });

  ipcMain.handle('profile:get', function (_e, id) { return store.get(id); });

  ipcMain.on('profile:update', function (_e, data) {
    store.update(data.id, data);
    _pushProfiles();
    _pushEvents();
  });

  ipcMain.on('profile:delete', function (_e, id) {
    // Validação de input (cron-review-2): se profile não existe, não operar
    // e avisar o usuário (antes: chamava vault/partition/store.remove em cascata
    // mesmo com id inválido → toast enganoso "Conta removida")
    if (typeof id !== 'string' || !store.get(id)) {
      _send('profile:toast', { type: 'error', msg: 'Perfil não encontrado (id inválido)' });
      return;
    }
    vault.removeCredentials(id);
    partition.removeSnapshot(id);
    store.remove(id);
    _pushProfiles();
    _send('profile:toast', { type: 'info', msg: 'Conta removida (dados + cookies apagados)' });
  });

  ipcMain.on('profile:launch', function (_e, id) {
    // Validação de input (cron-review-2): id deve ser string e perfil deve existir
    if (typeof id !== 'string' || !store.get(id)) {
      _send('profile:toast', { type: 'error', msg: 'Perfil não encontrado' });
      return;
    }
    if (_handlers.launchProfile) _handlers.launchProfile(id);
  });

  // v4.5: Estatísticas de uso do perfil (launch count, play time, last used)
  ipcMain.handle('profile:get-stats', function (_e, id) {
    if (typeof id !== 'string') return null;
    return store.getStats(id);
  });

  // v4.5: Atualizar notes do perfil (string, max 200 chars)
  ipcMain.on('profile:update-notes', function (_e, data) {
    if (typeof data !== 'object' || typeof data.id !== 'string' || typeof data.notes !== 'string') return;
    store.update(data.id, { notes: data.notes.slice(0, 200) });
    _pushProfiles();
  });

  // v4.6: Profile duplication — clones a profile (without credentials/vault)
  ipcMain.handle('profile:duplicate', function (_e, id) {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id' };
    const src = store.get(id);
    if (!src) return { ok: false, error: 'Profile not found' };
    const copy = store.create({
      name: String(src.name) + ' (cópia)',
      server: src.server,
      region: src.region,
      language: src.language,
      color: src.color,
      notes: src.notes || '',
    });
    if (!copy) return { ok: false, error: 'Max profiles reached' };
    logger.info('Profile duplicated: ' + src.name + ' → ' + copy.name);
    _pushProfiles();
    return { ok: true, profile: copy };
  });

  // v4.6: Profile favorite toggle (persisted in localStorage on renderer side,
  // but we also store a server-side flag for backup portability)
  ipcMain.handle('profile:set-favorite', function (_e, id, fav) {
    if (typeof id !== 'string') return false;
    return store.update(id, { favorite: fav === true });
  });

  // v4.5: Status de auto-login em tempo real (pushed do game-launcher para a UI)
  ipcMain.on('auto-login:status', function (_e, data) {
    if (!data || typeof data.profileId !== 'string') return;
    _send('auto-login:status', data);
  });

  // v4.5: Status de janela aberta (para o renderer saber qual perfil está ativo)
  ipcMain.on('game-window:status', function (_e, data) {
    if (!data || typeof data.profileId !== 'string') return;
    _send('game-window:status', data);
  });

  // ── Vault (credenciais) — v3.6.2: validação de tipo ──
  ipcMain.handle('vault:get', function (_e, id) {
    if (typeof id !== 'string') return null;
    return vault.getCredentials(id);
  });
  ipcMain.handle('vault:set', function (_e, id, user, pass) {
    if (typeof id !== 'string' || typeof user !== 'string' || typeof pass !== 'string') return false;
    return vault.setCredentials(id, user, pass);
  });
  ipcMain.handle('vault:remove', function (_e, id) {
    if (typeof id !== 'string') return false;
    return vault.removeCredentials(id);
  });
  ipcMain.handle('vault:has', function (_e, id) {
    if (typeof id !== 'string') return false;
    return vault.hasCredentials(id);
  });

  // ── Memory ──
  ipcMain.handle('memory:stats', function () { return mg.getStats(); });
  ipcMain.handle('memory:force-gc', function () { return mg.collect({ manual: true }); });
  ipcMain.handle('memory:webview-stats', function () { return mg.getWebviewStats(); });

  // v4.9.2: Diagnostics exporter (substitui crash-reporter — opt-in explícito)
  const diagnostics = require('../utils/diagnostics');
  ipcMain.handle('diagnostics:export', async function () {
    try {
      const result = await diagnostics.exportZip(managerWindow);
      if (result.ok) {
        _send('profile:toast', {
          type: 'success',
          msg: 'Diagnóstico exportado (' + Math.round(result.size / 1024) + 'KB, ' + result.entries + ' arquivos)'
        });
      } else if (!result.canceled) {
        _send('profile:toast', { type: 'error', msg: 'Falha ao exportar: ' + result.error });
      }
      return result;
    } catch (e) {
      _send('profile:toast', { type: 'error', msg: 'Diagnóstico falhou: ' + e.message });
      return { ok: false, error: e.message };
    }
  });

  // ── v4.9: Tempmail + API Login + Network Inspector ──
  const tempmail = require('../network/tempmail');
  const apiLogin = require('../network/api-login');
  const inspector = require('../network/inspector');
  const _inspectors = new Map(); // profileId -> inspector instance

  // Cria conta tempmail + registra no Naruto Online (sem Flash)
  ipcMain.handle('tempmail:create', async function () {
    try {
      const result = await tempmail.createNarutoAccount();
      _send('profile:toast', {
        type: 'success',
        msg: 'Conta criada: ' + result.tempmail.address + ' (player ' + result.game.nickname + ')'
      });
      return { ok: true, data: result };
    } catch (e) {
      _send('profile:toast', { type: 'error', msg: 'Tempmail falhou: ' + e.message });
      return { ok: false, error: e.message };
    }
  });

  // Login via API + injeta cookie oas_user na session do perfil
  ipcMain.handle('tempmail:login', async function (_e, profileId, email, password) {
    try {
      const profile = store.get(profileId);
      if (!profile) return { ok: false, error: 'Perfil não encontrado' };
      const partition = require('../profiles/partition');
      const partName = partition.getPartitionName(profile);
      const ses = require('electron').session.fromPartition(partName);
      const result = await apiLogin.loginAndInject(ses, email, password);
      _send('profile:toast', {
        type: 'success',
        msg: 'Login API OK — ' + result.nickname + ' (expira em ' + Math.round(result.expiresAt / 1000 - Date.now() / 1000) + 's)'
      });
      return { ok: true, data: result };
    } catch (e) {
      _send('profile:toast', { type: 'error', msg: 'Login API falhou: ' + e.message });
      return { ok: false, error: e.message };
    }
  });

  // Lista servidores recomendados pra um playerId
  ipcMain.handle('tempmail:servers', async function (_e, playerId, gamecode) {
    try {
      const servers = await tempmail.getRecommendedServers(playerId, gamecode);
      return { ok: true, data: servers };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Verifica sessão JWT atual do perfil
  ipcMain.handle('session:check', async function (_e, profileId) {
    try {
      const profile = store.get(profileId);
      if (!profile) return { ok: false, error: 'Perfil não encontrado' };
      const partition = require('../profiles/partition');
      const partName = partition.getPartitionName(profile);
      const ses = require('electron').session.fromPartition(partName);
      const status = await apiLogin.checkSession(ses);
      return { ok: true, data: status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Inspector: ativa captura de rede pra um perfil
  ipcMain.handle('inspector:enable', function (_e, profileId) {
    try {
      const profile = store.get(profileId);
      if (!profile) return { ok: false, error: 'Perfil não encontrado' };
      const partition = require('../profiles/partition');
      const partName = partition.getPartitionName(profile);
      const ses = require('electron').session.fromPartition(partName);
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
    const insp = _inspectors.get(profileId);
    if (insp) insp.disable();
    return { ok: true };
  });

  ipcMain.handle('inspector:entries', function (_e, profileId, filter) {
    const insp = _inspectors.get(profileId);
    if (!insp) return { ok: true, data: { entries: [], stats: null } };
    return { ok: true, data: { entries: insp.getEntries(filter), stats: insp.getStats() } };
  });

  ipcMain.handle('inspector:clear', function (_e, profileId) {
    const insp = _inspectors.get(profileId);
    if (insp) insp.clear();
    return { ok: true };
  });

  // ── v3.5: Server Selector ──
  const serverSelector = require('./server-selector');
  ipcMain.handle('servers:fetch', function (_e, region) {
    return serverSelector.fetchServers(region || 'br');
  });

  // ── v4.9.1: DevTools helpers — extrair fonte da página + cookies + URL ──
  const gameLauncher = require('./game-launcher');
  ipcMain.handle('dev:get-page-source', async function (_e, profileId) {
    try {
      const wc = gameLauncher.getWebContents(profileId);
      if (!wc || wc.isDestroyed()) return { ok: false, error: 'janela não está aberta' };
      const source = await wc.executeJavaScript('document.documentElement.outerHTML');
      const url = wc.getURL();
      const title = await wc.executeJavaScript('document.title').catch(function () { return ''; });
      return { ok: true, data: { url: url, title: title, source: source, size: source.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('dev:get-cookies', async function (_e, profileId) {
    try {
      const profile = store.get(profileId);
      if (!profile) return { ok: false, error: 'Perfil não encontrado' };
      const partition = require('../profiles/partition');
      const partName = partition.getPartitionName(profile);
      const ses = require('electron').session.fromPartition(partName);
      const cookies = await ses.cookies.get({});
      return { ok: true, data: cookies.map(function (c) {
        return { name: c.name, value: (c.value || '').slice(0, 80), domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly };
      }) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('dev:reload-game', function (_e, profileId) {
    try {
      const wc = gameLauncher.getWebContents(profileId);
      if (!wc || wc.isDestroyed()) return { ok: false, error: 'janela não está aberta' };
      wc.reload();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('dev:toggle-devtools', function (_e, profileId) {
    try {
      const wc = gameLauncher.getWebContents(profileId);
      if (!wc || wc.isDestroyed()) return { ok: false, error: 'janela não está aberta' };
      wc.toggleDevTools();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('servers:clear-cache', function (_e, region) {
    serverSelector.clearCache(region);
    return { ok: true };
  });

  // v4.6: i18n — expose t() and getAll() to renderer
  const i18n = require('../config/i18n');
  ipcMain.handle('i18n:get-lang', function () { return i18n.getLanguage(); });
  ipcMain.handle('i18n:set-lang', function (_e, lang) {
    i18n.setLanguage(lang);
    return i18n.getLanguage();
  });
  ipcMain.handle('i18n:get-all', function () { return i18n.getAll(); });
  ipcMain.handle('i18n:t', function (_e, key) { return i18n.t(key); });

  // ── Events ──
  ipcMain.handle('events:get', function (_e, region) { return et.getUpcoming(region || 'br'); });
  ipcMain.on('events:set-muted', function (_e, m) {
    // BUGFIX v4.0.2: antes chamava et.setMuted() AQUI E no handler do main.js,
    // causando log duplicado. Agora só o handler do main.js chama + persistConfig.
    if (_handlers.setMuted) {
      _handlers.setMuted(m);
    } else {
      et.setMuted(m);
    }
  });

  // ── Export / Import (v3.4: backup criptografado com senha mestre) ──
  ipcMain.handle('profiles:export', function () { return store.exportJSON(); });

  ipcMain.handle('profiles:import', function (_e, jsonStr) {
    const res = store.importJSON(jsonStr);
    _pushProfiles();
    _pushEvents();
    return res;
  });

  // v3.4: Backup criptografado com AES-256-GCM + PBKDF2
  ipcMain.handle('profiles:export-encrypted', async function (_e, password) {
    if (!managerWindow || managerWindow.isDestroyed()) return { ok: false, error: 'Manager window closed' };
    try {
      const profiles = store.getAll();
      // Coleta credenciais de todos os perfis
      const credentialsMap = {};
      profiles.forEach(function (p) {
        if (vault.hasCredentials(p.id)) {
          credentialsMap[p.id] = vault.getCredentials(p.id);
        }
      });
      const encrypted = vault.exportEncryptedBackup(profiles, credentialsMap, password);

      // Diálogo de salvamento
      const result = await dialog.showSaveDialog(managerWindow, {
        title: 'Exportar backup criptografado',
        defaultPath: 'shinobi-backup-' + new Date().toISOString().slice(0, 10) + '.enc',
        filters: [{ name: 'Shinobi Backup', extensions: ['enc'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };

      const fs = require('fs');
      fs.writeFileSync(result.filePath, encrypted, 'utf8');
      logger.info('Backup criptografado salvo: ' + result.filePath + ' (' + profiles.length + ' perfis)');
      return { ok: true, path: result.filePath, count: profiles.length };
    } catch (e) {
      logger.error('Export backup falhou: ' + e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('profiles:import-encrypted', async function (_e, password) {
    if (!managerWindow || managerWindow.isDestroyed()) return { ok: false, error: 'Manager window closed' };
    try {
      const result = await dialog.showOpenDialog(managerWindow, {
        title: 'Importar backup criptografado',
        filters: [{ name: 'Shinobi Backup', extensions: ['enc'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

      const fs = require('fs');
      const encrypted = fs.readFileSync(result.filePaths[0], 'utf8');
      const payload = vault.importEncryptedBackup(encrypted, password);

      // Importa perfis (merge: preserva existentes por nome+server)
      let imported = 0, skipped = 0;
      payload.profiles.forEach(function (p) {
        if (!store.get(p.id)) {
          // Recria perfil com novo ID (evita colisão)
          const newProfile = store.create({
            name: p.name,
            server: p.server,
            region: p.region,
            language: p.language,
            notificationsEnabled: p.notificationsEnabled,
            color: p.color,
          });
          if (newProfile) {
            imported++;
            // Restaura credenciais se existirem no backup
            if (payload.credentials && payload.credentials[p.id]) {
              const creds = payload.credentials[p.id];
              if (creds.user && creds.pass) {
                vault.setCredentials(newProfile.id, creds.user, creds.pass);
              }
            }
          }
        } else {
          skipped++;
        }
      });

      _pushProfiles();
      _pushEvents();
      logger.info('Backup importado: ' + imported + ' perfis, ' + skipped + ' ignorados');
      return { ok: true, imported: imported, skipped: skipped };
    } catch (e) {
      logger.error('Import backup falhou: ' + e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('profiles:export-file', async function () {
    if (!managerWindow || managerWindow.isDestroyed()) return { ok: false };
    const json = store.exportJSON();
    const result = await dialog.showSaveDialog(managerWindow, {
      title: 'Exportar perfis',
      defaultPath: 'shinobi-profiles.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const fs = require('fs');
      fs.writeFileSync(result.filePath, json, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('profiles:import-file', async function () {
    if (!managerWindow || managerWindow.isDestroyed()) return { ok: false, imported: 0 };
    const result = await dialog.showOpenDialog(managerWindow, {
      title: 'Importar perfis',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, imported: 0 };
    try {
      const fs = require('fs');
      const raw = fs.readFileSync(result.filePaths[0], 'utf8');
      const res = store.importJSON(raw);
      _pushProfiles();
      _pushEvents();
      return { ok: true, imported: res.imported, skipped: res.skipped };
    } catch (e) {
      return { ok: false, error: e.message, imported: 0 };
    }
  });

  // v3.6.2: Listeners com guard anti-duplicação (evita acúmulo se re-registrar)
  if (!_memCb) { _memCb = function () { _pushMemory(); }; mg.onMemoryUpdate(_memCb); }
  if (!_gcCb) { _gcCb = function () { _pushMemory(); }; mg.onGC(_gcCb); }
  if (!_remindCb) { _remindCb = function () { _pushEvents(); }; et.onRemind(_remindCb); }

  // Refresh event countdowns every 60s
  if (_pushTimer) clearInterval(_pushTimer);
  _pushTimer = setInterval(function () { _pushEvents(); _pushMemory(); }, 30000); // v3.5: push memory a cada 30s
  if (_pushTimer.unref) _pushTimer.unref();

  store.onChange(function () { _pushProfiles(); });
}

/**
 * Lança o jogo para um perfil (delegado ao game-launcher).
 * onOpened/onClosed callbacks para hide/show do manager (sem tray desde v3.3).
 * v4.5: Tracking de launchCount + totalPlayMs via store.
 */
function launchProfile(profileId, onOpened, onClosed) {
  const gameLauncher = require('./game-launcher');
  gameLauncher.launchProfile(profileId, function () {
    // v4.5: incrementa launchCount + registra timestamp de início
    store.incrementLaunch(profileId);
    _launchTimes.set(profileId, Date.now());
    _pushProfiles();
    if (onOpened) onOpened();
  }, function () {
    // v4.5: calcula tempo de jogo e acumula no perfil
    const startTime = _launchTimes.get(profileId);
    if (startTime) {
      const playMs = Date.now() - startTime;
      store.addPlayTime(profileId, playMs);
      _launchTimes.delete(profileId);
    }
    _pushProfiles();
    if (onClosed) onClosed();
  });
}

module.exports = {
  createManagerWindow: createManagerWindow,
  getManagerWindow: getManagerWindow,
  showManager: showManager,
  hideManager: hideManager,
  registerIpcHandlers: registerIpcHandlers,
  launchProfile: launchProfile,
};
