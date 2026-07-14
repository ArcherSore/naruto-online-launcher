/**
 * memory/guard.js — MemoryGuard: GC adaptativo (Modo Batata + Ramen Mode)
 * v3.0.0
 *
 * REAVALIAÇÃO HONESTA (evolução do v2.1):
 *   v2.1 removeu a "camada 1" (JS gc() via executeJavaScript em cada webview)
 *   porque era marginal. MANTIDO: 2 camadas efetivas.
 *
 * NOVIDADES v3.0:
 *   - process.gc(true) AGORA funciona em TODOS os platforms (main/flags.js
 *     garante --expose-gc globalmente; antes era perdido por conflito de flags).
 *   - RAMEN MODE: RAM < 2GB → sinaliza UI para suprimir manager window
 *     (economiza ~45MB). isRamen() exportado.
 *   - Sincroniza Modo Batata com profiles/partition.js (shadow partitions).
 *   - Stats incluem systemRAM e ramen flag para o dashboard.
 *
 * CAMADAS EFETIVAS:
 *   1. session.clearCache() + clearStorageData(cachestorage,shadercache)
 *      — limpa cache do Chromium em default + todas as partitions de perfil.
 *   2. process.gc(true) (major GC do V8, libera heap não-usado) +
 *      EmptyWorkingSet (Win via PowerShell) — devolve páginas ao SO.
 *
 * ROBUSTEZ:
 *   - setInterval com .unref() — não mantém o loop vivo sozinho.
 *   - Cleanup no will-quit (clearInterval).
 *   - Todas as async ops com .catch() — nunca unhandled rejection.
 *   - PowerShell spawn com timeout 5s + kill do child após 6s.
 *   - Throttle anti-thrashing: nunca GC mais de 1x por 30s.
 */

'use strict';

const os = require('os');
const { session } = require('electron');
const logger = require('../utils/logger');

const TOTAL_RAM_GB = os.totalmem() / (1024 * 1024 * 1024);
const IS_LOW_SPEC = TOTAL_RAM_GB < 4;   // Modo Batata auto-detect
const IS_RAMEN = TOTAL_RAM_GB < 2;       // Ramen Mode — manager-only (sem UI)

const CONFIG = {
  normal: { intervalMs: 5 * 60 * 1000, thresholdMB: 700, preventiveGC: false },
  batata: { intervalMs: 2 * 60 * 1000, thresholdMB: 450, preventiveGC: true },
};
const MODE = IS_LOW_SPEC ? CONFIG.batata : CONFIG.normal;
const THROTTLE_MS = 30 * 1000;

let _thresholdMB = MODE.thresholdMB;
let _intervalMs = MODE.intervalMs;
let _preventive = MODE.preventiveGC;
let _forceBatata = false;
let _timer = null;
let _lastGC = 0;
let _memListeners = [];
let _gcListeners = [];

// ── Telemetria (cron-review-4) ──
// Contadores para o painel de Desempenho em Configurações (uptime + crashes + GCs)
const _startedAt = Date.now();
let _crashCount = 0;
let _manualGCCount = 0;
let _autoGCCount = 0;

// ── Anti-reentrada (cron-review-4) ──
// collect() é async com múltiplos awaits. Se chamado concorrentemente
// (ex: botão 'Forçar GC' no painel de Desempenho + auto-trigger do daemon), as duas
// instâncias podem acumular session.clearCache() concorrentes.
// Flag _collecting bloqueia reentrada — segunda chamada retorna early.
let _collecting = false;

/**
 * Registra um crash de processo filho (chamado por main.js em gpu-process-crashed,
 * child-process-gone, e por game-launcher.js em render-process-gone).
 * Não bloqueia o app — apenas conta para telemetria.
 */
function reportCrash() {
  _crashCount++;
  logger.warn('MemoryGuard: crash registrado (total: ' + _crashCount + ')');
}

function isBatata() { return _forceBatata || IS_LOW_SPEC; }
function isRamen() { return IS_RAMEN; }

function getThreshold() { return _thresholdMB; }

function setThreshold(mb) {
  _thresholdMB = Math.max(200, Math.min(4096, Math.floor(mb)));
  logger.info('MemoryGuard: threshold = ' + _thresholdMB + 'MB');
}

/**
 * Força Modo Batata (override). Sincroniza com partition.js.
 * @param {boolean} force
 */
