/**
 * Shinobi Launcher — main.js (thin bootstrap)
 *
 * ORQUESTRADOR PRINCIPAL
 *
 *   腾讯国服 Profile 通过隔离 Partition 复用官方会话。
 *   Telemetria removida v4.9.2 — zero tracking, logs ficam no disco.
 *   Exportador de diagnóstico em Configurações → Avançado (opt-in explícito).
 *
 * ORDEM DE BOOT (CRÍTICA):
 *   1. [top-level, antes de ready] loadConfig (sync) + findFlashPlugin
 *   2. [top-level, antes de ready] main/flags.applyAll() ← ÚNICO lugar que toca commandLine
 *   3. [ready] subsystems: store.load, guard.start
 *   4. [ready] ui/controller.createManagerWindow()
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
  if (
    process.env.MESA_GLSL_CACHE_DISABLE !== undefined &&
    process.env.MESA_SHADER_CACHE_DISABLE === undefined
  ) {
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
const flags = require('./main/flags');

// Config sync (app.getPath('userData') é válido antes de ready)
let config = loadConfig();

// Flash detection (path + version only — flags.js cuida do resto)
const flashPath = findFlashPlugin();
const flashVersion = flashPath ? getFlashVersion(path.dirname(flashPath)) : null;

// ══ APLICAR GPU ENV VARS ANTES DE READY ══
// GpuDetector.getEnvVars() retorna env vars específicas da GPU ativa
// (NVIDIA __GL_*, AMD RADEONSI_ZERO_VRAM, Intel INTEL_DEBUG, MALLOC_ARENA_MAX, etc.)
// Devem ser setadas ANTES de app.whenReady() para o GPU process herdar.
// Antes v5.9.28: getEnvVars() existia mas nunca era chamado — env vars eram dead code.
const gpuDetector = require('./app/GpuDetector');
const gpuEnvVars = gpuDetector.getEnvVars(config.optimizationPreset || 'balanced');
for (var _envKey in gpuEnvVars) {
  if (Object.prototype.hasOwnProperty.call(gpuEnvVars, _envKey)) {
    process.env[_envKey] = gpuEnvVars[_envKey];
  }
}
if (Object.keys(gpuEnvVars).length > 0) {
  logger.info('GPU: environment variables applied keys=' + Object.keys(gpuEnvVars).join(', '));
}

// ══ APLICAR TODAS AS FLAGS ANTES DE READY ══
// (main/flags.js é a ÚNICA autoridade sobre commandLine.appendSwitch)
flags.applyAll({
  flashPath: flashPath,
  flashVersion: flashVersion,
  hardwareProfile: config.hardwareProfile,
  forceLowSpec: config.forceBatata === true,
  optimizationPreset: config.optimizationPreset
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
const profileStore = require('./profiles/store');
const profileManager = require('./profiles/manager');
const partition = require('./profiles/partition');
const i18n = require('./config/i18n');

let uiManager = null;
let setupWindow = null;
let isQuitting = false;
let activeGameWindows = 0;
let automationService = null;
let automationShutdownStarted = false;

// v3.5: Aplica idioma do config ao i18n global
i18n.setLanguage(config.language || i18n.DEFAULT_LANGUAGE);

// Vincula o MemoryGuard ao ProfileManager (quebra dependência circular).
profileManager.setMemoryGuard(memoryGuard);

// Aplica Modo Leve (renomeado de Batata — config legacy retrocompatível)
if (config.forceBatata !== undefined) {
  memoryGuard.setForceBatata(config.forceBatata === true);
}
partition.setBatataMode(memoryGuard.isBatata());
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
    uiManager = require('./ui/controller');
    if (!uiManager.getManagerWindow()) uiManager.createManagerWindow();
  }
  profileManager.launch(
    profileId,
    function onOpened() {
      activeGameWindows++;
      // Ramen Mode (PC <2GB): oculta o manager para liberar RAM (comportamento legado).
      // Caso contrário: manager fica visível → multi-conta simultânea habilitada.
      if (memoryGuard.isRamen() && uiManager) {
        uiManager.hideManager();
        logger.info('Manager: hidden in Ramen Mode to free RAM for the game');
      } else {
        logger.info('Manager: game opened, manager remains visible for multiple profiles');
      }
    },
    function onClosed() {
      activeGameWindows = Math.max(0, activeGameWindows - 1);
      if (activeGameWindows === 0 && uiManager) {
        // Último jogo fechou: garante que o manager esteja visível (caso o
        // usuário o tenha ocultado manualmente via X durante o jogo).
        uiManager.showManager();
        logger.info('Manager: game closed, manager restored');
      }
    }
  );
}

function showManager() {
  if (!uiManager) {
    uiManager = require('./ui/controller');
    if (!uiManager.getManagerWindow()) uiManager.createManagerWindow();
    return;
  }
  uiManager.showManager();
}

// ═══════════════════════════════════════════════════════════════════════════
// APP EVENTS
// ═══════════════════════════════════════════════════════════════════════════

app.on('second-instance', function () {
  showManager();
});

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
    title: 'Naruto Online 启动器 — 首次设置',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  // Passa idioma atual via query string (setup.html agora em ui/setup/)
  const setupUrl =
    'file://' +
    path.join(__dirname, 'ui', 'setup', 'setup.html') +
    '?lang=' +
    (config.language || i18n.DEFAULT_LANGUAGE);
  setupWindow.loadURL(setupUrl);

  setupWindow.once('ready-to-show', function () {
    setupWindow.show();
    logger.info('Setup: window shown firstBoot=true');
  });

  // Intercepta o "close" — setup.html sinaliza via document.title '__SETUP_DONE__{json}'
  setupWindow.on('page-title-updated', function (e, title) {
    if (typeof title === 'string' && title.indexOf('__SETUP_DONE__') === 0) {
      e.preventDefault();
      try {
        const jsonStr = title.slice('__SETUP_DONE__'.length);
        const result = JSON.parse(jsonStr);
        logger.info(
          'Setup: completed language=' + result.language + ' advancedMode=' + result.advancedMode
        );

        // Aplica configurações
        config.firstBoot = false;
        config.language =
          typeof result.language === 'string' && i18n.SUPPORTED.indexOf(result.language) !== -1
            ? result.language
            : i18n.DEFAULT_LANGUAGE;
        config.advancedMode = result.advancedMode === true;

        // Sincroniza i18n
        i18n.setLanguage(config.language);

        // Persiste
        _persistConfig();

        // Recria mms.cfg com Modo Leve Avançado se ativado
        try {
          const { createMmsCfg } = require('./flash/mms');
          createMmsCfg(config.hardwareProfile, { advancedMode: config.advancedMode });
        } catch (_) {
          /* ignore */
        }

        // Fecha setup e chama callback
        setupWindow.destroy();
        setupWindow = null;
        if (onDone) onDone();
      } catch (err) {
        logger.error('Setup: result processing failed: ' + err.message);
      }
    }
  });

  // Se usuário fechar sem salvar (X), cancela e reabre na próxima vez
  setupWindow.on('closed', function () {
    setupWindow = null;
    // Se firstBoot ainda é true (não salvou), mantém para próxima vez
    if (config.firstBoot !== false) {
      logger.warn('Setup: closed before completion - keeping firstBoot for next run');
      // Não chama onDone → app não continua, fecha
      app.quit();
    }
  });
}

