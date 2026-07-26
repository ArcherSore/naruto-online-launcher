'use strict';

const {
  LaunchFlowState,
  createTencentLaunchFlow,
  createPageProbe,
  ProbeBudget,
  PROBE_SELECTOR_REGISTRY,
  STAGES,
  STATUSES,
  ATTEMPT_LIMITS,
  RECOVERY_ACTIONS
} = require('../TencentLaunchFlow');
const electron = require('electron');
const urlConfig = require('../../config/urls');

const SELECTOR_URL = 'https://huoying.qq.com/server/website/';
const GAME_URL = 'https://game.huoying.qq.com/main.html';
const AUTH_URL = 'https://auth.fixture.test/login';
const AUTH_CONFIRM_URL = 'https://auth.fixture.test/confirm';

function classifyFixtureUrl(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'auth.fixture.test' &&
    parsed.port === '' &&
    ['/login', '/confirm'].indexOf(parsed.pathname) !== -1
  ) {
    return urlConfig.URL_ROLES.AUTH;
  }
  return urlConfig.classifyUrl(value);
}

function safeFixtureLocation(value) {
  const parsed = new URL(value);
  return {
    role: classifyFixtureUrl(value),
    origin: parsed.origin,
    pathname: parsed.pathname
  };
}

function createController(overrides) {
  const parent = new electron.BrowserWindow({
    webPreferences: {
      partition: 'persist:profile-a',
      plugins: true,
      preload: 'game-preload.js'
    }
  });
  const options = Object.assign(
    {
      profileId: 'profile-a',
      window: parent,
      session: parent.webContents.session,
      partitionName: 'persist:profile-a',
      selectorUrl: SELECTOR_URL,
      classifyUrl: classifyFixtureUrl,
      toSafeLocation: safeFixtureLocation,
      probe: jest.fn(() =>
        Promise.resolve({
          loginUiVisible: false,
          selectorReady: 'unknown',
          flashContainerVisible: false
        })
      )
    },
    overrides
  );
  return {
    parent,
    options,
    controller: createTencentLaunchFlow(options)
  };
}

function createFlow(overrides) {
  return new LaunchFlowState(
    Object.assign(
      {
        profileId: 'profile-a'
      },
      overrides
    )
  );
}

function flushAsyncWork() {
  return new Promise(resolve => setImmediate(resolve));
}