function setForceBatata(force) {
  _forceBatata = !!force;
  const m = isBatata() ? CONFIG.batata : CONFIG.normal;
  _intervalMs = m.intervalMs;
  _thresholdMB = m.thresholdMB;
  _preventive = m.preventiveGC;

  // Sincroniza shadow partitions com o estado batata
  try {
    const partition = require('../profiles/partition');
    partition.setBatataMode(isBatata());
  } catch (_) { /* partition module may not be loaded yet — ok */ }

  if (_timer) { stop(); start(); }
  logger.info('MemoryGuard: Modo Batata = ' + isBatata() + ' (interval ' + _intervalMs + 'ms, threshold ' + _thresholdMB + 'MB)');
}

/**
 * Snapshot da memória do processo principal (RSS).
 * @returns {{totalMB:number, thresholdMB:number, isBatata:boolean, isRamen:boolean, systemRAM:number, timestamp:number}}
 */
function getStats() {
  let totalMB = 0;
  try {
    // BUGFIX v4.0.2: antes usava process.getProcessMemoryInfo() e acessava
    // mem.residentSet — propriedade que NÃO existe nesse retorno (retorna
    // workingSetSize, privateBytes, etc em KB). Resultado: totalMB sempre 0,
    // painel de Desempenho mostrava "0 MB" e GC logava "0MB → 0MB".
    // Correção: usar process.memoryUsage() do Node.js (rss em bytes → MB).
    const mu = process.memoryUsage();
    if (mu && typeof mu.rss === 'number') {
      totalMB = Math.round(mu.rss / 1024 / 1024);
    }
  } catch (e) {
    logger.debug('MemoryGuard: memoryUsage() falhou: ' + e.message);
  }
  const uptimeMs = Date.now() - _startedAt;
  return {
    totalMB: totalMB,
    thresholdMB: _thresholdMB,
    isBatata: isBatata(),
    isRamen: isRamen(),
    systemRAM: Math.round(TOTAL_RAM_GB * 10) / 10,
    timestamp: Date.now(),
    // Telemetria (cron-review-4)
    uptimeMs: uptimeMs,
    uptimeHours: Math.round(uptimeMs / 3600000 * 10) / 10,
    crashCount: _crashCount,
    manualGCCount: _manualGCCount,
    autoGCCount: _autoGCCount,
    totalGCCount: _manualGCCount + _autoGCCount,
    startedAt: _startedAt,
  };
}

/**
 * Coleta forçada — 2 camadas efetivas. Nunca lança.
 * Anti-reentrada (cron-review-4): flag _collecting bloqueia chamadas concorrentes.
 * @param {Object} [opts] - { manual: boolean } para telemetria
 * @returns {Promise<{beforeMB:number, afterMB:number, savedMB:number, throttled:boolean, busy?:boolean}>}
 */
async function collect(opts) {
  // Anti-reentrada: se já está coletando, retorna early
  if (_collecting) {
    logger.debug('MemoryGuard: collect() já em execução — skip');
    return { busy: true };
  }

  const now = Date.now();
  if (now - _lastGC < THROTTLE_MS) {
    logger.debug('MemoryGuard: GC throttled (último há ' + Math.round((now - _lastGC) / 1000) + 's)');
    return { throttled: true };
  }
  _lastGC = now;
  _collecting = true;

  const isManual = !!(opts && opts.manual);

  try {
    const before = getStats().totalMB;

    // Camada 1: session.clearCache + cachestorage em default + todas partitions de perfil
    try {
      await session.defaultSession.clearCache().catch(function () {});
      await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'shadercache'] }).catch(function () {});

      const store = require('../profiles/store');
      const profiles = store.getAll();
      for (let i = 0; i < profiles.length; i++) {
        try {
          const partition = require('../profiles/partition');
          const partName = partition.getPartitionName(profiles[i]);
          const ps = session.fromPartition(partName);
          await ps.clearCache().catch(function () {});
          await ps.clearStorageData({ storages: ['cachestorage', 'shadercache'] }).catch(function () {});
        } catch (_) { /* partition pode não estar carregada — ok */ }
      }
    } catch (e) {
      logger.debug('MemoryGuard: camada 1 (clearCache) erro: ' + e.message);
    }

    // Camada 2: V8 major GC (cross-platform, agora que --expose-gc é global) + OS trim
    try {
      if (typeof process.gc === 'function') {
        process.gc(true); // major GC — libera heap não-usado
      }
    } catch (e) {
      logger.debug('MemoryGuard: process.gc falhou: ' + e.message);
    }

    try {
      if (process.platform === 'win32') {
        await _emptyWorkingSetWindows();
      }
      // Linux: process.gc(true) acima já cobre; malloc_trim real exigiria N-API.
    } catch (e) {
      logger.debug('MemoryGuard: camada 2 (OS trim) erro: ' + e.message);
    }

    await new Promise(function (r) { setTimeout(r, 200); });
    const after = getStats().totalMB;
    const saved = before - after;

    // Telemetria: conta manual vs auto (cron-review-4)
    if (isManual) _manualGCCount++; else _autoGCCount++;

    // Delta com sinal correto: freed → (-NMB), grew → (+NMB), flat → (±0MB).
    // Antes era sempre '(-' + saved, o que produzia '--1MB' quando a RAM crescia.
    var deltaStr = saved > 0 ? '(-' + saved + 'MB)' : saved < 0 ? '(+' + (-saved) + 'MB)' : '(±0MB)';
    logger.info('MemoryGuard: GC ' + before + 'MB → ' + after + 'MB ' + deltaStr + (isBatata() ? ' [BATATA]' : '') + (isManual ? ' [MANUAL]' : ''));

    const result = { beforeMB: before, afterMB: after, savedMB: saved, throttled: false, timestamp: now };
    _gcListeners.forEach(function (cb) { try { cb(result); } catch (_) { /* ignore */ } });

    return result;
  } finally {
    // cron-review-4: garante liberação da flag mesmo em caso de exceção não-capturada
    _collecting = false;
  }
}

