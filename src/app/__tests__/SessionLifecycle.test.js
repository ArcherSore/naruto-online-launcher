'use strict';

const fs = require('fs');

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../ui/manager/ManagerWindow', () => ({
  send: jest.fn()
}));

jest.mock('../../profiles/manager', () => ({ reportCrash: jest.fn() }));
jest.mock('../../memory/guard', () => ({ reportCrash: jest.fn() }));

const SessionLifecycle = require('../SessionLifecycle');
const ManagerWindow = require('../../ui/manager/ManagerWindow');

function createTarget() {
  const handlers = {};
  return {
    handlers: handlers,
    on: jest.fn(function (event, handler) {
      handlers[event] = handler;
    }),
    removeListener: jest.fn(function (event, handler) {
      if (handlers[event] === handler) delete handlers[event];
    })
  };
}

function makeWindow() {
  const windowTarget = createTarget();
  const contentsTarget = createTarget();
  const session = {
    clearStorageData: jest.fn(),
    cookies: { flushStore: jest.fn(() => Promise.resolve()) }
  };
  const webContents = Object.assign(contentsTarget, {
    session: session,
    isDestroyed: jest.fn(() => false),
    reload: jest.fn()
  });
  const win = Object.assign(windowTarget, {
    webContents: webContents,
    isDestroyed: jest.fn(() => false),
    show: jest.fn(),
    destroy: jest.fn()
  });
  return { win: win, windowHandlers: windowTarget.handlers, wcHandlers: contentsTarget.handlers, session };
}

function makeContext(overrides) {
  return Object.assign(
    {
      profileId: 'p_001',
      profile: { id: 'p_001', name: 'Tencent Profile' },
      entry: { failLoadTimer: null, closeTimer: null },
      onOpened: jest.fn(),
      onReady: jest.fn(),
      onClosed: jest.fn(),
      onLoadFinished: jest.fn(),
      onLoadFailed: jest.fn(),
      onRendererGone: jest.fn(),
      onUnresponsive: jest.fn(),
      onResponsive: jest.fn()
    },
    overrides
  );
}

