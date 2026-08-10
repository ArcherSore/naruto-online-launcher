'use strict';

const { clipboard, ipcRenderer } = require('electron');
const { debounce } = require('../utils/throttle');
const {
  clientPointToImage,
  createVisionSelection
} = require('./automation-selection');

let profiles = [];
let editingProfileId = null;
const openWindows = Object.create(null);
let automationProfileId = null;
let automationScripts = [];
let automationCaptureId = null;
let automationSelectedScriptId = null;
let automationTarget = { available: false, gameReady: false };
let automationCaptureMode = 'point';
let automationCaptureMeta = null;
let automationSelectionStart = null;
let automationSelection = null;
let automationVisionTemplates = [];
let automationVisionBusy = false;

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
  automationCaptureStage: document.getElementById('automationCaptureStage'),
  automationCaptureHint: document.getElementById('automationCaptureHint'),
  automationSelectionOverlay: document.getElementById('automationSelectionOverlay'),
  automationMatchOverlay: document.getElementById('automationMatchOverlay'),
  automationVisionResult: document.getElementById('automationVisionResult'),
  automationVisionRoiText: document.getElementById('automationVisionRoiText'),
  automationVisionCenterText: document.getElementById('automationVisionCenterText'),
  automationVisionTemplateId: document.getElementById('automationVisionTemplateId'),
  automationVisionThreshold: document.getElementById('automationVisionThreshold'),
  automationVisionMatchText: document.getElementById('automationVisionMatchText'),
  automationVisionMatch: document.getElementById('automationVisionMatchBtn'),
  automationVisionMatchClick: document.getElementById('automationVisionMatchClickBtn'),
  automationVisionCopy: document.getElementById('automationVisionCopyBtn'),
  automationVisionSelect: document.getElementById('automationVisionSelectBtn'),
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
  'vision-input-invalid': 'Vision 参数无效，请重新框选 ROI。',
  'vision-template-id-invalid': 'Vision 模板标识无效。',
  'vision-template-not-found': '未找到当前脚本的 Vision 模板。',
  'vision-template-read-failed': 'Vision 模板读取失败。',
  'vision-template-invalid': 'Vision 模板不是有效 PNG。',
  'vision-template-too-large': 'Vision 模板大于当前 ROI。',
  'vision-timeout': '等待 Vision 条件超时。',
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

function resetAutomationSelection() {
  automationSelectionStart = null;
  automationSelection = null;
  elements.automationSelectionOverlay.hidden = true;
  elements.automationSelectionOverlay.removeAttribute('style');
  elements.automationMatchOverlay.hidden = true;
  elements.automationMatchOverlay.removeAttribute('style');
  elements.automationVisionResult.hidden = true;
  elements.automationVisionRoiText.textContent = '';
  elements.automationVisionCenterText.textContent = '';
  elements.automationVisionMatchText.textContent = '框选后可直接匹配当前游戏画面。';
  updateVisionTestControls();
}

function resetAutomationCapture() {
  automationCaptureId = null;
  automationCaptureMode = 'point';
  automationCaptureMeta = null;
  resetAutomationSelection();
  elements.automationCapture.hidden = true;
  elements.automationCapture.removeAttribute('src');
  elements.automationCaptureStage.hidden = true;
  elements.automationCaptureHint.textContent =
    '“截图录点”用于单击记录坐标；“Vision 框选”用于拖拽生成 ROI 并记录中心点。';
}

function imagePointFromMouse(event) {
  const image = elements.automationCapture;
  const rect = image.getBoundingClientRect();
  return clientPointToImage(event, {
    left: rect.left,
    top: rect.top,
    clientLeft: image.clientLeft,
    clientTop: image.clientTop,
    clientWidth: image.clientWidth,
    clientHeight: image.clientHeight,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight
  });
}

function renderSelectionOverlay(selection) {
  if (!selection) return;
  renderImageRectOverlay(elements.automationSelectionOverlay, selection.roi);
}

