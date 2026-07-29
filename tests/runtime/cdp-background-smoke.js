/**
 * Electron 11 runtime smoke test for focus-free CDP mouse input.
 *
 * This intentionally uses a hidden local page instead of the Tencent game. It
 * proves that Chromium 87 accepts Input.dispatchMouseEvent while the target
 * BrowserWindow is not focused and that the OS cursor remains unchanged.
 */

'use strict';

const { app, BrowserWindow, screen } = require('electron');

const PROTOCOL_VERSION = '1.3';
const TIMEOUT_MS = 10000;

function samePoint(left, right) {
  return !!(left && right && left.x === right.x && left.y === right.y);
}

function emitResult(result) {
  process.stdout.write('CDP_BACKGROUND_SMOKE ' + JSON.stringify(result) + '\n');
}

async function run() {
  const target = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<button id="target" style="position:absolute;left:20px;top:20px;width:160px;height:100px">POC</button>' +
    '<script>window.__clickCount=0;document.getElementById("target").addEventListener("click",function(){' +
    'window.__clickCount+=1;document.body.dataset.clicked=String(window.__clickCount);});</script>';

  await target.loadURL('data:text/html,' + encodeURIComponent(html));

  const focusBefore = target.isFocused();
  const cursorBefore = screen.getCursorScreenPoint();
  const cdp = target.webContents.debugger;
  cdp.attach(PROTOCOL_VERSION);
  try {
    await cdp.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 80,
      y: 60,
      button: 'none',
      buttons: 0
    });
    await cdp.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 80,
      y: 60,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await cdp.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 80,
      y: 60,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
  } finally {
    if (cdp.isAttached()) cdp.detach();
  }

  const clickCount = await target.webContents.executeJavaScript('window.__clickCount');
  const focusAfter = target.isFocused();
  const cursorAfter = screen.getCursorScreenPoint();
  const result = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    clickCount: clickCount,
    focusBefore: focusBefore,
    focusAfter: focusAfter,
    backgroundFocusPreserved: focusBefore === false && focusAfter === false,
    cursorBefore: cursorBefore,
    cursorAfter: cursorAfter,
    cursorPreserved: samePoint(cursorBefore, cursorAfter)
  };
  result.ok =
    result.clickCount === 1 && result.backgroundFocusPreserved === true && result.cursorPreserved;
  emitResult(result);
  target.destroy();
  app.exit(result.ok ? 0 : 1);
}

const timeout = setTimeout(function () {
  emitResult({ ok: false, error: 'timeout' });
  app.exit(1);
}, TIMEOUT_MS);

app
  .whenReady()
  .then(
    function () {
      return run();
    },
    function (error) {
      emitResult({ ok: false, error: error && error.message ? error.message : 'app-ready-failed' });
      app.exit(1);
    }
  )
  .catch(function (error) {
    emitResult({ ok: false, error: error && error.message ? error.message : 'runtime-failed' });
    app.exit(1);
  })
  .finally(function () {
    clearTimeout(timeout);
  });
