'use strict';

const { app, BrowserWindow, screen } = require('electron');
const { createRuntime } = require('./automation-runtime-harness');

const TIMEOUT_MS = 20000;

function samePoint(left, right) {
  return !!(left && right && left.x === right.x && left.y === right.y);
}

function emit(result) {
  process.stdout.write('CDP_BACKGROUND_SMOKE ' + JSON.stringify(result) + '\n');
}

async function run() {
  const target = new BrowserWindow({
    width: 400,
    height: 240,
    useContentSize: true,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const html =
    '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;width:100%;height:100%;overflow:hidden}' +
    'button{position:absolute;top:30%;width:25%;height:40%}' +
    '#first{left:8%}#second{right:8%}</style>' +
    '<button id="first">FIRST</button><button id="second">SECOND</button>' +
    '<script>window.__events=[];["first","second"].forEach(function(id){' +
    'document.getElementById(id).addEventListener("click",function(event){' +
    'window.__events.push({id:id,at:Date.now(),x:event.clientX,y:event.clientY});});});</script>';
  await target.loadURL('data:text/html,' + encodeURIComponent(html));

  const runtime = createRuntime({ profileId: 'p_runtimechromium', window: target });
  const focusBefore = target.isFocused();
  const foregroundBefore = BrowserWindow.getFocusedWindow();
  const cursorBefore = screen.getCursorScreenPoint();
  const firstSize = target.getContentSize();
  setTimeout(function () {
    if (!target.isDestroyed()) target.setContentSize(500, 300);
  }, 250);
  await runtime.runDemo([
    { order: 1, normalizedX: 0.205, normalizedY: 0.5 },
    { order: 2, normalizedX: 0.795, normalizedY: 0.5 }
  ]);
  const events = await target.webContents.executeJavaScript('window.__events.slice()', true);
  const focusAfter = target.isFocused();
  const foregroundAfter = BrowserWindow.getFocusedWindow();
  const cursorAfter = screen.getCursorScreenPoint();
  const secondSize = target.getContentSize();
  const result = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    targetOrder: events.map(function (event) { return event.id; }),
    clickCount: events.length,
    intervalMs: events.length === 2 ? events[1].at - events[0].at : null,
    firstSize: firstSize,
    secondSize: secondSize,
    focusBefore: focusBefore,
    focusAfter: focusAfter,
    focusPreserved: focusBefore === false && focusAfter === false,
    foregroundPreserved: foregroundBefore === foregroundAfter,
    cursorBefore: cursorBefore,
    cursorAfter: cursorAfter,
    cursorPreserved: samePoint(cursorBefore, cursorAfter)
  };
  result.ok =
    result.clickCount === 2 &&
    result.targetOrder.join(',') === 'first,second' &&
    result.intervalMs >= 850 &&
    result.intervalMs <= 1500 &&
    result.firstSize[0] !== result.secondSize[0] &&
    result.focusPreserved &&
    result.foregroundPreserved &&
    result.cursorPreserved;
  emit(result);
  runtime.cleanup();
  target.destroy();
  app.exit(result.ok ? 0 : 1);
}

const timeout = setTimeout(function () {
  emit({ ok: false, error: 'timeout' });
  app.exit(1);
}, TIMEOUT_MS);

app.whenReady().then(run).catch(function (error) {
  emit({ ok: false, error: error && error.message ? error.message : 'runtime-failed' });
  app.exit(1);
}).finally(function () {
  clearTimeout(timeout);
});
