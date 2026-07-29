'use strict';

const mockExposeInMainWorld = jest.fn();
const mockInvoke = jest.fn();

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: jest.fn(),
    removeListener: jest.fn()
  }
}));

function loadPreload(debugValue) {
  if (debugValue === undefined) delete process.env.SHINOBI_DEBUG;
  else process.env.SHINOBI_DEBUG = debugValue;

  jest.isolateModules(function () {
    require('../preload');
  });
  return mockExposeInMainWorld.mock.calls.find(function (call) {
    return call[0] === 'narutoLauncher';
  })[1];
}

describe('preload automationDemo Debug bridge', () => {
  const originalDebug = process.env.SHINOBI_DEBUG;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalDebug === undefined) delete process.env.SHINOBI_DEBUG;
    else process.env.SHINOBI_DEBUG = originalDebug;
  });

  test('未设置 SHINOBI_DEBUG=1 时不暴露 automationDemo', () => {
    const api = loadPreload(undefined);
    expect(api.automationDemo).toBeUndefined();
    expect(api.flashProbe).toBeUndefined();
  });

  test('SHINOBI_DEBUG=1 时暴露 capture/click 并调用限定通道', async () => {
    const api = loadPreload('1');

    expect(typeof api.automationDemo.capture).toBe('function');
    expect(typeof api.automationDemo.click).toBe('function');

    api.automationDemo.capture();
    api.automationDemo.click(20, 30);

    expect(mockInvoke).toHaveBeenCalledWith('automation-demo:capture');
    expect(mockInvoke).toHaveBeenCalledWith('automation-demo:click', 20, 30);

    await expect(api.automationDemo.click('20', 30)).resolves.toEqual({
      ok: false,
      error: 'invalid-coordinate-type'
    });
  });

  test('SHINOBI_DEBUG=1 时暴露 flashProbe.snapshot 限定通道', () => {
    const api = loadPreload('1');
    api.flashProbe.snapshot();
    expect(mockInvoke).toHaveBeenCalledWith('flash-probe:snapshot');
  });
});
