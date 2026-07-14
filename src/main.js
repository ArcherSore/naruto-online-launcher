/**
 * Shinobi Launcher — main.js v3.4.0
 *
 * ORQUESTRADOR PRINCIPAL (thin bootstrap)
 *
 * FILOSOFIA v3.4:
 *   Multi-região (BR/NA/EU/HK) com idioma por perfil (pt/en).
 *   Backup criptografado AES-256-GCM + PBKDF2 com senha mestre.
 *   Telemetria removida v4.9.2 — zero tracking, logs ficam no disco.
 *   Exportador de diagnóstico em Configurações → Avançado (opt-in explícito).
 *
 * ORDEM DE BOOT (CRÍTICA):
 *   1. [top-level, antes de ready] loadConfig (sync) + findFlashPlugin
 *   2. [top-level, antes de ready] core/flags.applyAll() ← ÚNICO lugar que toca commandLine
 *   3. [ready] subsystems: store.load, guard.start, eventTimers.startWithProfiles
 *   4. [ready] ui-manager.createManagerWindow()
 *
 * RECURSOS v3.4:
 *   - Multi-região: URL regional por perfil (BR/NA/EU/HK) + idioma (pt/en)
 *   - Backup criptografado: AES-256-GCM + PBKDF2 (200k iterações, SHA-512)
 *   - Telemetria deduplicada: 1 issue por tipo de crash/dia (comentários para reports adicionais)
 *   - EventTimers por perfil: notificationsEnabled flag (opt-out por conta)
 *   - Schema migration: perfis v1 → v2 automático (adiciona language + notificationsEnabled)
 *
 * ARQUITETURA:
 *   Electron 11.5.0 (ÚLTIMA com PPAPI Flash) + Clean Flash 34.0 bundled.
 *   UI em vanilla JS/HTML/CSS (zero framework dentro do Electron) = ~45MB RAM idle.
 *   Tauri NÃO roda Flash (WebView2/WebKitGTK removeram PPAPI desde Chrome 88).
 */

'use strict';

// ── MESA env migration (antes de qualquer coisa) ──
// MESA_GLSL_CACHE_DISABLE foi renomeado p/ MESA_SHADER_CACHE_DISABLE nas
// versões recentes do Mesa e emite um warning de depreciação a cada boot.
// Migramos silenciosamente preservando a intenção do usuário (se ele setou
// o nome antigo no shell). vblank_mode é intencional (vsync do usuário) —
// não tocamos.
(function _migrateMesaEnv() {
  if (process.env.MESA_GLSL_CACHE_DISABLE !== undefined &&
      process.env.MESA_SHADER_CACHE_DISABLE === undefined) {
    process.env.MESA_SHADER_CACHE_DISABLE = process.env.MESA_GLSL_CACHE_DISABLE;
  }
  delete process.env.MESA_GLSL_CACHE_DISABLE;
})();

// NOTA — warnings de Fontconfig ("invalid attribute 'xsi:nil'" /
// "invalid constant used"): são ruído do SISTEMA HOSPEDEIRO, não do launcher.
// Vêm de /etc/fonts/conf.d/48-guessfamily.conf (XML inválido gerado por uma
// ferramenta com schema-awareness em algumas distros). O AppImage não pode
// corrigir /etc/fonts — esses avisos são inofensivos (fontes continuam
// funcionando) e não afetam o jogo. Para silenciar definitivamente, o
// usuário pode remover/reparar aquele arquivo de sistema.

const { app, dialog, ipcMain } = require('electron');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// BOOT FASE 1 — ANTES de app.ready (flags DEVEM ser aplicadas aqui)
// ═══════════════════════════════════════════════════════════════════════════

const logger = require('./utils/logger');

const { loadConfig } = require('./config/settings');
const { findFlashPlugin, getFlashVersion } = require('./flash/plugin');
const flags = require('./core/flags');

// Config sync (app.getPath('userData') é válido antes de ready)
let config = loadConfig();

// Flash detection (path + version only — flags.js cuida do resto)
const flashPath = findFlashPlugin();
const flashVersion = flashPath ? getFlashVersion(path.dirname(flashPath)) : null;

// ══ APLICAR TODAS AS FLAGS ANTES DE READY ══
// (core/flags.js é a ÚNICA autoridade sobre commandLine.appendSwitch)
flags.applyAll({
  flashPath: flashPath,
  flashVersion: flashVersion,
  hardwareProfile: config.hardwareProfile,
  forceBatata: config.forceBatata === true,
});

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBSISTEMAS (lazy require para evitar circular)
// ═══════════════════════════════════════════════════════════════════════════

