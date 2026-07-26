/**
 * Tests for src/profiles/partition.js — 腾讯持久 Partition manager
 *
 * Verifies: setBatataMode, shouldUseShadow, getPartitionName,
 * getProfileSession and ensurePartitionDir.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const electron = require('electron');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

let tmpDir;

beforeAll(function () {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-partition-'));
});

afterAll(function () {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

const partition = require('../partition');

describe('partition.js', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    // Point userData to our temp dir so partition dirs go there
    electron.app.getPath.mockImplementation(function (p) {
      if (p === 'userData') return tmpDir;
      return '/tmp/naruto-test/' + p;
    });
    // Reset batata mode before each test
    partition.setBatataMode(false);
  });

  // ── Exports ──

  describe('exports', function () {
    test('exports setBatataMode as function', function () {
      expect(typeof partition.setBatataMode).toBe('function');
    });
    test('exports shouldUseShadow as function', function () {
      expect(typeof partition.shouldUseShadow).toBe('function');
    });
    test('exports getPartitionName as function', function () {
      expect(typeof partition.getPartitionName).toBe('function');
    });
    test('exports getProfileSession as function', function () {
      expect(typeof partition.getProfileSession).toBe('function');
    });
    test('exports ensurePartitionDir as function', function () {
      expect(typeof partition.ensurePartitionDir).toBe('function');
    });
  });

  // ── setBatataMode / shouldUseShadow ──

  describe('setBatataMode', function () {
    test('enables shadow mode when called with true', function () {
      partition.setBatataMode(true);
      expect(partition.shouldUseShadow(null)).toBe(true);
    });
    test('disables shadow mode when called with false', function () {
      partition.setBatataMode(true);
      partition.setBatataMode(false);
      expect(partition.shouldUseShadow(null)).toBe(false);
    });
    test('coerces truthy value 1 to boolean true', function () {
      partition.setBatataMode(1);
      expect(partition.shouldUseShadow(null)).toBe(true);
    });
    test('coerces falsy value 0 to boolean false', function () {
      partition.setBatataMode(0);
      expect(partition.shouldUseShadow(null)).toBe(false);
    });
  });

  describe('shouldUseShadow', function () {
    test('returns false by default (no batata, no profile.shadow)', function () {
      expect(partition.shouldUseShadow(null)).toBe(false);
    });
    test('returns true when profile.shadow is true', function () {
      expect(partition.shouldUseShadow({ shadow: true, id: 'p1' })).toBe(true);
    });
    test('returns false when profile.shadow is false', function () {
      expect(partition.shouldUseShadow({ shadow: false, id: 'p1' })).toBe(false);
    });
    test('returns true when batata mode is on even without profile', function () {
      partition.setBatataMode(true);
      expect(partition.shouldUseShadow(null)).toBe(true);
    });
    test('profile.shadow=true overrides batata mode off', function () {
      partition.setBatataMode(false);
      expect(partition.shouldUseShadow({ shadow: true, id: 'p1' })).toBe(true);
    });
  });

  // ── getPartitionName ──

  describe('getPartitionName', function () {
    test('同一 Profile 始终映射到同一 persist partition', function () {
      expect(partition.getPartitionName({ id: 'p_001' })).toBe('persist:profile-p_001');
      expect(partition.getPartitionName('p_001')).toBe('persist:profile-p_001');
      expect(partition.getPartitionName({ id: 'p_001', shadow: true })).toBe(
        'persist:profile-p_001'
      );
    });

    test('Profile A/B 映射不同且都不使用 default/shadow partition', function () {
      var profileA = partition.getPartitionName({ id: 'profile-a', shadow: true });
      var profileB = partition.getPartitionName({ id: 'profile-b', shadow: false });

      expect(profileA).toBe('persist:profile-profile-a');
      expect(profileB).toBe('persist:profile-profile-b');
      expect(profileA).not.toBe(profileB);
      expect(profileA).not.toBe('default');
      expect(profileA).not.toMatch(/^partition:/);
      expect(profileB).not.toMatch(/^partition:/);
    });

    test('Modo Batata 不改变腾讯 Profile 的持久映射', function () {
      partition.setBatataMode(true);
      var result = partition.getPartitionName({ id: 'p_003' });
      expect(result).toBe('persist:profile-p_003');
    });

    test('拒绝空 Profile id，避免共享异常 partition', function () {
      expect(function () {
        partition.getPartitionName(null);
      }).toThrow(/profile id/i);
      expect(function () {
        partition.getPartitionName({});
      }).toThrow(/profile id/i);
    });
  });

  describe('getProfileSession', function () {
    test('只通过稳定 persist partition 获取隔离 Session', function () {
      var isolatedSession = { id: 'isolated-session' };
      electron.session.fromPartition.mockReturnValue(isolatedSession);

      var result = partition.getProfileSession({ id: 'profile-a', shadow: true });

      expect(result).toBe(isolatedSession);
      expect(electron.session.fromPartition).toHaveBeenCalledWith('persist:profile-profile-a');
      expect(result).not.toBe(electron.session.defaultSession);
    });

    test('Profile A/B 使用不同 partition 获取 Session', function () {
      partition.getProfileSession('profile-a');
      partition.getProfileSession('profile-b');

      expect(electron.session.fromPartition.mock.calls).toEqual([
        ['persist:profile-profile-a'],
        ['persist:profile-profile-b']
      ]);
    });
  });

  // ── ensurePartitionDir ──

  describe('ensurePartitionDir', function () {
    test('shadow 标志不阻止腾讯 persist partition 目录创建', function () {
      var result = partition.ensurePartitionDir({ id: 'p_sh', shadow: true });
      expect(result).toBe(true);
      var dir = path.join(tmpDir, 'Partitions', 'profile-p_sh');
      expect(fs.existsSync(dir)).toBe(true);
    });
    test('creates partition dir for persist profile', function () {
      var result = partition.ensurePartitionDir({ id: 'p_ens1' });
      expect(result).toBe(true);
      var dir = path.join(tmpDir, 'Partitions', 'profile-p_ens1');
      expect(fs.existsSync(dir)).toBe(true);
    });
    test('returns true when dir already exists', function () {
      var dir = path.join(tmpDir, 'Partitions', 'profile-p_ens2');
      fs.mkdirSync(dir, { recursive: true });
      var result = partition.ensurePartitionDir({ id: 'p_ens2' });
      expect(result).toBe(true);
    });
    test('accepts string id directly', function () {
      var result = partition.ensurePartitionDir('p_ens3');
      expect(result).toBe(true);
      var dir = path.join(tmpDir, 'Partitions', 'profile-p_ens3');
      expect(fs.existsSync(dir)).toBe(true);
    });
    test('returns false for profile object with no id', function () {
      var result = partition.ensurePartitionDir({});
      expect(result).toBe(false);
    });
    test('returns false for null (no id)', function () {
      var result = partition.ensurePartitionDir(null);
      expect(result).toBe(false);
    });
    test('returns false for undefined (no id)', function () {
      var result = partition.ensurePartitionDir(undefined);
      expect(result).toBe(false);
    });
  });

  describe('shadow Cookie snapshot 已删除', function () {
    test('模块不导出 snapshot/restore，源码也不保留明文 JSON 路径', function () {
      var source = fs.readFileSync(path.join(__dirname, '..', 'partition.js'), 'utf8');

      expect(partition.snapshotCookies).toBeUndefined();
      expect(partition.restoreCookies).toBeUndefined();
      expect(partition.removeSnapshot).toBeUndefined();
      expect(source).not.toMatch(
        /snapshotCookies|restoreCookies|removeSnapshot|cookie-snapshots|AUTH_DOMAINS/
      );
      expect(source).not.toMatch(/cookies\.(?:get|set)\s*\(/);
    });
  });
});
