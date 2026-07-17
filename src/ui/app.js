// v4.9.2: Dynamic scale — set <html> font-size based on screen width so the
// whole UI (built in rem) grows on larger/higher-DPI displays. Mirrors the
// @media breakpoints in CSS as a JS fallback (window.screen.width is the
// physical display width, more reliable than innerWidth for an Electron window).
(function applyDynamicScale() {
  var w = window.screen && window.screen.width ? window.screen.width : window.innerWidth;
  var base = 14;
  if (w >= 2560) base = 18;
  else if (w >= 1920) base = 16;
  else if (w >= 1366) base = 15;
  document.documentElement.style.fontSize = base + 'px';
})();

const { ipcRenderer } = require('electron');
const REGIONS = {
  br: 'BR',
  na: 'NA',
  eu: 'EU',
  hk: 'HK',
  de: 'DE',
  es: 'ES',
  pl: 'PL',
  fr: 'FR'
};

window.api = {
  getMemoryStats: () => ipcRenderer.invoke('memory:stats'),
  forceGC: () => ipcRenderer.invoke('memory:force-gc'),
  getWebviewStats: () => ipcRenderer.invoke('memory:webview-stats'),
  fetchServers: r => ipcRenderer.invoke('servers:fetch', r),
  // v4.9: Tempmail + API Login + Network Inspector
  createTempmail: opts => ipcRenderer.invoke('tempmail:create', opts),
  apiLogin: (pid, email, pwd) => ipcRenderer.invoke('tempmail:login', pid, email, pwd),
  getServers: (uid, gc) => ipcRenderer.invoke('tempmail:servers', uid, gc),
  checkSession: pid => ipcRenderer.invoke('session:check', pid),
  inspectorEnable: pid => ipcRenderer.invoke('inspector:enable', pid),
  inspectorDisable: pid => ipcRenderer.invoke('inspector:disable', pid),
  inspectorEntries: (pid, filter) => ipcRenderer.invoke('inspector:entries', pid, filter),
  inspectorClear: pid => ipcRenderer.invoke('inspector:clear', pid),
  // v4.9.1: DevTools helpers
  getPageSource: pid => ipcRenderer.invoke('dev:get-page-source', pid),
  getCookies: pid => ipcRenderer.invoke('dev:get-cookies', pid),
  reloadGame: pid => ipcRenderer.invoke('dev:reload-game', pid),
  toggleDevTools: pid => ipcRenderer.invoke('dev:toggle-devtools', pid),
  // v4.9.2: Export diagnostics zip (logs + config + system info, sanitized)
  exportDiag: () => ipcRenderer.invoke('diagnostics:export')
};

let profiles = [];
let selectedRegion = 'br';
let editingId = null;
let vaultId = null;
let notificationsMuted = false;
let searchQuery = '';
// v4.5: Track open game windows and auto-login status per profile (real-time)
let openWindows = {}; // { profileId: true }
let autoLoginStatus = {}; // { profileId: 'idle'|'loading'|'success'|'error' }
// v4.6: Sort mode, persisted in localStorage
let sortMode = localStorage.getItem('shinobi-sort-mode') || 'favorite';
// v4.6: i18n strings (loaded from main process on init)
let i18nStrings = {};
let currentLang = 'pt';

// v4.6: i18n helper — t(key) returns translated string
function t(key) {
  return i18nStrings[key] || key;
}

// v4.6: Apply i18n to all elements with data-i18n attribute
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

// ── IPC ──
ipcRenderer.on('profiles:updated', (_e, list) => {
  profiles = list;
  renderProfiles();
  renderRegionTabs();
  populateDevProfileSelects();
});
ipcRenderer.on('events:update', (_e, data) => renderEvents(data));
ipcRenderer.on('profile:toast', (_e, t) => toast(t.msg, t.type));
ipcRenderer.on('auto-login:result', (_e, data) => {
  var p = profiles.find(function (x) {
    return x.id === data.profileId;
  });
  var name = p ? p.name : data.profileId;
  if (data.result === 'filled') {
    toast('Auto-login: credenciais injetadas (' + name + ')', 'ok');
  } else if (data.result === 'clicked') {
    toast('Auto-login: botão clicado (' + name + ')', 'ok');
  } else if (data.result === 'error') {
    toast('Auto-login: erro (' + name + ')', 'err');
  }
});
// v4.5: Real-time status updates for auto-login and window open state
ipcRenderer.on('auto-login:status', (_e, data) => {
  if (!data || !data.profileId) return;
  autoLoginStatus[data.profileId] = data.status || 'idle';
  // Update only the affected card's badge (no full re-render needed)
  var badge = document.querySelector('[data-card-id="' + data.profileId + '"] .autologin-badge');
  if (badge) updateStatusBadge(badge, data.status, getStatusLabel(data.status));
});
ipcRenderer.on('game-window:status', (_e, data) => {
  if (!data || !data.profileId) return;
  if (data.open) openWindows[data.profileId] = true;
  else {
    delete openWindows[data.profileId];
    delete autoLoginStatus[data.profileId];
  }
  // Update the affected card's window badge
  var card = document.querySelector('[data-card-id="' + data.profileId + '"]');
  if (card) {
    var winBadge = card.querySelector('.window-badge');
    if (winBadge) {
      if (data.open) {
        winBadge.style.display = 'inline-flex';
        winBadge.className = 'status-badge open window-badge';
        winBadge.innerHTML = '<span class="dot"></span> aberta';
      } else {
        winBadge.style.display = 'none';
      }
    }
  }
});

// ── Navigation ──
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    document.getElementById('viewTitle').textContent = item.textContent.trim();
    if (view === 'settings') loadSettings();
  });
});

// ── Search ──
document.getElementById('searchInput').oninput = function () {
  searchQuery = this.value.trim().toLowerCase();
  document.getElementById('searchClear').style.display = searchQuery ? 'flex' : 'none';
  renderProfiles();
};

document.getElementById('searchClear').onclick = function () {
  document.getElementById('searchInput').value = '';
  searchQuery = '';
  this.style.display = 'none';
  renderProfiles();
};

