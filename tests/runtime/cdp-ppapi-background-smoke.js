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

process.env.SHINOBI_DEBUG = '1';

const rootDir = path.join(__dirname, '..', '..');
const flashDir = path.join(rootDir, 'flash');
const pluginPath = path.join(flashDir, 'pepflashplayer.dll');
const manifest = JSON.parse(fs.readFileSync(path.join(flashDir, 'manifest.json'), 'utf8'));
const targetSwf = path.join(rootDir, 'tests', 'fixtures', 'flash', 'CdpClickTarget.swf');
const AutomationDemo = require(path.join(rootDir, 'src', 'app', 'AutomationDemo'));
const DemoCoordinateStore = require(path.join(rootDir, 'src', 'app', 'DemoCoordinateStore'));
const DemoClickScript = require(path.join(rootDir, 'automation-scripts', 'demo-click'));

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
      'window.flashReady=false;window.flashClickCount=0;window.flashClickEvents=[];' +
      'window.__flashReady=function(){window.flashReady=true};' +
      'window.__flashClicked=function(count,targetId,stageX,stageY,flashAt){' +
      'window.flashClickCount=count;' +
      'window.flashClickEvents.push({' +
      'count:count,targetId:targetId,stageX:stageX,stageY:stageY,' +
      'flashAt:flashAt,receivedAt:Date.now()});' +
      '};' +
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

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function imagePointForContent(contentPoint, capture) {
  return {
    x: (contentPoint.x * capture.imageSize.width) / capture.contentSize.width,
    y: (contentPoint.y * capture.imageSize.height) / capture.contentSize.height
  };
}

function createRestrictedDemoApi(win, profileId, storeOptions) {
  return Object.freeze({
    loadCoordinates: function () {
      return DemoCoordinateStore.load(profileId, storeOptions);
    },
    getContentSize: function () {
      return Promise.resolve(AutomationDemo.getContentSize(win));
    },
    clickContent: function (contentX, contentY) {
      return AutomationDemo.clickContent(win, contentX, contentY, {
        profileId: profileId,
        settleDelayMs: 0
      });
    },
    sleep: function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    },
    now: function () {
      return Date.now();
    }
  });
}

async function recordContentPoints(profileId, capture, contentPoints, storeOptions) {
  await DemoCoordinateStore.reset(profileId, storeOptions);
  for (let index = 0; index < contentPoints.length; index += 1) {
    const imagePoint = imagePointForContent(contentPoints[index], capture);
    const normalized = AutomationDemo.normalizeImagePoint(
      imagePoint.x,
      imagePoint.y,
      capture.imageSize,
      capture.contentSize
    );
    await DemoCoordinateStore.append(profileId, normalized, storeOptions);
  }
  return DemoCoordinateStore.load(profileId, storeOptions);
}

async function readFlashEvents(webContents) {
  return webContents.executeJavaScript('window.flashClickEvents.slice()', true);
}