const memoryGuard = require('./memory/guard');
const eventTimers = require('./utilities/event-timers');
const profileStore = require('./profiles/store');
const profileManager = require('./profiles/manager');
const partition = require('./profiles/partition');
const vault = require('./profiles/vault');
// v4.9.1: crash reporter removido (era local-only, usuário não quer mais)
const i18n = require('./config/i18n');

let uiManager = null;
let setupWindow = null;
let isQuitting = false;
let activeGameWindows = 0;

// v3.5: Aplica idioma do config ao i18n global
i18n.setLanguage(config.language || 'pt');

// Vincula o MemoryGuard ao ProfileManager (quebra dependência circular).
profileManager.setMemoryGuard(memoryGuard);

// Aplica Modo Leve (renomeado de Batata — config legacy retrocompatível)
if (config.forceBatata !== undefined) {
  memoryGuard.setForceBatata(config.forceBatata === true);
}
partition.setBatataMode(memoryGuard.isBatata());
if (config.mutedEvents) eventTimers.setMuted(true);
// v4.9.2: telemetria removida — zero tracking, logs no disco + exportador

// ═══════════════════════════════════════════════════════════════════════════
// GAME LAUNCH — sem tray (v3.3 — user request: "nao quero ele na bandeja")
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lança o jogo para um perfil DELEGANDO ao ProfileManager (facade v3.1).
 *
 * v4.8 — MULTI-CONTA: o manager PERMANECE VISÍVEL quando um jogo abre, para
 * que o usuário possa dar Play em outras contas simultaneamente (cada perfil
 * já roda em partition/janela isolada — sem conflito de processos). Antes o
 * manager era oculto para liberar ~45MB de RAM; hoje isso é irrelevante em
 * máquinas com ≥4GB e impedia o uso multi-conta. Em Ramen Mode (<2GB RAM)
 * o comportamento antigo (ocultar) é mantido por necessidade de memória.
 *
 * Fluxo: Play → janela do jogo abre (isolada) → manager continua visível →
 * usuário pode abrir N contas. Fechar o manager (X) com jogos rodando apenas
 * o esconde; ele volta quando o último jogo fecha.
 */
function launchGameForProfile(profileId) {
  if (!uiManager) {
    uiManager = require('./ui-manager/controller');
    if (!uiManager.getManagerWindow()) uiManager.createManagerWindow();
  }
  profileManager.launch(profileId, function onOpened() {
    activeGameWindows++;
    // Ramen Mode (PC <2GB): oculta o manager para liberar RAM (comportamento legado).
    // Caso contrário: manager fica visível → multi-conta simultânea habilitada.
    if (memoryGuard.isRamen() && uiManager) {
      uiManager.hideManager();
      logger.info('Manager oculto (Ramen Mode) — RAM liberada para o jogo');
    } else {
      logger.info('Jogo aberto — manager visível (multi-conta disponível)');
    }
  }, function onClosed() {
    activeGameWindows = Math.max(0, activeGameWindows - 1);
    if (activeGameWindows === 0 && uiManager) {
      // Último jogo fechou: garante que o manager esteja visível (caso o
      // usuário o tenha ocultado manualmente via X durante o jogo).
      uiManager.showManager();
      logger.info('Jogo fechado — manager restaurado');
    }
  });
}

function showManager() {
  if (!uiManager) {
    uiManager = require('./ui-manager/controller');
    if (!uiManager.getManagerWindow()) uiManager.createManagerWindow();
    return;
  }
  uiManager.showManager();
}

// ═══════════════════════════════════════════════════════════════════════════
// APP EVENTS
// ═══════════════════════════════════════════════════════════════════════════

app.on('second-instance', function () { showManager(); });

// ═══════════════════════════════════════════════════════════════════════════
// v3.5: ONBOARDING (Setup Window) — primeira execução
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mostra a tela de setup inicial (500x400, não redimensionável).
 * Ao salvar, atualiza config.firstBoot=false + language + advancedMode.
 * @param {Function} onDone - callback quando setup é concluído
 */
