/**
 * main/flags.js — Single source of truth: Chromium 87 command-line flags (v5.0.0)
 *
 * REFACTOR v5.0.0 (GPU + Presets):
 *   Agora integra GpuDetector (detecção NVIDIA/AMD/Intel/PRIME) e presets de
 *   otimização (performance/balanced/quality). Flags aplicadas dinamicamente
 *   conforme GPU ativa + preset escolhido pelo usuário.
 *
 * Merge único de disable-features, enable-features e js-flags.
 */

'use strict';

const os = require('os');
const { app } = require('electron');
const logger = require('../utils/logger');
const gpuDetector = require('../app/GpuDetector');
const { getPreset, getDefaultPreset } = require('../config/optimization');

const TOTAL_RAM_GB = os.totalmem() / (1024 * 1024 * 1024);
const CPU_CORES = os.cpus().length;
const IS_WAYLAND = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

const _disabled = new Set([
  'IsolateOrigins',
  'site-per-process',
  'Translate',
  'MediaRouter',
  'BackForwardCache'
]);
const _enabled = new Set(['VizDisplayCompositor']);
const _jsFlags = ['--expose-gc'];
let _applied = false;
let _appliedPreset = null;
let _appliedGpu = null;

function _computeHeapMB(forceBatata, presetCode) {
  // Performance: heap maior (mais cache de assets do Flash)
  // Quality: heap menor (ceder memória pra outras apps)
  const low = forceBatata || TOTAL_RAM_GB < 4;
  if (low) return 384;
  if (presetCode === 'quality') {
    if (TOTAL_RAM_GB < 8) return 512;
    if (TOTAL_RAM_GB < 16) return 768;
    return 1024;
  }
  if (presetCode === 'performance') {
    if (TOTAL_RAM_GB < 8) return 1024;
    if (TOTAL_RAM_GB < 16) return 1280;
    return 1792;
  }
  // balanced
  if (TOTAL_RAM_GB < 8) return 768;
  if (TOTAL_RAM_GB < 16) return 1024;
  return 1536;
}

/**
 * Determina se a GPU ativa suporta Vulkan (apenas NVIDIA/AMD modernas).
 * Intel iGPU tem suporte parcial mas instável em drivers open-source.
 * @param {Object} gpu - resultado de GpuDetector.detect()
 * @returns {boolean}
 */
function _gpuSupportsVulkan(gpu) {
  if (!gpu || gpu.vendor === 'unknown') return false;
  // NVIDIA: suporte completo desde drivers 470+
  if (gpu.vendor === 'nvidia') return true;
  // AMD: suporte completo desde RDNA1 (2019) e Mesa 20+
  if (gpu.vendor === 'amd') return true;
  // Intel: suporte instável em ANGLE. Mantemos OFF por segurança.
  if (gpu.vendor === 'intel') return false;
  return false;
}

/**
 * Aplica TODAS as flags. Idempotente (só roda 1x).
 * @param {Object} opts - { flashPath, flashVersion, hardwareProfile, forceBatata, optimizationPreset }
 */
