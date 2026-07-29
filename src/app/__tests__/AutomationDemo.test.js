'use strict';

const mockMkdir = jest.fn(() => Promise.resolve());
const mockWriteFile = jest.fn(() => Promise.resolve());

jest.mock('fs', () => ({
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile
  }
}));

const electron = require('electron');
const AutomationDemo = require('../AutomationDemo');

function pngBuffer(width, height) {
  const png = Buffer.alloc(24);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

function mockImage(png, bitmap) {
  return {
    toPNG: jest.fn(() => png),
    toBitmap: jest.fn(() => bitmap || Buffer.alloc(4))
  };
}

function mockWindow(contentWidth, contentHeight, images) {
  const captures = Array.isArray(images) ? images.slice() : [images];
  let attached = false;
  const cdp = {
    isAttached: jest.fn(() => attached),
    attach: jest.fn(() => {
      attached = true;
    }),
    detach: jest.fn(() => {
      attached = false;
    }),
    sendCommand: jest.fn(() => Promise.resolve({}))
  };
  const webContents = {
    capturePage: jest.fn(() => Promise.resolve(captures.shift() || images[images.length - 1])),
    debugger: cdp
  };
  return {
    webContents: webContents,
    isDestroyed: jest.fn(() => false),
    getContentSize: jest.fn(() => [contentWidth, contentHeight]),
    isFocused: jest.fn(() => false),
    focus: jest.fn()
  };
}

describe('AutomationDemo', () => {
  const originalDebug = process.env.SHINOBI_DEBUG;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHINOBI_DEBUG = '1';
    electron.app.getPath.mockReturnValue('C:\\naruto-test\\userData');
  });

  afterAll(() => {
    if (originalDebug === undefined) delete process.env.SHINOBI_DEBUG;
    else process.env.SHINOBI_DEBUG = originalDebug;
  });

  test('Debug 开关只接受精确值 1', () => {
    expect(AutomationDemo.isEnabled({ SHINOBI_DEBUG: '1' })).toBe(true);
    expect(AutomationDemo.isEnabled({ SHINOBI_DEBUG: '0' })).toBe(false);
    expect(AutomationDemo.isEnabled({ SHINOBI_DEBUG: 'true' })).toBe(false);
    expect(AutomationDemo.isEnabled({})).toBe(false);
  });

  test('按截图坐标映射并通过 CDP 点击，全程不聚焦窗口或调用 sendInputEvent', async () => {
    const png = pngBuffer(2560, 1440);
    const before = mockImage(png, Buffer.from([0, 0, 0, 255, 0, 0, 0, 255]));
    const after = mockImage(png, Buffer.from([0, 0, 0, 255, 255, 0, 0, 255]));
    const win = mockWindow(1280, 720, [before, after]);

    const result = await AutomationDemo.click(win, { width: 2560, height: 1440 }, 1280, 720, {
      profileId: 'p_001',
      settleDelayMs: 0
    });

    expect(result.inputPoint).toEqual({ x: 640, y: 360 });
    expect(result.backend).toBe('cdp');
    expect(result.evidence).toEqual(
      expect.objectContaining({
        focusBefore: false,
        focusAfter: false,
        backgroundFocusPreserved: true,
        cursorPreserved: true,
        visualChange: {
          available: true,
          changedPixels: 1,
          totalPixels: 2,
          changedRatio: 0.5
        }
      })
    );
    expect(win.focus).not.toHaveBeenCalled();
    expect(win.webContents).not.toHaveProperty('sendInputEvent');
    expect(win.webContents.debugger.attach).toHaveBeenCalledWith('1.3');
    expect(win.webContents.debugger.detach).toHaveBeenCalledTimes(1);
    expect(win.webContents.debugger.sendCommand.mock.calls).toEqual([
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mouseMoved',
          x: 640,
          y: 360,
          button: 'none',
          buttons: 0
        }
      ],
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x: 640,
          y: 360,
          button: 'left',
          buttons: 1,
          clickCount: 1
        }
      ],
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: 640,
          y: 360,
          button: 'left',
          buttons: 0,
          clickCount: 1
        }
      ]
    ]);
  });

  test('拒绝非有限数字、越界坐标和无效尺寸', () => {
    expect(() =>
      AutomationDemo.mapImagePoint('10', 10, { width: 100, height: 100 }, { width: 50, height: 50 })
    ).toThrow(TypeError);
    expect(() =>
      AutomationDemo.mapImagePoint(
        Number.NaN,
        10,
        { width: 100, height: 100 },
        { width: 50, height: 50 }
      )
    ).toThrow(TypeError);
    expect(() =>
      AutomationDemo.mapImagePoint(100, 10, { width: 100, height: 100 }, { width: 50, height: 50 })
    ).toThrow(RangeError);
    expect(() =>
      AutomationDemo.mapImagePoint(-1, 10, { width: 100, height: 100 }, { width: 50, height: 50 })
    ).toThrow(RangeError);
    expect(() =>
      AutomationDemo.mapImagePoint(10, 10, { width: 0, height: 100 }, { width: 50, height: 50 })
    ).toThrow(RangeError);
  });

  test('截图坐标可归一化并按运行时内容尺寸还原，覆盖高 DPI 映射', () => {
    const normalized = AutomationDemo.normalizeImagePoint(
      150,
      190,
      { width: 614, height: 290 },
      { width: 307, height: 145 }
    );

    expect(normalized).toEqual({
      normalizedX: 75 / 307,
      normalizedY: 95 / 145,
      inputPoint: { x: 75, y: 95 }
    });
    expect(
      AutomationDemo.mapNormalizedPoint(normalized.normalizedX, normalized.normalizedY, {
        width: 307,
        height: 145
      })
    ).toEqual({ x: 75, y: 95 });
    expect(() => AutomationDemo.mapNormalizedPoint(1, 0.5, { width: 307, height: 145 })).toThrow(
      RangeError
    );
  });

  test('受限脚本可按内容坐标调用同一 CDP 点击实现', async () => {
    const png = pngBuffer(614, 290);
    const before = mockImage(png, Buffer.from([0, 0, 0, 255]));
    const after = mockImage(png, Buffer.from([0, 255, 0, 255]));
    const win = mockWindow(307, 145, [before, after]);

    const result = await AutomationDemo.clickContent(win, 75, 95, {
      profileId: 'p_001',
      settleDelayMs: 0
    });

    expect(result.inputPoint).toEqual({ x: 75, y: 95 });
    expect(result.imagePoint).toBeNull();
    expect(result.imageSize).toBeNull();
    expect(result.dispatchedAt).toEqual(expect.any(Number));
    expect(win.webContents.debugger.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 75, y: 95 })
    );
  });

  test('capture 保存 PNG 并返回 PNG 像素尺寸和内容尺寸', async () => {
    const png = pngBuffer(1920, 1080);
    const win = mockWindow(1280, 720, [mockImage(png)]);

    const result = await AutomationDemo.capture(win, 'p_001');

    expect(win.webContents.capturePage).toHaveBeenCalledTimes(1);
    expect(mockMkdir).toHaveBeenCalledWith('C:\\naruto-test\\userData\\automation-demo', {
      recursive: true
    });
    expect(mockWriteFile).toHaveBeenCalledWith(result.filePath, png);
    expect(result.filePath).toMatch(
      /^C:\\naruto-test\\userData\\automation-demo\\capture-p_001-\d+-\d+\.png$/
    );
    expect(result.imageSize).toEqual({ width: 1920, height: 1080 });
    expect(result.contentSize).toEqual({ width: 1280, height: 720 });
  });

  test('非 Debug 环境拒绝截图和点击', async () => {
    delete process.env.SHINOBI_DEBUG;
    const win = mockWindow(1280, 720, [mockImage(pngBuffer(1280, 720))]);

    await expect(AutomationDemo.capture(win, 'p_001')).rejects.toMatchObject({
      code: 'debug-disabled'
    });
    await expect(
      AutomationDemo.click(win, { width: 1280, height: 720 }, 10, 10)
    ).rejects.toMatchObject({ code: 'debug-disabled' });
  });

  test('游戏 DevTools 已占用 debugger 时明确拒绝，不干扰既有调试会话', async () => {
    const png = pngBuffer(1280, 720);
    const win = mockWindow(1280, 720, [mockImage(png)]);
    win.webContents.debugger.isAttached.mockReturnValue(true);

    await expect(
      AutomationDemo.click(win, { width: 1280, height: 720 }, 10, 10, {
        settleDelayMs: 0
      })
    ).rejects.toMatchObject({ code: 'cdp-already-attached' });
    expect(win.webContents.debugger.attach).not.toHaveBeenCalled();
    expect(win.webContents.debugger.detach).not.toHaveBeenCalled();
  });
});
