/**
 * Electron 11 Jest mock.
 *
 * 只模拟本仓库使用的 Electron 11 API，并保留 BrowserWindow、partition、
 * 顶层导航、redirect 与 new-window 的可观察状态。刻意不提供新版
 * setWindowOpenHandler API，避免测试误用 Electron 11 不支持的接口。
 */

'use strict';

function createEventTarget() {
  const handlers = Object.create(null);

  const target = {
    _handlers: handlers,
    on: jest.fn(function (event, handler) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return target;
    }),
    once: jest.fn(function (event, handler) {
      function onceHandler() {
        target.removeListener(event, onceHandler);
        return handler.apply(null, arguments);
      }
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(onceHandler);
      return target;
    }),
    off: jest.fn(function (event, handler) {
      return target.removeListener(event, handler);
    }),
    removeListener: jest.fn(function (event, handler) {
      if (!handlers[event]) return target;
      handlers[event] = handlers[event].filter(function (candidate) {
        return candidate !== handler;
      });
      return target;
    }),
    removeAllListeners: jest.fn(function (event) {
      if (event) delete handlers[event];
      else Object.keys(handlers).forEach(function (key) { delete handlers[key]; });
      return target;
    }),
    listenerCount: jest.fn(function (event) {
      return (handlers[event] || []).length;
    }),
    emit: jest.fn(function (event) {
      const args = Array.prototype.slice.call(arguments, 1);
      (handlers[event] || []).slice().forEach(function (handler) {
        handler.apply(null, args);
      });
      return (handlers[event] || []).length > 0;
    })
  };

  return target;
}

function createWebRequest() {
  const handlers = Object.create(null);

  function registration(name) {
    return jest.fn(function (arg1, arg2) {
      const callback = typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : null;
      handlers[name] = callback;
    });
  }

  return {
    _handlers: handlers,
    _emit: function (name, details, callback) {
      if (typeof handlers[name] === 'function') return handlers[name](details, callback);
      return undefined;
    },
    onBeforeRequest: registration('onBeforeRequest'),
    onBeforeSendHeaders: registration('onBeforeSendHeaders'),
    onHeadersReceived: registration('onHeadersReceived'),
    onResponseStarted: registration('onResponseStarted'),
    onBeforeRedirect: registration('onBeforeRedirect'),
    onCompleted: registration('onCompleted'),
    onErrorOccurred: registration('onErrorOccurred')
  };
}

function createSession(partitionName) {
  return {
    partition: partitionName,
    clearCache: jest.fn(function () { return Promise.resolve(); }),
    clearStorageData: jest.fn(function () { return Promise.resolve(); }),
    cookies: {
      get: jest.fn(function () { return Promise.resolve([]); }),
      set: jest.fn(function () { return Promise.resolve(); }),
      remove: jest.fn(function () { return Promise.resolve(); })
    },
    webRequest: createWebRequest(),
    setPermissionRequestHandler: jest.fn(),
    setUserAgent: jest.fn(),
    protocol: { registerFileProtocol: jest.fn() }
  };
}

const partitionSessions = new Map();
const defaultSession = createSession('default');

function sessionForPartition(partitionName) {
  if (!partitionSessions.has(partitionName)) {
    partitionSessions.set(partitionName, createSession(partitionName));
  }
  return partitionSessions.get(partitionName);
}

let nextWebContentsId = 1;
function createWebContents(owner, ses, initialZoomFactor) {
  const target = createEventTarget();
  let currentURL = '';
  let destroyed = false;
  let zoomFactor = initialZoomFactor || 1;

  Object.assign(target, {
    id: nextWebContentsId++,
    session: ses,
    loadURL: jest.fn(function (url) {
      currentURL = url;
      return Promise.resolve();
    }),
    reload: jest.fn(),
    reloadIgnoringCache: jest.fn(),
    stop: jest.fn(),
    send: jest.fn(),
    executeJavaScript: jest.fn(function () { return Promise.resolve(false); }),
    setZoomFactor: jest.fn(function (value) { zoomFactor = value; }),
    getZoomFactor: jest.fn(function () { return zoomFactor; }),
    insertCSS: jest.fn(function () { return Promise.resolve('css-key'); }),
    openDevTools: jest.fn(),
    closeDevTools: jest.fn(),
    isDevToolsOpened: jest.fn(function () { return false; }),
    isDestroyed: jest.fn(function () { return destroyed; }),
    getURL: jest.fn(function () { return currentURL; }),
    destroy: jest.fn(function () { destroyed = true; }),
    _setURL: function (url) { currentURL = url; },
    _emitWillNavigate: function (url, isMainFrame) {
      const event = { preventDefault: jest.fn() };
      target.emit('will-navigate', event, url, true, isMainFrame !== false);
      return event;
    },
    _emitRedirect: function (url, isMainFrame) {
      const event = { preventDefault: jest.fn() };
      target.emit('will-redirect', event, url, false, isMainFrame !== false, 1, 1);
      return event;
    },
    _emitDidRedirectNavigation: function (url, isMainFrame) {
      const event = { preventDefault: jest.fn() };
      target.emit('did-redirect-navigation', event, url, false, isMainFrame !== false, 1, 1);
      return event;
    },
    _emitNewWindow: function (url, disposition, frameName) {
      const event = { preventDefault: jest.fn(), newGuest: null };
      target.emit(
        'new-window',
        event,
        url,
        frameName || '',
        disposition || 'new-window',
        {},
        [],
        { url: '', policy: 'no-referrer' }
      );
      return event;
    },
    _owner: owner
  });

  return target;
}

