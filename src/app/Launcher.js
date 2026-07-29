/**
 * 腾讯国服游戏窗口编排与 Profile 窗口 registry。
 */

'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');
const logger = require('../utils/logger');
const store = require('../profiles/store');
const partition = require('../profiles/partition');
const SessionLifecycle = require('./SessionLifecycle');
const TencentLaunchFlow = require('./TencentLaunchFlow');
const AutomationDemo = require('./AutomationDemo');
const DemoCoordinateStore = require('./DemoCoordinateStore');
const DemoClickScript = require('../../automation-scripts/demo-click');
const Auditor = require('./Auditor');
const KeyboardShortcuts = require('../ui/manager/KeyboardShortcuts');
const StateBroadcaster = require('../ui/manager/StateBroadcaster');
const urlConfig = require('../config/urls');

const WINDOW_TITLE = 'Naruto Online';
const gameWindows = new Map();
let activeRecoveryProfileId = null;

function getGameUrl() {
  return urlConfig.getGameUrl();
}

function hasOpenWindows() {
  for (const entry of gameWindows.values()) {
    if (entry.window && !entry.window.isDestroyed()) return true;
  }
  return false;
}

function resolveIconPath() {
  const fs = require('fs');
  const packaged = path.join(process.resourcesPath, 'icon.png');
  try {
    if (fs.existsSync(packaged)) return packaged;
  } catch (_) {
    // 使用开发资产回退。
  }
  return path.join(__dirname, '..', '..', 'assets', 'icon.png');
}

function loadingPage(profileName) {
  return (
    'data:text/html,' +
    encodeURIComponent(
      '<html><head><meta charset="utf-8"><style>' +
        '*{margin:0;padding:0;box-sizing:border-box}' +
        'body{background:#0f0f14;display:flex;align-items:center;justify-content:center;height:100vh;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;flex-direction:column;color:#FF8C00}' +
        '.spin{width:34px;height:34px;border:3px solid rgba(255,140,0,.18);border-top-color:#FF8C00;' +
        'border-radius:50%;animation:sp 1s linear infinite;margin-bottom:18px}' +
        '@keyframes sp{to{transform:rotate(360deg)}}' +
        '.t{font-size:15px;font-weight:600;letter-spacing:.2px;color:#f0ede6}' +
        '</style></head><body><div class="spin"></div><div class="t">正在加载 ' +
        String(profileName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
        '</div></body></html>'
    )
  );
}

function launchProfile(profileId, onOpened, onClosed) {
  const profile = store.get(profileId);
  if (!profile) {
    logger.error('Launcher: profile not found', {
      profileId: profileId,
      event: 'profile-not-found'
    });
    return;
  }

  if (gameWindows.has(profileId)) {
    const existing = gameWindows.get(profileId);
    if (existing.window && !existing.window.isDestroyed()) {
      activeRecoveryProfileId = profileId;
      existing.window.show();
      existing.window.focus();
      if (onOpened) onOpened();
      return;
    }
  }

  const partitionName = partition.getPartitionName(profile);
  activeRecoveryProfileId = profileId;
  const launcherUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36 NarutoOnlineLauncher/1.0';
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    icon: resolveIconPath(),
    title: WINDOW_TITLE + ' — ' + profile.name,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      plugins: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      partition: partitionName,
      preload: path.join(__dirname, '..', 'preload.js'),
      userAgent: launcherUserAgent
    }
  });

  const session = win.webContents.session;
  session.setUserAgent(launcherUserAgent);
  win.setMenuBarVisibility(false);
  win.setTitle(WINDOW_TITLE + ' — ' + profile.name);
  win.on('page-title-updated', function (event) {
    event.preventDefault();
    win.setTitle(WINDOW_TITLE + ' — ' + profile.name);
  });

  const auditor = Auditor.create(profileId);
  const launchFlow = TencentLaunchFlow.createTencentLaunchFlow({
    profileId: profileId,
    window: win,
    session: session,
    partitionName: partitionName,
    selectorUrl: urlConfig.getSelectorUrl(),
    onStateChange: StateBroadcaster.pushFlowState,
    auditor: auditor
  });
  const entry = {
    window: win,
    partitionName: partitionName,
    launchFlow: launchFlow,
    auditor: auditor,
    lifecycle: null,
    failLoadTimer: null,
    closeTimer: null,
    automationDemoCaptureSize: null,
    automationDemoCaptureContentSize: null,
    flashProbeConnection: null,
    flashProbeHello: null
  };
  gameWindows.set(profileId, entry);

  entry.lifecycle = SessionLifecycle.attach(win, {
    profileId: profileId,
    profile: profile,
    entry: entry,
    ses: session,
    auditor: auditor,
    onOpened: onOpened,
    onReady: function () {
      launchFlow.start();
    },
    onLoadFailed: function (details) {
      launchFlow.handleLoadFailure(details);
    },
    onRendererGone: function (details) {
      launchFlow.handleRendererGone(details);
    },
    onUnresponsive: function () {
      launchFlow.handleUnresponsive();
    },
    onResponsive: function () {
      launchFlow.handleResponsive();
    },
    onClosed: function () {
      launchFlow.close();
      if (entry.flashProbeConnection) {
        entry.flashProbeConnection.close();
        entry.flashProbeConnection = null;
        entry.flashProbeHello = null;
      }
      try {
        auditor.destroy();
      } catch (error) {
        logger.debug('Auditor: destroy failed - ' + error.message);
      }
      gameWindows.delete(profileId);
      if (activeRecoveryProfileId === profileId) activeRecoveryProfileId = null;
      if (onClosed) onClosed();
    }
  });

  KeyboardShortcuts.attach(win, profile.name, function () {
    launchFlow.reloadCurrentRole();
  });
  win.loadURL(loadingPage(profile.name));
}