app.on('ready', function () {
  // Flash PPAPI is bundled. A missing binary means the installation is corrupt.
  if (!flashPath) {
    _showFlashMissingError();
    return;
  }

  // Subsystems
  profileStore.load();
  memoryGuard.start();
  memoryGuard.startWebviewGC();

  // v3.3: SEM TRAY — app fecha quando todas as janelas fecham.

  // ── v3.5: ONBOARDING — se firstBoot, mostra setup antes do manager ──
  if (config.firstBoot !== false) {
    logger.info('Setup: first run detected, opening setup window');
    showSetupWindow(function onSetupDone() {
      _initManagerAndLaunch();
    });
    return;
  }

  _initManagerAndLaunch();
});

/**
 * Report a corrupted installation when the bundled PPAPI binary is missing.
 */
function _showFlashMissingError() {
  logger.error('Flash: PPAPI plugin not found - installation corrupted');
  dialog.showMessageBoxSync({
    type: 'error',
    title: '未找到 Flash',
    message: '未找到启动器随附的 Flash PPAPI 插件。',
    detail: '当前安装可能已损坏，请重新安装最新版本。运行 Naruto Online 必须使用 Flash。',
    buttons: ['退出']
  });
  app.exit(1);
}

/**
 * Inicializa UI Manager + banner (separado para chamar após setup).
 */
