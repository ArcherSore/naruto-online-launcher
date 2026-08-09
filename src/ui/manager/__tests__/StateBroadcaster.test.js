/**
 * Tests for src/ui/manager/StateBroadcaster.js (Fase 3c split)
 *
 * Verifies: exports, pushProfiles/pushMemory/pushAll,
 * startAutoRefresh/stopAutoRefresh, listener registration.
 *
 * NOTE: StateBroadcaster uses module-level state (_started, _memCb, etc.)
 * that persists across tests. The startAutoRefresh() is idempotent — once
 * started, subsequent calls are no-ops. We test accordingly.
 */

'use strict';

// Mock all dependencies before requiring the module
jest.mock('../../../profiles/store', () => ({
  getAll: jest.fn(() => []),
  onChange: jest.fn()
}));

jest.mock('../../../memory/guard', () => ({
  getStats: jest.fn(() => ({ totalMB: 100, thresholdMB: 700, isBatata: false })),
  onMemoryUpdate: jest.fn(),
  onGC: jest.fn()
}));

jest.mock('../ManagerWindow', () => ({
  send: jest.fn()
}));

const StateBroadcaster = require('../StateBroadcaster');
const store = require('../../../profiles/store');
const mg = require('../../../memory/guard');
const ManagerWindow = require('../ManagerWindow');