// ── Render: Profiles ──
function renderProfiles() {
  const grid = document.getElementById('profileGrid');
  grid.className = 'grid';
  let filtered = profiles;
  if (searchQuery) {
    filtered = profiles.filter(function (p) {
      var name = (p.name || '').toLowerCase();
      var server = (p.server || '').toLowerCase();
      var regionCode = (REGIONS[p.region] || '').toLowerCase();
      var regionKey = (p.region || '').toLowerCase();
      var notes = (p.notes || '').toLowerCase();
      return (
        name.indexOf(searchQuery) !== -1 ||
        server.indexOf(searchQuery) !== -1 ||
        regionCode.indexOf(searchQuery) !== -1 ||
        regionKey.indexOf(searchQuery) !== -1 ||
        notes.indexOf(searchQuery) !== -1
      );
    });
  }
  // v4.6: Apply sorting
  filtered = applySorting(filtered);
  // v4.6: Update account count
  var countEl = document.getElementById('accountCount');
  if (countEl) {
    var total = profiles.length;
    var shown = filtered.length;
    countEl.textContent = searchQuery
      ? shown + '/' + total
      : total + (total === 1 ? ' conta' : ' contas');
  }
  if (!profiles.length) {
    grid.innerHTML =
      '<div class="empty">' +
      '<div class="empty-shuriken"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1"><path d="M24 2L27 18Q24 20 24 20Q24 20 21 18Z" fill="currentColor" opacity=".7"/><path d="M24 2L27 18Q24 20 24 20Q24 20 21 18Z" fill="currentColor" opacity=".7" transform="rotate(90 24 24)"/><path d="M24 2L27 18Q24 20 24 20Q24 20 21 18Z" fill="currentColor" opacity=".7" transform="rotate(180 24 24)"/><path d="M24 2L27 18Q24 20 24 20Q24 20 21 18Z" fill="currentColor" opacity=".7" transform="rotate(270 24 24)"/></svg></div>' +
      '<h3>Nenhuma conta</h3>' +
      '<p>Crie sua primeira conta para começar a jogar.</p>' +
      '<button class="btn primary" id="emptyNewBtn">Nova conta</button>' +
      '</div>';
    var emptyBtn = document.getElementById('emptyNewBtn');
    if (emptyBtn)
      emptyBtn.addEventListener('click', function () {
        document.getElementById('newBtn').click();
      });
    return;
  }
  if (!filtered.length) {
    grid.innerHTML =
      '<div class="no-results">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>' +
      '<p>Nenhum resultado para "' +
      esc(searchQuery) +
      '"</p>' +
      '</div>';
    return;
  }
  grid.innerHTML = '';
  filtered.forEach(function (p, idx) {
    const card = document.createElement('div');
    card.tabIndex = 0;
    card.style.animationDelay = idx * 60 + 'ms';
    var favClass = p.favorite ? ' fav-card' : '';
    card.className =
      'card' +
      (p.hasVault ? ' has-vault' : '') +
      favClass +
      (batchSelected.has(p.id) ? ' batch-selected' : '');
    card.setAttribute('data-card-id', p.id);
    // v4.5: Build stats display (launch count, play time, last used)
    var launchCount = p.launchCount || 0;
    var playMs = p.totalPlayMs || 0;
    var lastUsed = p.lastUsed || 0;
    var statsHtml = '';
    if (launchCount > 0 || playMs > 0) {
      statsHtml = '<div class="card-stats">';
      if (launchCount > 0) {
        statsHtml +=
          '<div class="stat-item" title="Número de vezes que esta conta foi lançada">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
          '<span class="val">' +
          launchCount +
          'x</span>' +
          '</div>';
      }
      if (playMs > 0) {
        statsHtml +=
          '<div class="stat-item" title="Tempo total de jogo">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          '<span class="val">' +
          formatPlayTime(playMs) +
          '</span>' +
          '</div>';
      }
      // v5.4: Last played relative time chip
      if (lastUsed > 0) {
        var rel = formatRelativeTime(lastUsed);
        statsHtml +=
          '<div class="stat-item last-played-chip ' +
          (rel.recent ? 'recent' : 'stale') +
          '" title="Última vez jogada: ' +
          new Date(lastUsed).toLocaleString('pt-BR') +
          '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          '<span class="val">' +
          rel.label +
          '</span>' +
          '</div>';
      }
      statsHtml += '</div>';
    }
    // v4.5: Build server dropdown (quick switcher)
    var serverOptionsHtml = buildServerOptions(p.server);
    var serverHtml =
      '<div class="server-switch" title="Trocar servidor rapidamente">' +
      '<select data-act="switch-server" onclick="event.stopPropagation()">' +
      serverOptionsHtml +
      '</select>' +
      '</div>';
    // v4.5: Build notes display (if exists)
    var notesHtml = '';
    if (p.notes) {
      notesHtml =
        '<div class="card-notes" title="' +
        esc(p.notes) +
        '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        esc(p.notes) +
        '</div>';
    }
    // v4.5: Build auto-login status badge (only if vault enabled)
    var autoLoginBadgeHtml = '';
    if (p.hasVault) {
      var currentStatus = autoLoginStatus[p.id] || 'idle';
      var label = getStatusLabel(currentStatus);
      autoLoginBadgeHtml =
        '<span class="status-badge ' +
        currentStatus +
        ' autologin-badge" title="Status do auto-login">' +
        '<span class="dot"></span> ' +
        label +
        '</span>';
    }
    // v4.5: Build window-open badge (only if window is open)
    var windowBadgeHtml = '';
    if (openWindows[p.id]) {
      windowBadgeHtml =
        '<span class="status-badge open window-badge"><span class="dot"></span> aberta</span>';
    } else {
      windowBadgeHtml =
        '<span class="status-badge open window-badge" style="display:none"><span class="dot"></span> aberta</span>';
    }
    // v4.6: Favorite button (star)
    var favBtnHtml =
      '<button class="btn sm btn-icon-only fav-action' +
      (p.favorite ? ' fav' : '') +
      '" data-act="fav" data-tip="' +
      (p.favorite ? 'Desfavoritar' : 'Favoritar') +
      '" title="' +
      (p.favorite ? 'Desfavoritar' : 'Favoritar') +
      '">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="' +
      (p.favorite ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
      '</button>';
    // v4.6: Duplicate button
    var dupBtnHtml =
      '<button class="btn sm btn-icon-only dup-action" data-act="dup" data-tip="Duplicar" title="Duplicar">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '</button>';
    // v5.1: Batch checkbox
    var batchCheckHtml =
      '<div class="card-batch-check" data-batch-id="' +
      p.id +
      '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>';
    card.innerHTML = `
      ${batchCheckHtml}
      <div class="card-head">
        <div class="card-avatar">${esc(p.name.charAt(0).toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div class="name">${esc(p.name)}${p.hasVault ? '<span class="lock" title="Auto-login ativo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>' : ''}</div>
          <div class="region" style="margin-top:.1rem">${REGIONS[p.region] || '—'}</div>
        </div>
      </div>
      <div class="card-body">
        ${serverHtml}
      </div>
      ${notesHtml}
      <div class="card-badges">
        ${p.hasVault ? '<span class="badge ok">auto-login</span>' : ''}
        ${autoLoginBadgeHtml}
        ${windowBadgeHtml}
      </div>
      ${statsHtml}
      <div class="card-actions">
        <button class="btn sm btn-play" data-act="launch"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play</button>
        <div class="secondary-actions">
          ${favBtnHtml}
          ${dupBtnHtml}
          <button class="btn sm btn-icon-only" data-act="edit" data-tip="Editar" title="Editar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn sm btn-icon-only" data-act="vault" data-tip="Credenciais" title="Credenciais"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
          <button class="btn sm btn-icon-only" data-act="del" data-tip="Excluir" title="Excluir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      </div>`;
    card.addEventListener('click', () => launch(p.id));
    card.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'launch') launch(p.id);
        else if (act === 'edit') edit(p.id);
        else if (act === 'vault') openVault(p.id);
        else if (act === 'del') del(p.id);
        else if (act === 'fav') toggleFavorite(p.id);
        else if (act === 'dup') duplicateProfile(p.id);
        else if (act === 'switch-server') {
          /* handled by onchange */
        }
      });
    });
    // v5.1: Batch checkbox handler
    var batchCheck = card.querySelector('.card-batch-check');
    if (batchCheck) {
      batchCheck.addEventListener('click', function (e) {
        e.stopPropagation();
        if (batchSelected.has(p.id)) {
          batchSelected.delete(p.id);
          batchCheck.classList.remove('checked');
        } else {
          batchSelected.add(p.id);
          batchCheck.classList.add('checked');
        }
        updateBatchBar();
      });
      if (batchSelected.has(p.id)) batchCheck.classList.add('checked');
    }
    // v4.5: Server switcher handler
    var serverSelect = card.querySelector('select[data-act="switch-server"]');
    if (serverSelect) {
      serverSelect.addEventListener('change', function (e) {
        e.stopPropagation();
        var newServer = this.value;
        ipcRenderer.send('profile:update', { id: p.id, server: newServer });
        toast('Servidor trocado para ' + newServer, 'ok');
      });
      serverSelect.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }
    grid.appendChild(card);
  });
}

// v4.6: Apply sorting to filtered profiles list
function applySorting(list) {
  var sorted = list.slice(); // clone to avoid mutating original
  switch (sortMode) {
    case 'favorite':
      sorted.sort(function (a, b) {
        if (!!a.favorite !== !!b.favorite) return b.favorite ? 1 : -1;
        // Favorites first, then by name as tiebreaker
        return (a.name || '').localeCompare(b.name || '');
      });
      break;
    case 'name':
      sorted.sort(function (a, b) {
        return (a.name || '').localeCompare(b.name || '');
      });
      break;
    case 'lastUsed':
      sorted.sort(function (a, b) {
        return (b.lastUsed || 0) - (a.lastUsed || 0);
      });
      break;
    case 'launchCount':
      sorted.sort(function (a, b) {
        return (b.launchCount || 0) - (a.launchCount || 0);
      });
      break;
    case 'totalPlayMs':
      sorted.sort(function (a, b) {
        return (b.totalPlayMs || 0) - (a.totalPlayMs || 0);
      });
      break;
    case 'region':
      sorted.sort(function (a, b) {
        var r = (a.region || '').localeCompare(b.region || '');
        return r !== 0 ? r : (a.name || '').localeCompare(b.name || '');
      });
      break;
    case 'createdAt':
      sorted.sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      break;
    default:
      // No sort — keep original order
      break;
  }
  return sorted;
}

// v4.6: Toggle favorite status of a profile
async function toggleFavorite(id) {
  var p = profiles.find(function (x) {
    return x.id === id;
  });
  if (!p) return;
  var newState = !p.favorite;
  await ipcRenderer.invoke('profile:set-favorite', id, newState);
  // Optimistic UI: update local state immediately
  p.favorite = newState;
  renderProfiles();
  toast(newState ? 'Perfil favoritado' : 'Perfil desfavoritado', 'ok');
}