function _initManagerAndLaunch() {
  // v3.5: Recria mms.cfg com Modo Leve Avançado se ativado no config
  try {
    const { createMmsCfg } = require('./flash/mms');
    createMmsCfg(config.hardwareProfile, { advancedMode: config.advancedMode === true });
  } catch (_) {
    /* ignore */
  }

  if (!automationService) {
    const Launcher = require('./app/Launcher');
    const { createAutomationService } = require('./automation');
    automationService = createAutomationService({
      app: app,
      profileStore: profileStore,
      launcher: Launcher,
      logger: logger
    });
    const automationCatalog = automationService.listCatalog();
    const automationIssues = automationService.registrationIssues();
    logger.info('Automation: registry scan complete', {
      action: 'registry-scan',
      status: 'succeeded',
      registeredCount: automationCatalog.length,
      issueCount: automationIssues.length
    });
    automationIssues.forEach(function (issue) {
      logger.warn('Automation: package registration rejected', {
        action: 'registry-reject',
        packageName: issue.packageName,
        scriptId: issue.scriptId,
        errorCode: issue.code
      });
    });
    require('./ui/manager/StateBroadcaster').setAutomationService(automationService);
  }

  // UI Manager — skip em Ramen Mode (manager-only economiza 45MB em PCs <2GB)
  uiManager = require('./ui/controller');
  uiManager.registerIpcHandlers({
    launchProfile: launchGameForProfile,
    closeProfile: profileManager.close, // v5.3: close game window by profile ID
    refreshProfile: function (profileId) {
      return require('./app/Launcher').refreshProfile(profileId);
    },
    requestRecoveryForSender: function (sender, action) {
      return require('./app/Launcher').requestRecoveryForSender(sender, action);
    },
    automation: automationService,
    getMemoryStats: function () {
      return memoryGuard.getStats();
    },
    forceGC: function () {
      return memoryGuard.collect({ manual: true });
    },
    isBatata: function () {
      return memoryGuard.isBatata();
    },
    isRamen: function () {
      return memoryGuard.isRamen();
    },
    toggleBatata: function () {
      memoryGuard.setForceBatata(!memoryGuard.isBatata());
      partition.setBatataMode(memoryGuard.isBatata());
      _persistConfig();
      return memoryGuard.isBatata();
    }
  });

  // ── v5.0.0: Optimization IPC handlers (GPU + CPU + presets) ──
  // gpuDetector já é requerido no top-level (para getEnvVars antes de ready)
  const cpuOptimizer = require('./app/CpuOptimizer');
  const { PRESETS, listForUI, isValidPreset, getDefaultPreset } = require('./config/optimization');

  ipcMain.handle('optimization:get-status', function () {
    const gpu = gpuDetector.detect();
    const cpu = cpuOptimizer.getStats();
    const snap = flags.getAppliedSnapshot();
    return {
      preset: config.optimizationPreset || getDefaultPreset(),
      presets: listForUI(),
      gpu: {
        vendor: gpu.vendor,
        description: gpu.description,
        isPrime: gpu.isPrime,
        hasNvidia: gpu.hasNvidia,
        hasAmd: gpu.hasAmd,
        hasIntel: gpu.hasIntel,
        allGpus: gpu.allGpus.map(function (g) {
          return { vendor: g.vendor, description: g.description };
        })
      },
      cpu: {
        totalCores: cpu.topology.totalCores,
        pCores: cpu.topology.pCores.length,
        eCores: cpu.topology.eCores.length,
        isHybrid: cpu.topology.isHybrid,
        appliedPids: cpu.appliedPids,
        platform: cpu.platform
      },
      applied: snap,
      systemRamGb: flags.SYSTEM_RAM_GB,
      isLowSpec: flags.IS_LOW_SPEC,
      isWayland: flags.IS_WAYLAND
    };
  });

  ipcMain.handle('optimization:set-preset', function (_e, code) {
    if (!isValidPreset(code)) {
      return { ok: false, error: 'invalid-preset', validCodes: Object.keys(PRESETS) };
    }
    const previous = config.optimizationPreset;
    config.optimizationPreset = code;
    _persistConfig();
    logger.info(
      'Optimization: preset changed from=' +
        previous +
        ' to=' +
        code +
        ' (restart required to apply Chromium flags)'
    );
    return {
      ok: true,
      previous: previous,
      current: code,
      requiresRestart: true // flags.applyAll só roda 1x no boot
    };
  });

  // v4.1: Register preload API handlers (game windows use narutoLauncher API)
  const pkg = require('../package.json');
  ipcMain.handle('launcher:get-version', function () {
    return pkg.version || 'unknown';
  });

  uiManager.createManagerWindow(); // sempre cria (sem tray para fallback)

  _logBanner();
  // flashPath is guaranteed non-null here; boot stops on a corrupt install.
}