/**
 * Windows: EmptyWorkingSet via PowerShell (psapi.dll).
 * Spawn com timeout de 5s e kill do child.
 */
function _emptyWorkingSetWindows() {
  return new Promise(function (resolve) {
    const { exec } = require('child_process');
    const child = exec(
      'powershell -NoProfile -Command "[psapi]::EmptyWorkingSet([diagnostics.process]::GetCurrentProcess().Handle)"',
      { timeout: 5000, windowsHide: true },
      function () { resolve(); }
    );
    setTimeout(function () {
      try { child.kill(); } catch (_) { /* ignore */ }
      resolve();
    }, 6000);
  });
}

function onMemoryUpdate(cb) { if (typeof cb === 'function') _memListeners.push(cb); }
function onGC(cb) { if (typeof cb === 'function') _gcListeners.push(cb); }

function _notify() {
  const stats = getStats();
  _memListeners.forEach(function (cb) { try { cb(stats); } catch (_) { /* ignore */ } });
}

/**
 * Inicia o daemon. A cada _intervalMs: notifica stats; se > threshold OU
 * batata preventive, chama collect().
 */
function start() {
  if (_timer) return;
  logger.info('MemoryGuard: daemon iniciado — interval ' + (_intervalMs / 1000) + 's, threshold ' + _thresholdMB + 'MB, batata=' + isBatata() + ', ramen=' + isRamen());

  _timer = setInterval(function () {
    const stats = getStats();
    _notify();
    const shouldGC = stats.totalMB > _thresholdMB || (isBatata() && _preventive);
    if (shouldGC) {
      collect().catch(function (e) {
        logger.error('MemoryGuard: auto-collect falhou: ' + e.message);
      });
    }
  }, _intervalMs);

  if (_timer.unref) _timer.unref();
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('MemoryGuard: daemon parado');
  }
  // Para também o daemon de injeção de window.gc() nas webviews
  stopWebviewGC();
}

// ═══════════════════════════════════════════════════════════════════════════
// CAMADA 0 (DESATIVADA v4.9.1) — Injeção de window.gc() em webviews ativas
// ═══════════════════════════════════════════════════════════════════════════
//
// REMOÇÃO HONESTA (v4.9.1):
//   O usuário reportou TELA PRETA no jogo. Investigação confirmou: o Flash
//   PPAPI roda no renderer process do Electron. Injetar window.gc(true) nesse
//   renderer faz um V8 major GC que PAUSA toda a thread do renderer — incluindo
//   o plugin Flash. Em sessões longas, isso causa o Flash perder o state de
//   render → tela preta. O "custo de 150-400ms" assumido em v3.1 era otimista;
//   na prática o Flash não tolera pausas do V8.
//
//   As funções são mantidas como NO-OP pra não quebrar o manager.js (que chama
//   registerGameWebContents/unregisterGameWebContents). Mas startWebviewGC()
//   não inicia mais o daemon, e injectGC() não executa mais gc().
//
//   A Camada 2 (process.gc() no main) continua ativa — essa é segura porque
//   não afeta o renderer. O MemoryGuard ainda gerencia RAM do processo main.

// v4.9.1: daemon DESATIVADO — constants mantidas só pra getWebviewStats() não quebrar
const WEBVIEW_GC_INTERVAL_NORMAL = 15 * 60 * 1000;
const WEBVIEW_GC_INTERVAL_BATATA = 7 * 60 * 1000;
// v4.9.1: WEBVIEW_GC_PRESSURE_THRESHOLD_MB removido (daemon desativado)