describe('SessionLifecycle 通用窗口生命周期', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('只注册通用 load/close/crash 事件，不接管导航或 popup', () => {
    const context = makeWindow();

    SessionLifecycle.attach(context.win, makeContext({ ses: context.session }));

    expect(Object.keys(context.wcHandlers).sort()).toEqual(
      ['did-fail-load', 'did-finish-load', 'render-process-gone'].sort()
    );
    expect(Object.keys(context.windowHandlers).sort()).toEqual(
      ['close', 'closed', 'ready-to-show', 'responsive', 'unresponsive'].sort()
    );
    expect(context.wcHandlers['will-navigate']).toBeUndefined();
    expect(context.wcHandlers['new-window']).toBeUndefined();
  });

  test('did-finish-load 只刷新 Session 存储并通知调用者，不执行页面注入', async () => {
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    context.win.webContents.executeJavaScript = jest.fn();
    SessionLifecycle.attach(context.win, ctx);

    context.wcHandlers['did-finish-load']();
    await Promise.resolve();

    expect(context.session.cookies.flushStore).toHaveBeenCalledTimes(1);
    expect(ctx.onLoadFinished).toHaveBeenCalledTimes(1);
    expect(context.win.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('did-fail-load 只向流程回传 errorCode，不传完整 URL 或描述', () => {
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    context.wcHandlers['did-fail-load'](
      {},
      -105,
      'fixture description with ticket',
      'https://unknown.test/path?ticket=fixture',
      true
    );

    expect(ctx.onLoadFailed).toHaveBeenCalledWith({ errorCode: -105 });
    expect(JSON.stringify(ctx.onLoadFailed.mock.calls)).not.toMatch(/ticket|unknown\.test/);
    expect(context.win.webContents.reload).not.toHaveBeenCalled();
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('ready-to-show 显示窗口并广播打开状态', () => {
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    context.windowHandlers['ready-to-show']();

    expect(context.win.show).toHaveBeenCalledTimes(1);
    expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
      profileId: 'p_001',
      open: true
    });
    expect(ctx.onOpened).toHaveBeenCalledTimes(1);
    expect(ctx.onReady).toHaveBeenCalledTimes(1);
  });

  test('ready-to-show 重复触发时只启动一次窗口流程', () => {
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    context.windowHandlers['ready-to-show']();
    context.windowHandlers['ready-to-show']();

    expect(context.win.show).toHaveBeenCalledTimes(1);
    expect(ManagerWindow.send).toHaveBeenCalledTimes(1);
    expect(ctx.onOpened).toHaveBeenCalledTimes(1);
    expect(ctx.onReady).toHaveBeenCalledTimes(1);
  });

  test('renderer crash 只委托当前角色流程，不 raw reload 未知 URL 且不清 Session', () => {
    jest.useFakeTimers();
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    context.wcHandlers['render-process-gone']({}, { reason: 'crashed', exitCode: 1 });
    jest.advanceTimersByTime(1500);

    expect(ctx.onRendererGone).toHaveBeenCalledTimes(1);
    expect(context.win.webContents.reload).not.toHaveBeenCalled();
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('renderer crash 在 10 分钟内第 4 次委托为 exhausted，供当前角色转等待用户', () => {
    jest.useFakeTimers();
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    for (let i = 0; i < 4; i++) {
      context.wcHandlers['render-process-gone']({}, { reason: 'crashed', exitCode: i + 1 });
      jest.advanceTimersByTime(1500);
    }

    expect(ctx.onRendererGone.mock.calls).toEqual([
      [
        {
          reason: 'crashed',
          errorCode: 1,
          retryCount: 1,
          retryLimit: 3,
          retryWindowMs: 10 * 60 * 1000,
          exhausted: false
        }
      ],
      [
        {
          reason: 'crashed',
          errorCode: 2,
          retryCount: 2,
          retryLimit: 3,
          retryWindowMs: 10 * 60 * 1000,
          exhausted: false
        }
      ],
      [
        {
          reason: 'crashed',
          errorCode: 3,
          retryCount: 3,
          retryLimit: 3,
          retryWindowMs: 10 * 60 * 1000,
          exhausted: false
        }
      ],
      [
        {
          reason: 'crashed',
          errorCode: 4,
          retryCount: 3,
          retryLimit: 3,
          retryWindowMs: 10 * 60 * 1000,
          exhausted: true
        }
      ]
    ]);
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test.each(['clean-exit', 'killed'])('%s 只委托状态且不触发自动 reload', reason => {
    jest.useFakeTimers();
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    context.wcHandlers['render-process-gone']({}, { reason: reason, exitCode: 0 });
    jest.advanceTimersByTime(1500);

    expect(ctx.onRendererGone).toHaveBeenCalledWith({
      reason: reason,
      errorCode: 0,
      retryCount: 0,
      retryLimit: 3,
      retryWindowMs: 10 * 60 * 1000,
      exhausted: false
    });
    expect(context.win.webContents.reload).not.toHaveBeenCalled();
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('unresponsive/responsive 只委托当前角色流程且不 reload、不清 Session', () => {
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);

    context.windowHandlers.unresponsive();
    context.windowHandlers.responsive();

    expect(ctx.onUnresponsive).toHaveBeenCalledWith({});
    expect(ctx.onResponsive).toHaveBeenCalledWith({});
    expect(context.win.webContents.reload).not.toHaveBeenCalled();
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
  });

  test('close 只 flush 当前 Session 后销毁窗口，closed 广播并回调', async () => {
    const context = makeWindow();
    const ctx = makeContext({ ses: context.session });
    SessionLifecycle.attach(context.win, ctx);
    const event = { preventDefault: jest.fn() };

    context.windowHandlers.close(event);
    await Promise.resolve();
    await Promise.resolve();
    context.windowHandlers.closed();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(context.session.cookies.flushStore).toHaveBeenCalledTimes(1);
    expect(context.session.clearStorageData).not.toHaveBeenCalled();
    expect(context.win.destroy).toHaveBeenCalledTimes(1);
    expect(ManagerWindow.send).toHaveBeenCalledWith('game-window:status', {
      profileId: 'p_001',
      open: false
    });
    expect(ctx.onClosed).toHaveBeenCalledTimes(1);
  });

  test('detach 移除已注册监听并清理通用 timer', () => {
    const context = makeWindow();
    const entry = { failLoadTimer: setTimeout(function () {}, 1000), closeTimer: null };
    const lifecycle = SessionLifecycle.attach(
      context.win,
      makeContext({ ses: context.session, entry: entry })
    );

    lifecycle.detach();

    expect(context.win.removeListener).toHaveBeenCalled();
    expect(context.win.webContents.removeListener).toHaveBeenCalled();
    expect(entry.failLoadTimer).toBeNull();
  });

  test('生产源码不再包含 Oasis 登录、页面注入或清 Session 路径', () => {
    const source = fs.readFileSync(require.resolve('../SessionLifecycle'), 'utf8');

    expect(source).not.toMatch(
      /profiles\/vault|api-login|logintype|oas-player|window\.FB|MutationObserver|buildAutoLoginScript|clearStorageData|will-navigate|new-window/
    );
    expect(SessionLifecycle.reloadWithPreAuth).toBeUndefined();
    expect(SessionLifecycle._loadGameWithPreAuth).toBeUndefined();
  });
});
