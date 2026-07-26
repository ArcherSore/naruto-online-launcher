'use strict';

const fs = require('fs');
const electron = require('electron');

jest.mock('../../../profiles/store', () => ({
  get: jest.fn(),
  getAll: jest.fn(() => []),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  reorder: jest.fn(),
  getStats: jest.fn(() => ({})),
  incrementLaunch: jest.fn(),
  addPlayTime: jest.fn(),
  exportJSON: jest.fn(() => '{"version":2,"profiles":[]}'),
  importJSON: jest.fn(() => ({ imported: 0, skipped: 0 })),
  recordLaunch: jest.fn(() => true),
  getLaunchTimeline: jest.fn(() => []),
  clearLaunchLog: jest.fn(),
  getLaunchLogStats: jest.fn(() => ({ total: 0, oldestTs: null, newestTs: null })),
  MAX_PROFILES: 10
}));

jest.mock('../../../memory/guard', () => ({
  getStats: jest.fn(() => ({ totalMB: 100 })),
  collect: jest.fn(() => ({ freed: 0 })),
  getWebviewStats: jest.fn(() => [])
}));

jest.mock('../../../profiles/partition', () => ({
  getPartitionName: jest.fn(() => 'persist:profile-p_001')
}));

jest.mock('../ManagerWindow', () => ({
  send: jest.fn(),
  getManagerWindow: jest.fn(() => null)
}));

jest.mock('../StateBroadcaster', () => ({
  pushProfiles: jest.fn(),
  pushAll: jest.fn(),
  startAutoRefresh: jest.fn()
}));

jest.mock('../../../utils/diagnostics', () => ({
  exportZip: jest.fn(() => Promise.resolve({ ok: true, size: 1024, entries: 1 })),
  _sanitizeEvent: jest.fn(event => {
    return ['resourceType', 'origin', 'pathname', 'statusCode', 'errorCode'].reduce(
      (safe, field) => {
        if (Object.prototype.hasOwnProperty.call(event, field)) safe[field] = event[field];
        return safe;
      },
      {}
    );
  })
}));

const mockInspectorInstance = {
  enable: jest.fn(),
  disable: jest.fn(),
  clear: jest.fn(),
  getEntries: jest.fn(() => [])
};
jest.mock('../../../network/inspector', () => ({
  create: jest.fn(() => mockInspectorInstance)
}));

jest.mock('../../../app/Launcher', () => ({
  isProfileOpen: jest.fn(() => false)
}));

const mockGameLauncher = {
  launchProfile: jest.fn(),
  getWebContents: jest.fn(() => null)
};
jest.mock('../../game-launcher', () => mockGameLauncher);

jest.mock('../../../config/i18n', () => ({
  getLanguage: jest.fn(() => 'pt'),
  setLanguage: jest.fn(),
  getAll: jest.fn(() => ({})),
  t: jest.fn(key => key)
}));

const store = require('../../../profiles/store');
const ManagerWindow = require('../ManagerWindow');
const StateBroadcaster = require('../StateBroadcaster');
const IpcRouter = require('../IpcRouter');

const onHandlers = {};
const handleHandlers = {};
IpcRouter.registerIpcHandlers({});
electron.ipcMain.on.mock.calls.forEach(function (call) {
  onHandlers[call[0]] = call[1];
});
electron.ipcMain.handle.mock.calls.forEach(function (call) {
  handleHandlers[call[0]] = call[1];
});

