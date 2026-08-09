'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

const rootDir = path.join(__dirname, '..', '..');
const flashDir = path.join(rootDir, 'flash');
const pluginPath = path.join(flashDir, 'pepflashplayer.dll');
const flashManifest = JSON.parse(fs.readFileSync(path.join(flashDir, 'manifest.json'), 'utf8'));
const targetSwf = path.join(rootDir, 'tests', 'fixtures', 'flash', 'CdpClickTarget.swf');
let finalExitCode = 1;

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('always-authorize-plugins');
app.commandLine.appendSwitch('allow-outdated-plugins');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-plugin-power-saver');
app.commandLine.appendSwitch('force-device-scale-factor', '1.25');
app.commandLine.appendSwitch('ppapi-flash-path', pluginPath);
app.commandLine.appendSwitch(
  'ppapi-flash-version',
  flashManifest.windows_version || flashManifest.version
);

function emit(result) {
  process.stdout.write('CDP_PPAPI_BACKGROUND_SMOKE ' + JSON.stringify(result) + '\n');
}

function createServer() {
  const html = Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;background:#20242b;overflow:hidden">' +
      '<script>window.flashReady=false;window.flashClickEvents=[];' +
      'window.__flashReady=function(){window.flashReady=true};' +
      'window.__flashClicked=function(count,targetId,stageX,stageY,flashAt){' +
      'window.flashClickEvents.push({count:count,targetId:targetId,stageX:stageX,stageY:stageY,' +
      'flashAt:flashAt,receivedAt:Date.now()});};</script>' +
      '<object id="flash-target" type="application/x-shockwave-flash" ' +
      'data="/CdpClickTarget.swf" width="320" height="200">' +
      '<param name="allowScriptAccess" value="always"><param name="wmode" value="direct">' +
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

function waitForFlash(webContents, timeoutMs) {
  const startedAt = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      webContents.executeJavaScript('Boolean(window.flashReady)', true).then(function (ready) {
        if (ready) resolve();
        else if (Date.now() - startedAt >= timeoutMs) reject(new Error('flash-not-ready'));
        else setTimeout(poll, 100);
      }, reject);
    }
    poll();
  });
}

async function run() {
  if (!fs.existsSync(pluginPath)) throw new Error('bundled-ppapi-missing');
  if (!fs.existsSync(targetSwf)) throw new Error('flash-fixture-missing');
  const { createRuntime } = require('./automation-runtime-harness');
  const server = createServer();
  await new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const target = new BrowserWindow({
    width: 320,
    height: 200,
    useContentSize: true,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { plugins: true, contextIsolation: false, backgroundThrottling: false }
  });
  let runtime;
  try {
    await target.loadURL('http://127.0.0.1:' + server.address().port + '/');
    await waitForFlash(target.webContents, 10000);
    runtime = createRuntime({ profileId: 'p_runtimeppapi', window: target, timeoutMs: 20000 });
    const size = target.getContentSize();
    const focusBefore = target.isFocused();
    const foregroundBefore = BrowserWindow.getFocusedWindow();
    const cursorBefore = screen.getCursorScreenPoint();
    await runtime.runDemo([
      { order: 1, normalizedX: 75 / size[0], normalizedY: 95 / size[1] },
      { order: 2, normalizedX: 225 / size[0], normalizedY: 95 / size[1] }
    ]);
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
    const events = await target.webContents.executeJavaScript('window.flashClickEvents.slice()', true);
    const focusAfter = target.isFocused();
    const foregroundAfter = BrowserWindow.getFocusedWindow();
    const cursorAfter = screen.getCursorScreenPoint();
    const result = {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      flashVersion: flashManifest.windows_version || flashManifest.version,
      deviceScaleFactor: screen.getPrimaryDisplay().scaleFactor,
      clickCount: events.length,
      targetOrder: events.map(function (event) { return event.targetId; }),
      intervalMs: events.length === 2 ? events[1].receivedAt - events[0].receivedAt : null,
      focusPreserved: focusBefore === false && focusAfter === false,
      foregroundPreserved: foregroundBefore === foregroundAfter,
      cursorPreserved: cursorBefore.x === cursorAfter.x && cursorBefore.y === cursorAfter.y
    };
    result.ok = result.clickCount === 2 && result.targetOrder.join(',') === 'first,second' &&
      result.intervalMs >= 850 && result.intervalMs <= 1500 && result.focusPreserved &&
      result.foregroundPreserved && result.cursorPreserved;
    emit(result);
    finalExitCode = result.ok ? 0 : 1;
  } finally {
    if (runtime) runtime.cleanup();
    if (!target.isDestroyed()) target.destroy();
    await new Promise(function (resolve) { server.close(resolve); });
  }
}

app.whenReady().then(run).catch(function (error) {
  emit({ ok: false, error: error && error.message ? error.message : 'runtime-failed' });
  finalExitCode = 1;
}).finally(function () {
  app.exit(finalExitCode);
});
