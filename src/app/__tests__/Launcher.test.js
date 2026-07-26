/**
 * Testes para src/app/Launcher.js (Fase 3d split)
 *
 * Verifica: launchProfile, focusProfile, closeProfile, isProfileOpen,
 * getWebContents, hasOpenWindows, getGameUrl, window registry Map.
 *
 * NOTA: Launcher.js mantém gameWindows Map como estado de módulo persistente.
 * O afterEach limpa o registry via onClosed callback extraído de
 * SessionLifecycle.attach. NÃO usar jest.clearAllMocks() dentro dos testes
 * — apenas no beforeEach — para que o afterEach possa encontrar os callbacks.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const electron = require('electron');

// Mock submodules
jest.mock('../../profiles/store', () => ({
  get: jest.fn(),
  getAll: jest.fn(() => [])
}));

jest.mock('../../profiles/partition', () => ({
  getPartitionName: jest.fn(() => 'persist:profile-p_001'),
  shouldUseShadow: jest.fn(() => false)
}));

jest.mock('../TencentLaunchFlow', () => ({
  createTencentLaunchFlow: jest.fn(() => ({
    start: jest.fn(),
    close: jest.fn(),
    reloadCurrentRole: jest.fn(),
    handleLoadFailure: jest.fn(),
    handleRendererGone: jest.fn(),
    handleUnresponsive: jest.fn(),
    handleResponsive: jest.fn(),
    requestRecovery: jest.fn(() => true)
  }))
}));

jest.mock('../SessionLifecycle', () => ({
  attach: jest.fn()
}));

jest.mock('../../ui/manager/KeyboardShortcuts', () => ({
  attach: jest.fn()
}));

jest.mock('../../ui/manager/StateBroadcaster', () => ({
  pushFlowState: jest.fn()
}));

jest.mock('../../config/urls', () => ({
  TENCENT_URLS: {
    SELECTOR: 'https://huoying.qq.com/server/website/'
  },
  getSelectorUrl: jest.fn(() => 'https://huoying.qq.com/server/website/'),
  getGameUrl: jest.fn(() => 'https://huoying.qq.com/server/website/'),
  getLauncherParams: jest.fn(() => '')
}));

const Launcher = require('../Launcher');
const store = require('../../profiles/store');
const SessionLifecycle = require('../SessionLifecycle');
const KeyboardShortcuts = require('../../ui/manager/KeyboardShortcuts');
const TencentLaunchFlow = require('../TencentLaunchFlow');
const urlConfig = require('../../config/urls');

/**
 * Cria mock de BrowserWindow para electron.BrowserWindow.
 */
function mockBrowserWindow() {
  const wc = {
    session: {
      setUserAgent: jest.fn(),
      cookies: { flushStore: jest.fn(() => Promise.resolve()) }
    },
    on: jest.fn(),
    once: jest.fn(),
    stop: jest.fn()
  };
  const win = {
    webContents: wc,
    on: jest.fn(),
    once: jest.fn(),
    isDestroyed: jest.fn(() => false),
    show: jest.fn(),
    focus: jest.fn(),
    close: jest.fn(),
    destroy: jest.fn(),
    setMenuBarVisibility: jest.fn(),
    setTitle: jest.fn(),
    loadURL: jest.fn()
  };
  return { win, wc };
}