function renderImageRectOverlay(element, rect) {
  if (!element || !rect || !automationCaptureMeta) return;
  const image = elements.automationCapture;
  const left = image.offsetLeft + image.clientLeft +
    (rect.x * image.clientWidth) / automationCaptureMeta.imageSize.width;
  const top = image.offsetTop + image.clientTop +
    (rect.y * image.clientHeight) / automationCaptureMeta.imageSize.height;
  const width = (rect.width * image.clientWidth) / automationCaptureMeta.imageSize.width;
  const height = (rect.height * image.clientHeight) / automationCaptureMeta.imageSize.height;
  element.style.left = left + 'px';
  element.style.top = top + 'px';
  element.style.width = Math.max(1, width) + 'px';
  element.style.height = Math.max(1, height) + 'px';
  element.hidden = false;
}

function renderVisionSelection(selection, point) {
  if (!selection) return;
  const roi = selection.roi;
  const normalized = point || selection.center;
  elements.automationVisionRoiText.textContent =
    roi.x + ',' + roi.y + ',' + roi.width + ',' + roi.height;
  elements.automationVisionCenterText.textContent =
    'pixel(' + selection.imageCenter.x + ',' + selection.imageCenter.y + ') · normalized(' +
    normalized.normalizedX.toFixed(9) + ',' + normalized.normalizedY.toFixed(9) + ')';
  elements.automationVisionResult.hidden = false;
  updateVisionTestControls();
}

function renderVisionTemplates() {
  const selected = elements.automationVisionTemplateId.value;
  if (automationVisionTemplates.length === 0) {
    elements.automationVisionTemplateId.innerHTML =
      '<option value="">assets/vision/ 中没有可用 PNG</option>';
  } else {
    elements.automationVisionTemplateId.innerHTML = automationVisionTemplates.map(function (id) {
      return '<option value="' + escapeHtml(id) + '">' + escapeHtml(id) + '.png</option>';
    }).join('');
    if (automationVisionTemplates.indexOf(selected) !== -1) {
      elements.automationVisionTemplateId.value = selected;
    }
  }
  updateVisionTestControls();
}

function updateVisionTestControls() {
  const ready = !!(
    automationSelection &&
    automationTarget.available &&
    automationSelectedScriptId &&
    automationVisionTemplates.length > 0 &&
    !automationVisionBusy
  );
  elements.automationVisionTemplateId.disabled = automationVisionBusy;
  elements.automationVisionThreshold.disabled = automationVisionBusy;
  elements.automationVisionMatch.disabled = !ready;
  elements.automationVisionMatchClick.disabled = !ready;
}

async function loadVisionTemplates(showError) {
  const scriptId = automationSelectedScriptId;
  automationVisionTemplates = [];
  renderVisionTemplates();
  if (!automationProfileId || !scriptId) return;
  const result = await ipcRenderer.invoke('automation:vision:templates', {
    profileId: automationProfileId,
    scriptId: scriptId
  });
  if (automationSelectedScriptId !== scriptId) return;
  if (!result || !result.ok) {
    if (showError) {
      showToast(automationErrorMessage(result, '无法读取该脚本的 Vision 模板'), 'error');
    }
    return;
  }
  automationVisionTemplates = Array.isArray(result.templates) ? result.templates : [];
  renderVisionTemplates();
}

