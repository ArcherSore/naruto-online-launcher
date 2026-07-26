/**
 * profiles/manager.js — Facade de alto nível para Perfis + Partitions
 * v3.1.0 — "ProfileManager"
 *
 * FILOSOFIA:
 *   O controller da UI não deveria conhecer a topologia interna
 *   de store.js + partition.js + game-launcher.js. Este módulo é a
 *   ÚNICA superfície pública para operações de perfil: criar, listar, lançar,
 *   fechar, deletar, isolar, credenciais, snapshot/restore de cookies.
 *
 * RESPONSABILIDADES:
 *   - CRUD de perfis (delega a store.js, mas enriquece com estado runtime:
 *     isOpen, shadow, lastWindow).
 *   - Lançamento de janelas isoladas por `session.fromPartition('persist:profile-<id>')`.
 *     Pepper Flash é injetado via app.commandLine (global, uma vez no boot) —
 *     NÃO por janela. Cada BrowserWindow com `plugins:true` herda o Flash.
 *   - O lançamento Tencent usa exclusivamente o mapeamento persistente
 *     `persist:profile-<id>` aplicado pelo Launcher/partition.js. O facade não
 *     copia, restaura ou tira snapshot de Cookies.
 *   - Registro de webContents no MemoryGuard (para injeção periódica de
 *     window.gc() a cada 10min em cada webview ativa).
 *   - Tratamento de crash: render-process-gone de uma partition NÃO derruba
 *     as outras. Cada janela é independente.
 *
 * CONTRATO IPC:
 *   O controller.js registra handlers que chamam estes métodos. O renderer
 *   nunca chama store/partition diretamente.
 *
 * ISOLAMENTO RÍGIDO (requisito do usuário):
 *   Se o jogador abrir o perfil Main e o Fake ao mesmo tempo, cada um recebe
 *   uma BrowserWindow + session.fromPartition INDEPENDENTE. O Pepper Flash de
 *   uma janela NÃO interfere no da outra porque cada session tem seu próprio
 *   plugin host. Se uma cair, a outra continua rodando lisa.
 */

'use strict';

const logger = require('../utils/logger');
const store = require('./store');
const partition = require('./partition');
const gameLauncher = require('../ui/game-launcher');

// ── Estado runtime ──
// Map: profileId -> { openedAt, lastSeenMb, crashCount }
const _runtime = new Map();

let _memoryGuard = null; // injetado via setMemoryGuard()
let _listeners = [];

/**
 * Injeta a referência do MemoryGuard (quebra a dependência circular).
 * Deve ser chamado no boot, antes de qualquer launchProfile().
 * @param {Object} mg
 */
function setMemoryGuard(mg) {
  _memoryGuard = mg;
  logger.info('ProfileManager: MemoryGuard attached');
}

/**
 * Lista perfis enriquecidos com estado runtime (isOpen, shadow).
 * @returns {Array<Object>}
 */
function list() {
  return store.getAll().map(function (p) {
    const rt = _runtime.get(p.id) || {};
    return Object.assign({}, p, {
      shadow: partition.shouldUseShadow(p),
      isOpen: gameLauncher.isProfileOpen(p.id),
      openedAt: rt.openedAt || 0,
      crashCount: rt.crashCount || 0
    });
  });
}

/**
 * Cria um novo perfil. Garante que a partition dir existe (persist) para que
 * bunshin/clone não falhe em perfis nunca lançados.
 * @param {{name:string, server:string, region:string}} opts
 * @returns {Object|null} perfil criado
 */
function create(opts) {
  const p = store.create(opts);
  if (!p) return null;
  // Eager create da partition dir (persist) — evita "user-data-dir não existe"
  // em bunshin/clone de perfil recém-criado.
  try {
    partition.ensurePartitionDir(p);
  } catch (e) {
    logger.debug('ProfileManager: ensurePartitionDir failed (allowed in shadow mode): ' + e.message);
  }
  _notify();
  return p;
}

/**
 * Atualiza metadados do perfil.
 * @param {string} id
 * @param {Object} updates
 * @returns {boolean}
 */
function update(id, updates) {
  const ok = store.update(id, updates);
  if (ok) _notify();
  return ok;
}

/**
 * Deleta um perfil COMPLETAMENTE: fecha janela e remove a entrada/partition do store.
 * @param {string} id
 * @returns {boolean}
 */
function remove(id) {
  // 1. Fecha a janela se aberta
  try {
    gameLauncher.closeProfile(id);
  } catch (_) {
    /* ignore */
  }

  // 2. Remove do store (store.remove também wipe a partition dir em disco)
  const ok = store.remove(id);

  // 3. Limpa estado runtime
  _runtime.delete(id);

  if (ok) _notify();
  return ok;
}

/**
 * Lança o jogo para um perfil. Orquestra:
 *   1. gameLauncher.launchProfile() — reutiliza o registry por Profile e cria
 *      BrowserWindow com o mapeamento persistente de partition.js.
 *   2. Registra webContents no MemoryGuard (para injeção de window.gc()).
 *   3. Trata crash: render-process-gone NÃO derruba outras janelas.
 *
 * @param {string} profileId
 * @param {Function} [onOpened]  — chamado quando a janela abre
 * @param {Function} [onClosed]  — chamado quando a janela fecha
 * @returns {boolean} true se o lançamento foi despachado
 */