function showSetupWindow(onDone) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }

  const { BrowserWindow } = require('electron');
  const path = require('path');

  setupWindow = new BrowserWindow({
    width: 500,
    height: 400,
    minWidth: 500,
    minHeight: 400,
    maxWidth: 500,
    maxHeight: 400,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    useContentSize: true, // v3.5: geometria exata do HTML contra barras de título do SO
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'Shinobi Launcher — Setup',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Passa idioma atual via query string
  const setupUrl = 'file://' + path.join(__dirname, 'ui', 'setup.html') + '?lang=' + (config.language || 'pt');
  setupWindow.loadURL(setupUrl);

  setupWindow.once('ready-to-show', function () {
    setupWindow.show();
    logger.info('Setup window exibida (firstBoot)');
  });

  // Intercepta o "close" — setup.html sinaliza via document.title '__SETUP_DONE__{json}'
  setupWindow.on('page-title-updated', function (e, title) {
    if (typeof title === 'string' && title.indexOf('__SETUP_DONE__') === 0) {
      e.preventDefault();
      try {
        const jsonStr = title.slice('__SETUP_DONE__'.length);
        const result = JSON.parse(jsonStr);
        logger.info('Setup concluído: lang=' + result.language + ' region=' + (result.region || 'br') + ' advanced=' + result.advancedMode);

        // Aplica configurações
        config.firstBoot = false;
        config.language = result.language || 'pt';
        config.region = result.region || 'br'; // v4.1: region selector no setup
        config.advancedMode = result.advancedMode === true;

        // Sincroniza i18n
        i18n.setLanguage(config.language);

        // Persiste
        _persistConfig();

        // Recria mms.cfg com Modo Leve Avançado se ativado
        try {
          const { createMmsCfg } = require('./flash/mms');
          createMmsCfg(config.hardwareProfile, { advancedMode: config.advancedMode });
        } catch (_) { /* ignore */ }

        // Fecha setup e chama callback
        setupWindow.destroy();
        setupWindow = null;
        if (onDone) onDone();
      } catch (err) {
        logger.error('Erro ao processar setup result: ' + err.message);
      }
    }
  });

  // Se usuário fechar sem salvar (X), cancela e reabre na próxima vez
  setupWindow.on('closed', function () {
    setupWindow = null;
    // Se firstBoot ainda é true (não salvou), mantém para próxima vez
    if (config.firstBoot !== false) {
      logger.warn('Setup fechado sem concluir — firstBoot mantido para próxima execução');
      // Não chama onDone → app não continua, fecha
      app.quit();
    }
  });
}

app.on('ready', function () {
  // Subsystems
  profileStore.load();
  memoryGuard.start();
  memoryGuard.startWebviewGC();

  // v3.4: EventTimers com perfis completos (respeita notificationsEnabled por perfil)
  eventTimers.startWithProfiles(profileStore.getAll());

  // v3.3: SEM TRAY — app fecha quando todas as janelas fecham.
  // v4.9.1: crash reporter removido — era só log local

  // ── v3.5: ONBOARDING — se firstBoot, mostra setup antes do manager ──
  if (config.firstBoot !== false) {
    logger.info('Primeira execução detectada — abrindo tela de setup');
    showSetupWindow(function onSetupDone() {
      _initManagerAndLaunch();
    });
    return;
  }

  _initManagerAndLaunch();
});

/**
 * Inicializa UI Manager + banner (separado para chamar após setup).
 */
function _initManagerAndLaunch() {

  // v3.5: Recria mms.cfg com Modo Leve Avançado se ativado no config
  try {
    const { createMmsCfg } = require('./flash/mms');
    createMmsCfg(config.hardwareProfile, { advancedMode: config.advancedMode === true });
  } catch (_) { /* ignore */ }

  // UI Manager — skip em Ramen Mode (manager-only economiza 45MB em PCs <2GB)
  uiManager = require('./ui-manager/controller');
  uiManager.registerIpcHandlers({
    launchProfile: launchGameForProfile,
    getMemoryStats: function () { return memoryGuard.getStats(); },
    forceGC: function () { return memoryGuard.collect({ manual: true }); },
    getEvents: function (region) { return eventTimers.getUpcoming(region || 'br'); },
    setMuted: function (m) { eventTimers.setMuted(m); _persistConfig(); },
    getVault: function (profileId) { return vault.getCredentials(profileId); },
    setVault: function (profileId, user, pass) { return vault.setCredentials(profileId, user, pass); },
    removeVault: function (profileId) { return vault.removeCredentials(profileId); },
    hasVault: function (profileId) { return vault.hasCredentials(profileId); },
    isBatata: function () { return memoryGuard.isBatata(); },
    isRamen: function () { return memoryGuard.isRamen(); },
    toggleBatata: function () {
      memoryGuard.setForceBatata(!memoryGuard.isBatata());
      partition.setBatataMode(memoryGuard.isBatata());
      _persistConfig();
      return memoryGuard.isBatata();
    },
    // v4.9.1: crash reporter removido do Settings
  });

  // v4.1: Register preload API handlers (game windows use narutoLauncher API)
  const pkg = require('../package.json');
  ipcMain.handle('launcher:get-version', function () {
    return pkg.version || 'unknown';
  });

  uiManager.createManagerWindow(); // sempre cria (sem tray para fallback)

  _logBanner();
  if (!flashPath) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Flash não encontrado',
      message: 'O plugin Flash PPAPI não foi encontrado.\n\nO jogo não funcionará sem ele.',
    });
  }
}

