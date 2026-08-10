'use strict';

const { app, BrowserWindow, screen } = require('electron');
const GameViewport = require('../../src/app/GameViewport');
const { createAutomationBackend } = require('../../src/automation/backend');

const TIMEOUT_MS = 20000;
const TARGET = Object.freeze({ x: 1090, y: 640, width: 30, height: 30 });
const EXPECTED_CONTENT_POINT = Object.freeze({ x: 1097, y: 647 });
let stage = 'app-ready';
let target = null;
let viewportBinding = null;

function emit(result) {
  process.stdout.write('CDP_VIEWPORT_COORDINATE_SMOKE ' + JSON.stringify(result) + '\n');
}

async function run() {
  stage = 'create-target';
  const metrics = GameViewport.getInitialMetrics();
  target = new BrowserWindow({
    width: metrics.contentWidth,
    height: metrics.contentHeight,
    useContentSize: true,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  viewportBinding = GameViewport.attach(target);

  const html =
    '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;width:100%;height:100%;overflow:hidden}' +
    '#target{position:absolute;left:' + TARGET.x + 'px;top:' + TARGET.y + 'px;' +
    'width:' + TARGET.width + 'px;height:' + TARGET.height + 'px;background:#f40}</style>' +
    '<div id="target"></div><script>window.__events=[];' +
    'document.getElementById("target").addEventListener("click",function(event){' +
    'window.__events.push({x:event.clientX,y:event.clientY});});</script>';
  stage = 'load-target';
  await target.loadURL('data:text/html,' + encodeURIComponent(html));
  GameViewport.enforce(target);

  const canonicalSize = GameViewport.getAutomationContentSize(target);
  const backend = createAutomationBackend({
    targetProvider: function () {
      return {
        window: target,
        webContents: target.webContents,
        contentSize: GameViewport.getAutomationContentSize(target)
      };
    }
  });

  stage = 'capture';
  const capture = await backend.capture('p_viewportsmoke');
  const windowSize = target.getContentSize();
  const pageMetrics = await target.webContents.executeJavaScript(
    '({width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio})',
    true
  );

  stage = 'click';
  const focusBefore = target.isFocused();
  const foregroundBefore = BrowserWindow.getFocusedWindow();
  const cursorBefore = screen.getCursorScreenPoint();
  const click = await backend.click('p_viewportsmoke', {
    normalizedX: (EXPECTED_CONTENT_POINT.x + 0.5) / GameViewport.WIDTH,
    normalizedY: (EXPECTED_CONTENT_POINT.y + 0.5) / GameViewport.HEIGHT
  });
  const events = await target.webContents.executeJavaScript('window.__events.slice()', true);
  const cursorAfter = screen.getCursorScreenPoint();
  const event = events[0] || null;

  const result = {
    electron: process.versions.electron,
    displayScaleFactor: metrics.scaleFactor,
    zoomFactor: target.webContents.getZoomFactor(),
    windowSize: windowSize,
    pageSize: [pageMetrics.width, pageMetrics.height],
    pageDpr: pageMetrics.dpr,
    imageSize: capture.imageSize,
    contentSize: canonicalSize,
    contentPoint: click.contentPoint,
    event: event,
    focusPreserved: focusBefore === false && target.isFocused() === false,
    foregroundPreserved: foregroundBefore === BrowserWindow.getFocusedWindow(),
    cursorPreserved: cursorBefore.x === cursorAfter.x && cursorBefore.y === cursorAfter.y
  };
  result.ok =
    windowSize[0] === metrics.contentWidth &&
    windowSize[1] === metrics.contentHeight &&
    pageMetrics.width === GameViewport.WIDTH &&
    pageMetrics.height === GameViewport.HEIGHT &&
    capture.imageSize.width === GameViewport.WIDTH &&
    capture.imageSize.height === GameViewport.HEIGHT &&
    canonicalSize && canonicalSize.width === GameViewport.WIDTH &&
    canonicalSize.height === GameViewport.HEIGHT &&
    click.contentPoint.x === EXPECTED_CONTENT_POINT.x &&
    click.contentPoint.y === EXPECTED_CONTENT_POINT.y &&
    events.length === 1 &&
    event.x === EXPECTED_CONTENT_POINT.x &&
    event.y === EXPECTED_CONTENT_POINT.y &&
    result.focusPreserved &&
    result.foregroundPreserved &&
    result.cursorPreserved;
  emit(result);
  app.exit(result.ok ? 0 : 1);
}

const timeout = setTimeout(function () {
  emit({ ok: false, error: 'timeout', stage: stage });
  app.exit(1);
}, TIMEOUT_MS);

app.whenReady().then(run).catch(function (error) {
  emit({
    ok: false,
    error: error && error.message ? error.message : 'runtime-failed',
    stage: stage
  });
  app.exit(1);
}).finally(function () {
  clearTimeout(timeout);
  if (viewportBinding) viewportBinding.detach();
  if (target && !target.isDestroyed()) target.destroy();
});