// v4.6: Duplicate a profile (without credentials)
async function duplicateProfile(id) {
  var p = profiles.find(function (x) {
    return x.id === id;
  });
  var pName = p ? p.name : id;
  var r = await ipcRenderer.invoke('profile:duplicate', id);
  if (r.ok) {
    toast('Perfil duplicado: ' + pName + ' (cópia)', 'ok');
  } else {
    toast('Erro ao duplicar: ' + (r.error || 'desconhecido'), 'err');
  }
}

// v4.5: Helper — format play time (ms → human readable)
function formatPlayTime(ms) {
  if (!ms || ms < 1000) return '0s';
  var seconds = Math.floor(ms / 1000);
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return hours + 'h ' + (minutes > 0 ? minutes + 'm' : '');
  if (minutes > 0) return minutes + 'm';
  return seconds + 's';
}

// v4.5: Helper — get human label for auto-login status
function getStatusLabel(status) {
  switch (status) {
    case 'loading':
      return 'preenchendo';
    case 'success':
      return 'logado';
    case 'error':
      return 'falhou';
    case 'idle':
    default:
      return 'pronto';
  }
}

// v4.5: Helper — update a status badge element in place (no re-render)
function updateStatusBadge(el, status, label) {
  if (!el) return;
  el.className = 'status-badge ' + (status || 'idle') + ' autologin-badge';
  el.innerHTML = '<span class="dot"></span> ' + (label || getStatusLabel(status));
}

// v4.5: Helper — build <option> list for server dropdown (S1-S50 + custom)
function buildServerOptions(currentServer) {
  var current = (currentServer || '').toUpperCase().replace(/^S/i, '');
  var currentNum = parseInt(current, 10);
  var html = '';
  var common = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 100, 200, 500, 799, 999, 9999
  ];
  // If current server is not in the common list, add it first
  if (currentNum && common.indexOf(currentNum) === -1) {
    html += '<option value="S' + currentNum + '">S' + currentNum + ' (atual)</option>';
  }
  common.forEach(function (n) {
    var isCurrent = n === currentNum;
    html +=
      '<option value="S' +
      n +
      '"' +
      (isCurrent ? ' selected' : '') +
      '>S' +
      n +
      (isCurrent ? ' (atual)' : '') +
      '</option>';
  });
  // If no current server, show placeholder
  if (!currentNum) {
    html = '<option value="" selected>sem servidor</option>' + html;
  }
  return html;
}

// ── Render: Events ──
function renderRegionTabs() {
  const tabs = document.getElementById('regionTabs');
  const active = [...new Set(profiles.map(p => p.region))];
  const regions = active.length ? active : ['br'];
  if (!regions.includes(selectedRegion)) selectedRegion = regions[0];
  tabs.innerHTML = '';
  regions.forEach(r => {
    const t = document.createElement('span');
    t.className = 'tab' + (r === selectedRegion ? ' active' : '');
    t.textContent = REGIONS[r] || r;
    t.addEventListener('click', () => {
      selectedRegion = r;
      renderRegionTabs();
      ipcRenderer.invoke('events:get', selectedRegion).then(renderEventsSingle);
    });
    tabs.appendChild(t);
  });
}

function renderEvents(data) {
  if (!data || !data.byRegion) return;
  renderEventsSingle(data.byRegion[selectedRegion] || data.byRegion['br'] || []);
}

function renderEventsSingle(list) {
  const el = document.getElementById('eventList');
  if (!list || !list.length) {
    el.innerHTML =
      '<div style="color:var(--text-faint);text-align:center;padding:3rem;font-size:var(--font-sm)">Nenhum evento.</div>';
    return;
  }
  el.innerHTML = '';
  list.slice(0, 10).forEach(ev => {
    const item = document.createElement('div');
    item.className = 'event';
    item.innerHTML = `<div class="info"><div class="n">${esc(ev.name)}</div><div class="t">${ev.userTimeLabel || ''}</div></div><div class="cd">${ev.nextFireLabel || ''}</div>`;
    el.appendChild(item);
  });
}

// ── Actions ──
function launch(id) {
  ipcRenderer.send('profile:launch', id);
  var p = profiles.find(function (x) {
    return x.id === id;
  });
  if (p) {
    localStorage.setItem('shinobi-last-profile', id);
  }
}
function edit(id) {
  const p = profiles.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = 'Editar conta';
  document.getElementById('fName').value = p.name;
  document.getElementById('fServer').value = p.server;
  document.getElementById('fRegion').value = p.region;
  // v4.5: load notes
  var notesEl = document.getElementById('fNotes');
  notesEl.value = p.notes || '';
  updateNotesCounter();
  // v5.9.3: hide auto-create button in edit mode
  document.getElementById('autoCreateBtn').style.display = 'none';
  document.getElementById('profileModal').classList.add('show');
}
async function del(id) {
  if (!confirm('Excluir esta conta? Cookies e credenciais serão apagados.')) return;
  ipcRenderer.send('profile:delete', id);
  // If last profile was this one, clear
  if (localStorage.getItem('shinobi-last-profile') === id) {
    localStorage.removeItem('shinobi-last-profile');
  }
}
async function openVault(id) {
  const p = profiles.find(x => x.id === id);
  if (!p) return;
  vaultId = id;
  document.getElementById('vaultProfileName').textContent =
    p.name + (p.server ? ' • ' + p.server : '');
  const creds = await ipcRenderer.invoke('vault:get', id);
  document.getElementById('fVaultUser').value = creds ? creds.user : '';
  document.getElementById('fVaultPass').value = creds ? creds.pass : '';
  // Reset password visibility
  document.getElementById('fVaultPass').type = 'password';
  document.getElementById('eyeIcon').innerHTML =
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  document.getElementById('vaultModal').classList.add('show');
}

// ── Modal: Profile ──
document.getElementById('newBtn').onclick = () => {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Nova conta';
  document.getElementById('fName').value = '';
  document.getElementById('fServer').value = '';
  document.getElementById('fRegion').value = 'br';
  // v4.5: clear notes
  document.getElementById('fNotes').value = '';
  updateNotesCounter();
  // v5.9.3: show auto-create button in create mode
  document.getElementById('autoCreateBtn').style.display = '';
  document.getElementById('profileModal').classList.add('show');
};
document.getElementById('cancelProfile').onclick = () =>
  document.getElementById('profileModal').classList.remove('show');
document.getElementById('saveProfile').onclick = () => {
  const opts = {
    name: document.getElementById('fName').value.trim(),
    server: document.getElementById('fServer').value.trim(),
    region: document.getElementById('fRegion').value,
    notes: document.getElementById('fNotes').value.trim() // v4.5: save notes
  };
  if (!opts.name) {
    toast('Informe um nome', 'err');
    return;
  }
  if (editingId) {
    ipcRenderer.send('profile:update', Object.assign({ id: editingId }, opts));
  } else {
    ipcRenderer.send('profile:create', opts);
  }
  document.getElementById('profileModal').classList.remove('show');
};

