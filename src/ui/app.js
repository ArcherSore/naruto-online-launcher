'use strict';

const { ipcRenderer } = require('electron');
const { debounce } = require('../utils/throttle');

let profiles = [];
let editingProfileId = null;
const openWindows = Object.create(null);
let automationProfileId = null;
let automationScripts = [];
let automationCaptureId = null;
let automationSelectedScriptId = null;
let automationTarget = { available: false, gameReady: false };

const elements = {
  grid: document.getElementById('profileGrid'),
  empty: document.getElementById('emptyState'),
  count: document.getElementById('profileCount'),
  search: document.getElementById('searchInput'),
  modal: document.getElementById('profileModal'),
  form: document.getElementById('profileForm'),
  modalTitle: document.getElementById('profileModalTitle'),
  name: document.getElementById('profileName'),
  notes: document.getElementById('profileNotes'),
  color: document.getElementById('profileColor'),
  colorSwatch: document.getElementById('colorSwatchPreview'),
  colorSwatchBtn: document.getElementById('colorSwatchBtn'),
  changeColorBtn: document.getElementById('changeColorBtn'),
  colorHexText: document.getElementById('colorHexText'),
  notifications: document.getElementById('profileNotifications'),
  memory: document.getElementById('memorySummary'),
  toast: document.getElementById('toast'),
  automationModal: document.getElementById('automationModal'),
  automationList: document.getElementById('automationScriptList'),
  automationCapture: document.getElementById('automationCapture'),
  automationRecord: document.getElementById('automationRecordBtn'),
  automationClear: document.getElementById('automationClearBtn')
};

const AUTOMATION_ERRORS = {
  'profile-busy': '该 Profile 正在执行自动化，请先停止或等待完成。',
  'game-not-ready': '请先完成扫码、选服并等待游戏加载完成。',
  'window-unavailable': '游戏窗口不可用，请重新打开 Profile。',
  'coordinates-invalid': '坐标数据无效，请清空后重新录制。',
  'coordinates-missing': '请先为该脚本记录至少一个坐标。',
  'capture-expired': '截图已过期，请重新截图录点。',
  'capture-mismatch': '截图与当前脚本不匹配，请重新截图。',
  'cdp-already-attached': '请关闭游戏 DevTools 后重试。',
  'cdp-attach-failed': '后台输入通道连接失败，请稍后重试。',
  'cdp-detached': '游戏窗口的后台输入通道已断开，请重新打开窗口。',
  'cdp-dispatch-failed': '后台点击失败，请确认游戏窗口仍可用。',
  'action-timeout': '单次自动化动作超时，请重试。',
  'run-timeout': '脚本运行超时。',
  'profile-not-found': 'Profile 已不存在，请刷新列表。',
  'script-not-found': '内置脚本不可用，请刷新列表。',
  'run-not-active': '自动化已经停止。',
  'run-cancelled': '脚本已取消。',
  'script-failed': '内置脚本执行失败，请查看脱敏日志。'
};

const AUTOMATION_STATUS_TEXT = {
  idle: '未运行',
  running: '运行中',
  stopping: '停止中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type) {
  elements.toast.textContent = String(message || '');
  elements.toast.className = 'toast show ' + (type || 'info');
  setTimeout(function () {
    elements.toast.className = 'toast';
  }, 2600);
}

function updateColorPickerPreview(hexColor) {
  const validColor = /^#[0-9a-f]{6}$/i.test(hexColor || '') ? hexColor : '#ff8c00';
  if (elements.colorSwatch) {
    elements.colorSwatch.style.backgroundColor = validColor;
  }
  if (elements.colorHexText) {
    elements.colorHexText.textContent = validColor.toUpperCase();
  }
  if (elements.color && elements.color.value !== validColor) {
    elements.color.value = validColor;
  }
}

function triggerColorPicker() {
  if (elements.color) {
    elements.color.click();
  }
}

function closeAllDropdowns() {
  const openMenus = document.querySelectorAll('.dropdown-menu:not([hidden])');
  openMenus.forEach(function (menu) {
    menu.setAttribute('hidden', '');
  });
}