app.on('before-quit', function () { isQuitting = true; });

// v3.3: SEM TRAY — quando todas as janelas fecham, o app encerra.
// (Antes ficava na bandeja sem tray para restaurar → "tento sair e nao sai")
app.on('window-all-closed', function () {
  app.quit();
});

// ── Telemetria de crashes de processos filhos (cron-review-2) ──
// Estes eventos NÃO fecham o app principal — apenas logamos para diagnóstico.
// Cada BrowserWindow de jogo já trata 'render-process-gone' isoladamente
// (em game-launcher.js), mas eventos de GPU/child-process são globais.
app.on('gpu-process-crashed', function (event) {
  const reason = (event && event.reason) || 'unknown';
  const exitCode = (event && event.exitCode) || '?';
  logger.error('⚡ GPU process crashed — reason=' + reason + ' exitCode=' + exitCode);
  // v4.9.1: crash reporter removido — só log
});

app.on('child-process-gone', function (event, details) {
  logger.warn('⚡ Child process gone — type=' + details.type + ' reason=' + details.reason + ' exitCode=' + details.exitCode);
  // v4.9.1: crash reporter removido — só log
});

app.on('will-quit', function () {
  try {
    const { restoreMmsCfg } = require('./flash/mms');
    restoreMmsCfg();
  } catch (_) { /* ignore */ }
  memoryGuard.stop();
  eventTimers.stop();
});

// Graceful exit
process.on('SIGTERM', function () { isQuitting = true; app.quit(); });
process.on('SIGINT', function () { isQuitting = true; app.quit(); });
process.on('uncaughtException', function (e) {
  logger.error('Uncaught: ' + e.message + '\n' + (e.stack || ''));
  isQuitting = true;
  app.quit();
});
process.on('unhandledRejection', function (reason) {
  logger.error('Unhandled rejection: ' + reason);
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function _persistConfig() {
  try {
    const { saveConfig } = require('./config/settings');
    config.forceBatata = memoryGuard.isBatata() && !memoryGuard.IS_LOW_SPEC ? memoryGuard.isBatata() : (memoryGuard.IS_LOW_SPEC ? undefined : config.forceBatata);
    config.mutedEvents = eventTimers.isMuted();
    saveConfig(config);
  } catch (e) {
    logger.debug('main: saveConfig falhou: ' + e.message);
  }
}

function _logBanner() {
  logger.info('═══════════════════════════════════════════');
  logger.info('  🍥 Shinobi Launcher v4.9.2');
  logger.info('  🥷 Zero tracking + Exportador de diagnóstico + UI responsiva');
  logger.info('═══════════════════════════════════════════');
  logger.info('Flash PPAPI: ' + (flashPath ? '✅ ' + flashVersion : '❌'));
  logger.info('Perfis: ' + profileStore.getAll().length + '/' + profileStore.MAX_PROFILES);
  logger.info('Idioma: ' + i18n.getLanguage());
  logger.info('RAM do sistema: ' + memoryGuard.SYSTEM_RAM_GB + 'GB');
  logger.info('Modo Leve: ' + (memoryGuard.isBatata() ? 'ON' : 'OFF') + ' (threshold ' + memoryGuard.getThreshold() + 'MB)');
  logger.info('Modo Leve Avançado: ' + (config.advancedMode ? 'ON (Flash low quality)' : 'OFF'));
  // v4.9.1: Telemetria removida (crash reporter deletado a pedido do usuário)
  logger.info('═══════════════════════════════════════════');
}

module.exports = {
  isQuitting: function () { return isQuitting; },
  launchGameForProfile: launchGameForProfile,
};