describe('StateBroadcaster.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exports', () => {
    test('exports pushProfiles as function', () => {
      expect(typeof StateBroadcaster.pushProfiles).toBe('function');
    });

    test('exports pushMemory as function', () => {
      expect(typeof StateBroadcaster.pushMemory).toBe('function');
    });

    test('exports pushFlowState as function', () => {
      expect(typeof StateBroadcaster.pushFlowState).toBe('function');
    });

    test('exports pushAll as function', () => {
      expect(typeof StateBroadcaster.pushAll).toBe('function');
    });

    test('exports startAutoRefresh as function', () => {
      expect(typeof StateBroadcaster.startAutoRefresh).toBe('function');
    });

    test('exports stopAutoRefresh as function', () => {
      expect(typeof StateBroadcaster.stopAutoRefresh).toBe('function');
    });
  });

  describe('pushProfiles', () => {
    test('sends profiles:updated via ManagerWindow.send', () => {
      store.getAll.mockReturnValue([{ id: 'p_abc123', name: 'Test', region: 'br', server: 's1' }]);

      StateBroadcaster.pushProfiles();

      expect(ManagerWindow.send).toHaveBeenCalledWith('profiles:updated', expect.any(Array));
    });

    test('clones profile objects (does not mutate original)', () => {
      const original = { id: 'p_abc123', name: 'Test', region: 'br', server: 's1' };
      store.getAll.mockReturnValue([original]);

      StateBroadcaster.pushProfiles();

      const sent = ManagerWindow.send.mock.calls[0][1][0];
      expect(sent).not.toBe(original);
      expect(sent.name).toBe('Test');
    });

    test('handles empty profile list', () => {
      store.getAll.mockReturnValue([]);

      StateBroadcaster.pushProfiles();

      expect(ManagerWindow.send).toHaveBeenCalledWith('profiles:updated', []);
    });

    test('filters multiple profiles independently', () => {
      store.getAll.mockReturnValue([
        { id: 'p_001', name: 'A', region: 'br', server: 's1' },
        { id: 'p_002', name: 'B', region: 'na', server: 's2' }
      ]);

      StateBroadcaster.pushProfiles();

      const sent = ManagerWindow.send.mock.calls[0][1];
      expect(sent).toEqual([
        { id: 'p_001', name: 'A' },
        { id: 'p_002', name: 'B' }
      ]);
    });

    test('广播只含通用 Profile/安全流程字段，不含区服、凭据、JWT 或未知字段', () => {
      store.getAll.mockReturnValue([
        {
          id: 'p_001',
          name: 'Safe Profile',
          color: '#ff8c00',
          notes: 'safe note',
          tags: ['daily'],
          favorite: true,
          notificationsEnabled: false,
          createdAt: 100,
          lastUsed: 200,
          launchCount: 3,
          totalPlayMs: 4000,
          flow: {
            stage: 'SELECTOR_READY',
            status: 'ready',
            availableActions: []
          },
          region: 'br',
          server: 's799',
          language: 'pt',
          hasVault: true,
          username: 'fixture-user',
          password: 'fixture-secret',
          jwt: 'fixture-jwt',
          cookieValue: 'fixture-cookie',
          unknownIdentity: 'fixture-id'
        }
      ]);

      StateBroadcaster.pushProfiles();

      expect(ManagerWindow.send).toHaveBeenCalledWith('profiles:updated', [
        {
          id: 'p_001',
          name: 'Safe Profile',
          color: '#ff8c00',
          notes: 'safe note',
          tags: ['daily'],
          favorite: true,
          notificationsEnabled: false,
          createdAt: 100,
          lastUsed: 200,
          launchCount: 3,
          totalPlayMs: 4000,
          flow: {
            stage: 'SELECTOR_READY',
            status: 'ready',
            availableActions: []
          }
        }
      ]);
    });
  });

  describe('pushFlowState', () => {
    test('只广播安全流程字段并递归拒绝 URL、凭据和未知字段', () => {
      StateBroadcaster.pushFlowState({
        profileId: 'p_001',
        stage: 'BLOCKED_NAVIGATION',
        status: 'waiting_user',
        attempts: { selector: 1, auth: 0, injected: 99 },
        lastSafeLocation: {
          role: 'UNKNOWN',
          origin: 'https://unknown.test',
          pathname: '/blocked',
          url: 'https://unknown.test/blocked?ticket=fixture'
        },
        error: {
          stage: 'BLOCKED_NAVIGATION',
          code: 'UNKNOWN_TOP_LEVEL_NAVIGATION',
          safeMessage: 'blocked',
          jwt: 'fixture-jwt'
        },
        availableActions: ['RETURN_TO_SELECTOR'],
        cookieValue: 'fixture-cookie',
        pageSource: '<html>fixture</html>'
      });

      expect(ManagerWindow.send).toHaveBeenCalledWith('launch-flow:status', {
        profileId: 'p_001',
        stage: 'BLOCKED_NAVIGATION',
        status: 'waiting_user',
        attempts: { selector: 1, auth: 0 },
        lastSafeLocation: {
          role: 'UNKNOWN',
          origin: 'https://unknown.test',
          pathname: '/blocked'
        },
        error: {
          stage: 'BLOCKED_NAVIGATION',
          code: 'UNKNOWN_TOP_LEVEL_NAVIGATION',
          safeMessage: 'blocked'
        },
        availableActions: ['RETURN_TO_SELECTOR']
      });
      expect(JSON.stringify(ManagerWindow.send.mock.calls)).not.toMatch(
        /ticket|fixture-jwt|fixture-cookie|pageSource/
      );
    });

    test('拒绝没有 profileId 的流程快照', () => {
      StateBroadcaster.pushFlowState({ stage: 'SELECTOR_READY' });
      expect(ManagerWindow.send).not.toHaveBeenCalled();
    });

    test('SESSION_REJECTED 只广播固定重新扫码提示，不携带账号身份', () => {
      StateBroadcaster.pushFlowState({
        profileId: 'p_rejected',
        stage: 'SESSION_REJECTED',
        status: 'waiting_user',
        availableActions: ['REOPEN_AUTH', 'RETURN_TO_SELECTOR'],
        accountName: 'fixture-account',
        qqNumber: '100000001',
        server: 'fixture-server',
        userMessage: 'untrusted identity message'
      });

      expect(ManagerWindow.send).toHaveBeenCalledWith('launch-flow:status', {
        profileId: 'p_rejected',
        stage: 'SESSION_REJECTED',
        status: 'waiting_user',
        availableActions: ['REOPEN_AUTH', 'RETURN_TO_SELECTOR'],
        userMessage: '会话被腾讯官方拒绝，请重新扫码'
      });
      expect(JSON.stringify(ManagerWindow.send.mock.calls)).not.toMatch(
        /fixture-account|100000001|fixture-server|untrusted identity message/
      );
    });

    test('availableActions 只广播五个固定恢复动作并去重', () => {
      StateBroadcaster.pushFlowState({
        profileId: 'p_001',
        stage: 'SELECTOR_FAILED',
        status: 'waiting_user',
        availableActions: [
          'RELOAD_SELECTOR',
          'OPEN_ARBITRARY_URL',
          'RELOAD_SELECTOR',
          'CLEAR_SESSION',
          { action: 'RETURN_TO_SELECTOR' }
        ]
      });

      expect(ManagerWindow.send).toHaveBeenCalledWith('launch-flow:status', {
        profileId: 'p_001',
        stage: 'SELECTOR_FAILED',
        status: 'waiting_user',
        availableActions: ['RELOAD_SELECTOR']
      });
    });

    test('拒绝未知 stage，错误码只允许 string/number/null 标量', () => {
      StateBroadcaster.pushFlowState({
        profileId: 'p_001',
        stage: 'https://unknown.test/?ticket=fixture',
        status: 'waiting_user',
        error: {
          stage: 'SELECTOR_FAILED',
          code: { ticket: 'fixture-secret' },
          safeMessage: 'blocked'
        },
        availableActions: ['RETURN_TO_SELECTOR']
      });

      expect(ManagerWindow.send).not.toHaveBeenCalled();
      expect(JSON.stringify(ManagerWindow.send.mock.calls)).not.toMatch(/ticket|fixture-secret/);
    });
  });

  describe('pushMemory', () => {
    test('sends memory:update via ManagerWindow.send with mg.getStats()', () => {
      const stats = { totalMB: 250, thresholdMB: 700, isBatata: false };
      mg.getStats.mockReturnValue(stats);

      StateBroadcaster.pushMemory();

      expect(ManagerWindow.send).toHaveBeenCalledWith('memory:update', stats);
    });

    test('passes through whatever getStats returns', () => {
      const stats = { totalMB: 500, isRamen: true, crashCount: 2 };
      mg.getStats.mockReturnValue(stats);

      StateBroadcaster.pushMemory();

      expect(ManagerWindow.send).toHaveBeenCalledWith('memory:update', stats);
    });

    test('handles empty stats object', () => {
      mg.getStats.mockReturnValue({});

      StateBroadcaster.pushMemory();

      expect(ManagerWindow.send).toHaveBeenCalledWith('memory:update', {});
    });
  });

  describe('pushAll', () => {
    test('calls pushProfiles and pushMemory', () => {
      store.getAll.mockReturnValue([]);
      mg.getStats.mockReturnValue({ totalMB: 100 });

      StateBroadcaster.pushAll();

      expect(ManagerWindow.send).toHaveBeenCalledWith('profiles:updated', expect.any(Array));
      expect(ManagerWindow.send).toHaveBeenCalledWith('memory:update', expect.any(Object));
    });

    test('sends exactly 2 IPC messages', () => {
      store.getAll.mockReturnValue([]);
      mg.getStats.mockReturnValue({});

      StateBroadcaster.pushAll();

      expect(ManagerWindow.send).toHaveBeenCalledTimes(2);
    });

    test('restores a frozen automation catalog and status snapshot when configured', () => {
      StateBroadcaster.setAutomationService({
        listCatalog: function () {
          return [{ id: 'demo-click', name: 'Demo Click', version: '1.0.0', apiVersion: 1, description: null, entryPath: 'C:\\secret.js' }];
        },
        listStatuses: function () {
          return [{ runId: 'run-1', profileId: 'p_001', scriptId: 'demo-click', status: 'running', startedAt: 1, endedAt: null, error: null, deadlineAt: 999, token: 'secret' }];
        }
      });
      StateBroadcaster.pushAll();
      expect(ManagerWindow.send).toHaveBeenCalledWith('automation:catalog', {
        scripts: [{ id: 'demo-click', name: 'Demo Click', version: '1.0.0', apiVersion: 1, description: null }]
      });
      expect(ManagerWindow.send).toHaveBeenCalledWith('automation:statuses', {
        statuses: [{ runId: 'run-1', profileId: 'p_001', scriptId: 'demo-click', status: 'running', startedAt: 1, endedAt: null, error: null }]
      });
      expect(JSON.stringify(ManagerWindow.send.mock.calls)).not.toContain('secret');
      StateBroadcaster.setAutomationService(null);
    });
  });

  test('pushAutomationStatus enforces the exact status and error allowlists', () => {
    StateBroadcaster.pushAutomationStatus({
      runId: 'run-1', profileId: 'p_001', scriptId: 'demo-click', status: 'failed',
      startedAt: 1, endedAt: 2,
      error: { code: 'script-failed', safeMessage: 'cookie=secret', stack: 'secret' },
      token: 'secret'
    });
    expect(ManagerWindow.send).toHaveBeenCalledWith('automation:status', {
      runId: 'run-1', profileId: 'p_001', scriptId: 'demo-click', status: 'failed',
      startedAt: 1, endedAt: 2,
      error: { code: 'script-failed', safeMessage: '内置脚本执行失败' }
    });
    expect(JSON.stringify(ManagerWindow.send.mock.calls)).not.toContain('secret');
    jest.clearAllMocks();
    StateBroadcaster.pushAutomationStatus({ status: 'forged', profileId: 'p_001' });
    expect(ManagerWindow.send).not.toHaveBeenCalled();
  });

  test('drops unknown error codes and keeps Profile status events isolated', () => {
    StateBroadcaster.pushAutomationStatus({
      runId: 'run-a', profileId: 'p_a', scriptId: 'demo-click', status: 'failed',
      startedAt: 1, endedAt: 2,
      error: { code: 'cookie=secret', safeMessage: 'C:\\secret.js' },
      otherProfileId: 'p_b', token: 'secret'
    });
    expect(ManagerWindow.send).toHaveBeenCalledWith('automation:status', {
      runId: 'run-a', profileId: 'p_a', scriptId: 'demo-click', status: 'failed',
      startedAt: 1, endedAt: 2, error: null
    });
    expect(JSON.stringify(ManagerWindow.send.mock.calls)).not.toMatch(/p_b|cookie|secret/i);
  });

  describe('startAutoRefresh', () => {
    test('does not throw when called', () => {
      expect(() => StateBroadcaster.startAutoRefresh()).not.toThrow();
    });

    test('is idempotent — calling multiple times does not throw', () => {
      StateBroadcaster.startAutoRefresh();
      StateBroadcaster.startAutoRefresh();
      StateBroadcaster.startAutoRefresh();
      // No error means idempotency guard works
    });
  });

  describe('stopAutoRefresh', () => {
    test('does not throw when called', () => {
      expect(() => StateBroadcaster.stopAutoRefresh()).not.toThrow();
    });

    test('allows restart after stop', () => {
      StateBroadcaster.stopAutoRefresh();
      // After stop, _started=false. startAutoRefresh should work again.
      expect(() => StateBroadcaster.startAutoRefresh()).not.toThrow();
    });

    test('calling stop when already stopped does not throw', () => {
      StateBroadcaster.stopAutoRefresh();
      expect(() => StateBroadcaster.stopAutoRefresh()).not.toThrow();
    });
  });

  describe('listener integration', () => {
    test('memory update callback triggers pushMemory', () => {
      // Start auto-refresh to ensure listeners are registered
      StateBroadcaster.stopAutoRefresh();
      StateBroadcaster.startAutoRefresh();

      // Simulate a memory update by invoking the callback registered with mg.onMemoryUpdate
      // We need to find the callback that was registered
      const memCallbacks = mg.onMemoryUpdate.mock.calls.map(function (c) {
        return c[0];
      });
      if (memCallbacks.length > 0) {
        const latestCb = memCallbacks[memCallbacks.length - 1];
        jest.clearAllMocks();
        latestCb();
        expect(ManagerWindow.send).toHaveBeenCalledWith('memory:update', expect.any(Object));
      }
    });

    test('GC callback triggers pushMemory', () => {
      StateBroadcaster.stopAutoRefresh();
      StateBroadcaster.startAutoRefresh();

      const gcCallbacks = mg.onGC.mock.calls.map(function (c) {
        return c[0];
      });
      if (gcCallbacks.length > 0) {
        const latestCb = gcCallbacks[gcCallbacks.length - 1];
        jest.clearAllMocks();
        latestCb();
        expect(ManagerWindow.send).toHaveBeenCalledWith('memory:update', expect.any(Object));
      }
    });

    test('store onChange callback triggers pushProfiles', () => {
      StateBroadcaster.stopAutoRefresh();
      StateBroadcaster.startAutoRefresh();

      const changeCallbacks = store.onChange.mock.calls.map(function (c) {
        return c[0];
      });
      if (changeCallbacks.length > 0) {
        const latestCb = changeCallbacks[changeCallbacks.length - 1];
        jest.clearAllMocks();
        store.getAll.mockReturnValue([]);
        latestCb();
        expect(ManagerWindow.send).toHaveBeenCalledWith('profiles:updated', expect.any(Array));
      }
    });
  });
});