function focusProfile(profileId) {
  if (!gameWindows.has(profileId)) return;
  const entry = gameWindows.get(profileId);
  if (entry.window && !entry.window.isDestroyed()) {
    activeRecoveryProfileId = profileId;
    entry.window.show();
    entry.window.focus();
  }
}

function closeProfile(profileId) {
  if (!gameWindows.has(profileId)) return;
  const entry = gameWindows.get(profileId);
  if (entry.window && !entry.window.isDestroyed()) entry.window.close();
}

function refreshProfile(profileId) {
  if (!gameWindows.has(profileId)) return false;
  const entry = gameWindows.get(profileId);
  if (
    !entry ||
    !entry.window ||
    entry.window.isDestroyed() ||
    !entry.launchFlow ||
    typeof entry.launchFlow.reloadCurrentRole !== 'function'
  ) {
    return false;
  }
  return entry.launchFlow.reloadCurrentRole() === true;
}

function isProfileOpen(profileId) {
  if (!gameWindows.has(profileId)) return false;
  const entry = gameWindows.get(profileId);
  return !!(entry && entry.window && !entry.window.isDestroyed());
}

function getWebContents(profileId) {
  if (!gameWindows.has(profileId)) return null;
  const entry = gameWindows.get(profileId);
  if (!entry || !entry.window || entry.window.isDestroyed()) return null;
  return entry.window.webContents;
}

function findGameEntryForSender(sender) {
  let match = null;
  gameWindows.forEach(function (entry, profileId) {
    if (
      !match &&
      entry &&
      entry.window &&
      !entry.window.isDestroyed() &&
      entry.window.webContents === sender
    ) {
      match = { profileId: profileId, entry: entry };
    }
  });
  return match;
}

function findGameEntryForProfile(profileId) {
  if (typeof profileId !== 'string' || !gameWindows.has(profileId)) return null;
  const entry = gameWindows.get(profileId);
  if (!entry || !entry.window || entry.window.isDestroyed()) return null;
  return { profileId: profileId, entry: entry };
}

async function captureAutomationForMatch(match) {
  if (!AutomationDemo.isEnabled()) return { ok: false, error: 'debug-disabled' };
  if (!match) return { ok: false, error: 'profile-mismatch' };

  try {
    const result = await AutomationDemo.capture(match.entry.window, match.profileId);
    match.entry.automationDemoCaptureSize = result.imageSize;
    match.entry.automationDemoCaptureContentSize = result.contentSize;
    return {
      ok: true,
      filePath: result.filePath,
      imageSize: result.imageSize,
      contentSize: result.contentSize
    };
  } catch (error) {
    return { ok: false, error: error.code || 'capture-failed' };
  }
}