describe('IpcRouter 腾讯 Profile/安全 IPC 边界', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('保留通用 Profile CRUD、窗口、诊断和安全 inspector 通道', () => {
    expect(onHandlers['profile:create']).toBeDefined();
    expect(handleHandlers['profile:get']).toBeDefined();
    expect(onHandlers['profile:update']).toBeDefined();
    expect(onHandlers['profile:delete']).toBeDefined();
    expect(onHandlers['profile:launch']).toBeDefined();
    expect(onHandlers['profile:refresh']).toBeDefined();
    expect(handleHandlers['launch-flow:recover']).toBeDefined();
    expect(handleHandlers['diagnostics:export']).toBeDefined();
    expect(handleHandlers['inspector:entries']).toBeDefined();
    expect(handleHandlers['profiles:export']).toBeDefined();
    expect(handleHandlers['profiles:import']).toBeDefined();
  });

  test('不注册 Vault、tempmail、server、JWT/session、凭据备份或敏感调试 IPC', () => {
    [
      'vault:get',
      'vault:set',
      'vault:remove',
      'vault:has',
      'tempmail:create',
      'tempmail:login',
      'tempmail:servers',
      'servers:fetch',
      'servers:clear-cache',
      'session:check',
      'profiles:export-encrypted',
      'profiles:import-encrypted',
      'dev:get-page-source',
      'dev:get-cookies'
    ].forEach(function (channel) {
      expect(handleHandlers[channel]).toBeUndefined();
    });
    expect(onHandlers['auto-login:status']).toBeUndefined();
  });

  test('profile:create 只把通用字段传给 store，未知和旧登录字段默认拒绝', () => {
    store.create.mockReturnValue({ id: 'p_new', name: 'Safe' });

    onHandlers['profile:create'](
      {},
      {
        name: 'Safe',
        color: '#ff8c00',
        notes: 'note',
        tags: ['daily'],
        favorite: true,
        notificationsEnabled: false,
        hardwareProfile: 'balanced',
        region: 'br',
        server: 's799',
        language: 'pt',
        credentials: { token: 'fixture-token' },
        jwt: 'fixture-jwt',
        cookieValue: 'fixture-cookie',
        pageSource: '<html>fixture</html>',
        unknownIdentity: 'fixture-id'
      }
    );

    expect(store.create).toHaveBeenCalledWith({
      name: 'Safe',
      color: '#ff8c00',
      notes: 'note',
      tags: ['daily'],
      favorite: true,
      notificationsEnabled: false,
      hardwareProfile: 'balanced'
    });
    expect(StateBroadcaster.pushProfiles).toHaveBeenCalled();
  });

  test('profile:update 只接受通用字段', () => {
    onHandlers['profile:update'](
      {},
      {
        id: 'p_001',
        name: 'Safe',
        notes: 'note',
        region: 'eu',
        server: 's123',
        language: 'de',
        password: 'fixture-secret',
        jwt: 'fixture-jwt'
      }
    );

    expect(store.update).toHaveBeenCalledWith('p_001', {
      id: 'p_001',
      name: 'Safe',
      notes: 'note'
    });
  });

  test('profile:get 对返回对象再次执行通用字段 allowlist', async () => {
    store.get.mockReturnValue({
      id: 'p_001',
      name: 'Safe',
      notes: 'note',
      server: 's799',
      credentials: { token: 'fixture-token' },
      jwt: 'fixture-jwt'
    });

    const result = await handleHandlers['profile:get']({}, 'p_001');

    expect(result).toEqual({ id: 'p_001', name: 'Safe', notes: 'note' });
  });

  test('game-window:status 广播只保留 profileId/open', () => {
    onHandlers['game-window:status'](
      {},
      {
        profileId: 'p_001',
        open: true,
        server: 's799',
        jwt: 'fixture-jwt'
      }
    );

    expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
      profileId: 'p_001',
      open: true
    });
  });

  test.each([
    'RELOAD_SELECTOR',
    'REOPEN_AUTH',
    'RETRY_GAME_NAVIGATION',
    'RELOAD_GAME',
    'RETURN_TO_SELECTOR'
  ])('launch-flow:recover 只把白名单动作 %s 和 sender 委托给主进程', async action => {
    const requestRecoveryForSender = jest.fn(() => ({ ok: true }));
    const sender = { id: 41 };
    IpcRouter.registerIpcHandlers({ requestRecoveryForSender });

    const result = await handleHandlers['launch-flow:recover']({ sender }, action);

    expect(result).toEqual({ ok: true });
    expect(requestRecoveryForSender).toHaveBeenCalledWith(sender, action);
  });

  test('launch-flow:recover 拒绝任意动作、URL、Profile 和清 Session 参数', async () => {
    const requestRecoveryForSender = jest.fn();
    const sender = { id: 41 };
    IpcRouter.registerIpcHandlers({ requestRecoveryForSender });

    const unknownActionResult = await handleHandlers['launch-flow:recover'](
      { sender },
      'OPEN_ARBITRARY_URL'
    );
    const crossProfileResult = await handleHandlers['launch-flow:recover'](
      { sender },
      {
        action: 'RELOAD_SELECTOR',
        profileId: 'p_other',
        url: 'https://unknown.test/?ticket=fixture',
        clearSession: true
      }
    );

    expect(unknownActionResult).toEqual({ ok: false, error: 'invalid-action' });
    expect(crossProfileResult).toEqual({ ok: false, error: 'invalid-action' });
    expect(requestRecoveryForSender).not.toHaveBeenCalled();
  });

  test('profile:launch 只接受已有 Profile 的字符串 id', () => {
    store.get.mockReturnValue({ id: 'p_001', name: 'Safe' });
    const launch = jest.fn();
    IpcRouter.registerIpcHandlers({ launchProfile: launch });

    onHandlers['profile:launch']({}, { id: 'p_001', jwt: 'fixture-jwt' });

    expect(launch).not.toHaveBeenCalled();
  });

  test('profile:refresh 只接受已有 Profile ID 并委托安全刷新 handler', () => {
    store.get.mockImplementation(id => {
      return id === 'p_001' ? { id: 'p_001', name: 'Safe' } : null;
    });
    const refreshProfile = jest.fn(() => true);
    IpcRouter.registerIpcHandlers({ refreshProfile });

    onHandlers['profile:refresh']({}, 'p_001');
    onHandlers['profile:refresh']({}, { id: 'p_001', url: 'https://unknown.test/' });
    onHandlers['profile:refresh']({}, 'missing');

    expect(refreshProfile).toHaveBeenCalledTimes(1);
    expect(refreshProfile).toHaveBeenCalledWith('p_001');
  });

  test('inspector 返回值只含 G0 安全网络元数据', async () => {
    store.get.mockReturnValue({ id: 'p_001' });
    mockInspectorInstance.getEntries.mockReturnValue([
      {
        resourceType: 'xhr',
        origin: 'https://huoying.qq.com',
        pathname: '/server/website/',
        statusCode: 200,
        errorCode: null,
        url: 'https://huoying.qq.com/server/website/?ticket=fixture',
        Cookie: 'fixture-cookie',
        responseBody: 'fixture-body',
        pageSource: '<html>fixture</html>'
      }
    ]);

    await handleHandlers['inspector:enable']({}, 'p_001');
    const result = await handleHandlers['inspector:entries']({}, 'p_001', null);

    expect(result).toEqual({
      ok: true,
      data: {
        entries: [
          {
            resourceType: 'xhr',
            origin: 'https://huoying.qq.com',
            pathname: '/server/website/',
            statusCode: 200,
            errorCode: null
          }
        ],
        stats: null
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/ticket|cookie|responseBody|pageSource/);
  });

  test('通用 JSON 导入拒绝非字符串和超过 2MB 的输入', async () => {
    expect(await handleHandlers['profiles:import']({}, null)).toEqual({
      imported: 0,
      error: 'Invalid or too large import data'
    });
    expect(await handleHandlers['profiles:import']({}, 'x'.repeat(2 * 1024 * 1024 + 1))).toEqual({
      imported: 0,
      error: 'Invalid or too large import data'
    });
  });

  test('launchProfile wrapper 只记录通用使用统计', () => {
    IpcRouter.launchProfile('p_001');
    const onOpened = mockGameLauncher.launchProfile.mock.calls[0][1];
    const onClosed = mockGameLauncher.launchProfile.mock.calls[0][2];

    onOpened();
    onClosed();

    expect(store.incrementLaunch).toHaveBeenCalledWith('p_001');
    expect(store.recordLaunch).toHaveBeenCalledWith('p_001');
    expect(store.addPlayTime).toHaveBeenCalledWith('p_001', expect.any(Number));
  });

  test('生产源码不再依赖旧凭据和区服模块', () => {
    const source = fs.readFileSync(require.resolve('../IpcRouter'), 'utf8');
    expect(source).not.toMatch(
      /profiles\/vault|network\/tempmail|network\/api-login|server-selector|vault:|tempmail:|session:check|servers:fetch|export-encrypted|import-encrypted|auto-login:status/
    );
  });
});
