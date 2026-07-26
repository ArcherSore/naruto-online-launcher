'use strict';

const { ipcRenderer } = require('electron');

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

function renderProfiles() {
  const query = elements.search.value.trim().toLowerCase();
  const visible = profiles.filter(function (profile) {
    return !query || String(profile.name || '').toLowerCase().indexOf(query) !== -1;
  });

  elements.count.textContent = profiles.length + ' 个 Profile';
  elements.empty.hidden = visible.length > 0;
  elements.grid.innerHTML = visible
    .map(function (profile) {
      const isOpen = openWindows[profile.id] === true;
      const color = /^#[0-9a-f]{6}$/i.test(profile.color || '') ? profile.color : '#ff8c00';
      return (
        '<article class="profile-card" data-profile-id="' +
        escapeHtml(profile.id) +
        '">' +
        '<div class="profile-accent" style="background:' +
        color +
        '"></div>' +
        '<div class="profile-card-heading"><div><h3>' +
        escapeHtml(profile.name) +
        '</h3><p>' +
        escapeHtml(profile.notes || '腾讯官方会话由此 Profile 的独立 Partition 保存') +
        '</p></div><span class="window-state ' +
        (isOpen ? 'open' : '') +
        '">' +
        (isOpen ? '运行中' : '未启动') +
        '</span></div>' +
        '<div class="card-actions">' +
        (isOpen
          ? '<button class="secondary-button" data-action="focus">显示窗口</button><button class="secondary-button" data-action="refresh">刷新</button><button class="danger-button" data-action="close">关闭</button>'
          : '<button class="primary-button" data-action="launch">打开</button>') +
        '<button class="secondary-button" data-action="edit">编辑</button>' +
        '<button class="ghost-button" data-action="delete">删除</button>' +
        '</div></article>'
      );
    })
    .join('');
}

function openProfileModal(profile) {
  editingProfileId = profile ? profile.id : null;
  elements.modalTitle.textContent = profile ? '编辑 Profile' : '新建 Profile';
  elements.name.value = profile ? profile.name || '' : '';
  elements.notes.value = profile ? profile.notes || '' : '';
  elements.color.value =
    profile && /^#[0-9a-f]{6}$/i.test(profile.color || '') ? profile.color : '#ff8c00';
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

  if (action === 'launch') ipcRenderer.send('profile:launch', profileId);
  if (action === 'focus') ipcRenderer.send('profile:launch', profileId);
  if (action === 'refresh') ipcRenderer.send('profile:refresh', profileId);
  if (action === 'close') ipcRenderer.send('profile:close', profileId);
  if (action === 'edit') openProfileModal(profileById(profileId));
  if (action === 'delete' && window.confirm('删除这个 Profile 及其本地独立会话数据？')) {
    ipcRenderer.send('profile:delete', profileId);
  }
});

document.getElementById('createProfileBtn').addEventListener('click', function () {
  openProfileModal(null);
});
document.getElementById('closeProfileModalBtn').addEventListener('click', closeProfileModal);
document.getElementById('cancelProfileBtn').addEventListener('click', closeProfileModal);
elements.search.addEventListener('input', renderProfiles);

document.getElementById('refreshBtn').addEventListener('click', function () {
  ipcRenderer.send('manager:ready');
});

document.getElementById('diagnosticsBtn').addEventListener('click', async function () {
  const result = await ipcRenderer.invoke('diagnostics:export');
  if (result && result.ok) showToast('脱敏诊断已导出', 'ok');
});

document.getElementById('alwaysOnTopBtn').addEventListener('click', async function () {
  const result = await ipcRenderer.invoke('window:toggle-always-on-top');
  this.classList.toggle('active', !!(result && result.alwaysOnTop));
});
document.getElementById('minimizeBtn').addEventListener('click', function () {
  ipcRenderer.send('window:minimize');
});
document.getElementById('maximizeBtn').addEventListener('click', function () {
  ipcRenderer.invoke('window:toggle-maximize');
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
  elements.memory.textContent = total === null ? '内存状态暂不可用' : '当前约使用 ' + total + ' MB';
});

ipcRenderer.send('manager:ready');
renderProfiles();
