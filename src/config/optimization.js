/**
 * config/optimization.js — Optimization Presets
 *
 * Single Responsibility: define the 3 presets (Performance / Balanced / Quality)
 * and their specific settings. Applied in main/flags.js + CpuOptimizer.js.
 *
 * PRESETS:
 *   The presets only control: name, description, icon and color for the UI.
 *   The REAL optimization logic (CPU affinity, nice, OOM) is hardcoded in
 *   CpuOptimizer.optimizeRenderer() based on the preset STRING, not the fields
 *   of this object. GPU env vars are applied via GpuDetector.getEnvVars()
 *   in main.js before app.whenReady().
 *
 *   - performance: max FPS, pins CPU to P-cores, nice=-5, OOM protection,
 *                  env vars GPU (NVIDIA threaded opts, PRIME offload, etc.).
 *                  Trade-off: higher power consumption, louder fan, PC heats up.
 *
 *   - balanced:    default. CPU on P-cores, nice=0, OOM protection.
 *                  Trade-off: none. Recommended for most users.
 *
 *   - quality:     maximum compatibility. No CPU affinity (scheduler decides),
 *                  nice=+5 (yields priority to other apps), without OOM protection.
 *                  Trade-off: fewer FPS on low-end PCs. Recommended for those who
 *                  runs the game in the background while working.
 */

'use strict';

const PRESETS = {
  performance: {
    name: '高性能',
    description: '最高 FPS • 使用 CPU P 核 • 高优先级',
    icon: '\u{1F680}',
    color: '#DC2626'
  },

  balanced: {
    name: '均衡',
    description: '标准性能 • 使用 CPU P 核 • 稳定运行',
    icon: '\u{2696}\u{FE0F}',
    color: '#10B981'
  },

  quality: {
    name: '兼容',
    description: '降低优先级 • 不设置 CPU affinity • 适合多任务',
    icon: '\u{1F33F}',
    color: '#3B82F6'
  }
};

const PRESET_CODES = Object.keys(PRESETS);

/**
 * Validates a preset code.
 * @param {string} code
 * @returns {boolean}
 */
function isValidPreset(code) {
  return Object.prototype.hasOwnProperty.call(PRESETS, code);
}

/**
 * Returns the default preset.
 * @returns {string}
 */
function getDefaultPreset() {
  return 'balanced';
}

/**
 * Lists presets formatted for UI.
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
  isValidPreset: isValidPreset,
  getDefaultPreset: getDefaultPreset,
  listForUI: listForUI
};