async function resetFlashTarget(webContents) {
  await webContents.executeJavaScript(
    'document.getElementById("flash-target").resetClickCount();' +
      'window.flashClickCount=0;window.flashClickEvents=[];',
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

    const profileId = 'runtime-ppapi';
    const storeOptions = {
      baseDir: path.join(app.getPath('temp'), 'shinobi-demo-click-runtime')
    };
    const cursorBefore = screen.getCursorScreenPoint();
    const focusBefore = win.isFocused();
    const capture = await AutomationDemo.capture(win, profileId);
    const evidenceDir = path.join(app.getPath('temp'), 'shinobi-cdp-ppapi-smoke');
    fs.mkdirSync(evidenceDir, { recursive: true });
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

    const firstPoint = { x: 75, y: 95 };
    const secondPoint = { x: 225, y: 95 };
    const api = createRestrictedDemoApi(win, profileId, storeOptions);

    const onePointRecording = await recordContentPoints(
      profileId,
      capture,
      [firstPoint],
      storeOptions
    );
    const onePointRun = await DemoClickScript.run(api);
    const onePointEvents = await readFlashEvents(win.webContents);

    assertCondition(onePointRecording.points.length === 1, 'one-point JSON was not saved');
    assertCondition(onePointRun.pointCount === 1, 'one-point script did not run once');
    assertCondition(
      onePointEvents.length === 1 && onePointEvents[0].targetId === 'first',
      'one-point run did not trigger the first AS3 target'
    );
    assertCondition(
      onePointRun.clicks[0].inputPoint.x === firstPoint.x &&
        onePointRun.clicks[0].inputPoint.y === firstPoint.y,
      'one-point high-DPI coordinate mapping failed'
    );

    await resetFlashTarget(win.webContents);
    const twoPointRecording = await recordContentPoints(
      profileId,
      capture,
      [firstPoint, secondPoint],
      storeOptions
    );
    const twoPointRun = await DemoClickScript.run(api);
    const twoPointEvents = await readFlashEvents(win.webContents);
    const dispatchIntervalMs =
      twoPointRun.clicks[1].dispatchedAt - twoPointRun.clicks[0].dispatchedAt;
    const flashIntervalMs = twoPointEvents[1].receivedAt - twoPointEvents[0].receivedAt;

    assertCondition(twoPointRecording.points.length === 2, 'two-point JSON was not saved');
    assertCondition(twoPointRun.pointCount === 2, 'two-point script did not run twice');
    assertCondition(
      twoPointEvents.length === 2 &&
        twoPointEvents[0].targetId === 'first' &&
        twoPointEvents[1].targetId === 'second',
      'two-point run did not preserve AS3 target order'
    );
    assertCondition(
      dispatchIntervalMs >= 900 && dispatchIntervalMs <= 1200,
      'CDP dispatch interval was not approximately 1000 ms: ' + dispatchIntervalMs
    );
    assertCondition(
      flashIntervalMs >= 900 && flashIntervalMs <= 1200,
      'AS3 receive interval was not approximately 1000 ms: ' + flashIntervalMs
    );
    assertCondition(
      twoPointRun.clicks[1].inputPoint.x === secondPoint.x &&
        twoPointRun.clicks[1].inputPoint.y === secondPoint.y,
      'two-point high-DPI coordinate mapping failed'
    );

    const afterImage = await win.webContents.capturePage();
    const afterImagePath = path.join(evidenceDir, 'after.png');
    fs.writeFileSync(afterImagePath, afterImage.toPNG());
    const cursorAfter = screen.getCursorScreenPoint();
    const focusAfter = win.isFocused();
    const jsonFilePath = DemoCoordinateStore.getFilePath(profileId, storeOptions);
    const result = {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      flashVersion: manifest.windows_version || manifest.version,
      flashReady: true,
      layout: layout,
      afterImagePath: afterImagePath,
      jsonFilePath: jsonFilePath,
      jsonPointCount: JSON.parse(fs.readFileSync(jsonFilePath, 'utf8')).points.length,
      onePoint: {
        clickCount: onePointEvents.length,
        targetOrder: onePointEvents.map(function (event) {
          return event.targetId;
        }),
        inputPoints: onePointRun.clicks.map(function (click) {
          return click.inputPoint;
        })
      },
      twoPoints: {
        clickCount: twoPointEvents.length,
        targetOrder: twoPointEvents.map(function (event) {
          return event.targetId;
        }),
        inputPoints: twoPointRun.clicks.map(function (click) {
          return click.inputPoint;
        }),
        dispatchIntervalMs: dispatchIntervalMs,
        flashIntervalMs: flashIntervalMs
      },
      focusBefore: focusBefore,
      focusAfter: focusAfter,
      backgroundFocusPreserved: focusBefore === false && focusAfter === false,
      cursorBefore: cursorBefore,
      cursorAfter: cursorAfter,
      cursorPreserved: cursorBefore.x === cursorAfter.x && cursorBefore.y === cursorAfter.y
    };
    result.ok =
      result.onePoint.clickCount === 1 &&
      result.twoPoints.clickCount === 2 &&
      result.twoPoints.targetOrder.join(',') === 'first,second' &&
      result.twoPoints.dispatchIntervalMs >= 900 &&
      result.twoPoints.dispatchIntervalMs <= 1200 &&
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
