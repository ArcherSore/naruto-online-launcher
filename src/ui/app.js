'use strict';

const { ipcRenderer } = require('electron');
const { debounce } = require('../utils/throttle');

let profiles = [];
let editingProfileId = null;
const openWindows = Object.create(null);

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
  toast: document.getElementById('toast')
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
        '<button class="dropdown-item danger" data-action="delete">删除</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</article>'
      );
    })
    .join('');
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
  if (action === 'delete' && window.confirm('删除这个 Profile 及其本地独立会话数据？')) {
    ipcRenderer.send('profile:delete', profileId);
  }
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
  }
});

ipcRenderer.on('profiles:updated', function (_event, list) {
  profiles = Array.isArray(list) ? list : [];
  renderProfiles();
});

ipcRenderer.on('game-window:status', function (_event, state) {
  if (!state || typeof state.profileId !== 'string') return;
  openWindows[state.profileId] = state.open === true;
  renderProfiles();
});

ipcRenderer.on('profile:toast', function (_event, message) {
  if (!message) return;
  showToast(message.msg, message.type === 'success' ? 'ok' : message.type);
});

ipcRenderer.on('memory:update', function (_event, stats) {
  const total = stats && typeof stats.totalMB === 'number' ? Math.round(stats.totalMB) : null;
  elements.memory.textContent = total === null ? '内存状态暂不可用' : '约使用 ' + total + ' MB';
});

ipcRenderer.send('manager:ready');
renderProfiles();