describe('Launcher.js', () => {
  let bwMock;
  let origResourcesPath;
  // Track onClosed callbacks for cleanup
  let onClosedCallbacks = {};

  beforeAll(() => {
    origResourcesPath = process.resourcesPath;
    process.resourcesPath = '/tmp/naruto-test/resources';
  });

  afterAll(() => {
    process.resourcesPath = origResourcesPath;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    onClosedCallbacks = {};
    bwMock = mockBrowserWindow();
    electron.BrowserWindow.mockImplementation(function (opts) {
      bwMock._lastOpts = opts;
      return bwMock.win;
    });

    store.get.mockReturnValue({
      id: 'p_001',
      name: 'TestProfile',
      region: 'br',
      language: 'pt',
      server: 's799'
    });
  });

  afterEach(() => {
    // Clean up all tracked profiles from gameWindows registry
    Object.keys(onClosedCallbacks).forEach(function (profileId) {
      if (Launcher.isProfileOpen(profileId) && onClosedCallbacks[profileId]) {
        onClosedCallbacks[profileId]();
      }
    });
  });

  /**
   * Launches a profile and tracks the onClosed callback for cleanup.
   */
  function launchAndTrack(profileId) {
    Launcher.launchProfile(profileId);
    // Extract the onClosed callback from SessionLifecycle.attach
    var calls = SessionLifecycle.attach.mock.calls;
    for (var i = calls.length - 1; i >= 0; i--) {
      var ctx = calls[i][1];
      if (ctx.profileId === profileId && ctx.onClosed) {
        onClosedCallbacks[profileId] = ctx.onClosed;
        break;
      }
    }
  }

  describe('exports', () => {
    test('exporta launchProfile como função', () => {
      expect(typeof Launcher.launchProfile).toBe('function');
    });
    test('exporta focusProfile como função', () => {
      expect(typeof Launcher.focusProfile).toBe('function');
    });
    test('exporta closeProfile como função', () => {
      expect(typeof Launcher.closeProfile).toBe('function');
    });
    test('exporta refreshProfile como função', () => {
      expect(typeof Launcher.refreshProfile).toBe('function');
    });
    test('exporta isProfileOpen como função', () => {
      expect(typeof Launcher.isProfileOpen).toBe('function');
    });
    test('exporta getWebContents como função', () => {
      expect(typeof Launcher.getWebContents).toBe('function');
    });
    test('exporta hasOpenWindows como função', () => {
      expect(typeof Launcher.hasOpenWindows).toBe('function');
    });
    test('exporta getGameUrl como função', () => {
      expect(typeof Launcher.getGameUrl).toBe('function');
    });
    test('exporta requestRecoveryForSender como função', () => {
      expect(typeof Launcher.requestRecoveryForSender).toBe('function');
    });
  });

  describe('getGameUrl', () => {
    test('默认入口精确返回腾讯 SELECTOR，且不读取 region/server/language', () => {
      const url = Launcher.getGameUrl();
      expect(url).toBe('https://huoying.qq.com/server/website/');
      expect(urlConfig.getGameUrl).toHaveBeenCalledWith();
    });
  });

  describe('launchProfile', () => {
    test('retorna early se perfil não encontrado', () => {
      store.get.mockReturnValue(null);
      Launcher.launchProfile('nonexistent');
      expect(electron.BrowserWindow).not.toHaveBeenCalled();
    });

    test('cria BrowserWindow com opções corretas', () => {
      launchAndTrack('p_001');

      expect(electron.BrowserWindow).toHaveBeenCalled();
      const opts = bwMock._lastOpts;
      expect(opts).toBeDefined();
      expect(opts.show).toBe(false);
      expect(opts.autoHideMenuBar).toBe(true);
      expect(opts.webPreferences).toBeDefined();
      expect(opts.webPreferences.plugins).toBe(true);
      expect(opts.webPreferences.nodeIntegration).toBe(false);
      expect(opts.webPreferences.contextIsolation).toBe(true);
      expect(opts.webPreferences.partition).toBe('persist:profile-p_001');
    });

    test('腾讯路径不安装 Oasis blocker 或 Cookie/CSP 注入', () => {
      const source = fs.readFileSync(path.join(__dirname, '..', 'Launcher.js'), 'utf8');
      expect(source).not.toMatch(
        /network\/(?:blocker|cookies)|setupBlocker|setupPersistentCookies|onHeadersReceived/
      );
    });

    test('为游戏窗口挂接同一 Profile 的 TencentLaunchFlow', () => {
      launchAndTrack('p_001');

      expect(TencentLaunchFlow.createTencentLaunchFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: 'p_001',
          window: bwMock.win,
          session: bwMock.wc.session,
          partitionName: 'persist:profile-p_001',
          selectorUrl: 'https://huoying.qq.com/server/website/'
        })
      );
    });

    test('anexa SessionLifecycle com contexto correto', () => {
      launchAndTrack('p_001');

      expect(SessionLifecycle.attach).toHaveBeenCalledWith(
        bwMock.win,
        expect.objectContaining({
          profileId: 'p_001',
          profile: expect.objectContaining({ id: 'p_001' }),
          entry: expect.objectContaining({
            partitionName: 'persist:profile-p_001',
            launchFlow: expect.any(Object),
            failLoadTimer: null,
            closeTimer: null
          }),
          onReady: expect.any(Function)
        })
      );
    });

    test('ready-to-show 生命周期回调启动 TencentLaunchFlow', () => {
      launchAndTrack('p_001');
      const flow = TencentLaunchFlow.createTencentLaunchFlow.mock.results[0].value;
      const ctx = SessionLifecycle.attach.mock.calls[0][1];

      ctx.onReady();

      expect(flow.start).toHaveBeenCalledTimes(1);
    });

    test('生命周期失败、crash 和响应状态委托给同一 TencentLaunchFlow', () => {
      launchAndTrack('p_001');
      const flow = TencentLaunchFlow.createTencentLaunchFlow.mock.results[0].value;
      const ctx = SessionLifecycle.attach.mock.calls[0][1];
      const loadFailure = { errorCode: -105 };
      const rendererGone = {
        reason: 'crashed',
        errorCode: 1,
        retryCount: 1,
        retryLimit: 3,
        retryWindowMs: 600000,
        exhausted: false
      };

      ctx.onLoadFailed(loadFailure);
      ctx.onRendererGone(rendererGone);
      ctx.onUnresponsive();
      ctx.onResponsive();

      expect(flow.handleLoadFailure).toHaveBeenCalledWith(loadFailure);
      expect(flow.handleRendererGone).toHaveBeenCalledWith(rendererGone);
      expect(flow.handleUnresponsive).toHaveBeenCalledTimes(1);
      expect(flow.handleResponsive).toHaveBeenCalledTimes(1);
    });

    test('F5 只委托 TencentLaunchFlow 的当前安全角色 reload', () => {
      launchAndTrack('p_001');
      const flow = TencentLaunchFlow.createTencentLaunchFlow.mock.results[0].value;

      expect(KeyboardShortcuts.attach).toHaveBeenCalledWith(
        bwMock.win,
        'TestProfile',
        expect.any(Function)
      );
      KeyboardShortcuts.attach.mock.calls[0][2]();
      expect(flow.reloadCurrentRole).toHaveBeenCalledTimes(1);
      expect(bwMock.wc.session).not.toHaveProperty('clearStorageData');
    });

    test('管理卡片刷新只委托所属 TencentLaunchFlow 的当前安全角色 reload', () => {
      launchAndTrack('p_001');
      const flow = TencentLaunchFlow.createTencentLaunchFlow.mock.results[0].value;
      flow.reloadCurrentRole.mockReturnValue(true);

      expect(Launcher.refreshProfile('p_001')).toBe(true);
      expect(flow.reloadCurrentRole).toHaveBeenCalledTimes(1);
      expect(bwMock.wc.session).not.toHaveProperty('clearStorageData');
      expect(Launcher.refreshProfile('missing')).toBe(false);
    });

    test('恢复动作按 sender 反查当前 Profile，且只传 action/profileId/user 来源', () => {
      launchAndTrack('p_001');
      const flow = TencentLaunchFlow.createTencentLaunchFlow.mock.results[0].value;

      const result = Launcher.requestRecoveryForSender(bwMock.wc, 'RELOAD_SELECTOR');

      expect(result).toEqual({ ok: true });
      expect(flow.requestRecovery).toHaveBeenCalledWith('RELOAD_SELECTOR', {
        profileId: 'p_001',
        source: 'user'
      });
    });

    test('carrega loading screen (data:text/html)', () => {
      launchAndTrack('p_001');

      expect(bwMock.win.loadURL).toHaveBeenCalled();
      const url = bwMock.win.loadURL.mock.calls[0][0];
      expect(url).toContain('data:text/html');
      const html = decodeURIComponent(url.split(',')[1]);
      expect(html).toContain('正在加载');
      expect(html).toContain('TestProfile');
      expect(html).not.toMatch(/Carregando|Shinobi Launcher/i);
    });

    test('se perfil já está aberto: foca a janela existente', () => {
      launchAndTrack('p_001');
      const callCount = electron.BrowserWindow.mock.calls.length;

      // Launch again — should focus existing, not create new window
      Launcher.launchProfile('p_001');

      expect(electron.BrowserWindow.mock.calls.length).toBe(callCount);
      expect(bwMock.win.show).toHaveBeenCalled();
      expect(bwMock.win.focus).toHaveBeenCalled();
    });

    test('page-title-updated previne mudança de título da janela', () => {
      launchAndTrack('p_001');
      bwMock.win.setTitle.mockClear();

      var onCalls = bwMock.win.on.mock.calls;
      var titleCall = onCalls.find(function (c) {
        return c[0] === 'page-title-updated';
      });
      expect(titleCall).toBeDefined();

      var mockEvent = { preventDefault: jest.fn() };
      titleCall[1](mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(bwMock.win.setTitle).toHaveBeenCalledWith(expect.stringContaining('TestProfile'));
    });
  });

  describe('hasOpenWindows', () => {
    test('retorna false quando não há janelas', () => {
      expect(Launcher.hasOpenWindows()).toBe(false);
    });

    test('retorna true após launch', () => {
      launchAndTrack('p_001');
      expect(Launcher.hasOpenWindows()).toBe(true);
    });
  });

  describe('isProfileOpen', () => {
    test('retorna false para perfil não aberto', () => {
      expect(Launcher.isProfileOpen('nonexistent')).toBe(false);
    });

    test('retorna true após launch', () => {
      launchAndTrack('p_001');
      expect(Launcher.isProfileOpen('p_001')).toBe(true);
    });
  });

  describe('getWebContents', () => {
    test('retorna null para perfil não aberto', () => {
      expect(Launcher.getWebContents('nonexistent')).toBe(null);
    });

    test('retorna webContents para perfil aberto', () => {
      launchAndTrack('p_001');
      const wc = Launcher.getWebContents('p_001');
      expect(wc).toBe(bwMock.wc);
    });
  });

  describe('focusProfile', () => {
    test('não lança para perfil não aberto', () => {
      expect(() => Launcher.focusProfile('nonexistent')).not.toThrow();
    });

    test('foca janela existente', () => {
      launchAndTrack('p_001');
      // Reset call counts (but not implementations)
      bwMock.win.show.mockClear();
      bwMock.win.focus.mockClear();

      Launcher.focusProfile('p_001');
      expect(bwMock.win.show).toHaveBeenCalled();
      expect(bwMock.win.focus).toHaveBeenCalled();
    });
  });

  describe('closeProfile', () => {
    test('não lança para perfil não aberto', () => {
      expect(() => Launcher.closeProfile('nonexistent')).not.toThrow();
    });

    test('chama close na janela existente', () => {
      launchAndTrack('p_001');
      bwMock.win.close.mockClear();

      Launcher.closeProfile('p_001');
      expect(bwMock.win.close).toHaveBeenCalled();
    });
  });

  describe('window registry (gameWindows Map)', () => {
    test('onClosed callback remove entrada do registry', () => {
      launchAndTrack('p_001');
      expect(Launcher.isProfileOpen('p_001')).toBe(true);

      // Call the tracked onClosed callback
      onClosedCallbacks['p_001']();
      expect(Launcher.isProfileOpen('p_001')).toBe(false);
    });

    test('launch cria entrada no registry com campos esperados', () => {
      launchAndTrack('p_001');

      var calls = SessionLifecycle.attach.mock.calls;
      var ctx = calls[calls.length - 1][1];
      var entry = ctx.entry;
      expect(entry).toHaveProperty('window');
      expect(entry).toHaveProperty('partitionName');
      expect(entry).toHaveProperty('launchFlow');
      expect(entry).toHaveProperty('lifecycle');
      expect(entry).toHaveProperty('failLoadTimer');
      expect(entry).toHaveProperty('closeTimer');
    });

    test('onClosed 关闭流程并移除 registry', () => {
      launchAndTrack('p_001');
      const flow = TencentLaunchFlow.createTencentLaunchFlow.mock.results[0].value;

      onClosedCallbacks['p_001']();

      expect(flow.close).toHaveBeenCalledTimes(1);
      expect(Launcher.isProfileOpen('p_001')).toBe(false);
    });
  });
});