async function clickAutomationForMatch(match, imageX, imageY) {
  if (!AutomationDemo.isEnabled()) return { ok: false, error: 'debug-disabled' };
  if (!match) return { ok: false, error: 'profile-mismatch' };
  if (!match.entry.automationDemoCaptureSize) {
    return { ok: false, error: 'capture-required' };
  }

  try {
    const result = await AutomationDemo.click(
      match.entry.window,
      match.entry.automationDemoCaptureSize,
      imageX,
      imageY,
      { profileId: match.profileId }
    );
    return {
      ok: true,
      backend: result.backend,
      protocolVersion: result.protocolVersion,
      imagePoint: result.imagePoint,
      inputPoint: result.inputPoint,
      imageSize: result.imageSize,
      contentSize: result.contentSize,
      evidence: result.evidence
    };
  } catch (error) {
    return { ok: false, error: error.code || 'click-failed' };
  }
}

function captureAutomationForSender(sender) {
  return captureAutomationForMatch(findGameEntryForSender(sender));
}

function clickAutomationForSender(sender, imageX, imageY) {
  return clickAutomationForMatch(findGameEntryForSender(sender), imageX, imageY);
}

function captureAutomationForProfile(profileId) {
  return captureAutomationForMatch(findGameEntryForProfile(profileId));
}

function clickAutomationForProfile(profileId, imageX, imageY) {
  return clickAutomationForMatch(findGameEntryForProfile(profileId), imageX, imageY);
}

async function beginAutomationRecordingForProfile(profileId) {
  const match = findGameEntryForProfile(profileId);
  const captureResult = await captureAutomationForMatch(match);
  if (!captureResult.ok) return captureResult;

  try {
    const recording = await DemoCoordinateStore.reset(profileId);
    return Object.assign({}, captureResult, { recording: recording });
  } catch (error) {
    return { ok: false, error: error.code || 'recording-reset-failed' };
  }
}

async function recordAutomationPointForProfile(profileId, imageX, imageY) {
  if (!AutomationDemo.isEnabled()) return { ok: false, error: 'debug-disabled' };
  const match = findGameEntryForProfile(profileId);
  if (!match) return { ok: false, error: 'profile-mismatch' };
  if (!match.entry.automationDemoCaptureSize || !match.entry.automationDemoCaptureContentSize) {
    return { ok: false, error: 'capture-required' };
  }

  try {
    const normalized = AutomationDemo.normalizeImagePoint(
      imageX,
      imageY,
      match.entry.automationDemoCaptureSize,
      match.entry.automationDemoCaptureContentSize
    );
    const recording = await DemoCoordinateStore.append(profileId, normalized);
    return {
      ok: true,
      recording: recording,
      point: recording.points[recording.points.length - 1]
    };
  } catch (error) {
    return { ok: false, error: error.code || 'record-point-failed' };
  }
}

async function getAutomationRecordingForProfile(profileId) {
  if (!AutomationDemo.isEnabled()) return { ok: false, error: 'debug-disabled' };
  try {
    return { ok: true, recording: await DemoCoordinateStore.load(profileId) };
  } catch (error) {
    return { ok: false, error: error.code || 'recording-load-failed' };
  }
}

async function clearAutomationRecordingForProfile(profileId) {
  if (!AutomationDemo.isEnabled()) return { ok: false, error: 'debug-disabled' };
  try {
    return { ok: true, recording: await DemoCoordinateStore.clear(profileId) };
  } catch (error) {
    return { ok: false, error: error.code || 'recording-clear-failed' };
  }
}