// Map: profileId -> { webContents, ref (WeakRef opcional), lastGC, collected }
const _webviewRegistry = new Map();
let _webviewGCTimer = null;

/**
 * Registra um webContents de jogo para injeção periódica de window.gc().
 * Chamado pelo ProfileManager.launch() quando a janela abre.
 * @param {string} profileId
 * @param {Electron.WebContents} webContents
 */
function registerGameWebContents(profileId, webContents) {
  if (!profileId || !webContents) return;
  // Se já existe, atualiza a referência
  _webviewRegistry.set(profileId, {
    webContents: webContents,
    lastGC: 0,
    collected: 0,
    registeredAt: Date.now(),
  });
  logger.info('MemoryGuard: webview registrada para GC — ' + profileId);

  // Auto-desregistro quando a webContents for destruída
  try {
    webContents.once('destroyed', function () {
      _webviewRegistry.delete(profileId);
      logger.info('MemoryGuard: webview removida (destroyed) — ' + profileId);
    });
  } catch (_) { /* ignore */ }
}

/**
 * Desregistra um webContents (chamado quando a janela fecha).
 * @param {string} profileId
 */
function unregisterGameWebContents(profileId) {
  if (_webviewRegistry.has(profileId)) {
    _webviewRegistry.delete(profileId);
    logger.info('MemoryGuard: webview desregistrada — ' + profileId);
  }
}

/**
 * Injeta window.gc(true) em uma webview específica.
 * v4.9.1: DESATIVADO — causava tela preta no Flash (GC pausa o renderer).
 * Mantido como no-op pra não quebrar callers. Retorna ok:true sem fazer nada.
 * @param {string} profileId
 * @returns {Promise<{ok:boolean, savedMB?:number, error?:string}>}
 */
async function injectGC() {
  // NO-OP v4.9.1: window.gc() no renderer pausa o Flash PPAPI → tela preta.
  return { ok: true, savedMB: 0, disabled: true };
}

/**
 * Inicia o daemon de injeção de window.gc() em todas as webviews ativas.
 * v4.9.1: DESATIVADO — o daemon causava tela preta periódica no Flash.
 * Mantido como no-op pra não quebrar main.js (que chama startWebviewGC()).
 */
function startWebviewGC() {
  // NO-OP v4.9.1: daemon desativado pra evitar tela preta no Flash.
  logger.info('MemoryGuard: daemon window.gc() DESATIVADO (v4.9.1 — causava tela preta no Flash)');
}

/**
 * Para o daemon de injeção de window.gc().
 */
function stopWebviewGC() {
  if (_webviewGCTimer) {
    clearInterval(_webviewGCTimer);
    _webviewGCTimer = null;
    logger.info('MemoryGuard: daemon window.gc() parado');
  }
}

/**
 * Retorna estatísticas do registry de webviews (para o dashboard).
 * @returns {{active:number, totalGCs:number, lastGCAt:number|null}}
 */
function getWebviewStats() {
  let totalGCs = 0;
  let lastGCAt = 0;
  _webviewRegistry.forEach(function (entry) {
    totalGCs += entry.collected;
    if (entry.lastGC > lastGCAt) lastGCAt = entry.lastGC;
  });
  return {
    active: _webviewRegistry.size,
    totalGCs: totalGCs,
    lastGCAt: lastGCAt || null,
    intervalMin: Math.round((isBatata() ? WEBVIEW_GC_INTERVAL_BATATA : WEBVIEW_GC_INTERVAL_NORMAL) / 60000),
  };
}

module.exports = {
  getStats: getStats,
  collect: collect,
  start: start,
  stop: stop,
  setThreshold: setThreshold,
  getThreshold: getThreshold,
  setForceBatata: setForceBatata,
  isBatata: isBatata,
  isRamen: isRamen,
  onMemoryUpdate: onMemoryUpdate,
  onGC: onGC,
  // v3.1 — Injeção de window.gc() em webviews ativas
  registerGameWebContents: registerGameWebContents,
  unregisterGameWebContents: unregisterGameWebContents,
  injectGC: injectGC,
  startWebviewGC: startWebviewGC,
  stopWebviewGC: stopWebviewGC,
  getWebviewStats: getWebviewStats,
  // v3.2 — Telemetria (cron-review-4)
  reportCrash: reportCrash,
  IS_LOW_SPEC: IS_LOW_SPEC,
  IS_RAMEN: IS_RAMEN,
  SYSTEM_RAM_GB: Math.round(TOTAL_RAM_GB * 10) / 10,
};
