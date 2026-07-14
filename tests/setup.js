/**
 * tests/setup.js — Jest global setup
 *
 * Mocka dependências do Electron (electron + electron-log) que não rodam
 * fora do runtime Electron. Carregado antes de cada test file via
 * setupFiles no jest.config.js.
 *
 * NOTA: jest.mock factories são hoisted — só podem referenciar variáveis
 * prefixadas com "mock". Por isso os mocks são inline nos factories.
 */

'use strict';

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  verbose: jest.fn(),
  transports: {
    file: { level: 'info', fileName: 'main.log', format: null },
    console: { level: 'debug', format: null },
  },
  level: 'info',
  log: jest.fn(),
}));

jest.mock('electron', () => {
  const fn = jest.fn();
  return {
    app: {
      getPath: jest.fn((p) => '/tmp/naruto-test/' + p),
      getAppPath: jest.fn(() => '/tmp/naruto-test'),
      getName: jest.fn(() => 'Naruto Online'),
      getVersion: jest.fn(() => '4.9.2'),
      isReady: jest.fn(() => true),
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
      whenReady: jest.fn(() => Promise.resolve()),
      commandLine: { appendSwitch: jest.fn() },
      requestSingleInstanceLock: jest.fn(() => true),
      quit: jest.fn(),
      exit: jest.fn(),
      relaunch: jest.fn(),
    },
    BrowserWindow: fn,
    Notification: fn,
    ipcMain: { handle: jest.fn(), on: jest.fn(), once: jest.fn(), removeHandler: jest.fn() },
    ipcRenderer: { send: jest.fn(), on: jest.fn(), invoke: jest.fn() },
    dialog: {
      showMessageBox: jest.fn(),
      showMessageBoxSync: jest.fn(),
      showOpenDialog: jest.fn(),
      showSaveDialog: jest.fn(),
      showErrorBox: jest.fn(),
    },
    session: {
      defaultSession: {
        clearCache: jest.fn(),
        clearStorageData: jest.fn(),
        cookies: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
      },
      fromPartition: jest.fn(() => ({
        clearCache: jest.fn(),
        clearStorageData: jest.fn(),
        cookies: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
      })),
    },
    webContents: { getAllWebContents: jest.fn(() => []) },
    Menu: { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() },
    shell: { openExternal: jest.fn(), openPath: jest.fn(), showItemInFolder: jest.fn() },
    screen: { getPrimaryDisplay: jest.fn(() => ({ workAreaSize: { width: 1920, height: 1080 } })) },
    nativeImage: { createFromPath: jest.fn() },
  };
});