function renderProfiles() {
  closeAllDropdowns();
  const query = elements.search.value.trim().toLowerCase();
  const visible = profiles.filter(function (profile) {
    return (
      !query ||
      String(profile.name || '')
        .toLowerCase()
        .indexOf(query) !== -1
    );
  });

  elements.count.textContent = profiles.length + ' 个 Profile';
  elements.empty.hidden = visible.length > 0;
  elements.grid.innerHTML = visible
    .map(function (profile) {
      const isOpen = openWindows[profile.id] === true;
      const color = /^#[0-9a-f]{6}$/i.test(profile.color || '') ? profile.color : '#ff8c00';
      const hasNotes = profile.notes && String(profile.notes).trim().length > 0;

      return (
        '<article class="profile-card" data-profile-id="' +
        escapeHtml(profile.id) +
        '">' +
        '<div class="profile-card-header">' +
        '<div class="profile-card-title-group">' +
        '<span class="profile-color-dot" style="background:' +
        color +
        '"></span>' +
        '<h3>' +
        escapeHtml(profile.name) +
        '</h3>' +
        '</div>' +
        '<span class="window-state ' +
        (isOpen ? 'open' : '') +
        '">' +
        (isOpen ? '运行中' : '未启动') +
        '</span>' +
        '</div>' +
        (hasNotes
          ? '<div class="profile-card-body"><p>' + escapeHtml(profile.notes) + '</p></div>'
          : '') +
        '<div class="card-actions">' +
        '<div class="card-primary-actions">' +
        (isOpen
          ? '<button class="secondary-button compact" data-action="focus">显示窗口</button><button class="secondary-button compact" data-action="refresh">刷新</button><button class="danger-button compact" data-action="close">关闭</button>'
          : '<button class="primary-button compact" data-action="launch">打开</button>') +
        '</div>' +
        '<div class="menu-container">' +
        '<button class="icon-button compact menu-trigger" data-action="toggle-menu" aria-label="更多操作" title="更多操作">•••</button>' +
        '<div class="dropdown-menu" hidden>' +
        '<button class="dropdown-item" data-action="edit">编辑</button>' +
        '<button class="dropdown-item" data-action="automation">自动化</button>' +
        '<button class="dropdown-item danger" data-action="delete">删除</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</article>'
      );
    })
    .join('');
}

function automationErrorMessage(result, fallback) {
  const code = result && result.error;
  return AUTOMATION_ERRORS[code] || fallback;
}

function renderAutomationScripts() {
  const runnable = automationTarget.available === true;
  if (!automationSelectedScriptId && automationScripts.length > 0) {
    automationSelectedScriptId = automationScripts[0].id;
  }
  elements.automationList.innerHTML = automationScripts
    .map(function (script) {
      const status = script.status || { status: 'idle' };
      const running = status.status === 'running' || status.status === 'stopping';
      const errorCode = status.error && status.error.code;
      const recovery = errorCode && AUTOMATION_ERRORS[errorCode]
        ? '<div class="automation-error">' + escapeHtml(AUTOMATION_ERRORS[errorCode]) + '</div>'
        : '';
      const disabled = !running && !runnable ? ' disabled' : '';
      return '<div class="automation-script-row" data-script-id="' + escapeHtml(script.id) + '">' +
        '<div><strong>' + escapeHtml(script.name) + '</strong>' +
        '<div class="automation-script-meta">' + escapeHtml(script.id) + ' · v' +
        escapeHtml(script.version) + ' · API v' + escapeHtml(script.apiVersion) + '</div>' +
        '<div>' + escapeHtml(AUTOMATION_STATUS_TEXT[status.status] || AUTOMATION_STATUS_TEXT.idle) +
        '</div>' + recovery + '</div>' +
        '<button class="' + (running ? 'danger-button' : 'primary-button') +
        ' compact" data-automation-action="' + (running ? 'stop' : 'start') +
        '" data-run-id="' + escapeHtml(status.runId || '') + '"' + disabled + '>' +
        (running ? '停止' : '启动') + '</button></div>';
    })
    .join('');
  elements.automationRecord.disabled = !runnable || !automationSelectedScriptId;
  elements.automationClear.disabled = !automationSelectedScriptId;
}