app.on('before-quit', function (event) {
  isQuitting = true;
  if (!automationService || automationShutdownStarted) return;
  automationShutdownStarted = true;
  event.preventDefault();
  Promise.resolve(automationService.shutdown())
    .catch(function () {
      // Exit still proceeds after the bounded cleanup attempt fails.
    })
    .finally(function () {
      app.quit();
    });
});

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
  logger.error('GPU: process crashed reason=' + reason + ' exitCode=' + exitCode);
});

app.on('child-process-gone', function (event, details) {
  logger.warn(
    'Process: child process gone type=' +
      details.type +
      ' reason=' +
      details.reason +
      ' exitCode=' +
      details.exitCode
  );
});

app.on('will-quit', function () {
  try {
    const { restoreMmsCfg } = require('./flash/mms');
    restoreMmsCfg();
  } catch (_) {
    /* ignore */
  }
  memoryGuard.stop();
});

// Graceful exit
process.on('SIGTERM', function () {
  isQuitting = true;
  app.quit();
});
process.on('SIGINT', function () {
  isQuitting = true;
  app.quit();
});
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
    config.forceBatata =
      memoryGuard.isBatata() && !memoryGuard.IS_LOW_SPEC
        ? memoryGuard.isBatata()
        : memoryGuard.IS_LOW_SPEC
          ? undefined
          : config.forceBatata;
    saveConfig(config);
  } catch (e) {
    logger.debug('Main: saveConfig failed: ' + e.message);
  }
}

function _logBanner() {
  var pkg = require('../package.json');
  var ver = pkg.version || 'unknown';
  logger.info('-------------------------------------------');
  logger.info('Naruto Online Launcher v' + ver);
  logger.info('Zero tracking | Diagnostics export | Responsive UI');
  logger.info('-------------------------------------------');
  logger.info(
    'Flash PPAPI: ' + (flashPath ? 'available version=' + flashVersion : 'not available')
  );
  logger.info('Profiles: ' + profileStore.getAll().length + '/' + profileStore.MAX_PROFILES);
  logger.info('Language: ' + i18n.getLanguage());
  logger.info('System RAM: ' + memoryGuard.SYSTEM_RAM_GB + 'GB');
  logger.info(
    'Lightweight mode: ' +
      (memoryGuard.isBatata() ? 'ON' : 'OFF') +
      ' (threshold ' +
      memoryGuard.getThreshold() +
      'MB)'
  );
  logger.info(
    'Advanced lightweight mode: ' + (config.advancedMode ? 'ON (Flash low quality)' : 'OFF')
  );
  // v4.9.1: Telemetria removida (crash reporter deletado a pedido do usuário)
  logger.info('-------------------------------------------');
}

module.exports = {
  isQuitting: function () {
    return isQuitting;
  },
  launchGameForProfile: launchGameForProfile
};