// v5.9.3: Auto-create account — tempmail + register + vault + auto-login
document.getElementById('autoCreateBtn').onclick = async function () {
  var name = document.getElementById('fName').value.trim();
  var server = document.getElementById('fServer').value.trim();
  var region = document.getElementById('fRegion').value;
  if (!name) {
    toast('Informe um nome', 'err');
    return;
  }
  if (!server) {
    toast('Informe o servidor (ex.: S799)', 'err');
    return;
  }
  if (editingId) {
    toast('Use "Salvar" para editar perfis existentes', 'err');
    return;
  }
  var btn = document.getElementById('autoCreateBtn');
  var originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Criando…';
  try {
    var result = await window.api.createTempmail({
      name: name,
      server: server,
      region: region,
      language: currentLang || 'pt'
    });
    if (result && result.ok) {
      document.getElementById('profileModal').classList.remove('show');
    }
  } catch (e) {
    toast('Falha ao criar conta: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// v4.5: Notes char counter
function updateNotesCounter() {
  var el = document.getElementById('fNotes');
  var counter = document.getElementById('notesCounter');
  if (!el || !counter) return;
  var len = el.value.length;
  counter.textContent = len + ' / 200';
  counter.classList.toggle('warn', len > 180);
}
document.getElementById('fNotes').oninput = updateNotesCounter;

// ── Modal: Vault ──
document.getElementById('cancelVault').onclick = () =>
  document.getElementById('vaultModal').classList.remove('show');
document.getElementById('saveVault').onclick = async () => {
  const u = document.getElementById('fVaultUser').value;
  const p = document.getElementById('fVaultPass').value;
  if (!u || !p) {
    toast('Usuário e senha obrigatórios', 'err');
    return;
  }
  await ipcRenderer.invoke('vault:set', vaultId, u, p);
  toast('Credenciais salvas', 'ok');
  document.getElementById('vaultModal').classList.remove('show');
};
document.getElementById('removeVault').onclick = async () => {
  if (!confirm('Remover credenciais?')) return;
  await ipcRenderer.invoke('vault:remove', vaultId);
  toast('Credenciais removidas', 'ok');
  document.getElementById('vaultModal').classList.remove('show');
};

// ── Password visibility toggle ──
document.getElementById('togglePass').onclick = function () {
  const inp = document.getElementById('fVaultPass');
  const icon = document.getElementById('eyeIcon');
  if (inp.type === 'password') {
    inp.type = 'text';
    icon.innerHTML =
      '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    inp.type = 'password';
    icon.innerHTML =
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
};

// ── Settings ──
async function loadSettings() {
  document.getElementById('setNotifications').classList.toggle('on', !notificationsMuted);
}

// v4.7: Encrypted backup (uses existing IPC handlers from controller.js)
document.getElementById('advBackupExport').onclick = async function () {
  var pwd = prompt('Digite uma senha para criptografar o backup (mín. 6 caracteres):');
  if (!pwd) return;
  if (pwd.length < 6) {
    toast('Senha muito curta', 'err');
    return;
  }
  this.disabled = true;
  this.textContent = 'Exportando...';
  try {
    var res = await ipcRenderer.invoke('profiles:export-encrypted', pwd);
    if (res && res.ok) {
      toast('Backup salvo: ' + res.count + ' perfis', 'ok');
    } else if (res && res.canceled) {
      // user canceled save dialog
    } else {
      toast('Erro: ' + (res && res.error ? res.error : 'falha'), 'err');
    }
  } catch (e) {
    toast('Erro: ' + e.message, 'err');
  }
  this.disabled = false;
  this.textContent = 'Exportar';
};

document.getElementById('advBackupImport').onclick = async function () {
  var pwd = prompt('Digite a senha do backup:');
  if (!pwd) return;
  this.disabled = true;
  this.textContent = 'Importando...';
  try {
    var res = await ipcRenderer.invoke('profiles:import-encrypted', pwd);
    if (res && res.ok) {
      toast('Importados: ' + res.imported + ' | Ignorados: ' + res.skipped, 'ok');
    } else if (res && res.canceled) {
      // user canceled open dialog
    } else {
      toast('Erro: ' + (res && res.error ? res.error : 'falha'), 'err');
    }
  } catch (e) {
    toast('Erro: ' + e.message, 'err');
  }
  this.disabled = false;
  this.textContent = 'Importar';
};

// v4.9.2: Export diagnostics zip — controller handles save dialog + success/error toast
// (emitted via profile:toast IPC). Here we only guard the button state + catch unexpected errors.
document.getElementById('advExportDiag').onclick = async function () {
  this.disabled = true;
  this.textContent = 'Gerando .zip...';
  try {
    await window.api.exportDiag();
  } catch (e) {
    toast('Erro ao exportar diagnóstico: ' + e.message, 'err');
  }
  this.disabled = false;
  this.textContent = 'Exportar .zip';
};

// v4.7: Open GitHub repo
document.getElementById('advAboutRepo').onclick = function (e) {
  e.preventDefault();
  try {
    require('electron').shell.openExternal('https://github.com/Chrispsz/naruto-online-launcher');
  } catch (_) {
    toast('Abra: github.com/Chrispsz/naruto-online-launcher', 'ok');
  }
};

document.getElementById('setNotifications').onclick = function () {
  notificationsMuted = !notificationsMuted;
  this.classList.toggle('on', !notificationsMuted);
  ipcRenderer.send('events:set-muted', notificationsMuted);
  var mb = document.getElementById('muteBtn');
  if (mb) mb.classList.toggle('on', notificationsMuted);
};

document.getElementById('setMode').onchange = function () {
  const desc = document.getElementById('modeDesc');
  if (this.value === 'lowpc') {
    desc.textContent = 'PC Fraco: reduz qualidade do Flash para ganhar FPS';
    desc.style.color = 'var(--warn)';
  } else {
    desc.textContent = 'Padrão: máxima otimização segura';
    desc.style.color = 'var(--text-faint)';
  }
};

// ── Server Selector ──
document.getElementById('btnPickServer').onclick = async () => {
  const region = document.getElementById('fRegion').value;
  const btn = document.getElementById('btnPickServer');
  const hint = document.getElementById('serverHint');
  btn.disabled = true;
  btn.textContent = 'Buscando...';
  hint.textContent = 'Carregando servidores...';
  try {
    const servers = await window.api.fetchServers(region);
    if (!servers || !servers.length) {
      hint.textContent = 'Nenhum servidor encontrado.';
    } else {
      const recent = servers
        .slice(0, 20)
        .map(s => 'S' + s.number)
        .join(' ');
      hint.innerHTML =
        '<strong>Recentes:</strong> ' +
        esc(recent) +
        '<br><span style="color:var(--text-faint);font-size:var(--font-xs)">' +
        servers.length +
        ' servidores total</span>';
    }
  } catch (e) {
    hint.textContent = 'Erro: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = 'Buscar';
};

// ── Keyboard: replaced by v5.1 extended shortcuts handler (see below) ──
// Old v4.8 Esc-only handler removed — all shortcuts now in the unified handler.

// ── Utils ──
function esc(s) {
  return String(s || '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
let toastT;
function toast(msg, type) {
  const t = document.getElementById('toast');
  const iconSvg =
    type === 'ok'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
      : type === 'err'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        : '';
  t.innerHTML =
    (iconSvg ? '<span class="toast-icon">' + iconSvg + '</span>' : '') +
    '<span class="toast-msg">' +
    esc(msg) +
    '</span>' +
    '<div class="toast-progress"></div>';
  t.className = 'toast show ' + (type || '');
  clearTimeout(toastT);
  toastT = setTimeout(function () {
    t.classList.remove('show');
    t.classList.add('hiding');
    setTimeout(function () {
      t.classList.remove('hiding');
    }, 200);
  }, 2800);
}

// ── v4.6: Sort dropdown handler ──
document.getElementById('sortSelect').onchange = function () {
  sortMode = this.value;
  localStorage.setItem('shinobi-sort-mode', sortMode);
  renderProfiles();
};
// Apply initial sort mode on load
(function initSortMode() {
  var sel = document.getElementById('sortSelect');
  if (sel) sel.value = sortMode;
})();

// ── v4.6: i18n initialization (load strings from main process) ──
async function initI18n() {
  try {
    currentLang = await ipcRenderer.invoke('i18n:get-lang');
    i18nStrings = (await ipcRenderer.invoke('i18n:get-all')) || {};
    // Apply translations to elements with data-i18n attributes
    applyI18n();
    // Update language selector in settings
    var setLang = document.getElementById('setLang');
    if (setLang) setLang.value = currentLang;
  } catch (e) {
    // Fallback: use empty strings (keys will show as-is)
    i18nStrings = {};
  }
}

// v4.6: Language change handler in settings
document.getElementById('setLang').onchange = async function () {
  var newLang = this.value;
  await ipcRenderer.invoke('i18n:set-lang', newLang);
  currentLang = newLang;
  i18nStrings = (await ipcRenderer.invoke('i18n:get-all')) || {};
  applyI18n();
  toast('Idioma: ' + (newLang === 'pt' ? 'Português' : newLang.toUpperCase()), 'ok');
};

// ── v4.9: Dev Tools (tempmail + API login + inspector) ──
function populateDevProfileSelects() {
  const opts = profiles
    .map(p => '<option value="' + p.id + '">' + p.name + ' (' + p.username + ')</option>')
    .join('');
  document.getElementById('devApiLoginProfile').innerHTML =
    opts || '<option>(nenhum perfil)</option>';
  document.getElementById('devInspectorProfile').innerHTML =
    opts || '<option>(nenhum perfil)</option>';
  document.getElementById('devSourceProfile').innerHTML =
    opts || '<option>(nenhum perfil)</option>';
}

function initDevTools() {
  populateDevProfileSelects();

  // Tempmail create
  document.getElementById('devTempmailCreate').onclick = async function () {
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Criando...';
    const out = document.getElementById('devTempmailResult');
    out.style.display = 'block';
    out.textContent = 'Criando conta tempmail + registrando no Naruto Online...';
    try {
      const r = await window.api.createTempmail();
      if (r.ok) {
        const d = r.data;
        out.textContent =
          '✓ CONTA CRIADA\n' +
          '═══════════════════════════════════\n' +
          'Email:    ' +
          d.tempmail.address +
          '\n' +
          'Senha:    ' +
          d.tempmail.password +
          '\n' +
          'PlayerID: ' +
          d.game.playerId +
          '\n' +
          'Nickname: ' +
          d.game.nickname +
          '\n' +
          'JWT expira: ' +
          new Date(d.game.expiresAt).toLocaleString('pt-BR') +
          '\n' +
          '═══════════════════════════════════\n' +
          'LoginKey (JWT):\n' +
          d.game.loginKey;
      } else {
        out.textContent = '✗ ERRO: ' + r.error;
      }
    } catch (e) {
      out.textContent = '✗ ERRO: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = 'Criar conta tempmail';
  };

  // API login
  document.getElementById('devApiLoginBtn').onclick = async function () {
    const pid = document.getElementById('devApiLoginProfile').value;
    const email = document.getElementById('devApiLoginEmail').value.trim();
    const pwd = document.getElementById('devApiLoginPass').value;
    const out = document.getElementById('devApiLoginResult');
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    if (!email || !pwd) {
      toast('Email e senha obrigatórios', 'error');
      return;
    }
    out.style.display = 'block';
    out.textContent = 'Autenticando via passport.oasgames.com...';
    try {
      const r = await window.api.apiLogin(pid, email, pwd);
      if (r.ok) {
        out.textContent =
          '✓ LOGIN OK — cookie oas_user injetado\n' +
          '═══════════════════════════════════\n' +
          'PlayerID: ' +
          r.data.playerId +
          '\n' +
          'Nickname: ' +
          r.data.nickname +
          '\n' +
          'Expira em: ' +
          new Date(r.data.expiresAt).toLocaleString('pt-BR') +
          '\n' +
          '═══════════════════════════════════\n' +
          'Agora clique Play no perfil — a sessão já estará autenticada.';
      } else {
        out.textContent = '✗ ERRO: ' + r.error;
      }
    } catch (e) {
      out.textContent = '✗ ERRO: ' + e.message;
    }
  };

  // Session check
  document.getElementById('devSessionCheck').onclick = async function () {
    const pid = document.getElementById('devApiLoginProfile').value;
    const out = document.getElementById('devApiLoginResult');
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    out.style.display = 'block';
    out.textContent = 'Verificando cookie oas_user...';
    try {
      const r = await window.api.checkSession(pid);
      if (r.ok && r.data.valid) {
        const p = r.data.jwtDecoded.payload;
        out.textContent =
          '✓ SESSÃO VÁLIDA\n' +
          'PlayerID: ' +
          p.playerId +
          '\n' +
          'Nickname: ' +
          p.nickname +
          '\n' +
          'Expira em: ' +
          r.data.expiresInSeconds +
          's (' +
          Math.round(r.data.expiresInSeconds / 60) +
          ' min)';
      } else if (r.ok) {
        out.textContent = '✗ Sem sessão válida (cookie ausente ou JWT expirado)';
      } else {
        out.textContent = '✗ ERRO: ' + r.error;
      }
    } catch (e) {
      out.textContent = '✗ ERRO: ' + e.message;
    }
  };

  // Inspector
  let inspectorPoll = null;
  async function refreshInspector() {
    const pid = document.getElementById('devInspectorProfile').value;
    if (!pid) return;
    const r = await window.api.inspectorEntries(pid);
    if (!r.ok) return;
    const statsEl = document.getElementById('devInspectorStats');
    const entriesEl = document.getElementById('devInspectorEntries');
    if (r.data.stats) {
      const s = r.data.stats;
      statsEl.style.display = 'block';
      statsEl.textContent =
        'Requisições: ' +
        s.totalRequests +
        ' (' +
        s.requestsPerMin.toFixed(1) +
        '/min)\n' +
        'Uptime: ' +
        s.uptime +
        's\n' +
        'JWTs capturados: ' +
        s.capturedJwts.length +
        '\n' +
        'Por tipo: auth=' +
        s.byType.auth +
        ' api=' +
        s.byType.api +
        ' game=' +
        s.byType.game +
        ' site=' +
        s.byType.site +
        ' other=' +
        s.byType.other;
    }
    if (r.data.entries.length) {
      entriesEl.style.display = 'block';
      entriesEl.innerHTML = r.data.entries
        .slice(-100)
        .reverse()
        .map(
          e =>
            '<div style="padding:.2rem 0;border-bottom:1px solid var(--border)">' +
            '<span style="color:' +
            (e.kind === 'request' ? 'var(--accent)' : 'var(--ok)') +
            '">[' +
            e.kind +
            ']</span> ' +
            '<span style="color:var(--text-faint)">' +
            new Date(e.timestamp).toLocaleTimeString('pt-BR') +
            '</span> ' +
            '<strong>' +
            e.method +
            '</strong> ' +
            '<span style="color:var(--warn)">' +
            e.type +
            '</span> ' +
            (e.statusCode
              ? '<span style="color:var(--text-faint)">' + e.statusCode + '</span> '
              : '') +
            '<div style="color:var(--text-muted);word-break:break-all">' +
            e.url +
            '</div>' +
            (e.jwt
              ? '<div style="color:var(--ok);font-size:10px">JWT: ' +
                e.jwt.payload.nickname +
                ' (player ' +
                e.jwt.payload.playerId +
                ')</div>'
              : '') +
            '</div>'
        )
        .join('');
    } else {
      entriesEl.style.display = 'block';
      entriesEl.textContent = '(nenhuma captura ainda — abra o jogo neste perfil)';
    }
  }

  document.getElementById('devInspectorEnable').onclick = async function () {
    const pid = document.getElementById('devInspectorProfile').value;
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    const r = await window.api.inspectorEnable(pid);
    if (r.ok) {
      toast('Inspector ativo — abra o jogo', 'info');
      document.getElementById('devInspectorEnable').disabled = true;
      document.getElementById('devInspectorDisable').disabled = false;
      refreshInspector();
      inspectorPoll = setInterval(refreshInspector, 2000);
    } else {
      toast('Inspector falhou: ' + r.error, 'error');
    }
  };

  document.getElementById('devInspectorDisable').onclick = async function () {
    const pid = document.getElementById('devInspectorProfile').value;
    await window.api.inspectorDisable(pid);
    if (inspectorPoll) {
      clearInterval(inspectorPoll);
      inspectorPoll = null;
    }
    document.getElementById('devInspectorEnable').disabled = false;
    document.getElementById('devInspectorDisable').disabled = true;
    toast('Inspector desativado', 'info');
  };

  document.getElementById('devInspectorRefresh').onclick = refreshInspector;
  document.getElementById('devInspectorClear').onclick = async function () {
    const pid = document.getElementById('devInspectorProfile').value;
    await window.api.inspectorClear(pid);
    refreshInspector();
  };

  // v4.9.1: Source Extractor + DevTools + Reload
  const srcOut = document.getElementById('devSourceResult');
  function showSrc(text) {
    srcOut.style.display = 'block';
    srcOut.textContent = text;
  }

  document.getElementById('devExtractSource').onclick = async function () {
    const pid = document.getElementById('devSourceProfile').value;
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    showSrc('Extraindo fonte da página...');
    try {
      const r = await window.api.getPageSource(pid);
      if (r.ok) {
        showSrc(
          'URL: ' +
            r.data.url +
            '\nTitle: ' +
            r.data.title +
            '\nTamanho: ' +
            r.data.size +
            ' chars\n═══════════════════════════════════\n' +
            r.data.source.slice(0, 8000) +
            (r.data.size > 8000 ? '\n... (truncado, ' + r.data.size + ' chars total)' : '')
        );
      } else {
        showSrc('✗ ERRO: ' + r.error);
      }
    } catch (e) {
      showSrc('✗ ERRO: ' + e.message);
    }
  };

  document.getElementById('devListCookies').onclick = async function () {
    const pid = document.getElementById('devSourceProfile').value;
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    showSrc('Listando cookies...');
    try {
      const r = await window.api.getCookies(pid);
      if (r.ok) {
        showSrc(
          'COOKIES (' +
            r.data.length +
            '):\n═══════════════════════════════════\n' +
            r.data
              .map(
                c =>
                  c.name +
                  '=' +
                  c.value +
                  (c.value.length >= 80 ? '...' : '') +
                  '\n  domain=' +
                  c.domain +
                  ' path=' +
                  c.path +
                  ' secure=' +
                  c.secure +
                  ' httpOnly=' +
                  c.httpOnly
              )
              .join('\n')
        );
      } else {
        showSrc('✗ ERRO: ' + r.error);
      }
    } catch (e) {
      showSrc('✗ ERRO: ' + e.message);
    }
  };

  document.getElementById('devReloadGame').onclick = async function () {
    const pid = document.getElementById('devSourceProfile').value;
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    const r = await window.api.reloadGame(pid);
    toast(r.ok ? 'Sessão Flash recarregada (F5)' : 'Erro: ' + r.error, r.ok ? 'ok' : 'error');
  };

  document.getElementById('devToggleDt').onclick = async function () {
    const pid = document.getElementById('devSourceProfile').value;
    if (!pid) {
      toast('Selecione um perfil', 'error');
      return;
    }
    const r = await window.api.toggleDevTools(pid);
    if (!r.ok) toast('Erro: ' + r.error, 'error');
  };
}

// ── SHINOBI_DEBUG feature flag ──
// v5.9.3: Ativação APENAS via env var (boot-time), lida pelo preload.
// O atalho Ctrl+Shift+D e o toggle localStorage foram REMOVIDOS — debug
// agora é opt-in via scripts/debug.sh (abre terminal + seta SHINOBI_DEBUG=1).
// Zero complexidade de UI em launches normais.
// v5.9.9: preload agora expõe __SHINOBI_DEBUG__ como objeto { enabled, isDebug }
// (Electron 11 não aceita boolean primitivo em exposeInMainWorld). Fallback
// para boolean direto mantém compat com builds antigas em cache.
function isDebugActive() {
  var d = window.__SHINOBI_DEBUG__;
  if (d && typeof d === 'object') return d.enabled === true;
  return d === true;
}
function applyDebugVisibility() {
  const sec = document.getElementById('devToolsSection');
  if (!sec) return;
  sec.style.display = isDebugActive() ? '' : 'none';
}
function initDebugFlag() {
  applyDebugVisibility();
}

// ── v5.0: Activity Log (persisted in localStorage) ──
var ACTIVITY_KEY = 'shinobi-activity-log';
var MAX_ACTIVITIES = 50;

function getActivityLog() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function addActivity(type, text) {
  var log = getActivityLog();
  log.unshift({ type: type, text: text, time: Date.now() });
  if (log.length > MAX_ACTIVITIES) log = log.slice(0, MAX_ACTIVITIES);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(log));
  updateEventBadge();
}

// ── v5.0: Notification Badge on Events ──
function updateEventBadge() {
  var badge = document.getElementById('eventBadge');
  if (!badge) return;
  var log = getActivityLog();
  var unread = log.filter(function (item) {
    return Date.now() - item.time < 3600000;
  }).length; // last hour
  if (unread > 0 && !notificationsMuted) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

// ── v5.0: JWT Decoder Widget ──
function decodeJWT(token) {
  var parts = token.trim().split('.');
  if (parts.length !== 3)
    return { error: 'Token inválido — JWT deve ter 3 partes separadas por ponto.' };
  try {
    var header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var exp = payload.exp ? new Date(payload.exp * 1000) : null;
    var iat = payload.iat ? new Date(payload.iat * 1000) : null;
    return { header: header, payload: payload, exp: exp, iat: iat };
  } catch (e) {
    return { error: 'Falha ao decodificar: ' + e.message };
  }
}

function syntaxHighlightJSON(obj) {
  var json = JSON.stringify(obj, null, 2);
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    function (match) {
      var cls = 'num';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = 'key';
        else cls = 'str';
      } else if (/true|false/.test(match)) cls = 'bool';
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

document.getElementById('jwtDecodeBtn').onclick = function () {
  var token = document.getElementById('jwtInput').value.trim();
  var output = document.getElementById('jwtOutput');
  if (!token) {
    output.className = 'jwt-output show';
    output.innerHTML = '<div class="jwt-error">Cole um token JWT para decodificar.</div>';
    return;
  }
  var result = decodeJWT(token);
  if (result.error) {
    output.className = 'jwt-output show';
    output.innerHTML = '<div class="jwt-error">' + esc(result.error) + '</div>';
    return;
  }
  var now = Date.now();
  var isExpired = result.exp && result.exp.getTime() < now;
  var expiryHtml = '';
  if (result.exp) {
    var label = isExpired ? 'Expirado' : 'Válido';
    var cls = isExpired ? 'expired' : 'valid';
    var relExp = formatRelativeTime(result.exp);
    var timeLeft = isExpired ? 'expirou ' + relExp.label : 'expira em ' + relExp.label;
    expiryHtml =
      '<div class="jwt-expiry ' +
      cls +
      '">' +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ' +
      label +
      ' — ' +
      timeLeft +
      '</div>';
  }
  output.className = 'jwt-output show';
  output.innerHTML =
    '<div class="jwt-section">' +
    '<div class="jwt-section-header"><span class="jwt-section-title">Header</span><button class="jwt-copy-btn" data-copy="' +
    esc(JSON.stringify(result.header)) +
    '">Copiar</button></div>' +
    '<div class="jwt-json">' +
    syntaxHighlightJSON(result.header) +
    '</div>' +
    '</div>' +
    '<div class="jwt-section">' +
    '<div class="jwt-section-header"><span class="jwt-section-title">Payload</span><button class="jwt-copy-btn" data-copy="' +
    esc(JSON.stringify(result.payload)) +
    '">Copiar</button></div>' +
    '<div class="jwt-json">' +
    syntaxHighlightJSON(result.payload) +
    '</div>' +
    expiryHtml +
    '</div>';
  // Copy button handlers
  output.querySelectorAll('.jwt-copy-btn').forEach(function (btn) {
    btn.onclick = function () {
      var text = btn.getAttribute('data-copy');
      clipboardWrite(text);
      toast('Copiado!', 'ok');
    };
  });
};

function clipboardWrite(text) {
  try {
    require('electron').clipboard.writeText(text);
  } catch (e) {
    // Fallback
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// ── v5.0: Copy-to-clipboard for dev result boxes ──
function initCopyButtons() {
  document.querySelectorAll('.dev-result-box').forEach(function (box) {
    if (box.querySelector('.copy-float')) return;
    var btn = document.createElement('button');
    btn.className = 'copy-float';
    btn.textContent = 'Copiar';
    btn.onclick = function () {
      clipboardWrite(box.textContent || '');
      toast('Conteúdo copiado!', 'ok');
    };
    box.style.position = 'relative';
    box.insertBefore(btn, box.firstChild);
  });
}

// ── v5.0: Activity tracking hooks ──
var origLaunch = launch;
launch = function (id) {
  var p = profiles.find(function (x) {
    return x.id === id;
  });
  if (p)
    addActivity('launch', 'Jogo lançado: <strong>' + esc(p.name) + '</strong> (' + p.server + ')');
  origLaunch(id);
};

// Track which profiles were open in last session for relaunch-all
var LAST_SESSION_KEY = 'shinobi-last-session';
ipcRenderer.on('game-window:status', function (_e, data) {
  if (!data || !data.profileId) return;
  var lastSession = JSON.parse(localStorage.getItem(LAST_SESSION_KEY) || '[]');
  if (data.open) {
    if (lastSession.indexOf(data.profileId) === -1) lastSession.push(data.profileId);
  } else {
    lastSession = lastSession.filter(function (id) {
      return id !== data.profileId;
    });
  }
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(lastSession));
});

// Track auto-login results as activities
ipcRenderer.on('auto-login:result', function (_e, data) {
  var p = profiles.find(function (x) {
    return x.id === data.profileId;
  });
  var name = p ? p.name : data.profileId;
  if (data.result === 'filled' || data.result === 'clicked') {
    addActivity('login', 'Auto-login: <strong>' + esc(name) + '</strong> autenticado');
  } else if (data.result === 'error') {
    addActivity('error', 'Auto-login falhou: <strong>' + esc(name) + '</strong>');
  }
});

// ── v5.1: Batch Operations ──
var batchMode = false;
var batchSelected = new Set();

document.getElementById('batchModeBtn').onclick = function () {
  batchMode = !batchMode;
  this.classList.toggle('on', batchMode);
  document.getElementById('profileGrid').classList.toggle('batch-mode', batchMode);
  if (!batchMode) {
    batchSelected.clear();
    updateBatchBar();
  }
  renderProfiles();
};

function updateBatchBar() {
  var bar = document.getElementById('batchBar');
  var count = document.getElementById('batchCount');
  if (batchMode && batchSelected.size > 0) {
    bar.classList.add('show');
    count.textContent = batchSelected.size + ' selecionado' + (batchSelected.size > 1 ? 's' : '');
  } else {
    bar.classList.remove('show');
  }
}

document.getElementById('batchSelectAll').onclick = function () {
  if (batchSelected.size === profiles.length) {
    batchSelected.clear();
  } else {
    profiles.forEach(function (p) {
      batchSelected.add(p.id);
    });
  }
  updateBatchBar();
  renderProfiles();
};

document.getElementById('batchCancelBtn').onclick = function () {
  batchMode = false;
  batchSelected.clear();
  document.getElementById('batchModeBtn').classList.remove('on');
  document.getElementById('profileGrid').classList.remove('batch-mode');
  updateBatchBar();
  renderProfiles();
};

document.getElementById('batchExportBtn').onclick = async function () {
  if (!batchSelected.size) return;
  // Export only selected profiles
  var pwd = prompt('Digite uma senha para criptografar o backup (mín. 6 caracteres):');
  if (!pwd) return;
  if (pwd.length < 6) {
    toast('Senha muito curta', 'err');
    return;
  }
  try {
    var res = await ipcRenderer.invoke('profiles:export-encrypted', pwd);
    if (res && res.ok) toast('Backup exportado: ' + res.count + ' perfis', 'ok');
    else if (res && res.error) toast('Erro: ' + res.error, 'err');
  } catch (e) {
    toast('Erro: ' + e.message, 'err');
  }
};

// ── v5.9.3: Keyboard handler simplificado ──
// Atalhos de navegação (1/2/3, Ctrl+N, Ctrl+F, /, ?) e overlay de ajuda
// foram removidos — a sidebar + botões são suficientes. Apenas Esc fecha modais.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.getElementById('profileModal').classList.remove('show');
    document.getElementById('vaultModal').classList.remove('show');
  }
});

// ── v5.2: Drag-and-Drop Profile Reorder ──
var dragSrcId = null;

function initDragDrop() {
  var grid = document.getElementById('profileGrid');
  grid.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.card[data-card-id]');
    if (!card || batchMode) {
      e.preventDefault();
      return;
    }
    dragSrcId = card.getAttribute('data-card-id');
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcId);
  });
  grid.addEventListener('dragend', function (e) {
    var card = e.target.closest('.card[data-card-id]');
    if (card) card.classList.remove('dragging');
    dragSrcId = null;
    // Remove all drag-over states
    grid.querySelectorAll('.drag-over').forEach(function (c) {
      c.classList.remove('drag-over');
    });
  });
  grid.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var card = e.target.closest('.card[data-card-id]');
    if (card && card.getAttribute('data-card-id') !== dragSrcId) {
      // Clear other drag-overs
      grid.querySelectorAll('.drag-over').forEach(function (c) {
        c.classList.remove('drag-over');
      });
      card.classList.add('drag-over');
    }
  });
  grid.addEventListener('dragleave', function (e) {
    var card = e.target.closest('.card[data-card-id]');
    if (card) card.classList.remove('drag-over');
  });
  grid.addEventListener('drop', function (e) {
    e.preventDefault();
    var targetCard = e.target.closest('.card[data-card-id]');
    if (!targetCard || !dragSrcId) return;
    var targetId = targetCard.getAttribute('data-card-id');
    if (targetId === dragSrcId) return;
    // Reorder profiles array
    var srcIdx = profiles.findIndex(function (p) {
      return p.id === dragSrcId;
    });
    var tgtIdx = profiles.findIndex(function (p) {
      return p.id === targetId;
    });
    if (srcIdx === -1 || tgtIdx === -1) return;
    var moved = profiles.splice(srcIdx, 1)[0];
    profiles.splice(tgtIdx, 0, moved);
    // Persist order via IPC
    var order = profiles.map(function (p) {
      return p.id;
    });
    ipcRenderer.send('profile:reorder', order);
    renderProfiles();
    toast('Perfil reposicionado', 'ok');
  });
}

// Make cards draggable after render
var origRenderProfiles = renderProfiles;
renderProfiles = function () {
  origRenderProfiles();
  if (!batchMode) {
    document.querySelectorAll('.card[data-card-id]').forEach(function (card) {
      card.setAttribute('draggable', 'true');
    });
  }
};

// ── v5.2: Batch delete ──
document.getElementById('batchDeleteBtn').onclick = async function () {
  if (!batchSelected.size) return;
  if (
    !confirm(
      'Excluir ' +
        batchSelected.size +
        ' conta(s)? Esta ação é irreversível. Cookies e credenciais serão apagados permanentemente.'
    )
  )
    return;
  batchSelected.forEach(function (id) {
    ipcRenderer.send('profile:delete', id);
  });
  addActivity('info', batchSelected.size + ' conta(s) excluída(s) em lote');
  batchSelected.clear();
  updateBatchBar();
  batchMode = false;
  document.getElementById('batchModeBtn').classList.remove('on');
  document.getElementById('profileGrid').classList.remove('batch-mode');
};

// ── v5.3: Enhanced Event Rendering ──
renderEventsSingle = function (list) {
  var el = document.getElementById('eventList');
  if (!list || !list.length) {
    el.innerHTML =
      '<div style="color:var(--text-faint);text-align:center;padding:3rem;font-size:var(--font-sm)">Nenhum evento.</div>';
    return;
  }
  el.innerHTML = '';
  list.slice(0, 10).forEach(function (ev) {
    var eventType = ev.type || 'daily'; // daily, timed, special, cycle
    var iconSvg = '';
    if (eventType === 'daily') {
      iconSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    } else if (eventType === 'timed') {
      iconSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    } else if (eventType === 'special') {
      iconSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    } else {
      iconSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
    }
    var item = document.createElement('div');
    item.className = 'event';
    item.setAttribute('data-type', eventType);
    item.innerHTML =
      '<div class="event-icon ' +
      eventType +
      '">' +
      iconSvg +
      '</div>' +
      '<div class="info"><div class="n">' +
      esc(ev.name) +
      '</div><div class="t">' +
      (ev.userTimeLabel || '') +
      '</div></div>' +
      '<div class="cd">' +
      (ev.nextFireLabel || '') +
      '</div>';
    el.appendChild(item);
  });
};

// ── v5.4: Relative time helper ──
function formatRelativeTime(ts) {
  if (!ts || ts <= 0) return { label: 'nunca', recent: false };
  var diff = Date.now() - ts;
  if (diff < 0) diff = 0;
  var sec = Math.floor(diff / 1000);
  var min = Math.floor(sec / 60);
  var hr = Math.floor(min / 60);
  var day = Math.floor(hr / 24);
  var label;
  if (sec < 60) label = 'agora';
  else if (min < 60) label = min + 'min atrás';
  else if (hr < 24) label = hr + 'h atrás';
  else if (day === 1) label = 'ontem';
  else if (day < 7) label = day + 'd atrás';
  else if (day < 30) label = Math.floor(day / 7) + 'sem atrás';
  else label = Math.floor(day / 30) + 'mês atrás';
  return { label: label, recent: min < 30 };
}

// ── v5.4: Dev Tools Subsection Collapsible ──
function initDevSubsections() {
  document.querySelectorAll('[data-dev-toggle]').forEach(function (header) {
    header.onclick = function () {
      var body = header.nextElementSibling;
      if (!body) return;
      var collapsed = body.classList.toggle('collapsed');
      header.classList.toggle('collapsed', collapsed);
    };
  });
}

// ── Init ──
ipcRenderer.send('manager:ready');
initI18n();
initDevTools();
initDebugFlag();
initDragDrop();
initDevSubsections();
updateEventBadge();
setTimeout(function () {
  initCopyButtons();
}, 1000);
// v5.4: Refresh relative times + active-7d every minute
setInterval(function () {
  if (profiles.length) {
    renderProfiles();
  }
}, 60000);

// ── v5.7: Advanced Profile Search Filters ──
var searchFilterRegion = '';
var searchFilterVault = '';
function initSearchFilters() {
  // Add region filter dropdown next to sort
  var toolbarRight = document.querySelector('.toolbar-right');
  if (!toolbarRight) return;
  var regionFilter = document.createElement('select');
  regionFilter.id = 'filterRegion';
  regionFilter.className = 'settings-select';
  regionFilter.style.fontSize = 'var(--font-xs)';
  regionFilter.style.padding = '.2rem .4rem';
  regionFilter.innerHTML =
    '<option value="">Todas regiões</option>' +
    '<option value="br">🇧🇷 BR</option>' +
    '<option value="na">🇺🇸 NA</option>' +
    '<option value="eu">🇪🇺 EU</option>' +
    '<option value="hk">🇭🇰 HK</option>';
  regionFilter.onchange = function () {
    searchFilterRegion = this.value;
    renderProfiles();
  };
  var vaultFilter = document.createElement('select');
  vaultFilter.id = 'filterVault';
  vaultFilter.className = 'settings-select';
  vaultFilter.style.fontSize = 'var(--font-xs)';
  vaultFilter.style.padding = '.2rem .4rem';
  vaultFilter.innerHTML =
    '<option value="">Todos</option>' +
    '<option value="yes">Com auto-login</option>' +
    '<option value="no">Sem auto-login</option>';
  vaultFilter.onchange = function () {
    searchFilterVault = this.value;
    renderProfiles();
  };
  toolbarRight.insertBefore(vaultFilter, toolbarRight.firstChild);
  toolbarRight.insertBefore(regionFilter, toolbarRight.firstChild);
}
// v5.8: Single clean patch — apply region/vault filters as a post-render pass.
// (Previous v5.7 had a redundant no-op wrapper plus the real patch; consolidated here.)
var _origRenderProfiles = renderProfiles;
renderProfiles = function () {
  _origRenderProfiles();
  if (!searchFilterRegion && !searchFilterVault) return;
  var grid = document.getElementById('profileGrid');
  if (!grid) return;
  grid.querySelectorAll('.card[data-card-id]').forEach(function (card) {
    var id = card.getAttribute('data-card-id');
    var p = profiles.find(function (x) {
      return x.id === id;
    });
    if (!p) return;
    var hide = false;
    if (searchFilterRegion && p.region !== searchFilterRegion) hide = true;
    if (searchFilterVault === 'yes' && !p.hasVault) hide = true;
    if (searchFilterVault === 'no' && p.hasVault) hide = true;
    card.style.display = hide ? 'none' : '';
  });
};

// ── v5.7: Loading Skeleton ──
function showSkeletonLoader() {
  var grid = document.getElementById('profileGrid');
  if (!grid) return;
  var skeletonHtml = '';
  for (var i = 0; i < 6; i++) {
    skeletonHtml +=
      '<div class="skeleton-card">' +
      '<div class="skel-row"><div class="skel-circle"></div><div style="flex:1"><div class="skel-line w60"></div><div class="skel-line w30"></div></div></div>' +
      '<div class="skel-line w80"></div>' +
      '<div class="skel-line w40"></div>' +
      '</div>';
  }
  grid.innerHTML = '<div class="skeleton-grid">' + skeletonHtml + '</div>';
}

// ── v5.7: New profile bounce animation (v5.8: now actually wired) ──
function markNewProfile(profileId) {
  setTimeout(function () {
    var card = document.querySelector('.card[data-card-id="' + profileId + '"]');
    if (card) {
      card.classList.add('new-profile');
      setTimeout(function () {
        card.classList.remove('new-profile');
      }, 500);
    }
  }, 100);
}

// ── v5.7: Patch profile creation to trigger bounce animation (v5.8: properly wired) ──
// Track the last-created profile name so we can detect it in the next profiles:updated event
// and trigger the bounce animation. The backend creates the profile asynchronously, so we
// can't know the ID at click time — we match by name + recency.
var _pendingNewProfileName = null;
var _pendingNewProfileTs = 0;
(function wireMarkNewProfile() {
  var saveBtn = document.getElementById('saveProfile');
  if (!saveBtn) return;
  saveBtn.addEventListener(
    'click',
    function () {
      // Capture name only if this is a create (not edit) operation
      if (!editingId) {
        var nameEl = document.getElementById('fName');
        if (nameEl && nameEl.value.trim()) {
          _pendingNewProfileName = nameEl.value.trim();
          _pendingNewProfileTs = Date.now();
        }
      }
    },
    true
  ); // capture phase so it runs before the existing handler
})();
// Hook profiles:updated to detect the new profile and animate it
(function hookProfilesUpdatedForNewProfile() {
  ipcRenderer.on('profiles:updated', function () {
    if (!_pendingNewProfileName) return;
    // Only match within 5s of the save click
    if (Date.now() - _pendingNewProfileTs > 5000) {
      _pendingNewProfileName = null;
      return;
    }
    var match = profiles.find(function (p) {
      return p.name === _pendingNewProfileName;
    });
    if (match) {
      markNewProfile(match.id);
      _pendingNewProfileName = null;
    }
  });
})();

// ── v5.7: Init sequence ──
initSearchFilters();
// Show skeleton briefly on first load
showSkeletonLoader();
setTimeout(function () {
  if (profiles.length > 0) renderProfiles();
}, 300);

// ── v5.8: Window Controls (always-on-top + minimize + maximize) ──
async function initWindowControls() {
  var aotBtn = document.getElementById('wcAlwaysOnTop');
  var minBtn = document.getElementById('wcMinimize');
  var maxBtn = document.getElementById('wcMaximize');
  if (!aotBtn || !minBtn || !maxBtn) return;
  // Restore always-on-top state from localStorage (UI hint only; actual state is verified via IPC)
  var savedAot = localStorage.getItem('shinobi-aot') === '1';
  if (savedAot) aotBtn.classList.add('active');
  // Verify actual window state on init
  try {
    var actual = await ipcRenderer.invoke('window:get-always-on-top');
    aotBtn.classList.toggle('active', !!actual);
    if (actual) localStorage.setItem('shinobi-aot', '1');
    else localStorage.removeItem('shinobi-aot');
  } catch (_) {
    /* ignore */
  }
  aotBtn.addEventListener('click', async function () {
    try {
      var res = await ipcRenderer.invoke('window:toggle-always-on-top');
      if (res && res.ok) {
        aotBtn.classList.toggle('active', !!res.alwaysOnTop);
        if (res.alwaysOnTop) localStorage.setItem('shinobi-aot', '1');
        else localStorage.removeItem('shinobi-aot');
        toast(res.alwaysOnTop ? 'Janela fixada acima' : 'Fixação desativada', 'info');
      }
    } catch (e) {
      toast('Erro: ' + e.message, 'err');
    }
  });
  minBtn.addEventListener('click', function () {
    ipcRenderer.send('window:minimize');
  });
  maxBtn.addEventListener('click', async function () {
    try {
      var isMax = await ipcRenderer.invoke('window:toggle-maximize');
      maxBtn.classList.toggle('active', !!isMax);
    } catch (_) {
      /* ignore */
    }
  });
}

// ── v5.8: Favorite star pop animation ──
(function wireFavoritePop() {
  // Wrap the existing toggleFavorite function to add the pop animation
  if (typeof toggleFavorite !== 'function') return;
  var _orig = toggleFavorite;
  toggleFavorite = function (id) {
    var btn = document.querySelector('.card[data-card-id="' + id + '"] .fav-action');
    if (btn) {
      btn.classList.remove('pop');
      // Force reflow so the animation re-triggers
      void btn.offsetWidth;
      btn.classList.add('pop');
    }
    return _orig.apply(this, arguments);
  };
})();

// ── v5.8: Refined view transition + lazy-load Events view data ──
(function wireViewTransitionsV58() {
  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var targetView = item.getAttribute('data-view');
      var view = document.getElementById('view-' + targetView);
      if (!view) return;
      // Remove the v58 class, force reflow, then re-add (re-trigger animation)
      view.classList.remove('view-enter-v58');
      void view.offsetWidth;
      view.classList.add('view-enter-v58');
    });
  });
})();

// ── v5.8: Replace sidebar version text with a version pill ──
(function wireVersionPill() {
  var versionEl = document.getElementById('version');
  if (!versionEl) return;
  var txt = versionEl.textContent.trim();
  if (txt.indexOf('v5.') === 0 || txt.indexOf('v4.') === 0) {
    versionEl.innerHTML = '<span class="version-pill">' + txt + '</span>';
  }
})();

// ── v5.8: Card entrance stagger refinement (use the v58 keyframe) ──
(function wireCardEnterV58() {
  // Hook renderProfiles to add the card-enter-v58 class on new cards
  var orig = renderProfiles;
  renderProfiles = function () {
    orig.apply(this, arguments);
    var cards = document.querySelectorAll('#profileGrid .card:not(.card-enter-v58)');
    cards.forEach(function (card, idx) {
      card.style.animationDelay = idx * 40 + 'ms';
      card.classList.add('card-enter-v58');
    });
  };
})();

// ── v5.8: Init sequence ──
initWindowControls();
