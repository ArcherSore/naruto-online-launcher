'use strict';

const electron = require('electron');
const GameViewport = require('../GameViewport');

function makeWindow(setContentSize) {
  const handlers = {};
  const winHandlers = {};
  let contentSize = [0, 0];
  const wc = {
    on: jest.fn(function (event, handler) {
      handlers[event] = handler;
    }),
    removeListener: jest.fn(),
    isDestroyed: jest.fn(function () {
      return false;
    }),
    setZoomFactor: jest.fn()
  };
  const win = {
    webContents: wc,
    isDestroyed: jest.fn(function () {
      return false;
    }),
    getBounds: jest.fn(function () {
      return { x: 0, y: 0, width: contentSize[0], height: contentSize[1] };
    }),
    getContentSize: jest.fn(function () {
      return contentSize.slice();
    }),
    setContentSize: jest.fn(function (width, height) {
      contentSize = setContentSize ? setContentSize(width, height) : [width, height];
    }),
    on: jest.fn(function (event, handler) {
      winHandlers[event] = handler;
    }),
    removeListener: jest.fn()
  };
  return { win: win, wc: wc, handlers: handlers, winHandlers: winHandlers };
}

describe('GameViewport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    electron.screen.getPrimaryDisplay.mockReturnValue({ scaleFactor: 1 });
    electron.screen.getDisplayMatching.mockReturnValue({ scaleFactor: 1 });
  });

  test('exports the canonical image-recognition viewport', () => {
    const target = makeWindow();
    GameViewport.enforce(target.win);

    expect(GameViewport.WIDTH).toBe(1920);
    expect(GameViewport.HEIGHT).toBe(1080);
    expect(GameViewport.getAutomationContentSize(target.win)).toEqual({
      width: 1920,
      height: 1080
    });
  });

  test('converts the canonical viewport to per-display DIP and inverse page zoom', () => {
    expect(GameViewport.createMetrics(2)).toEqual({
      scaleFactor: 2,
      contentWidth: 960,
      contentHeight: 540,
      zoomFactor: 0.5
    });
    expect(GameViewport.createMetrics(1.25)).toEqual({
      scaleFactor: 1.25,
      contentWidth: 1536,
      contentHeight: 864,
      zoomFactor: 0.8
    });
  });

  test('attach immediately enforces content size and page zoom at 100% DPI', () => {
    const target = makeWindow();

    GameViewport.attach(target.win);

    expect(target.win.setContentSize).toHaveBeenCalledWith(1920, 1080);
    expect(target.wc.setZoomFactor).toHaveBeenCalledWith(1);
    expect(target.wc.on).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    expect(target.wc.on).toHaveBeenCalledWith('zoom-changed', expect.any(Function));
    expect(target.win.on).toHaveBeenCalledWith('move', expect.any(Function));
  });

  test('compensates 200% DPI and corrects Electron content-size rounding', () => {
    electron.screen.getDisplayMatching.mockReturnValue({ scaleFactor: 2 });
    const target = makeWindow(function (width, height) {
      return [width + 1, height + 1];
    });

    GameViewport.attach(target.win);

    expect(target.win.setContentSize.mock.calls).toEqual([
      [960, 540],
      [959, 539]
    ]);
    expect(target.win.getContentSize()).toEqual([960, 540]);
    expect(target.wc.setZoomFactor).toHaveBeenCalledWith(0.5);
  });

  test('re-enforces the contract after navigation completes', () => {
    const target = makeWindow();
    GameViewport.attach(target.win);
    target.win.setContentSize.mockClear();
    target.wc.setZoomFactor.mockClear();

    target.handlers['did-finish-load']();

    expect(target.win.setContentSize).toHaveBeenCalledWith(1920, 1080);
    expect(target.wc.setZoomFactor).toHaveBeenCalledWith(1);
  });

  test('rejects mouse-wheel zoom and restores the display-specific zoom', () => {
    electron.screen.getDisplayMatching.mockReturnValue({ scaleFactor: 2 });
    const target = makeWindow();
    const event = { preventDefault: jest.fn() };
    GameViewport.attach(target.win);
    target.wc.setZoomFactor.mockClear();

    target.handlers['zoom-changed'](event, 'in');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(target.wc.setZoomFactor).toHaveBeenCalledWith(0.5);
  });

  test('recalculates the game viewport after moving to a display with another DPI', () => {
    const target = makeWindow();
    GameViewport.attach(target.win);
    target.win.setContentSize.mockClear();
    target.wc.setZoomFactor.mockClear();
    electron.screen.getDisplayMatching.mockReturnValue({ scaleFactor: 2 });

    target.winHandlers.move();

    expect(target.win.setContentSize).toHaveBeenCalledWith(960, 540);
    expect(target.wc.setZoomFactor).toHaveBeenCalledWith(0.5);
  });

  test('detach removes only the viewport listeners', () => {
    const target = makeWindow();
    const binding = GameViewport.attach(target.win);

    binding.detach();

    expect(target.wc.removeListener).toHaveBeenCalledWith(
      'did-finish-load',
      target.handlers['did-finish-load']
    );
    expect(target.wc.removeListener).toHaveBeenCalledWith(
      'zoom-changed',
      target.handlers['zoom-changed']
    );
    expect(target.win.removeListener).toHaveBeenCalledWith('move', target.winHandlers.move);
  });

  test('does not mutate a destroyed window', () => {
    const target = makeWindow();
    target.win.isDestroyed.mockReturnValue(true);

    expect(GameViewport.enforce(target.win)).toBe(false);
    expect(target.win.setContentSize).not.toHaveBeenCalled();
    expect(target.wc.setZoomFactor).not.toHaveBeenCalled();
  });

  test('does not expose canonical automation coordinates after the window contract drifts', () => {
    const target = makeWindow();
    GameViewport.enforce(target.win);
    target.win.setContentSize(100, 100);

    expect(GameViewport.getAutomationContentSize(target.win)).toBe(null);
  });
});