async function openAutomationModal(profileId) {
  closeAllDropdowns();
  automationProfileId = profileId;
  automationSelectedScriptId = null;
  automationCaptureId = null;
  elements.automationCapture.hidden = true;
  elements.automationCapture.removeAttribute('src');
  const result = await ipcRenderer.invoke('automation:list', { profileId: profileId });
  if (!result || !result.ok) {
    showToast(automationErrorMessage(result, '无法读取内置脚本'), 'error');
    return;
  }
  automationScripts = Array.isArray(result.scripts) ? result.scripts : [];
  automationTarget = result.target || { available: false, gameReady: false };
  renderAutomationScripts();
  elements.automationModal.classList.add('show');
  elements.automationModal.setAttribute('aria-hidden', 'false');
}

function closeAutomationModal() {
  elements.automationModal.classList.remove('show');
  elements.automationModal.setAttribute('aria-hidden', 'true');
  elements.automationCapture.hidden = true;
  elements.automationCapture.removeAttribute('src');
  automationCaptureId = null;
  automationProfileId = null;
  automationTarget = { available: false, gameReady: false };
}

function openProfileModal(profile) {
  closeAllDropdowns();
  editingProfileId = profile ? profile.id : null;
  elements.modalTitle.textContent = profile ? '编辑 Profile' : '新建 Profile';
  elements.name.value = profile ? profile.name || '' : '';
  elements.notes.value = profile ? profile.notes || '' : '';

  const initialColor =
    profile && /^#[0-9a-f]{6}$/i.test(profile.color || '') ? profile.color : '#ff8c00';
  updateColorPickerPreview(initialColor);

  elements.notifications.checked = profile ? profile.notificationsEnabled !== false : true;
  elements.modal.classList.add('show');
  elements.modal.setAttribute('aria-hidden', 'false');
  elements.name.focus();
}

function closeProfileModal() {
  elements.modal.classList.remove('show');
  elements.modal.setAttribute('aria-hidden', 'true');
  editingProfileId = null;
  elements.form.reset();
}

function profileById(profileId) {
  return (
    profiles.find(function (profile) {
      return profile.id === profileId;
    }) || null
  );
}

if (elements.color) {
  elements.color.addEventListener('input', function (e) {
    updateColorPickerPreview(e.target.value);
  });
}

if (elements.colorSwatchBtn) {
  elements.colorSwatchBtn.addEventListener('click', triggerColorPicker);
}

if (elements.changeColorBtn) {
  elements.changeColorBtn.addEventListener('click', triggerColorPicker);
}

elements.form.addEventListener('submit', function (event) {
  event.preventDefault();
  const payload = {
    name: elements.name.value.trim(),
    notes: elements.notes.value.trim(),
    color: elements.color.value,
    notificationsEnabled: elements.notifications.checked
  };
  if (!payload.name) return;
  if (editingProfileId) {
    payload.id = editingProfileId;
    ipcRenderer.send('profile:update', payload);
  } else {
    ipcRenderer.send('profile:create', payload);
  }
  closeProfileModal();
});

elements.grid.addEventListener('click', function (event) {
  const button = event.target.closest('button[data-action]');
  const card = event.target.closest('[data-profile-id]');
  if (!button || !card) return;

  const profileId = card.getAttribute('data-profile-id');
  const action = button.getAttribute('data-action');

  if (action === 'toggle-menu') {
    event.stopPropagation();
    const menuContainer = button.closest('.menu-container');
    const menu = menuContainer ? menuContainer.querySelector('.dropdown-menu') : null;
    if (menu) {
      const isHidden = menu.hasAttribute('hidden');
      closeAllDropdowns();
      if (isHidden) {
        menu.removeAttribute('hidden');
      }
    }
    return;
  }

  closeAllDropdowns();

  if (action === 'launch') ipcRenderer.send('profile:launch', profileId);
  if (action === 'focus') ipcRenderer.send('profile:launch', profileId);
  if (action === 'refresh') ipcRenderer.send('profile:refresh', profileId);
  if (action === 'close') ipcRenderer.send('profile:close', profileId);
  if (action === 'edit') openProfileModal(profileById(profileId));
  if (action === 'automation') openAutomationModal(profileId);
  if (action === 'delete' && window.confirm('删除这个 Profile 及其本地独立会话数据？')) {
    ipcRenderer.send('profile:delete', profileId);
  }
});

