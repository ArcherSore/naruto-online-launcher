'use strict';

const electron = require('electron');

describe('Electron 11 mock 导航与 Session 观测能力', () => {
  beforeEach(() => {
    electron.__mock.reset();
    electron.BrowserWindow.mockImplementation(function (options) {
      return electron.__mock.createBrowserWindow(options);
    });
    jest.clearAllMocks();
  });

  test('BrowserWindow 保留完整 webPreferences 与独立 partition Session', () => {
    const parent = new electron.BrowserWindow({
      webPreferences: {
        partition: 'persist:profile-a',
        plugins: true,
        preload: 'game-preload.js'
      }
    });
    const auth = new electron.BrowserWindow({
      parent: parent,
      webPreferences: {
        partition: 'persist:profile-a',
        plugins: false,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        enableRemoteModule: false,
        webviewTag: false
      }
    });

    expect(parent.webContents.session).toBe(auth.webContents.session);
    expect(parent.webContents.session).not.toBe(electron.session.defaultSession);
    expect(auth.webPreferences).toEqual({
      partition: 'persist:profile-a',
      plugins: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      enableRemoteModule: false,
      webviewTag: false
    });
    expect(auth.webPreferences).not.toHaveProperty('preload');
  });

  test('Profile A/B 的 fromPartition 观测结果相互隔离且稳定', () => {
    const a1 = electron.session.fromPartition('persist:profile-a');
    const a2 = electron.session.fromPartition('persist:profile-a');
    const b = electron.session.fromPartition('persist:profile-b');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.partition).toBe('persist:profile-a');
    expect(b.partition).toBe('persist:profile-b');
  });

  test('父窗与认证子窗可独立观测 navigate、redirect 和 new-window', () => {
    const parent = new electron.BrowserWindow({
      webPreferences: { partition: 'persist:profile-a', plugins: true }
    });
    const auth = new electron.BrowserWindow({
      parent: parent,
      webPreferences: { partition: 'persist:profile-a', plugins: false }
    });
    const observed = [];

    parent.webContents.on('will-navigate', (_event, url) => observed.push(['parent', url]));
    auth.webContents.on('will-redirect', (_event, url) => observed.push(['redirect', url]));
    auth.webContents.on('new-window', (_event, url) => observed.push(['popup', url]));

    parent.webContents._emitWillNavigate('https://huoying.qq.com/server/website/');
    auth.webContents._emitRedirect('https://auth.example/redirect');
    auth.webContents._emitNewWindow('https://auth.example/second-popup');

    expect(observed).toEqual([
      ['parent', 'https://huoying.qq.com/server/website/'],
      ['redirect', 'https://auth.example/redirect'],
      ['popup', 'https://auth.example/second-popup']
    ]);
  });

  test('二次 popup 拥有独立事件链，可继续递归分类', () => {
    const secondPopup = new electron.BrowserWindow({
      webPreferences: {
        partition: 'persist:profile-a',
        plugins: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    const navigate = jest.fn();
    const redirect = jest.fn();
    const popup = jest.fn();

    secondPopup.webContents.on('will-navigate', navigate);
    secondPopup.webContents.on('will-redirect', redirect);
    secondPopup.webContents.on('new-window', popup);

    secondPopup.webContents._emitWillNavigate('https://auth.example/navigate');
    secondPopup.webContents._emitRedirect('https://auth.example/redirect');
    secondPopup.webContents._emitNewWindow('https://auth.example/third-popup');

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(popup).toHaveBeenCalledTimes(1);
    expect(secondPopup.webContents.setWindowOpenHandler).toBeUndefined();
  });
});
