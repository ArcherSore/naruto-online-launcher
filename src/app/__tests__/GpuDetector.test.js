/**
 * Tests for app/GpuDetector.js (v1.0.0)
 */

'use strict';

const fs = require('fs');
const child_process = require('child_process');

// Mocks
jest.mock('fs');
jest.mock('child_process');
jest.mock('../../utils/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

const gpuDetector = require('../GpuDetector');

describe('GpuDetector', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    gpuDetector._resetCache();
    fs.existsSync.mockReset();
    fs.readFileSync.mockReset();
    fs.readdirSync.mockReset();
    child_process.execFileSync.mockReset();
  });

  describe('constants', function () {
    test('VENDOR_NVIDIA = 0x10de', function () {
      expect(gpuDetector.VENDOR_NVIDIA).toBe(0x10de);
    });
    test('VENDOR_AMD = 0x1002', function () {
      expect(gpuDetector.VENDOR_AMD).toBe(0x1002);
    });
    test('VENDOR_INTEL = 0x8086', function () {
      expect(gpuDetector.VENDOR_INTEL).toBe(0x8086);
    });
    test('VENDOR_MAP has 3 entries', function () {
      expect(Object.keys(gpuDetector.VENDOR_MAP).length).toBe(3);
    });
  });

  describe('_parseCpuList is not here (it is CpuOptimizer)', function () {
    test('placeholder', function () {
      expect(true).toBe(true);
    });
  });

  describe('_detectNvidiaPrimeLinux', function () {
    test('returns true when __NV_PRIME_RENDER_OFFLOAD=1', function () {
      process.env.__NV_PRIME_RENDER_OFFLOAD = '1';
      try {
        expect(gpuDetector._detectNvidiaPrimeLinux()).toBe(true);
      } finally {
        delete process.env.__NV_PRIME_RENDER_OFFLOAD;
      }
    });

    test('returns true when DRI_PRIME=1', function () {
      process.env.DRI_PRIME = '1';
      try {
        expect(gpuDetector._detectNvidiaPrimeLinux()).toBe(true);
      } finally {
        delete process.env.DRI_PRIME;
      }
    });

    test('returns false when no env and no /proc/driver/nvidia', function () {
      delete process.env.__NV_PRIME_RENDER_OFFLOAD;
      delete process.env.DRI_PRIME;
      fs.existsSync.mockReturnValue(false);
      expect(gpuDetector._detectNvidiaPrimeLinux()).toBe(false);
    });
  });

  describe('_listGpusLinuxSysfs', function () {
    test('returns empty array when /sys/class/drm does not exist', function () {
      fs.existsSync.mockReturnValue(false);
      const gpus = gpuDetector._listGpusLinuxSysfs();
      expect(Array.isArray(gpus)).toBe(true);
      expect(gpus.length).toBe(0);
    });

    test('parses NVIDIA vendor ID correctly', function () {
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de';
        return '';
      });
      const gpus = gpuDetector._listGpusLinuxSysfs();
      expect(gpus.length).toBe(1);
      expect(gpus[0].vendor).toBe('nvidia');
      expect(gpus[0].vendorId).toBe(0x10de);
    });

    test('parses AMD vendor ID correctly', function () {
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x1002';
        return '';
      });
      const gpus = gpuDetector._listGpusLinuxSysfs();
      expect(gpus.length).toBe(1);
      expect(gpus[0].vendor).toBe('amd');
    });

    test('parses Intel vendor ID correctly', function () {
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x8086';
        return '';
      });
      const gpus = gpuDetector._listGpusLinuxSysfs();
      expect(gpus.length).toBe(1);
      expect(gpus[0].vendor).toBe('intel');
    });

    test('skips unknown vendor IDs', function () {
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x1234'; // unknown
        return '';
      });
      const gpus = gpuDetector._listGpusLinuxSysfs();
      expect(gpus.length).toBe(0);
    });

    test('filters only cardN entries (ignores card0-DP-1)', function () {
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/sys/class/drm/card1/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0', 'card0-DP-1', 'card1', 'controlD64']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de';
        return '';
      });
      const gpus = gpuDetector._listGpusLinuxSysfs();
      expect(gpus.length).toBe(2); // card0 + card1
    });
  });

  describe('_listGpusLinuxLspci', function () {
    test('returns empty when lspci fails', function () {
      child_process.execFileSync.mockImplementation(function () {
        throw new Error('lspci not found');
      });
      const gpus = gpuDetector._listGpusLinuxLspci();
      expect(gpus.length).toBe(0);
    });

    test('parses NVIDIA from lspci output', function () {
      const lspciOut =
        '00:02.0 "VGA compatible controller" "Intel" "HD Graphics" [8086:5916]\n' +
        '01:00.0 "VGA compatible controller" "NVIDIA" "GP107 [GeForce GTX 1050 Ti]" [10de:1c82]\n';
      child_process.execFileSync.mockReturnValue(lspciOut);
      const gpus = gpuDetector._listGpusLinuxLspci();
      expect(gpus.length).toBe(2);
      expect(gpus[0].vendor).toBe('intel');
      expect(gpus[1].vendor).toBe('nvidia');
      expect(gpus[1].vendorId).toBe(0x10de);
      expect(gpus[1].deviceId).toBe(0x1c82);
    });

    test('parses AMD/Radeon from lspci output', function () {
      const lspciOut =
        '00:01.0 "VGA compatible controller" "Advanced Micro Devices, Inc." "Radeon RX 580" [1002:67df]\n';
      child_process.execFileSync.mockReturnValue(lspciOut);
      const gpus = gpuDetector._listGpusLinuxLspci();
      expect(gpus.length).toBe(1);
      expect(gpus[0].vendor).toBe('amd');
    });

    test('skips non-display entries', function () {
      const lspciOut =
        '00:1f.6 "Ethernet controller" "Intel" "I219-V" [8086:15d8]\n' +
        '00:02.0 "VGA compatible controller" "Intel" "HD Graphics" [8086:5916]\n';
      child_process.execFileSync.mockReturnValue(lspciOut);
      const gpus = gpuDetector._listGpusLinuxLspci();
      expect(gpus.length).toBe(1); // only the VGA one
    });
  });

  describe('detect (caching)', function () {
    test('returns cached result on second call', function () {
      // Primeiro call: simula Intel
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x8086';
        return '';
      });

      const first = gpuDetector.detect();
      expect(first.vendor).toBe('intel');

      // Muda o mock mas o cache deve persistir
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de'; // mudou pra NVIDIA
        return '';
      });

      const second = gpuDetector.detect();
      expect(second.vendor).toBe('intel'); // ainda cached
      expect(second).toBe(first); // mesma referência
    });

    test('_resetCache clears cache', function () {
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x8086';
        return '';
      });

      gpuDetector.detect();
      gpuDetector._resetCache();

      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de';
        return '';
      });

      const second = gpuDetector.detect();
      expect(second.vendor).toBe('nvidia'); // re-detected after cache reset
    });

    test('returns unknown when no GPUs detected', function () {
      fs.existsSync.mockReturnValue(false);
      child_process.execFileSync.mockImplementation(function () {
        throw new Error('not found');
      });
      const result = gpuDetector.detect();
      expect(result.vendor).toBe('unknown');
      expect(result.hasNvidia).toBe(false);
      expect(result.hasAmd).toBe(false);
      expect(result.hasIntel).toBe(false);
    });
  });

  describe('getEnvVars', function () {
    test('always sets MALLOC_ARENA_MAX=2', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockReturnValue(false);
      child_process.execFileSync.mockImplementation(function () {
        throw new Error('not found');
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.MALLOC_ARENA_MAX).toBe('2');
    });

    test('NVIDIA sets __GL_THREADED_OPTIMIZATIONS', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/proc/driver/nvidia') return true; // driver proprietário ativo
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de';
        return '';
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.__GL_THREADED_OPTIMIZATIONS).toBe('1');
    });

    test('NVIDIA performance preset disables vsync', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/proc/driver/nvidia') return true; // driver proprietário ativo
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de';
        return '';
      });
      const env = gpuDetector.getEnvVars('performance');
      expect(env.__GL_SYNC_TO_VBLANK).toBe('0');
    });

    test('AMD sets LIBVA_DRIVER_NAME=radeonsi', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x1002';
        return '';
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.LIBVA_DRIVER_NAME).toBe('radeonsi');
      expect(env.RADEONSI_ZERO_VRAM).toBe('1');
    });

    test('Intel modern (deviceId >= 0x1600) uses iHD driver', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/sys/class/drm/card0/device/device') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x8086';
        if (p.endsWith('/device')) return '0x9bc8'; // Ice Lake (modern)
        return '';
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.LIBVA_DRIVER_NAME).toBe('iHD');
    });

    test('Intel legacy (deviceId < 0x1600) uses i965 driver', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/sys/class/drm/card0/device/device') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x8086';
        if (p.endsWith('/device')) return '0x0152'; // Sandy Bridge (legacy)
        return '';
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.LIBVA_DRIVER_NAME).toBe('i965');
    });

    test('Intel performance sets INTEL_DEBUG=norbc', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/sys/class/drm/card0/device/device') return true;
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x8086';
        if (p.endsWith('/device')) return '0x9bc8';
        return '';
      });
      const env = gpuDetector.getEnvVars('performance');
      expect(env.INTEL_DEBUG).toBe('norbc');
      expect(env.vblank_mode).toBe('0');
    });

    test('unknown GPU still sets MALLOC_ARENA_MAX', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockReturnValue(false);
      child_process.execFileSync.mockImplementation(function () {
        throw new Error('not found');
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.MALLOC_ARENA_MAX).toBe('2');
      // Não seta nada específico de marca
      expect(env.__GL_THREADED_OPTIMIZATIONS).toBeUndefined();
      expect(env.LIBVA_DRIVER_NAME).toBeUndefined();
    });

    test('musl libc skips MALLOC_ARENA_MAX (placebo on musl)', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockImplementation(function (p) {
        if (p === '/lib') return ['ld-musl-x86_64.so.1'];
        return [];
      });
      child_process.execFileSync.mockImplementation(function () {
        throw new Error('not found');
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.MALLOC_ARENA_MAX).toBeUndefined();
    });

    test('nouveau driver skips __GL_* vars (placebo with nouveau)', function () {
      gpuDetector._resetCache();
      fs.existsSync.mockImplementation(function (p) {
        if (p === '/sys/class/drm') return true;
        if (p === '/sys/class/drm/card0/device/vendor') return true;
        if (p === '/proc/driver/nvidia') return false; // nouveau, não proprietário
        return false;
      });
      fs.readdirSync.mockReturnValue(['card0']);
      fs.readFileSync.mockImplementation(function (p) {
        if (p.endsWith('/vendor')) return '0x10de';
        return '';
      });
      const env = gpuDetector.getEnvVars('balanced');
      expect(env.__GL_THREADED_OPTIMIZATIONS).toBeUndefined();
      expect(env.MALLOC_ARENA_MAX).toBe('2'); // glibc ainda seta
    });
  });

  describe('_isMusl', function () {
    test('returns true when /lib has ld-musl-*.so', function () {
      fs.readdirSync.mockReturnValue(['ld-musl-x86_64.so.1']);
      expect(gpuDetector._isMusl()).toBe(true);
    });

    test('returns false when /lib has no ld-musl-*', function () {
      fs.readdirSync.mockReturnValue(['libc.so.6', 'ld-linux-x86-64.so.2']);
      expect(gpuDetector._isMusl()).toBe(false);
    });

    test('returns false on non-linux platform', function () {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(gpuDetector._isMusl()).toBe(false);
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });
  });

  describe('_isNvidiaProprietary', function () {
    test('returns true when /proc/driver/nvidia exists', function () {
      fs.existsSync.mockReturnValue(true);
      expect(gpuDetector._isNvidiaProprietary()).toBe(true);
    });

    test('returns false when /proc/driver/nvidia missing (nouveau)', function () {
      fs.existsSync.mockReturnValue(false);
      expect(gpuDetector._isNvidiaProprietary()).toBe(false);
    });

    test('returns true on Windows (always proprietary)', function () {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(gpuDetector._isNvidiaProprietary()).toBe(true);
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    });
  });
});