function launch(profileId, onOpened, onClosed) {
  const profile = store.get(profileId);
  if (!profile) {
    logger.error('ProfileManager: profile not found profileId=' + profileId);
    return false;
  }

  // Marca último uso
  store.touch(profileId);

  // Estado runtime
  const rt = _runtime.get(profileId) || { crashCount: 0 };
  rt.openedAt = Date.now();
  _runtime.set(profileId, rt);

  // O Launcher aplica o mapeamento persistente e o registry de janela por ID.
  // Não restauramos Cookies/Vault: a Session Chromium é a única fonte de login.
  try {
    gameLauncher.launchProfile(
      profileId,
      function onOpenedInternal() {
        // Registra webContents no MemoryGuard para injeção periódica de window.gc()
        if (_memoryGuard && typeof _memoryGuard.registerGameWebContents === 'function') {
          try {
            const wc = gameLauncher.getWebContents(profileId);
            if (wc) _memoryGuard.registerGameWebContents(profileId, wc);
          } catch (e) {
            logger.debug('ProfileManager: registerGameWebContents failed: ' + e.message);
          }
        }
        if (onOpened) onOpened();
      },
      function onClosedInternal() {
        // Desregistra webContents do MemoryGuard
        if (_memoryGuard && typeof _memoryGuard.unregisterGameWebContents === 'function') {
          _memoryGuard.unregisterGameWebContents(profileId);
        }
        _runtime.delete(profileId);
        if (onClosed) onClosed();
      }
    );
    return true;
  } catch (e) {
    logger.error('ProfileManager: launch failed: ' + e.message);
    return false;
  }
}

/**
 * Fecha a janela de um perfil (sem deletar o perfil).
 * @param {string} profileId
 * @returns {boolean}
 */
function close(profileId) {
  return gameLauncher.closeProfile(profileId);
}

/**
 * Marca que uma janela de jogo sofreu crash (chamado pelo game-launcher em
 * render-process-gone). Não derruba outras janelas — isolamento rígido.
 * @param {string} profileId
 */
function reportCrash(profileId) {
  const rt = _runtime.get(profileId);
  if (rt) {
    rt.crashCount = (rt.crashCount || 0) + 1;
    rt.lastCrashAt = Date.now();
    logger.warn(
      'ProfileManager: crash reported profileId=' + profileId + ' total=' + rt.crashCount
    );
  }
}

// ── Import/Export ──

/**
 * Export all profiles as a JSON string.
 * @returns {string} JSON array of profiles
 */
function exportAll() {
  return store.exportJSON();
}

/**
 * Import profiles from a JSON string (replaces existing profiles).
 * @param {string} jsonStr - JSON array of profile objects
 * @returns {{imported: number}} import result
 */
function importAll(jsonStr) {
  const result = store.importJSON(jsonStr);
  _notify();
  return result;
}

// ── Estado runtime / observabilidade ──

/**
 * Retorna estatísticas do gerenciador (para o dashboard).
 * @returns {{total:number, open:number, shadow:number, crashes:number}}
 */
function getStats() {
  let open = 0,
    shadow = 0,
    crashes = 0;
  const all = store.getAll();
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (gameLauncher.isProfileOpen(p.id)) open++;
    if (partition.shouldUseShadow(p)) shadow++;
    const rt = _runtime.get(p.id);
    if (rt && rt.crashCount) crashes += rt.crashCount;
  }
  return {
    total: all.length,
    open: open,
    shadow: shadow,
    crashes: crashes,
    max: store.MAX_PROFILES
  };
}

/**
 * Lista IDs dos perfis atualmente abertos (para o MemoryGuard iterar).
 * @returns {Array<string>}
 */
function getOpenProfileIds() {
  return store
    .getAll()
    .filter(function (p) {
      return gameLauncher.isProfileOpen(p.id);
    })
    .map(function (p) {
      return p.id;
    });
}

/**
 * Registra listener para mudanças (UI atualiza via push).
 * @param {Function} cb
 */
function onChange(cb) {
  if (typeof cb === 'function') _listeners.push(cb);
}

function _notify() {
  const snapshot = list();
  _listeners.forEach(function (cb) {
    try {
      cb(snapshot);
    } catch (_) {
      /* ignore */
    }
  });
}

module.exports = {
  // Lifecycle
  setMemoryGuard: setMemoryGuard,
  // CRUD
  list: list,
  create: create,
  update: update,
  remove: remove,
  // Launch
  launch: launch,
  close: close,
  reportCrash: reportCrash,
  // Import/Export
  exportAll: exportAll,
  importAll: importAll,
  // Stats
  getStats: getStats,
  getOpenProfileIds: getOpenProfileIds,
  // Events
  onChange: onChange,
  // Constants
  MAX_PROFILES: store.MAX_PROFILES
};
