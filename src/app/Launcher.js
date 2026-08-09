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
const Auditor = require('./Auditor');
const GameViewport = require('./GameViewport');
const KeyboardShortcuts = require('../ui/manager/KeyboardShortcuts');
const StateBroadcaster = require('../ui/manager/StateBroadcaster');
const urlConfig = require('../config/urls');

const WINDOW_TITLE = 'Naruto Online';
const gameWindows = new Map();
const automationTargetClosedListeners = new Set();
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
  const viewportMetrics = GameViewport.getInitialMetrics();
  const win = new BrowserWindow({
    width: viewportMetrics.contentWidth,
    height: viewportMetrics.contentHeight,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0a0a0f',
    icon: resolveIconPath(),
    title: WINDOW_TITLE + ' — ' + profile.name,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      plugins: true,
      zoomFactor: viewportMetrics.zoomFactor,
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
    viewport: GameViewport.attach(win),
    failLoadTimer: null,
    closeTimer: null
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
      if (entry.viewport && typeof entry.viewport.detach === 'function') {
        entry.viewport.detach();
      }
      launchFlow.close();
      try {
        auditor.destroy();
      } catch (error) {
        logger.debug('Auditor: destroy failed - ' + error.message);
      }
      gameWindows.delete(profileId);
      automationTargetClosedListeners.forEach(function (listener) {
        try {
          listener(profileId);
        } catch (_) {
          // One automation observer must not interrupt window cleanup.
        }
      });
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

function getAutomationTarget(profileId) {
  const entry = gameWindows.get(profileId);
  if (
    !entry ||
    !entry.window ||
    entry.window.isDestroyed() ||
    !entry.window.webContents ||
    (typeof entry.window.webContents.isDestroyed === 'function' &&
      entry.window.webContents.isDestroyed())
  ) {
    return null;
  }
  const contentSize = GameViewport.getAutomationContentSize(entry.window);
  let snapshot = null;
  try {
    snapshot =
      entry.launchFlow && typeof entry.launchFlow.getSnapshot === 'function'
        ? entry.launchFlow.getSnapshot()
        : null;
  } catch (_) {
    snapshot = null;
  }
  return Object.freeze({
    window: entry.window,
    webContents: entry.window.webContents,
    gameReady: !!(snapshot && snapshot.stage === 'GAME_READY'),
    contentSize: contentSize
  });
}

function onAutomationTargetClosed(listener) {
  if (typeof listener !== 'function')
    return function () {
      return false;
    };
  automationTargetClosedListeners.add(listener);
  return function () {
    return automationTargetClosedListeners.delete(listener);
  };
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
  getAutomationTarget: getAutomationTarget,
  onAutomationTargetClosed: onAutomationTargetClosed,
  requestRecoveryForSender: requestRecoveryForSender,
  hasOpenWindows: hasOpenWindows,
  getGameUrl: getGameUrl
};