describe('LaunchFlowState', () => {
  test('以 BOOTSTRAPPING/idle 和隔离的有限计数初始化', () => {
    const flow = createFlow();

    expect(flow.getSnapshot()).toEqual(
      expect.objectContaining({
        profileId: 'profile-a',
        stage: STAGES.BOOTSTRAPPING,
        status: STATUSES.IDLE,
        attempts: {
          selector: 0,
          auth: 0,
          navigation: 0,
          game: 0,
          crash: 0
        },
        error: null,
        availableActions: []
      })
    );
  });

  test('允许契约定义的主链状态迁移', () => {
    const flow = createFlow();

    [
      STAGES.SELECTOR_LOADING,
      STAGES.SELECTOR_READY,
      STAGES.AUTHENTICATING,
      STAGES.SELECTOR_READY,
      STAGES.GAME_NAVIGATING,
      STAGES.GAME_LOADING,
      STAGES.GAME_READY,
      STAGES.CLOSED
    ].forEach(nextStage => flow.transitionTo(nextStage));

    expect(flow.stage).toBe(STAGES.CLOSED);
    expect(flow.status).toBe(STATUSES.IDLE);
  });

  test('拒绝非法跳跃且保持原状态', () => {
    const flow = createFlow();

    expect(() => flow.transitionTo(STAGES.GAME_READY)).toThrow(/invalid transition/i);
    expect(flow.stage).toBe(STAGES.BOOTSTRAPPING);
    expect(flow.status).toBe(STATUSES.IDLE);
  });

  test('CLOSED 是终态，不能重新进入加载状态', () => {
    const flow = createFlow();
    flow.transitionTo(STAGES.CLOSED);

    expect(() => flow.transitionTo(STAGES.SELECTOR_LOADING)).toThrow(/invalid transition/i);
  });

  test('阶段恢复计数受上限约束且不会无限增长', () => {
    const flow = createFlow();

    expect(ATTEMPT_LIMITS).toEqual({
      selector: 1,
      auth: 1,
      navigation: 1,
      game: 1,
      crash: 3
    });

    expect(flow.consumeAttempt('selector')).toBe(true);
    expect(flow.consumeAttempt('selector')).toBe(false);
    expect(flow.getSnapshot().attempts.selector).toBe(1);

    expect(flow.consumeAttempt('crash')).toBe(true);
    expect(flow.consumeAttempt('crash')).toBe(true);
    expect(flow.consumeAttempt('crash')).toBe(true);
    expect(flow.consumeAttempt('crash')).toBe(false);
    expect(flow.getSnapshot().attempts.crash).toBe(3);
  });

  test('拒绝未知计数类别', () => {
    const flow = createFlow();

    expect(() => flow.consumeAttempt('unbounded')).toThrow(/unknown attempt/i);
  });

  test('UNKNOWN 顶层导航被阻止且只保留安全位置', () => {
    const flow = createFlow();
    flow.transitionTo(STAGES.SELECTOR_LOADING);

    flow.blockUnknown({
      role: 'UNKNOWN',
      origin: 'https://unknown.example',
      pathname: '/blocked',
      url: 'https://unknown.example/blocked?ticket=never-log#secret'
    });

    expect(flow.stage).toBe(STAGES.BLOCKED_NAVIGATION);
    expect(flow.status).toBe(STATUSES.WAITING_USER);
    expect(flow.getSnapshot().lastSafeLocation).toEqual({
      role: 'UNKNOWN',
      origin: 'https://unknown.example',
      pathname: '/blocked'
    });
    expect(JSON.stringify(flow.getSnapshot())).not.toContain('ticket');
    expect(flow.getAllowedRecoveryActions()).toEqual([RECOVERY_ACTIONS.RETURN_TO_SELECTOR]);
  });

  test.each([
    [STAGES.SELECTOR_LOADING, RECOVERY_ACTIONS.RELOAD_SELECTOR, true],
    [STAGES.AUTHENTICATING, RECOVERY_ACTIONS.REOPEN_AUTH, true],
    [STAGES.GAME_NAVIGATING, RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION, true],
    [STAGES.GAME_LOADING, RECOVERY_ACTIONS.RELOAD_GAME, true],
    [STAGES.GAME_LOADING, RECOVERY_ACTIONS.RELOAD_SELECTOR, false]
  ])('恢复动作白名单：%s / %s => %s', (stage, action, expected) => {
    const flow = createFlow();
    flow.transitionTo(STAGES.SELECTOR_LOADING);

    if (stage === STAGES.AUTHENTICATING) {
      flow.transitionTo(STAGES.SELECTOR_READY);
      flow.transitionTo(STAGES.AUTHENTICATING);
    } else if (stage === STAGES.GAME_NAVIGATING || stage === STAGES.GAME_LOADING) {
      flow.transitionTo(STAGES.SELECTOR_READY);
      flow.transitionTo(STAGES.GAME_NAVIGATING);
      if (stage === STAGES.GAME_LOADING) flow.transitionTo(STAGES.GAME_LOADING);
    }

    expect(
      flow.isRecoveryAllowed(action, {
        profileId: 'profile-a',
        source: 'user'
      })
    ).toBe(expected);
  });

  test('拒绝未知动作、跨 Profile 来源和非白名单来源', () => {
    const flow = createFlow();
    flow.transitionTo(STAGES.SELECTOR_LOADING);

    expect(
      flow.isRecoveryAllowed('LOAD_ARBITRARY_URL', {
        profileId: 'profile-a',
        source: 'user'
      })
    ).toBe(false);
    expect(
      flow.isRecoveryAllowed(RECOVERY_ACTIONS.RELOAD_SELECTOR, {
        profileId: 'profile-b',
        source: 'user'
      })
    ).toBe(false);
    expect(
      flow.isRecoveryAllowed(RECOVERY_ACTIONS.RELOAD_SELECTOR, {
        profileId: 'profile-a',
        source: 'renderer-url'
      })
    ).toBe(false);
  });

  test('状态迁移、UNKNOWN 阻止和恢复校验均不清理 Session', () => {
    const session = {
      clearStorageData: jest.fn()
    };
    const flow = createFlow({ session });

    flow.transitionTo(STAGES.SELECTOR_LOADING);
    flow.consumeAttempt('selector');
    flow.blockUnknown({
      role: 'UNKNOWN',
      origin: 'https://unknown.example',
      pathname: '/blocked'
    });
    flow.isRecoveryAllowed(RECOVERY_ACTIONS.RETURN_TO_SELECTOR, {
      profileId: 'profile-a',
      source: 'user'
    });

    expect(session.clearStorageData).not.toHaveBeenCalled();
  });
});

