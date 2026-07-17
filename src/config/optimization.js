/**
 * config/optimization.js — Presets de Otimização (v1.0.0)
 *
 * Responsabilidade ÚNICA: definir os 3 presets (Performance / Balanced / Quality)
 * e suas configurações específicas. Aplicados em main/flags.js + CpuOptimizer.js.
 *
 * PRESETS:
 *   - performance: máx FPS, desliga vsync, fixa CPU em P-cores, nice=-5,
 *                  OOM protection, MALLOC_ARENA_MAX=2, Vulkan (se suportado),
 *                  disable-frame-rate-limit (uncap FPS), disable smooth scrolling.
 *                  Trade-off: mais consumo de energia, fan mais alto, PC esquenta.
 *
 *   - balanced:    padrão. vsync ON (60fps estável), CPU em P-cores apenas,
 *                  nice=0, OOM protection, MALLOC_ARENA_MAX=2, ANGLE desktop GL.
 *                  Trade-off: nenhum. Recomendado para maioria dos users.
 *
 *   - quality:     máxima compatibilidade. vsync ON, sem CPU affinity (scheduler decide),
 *                  nice=+5 (cede prioridade a outras apps), sem OOM protection,
 *                  MALLOC_ARENA_MAX=2, ANGLE desktop GL.
 *                  Trade-off: menos FPS em PCs fracos. Recomendado para quem
 *                  roda o jogo em segundo plano enquanto trabalha.
 */

'use strict';

const PRESETS = {
  performance: {
    name: 'Performance',
    description: 'Máximo FPS • Sem vsync • CPU em P-cores • Prioridade alta',
    icon: '\u{1F680}',
    color: '#DC2626',
    // Chromium flags específicas
    chromiumFlags: {
      disableFrameRateLimit: true,
      disableSmoothScrolling: true,
      enableGpuRasterization: true,
      enableZeroCopy: true,
      enableVulkan: true, // só ativa se GPU suportar (decidido em flags.js)
      useAngle: 'vulkan', // ANGLE em cima de Vulkan (mais estável)
      disableVsync: true
    },
    // CPU
    cpu: {
      applyAffinity: true,
      niceTarget: -5,
      oomScoreAdj: -500,
      useECoreForGc: true
    },
    // Memória
    memory: {
      mallocArenaMax: 2,
      heapMb: 'auto' // calculado em flags.js baseado em RAM
    },
    // GPU env
    gpuEnv: {
      disableVsync: true
    }
  },

  balanced: {
    name: 'Balanceado',
    description: 'Padrão • Vsync 60fps • CPU em P-cores • Estável',
    icon: '\u{2696}\u{FE0F}',
    color: '#10B981',
    chromiumFlags: {
      disableFrameRateLimit: false,
      disableSmoothScrolling: false,
      enableGpuRasterization: true,
      enableZeroCopy: true,
      enableVulkan: false, // Vulkan pode causar issues em alguns drivers, deixa OFF em balanced
      useAngle: 'desktop', // GL desktop nativo (estável)
      disableVsync: false
    },
    cpu: {
      applyAffinity: true,
      niceTarget: 0,
      oomScoreAdj: -500,
      useECoreForGc: false
    },
    memory: {
      mallocArenaMax: 2,
      heapMb: 'auto'
    },
    gpuEnv: {
      disableVsync: false
    }
  },

  quality: {
    name: 'Qualidade',
    description: 'Compatibilidade • Cede prioridade • Sem affinity • Multitarefa',
    icon: '\u{1F33F}',
    color: '#3B82F6',
    chromiumFlags: {
      disableFrameRateLimit: false,
      disableSmoothScrolling: false,
      enableGpuRasterization: false, // mais estável, sem rasterização GPU
      enableZeroCopy: false,
      enableVulkan: false,
      useAngle: 'desktop',
      disableVsync: false
    },
    cpu: {
      applyAffinity: false,
      niceTarget: 5,
      oomScoreAdj: 0,
      useECoreForGc: false
    },
    memory: {
      mallocArenaMax: 2,
      heapMb: 'auto'
    },
    gpuEnv: {
      disableVsync: false
    }
  }
};

const PRESET_CODES = Object.keys(PRESETS);

/**
 * Valida um código de preset.
 * @param {string} code
 * @returns {boolean}
 */
function isValidPreset(code) {
  return Object.prototype.hasOwnProperty.call(PRESETS, code);
}

/**
 * Retorna o preset padrão.
 * @returns {string}
 */
function getDefaultPreset() {
  return 'balanced';
}

/**
 * Retorna o preset pelo código (ou default se inválido).
 * @param {string} code
 * @returns {Object}
 */
function getPreset(code) {
  return PRESETS[isValidPreset(code) ? code : getDefaultPreset()];
}

/**
 * Lista presets formatados para UI.
 * @returns {Array<{code, name, description, icon, color}>}
 */
function listForUI() {
  return PRESET_CODES.map(function (code) {
    const p = PRESETS[code];
    return {
      code: code,
      name: p.name,
      description: p.description,
      icon: p.icon,
      color: p.color
    };
  });
}

module.exports = {
  PRESETS: PRESETS,
  PRESET_CODES: PRESET_CODES,
  isValidPreset: isValidPreset,
  getDefaultPreset: getDefaultPreset,
  getPreset: getPreset,
  listForUI: listForUI
};