function createRestrictedDemoApi(match) {
  const profileId = match.profileId;
  const win = match.entry.window;
  return Object.freeze({
    loadCoordinates: function () {
      return DemoCoordinateStore.load(profileId);
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

async function runAutomationDemoForProfile(profileId) {
  if (!AutomationDemo.isEnabled()) return { ok: false, error: 'debug-disabled' };
  const match = findGameEntryForProfile(profileId);
  if (!match) return { ok: false, error: 'profile-mismatch' };

  try {
    const result = await DemoClickScript.run(createRestrictedDemoApi(match));
    return { ok: true, result: result };
  } catch (error) {
    return { ok: false, error: error.code || 'demo-script-failed' };
  }
}

function registerFlashProbeConnection(connection, hello) {
  if (process.env.SHINOBI_DEBUG !== '1') return { ok: false, error: 'debug-disabled' };
  if (!connection || typeof connection.requestSnapshot !== 'function') {
    return { ok: false, error: 'invalid-probe-connection' };
  }

  const openEntries = [];
  gameWindows.forEach(function (entry, profileId) {
    if (entry && entry.window && !entry.window.isDestroyed()) {
      openEntries.push({ profileId: profileId, entry: entry });
    }
  });
  if (openEntries.length !== 1) {
    return { ok: false, error: 'single-profile-required' };
  }

  const match = openEntries[0];
  if (
    match.entry.flashProbeConnection &&
    match.entry.flashProbeConnection !== connection &&
    typeof match.entry.flashProbeConnection.close === 'function'
  ) {
    match.entry.flashProbeConnection.close();
  }
  match.entry.flashProbeConnection = connection;
  match.entry.flashProbeHello = hello;
  return { ok: true, profileId: match.profileId };
}

function unregisterFlashProbeConnection(connection) {
  gameWindows.forEach(function (entry) {
    if (entry && entry.flashProbeConnection === connection) {
      entry.flashProbeConnection = null;
      entry.flashProbeHello = null;
    }
  });
}

async function snapshotFlashProbeForSender(sender) {
  if (process.env.SHINOBI_DEBUG !== '1') return { ok: false, error: 'debug-disabled' };
  const match = findGameEntryForSender(sender);
  if (!match) return { ok: false, error: 'profile-mismatch' };
  const connection = match.entry.flashProbeConnection;
  if (!connection || connection.closed) return { ok: false, error: 'agent-not-connected' };

  try {
    const result = await connection.requestSnapshot();
    return {
      ok: true,
      profileId: match.profileId,
      hello: match.entry.flashProbeHello,
      objects: result.objects,
      truncated: result.truncated === true
    };
  } catch (error) {
    return { ok: false, error: error.code || 'snapshot-failed' };
  }
}

function requestRecoveryForSender(sender, action) {
  let matchedProfileId = null;
  let matchedEntry = null;
  gameWindows.forEach(function (entry, profileId) {
    if (
      !matchedEntry &&
      entry &&
      entry.window &&
      !entry.window.isDestroyed() &&
      entry.window.webContents === sender
    ) {
      matchedProfileId = profileId;
      matchedEntry = entry;
    }
  });

  if (!matchedEntry && activeRecoveryProfileId && gameWindows.has(activeRecoveryProfileId)) {
    const activeEntry = gameWindows.get(activeRecoveryProfileId);
    if (activeEntry && activeEntry.window && !activeEntry.window.isDestroyed()) {
      matchedProfileId = activeRecoveryProfileId;
      matchedEntry = activeEntry;
    }
  }

  if (!matchedEntry || !matchedEntry.launchFlow) {
    return { ok: false, error: 'profile-mismatch' };
  }
  const ok = matchedEntry.launchFlow.requestRecovery(action, {
    profileId: matchedProfileId,
    source: 'user'
  });
  return ok ? { ok: true } : { ok: false, error: 'recovery-rejected' };
}

module.exports = {
  launchProfile: launchProfile,
  focusProfile: focusProfile,
  closeProfile: closeProfile,
  refreshProfile: refreshProfile,
  isProfileOpen: isProfileOpen,
  getWebContents: getWebContents,
  captureAutomationForSender: captureAutomationForSender,
  clickAutomationForSender: clickAutomationForSender,
  captureAutomationForProfile: captureAutomationForProfile,
  clickAutomationForProfile: clickAutomationForProfile,
  beginAutomationRecordingForProfile: beginAutomationRecordingForProfile,
  recordAutomationPointForProfile: recordAutomationPointForProfile,
  getAutomationRecordingForProfile: getAutomationRecordingForProfile,
  clearAutomationRecordingForProfile: clearAutomationRecordingForProfile,
  runAutomationDemoForProfile: runAutomationDemoForProfile,
  registerFlashProbeConnection: registerFlashProbeConnection,
  unregisterFlashProbeConnection: unregisterFlashProbeConnection,
  snapshotFlashProbeForSender: snapshotFlashProbeForSender,
  requestRecoveryForSender: requestRecoveryForSender,
  hasOpenWindows: hasOpenWindows,
  getGameUrl: getGameUrl
};
