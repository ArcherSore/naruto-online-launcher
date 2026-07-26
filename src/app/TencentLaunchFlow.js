/**
 * 腾讯启动流程的纯内存状态骨架。
 *
 * 本阶段只定义状态、不变量、有限计数与恢复动作校验；窗口、导航和页面
 * 探针接线由后续用户故事任务实现。该对象从不读取或清理 Electron Session。
 */

'use strict';

const { BrowserWindow } = require('electron');
const urlConfig = require('../config/urls');
const logger = require('../utils/logger');
const StallDetector = require('./StallDetector');

const STAGES = Object.freeze({
  BOOTSTRAPPING: 'BOOTSTRAPPING',
  SELECTOR_LOADING: 'SELECTOR_LOADING',
  SELECTOR_READY: 'SELECTOR_READY',
  AUTHENTICATING: 'AUTHENTICATING',
  GAME_NAVIGATING: 'GAME_NAVIGATING',
  GAME_LOADING: 'GAME_LOADING',
  GAME_READY: 'GAME_READY',
  SELECTOR_FAILED: 'SELECTOR_FAILED',
  AUTH_FAILED: 'AUTH_FAILED',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  GAME_FAILED: 'GAME_FAILED',
  SESSION_REJECTED: 'SESSION_REJECTED',
  BLOCKED_NAVIGATION: 'BLOCKED_NAVIGATION',
  CLOSED: 'CLOSED'
});

const STATUSES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  FAILED: 'failed',
  WAITING_USER: 'waiting_user'
});

const ATTEMPT_LIMITS = Object.freeze({
  selector: 1,
  auth: 1,
  navigation: 1,
  game: 1,
  crash: 3
});

const RECOVERY_ACTIONS = Object.freeze({
  RELOAD_SELECTOR: 'RELOAD_SELECTOR',
  REOPEN_AUTH: 'REOPEN_AUTH',
  RETRY_GAME_NAVIGATION: 'RETRY_GAME_NAVIGATION',
  RELOAD_GAME: 'RELOAD_GAME',
  RETURN_TO_SELECTOR: 'RETURN_TO_SELECTOR'
});