describe('TencentLaunchFlow Electron 11 路由', () => {
  beforeEach(() => {
    electron.__mock.reset();
    electron.BrowserWindow.mockImplementation(function (options) {
      return electron.__mock.createBrowserWindow(options);
    });
    jest.clearAllMocks();
  });

  test('start 从 BOOTSTRAPPING 进入 SELECTOR_LOADING 并加载固定入口', () => {
    const context = createController();

    context.controller.start();

    expect(context.parent.loadURL).toHaveBeenCalledWith(SELECTOR_URL);
    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_LOADING);
  });

  function reachGameLoading(context) {
    context.controller.start();
    context.parent.webContents._emitWillNavigate(GAME_URL);
    context.parent.webContents._setURL(GAME_URL);
    context.parent.webContents.emit('did-start-navigation', {}, GAME_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
    expect(context.controller.getSnapshot().stage).toBe(STAGES.GAME_LOADING);
  }

  test('reloadCurrentRole 只 reload 已分类角色且保留当前 Session', () => {
    const context = createController();
    context.controller.start();
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');

    expect(context.controller.reloadCurrentRole()).toBe(true);
    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_LOADING);
    expect(context.parent.webContents.reload).toHaveBeenCalledTimes(1);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('reloadCurrentRole 拒绝 UNKNOWN 且不触发直接 reload', () => {
    const context = createController();
    context.controller.start();
    context.parent.webContents._setURL('data:text/html,loading');

    expect(context.controller.reloadCurrentRole()).toBe(false);
    expect(context.parent.webContents.reload).not.toHaveBeenCalled();
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test.each([
    ['SELECTOR', SELECTOR_URL],
    ['AUTH', AUTH_URL]
  ])('游戏阶段被官方带回 %s 时进入 SESSION_REJECTED 且不清 Session', (_role, value) => {
    const context = createController();
    reachGameLoading(context);

    context.parent.webContents._emitWillNavigate(value);
    context.parent.webContents._setURL(value);
    context.parent.webContents.emit('did-start-navigation', {}, value, false, true);
    context.parent.webContents.emit('did-finish-load');

    expect(context.controller.getSnapshot()).toEqual(
      expect.objectContaining({
        stage: STAGES.SESSION_REJECTED,
        status: STATUSES.WAITING_USER,
        availableActions: expect.arrayContaining([
          RECOVERY_ACTIONS.REOPEN_AUTH,
          RECOVERY_ACTIONS.RETURN_TO_SELECTOR
        ])
      })
    );
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('SESSION_REJECTED 重新扫码后回 SELECTOR_READY 且不自动选服或进入游戏', async () => {
    const context = createController();
    reachGameLoading(context);

    context.parent.webContents._emitWillNavigate(SELECTOR_URL);
    expect(context.controller.getSnapshot().stage).toBe(STAGES.SESSION_REJECTED);

    context.parent.webContents._emitNewWindow(AUTH_URL);
    const authWindow = electron.__mock.createdWindows[1];
    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);

    authWindow.webContents._emitWillNavigate(SELECTOR_URL);
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
    await flushAsyncWork();

    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_READY);
    expect(
      context.parent.loadURL.mock.calls.filter(function (call) {
        return call[0] === GAME_URL;
      })
    ).toHaveLength(1);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test.each([
    ['will-navigate', '_emitWillNavigate'],
    ['will-redirect', '_emitRedirect'],
    ['did-redirect-navigation', '_emitDidRedirectNavigation']
  ])('%s 将同页 GAME_MAIN 接管回原 PPAPI 窗口', (_eventName, helper) => {
    const context = createController();
    context.controller.start();

    const event = context.parent.webContents[helper](GAME_URL + '?ticket=ephemeral#game');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(context.parent.loadURL).toHaveBeenLastCalledWith(GAME_URL + '?ticket=ephemeral#game');
    expect(context.controller.getSnapshot().stage).toBe(STAGES.GAME_NAVIGATING);
  });

  test('GAME_MAIN new-window 被阻止创建外窗并加载到原游戏窗口', () => {
    const context = createController();
    context.controller.start();

    const event = context.parent.webContents._emitNewWindow(GAME_URL, 'new-window');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(1);
    expect(context.parent.loadURL).toHaveBeenLastCalledWith(GAME_URL);
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  test('SELECTOR 到 AUTH popup 创建共享 Profile Session 的安全子窗', () => {
    const context = createController();
    context.controller.start();

    const event = context.parent.webContents._emitNewWindow(AUTH_URL, 'new-window');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(2);
    const authWindow = electron.__mock.createdWindows[1];
    expect(authWindow.webContents.session).toBe(context.parent.webContents.session);
    expect(authWindow.webPreferences).toEqual({
      partition: 'persist:profile-a',
      plugins: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      enableRemoteModule: false,
      webviewTag: false
    });
    expect(authWindow.webPreferences).not.toHaveProperty('preload');
    expect(authWindow.loadURL).toHaveBeenCalledWith(AUTH_URL);
    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);
  });

  test.each([
    ['navigate', '_emitWillNavigate'],
    ['redirect', '_emitRedirect'],
    ['did-redirect-navigation', '_emitDidRedirectNavigation']
  ])('认证子窗自身 %s 继续使用精确分类并允许已批准 AUTH', (_label, helper) => {
    const context = createController();
    context.controller.start();
    context.parent.webContents._emitNewWindow(AUTH_URL);
    const authWindow = electron.__mock.createdWindows[1];

    const event = authWindow.webContents[helper](AUTH_CONFIRM_URL + '?ticket=opaque');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(2);
  });

  test('认证子窗二次 AUTH popup 复用唯一安全子窗并递归接线', () => {
    const context = createController();
    context.controller.start();
    context.parent.webContents._emitNewWindow(AUTH_URL);
    const authWindow = electron.__mock.createdWindows[1];

    const event = authWindow.webContents._emitNewWindow(AUTH_CONFIRM_URL);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.BrowserWindow).toHaveBeenCalledTimes(2);
    expect(authWindow.loadURL).toHaveBeenLastCalledWith(AUTH_CONFIRM_URL);
    expect(authWindow.webContents.listenerCount('will-navigate')).toBe(1);
    expect(authWindow.webContents.listenerCount('will-redirect')).toBe(1);
    expect(authWindow.webContents.listenerCount('new-window')).toBe(1);
  });

  test.each([
    [
      'parent navigate',
      function (context) {
        return context.parent.webContents._emitWillNavigate(
          'https://huoying.qq.com.evil.test/server/website/'
        );
      }
    ],
    [
      'parent redirect',
      function (context) {
        return context.parent.webContents._emitRedirect('custom://auth/login');
      }
    ],
    [
      'auth navigate',
      function (context) {
        context.parent.webContents._emitNewWindow(AUTH_URL);
        return electron.__mock.createdWindows[1].webContents._emitWillNavigate(
          'https://auth.fixture.test.evil.test/login'
        );
      }
    ],
    [
      'auth popup',
      function (context) {
        context.parent.webContents._emitNewWindow(AUTH_URL);
        return electron.__mock.createdWindows[1].webContents._emitNewWindow(
          'https://unknown.fixture.test/help'
        );
      }
    ]
  ])('%s 的 UNKNOWN 被阻止且保持可恢复状态', (_label, emitUnknown) => {
    const context = createController();
    context.controller.start();

    const event = emitUnknown(context);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(context.controller.getSnapshot()).toEqual(
      expect.objectContaining({
        stage: STAGES.BLOCKED_NAVIGATION,
        status: STATUSES.WAITING_USER,
        availableActions: [RECOVERY_ACTIONS.RETURN_TO_SELECTOR]
      })
    );
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });
});

describe('T046 四阶段失败与恢复契约（Red）', () => {
  beforeEach(() => {
    electron.__mock.reset();
    electron.BrowserWindow.mockImplementation(function (options) {
      return electron.__mock.createBrowserWindow(options);
    });
    jest.clearAllMocks();
  });

  function prepareSelectorFailure(context) {
    context.controller.start();
  }

  function prepareAuthFailure(context) {
    context.controller.start();
    context.parent.webContents._emitNewWindow(AUTH_URL);
  }

  function prepareNavigationFailure(context) {
    context.controller.start();
    context.parent.webContents._emitWillNavigate(GAME_URL);
  }

  function prepareGameFailure(context) {
    context.controller.start();
    context.parent.webContents._emitWillNavigate(GAME_URL);
    context.parent.webContents._setURL(GAME_URL);
    context.parent.webContents.emit('did-start-navigation', {}, GAME_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
  }

  const failureCases = [
    {
      label: '未认证 AUTH UI',
      prepare: prepareAuthFailure,
      loadingStage: STAGES.AUTHENTICATING,
      failedStage: STAGES.AUTH_FAILED,
      actions: [RECOVERY_ACTIONS.REOPEN_AUTH, RECOVERY_ACTIONS.RETURN_TO_SELECTOR],
      assertAutomatic: function () {
        const authWindow = electron.__mock.createdWindows[1];
        expect(authWindow.webContents.reload).toHaveBeenCalledTimes(1);
      }
    },
    {
      label: '已认证 SELECTOR',
      prepare: prepareSelectorFailure,
      loadingStage: STAGES.SELECTOR_LOADING,
      failedStage: STAGES.SELECTOR_FAILED,
      actions: [RECOVERY_ACTIONS.RELOAD_SELECTOR],
      assertAutomatic: function (context) {
        expect(context.parent.webContents.reload).toHaveBeenCalledTimes(1);
      }
    },
    {
      label: 'GAME_MAIN 导航',
      prepare: prepareNavigationFailure,
      loadingStage: STAGES.GAME_NAVIGATING,
      failedStage: STAGES.NAVIGATION_FAILED,
      actions: [RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION, RECOVERY_ACTIONS.RETURN_TO_SELECTOR],
      assertAutomatic: function (context) {
        expect(context.parent.loadURL).toHaveBeenLastCalledWith(GAME_URL);
      }
    },
    {
      label: '游戏/SWF 加载',
      prepare: prepareGameFailure,
      loadingStage: STAGES.GAME_LOADING,
      failedStage: STAGES.GAME_FAILED,
      actions: [RECOVERY_ACTIONS.RELOAD_GAME, RECOVERY_ACTIONS.RETURN_TO_SELECTOR],
      assertAutomatic: function (context) {
        expect(context.parent.webContents.reload).toHaveBeenCalledTimes(1);
      }
    }
  ];

  test.each(failureCases)(
    '$label 第一次自动恢复、第二次进入 waiting_user 且不清 Session',
    failureCase => {
      const context = createController();
      failureCase.prepare(context);
      expect(context.controller.getSnapshot().stage).toBe(failureCase.loadingStage);

      context.controller.handleLoadFailure({ errorCode: -105 });
      expect(context.controller.getSnapshot().stage).toBe(failureCase.loadingStage);
      failureCase.assertAutomatic(context);

      context.controller.handleLoadFailure({ errorCode: -105 });
      expect(context.controller.getSnapshot()).toEqual(
        expect.objectContaining({
          stage: failureCase.failedStage,
          status: STATUSES.WAITING_USER,
          error: expect.objectContaining({
            stage: failureCase.failedStage,
            code: -105
          }),
          availableActions: expect.arrayContaining(failureCase.actions)
        })
      );
      expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
    }
  );

  test.each([
    [
      'RELOAD_SELECTOR',
      prepareSelectorFailure,
      RECOVERY_ACTIONS.RELOAD_SELECTOR,
      STAGES.SELECTOR_LOADING
    ],
    ['REOPEN_AUTH', prepareAuthFailure, RECOVERY_ACTIONS.REOPEN_AUTH, STAGES.AUTHENTICATING],
    [
      'RETRY_GAME_NAVIGATION',
      prepareNavigationFailure,
      RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION,
      STAGES.GAME_NAVIGATING
    ],
    ['RELOAD_GAME', prepareGameFailure, RECOVERY_ACTIONS.RELOAD_GAME, STAGES.GAME_LOADING]
  ])('%s 用户恢复动作只执行一次并回到对应 loading stage', (_label, prepare, action, stage) => {
    const context = createController();
    prepare(context);
    context.controller.handleLoadFailure({ errorCode: -105 });
    context.controller.handleLoadFailure({ errorCode: -105 });

    expect(
      context.controller.requestRecovery(action, {
        profileId: 'profile-a',
        source: 'user'
      })
    ).toBe(true);
    expect(context.controller.getSnapshot().stage).toBe(stage);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test.each([
    ['RELOAD_SELECTOR', prepareSelectorFailure, RECOVERY_ACTIONS.RELOAD_SELECTOR],
    ['REOPEN_AUTH', prepareAuthFailure, RECOVERY_ACTIONS.REOPEN_AUTH],
    ['RETRY_GAME_NAVIGATION', prepareNavigationFailure, RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION],
    ['RELOAD_GAME', prepareGameFailure, RECOVERY_ACTIONS.RELOAD_GAME],
    [
      'RETURN_TO_SELECTOR',
      function (context) {
        prepareNavigationFailure(context);
        context.controller.handleLoadFailure({ errorCode: -105 });
        context.controller.handleLoadFailure({ errorCode: -105 });
      },
      RECOVERY_ACTIONS.RETURN_TO_SELECTOR
    ]
  ])('%s 对跨 Profile 与非法 renderer 来源均拒绝', (_label, prepare, action) => {
    const context = createController();
    prepare(context);

    expect(
      context.controller.requestRecovery(action, {
        profileId: 'profile-b',
        source: 'user'
      })
    ).toBe(false);
    expect(
      context.controller.requestRecovery(action, {
        profileId: 'profile-a',
        source: 'renderer-url'
      })
    ).toBe(false);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('RETURN_TO_SELECTOR 自动来源上限为 0，official 来源只执行确定性回退', () => {
    const automatic = createController();
    prepareNavigationFailure(automatic);
    automatic.controller.handleLoadFailure({ errorCode: -105 });
    automatic.controller.handleLoadFailure({ errorCode: -105 });

    expect(
      automatic.controller.requestRecovery(RECOVERY_ACTIONS.RETURN_TO_SELECTOR, {
        profileId: 'profile-a',
        source: 'automatic'
      })
    ).toBe(false);

    const official = createController();
    prepareNavigationFailure(official);
    official.controller.handleLoadFailure({ errorCode: -105 });
    official.controller.handleLoadFailure({ errorCode: -105 });

    expect(
      official.controller.requestRecovery(RECOVERY_ACTIONS.RETURN_TO_SELECTOR, {
        profileId: 'profile-a',
        source: 'official'
      })
    ).toBe(true);
    expect(official.parent.loadURL).toHaveBeenLastCalledWith(SELECTOR_URL);
    expect(official.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test.each(['crash', 'stall'])('%s 来源只允许游戏阶段 RELOAD_GAME', source => {
    const game = createController();
    prepareGameFailure(game);

    expect(
      game.controller.requestRecovery(RECOVERY_ACTIONS.RELOAD_GAME, {
        profileId: 'profile-a',
        source: source
      })
    ).toBe(true);

    const selector = createController();
    prepareSelectorFailure(selector);
    expect(
      selector.controller.requestRecovery(RECOVERY_ACTIONS.RELOAD_SELECTOR, {
        profileId: 'profile-a',
        source: source
      })
    ).toBe(false);
  });

  test('RETURN_TO_SELECTOR 销毁内存游戏 URL，非法来源和跨 Profile 动作均拒绝', () => {
    const context = createController();
    prepareNavigationFailure(context);
    context.controller.handleLoadFailure({ errorCode: -105 });
    context.controller.handleLoadFailure({ errorCode: -105 });

    expect(
      context.controller.requestRecovery(RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION, {
        profileId: 'profile-b',
        source: 'user'
      })
    ).toBe(false);
    expect(
      context.controller.requestRecovery(RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION, {
        profileId: 'profile-a',
        source: 'renderer-url'
      })
    ).toBe(false);
    expect(
      context.controller.requestRecovery(RECOVERY_ACTIONS.RETURN_TO_SELECTOR, {
        profileId: 'profile-a',
        source: 'user'
      })
    ).toBe(true);
    expect(context.parent.loadURL).toHaveBeenLastCalledWith(SELECTOR_URL);
    expect(context.controller._gameNavigationUrl).toBeNull();
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('UNKNOWN/非核心外链在 waiting_user 终态只允许 RETURN_TO_SELECTOR', () => {
    const context = createController();
    context.controller.start();
    context.parent.webContents._emitNewWindow('https://unknown.fixture.test/help');

    expect(context.controller.getSnapshot()).toEqual(
      expect.objectContaining({
        stage: STAGES.BLOCKED_NAVIGATION,
        status: STATUSES.WAITING_USER,
        availableActions: [RECOVERY_ACTIONS.RETURN_TO_SELECTOR]
      })
    );
    expect(
      context.controller.requestRecovery(RECOVERY_ACTIONS.RELOAD_GAME, {
        profileId: 'profile-a',
        source: 'user'
      })
    ).toBe(false);
  });
});

describe('T052 游戏阶段 StallDetector 接线', () => {
  beforeEach(() => {
    electron.__mock.reset();
    electron.BrowserWindow.mockImplementation(function (options) {
      return electron.__mock.createBrowserWindow(options);
    });
    jest.clearAllMocks();
  });

  test('selector/auth 不启用，进入 GAME_LOADING 后启用并由 stall 动作安全 reload', () => {
    const detector = { detach: jest.fn() };
    const stallDetectorFactory = jest.fn(() => detector);
    const context = createController({ stallDetectorFactory });

    context.controller.start();
    context.parent.webContents._emitNewWindow(AUTH_URL);
    expect(stallDetectorFactory).not.toHaveBeenCalled();

    const authWindow = electron.__mock.createdWindows[1];
    authWindow.webContents._emitWillNavigate(SELECTOR_URL);
    context.parent.webContents._emitWillNavigate(GAME_URL);
    context.parent.webContents._setURL(GAME_URL);
    context.parent.webContents.emit('did-start-navigation', {}, GAME_URL, false, true);
    context.parent.webContents.emit('did-finish-load');

    expect(stallDetectorFactory).toHaveBeenCalledWith(
      context.parent,
      context.parent.webContents.session,
      expect.objectContaining({
        profileName: 'profile-a',
        stage: STAGES.GAME_LOADING,
        onStall: expect.any(Function),
        onExhausted: expect.any(Function)
      })
    );

    const stallContext = stallDetectorFactory.mock.calls[0][2];
    stallContext.onStall({ retryCount: 1, retryLimit: 3, exhausted: false });

    expect(context.parent.webContents.reload).toHaveBeenCalledTimes(1);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('stall 上限进入 GAME_FAILED/waiting_user 并停止检测器', () => {
    const detector = { detach: jest.fn() };
    const stallDetectorFactory = jest.fn(() => detector);
    const context = createController({ stallDetectorFactory });

    context.controller.start();
    context.parent.webContents._emitWillNavigate(GAME_URL);
    context.parent.webContents._setURL(GAME_URL);
    context.parent.webContents.emit('did-start-navigation', {}, GAME_URL, false, true);
    context.parent.webContents.emit('did-finish-load');

    stallDetectorFactory.mock.calls[0][2].onExhausted({
      errorCode: 'STALL_RETRY_LIMIT',
      retryCount: 3,
      retryLimit: 3,
      exhausted: true
    });

    expect(context.controller.getSnapshot()).toEqual(
      expect.objectContaining({
        stage: STAGES.GAME_FAILED,
        status: STATUSES.WAITING_USER,
        error: expect.objectContaining({ code: 'STALL_RETRY_LIMIT' }),
        availableActions: expect.arrayContaining([
          RECOVERY_ACTIONS.RELOAD_GAME,
          RECOVERY_ACTIONS.RETURN_TO_SELECTOR
        ])
      })
    );
    expect(detector.detach).toHaveBeenCalledTimes(1);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });
});

describe('页面探针安全接口与有界预算', () => {
  beforeEach(() => {
    electron.__mock.reset();
    electron.BrowserWindow.mockImplementation(function (options) {
      return electron.__mock.createBrowserWindow(options);
    });
    jest.clearAllMocks();
  });

  test('生产 selector registry 只包含 Windows 验证的登录 UI selector 且不可变', () => {
    expect(PROBE_SELECTOR_REGISTRY).toEqual({
      loginUiVisible: '.qConnectLogin iframe.loginframe'
    });
    expect(Object.isFrozen(PROBE_SELECTOR_REGISTRY)).toBe(true);
  });

  test('登录 UI 探针有界等待顶层 iframe 出现且只返回安全 boolean/enum', async () => {
    const parent = new electron.BrowserWindow({
      webPreferences: { partition: 'persist:profile-a' }
    });
    parent.webContents.executeJavaScript.mockResolvedValue(true);
    const probe = createPageProbe({ webContents: parent.webContents });

    const result = await probe.run({
      role: urlConfig.URL_ROLES.SELECTOR,
      stage: STAGES.SELECTOR_LOADING
    });

    expect(result).toEqual({
      loginUiVisible: true,
      selectorReady: 'unknown',
      flashContainerVisible: false
    });
    expect(parent.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    const scripts = parent.webContents.executeJavaScript.mock.calls.map(call => call[0]);
    expect(scripts[0]).toContain('document.querySelector(".qConnectLogin iframe.loginframe")');
    expect(scripts[0]).not.toContain('#ptlogin_iframe');
    expect(scripts[0]).toContain('getClientRects().length > 0');
    expect(scripts[0]).toContain("style.display !== 'none'");
    expect(scripts[0]).toContain("style.visibility !== 'hidden'");
    expect(scripts[0]).toContain('new MutationObserver');
    expect(scripts[0]).toContain('observer.observe(document.body');
    expect(scripts[0]).toContain('childList: true');
    expect(scripts[0]).toContain('subtree: true');
    expect(scripts[0]).toContain('attributes: true');
    expect(scripts[0]).toContain("attributeFilter: ['style', 'class', 'hidden']");
    expect(scripts[0]).toContain('function finish(value)');
    expect(scripts[0]).toContain('observer.disconnect()');
    expect(scripts[0]).toContain('clearTimeout(timer)');
    expect(scripts[0]).toContain('setTimeout');
    expect(scripts[0]).toContain('2500');
    expect(scripts[0]).not.toContain('setInterval');
    expect(scripts[0]).not.toMatch(
      /qr_area|contentDocument|contentWindow|\.src\b|getAttribute|frameElement/i
    );
    expect(scripts.join(' ')).not.toMatch(
      /documentElement|outerHTML|innerHTML|textContent|\.value|cookie|localStorage|sessionStorage|openid|ticket|uin/i
    );
    expect(probe.getPageSource).toBeUndefined();
    expect(probe.readFormValues).toBeUndefined();
  });

  test('controller 默认生产探针接收完整 context 并识别顶层登录 iframe', async () => {
    const context = createController({ probe: undefined });
    context.parent.webContents.executeJavaScript.mockResolvedValue(true);
    context.controller.start();
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');

    await flushAsyncWork();

    expect(context.parent.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(context.parent.webContents.executeJavaScript.mock.calls[0][0]).toContain(
      'document.querySelector(".qConnectLogin iframe.loginframe")'
    );
    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);
  });

  test('ProbeBudget 每 stage 最多 3 次、全流程最多 12 次且新窗口实例重置', async () => {
    const budget = new ProbeBudget({ timeoutMs: 3000, perStageLimit: 3, totalLimit: 12 });
    const task = jest.fn(() => Promise.resolve(true));

    for (let i = 0; i < 4; i++) await budget.run('SELECTOR_READY', task);
    for (const stage of ['AUTHENTICATING', 'GAME_LOADING', 'GAME_READY']) {
      for (let i = 0; i < 3; i++) await budget.run(stage, task);
    }
    await budget.run('SESSION_REJECTED', task);

    expect(task).toHaveBeenCalledTimes(12);
    expect(budget.getSnapshot()).toEqual({
      total: 12,
      byStage: {
        SELECTOR_READY: 3,
        AUTHENTICATING: 3,
        GAME_LOADING: 3,
        GAME_READY: 3
      }
    });

    const restarted = new ProbeBudget({ timeoutMs: 3000, perStageLimit: 3, totalLimit: 12 });
    expect(restarted.getSnapshot()).toEqual({ total: 0, byStage: {} });
  });

  test('ProbeBudget 单次 3 秒超时且不创建无限 interval', async () => {
    jest.useFakeTimers();
    const intervalSpy = jest.spyOn(global, 'setInterval');
    const budget = new ProbeBudget({ timeoutMs: 3000, perStageLimit: 3, totalLimit: 12 });
    const pending = budget.run('SELECTOR_READY', () => new Promise(() => {}));

    jest.advanceTimersByTime(3000);

    await expect(pending).rejects.toThrow(/timeout/i);
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
    jest.useRealTimers();
  });

  test('探针仅在可信 did-finish-load 后调用且同一顶层加载最多一次', async () => {
    const probe = jest.fn(() => Promise.resolve({ selectorReady: 'unknown' }));
    const context = createController({ probe });
    context.controller.start();

    context.parent.webContents._setURL('https://unknown.fixture.test/help');
    context.parent.webContents.emit('did-finish-load');
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
    context.parent.webContents.emit('did-finish-load');
    await Promise.resolve();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        role: urlConfig.URL_ROLES.SELECTOR,
        stage: STAGES.SELECTOR_LOADING
      })
    );
  });

  test('SELECTOR 登录 UI 存在时进入 AUTHENTICATING，且两次加载失败有界进入 AUTH_FAILED', async () => {
    const probe = jest.fn(() => Promise.resolve({ loginUiVisible: true }));
    const context = createController({ probe });
    context.controller.start();
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');

    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_LOADING);
    await flushAsyncWork();
    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);

    context.parent.webContents._emitWillNavigate(SELECTOR_URL);
    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);

    expect(context.controller.handleLoadFailure({ errorCode: -105 })).toBe(true);
    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);
    expect(context.controller.handleLoadFailure({ errorCode: -105 })).toBe(false);
    expect(context.controller.getSnapshot()).toEqual(
      expect.objectContaining({
        stage: STAGES.AUTH_FAILED,
        status: STATUSES.WAITING_USER,
        availableActions: expect.arrayContaining([
          RECOVERY_ACTIONS.REOPEN_AUTH,
          RECOVERY_ACTIONS.RETURN_TO_SELECTOR
        ])
      })
    );
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('SELECTOR 登录 UI 不存在时进入 SELECTOR_READY', async () => {
    const probe = jest.fn(() => Promise.resolve({ loginUiVisible: false }));
    const context = createController({ probe });
    context.controller.start();
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');

    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_LOADING);
    await flushAsyncWork();

    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_READY);
  });

  test('SELECTOR_READY 后重新出现登录 UI 时纠正为 AUTHENTICATING', async () => {
    const probe = jest
      .fn()
      .mockResolvedValueOnce({ loginUiVisible: false })
      .mockResolvedValueOnce({ loginUiVisible: true });
    const context = createController({ probe });
    context.controller.start();
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
    await flushAsyncWork();
    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_READY);

    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
    await flushAsyncWork();

    expect(context.controller.getSnapshot().stage).toBe(STAGES.AUTHENTICATING);
  });

  test('探针失败保持当前安全状态且绝不清 Session', async () => {
    const probe = jest.fn(() => Promise.reject(new Error('fixture probe failed')));
    const context = createController({ probe });
    context.controller.start();
    context.parent.webContents._setURL(SELECTOR_URL);
    context.parent.webContents.emit('did-start-navigation', {}, SELECTOR_URL, false, true);
    context.parent.webContents.emit('did-finish-load');
    await flushAsyncWork();

    expect(context.controller.getSnapshot().stage).toBe(STAGES.SELECTOR_LOADING);
    expect(context.parent.webContents.session.clearStorageData).not.toHaveBeenCalled();
  });
});
