/**
 * 游戏窗口统一画面合同。
 *
 * BrowserWindow 的尺寸单位是 DIP（逻辑像素）。本模块只对游戏窗口按显示器
 * DPI 做反向补偿，使物理内容、页面坐标和截图始终统一为 1920×1080，且
 * renderer 的有效 devicePixelRatio 为 1。启动器主窗口不使用本模块。
 */

'use strict';

const { screen } = require('electron');

const WIDTH = 1920;
const HEIGHT = 1080;
const MAX_SIZE_CORRECTIONS = 3;

function normalizeScaleFactor(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function readDisplayScaleFactor(win) {
  try {
    if (
      win &&
      typeof win.getBounds === 'function' &&
      screen &&
      typeof screen.getDisplayMatching === 'function'
    ) {
      const display = screen.getDisplayMatching(win.getBounds());
      if (display) return normalizeScaleFactor(display.scaleFactor);
    }
    if (screen && typeof screen.getPrimaryDisplay === 'function') {
      const primary = screen.getPrimaryDisplay();
      if (primary) return normalizeScaleFactor(primary.scaleFactor);
    }
  } catch (_) {
    // Electron 尚未 ready 或显示器信息暂不可用时，安全回退到 100%。
  }
  return 1;
}

function createMetrics(scaleFactor) {
  const scale = normalizeScaleFactor(scaleFactor);
  return Object.freeze({
    scaleFactor: scale,
    contentWidth: Math.max(1, Math.round(WIDTH / scale)),
    contentHeight: Math.max(1, Math.round(HEIGHT / scale)),
    zoomFactor: 1 / scale
  });
}

function getMetrics(win) {
  return createMetrics(readDisplayScaleFactor(win));
}

function getInitialMetrics() {
  return getMetrics(null);
}

function isAvailable(win) {
  return !!(
    win &&
    typeof win.isDestroyed === 'function' &&
    !win.isDestroyed() &&
    win.webContents &&
    (typeof win.webContents.isDestroyed !== 'function' || !win.webContents.isDestroyed())
  );
}

function setExactContentSize(win, width, height) {
  let requestedWidth = width;
  let requestedHeight = height;

  for (let attempt = 0; attempt < MAX_SIZE_CORRECTIONS; attempt++) {
    win.setContentSize(requestedWidth, requestedHeight);
    if (typeof win.getContentSize !== 'function') return;

    const actual = win.getContentSize();
    if (
      !Array.isArray(actual) ||
      !Number.isFinite(actual[0]) ||
      !Number.isFinite(actual[1])
    ) {
      return false;
    }
    if (actual[0] === width && actual[1] === height) return true;

    requestedWidth += width - actual[0];
    requestedHeight += height - actual[1];
  }
  return false;
}

function enforce(win) {
  if (!isAvailable(win)) return false;

  try {
    const metrics = getMetrics(win);
    if (!setExactContentSize(win, metrics.contentWidth, metrics.contentHeight)) return false;
    win.webContents.setZoomFactor(metrics.zoomFactor);
    return true;
  } catch (_) {
    return false;
  }
}

function getAutomationContentSize(win) {
  if (!isAvailable(win)) return null;
  try {
    const metrics = getMetrics(win);
    const actual = win.getContentSize();
    if (
      !Array.isArray(actual) ||
      actual[0] !== metrics.contentWidth ||
      actual[1] !== metrics.contentHeight
    ) {
      return null;
    }
    if (
      typeof win.webContents.getZoomFactor === 'function' &&
      Math.abs(win.webContents.getZoomFactor() - metrics.zoomFactor) > 0.000001
    ) {
      return null;
    }
    return Object.freeze({ width: WIDTH, height: HEIGHT });
  } catch (_) {
    return null;
  }
}

function attach(win) {
  if (!win || !win.webContents) throw new TypeError('window is required');
  const wc = win.webContents;
  let lastScaleFactor = null;

  function apply() {
    const metrics = getMetrics(win);
    lastScaleFactor = metrics.scaleFactor;
    return enforce(win);
  }

  function onLoadFinished() {
    apply();
  }

  function onZoomChanged(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    apply();
  }

  function onMove() {
    const scaleFactor = getMetrics(win).scaleFactor;
    if (scaleFactor !== lastScaleFactor) apply();
  }

  apply();
  wc.on('did-finish-load', onLoadFinished);
  wc.on('zoom-changed', onZoomChanged);
  if (typeof win.on === 'function') win.on('move', onMove);

  return {
    detach: function () {
      if (typeof wc.removeListener === 'function') {
        wc.removeListener('did-finish-load', onLoadFinished);
        wc.removeListener('zoom-changed', onZoomChanged);
      }
      if (typeof win.removeListener === 'function') win.removeListener('move', onMove);
    }
  };
}

module.exports = {
  WIDTH: WIDTH,
  HEIGHT: HEIGHT,
  createMetrics: createMetrics,
  getInitialMetrics: getInitialMetrics,
  getMetrics: getMetrics,
  getAutomationContentSize: getAutomationContentSize,
  enforce: enforce,
  attach: attach
};