async function runVisionTest(shouldClick) {
  if (!automationSelection || automationVisionBusy) return;
  const templateId = elements.automationVisionTemplateId.value;
  const threshold = Number(elements.automationVisionThreshold.value);
  if (!templateId || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    showToast('请选择模板并填写 0 到 1 之间的阈值。', 'error');
    return;
  }
  automationVisionBusy = true;
  updateVisionTestControls();
  elements.automationMatchOverlay.hidden = true;
  elements.automationVisionMatchText.textContent = shouldClick ? '正在匹配，命中后将点击…' : '正在匹配…';
  let result;
  try {
    result = await ipcRenderer.invoke('automation:vision:test', {
      profileId: automationProfileId,
      scriptId: automationSelectedScriptId,
      templateId: templateId,
      roi: automationSelection.roi,
      threshold: threshold,
      click: shouldClick
    });
  } finally {
    automationVisionBusy = false;
    updateVisionTestControls();
  }
  if (!result || !result.ok) {
    elements.automationVisionMatchText.textContent = '测试失败。';
    showToast(automationErrorMessage(result, 'Vision 测试失败'), 'error');
    return;
  }
  if (!result.found || !result.match) {
    elements.automationVisionMatchText.textContent = '未命中：请检查模板尺寸、ROI 或阈值。';
    showToast('当前画面未匹配到模板。', 'info');
    return;
  }
  renderImageRectOverlay(elements.automationMatchOverlay, result.match.rect);
  const rect = result.match.rect;
  elements.automationVisionMatchText.textContent =
    '命中 rect(' + rect.x + ',' + rect.y + ',' + rect.width + ',' + rect.height + ') · ' +
    'confidence ' + (result.match.confidence * 100).toFixed(2) + '%' +
    (result.clicked ? ' · 已点击' : '');
  showToast(result.clicked ? '匹配成功并已点击。' : '匹配成功。', 'ok');
}

async function beginAutomationCapture(mode) {
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
  automationCaptureMode = mode;
  automationCaptureMeta = {
    imageSize: result.capture.imageSize,
    contentSize: result.capture.contentSize
  };
  resetAutomationSelection();
  elements.automationCapture.src = result.capture.pngDataUrl;
  elements.automationCapture.hidden = false;
  elements.automationCaptureStage.hidden = false;
  const sizes = result.capture.imageSize.width + '×' + result.capture.imageSize.height +
    ' screenshot / ' + result.capture.contentSize.width + '×' +
    result.capture.contentSize.height + ' content';
  elements.automationCaptureHint.textContent = mode === 'vision-roi'
    ? '在截图上拖拽框选 ROI；结束后自动记录选区中心。' + sizes
    : '点击截图记录归一化坐标。' + sizes;
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
      const selected = script.id === automationSelectedScriptId ? ' selected' : '';
      return '<div class="automation-script-row' + selected + '" data-script-id="' +
        escapeHtml(script.id) + '">' +
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
  elements.automationVisionSelect.disabled = !runnable || !automationSelectedScriptId;
  elements.automationClear.disabled = !automationSelectedScriptId;
  updateVisionTestControls();
}

async function openAutomationModal(profileId) {
  closeAllDropdowns();
  automationProfileId = profileId;
  automationSelectedScriptId = null;
  resetAutomationCapture();
  const result = await ipcRenderer.invoke('automation:list', { profileId: profileId });
  if (!result || !result.ok) {
    showToast(automationErrorMessage(result, '无法读取内置脚本'), 'error');
    return;
  }
  automationScripts = Array.isArray(result.scripts) ? result.scripts : [];
  automationTarget = result.target || { available: false, gameReady: false };
  renderAutomationScripts();
  await loadVisionTemplates(false);
  elements.automationModal.classList.add('show');
  elements.automationModal.setAttribute('aria-hidden', 'false');
}

function closeAutomationModal() {
  elements.automationModal.classList.remove('show');
  elements.automationModal.setAttribute('aria-hidden', 'true');
  resetAutomationCapture();
  automationVisionTemplates = [];
  renderVisionTemplates();
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
  if (!row) return;
  const scriptId = row.getAttribute('data-script-id');
  const changed = automationSelectedScriptId !== scriptId;
  if (changed) resetAutomationCapture();
  automationSelectedScriptId = scriptId;
  renderAutomationScripts();
  if (changed) await loadVisionTemplates(false);
  if (!button) return;
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
  await beginAutomationCapture('point');
});