elements.automationList.addEventListener('click', async function (event) {
  const button = event.target.closest('button[data-automation-action]');
  const row = event.target.closest('[data-script-id]');
  if (!button || !row) return;
  const scriptId = row.getAttribute('data-script-id');
  automationSelectedScriptId = scriptId;
  const action = button.getAttribute('data-automation-action');
  const result = action === 'start'
    ? await ipcRenderer.invoke('automation:start', {
      profileId: automationProfileId,
      scriptId: scriptId
    })
    : await ipcRenderer.invoke('automation:stop', {
      profileId: automationProfileId,
      runId: button.getAttribute('data-run-id')
    });
  if (!result || !result.ok) {
    showToast(automationErrorMessage(result, '自动化操作失败'), 'error');
  }
});

elements.automationRecord.addEventListener('click', async function () {
  if (!automationSelectedScriptId || !automationTarget.available) {
    showToast('请先打开游戏窗口。', 'error');
    return;
  }
  const result = await ipcRenderer.invoke('automation:recording:begin', {
    profileId: automationProfileId,
    scriptId: automationSelectedScriptId
  });
  if (!result || !result.ok) {
    showToast(automationErrorMessage(result, '截图失败'), 'error');
    return;
  }
  automationCaptureId = result.capture.captureId;
  elements.automationCapture.src = result.capture.pngDataUrl;
  elements.automationCapture.hidden = false;
});

elements.automationCapture.addEventListener('click', async function (event) {
  if (!automationCaptureId || !automationSelectedScriptId) return;
  const rect = elements.automationCapture.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  const imageX = (event.clientX - rect.left) * elements.automationCapture.naturalWidth / rect.width;
  const imageY = (event.clientY - rect.top) * elements.automationCapture.naturalHeight / rect.height;
  const result = await ipcRenderer.invoke('automation:recording:add-point', {
    profileId: automationProfileId,
    scriptId: automationSelectedScriptId,
    captureId: automationCaptureId,
    imageX: imageX,
    imageY: imageY
  });
  showToast(result && result.ok ? '坐标已记录' : automationErrorMessage(result, '坐标记录失败'),
    result && result.ok ? 'ok' : 'error');
});

elements.automationCapture.addEventListener('error', function () {
  if (!automationCaptureId) return;
  elements.automationCapture.hidden = true;
  automationCaptureId = null;
  showToast('截图预览加载失败，请重试。', 'error');
});

elements.automationClear.addEventListener('click', async function () {
  if (!automationSelectedScriptId) return;
  const result = await ipcRenderer.invoke('automation:coordinates:clear', {
    profileId: automationProfileId,
    scriptId: automationSelectedScriptId
  });
  showToast(result && result.ok ? '坐标已清空' : automationErrorMessage(result, '清空失败'),
    result && result.ok ? 'ok' : 'error');
});

['closeAutomationModalBtn', 'automationCloseBtn'].forEach(function (id) {
  const button = document.getElementById(id);
  if (button) button.addEventListener('click', closeAutomationModal);
});

// Global click handler to close dropdowns when clicking outside
document.addEventListener('click', function (event) {
  if (!event.target.closest('.menu-container')) {
    closeAllDropdowns();
  }
});

const createProfileBtn = document.getElementById('createProfileBtn');
if (createProfileBtn) {
  createProfileBtn.addEventListener('click', function () {
    openProfileModal(null);
  });
}