const createdWindows = [];
let nextWindowId = 1;

function createBrowserWindow(options) {
  const target = createEventTarget();
  const opts = options || {};
  const webPreferences = Object.assign({}, opts.webPreferences || {});
  const partitionName = webPreferences.partition || 'default';
  const ses = partitionName === 'default' ? defaultSession : sessionForPartition(partitionName);
  let destroyed = false;
  let visible = !!opts.show;
  let minimized = false;
  let maximized = false;
  let alwaysOnTop = false;
  let contentSize = [opts.width || 800, opts.height || 600];

  Object.assign(target, {
    id: nextWindowId++,
    options: opts,
    webPreferences: webPreferences,
    webContents: null,
    loadURL: jest.fn(function (url) { return target.webContents.loadURL(url); }),
    show: jest.fn(function () { visible = true; }),
    hide: jest.fn(function () { visible = false; }),
    focus: jest.fn(),
    close: jest.fn(function () { target.emit('close', { preventDefault: jest.fn() }); }),
    destroy: jest.fn(function () {
      destroyed = true;
      target.webContents.destroy();
      target.emit('closed');
    }),
    isDestroyed: jest.fn(function () { return destroyed; }),
    isVisible: jest.fn(function () { return visible; }),
    minimize: jest.fn(function () { minimized = true; }),
    restore: jest.fn(function () { minimized = false; }),
    isMinimized: jest.fn(function () { return minimized; }),
    maximize: jest.fn(function () { maximized = true; }),
    unmaximize: jest.fn(function () { maximized = false; }),
    isMaximized: jest.fn(function () { return maximized; }),
    setAlwaysOnTop: jest.fn(function (value) { alwaysOnTop = !!value; }),
    isAlwaysOnTop: jest.fn(function () { return alwaysOnTop; }),
    setTitle: jest.fn(),
    setMenuBarVisibility: jest.fn(),
    setMenu: jest.fn(),
    setContentSize: jest.fn(function (width, height) { contentSize = [width, height]; }),
    getContentSize: jest.fn(function () { return contentSize.slice(); }),
    getBounds: jest.fn(function () {
      return { x: 0, y: 0, width: opts.width || 800, height: opts.height || 600 };
    })
  });

  target.webContents = createWebContents(target, ses, webPreferences.zoomFactor);
  createdWindows.push(target);
  return target;
}

const BrowserWindow = jest.fn(function (options) {
  return createBrowserWindow(options);
});
BrowserWindow.getAllWindows = jest.fn(function () { return createdWindows.slice(); });
BrowserWindow.fromId = jest.fn(function (id) {
  return createdWindows.find(function (win) { return win.id === id; }) || null;
});
BrowserWindow.fromWebContents = jest.fn(function (contents) { return contents && contents._owner; });

const electronSession = {
  defaultSession: defaultSession,
  fromPartition: jest.fn(sessionForPartition)
};

const electronMock = {
  app: {
    getPath: jest.fn(function (p) { return '/tmp/naruto-test/' + p; }),
    getAppPath: jest.fn(function () { return '/tmp/naruto-test'; }),
    getName: jest.fn(function () { return 'Naruto Online'; }),
    getVersion: jest.fn(function () { return '4.9.2'; }),
    isReady: jest.fn(function () { return true; }),
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
    whenReady: jest.fn(function () { return Promise.resolve(); }),
    commandLine: { appendSwitch: jest.fn(), appendArgument: jest.fn() },
    requestSingleInstanceLock: jest.fn(function () { return true; }),
    quit: jest.fn(),
    exit: jest.fn(),
    relaunch: jest.fn(),
    getGPUFeatureStatus: jest.fn(function () { return {}; })
  },
  BrowserWindow: BrowserWindow,
  Notification: jest.fn(),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeHandler: jest.fn()
  },
  ipcRenderer: { send: jest.fn(), on: jest.fn(), invoke: jest.fn() },
  dialog: {
    showMessageBox: jest.fn(),
    showMessageBoxSync: jest.fn(),
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
    showErrorBox: jest.fn()
  },
  session: electronSession,
  webContents: { getAllWebContents: jest.fn(function () { return []; }) },
  Menu: { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() },
  shell: { openExternal: jest.fn(), openPath: jest.fn(), showItemInFolder: jest.fn() },
  screen: {
    getPrimaryDisplay: jest.fn(function () {
      return { workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 };
    }),
    getDisplayMatching: jest.fn(function () {
      return { workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 };
    }),
    getAllDisplays: jest.fn(function () {
      return [{ workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 }];
    })
  },
  nativeImage: { createFromPath: jest.fn(), fromPath: jest.fn(), createEmpty: jest.fn() },
  clipboard: { writeText: jest.fn(), readText: jest.fn() },
  systemPreferences: { getMediaAccessStatus: jest.fn() },
  __mock: {
    createBrowserWindow: createBrowserWindow,
    createSession: createSession,
    createdWindows: createdWindows,
    partitionSessions: partitionSessions,
    reset: function () {
      createdWindows.length = 0;
      partitionSessions.clear();
      nextWindowId = 1;
      nextWebContentsId = 1;
    }
  }
};

module.exports = electronMock;