const TRANSITIONS = Object.freeze({
  BOOTSTRAPPING: [STAGES.SELECTOR_LOADING, STAGES.CLOSED],
  SELECTOR_LOADING: [
    STAGES.SELECTOR_READY,
    STAGES.AUTHENTICATING,
    STAGES.GAME_NAVIGATING,
    STAGES.SELECTOR_FAILED,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  SELECTOR_READY: [
    STAGES.SELECTOR_LOADING,
    STAGES.AUTHENTICATING,
    STAGES.GAME_NAVIGATING,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  AUTHENTICATING: [
    STAGES.SELECTOR_LOADING,
    STAGES.SELECTOR_READY,
    STAGES.GAME_NAVIGATING,
    STAGES.AUTH_FAILED,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  GAME_NAVIGATING: [
    STAGES.GAME_LOADING,
    STAGES.NAVIGATION_FAILED,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  GAME_LOADING: [
    STAGES.GAME_READY,
    STAGES.GAME_FAILED,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  GAME_READY: [
    STAGES.GAME_LOADING,
    STAGES.GAME_FAILED,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  SELECTOR_FAILED: [STAGES.SELECTOR_LOADING, STAGES.BLOCKED_NAVIGATION, STAGES.CLOSED],
  AUTH_FAILED: [
    STAGES.AUTHENTICATING,
    STAGES.SELECTOR_LOADING,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  NAVIGATION_FAILED: [
    STAGES.GAME_NAVIGATING,
    STAGES.SELECTOR_LOADING,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  GAME_FAILED: [
    STAGES.GAME_LOADING,
    STAGES.SELECTOR_LOADING,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  SESSION_REJECTED: [
    STAGES.AUTHENTICATING,
    STAGES.SELECTOR_LOADING,
    STAGES.BLOCKED_NAVIGATION,
    STAGES.CLOSED
  ],
  BLOCKED_NAVIGATION: [STAGES.SELECTOR_LOADING, STAGES.CLOSED],
  CLOSED: []
});

const STATUS_BY_STAGE = Object.freeze({
  BOOTSTRAPPING: STATUSES.IDLE,
  SELECTOR_LOADING: STATUSES.LOADING,
  SELECTOR_READY: STATUSES.READY,
  AUTHENTICATING: STATUSES.LOADING,
  GAME_NAVIGATING: STATUSES.LOADING,
  GAME_LOADING: STATUSES.LOADING,
  GAME_READY: STATUSES.READY,
  SELECTOR_FAILED: STATUSES.WAITING_USER,
  AUTH_FAILED: STATUSES.WAITING_USER,
  NAVIGATION_FAILED: STATUSES.WAITING_USER,
  GAME_FAILED: STATUSES.WAITING_USER,
  SESSION_REJECTED: STATUSES.WAITING_USER,
  BLOCKED_NAVIGATION: STATUSES.WAITING_USER,
  CLOSED: STATUSES.IDLE
});

const ACTION_STAGES = Object.freeze({
  RELOAD_SELECTOR: [STAGES.SELECTOR_LOADING, STAGES.SELECTOR_FAILED],
  REOPEN_AUTH: [STAGES.AUTHENTICATING, STAGES.AUTH_FAILED, STAGES.SESSION_REJECTED],
  RETRY_GAME_NAVIGATION: [STAGES.GAME_NAVIGATING, STAGES.NAVIGATION_FAILED],
  RELOAD_GAME: [STAGES.GAME_LOADING, STAGES.GAME_READY, STAGES.GAME_FAILED],
  RETURN_TO_SELECTOR: [
    STAGES.AUTH_FAILED,
    STAGES.NAVIGATION_FAILED,
    STAGES.GAME_FAILED,
    STAGES.SESSION_REJECTED,
    STAGES.BLOCKED_NAVIGATION
  ]
});

const ACTION_SOURCES = Object.freeze({
  RELOAD_SELECTOR: ['user', 'automatic'],
  REOPEN_AUTH: ['user', 'automatic'],
  RETRY_GAME_NAVIGATION: ['user', 'automatic'],
  RELOAD_GAME: ['user', 'automatic', 'crash', 'stall'],
  RETURN_TO_SELECTOR: ['user', 'official']
});

const FAILURE_BY_STAGE = Object.freeze({
  SELECTOR_LOADING: Object.freeze({
    attempt: 'selector',
    failedStage: STAGES.SELECTOR_FAILED,
    action: RECOVERY_ACTIONS.RELOAD_SELECTOR,
    safeMessage: '腾讯选服页加载失败'
  }),
  AUTHENTICATING: Object.freeze({
    attempt: 'auth',
    failedStage: STAGES.AUTH_FAILED,
    action: RECOVERY_ACTIONS.REOPEN_AUTH,
    safeMessage: '腾讯登录界面加载失败'
  }),
  GAME_NAVIGATING: Object.freeze({
    attempt: 'navigation',
    failedStage: STAGES.NAVIGATION_FAILED,
    action: RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION,
    safeMessage: '进入游戏跳转失败'
  }),
  GAME_LOADING: Object.freeze({
    attempt: 'game',
    failedStage: STAGES.GAME_FAILED,
    action: RECOVERY_ACTIONS.RELOAD_GAME,
    safeMessage: '游戏内容加载失败'
  }),
  GAME_READY: Object.freeze({
    attempt: 'game',
    failedStage: STAGES.GAME_FAILED,
    action: RECOVERY_ACTIONS.RELOAD_GAME,
    safeMessage: '游戏运行状态异常'
  })
});

const GAME_SESSION_STAGES = Object.freeze([
  STAGES.GAME_NAVIGATING,
  STAGES.GAME_LOADING,
  STAGES.GAME_READY
]);

function createAttempts() {
  return {
    selector: 0,
    auth: 0,
    navigation: 0,
    game: 0,
    crash: 0
  };
}

function cloneLocation(location) {
  if (!location || typeof location !== 'object') return null;
  return {
    role: typeof location.role === 'string' ? location.role : 'UNKNOWN',
    origin: typeof location.origin === 'string' ? location.origin : null,
    pathname: typeof location.pathname === 'string' ? location.pathname : null
  };
}

class LaunchFlowState {
  constructor(options) {
    const opts = options || {};
    if (typeof opts.profileId !== 'string' || opts.profileId.length === 0) {
      throw new TypeError('profileId is required');
    }

    this.profileId = opts.profileId;
    this.stage = STAGES.BOOTSTRAPPING;
    this.status = STATUSES.IDLE;
    this.attempts = createAttempts();
    this.lastSafeLocation = null;
    this.error = null;
  }

  transitionTo(nextStage) {
    if (!Object.prototype.hasOwnProperty.call(STAGES, nextStage)) {
      throw new Error('Invalid transition target: ' + String(nextStage));
    }

    const allowed = TRANSITIONS[this.stage] || [];
    if (allowed.indexOf(nextStage) === -1) {
      throw new Error('Invalid transition: ' + this.stage + ' -> ' + nextStage);
    }

    this.stage = nextStage;
    this.status = STATUS_BY_STAGE[nextStage];
    if (this.status === STATUSES.LOADING || this.status === STATUSES.READY) {
      this.error = null;
    }
    if (nextStage === STAGES.CLOSED) {
      this.lastSafeLocation = null;
      this.error = null;
    }
    return this.getSnapshot();
  }

  consumeAttempt(kind) {
    if (!Object.prototype.hasOwnProperty.call(ATTEMPT_LIMITS, kind)) {
      throw new Error('Unknown attempt type: ' + String(kind));
    }
    if (this.attempts[kind] >= ATTEMPT_LIMITS[kind]) return false;
    this.attempts[kind] += 1;
    return true;
  }

  blockUnknown(location) {
    if (this.stage === STAGES.CLOSED) {
      throw new Error('Invalid transition: CLOSED -> BLOCKED_NAVIGATION');
    }
    this.lastSafeLocation = cloneLocation(location);
    this.stage = STAGES.BLOCKED_NAVIGATION;
    this.status = STATUSES.WAITING_USER;
    this.error = {
      stage: STAGES.BLOCKED_NAVIGATION,
      code: 'UNKNOWN_TOP_LEVEL_NAVIGATION',
      safeMessage: '未知顶层导航已阻止'
    };
    return this.getSnapshot();
  }

  markFailure(nextStage, errorCode, safeMessage) {
    this.transitionTo(nextStage);
    this.status = STATUSES.WAITING_USER;
    this.error = {
      stage: nextStage,
      code: typeof errorCode === 'number' || typeof errorCode === 'string' ? errorCode : null,
      safeMessage: typeof safeMessage === 'string' ? safeMessage : '加载失败'
    };
    return this.getSnapshot();
  }

  getAllowedRecoveryActions() {
    return Object.keys(ACTION_STAGES).filter(action => {
      return ACTION_STAGES[action].indexOf(this.stage) !== -1;
    });
  }

  isRecoveryAllowed(action, context) {
    const ctx = context || {};
    if (ctx.profileId !== this.profileId) return false;
    if (!Object.prototype.hasOwnProperty.call(RECOVERY_ACTIONS, action)) return false;
    const allowedSources = ACTION_SOURCES[action] || [];
    if (allowedSources.indexOf(ctx.source) === -1) return false;
    return this.getAllowedRecoveryActions().indexOf(action) !== -1;
  }

  getSnapshot() {
    return {
      profileId: this.profileId,
      stage: this.stage,
      status: this.status,
      attempts: Object.assign({}, this.attempts),
      lastSafeLocation: cloneLocation(this.lastSafeLocation),
      error: this.error ? Object.assign({}, this.error) : null,
      availableActions: this.getAllowedRecoveryActions()
    };
  }
}

const PROBE_SELECTOR_REGISTRY = Object.freeze({
  loginUiVisible: '.qConnectLogin iframe.loginframe'
});

const DEFAULT_PROBE_RESULT = Object.freeze({
  loginUiVisible: false,
  selectorReady: 'unknown',
  flashContainerVisible: false
});

/**
 * 创建最小页面探针。生产 registry 只包含 Windows DevTools 正反验证的
 * 顶层登录 iframe selector；脚本立即检查一次，并在尚未出现时有界观察
 * document.body 的节点/可见性变化。它只返回 iframe 是否存在且可见，不进入
 * 子 frame，不读取 src、节点内容、表单、Storage、Cookie 或页面源码。
 *
 * @param {{webContents:Object, selectorRegistry?:Object}} options
 * @returns {{run:function(Object): Promise<Object>}}
 */
function createPageProbe(options) {
  const opts = options || {};
  if (!opts.webContents) throw new TypeError('webContents is required');
  const registry = opts.selectorRegistry || PROBE_SELECTOR_REGISTRY;

  return Object.freeze({
    run: function (context) {
      const keys = Object.keys(registry);
      if (
        keys.length !== 1 ||
        keys[0] !== 'loginUiVisible' ||
        registry.loginUiVisible !== PROBE_SELECTOR_REGISTRY.loginUiVisible
      ) {
        return Promise.reject(new Error('Unapproved probe selector registry'));
      }
      if (!context || context.role !== urlConfig.URL_ROLES.SELECTOR) {
        return Promise.resolve(Object.assign({}, DEFAULT_PROBE_RESULT));
      }

      const script =
        '(function () {' +
        'function isLoginUiVisible() {' +
        'const element = document.querySelector(' +
        JSON.stringify(registry.loginUiVisible) +
        ');' +
        'if (!element) return false;' +
        'const style = getComputedStyle(element);' +
        "return element.getClientRects().length > 0 && style.display !== 'none' && " +
        "style.visibility !== 'hidden';" +
        '}' +
        'if (isLoginUiVisible()) return true;' +
        'if (!document.body) return false;' +
        'return new Promise(function (resolve) {' +
        'let settled = false;' +
        'let timer = null;' +
        'const observer = new MutationObserver(function () {' +
        'if (isLoginUiVisible()) finish(true);' +
        '});' +
        'function finish(value) {' +
        'if (settled) return;' +
        'settled = true;' +
        'observer.disconnect();' +
        'if (timer !== null) clearTimeout(timer);' +
        'resolve(value === true);' +
        '}' +
        'observer.observe(document.body, {' +
        'childList: true,' +
        'subtree: true,' +
        'attributes: true,' +
        "attributeFilter: ['style', 'class', 'hidden']" +
        '});' +
        'timer = setTimeout(function () {' +
        'finish(isLoginUiVisible());' +
        '}, 2500);' +
        'if (isLoginUiVisible()) finish(true);' +
        '});' +
        '})()';
      return Promise.resolve(opts.webContents.executeJavaScript(script)).then(function (exists) {
        return Object.assign({}, DEFAULT_PROBE_RESULT, {
          loginUiVisible: exists === true
        });
      });
    }
  });
}

class ProbeBudget {
  constructor(options) {
    const opts = options || {};
    this.timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 3000;
    this.perStageLimit = typeof opts.perStageLimit === 'number' ? opts.perStageLimit : 3;
    this.totalLimit = typeof opts.totalLimit === 'number' ? opts.totalLimit : 12;
    this.total = 0;
    this.byStage = Object.create(null);
  }

  run(stage, task) {
    if (typeof stage !== 'string' || typeof task !== 'function') {
      return Promise.reject(new TypeError('stage and task are required'));
    }

    const stageCount = this.byStage[stage] || 0;
    if (stageCount >= this.perStageLimit || this.total >= this.totalLimit) {
      return Promise.resolve({ skipped: true, reason: 'budget-exhausted' });
    }

    this.byStage[stage] = stageCount + 1;
    this.total += 1;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Page probe timeout'));
      }, this.timeoutMs);

      Promise.resolve()
        .then(task)
        .then(
          result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
          },
          error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        );
    });
  }

  getSnapshot() {
    return {
      total: this.total,
      byStage: Object.assign({}, this.byStage)
    };
  }
}

function safeLocation(toSafeLocation, value) {
  try {
    return toSafeLocation(value);
  } catch (_) {
    return { role: urlConfig.URL_ROLES.UNKNOWN, origin: null, pathname: null };
  }
}

class TencentLaunchFlowController {
  constructor(options) {
    const opts = options || {};
    if (!opts.window || !opts.window.webContents) throw new TypeError('window is required');
    if (typeof opts.partitionName !== 'string' || opts.partitionName.length === 0) {
      throw new TypeError('partitionName is required');
    }

    this.window = opts.window;
    this.webContents = opts.window.webContents;
    this.session = opts.session || this.webContents.session;
    this.partitionName = opts.partitionName;
    this.selectorUrl = opts.selectorUrl || urlConfig.getSelectorUrl();
    this.classifyUrl = opts.classifyUrl || urlConfig.classifyUrl;
    this.toSafeLocation = opts.toSafeLocation || urlConfig.toSafeLocation;
    this.state = new LaunchFlowState({ profileId: opts.profileId, session: this.session });
    this.probe = opts.probe || createPageProbe({ webContents: this.webContents }).run;
    this.probeBudget = new ProbeBudget({
      timeoutMs: 3000,
      perStageLimit: 3,
      totalLimit: 12
    });
    this.onStateChange =
      typeof opts.onStateChange === 'function' ? opts.onStateChange : function () {};
    this.auditor = opts.auditor || null;
    this.stallDetectorFactory =
      typeof opts.stallDetectorFactory === 'function'
        ? opts.stallDetectorFactory
        : StallDetector.attach;
    this.authWindow = null;
    this.stallDetector = null;
    this._gameNavigationUrl = null;
    this._loadSequence = 0;
    this._lastProbedLoad = null;
    this._attachedContents = [];
    this._closed = false;

    this._attachContents(this.webContents, false);
  }

  _notify() {
    const snapshot = this.state.getSnapshot();
    this.onStateChange(snapshot);
    if (
      this.webContents &&
      typeof this.webContents.send === 'function' &&
      !this.webContents.isDestroyed()
    ) {
      this.webContents.send('launch-flow:status', snapshot);
    }
  }

  _transition(nextStage) {
    if (this.state.stage === nextStage) return this.state.getSnapshot();
    const snapshot = this.state.transitionTo(nextStage);
    this._syncStallDetector();
    this._notify();
    return snapshot;
  }

  _syncStallDetector() {
    const active =
      this.state.stage === STAGES.GAME_LOADING || this.state.stage === STAGES.GAME_READY;
    if (!active) {
      if (this.stallDetector && typeof this.stallDetector.detach === 'function') {
        this.stallDetector.detach();
      }
      this.stallDetector = null;
      return;
    }
    if (this.stallDetector) return;

    this.stallDetector = this.stallDetectorFactory(this.window, this.session, {
      profileName: this.state.profileId,
      stage: this.state.stage,
      onStall: details => {
        if (this.auditor) {
          try {
            this.auditor.recordStall(
              details && (details.reason || details.resourceType)
                ? details.reason || details.resourceType
                : 'swf-stall'
            );
            this.auditor.recordReload();
          } catch (error) {
            logger.debug('Auditor: recordStall failed - ' + error.message);
          }
        }
        return this.handleStall(details);
      },
      onExhausted: details => this.handleStallExhausted(details)
    });
  }

  _isGameSessionStage() {
    return GAME_SESSION_STAGES.indexOf(this.state.stage) !== -1;
  }

  _markSessionRejected() {
    this._gameNavigationUrl = null;
    this._transition(STAGES.SESSION_REJECTED);
  }

  start() {
    if (this._closed) throw new Error('LaunchFlow is closed');
    if (this.state.stage === STAGES.BOOTSTRAPPING) {
      this._transition(STAGES.SELECTOR_LOADING);
    }
    this.window.loadURL(this.selectorUrl);
    return this.getSnapshot();
  }

  _attachContents(contents, isAuthWindow) {
    const navigate = (event, value, _isInPlace, isMainFrame) => {
      if (isMainFrame === false) return;
      this._routeTopLevel(event, value, isAuthWindow, 'navigate');
    };
    const redirect = (event, value, _isInPlace, isMainFrame) => {
      if (isMainFrame === false) return;
      this._routeTopLevel(event, value, isAuthWindow, 'redirect');
    };
    const popup = (event, value) => {
      this._routeTopLevel(event, value, isAuthWindow, 'new-window');
    };

    contents.on('will-navigate', navigate);
    contents.on('will-redirect', redirect);
    contents.on('did-redirect-navigation', redirect);
    contents.on('new-window', popup);

    if (!isAuthWindow) {
      contents.on('did-start-navigation', (_event, _value, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false) this._loadSequence += 1;
      });
      contents.on('did-finish-load', () => this._handleDidFinishLoad());
    }

    this._attachedContents.push(contents);
  }

  _routeTopLevel(event, value, isAuthWindow, disposition) {
    if (this._closed) return;
    let role = urlConfig.URL_ROLES.UNKNOWN;
    try {
      role = this.classifyUrl(value);
    } catch (_) {
      role = urlConfig.URL_ROLES.UNKNOWN;
    }

    if (role === urlConfig.URL_ROLES.UNKNOWN) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      this._gameNavigationUrl = null;
      this.state.blockUnknown(safeLocation(this.toSafeLocation, value));
      this._syncStallDetector();
      this._notify();
      return;
    }

    if (role === urlConfig.URL_ROLES.GAME_MAIN) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      this._gameNavigationUrl = value;
      this._transition(STAGES.GAME_NAVIGATING);
      this.window.loadURL(value);
      return;
    }

    if (role === urlConfig.URL_ROLES.AUTH) {
      if (this._isGameSessionStage()) {
        this._markSessionRejected();
        if (disposition === 'new-window') {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          this._openAuthWindow(value, true);
        }
        return;
      }
      if (disposition === 'new-window') {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        this._openAuthWindow(value);
      } else {
        this._transition(STAGES.AUTHENTICATING);
      }
      return;
    }

    if (role === urlConfig.URL_ROLES.SELECTOR) {
      this._gameNavigationUrl = null;
      if (this._isGameSessionStage()) {
        this._markSessionRejected();
        return;
      }
      if (isAuthWindow) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        this._closeAuthWindow();
        this._transition(STAGES.SELECTOR_LOADING);
        this.window.loadURL(value);
      } else if (
        this.state.stage !== STAGES.SELECTOR_LOADING &&
        this.state.stage !== STAGES.SELECTOR_READY &&
        this.state.stage !== STAGES.AUTHENTICATING
      ) {
        this._transition(STAGES.SELECTOR_LOADING);
      }
    }
  }

  _openAuthWindow(value, preserveRejectedStage) {
    if (!preserveRejectedStage) this._transition(STAGES.AUTHENTICATING);
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.loadURL(value);
      return this.authWindow;
    }

    const authWindow = new BrowserWindow({
      parent: this.window,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        partition: this.partitionName,
        plugins: false,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        enableRemoteModule: false,
        webviewTag: false
      }
    });
    this.authWindow = authWindow;
    this._attachContents(authWindow.webContents, true);
    authWindow.on('closed', () => {
      if (this.authWindow === authWindow) this.authWindow = null;
    });
    authWindow.loadURL(value);
    return authWindow;
  }

  _closeAuthWindow() {
    const authWindow = this.authWindow;
    this.authWindow = null;
    if (authWindow && !authWindow.isDestroyed()) authWindow.destroy();
  }

  _handleDidFinishLoad() {
    if (this._closed) return;
    const value = this.webContents.getURL();
    let role = urlConfig.URL_ROLES.UNKNOWN;
    try {
      role = this.classifyUrl(value);
    } catch (_) {
      role = urlConfig.URL_ROLES.UNKNOWN;
    }
    if (
      role !== urlConfig.URL_ROLES.SELECTOR &&
      role !== urlConfig.URL_ROLES.AUTH &&
      role !== urlConfig.URL_ROLES.GAME_MAIN
    ) {
      return;
    }

    if (role === urlConfig.URL_ROLES.AUTH) {
      if (
        this.state.stage !== STAGES.AUTHENTICATING &&
        this.state.stage !== STAGES.SESSION_REJECTED
      ) {
        this._transition(STAGES.AUTHENTICATING);
      }
    } else if (role === urlConfig.URL_ROLES.GAME_MAIN) {
      if (this.state.stage === STAGES.GAME_NAVIGATING) {
        this._transition(STAGES.GAME_LOADING);
        this._gameNavigationUrl = null;
      }
    }

    const loadKey = String(this._loadSequence);
    if (this._lastProbedLoad === loadKey) return;
    this._lastProbedLoad = loadKey;
    const stage = this.state.stage;
    const probeContext = {
      role: role,
      stage: stage,
      origin: safeLocation(this.toSafeLocation, value).origin,
      pathname: safeLocation(this.toSafeLocation, value).pathname
    };
    const invokeProbe = () => {
      if (typeof this.probe === 'function') return this.probe(probeContext);
      if (this.probe && typeof this.probe.run === 'function') return this.probe.run(stage);
      throw new TypeError('Invalid page probe');
    };

    this.probeBudget
      .run(stage, invokeProbe)
      .then(result => {
        if (
          role === urlConfig.URL_ROLES.SELECTOR &&
          result &&
          typeof result.loginUiVisible === 'boolean'
        ) {
          if (
            result.loginUiVisible === true &&
            (this.state.stage === STAGES.SELECTOR_LOADING ||
              this.state.stage === STAGES.SELECTOR_READY)
          ) {
            this._transition(STAGES.AUTHENTICATING);
          } else if (
            result.loginUiVisible === false &&
            (this.state.stage === STAGES.SELECTOR_LOADING ||
              this.state.stage === STAGES.AUTHENTICATING)
          ) {
            this._transition(STAGES.SELECTOR_READY);
          }
        }
        if (
          role === urlConfig.URL_ROLES.GAME_MAIN &&
          result &&
          result.flashContainerVisible === true &&
          this.state.stage === STAGES.GAME_LOADING
        ) {
          this._transition(STAGES.GAME_READY);
        }
      })
      .catch(function () {
        // 探针失败保持当前安全状态；不得清 Session 或自动循环。
      });
  }

  getSnapshot() {
    return this.state.getSnapshot();
  }

  _markFailure(config, errorCode) {
    this.state.markFailure(config.failedStage, errorCode, config.safeMessage);
    this._syncStallDetector();
    this._notify();
    return false;
  }

  /**
   * 将主框架加载失败映射到当前可信角色。每类自动恢复最多一次；耗尽后
   * 进入 waiting_user，且只公开当前失败阶段允许的固定动作。
   */
  handleLoadFailure(details) {
    if (this._closed) return false;
    const config = FAILURE_BY_STAGE[this.state.stage];
    if (!config) return false;
    const errorCode =
      details && (typeof details.errorCode === 'number' || typeof details.errorCode === 'string')
        ? details.errorCode
        : null;

    if (!this.state.consumeAttempt(config.attempt)) {
      return this._markFailure(config, errorCode);
    }

    const recovered = this.requestRecovery(config.action, {
      profileId: this.state.profileId,
      source: 'automatic'
    });
    if (!recovered) return this._markFailure(config, errorCode);
    return true;
  }

  /**
   * 只执行恢复动作枚举。调用方不能提供 URL；Profile 与来源必须匹配
   * 当前控制器，所有路径都保留当前 Electron Session。
   */
  requestRecovery(action, context) {
    if (this._closed || !this.state.isRecoveryAllowed(action, context)) return false;
    if (action === RECOVERY_ACTIONS.RELOAD_SELECTOR) {
      this._gameNavigationUrl = null;
      this._transition(STAGES.SELECTOR_LOADING);
      this.webContents.reload();
      return true;
    }

    if (action === RECOVERY_ACTIONS.REOPEN_AUTH) {
      this._transition(STAGES.AUTHENTICATING);
      if (this.authWindow && !this.authWindow.isDestroyed()) {
        this.authWindow.webContents.reload();
        return true;
      }

      let role = urlConfig.URL_ROLES.UNKNOWN;
      try {
        role = this.classifyUrl(this.webContents.getURL());
      } catch (_) {
        role = urlConfig.URL_ROLES.UNKNOWN;
      }
      if (role === urlConfig.URL_ROLES.AUTH) {
        this.webContents.reload();
      } else {
        // 国服实测认证 UI 位于固定 SELECTOR 页面；这里不猜测 AUTH URL。
        this.window.loadURL(this.selectorUrl);
      }
      return true;
    }

    if (action === RECOVERY_ACTIONS.RETRY_GAME_NAVIGATION) {
      if (
        typeof this._gameNavigationUrl !== 'string' ||
        this.classifyUrl(this._gameNavigationUrl) !== urlConfig.URL_ROLES.GAME_MAIN
      ) {
        return false;
      }
      this._transition(STAGES.GAME_NAVIGATING);
      this.window.loadURL(this._gameNavigationUrl);
      return true;
    }

    if (action === RECOVERY_ACTIONS.RELOAD_GAME) {
      let role = urlConfig.URL_ROLES.UNKNOWN;
      try {
        role = this.classifyUrl(this.webContents.getURL());
      } catch (_) {
        role = urlConfig.URL_ROLES.UNKNOWN;
      }
      if (role !== urlConfig.URL_ROLES.GAME_MAIN) return false;
      this._transition(STAGES.GAME_LOADING);
      this.webContents.reload();
      return true;
    }

    if (action === RECOVERY_ACTIONS.RETURN_TO_SELECTOR) {
      this._gameNavigationUrl = null;
      this._closeAuthWindow();
      this._transition(STAGES.SELECTOR_LOADING);
      this.window.loadURL(this.selectorUrl);
      return true;
    }

    return false;
  }

  handleRendererGone(details) {
    if (this._closed) return false;
    const event = details || {};
    if (event.reason === 'clean-exit' || event.reason === 'killed') return false;
    const config = FAILURE_BY_STAGE[this.state.stage];
    if (!config) return false;

    if (typeof event.retryCount === 'number') {
      this.state.attempts.crash = Math.max(
        this.state.attempts.crash,
        Math.min(event.retryCount, ATTEMPT_LIMITS.crash)
      );
    }
    if (event.exhausted === true) {
      return this._markFailure(config, event.errorCode);
    }

    const source = config.action === RECOVERY_ACTIONS.RELOAD_GAME ? 'crash' : 'automatic';
    const recovered = this.requestRecovery(config.action, {
      profileId: this.state.profileId,
      source: source
    });
    if (!recovered) return this._markFailure(config, event.errorCode);
    return true;
  }

  handleUnresponsive() {
    if (this._closed) return false;
    const canRetry = this.state.consumeAttempt('crash');
    return this.handleRendererGone({
      reason: 'unresponsive',
      errorCode: 'WINDOW_UNRESPONSIVE',
      retryCount: this.state.attempts.crash,
      exhausted: !canRetry
    });
  }

  handleResponsive() {
    if (this._closed) return false;
    this._notify();
    return true;
  }

  handleStall() {
    if (this._closed) return false;
    return this.requestRecovery(RECOVERY_ACTIONS.RELOAD_GAME, {
      profileId: this.state.profileId,
      source: 'stall'
    });
  }

  handleStallExhausted(details) {
    if (this._closed) return false;
    const config = FAILURE_BY_STAGE[this.state.stage];
    if (!config || config.action !== RECOVERY_ACTIONS.RELOAD_GAME) return false;
    return this._markFailure(config, details && details.errorCode);
  }

  /**
   * Recarrega apenas um papel superior já classificado. Nunca limpa Session,
   * nunca executa login por API/senha e não tenta adivinhar um URL UNKNOWN.
   *
   * @returns {boolean} true quando um papel seguro foi recarregado
   */
  reloadCurrentRole() {
    if (this._closed) return false;

    if (
      this.authWindow &&
      !this.authWindow.isDestroyed() &&
      this.state.stage === STAGES.AUTHENTICATING
    ) {
      this.authWindow.webContents.reload();
      return true;
    }

    const value = this.webContents.getURL();
    let role = urlConfig.URL_ROLES.UNKNOWN;
    try {
      role = this.classifyUrl(value);
    } catch (_) {
      role = urlConfig.URL_ROLES.UNKNOWN;
    }

    if (role === urlConfig.URL_ROLES.SELECTOR) {
      if (this.state.stage === STAGES.SELECTOR_READY) {
        this._transition(STAGES.SELECTOR_LOADING);
      }
      this.webContents.reload();
      return true;
    }

    if (role === urlConfig.URL_ROLES.GAME_MAIN) {
      if (this.state.stage === STAGES.GAME_READY) {
        this._transition(STAGES.GAME_LOADING);
      }
      this.webContents.reload();
      return true;
    }

    if (role === urlConfig.URL_ROLES.AUTH) {
      if (this.state.stage !== STAGES.AUTHENTICATING) {
        this._transition(STAGES.AUTHENTICATING);
      }
      this.webContents.reload();
      return true;
    }

    return false;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._gameNavigationUrl = null;
    this._closeAuthWindow();
    if (this.state.stage !== STAGES.CLOSED) this._transition(STAGES.CLOSED);
  }
}

function createTencentLaunchFlow(options) {
  return new TencentLaunchFlowController(options);
}

module.exports = {
  LaunchFlowState: LaunchFlowState,
  TencentLaunchFlowController: TencentLaunchFlowController,
  createTencentLaunchFlow: createTencentLaunchFlow,
  createPageProbe: createPageProbe,
  ProbeBudget: ProbeBudget,
  PROBE_SELECTOR_REGISTRY: PROBE_SELECTOR_REGISTRY,
  STAGES: STAGES,
  STATUSES: STATUSES,
  ATTEMPT_LIMITS: ATTEMPT_LIMITS,
  RECOVERY_ACTIONS: RECOVERY_ACTIONS
};
