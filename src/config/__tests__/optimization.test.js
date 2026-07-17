/**
 * Tests for config/optimization.js (v1.0.0)
 */

'use strict';

const opt = require('../optimization');

describe('config/optimization.js', function () {
  describe('PRESETS', function () {
    test('has exactly 3 presets', function () {
      expect(Object.keys(opt.PRESETS).length).toBe(3);
    });

    test('has performance, balanced, quality', function () {
      expect(opt.PRESETS.performance).toBeDefined();
      expect(opt.PRESETS.balanced).toBeDefined();
      expect(opt.PRESETS.quality).toBeDefined();
    });

    test('each preset has name, description, icon, color', function () {
      Object.keys(opt.PRESETS).forEach(function (code) {
        const p = opt.PRESETS[code];
        expect(typeof p.name).toBe('string');
        expect(typeof p.description).toBe('string');
        expect(typeof p.icon).toBe('string');
        expect(typeof p.color).toBe('string');
        expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    test('each preset has chromiumFlags, cpu, memory, gpuEnv', function () {
      Object.keys(opt.PRESETS).forEach(function (code) {
        const p = opt.PRESETS[code];
        expect(p.chromiumFlags).toBeDefined();
        expect(p.cpu).toBeDefined();
        expect(p.memory).toBeDefined();
        expect(p.gpuEnv).toBeDefined();
      });
    });

    test('performance disables vsync, quality keeps vsync', function () {
      expect(opt.PRESETS.performance.chromiumFlags.disableVsync).toBe(true);
      expect(opt.PRESETS.balanced.chromiumFlags.disableVsync).toBe(false);
      expect(opt.PRESETS.quality.chromiumFlags.disableVsync).toBe(false);
    });

    test('performance enables Vulkan, balanced/quality disable', function () {
      expect(opt.PRESETS.performance.chromiumFlags.enableVulkan).toBe(true);
      expect(opt.PRESETS.balanced.chromiumFlags.enableVulkan).toBe(false);
      expect(opt.PRESETS.quality.chromiumFlags.enableVulkan).toBe(false);
    });

    test('quality disables GPU rasterization (more stable)', function () {
      expect(opt.PRESETS.performance.chromiumFlags.enableGpuRasterization).toBe(true);
      expect(opt.PRESETS.balanced.chromiumFlags.enableGpuRasterization).toBe(true);
      expect(opt.PRESETS.quality.chromiumFlags.enableGpuRasterization).toBe(false);
    });

    test('performance uses ANGLE/Vulkan, balanced/quality use desktop', function () {
      expect(opt.PRESETS.performance.chromiumFlags.useAngle).toBe('vulkan');
      expect(opt.PRESETS.balanced.chromiumFlags.useAngle).toBe('desktop');
      expect(opt.PRESETS.quality.chromiumFlags.useAngle).toBe('desktop');
    });

    test('performance has nice -5, balanced 0, quality +5', function () {
      expect(opt.PRESETS.performance.cpu.niceTarget).toBe(-5);
      expect(opt.PRESETS.balanced.cpu.niceTarget).toBe(0);
      expect(opt.PRESETS.quality.cpu.niceTarget).toBe(5);
    });

    test('quality disables affinity (ceder to scheduler)', function () {
      expect(opt.PRESETS.performance.cpu.applyAffinity).toBe(true);
      expect(opt.PRESETS.balanced.cpu.applyAffinity).toBe(true);
      expect(opt.PRESETS.quality.cpu.applyAffinity).toBe(false);
    });

    test('all presets use MALLOC_ARENA_MAX=2', function () {
      expect(opt.PRESETS.performance.memory.mallocArenaMax).toBe(2);
      expect(opt.PRESETS.balanced.memory.mallocArenaMax).toBe(2);
      expect(opt.PRESETS.quality.memory.mallocArenaMax).toBe(2);
    });

    test('performance/quality have OOM protection, quality disables', function () {
      expect(opt.PRESETS.performance.cpu.oomScoreAdj).toBe(-500);
      expect(opt.PRESETS.balanced.cpu.oomScoreAdj).toBe(-500);
      expect(opt.PRESETS.quality.cpu.oomScoreAdj).toBe(0);
    });
  });

  describe('PRESET_CODES', function () {
    test('returns array of 3 codes', function () {
      expect(Array.isArray(opt.PRESET_CODES)).toBe(true);
      expect(opt.PRESET_CODES.length).toBe(3);
      expect(opt.PRESET_CODES).toContain('performance');
      expect(opt.PRESET_CODES).toContain('balanced');
      expect(opt.PRESET_CODES).toContain('quality');
    });
  });

  describe('isValidPreset', function () {
    test('returns true for valid codes', function () {
      expect(opt.isValidPreset('performance')).toBe(true);
      expect(opt.isValidPreset('balanced')).toBe(true);
      expect(opt.isValidPreset('quality')).toBe(true);
    });

    test('returns false for invalid codes', function () {
      expect(opt.isValidPreset('unknown')).toBe(false);
      expect(opt.isValidPreset('')).toBe(false);
      expect(opt.isValidPreset(null)).toBe(false);
      expect(opt.isValidPreset(undefined)).toBe(false);
      expect(opt.isValidPreset(123)).toBe(false);
    });
  });

  describe('getDefaultPreset', function () {
    test('returns balanced', function () {
      expect(opt.getDefaultPreset()).toBe('balanced');
    });
  });

  describe('getPreset', function () {
    test('returns preset for valid code', function () {
      const p = opt.getPreset('performance');
      expect(p).toBe(opt.PRESETS.performance);
    });

    test('returns balanced for invalid code (fallback)', function () {
      const p = opt.getPreset('invalid');
      expect(p).toBe(opt.PRESETS.balanced);
    });

    test('returns balanced for undefined', function () {
      const p = opt.getPreset(undefined);
      expect(p).toBe(opt.PRESETS.balanced);
    });
  });

  describe('listForUI', function () {
    test('returns array of 3 items with code, name, description, icon, color', function () {
      const list = opt.listForUI();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(3);
      list.forEach(function (item) {
        expect(item).toHaveProperty('code');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('description');
        expect(item).toHaveProperty('icon');
        expect(item).toHaveProperty('color');
      });
    });

    test('first item is performance', function () {
      const list = opt.listForUI();
      expect(list[0].code).toBe('performance');
    });

    test('second item is balanced', function () {
      const list = opt.listForUI();
      expect(list[1].code).toBe('balanced');
    });

    test('third item is quality', function () {
      const list = opt.listForUI();
      expect(list[2].code).toBe('quality');
    });
  });
});