const closeProfileModalBtn = document.getElementById('closeProfileModalBtn');
if (closeProfileModalBtn) {
  closeProfileModalBtn.addEventListener('click', closeProfileModal);
}

const cancelProfileBtn = document.getElementById('cancelProfileBtn');
if (cancelProfileBtn) {
  cancelProfileBtn.addEventListener('click', closeProfileModal);
}

elements.search.addEventListener('input', debounce(renderProfiles, 120));

const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', function () {
    ipcRenderer.send('manager:ready');
  });
}

const diagnosticsBtn = document.getElementById('diagnosticsBtn');
if (diagnosticsBtn) {
  diagnosticsBtn.addEventListener('click', async function () {
    const result = await ipcRenderer.invoke('diagnostics:export');
    if (result && result.ok) showToast('脱敏诊断已导出', 'ok');
  });
}

const alwaysOnTopBtn = document.getElementById('alwaysOnTopBtn');
if (alwaysOnTopBtn) {
  alwaysOnTopBtn.addEventListener('click', async function () {
    const result = await ipcRenderer.invoke('window:toggle-always-on-top');
    this.classList.toggle('active', !!(result && result.alwaysOnTop));
  });
}

const minimizeBtn = document.getElementById('minimizeBtn');
if (minimizeBtn) {
  minimizeBtn.addEventListener('click', function () {
    ipcRenderer.send('window:minimize');
  });
}

const maximizeBtn = document.getElementById('maximizeBtn');
if (maximizeBtn) {
  maximizeBtn.addEventListener('click', function () {
    ipcRenderer.invoke('window:toggle-maximize');
  });
}

// Close modal & menus with Escape key
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closeAllDropdowns();
    if (elements.modal.classList.contains('show')) {
      closeProfileModal();
    }
    if (elements.automationModal.classList.contains('show')) {
      closeAutomationModal();
    }
  }
});

ipcRenderer.on('profiles:updated', function (_event, list) {
  profiles = Array.isArray(list) ? list : [];
  renderProfiles();
});

ipcRenderer.on('game-window:status', function (_event, state) {
  if (!state || typeof state.profileId !== 'string') return;
  openWindows[state.profileId] = state.open === true;
  if (state.profileId === automationProfileId) {
    automationTarget.available = state.open === true;
    if (!automationTarget.available) automationTarget.gameReady = false;
    renderAutomationScripts();
  }
  renderProfiles();
});

ipcRenderer.on('launch-flow:status', function (_event, state) {
  if (!state || state.profileId !== automationProfileId) return;
  automationTarget = {
    available: automationTarget.available === true,
    gameReady: state.stage === 'GAME_READY'
  };
  renderAutomationScripts();
});

ipcRenderer.on('profile:toast', function (_event, message) {
  if (!message) return;
  showToast(message.msg, message.type === 'success' ? 'ok' : message.type);
});

ipcRenderer.on('memory:update', function (_event, stats) {
  const total = stats && typeof stats.totalMB === 'number' ? Math.round(stats.totalMB) : null;
  elements.memory.textContent = total === null ? '内存状态暂不可用' : '约使用 ' + total + ' MB';
});

ipcRenderer.on('automation:status', function (_event, status) {
  if (!status || status.profileId !== automationProfileId) return;
  automationScripts = automationScripts.map(function (script) {
    if (script.id === status.scriptId) {
      return Object.assign({}, script, { status: status });
    }
    return script;
  });
  renderAutomationScripts();
});

ipcRenderer.on('automation:statuses', function (_event, payload) {
  const statuses = payload && Array.isArray(payload.statuses) ? payload.statuses : [];
  automationScripts = automationScripts.map(function (script) {
    const found = statuses.find(function (status) {
      return status.profileId === automationProfileId && status.scriptId === script.id;
    });
    return found ? Object.assign({}, script, { status: found }) : script;
  });
  if (automationProfileId) renderAutomationScripts();
});

ipcRenderer.send('manager:ready');
renderProfiles();