elements.automationVisionSelect.addEventListener('click', async function () {
  automationCaptureMode = 'vision-roi';
  await loadVisionTemplates(true);
  await beginAutomationCapture(automationCaptureMode);
});

elements.automationCapture.addEventListener('click', async function (event) {
  if (
    automationCaptureMode !== 'point' ||
    !automationCaptureId ||
    !automationSelectedScriptId
  ) {
    return;
  }
  const imagePoint = imagePointFromMouse(event);
  if (!imagePoint) return;
  const result = await ipcRenderer.invoke('automation:recording:add-point', {
    profileId: automationProfileId,
    scriptId: automationSelectedScriptId,
    captureId: automationCaptureId,
    imageX: imagePoint.x,
    imageY: imagePoint.y
  });
  showToast(result && result.ok ? '坐标已记录' : automationErrorMessage(result, '坐标记录失败'),
    result && result.ok ? 'ok' : 'error');
});

elements.automationCapture.addEventListener('mousedown', function (event) {
  if (
    event.button !== 0 ||
    automationCaptureMode !== 'vision-roi' ||
    !automationCaptureId ||
    !automationCaptureMeta
  ) {
    return;
  }
  event.preventDefault();
  automationSelectionStart = imagePointFromMouse(event);
  if (!automationSelectionStart) return;
  const preview = createVisionSelection(
    automationSelectionStart,
    automationSelectionStart,
    automationCaptureMeta.imageSize,
    automationCaptureMeta.contentSize
  );
  renderSelectionOverlay(preview);
});

document.addEventListener('mousemove', function (event) {
  if (!automationSelectionStart || automationCaptureMode !== 'vision-roi') return;
  const current = imagePointFromMouse(event);
  if (!current) return;
  const preview = createVisionSelection(
    automationSelectionStart,
    current,
    automationCaptureMeta.imageSize,
    automationCaptureMeta.contentSize
  );
  renderSelectionOverlay(preview);
});

document.addEventListener('mouseup', async function (event) {
  if (!automationSelectionStart || automationCaptureMode !== 'vision-roi') return;
  const start = automationSelectionStart;
  automationSelectionStart = null;
  const current = imagePointFromMouse(event);
  if (!current || !automationCaptureMeta) return;
  const selection = createVisionSelection(
    start,
    current,
    automationCaptureMeta.imageSize,
    automationCaptureMeta.contentSize
  );
  if (!selection) return;
  automationSelection = selection;
  renderSelectionOverlay(selection);
  renderVisionSelection(selection, selection.center);
  elements.automationMatchOverlay.hidden = true;
  elements.automationVisionMatchText.textContent = 'ROI 已自动填入，可直接匹配当前游戏画面。';
  const result = await ipcRenderer.invoke('automation:recording:add-point', {
    profileId: automationProfileId,
    scriptId: automationSelectedScriptId,
    captureId: automationCaptureId,
    imageX: selection.imageCenter.x,
    imageY: selection.imageCenter.y
  });
  if (result && result.ok) {
    renderVisionSelection(selection, result.point);
    showToast('ROI 已生成，中心坐标已记录', 'ok');
  } else {
    showToast(automationErrorMessage(result, 'ROI 已生成，但中心坐标记录失败'), 'error');
  }
});

elements.automationVisionCopy.addEventListener('click', function () {
  if (!automationSelection) return;
  const roi = automationSelection.roi;
  clipboard.writeText('--roi ' + roi.x + ',' + roi.y + ',' + roi.width + ',' + roi.height);
  showToast('ROI 参数已复制', 'ok');
});

elements.automationVisionMatch.addEventListener('click', async function () {
  await runVisionTest(false);
});

elements.automationVisionMatchClick.addEventListener('click', async function () {
  await runVisionTest(true);
});

elements.automationCapture.addEventListener('error', function () {
  if (!automationCaptureId) return;
  resetAutomationCapture();
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