function applyAll(opts) {
  opts = opts || {};
  if (_applied) return;
  _applied = true;

  const low = !!opts.forceBatata || TOTAL_RAM_GB < 4;
  const presetCode = isValidPresetOrFallback(opts.optimizationPreset);
  const preset = getPreset(presetCode);
  _appliedPreset = presetCode;

  // ── Detecção de GPU (cacheada) ──
  const gpu = gpuDetector.detect();
  _appliedGpu = gpu;

  // ── Aplica env vars específicas da GPU (ANTES do GPU process iniciar) ──
  const envVars = gpuDetector.getEnvVars(presetCode);
  Object.keys(envVars).forEach(function (key) {
    // SÓ seta se o usuário não definiu explicitamente (não sobrescreve preferência do user)
    if (process.env[key] === undefined) {
      process.env[key] = envVars[key];
    }
  });

  // Sandbox (global — PPAPI precisa)
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');

  // Plugins
  app.commandLine.appendSwitch('always-authorize-plugins');
  app.commandLine.appendSwitch('allow-outdated-plugins');

  // v5.9.9 (fix Mixed Content): o jogo é servido via HTTPS, mas o plugin Flash
  // carrega sub-recursos (assets, sons, crossdomain.xml) via HTTP internamente.
  app.commandLine.appendSwitch('allow-running-insecure-content');
  app.commandLine.appendSwitch('allow-arbitrary-server-certificate-error');

  // Background throttling off
  [
    'disable-background-timer-throttling',
    'disable-renderer-backgrounding',
    'disable-backgrounding-occluded-windows',
    'disable-hang-monitor',
    'disable-background-networking',
    'disable-component-update',
    'disable-default-apps',
    'disable-extensions',
    'disable-translate',
    'disable-domain-reliability',
    'disable-client-side-phishing-detection'
  ].forEach(function (f) {
    app.commandLine.appendSwitch(f);
  });

  // GPU comum
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('disable-plugin-power-saver');

  // Cache
  app.commandLine.appendSwitch('disk-cache-size', low ? '134217728' : '268435456');

  // ── Hardware profile (legado — ainda usado pra CPU-only mode) ──
  if (opts.hardwareProfile === 'cpu') {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('num-raster-threads', String(Math.min(CPU_CORES, 4)));
    app.commandLine.appendSwitch('use-gl', process.platform === 'linux' ? 'swiftshader' : '');
  } else {
    app.commandLine.appendSwitch('enable-accelerated-video-decode');

    // ── GPU pipeline (preset-driven) ──
    const flags = preset.chromiumFlags;

    // GPU rasterization: usa GPU pra rasterizar (mais rápido em GPUs decentes)
    if (flags.enableGpuRasterization) {
      app.commandLine.appendSwitch('enable-gpu-rasterization');
      _enabled.add('GPURasterization');
    }

    // Zero-copy: GPU lê direto da memória compartilhada (evita cópia CPU→GPU)
    if (flags.enableZeroCopy) {
      app.commandLine.appendSwitch('enable-zero-copy');
    }

    // Vulkan: ANGLE em cima de Vulkan (mais estável em drivers pobres).
    // Só ativa se GPU suportar E preset permitir.
    if (flags.enableVulkan && _gpuSupportsVulkan(gpu)) {
      _enabled.add('Vulkan');
      app.commandLine.appendSwitch('use-vulkan');
      app.commandLine.appendSwitch('use-angle', 'vulkan');
      logger.info('flags: Vulkan + ANGLE/Vulkan ativado (GPU=' + gpu.vendor + ')');
    } else if (flags.useAngle === 'desktop') {
      // ANGLE em cima de GL desktop (padrão estável)
      app.commandLine.appendSwitch('use-angle', 'desktop');
    }

    // Linux X11: GL desktop nativo + VAAPI (video decode via GPU)
    if (process.platform === 'linux' && !IS_WAYLAND) {
      // Se não especificamos use-angle=vulkan acima, use GL desktop
      if (!flags.enableVulkan || !_gpuSupportsVulkan(gpu)) {
        app.commandLine.appendSwitch('use-gl', 'desktop');
      }
      _enabled.add('VaapiVideoDecoder');
    }

    // Frame rate limit (uncap FPS em performance)
    if (flags.disableFrameRateLimit) {
      app.commandLine.appendSwitch('disable-frame-rate-limit');
    }

    // Smooth scrolling: OFF em performance (ganho mínimo de input lag)
    if (flags.disableSmoothScrolling) {
      app.commandLine.appendSwitch('disable-smooth-scrolling');
    }

    // Vsync: OFF em performance (uncap FPS, mais input lag visível)
    if (flags.disableVsync) {
      app.commandLine.appendSwitch('disable-gpu-vsync');
    }
  }

  // JS heap (preset-aware)
  _jsFlags.push('--max-old-space-size=' + _computeHeapMB(opts.forceBatata, presetCode));

  // Flash
  if (opts.flashPath) {
    app.commandLine.appendSwitch('ppapi-flash-path', opts.flashPath);
    if (opts.flashVersion) app.commandLine.appendSwitch('ppapi-flash-version', opts.flashVersion);
  }

  // Merge único
  app.commandLine.appendSwitch('disable-features', Array.from(_disabled).join(','));
  app.commandLine.appendSwitch('enable-features', Array.from(_enabled).join(','));
  app.commandLine.appendSwitch('js-flags', _jsFlags.join(' '));

  app.name = 'Naruto Online';

  // ── Log banner ──
  logger.info(
    'flags: preset=' +
      presetCode +
      ' gpu=' +
      gpu.vendor +
      (gpu.isPrime ? ' [PRIME]' : '') +
      ' heap=' +
      _computeHeapMB(opts.forceBatata, presetCode) +
      'MB'
  );
}

function isValidPresetOrFallback(code) {
  const { isValidPreset } = require('../config/optimization');
  return isValidPreset(code) ? code : getDefaultPreset();
}

/**
 * Retorna o snapshot do que foi aplicado (para UI mostrar ao user).
 * @returns {Object|null}
 */
function getAppliedSnapshot() {
  if (!_applied) return null;
  return {
    preset: _appliedPreset,
    gpu: _appliedGpu,
    heapMB: _computeHeapMB(false, _appliedPreset)
  };
}

module.exports = {
  applyAll: applyAll,
  getAppliedSnapshot: getAppliedSnapshot,
  IS_LOW_SPEC: TOTAL_RAM_GB < 4,
  IS_RAMEN: TOTAL_RAM_GB < 2,
  SYSTEM_RAM_GB: Math.round(TOTAL_RAM_GB * 10) / 10,
  CPU_CORES: CPU_CORES,
  IS_WAYLAND: IS_WAYLAND,
  // expostos p/ testes
  _computeHeapMB: _computeHeapMB,
  _gpuSupportsVulkan: _gpuSupportsVulkan,
  _resetApplied: function () {
    _applied = false;
    _appliedPreset = null;
    _appliedGpu = null;
    _disabled.clear();
    _disabled.add('IsolateOrigins');
    _disabled.add('site-per-process');
    _disabled.add('Translate');
    _disabled.add('MediaRouter');
    _disabled.add('BackForwardCache');
    _enabled.clear();
    _enabled.add('VizDisplayCompositor');
    _jsFlags.length = 0;
    _jsFlags.push('--expose-gc');
  }
};
