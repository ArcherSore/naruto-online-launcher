/**
 * Real Electron 11 + bundled Pepper Flash + CDP background-input smoke test.
 *
 * Run with:
 *   .\node_modules\.bin\electron.cmd tests/runtime/cdp-ppapi-background-smoke.js
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

const rootDir = path.join(__dirname, '..', '..');
const flashDir = path.join(rootDir, 'flash');
const pluginPath = path.join(flashDir, 'pepflashplayer.dll');
const manifest = JSON.parse(fs.readFileSync(path.join(flashDir, 'manifest.json'), 'utf8'));
const targetSwf = path.join(rootDir, 'tests', 'fixtures', 'flash', 'CdpClickTarget.swf');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('always-authorize-plugins');
app.commandLine.appendSwitch('allow-outdated-plugins');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-plugin-power-saver');
app.commandLine.appendSwitch('ppapi-flash-path', pluginPath);
app.commandLine.appendSwitch('ppapi-flash-version', manifest.windows_version || manifest.version);

function sendJson(result) {
  process.stdout.write('CDP_PPAPI_BACKGROUND_SMOKE ' + JSON.stringify(result) + '\n');
}

function createServer() {
  const html = Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;background:#20242b;overflow:hidden">' +
      '<script>' +
      'window.flashReady=false;window.flashClickCount=0;' +
      'window.__flashReady=function(){window.flashReady=true};' +
      'window.__flashClicked=function(count){window.flashClickCount=count};' +
      '</script>' +
      '<object id="flash-target" type="application/x-shockwave-flash" ' +
      'data="/CdpClickTarget.swf" width="320" height="200">' +
      '<param name="allowScriptAccess" value="always">' +
      '<param name="wmode" value="direct">' +
      '</object></body></html>'
  );

  return http.createServer(function (request, response) {
    if (request.url === '/CdpClickTarget.swf') {
      response.writeHead(200, {
        'Content-Type': 'application/x-shockwave-flash',
        'Content-Length': fs.statSync(targetSwf).size
      });
      fs.createReadStream(targetSwf).pipe(response);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
}

function waitForFlashReady(webContents, timeoutMs) {
  const startedAt = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      webContents
        .executeJavaScript('Boolean(window.flashReady)', true)
        .then(function (ready) {
          if (ready) {
            resolve();
          } else if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error('Flash target did not report ready'));
          } else {
            setTimeout(poll, 100);
          }
        })
        .catch(reject);
    }
    poll();
  });
}

async function getFlashDiagnostics(webContents) {
  return webContents.executeJavaScript(
    '(' +
      function () {
        const target = document.getElementById('flash-target');
        let callbackType = 'unavailable';
        let callbackError = null;
        try {
          callbackType = typeof (target && target.getClickCount);
        } catch (error) {
          callbackError = String(error);
        }
        return {
          documentReadyState: document.readyState,
          flashReady: window.flashReady,
          pluginNames: Array.from(navigator.plugins || []).map(function (plugin) {
            return plugin.name;
          }),
          targetNodeName: target && target.nodeName,
          targetCallbackType: callbackType,
          targetCallbackError: callbackError
        };
      }.toString() +
      ')()',
    true
  );
}

async function run() {
  if (!fs.existsSync(pluginPath)) throw new Error('Bundled PPAPI plugin is missing');
  if (!fs.existsSync(targetSwf)) {
    throw new Error('Flash fixture is missing; run tests/fixtures/flash/build.ps1 first');
  }

  const server = createServer();
  await new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const win = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    webPreferences: { plugins: true, contextIsolation: false }
  });

  try {
    const address = server.address();
    await win.loadURL('http://127.0.0.1:' + address.port + '/');
    try {
      await waitForFlashReady(win.webContents, 10000);
    } catch (error) {
      error.flashDiagnostics = await getFlashDiagnostics(win.webContents);
      throw error;
    }

    const cursorBefore = screen.getCursorScreenPoint();
    const focusBefore = win.isFocused();
    const beforeImage = await win.webContents.capturePage();
    const evidenceDir = path.join(app.getPath('temp'), 'shinobi-cdp-ppapi-smoke');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const beforeImagePath = path.join(evidenceDir, 'before.png');
    fs.writeFileSync(beforeImagePath, beforeImage.toPNG());
    const layout = await win.webContents.executeJavaScript(
      '(' +
        function () {
          const rect = document.getElementById('flash-target').getBoundingClientRect();
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            targetRect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };
        }.toString() +
        ')()',
      true
    );
    const cdp = win.webContents.debugger;
    cdp.attach('1.3');
    try {
      await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 160,
        y: 100,
        button: 'none',
        buttons: 0
      });
      await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 160,
        y: 100,
        button: 'left',
        buttons: 1,
        clickCount: 1
      });
      await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 160,
        y: 100,
        button: 'left',
        buttons: 0,
        clickCount: 1
      });
    } finally {
      if (cdp.isAttached()) cdp.detach();
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, 250);
    });

    const clickCount = await win.webContents.executeJavaScript('window.flashClickCount', true);
    const afterImage = await win.webContents.capturePage();
    const afterImagePath = path.join(evidenceDir, 'after.png');
    fs.writeFileSync(afterImagePath, afterImage.toPNG());
    const cursorAfter = screen.getCursorScreenPoint();
    const focusAfter = win.isFocused();
    const result = {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      flashVersion: manifest.windows_version || manifest.version,
      flashReady: true,
      layout: layout,
      beforeImagePath: beforeImagePath,
      afterImagePath: afterImagePath,
      clickCount: clickCount,
      pixelsChanged: !beforeImage.toPNG().equals(afterImage.toPNG()),
      focusBefore: focusBefore,
      focusAfter: focusAfter,
      backgroundFocusPreserved: focusBefore === false && focusAfter === false,
      cursorBefore: cursorBefore,
      cursorAfter: cursorAfter,
      cursorPreserved: cursorBefore.x === cursorAfter.x && cursorBefore.y === cursorAfter.y
    };
    result.ok =
      result.clickCount === 1 &&
      result.pixelsChanged &&
      result.backgroundFocusPreserved &&
      result.cursorPreserved;
    sendJson(result);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await new Promise(function (resolve) {
      server.close(resolve);
    });
  }
}

app
  .whenReady()
  .then(run)
  .catch(function (error) {
    sendJson({
      ok: false,
      error: error && error.stack ? error.stack : String(error),
      flashDiagnostics: error && error.flashDiagnostics ? error.flashDiagnostics : null
    });
    process.exitCode = 1;
  })
  .finally(function () {
    app.exit(process.exitCode || 0);
  });
