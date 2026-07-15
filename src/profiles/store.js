/**
 * ProfileStore — Armazenamento robusto de perfis (Multi-conta)
 * v2.1.0
 *
 * FILOSOFIA (reavaliada):
 *   O usuário NÃO quer "8 contas simultâneas" por padrão. Ele quer PERFIS:
 *   clica num perfil → abre o jogo com os cookies salvos → joga. Simples.
 *
 *   Multi-conta em tempo real (várias janelas abertas) é recurso SECUNDÁRIO
 *   de power-user, acessível via "Abrir adicional", não o fluxo padrão.
 *
 *   Cada perfil guarda: id, nome (ex: "chris"), servidor (ex: "s799"),
 *   região (BR/NA/EU/HK), cor de identificação, e cookies persistidos
 *   automaticamente pela session partition do Chromium.
 *
 * ROBUSTEZ (correção do que o usuário pediu):
 *   - Atomic write: escreve em .tmp, renomeia. Nunca corrompe se cair luz.
 *   - Backup .bak antes de cada save. Recuperação automática se JSON quebrar.
 *   - Schema validation: cada perfil é validado; inválidos são descartados.
 *   - Limite 1MB no arquivo (saneamento contra corrupção silenciosa).
 *   - Try/catch em TODAS as operações síncronas de I/O.
 *   - Máximo 12 perfis (elevado conforme requisito, mas default é 1 janela ativa).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const logger = require('../utils/logger');

const PROFILES_DIR = 'profiles';
const PROFILES_FILE = 'profiles.json';
const BACKUP_FILE = 'profiles.json.bak';
const MAX_PROFILES = 12;
const MAX_FILE_BYTES = 1024 * 1024; // 1MB sane limit

// Cores para identificação visual rápida (paleta Naruto)
const PALETTE = [
  '#FF8C00', '#DC2626', '#10B981', '#F59E0B',
  '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16',
  '#F97316', '#14B8A6', '#A855F7', '#EAB308',
];

// Schema validator — nunca confiar em dados lidos do disco
// v3.4: adicionado language (pt/en) e notificationsEnabled (boolean) por perfil
// v4.5: adicionado notes (string, max 200), launchCount (number), totalPlayMs (number)
function isValidProfile(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.id !== 'string' || !/^p_[a-f0-9]{8,16}$/.test(p.id)) return false;
  if (typeof p.name !== 'string' || p.name.length === 0 || p.name.length > 40) return false;
  if (typeof p.server !== 'string' || p.server.length > 20) return false;
  if (!['br', 'na', 'eu', 'hk', 'de', 'es', 'pl', 'fr'].includes(p.region)) return false;
  // v3.4: language opcional (default 'pt' para retrocompatibilidade)
  if (p.language !== undefined && !['pt', 'en'].includes(p.language)) return false;
  // v3.4: notificationsEnabled opcional (default true para retrocompatibilidade)
  if (p.notificationsEnabled !== undefined && typeof p.notificationsEnabled !== 'boolean') return false;
  if (typeof p.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color)) return false;
  if (typeof p.createdAt !== 'number' || p.createdAt < 0) return false;
  if (typeof p.lastUsed !== 'number' || p.lastUsed < 0) return false;
  // v4.5: notes opcional (string, max 200 chars)
  if (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 200)) return false;
  // v4.5: launchCount opcional (number, >= 0)
  if (p.launchCount !== undefined && (typeof p.launchCount !== 'number' || p.launchCount < 0 || !isFinite(p.launchCount))) return false;
  // v4.5: totalPlayMs opcional (number, >= 0)
  if (p.totalPlayMs !== undefined && (typeof p.totalPlayMs !== 'number' || p.totalPlayMs < 0 || !isFinite(p.totalPlayMs))) return false;
  // v4.6: favorite opcional (boolean)
  if (p.favorite !== undefined && typeof p.favorite !== 'boolean') return false;
  // v5.3: tags opcional (array de strings, max 5 tags, cada max 20 chars)
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags)) return false;
    if (p.tags.length > 5) return false;
    for (var i = 0; i < p.tags.length; i++) {
      if (typeof p.tags[i] !== 'string' || p.tags[i].length > 20 || p.tags[i].length === 0) return false;
    }
  }
  return true;
}

// Migração automática de perfis v1 (sem language/notificationsEnabled) para v2
// v4.5: Migração v3 (sem notes/launchCount/totalPlayMs) para v3
function _migrateProfile(p) {
  if (!p) return p;
  if (p.language === undefined) p.language = 'pt';
  if (p.notificationsEnabled === undefined) p.notificationsEnabled = true;
  // v4.5: novos campos com defaults seguros
  if (p.notes === undefined) p.notes = '';
  if (p.launchCount === undefined) p.launchCount = 0;
  if (p.totalPlayMs === undefined) p.totalPlayMs = 0;
  // v4.6: favorite flag (default false)
  if (p.favorite === undefined) p.favorite = false;
  // v5.3: tags (default empty array)
  if (p.tags === undefined) p.tags = [];
  return p;
}

let _profiles = null;       // cache em memória
let _listeners = [];

function getDir() {
  return path.join(app.getPath('userData'), PROFILES_DIR);
}

function getFile() {
  return path.join(getDir(), PROFILES_FILE);
}

function getBackupFile() {
  return path.join(getDir(), BACKUP_FILE);
}

function ensureDir() {
  try {
    const dir = getDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    logger.error('ProfileStore: falha ao criar diretório: ' + e.message);
  }
}

/**
 * Carrega perfis do disco com recuperação automática de backup.
 * Sempre retorna um array válido (possivelmente vazio).
 * @returns {Array}
 */
function load() {
  ensureDir();
  const file = getFile();
  const backup = getBackupFile();

  // Tenta arquivo principal
  let parsed = null;
  try {
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) {
        logger.warn('ProfileStore: arquivo muito grande (' + stat.size + ' bytes), descartando');
        throw new Error('oversized');
      }
      const raw = fs.readFileSync(file, 'utf8');
      parsed = JSON.parse(raw);
    }
  } catch (e) {
    logger.error('ProfileStore: JSON principal corrompido: ' + e.message);
    // Tenta backup
    try {
      if (fs.existsSync(backup)) {
        logger.warn('ProfileStore: recuperando do backup .bak');
        const rawBak = fs.readFileSync(backup, 'utf8');
        parsed = JSON.parse(rawBak);
      }
    } catch (e2) {
      logger.error('ProfileStore: backup também corrompido: ' + e2.message);
      parsed = null;
    }
  }

  if (!Array.isArray(parsed)) {
    _profiles = [];
    return _profiles;
  }

  // Valida cada perfil; descarta inválidos silenciosamente
  _profiles = parsed.filter(isValidProfile);
  if (_profiles.length !== parsed.length) {
    logger.warn('ProfileStore: ' + (parsed.length - _profiles.length) + ' perfil(is) inválido(s) descartado(s)');
  }
  // v3.4: migra perfis v1 (sem language/notificationsEnabled) para v2
  let migrated = 0;
  _profiles.forEach(function (p) {
    const before = JSON.stringify({ l: p.language, n: p.notificationsEnabled });
    _migrateProfile(p);
    const after = JSON.stringify({ l: p.language, n: p.notificationsEnabled });
    if (before !== after) migrated++;
  });
  if (migrated > 0) {
    logger.info('ProfileStore: ' + migrated + ' perfil(is) migrado(s) para schema v2 (language + notificationsEnabled)');
    _saveToDisk(_profiles);
  } else if (_profiles.length !== parsed.length) {
    _saveToDisk(_profiles);
  }

  logger.info('ProfileStore: ' + _profiles.length + ' perfil(is) carregado(s)');
  return _profiles;
}

/**
 * Salva perfis no disco de forma atômica com backup.
 * NUNCA lança — captura todas as exceções.
 * @param {Array} profiles
 * @returns {boolean} true se salvou com sucesso
 */
function _saveToDisk(profiles) {
  ensureDir();
  const file = getFile();
  const backup = getBackupFile();
  const tmp = file + '.tmp';

  try {
    const json = JSON.stringify(profiles, null, 2);

    // Limite de tamanho antes de escrever
    if (Buffer.byteLength(json, 'utf8') > MAX_FILE_BYTES) {
      logger.error('ProfileStore: recusa salvar — JSON excede 1MB');
      return false;
    }

    // Backup do atual antes de sobrescrever
    try {
      if (fs.existsSync(file)) {
        fs.copyFileSync(file, backup);
      }
    } catch (e) {
      logger.warn('ProfileStore: não foi possível criar backup: ' + e.message);
    }

    // Atomic write: tmp → rename
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    logger.error('ProfileStore: falha ao salvar: ' + e.message);
    // Tenta limpar tmp órfão
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    return false;
  }
}

/**
 * Persiste o cache atual + notifica listeners.
 */
function persist() {
  if (_profiles === null) return;
  const ok = _saveToDisk(_profiles);
  if (ok) {
    _listeners.forEach(function (cb) {
      try { cb(_profiles); } catch (_) { /* ignore listener errors */ }
    });
  }
}

function getAll() {
  if (_profiles === null) load();
  return _profiles.slice();
}

function get(id) {
  if (_profiles === null) load();
  return _profiles.find(function (p) { return p.id === id; }) || null;
}

function create(opts) {
  if (_profiles === null) load();
  if (_profiles.length >= MAX_PROFILES) {
    logger.warn('ProfileStore: limite de ' + MAX_PROFILES + ' perfis atingido');
    return null;
  }
  opts = opts || {};
  const profile = {
    id: 'p_' + crypto.randomBytes(6).toString('hex'),
    name: String(opts.name || ('Conta ' + (_profiles.length + 1))).slice(0, 40).trim() || 'Conta',
    server: String(opts.server || '').slice(0, 20).trim(),
    region: ['br', 'na', 'eu', 'hk', 'de', 'es', 'pl', 'fr'].includes(opts.region) ? opts.region : 'br',
    language: ['pt', 'en'].includes(opts.language) ? opts.language : 'pt',
    notificationsEnabled: typeof opts.notificationsEnabled === 'boolean' ? opts.notificationsEnabled : true,
    color: (typeof opts.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(opts.color)) ? opts.color : PALETTE[_profiles.length % PALETTE.length],
    // v4.5: novos campos
    notes: typeof opts.notes === 'string' ? opts.notes.slice(0, 200) : '',
    launchCount: 0,
    totalPlayMs: 0,
    // v4.6: favorite flag
    favorite: typeof opts.favorite === 'boolean' ? opts.favorite : false,
    // v5.3: tags (array of strings, max 5, each max 20 chars)
    tags: Array.isArray(opts.tags) ? opts.tags.filter(function(t) { return typeof t === 'string' && t.length > 0 && t.length <= 20; }).slice(0, 5) : [],
    createdAt: Date.now(),
    lastUsed: 0,
  };
  _profiles.push(profile);
  persist();
  logger.info('ProfileStore: perfil criado — ' + profile.name + (profile.server ? ' (' + profile.server + ')' : '') + ' [' + profile.region + '/' + profile.language + ']');
  return profile;
}

function update(id, updates) {
  if (_profiles === null) load();
  const p = _profiles.find(function (x) { return x.id === id; });
  if (!p) return false;
  if (typeof updates.name === 'string') p.name = updates.name.slice(0, 40).trim() || p.name;
  if (typeof updates.server === 'string') p.server = updates.server.slice(0, 20).trim();
  if (['br', 'na', 'eu', 'hk', 'de', 'es', 'pl', 'fr'].includes(updates.region)) p.region = updates.region;
  if (['pt', 'en'].includes(updates.language)) p.language = updates.language;
  if (typeof updates.notificationsEnabled === 'boolean') p.notificationsEnabled = updates.notificationsEnabled;
  if (typeof updates.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(updates.color)) p.color = updates.color;
  // v4.5: notes (string, max 200)
  if (typeof updates.notes === 'string') p.notes = updates.notes.slice(0, 200);
  // v4.6: favorite (boolean)
  if (typeof updates.favorite === 'boolean') p.favorite = updates.favorite;
  // v5.3: tags (array of strings, max 5, each max 20 chars)
  if (Array.isArray(updates.tags)) {
    p.tags = updates.tags.filter(function(t) { return typeof t === 'string' && t.length > 0 && t.length <= 20; }).slice(0, 5);
  }
  persist();
  return true;
}

function remove(id) {
  if (_profiles === null) load();
  const idx = _profiles.findIndex(function (x) { return x.id === id; });
  if (idx === -1) return false;
  _profiles.splice(idx, 1);
  persist();

  // Wipe da partition (cookies/cache do perfil removido)
  try {
    const partDir = path.join(app.getPath('userData'), 'Partitions', 'profile-' + id);
    if (fs.existsSync(partDir)) {
      _rmrf(partDir);
      logger.info('ProfileStore: dados da partition removidos para ' + id);
    }
  } catch (e) {
    logger.warn('ProfileStore: não foi possível remover partition: ' + e.message);
  }
  return true;
}

/**
 * Reorder profiles to match the given array of IDs.
 * IDs not found are ignored; profiles not in the list keep their relative order.
 * @param {string[]} order - Array of profile IDs in desired order
 */
function reorder(order) {
  if (_profiles === null) load();
  if (!Array.isArray(order)) return;
  var reordered = [];
  var seen = new Set();
  // First, place profiles in the specified order
  order.forEach(function (id) {
    var p = _profiles.find(function (x) { return x.id === id; });
    if (p && !seen.has(id)) {
      reordered.push(p);
      seen.add(id);
    }
  });
  // Then append any profiles not in the order list
  _profiles.forEach(function (p) {
    if (!seen.has(p.id)) reordered.push(p);
  });
  _profiles = reordered;
  persist();
}

function touch(id) {
  if (_profiles === null) load();
  const p = _profiles.find(function (x) { return x.id === id; });
  if (p) {
    p.lastUsed = Date.now();
    persist();
  }
}

/**
 * v4.5: Incrementa contador de lançamentos do perfil.
 * @param {string} id
 * @returns {boolean}
 */
function incrementLaunch(id) {
  if (_profiles === null) load();
  const p = _profiles.find(function (x) { return x.id === id; });
  if (!p) return false;
  p.launchCount = (p.launchCount || 0) + 1;
  p.lastUsed = Date.now();
  persist();
  return true;
}

/**
 * v4.5: Adiciona tempo de jogo (ms) ao total acumulado do perfil.
 * @param {string} id
 * @param {number} ms - milissegundos a adicionar (clampado em [0, 24h])
 * @returns {boolean}
 */
function addPlayTime(id, ms) {
  if (_profiles === null) load();
  const p = _profiles.find(function (x) { return x.id === id; });
  if (!p) return false;
  // Sanity check: 0 <= ms <= 24h (evita overflow por bug de timer)
  const clamped = Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(ms) || 0));
  p.totalPlayMs = (p.totalPlayMs || 0) + clamped;
  persist();
  return true;
}

/**
 * v4.5: Retorna estatísticas de uso de um perfil.
 * @param {string} id
 * @returns {{launchCount:number, totalPlayMs:number, lastUsed:number, avgSessionMs:number}|null}
 */
function getStats(id) {
  if (_profiles === null) load();
  const p = _profiles.find(function (x) { return x.id === id; });
  if (!p) return null;
  const launches = p.launchCount || 0;
  const totalMs = p.totalPlayMs || 0;
  return {
    launchCount: launches,
    totalPlayMs: totalMs,
    lastUsed: p.lastUsed || 0,
    avgSessionMs: launches > 0 ? Math.round(totalMs / launches) : 0,
  };
}

/**
 * Exporta todos os perfis como JSON string (para portabilidade Win↔Linux).
 * Não inclui cookies (são por partition em disco) — apenas metadados.
 * @returns {string}
 */
function exportJSON() {
  if (_profiles === null) load();
  return JSON.stringify({
    version: 2,
    exportedAt: Date.now(),
    profiles: _profiles,
  }, null, 2);
}

/**
 * Importa perfis de um JSON string (merge: preserva existentes por nome+server).
 * @param {string} jsonStr
 * @returns {{imported: number, skipped: number}}
 */
function importJSON(jsonStr) {
  if (_profiles === null) load();
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    logger.error('ProfileStore: import JSON inválido: ' + e.message);
    return { imported: 0, skipped: 0 };
  }
  const incoming = Array.isArray(data.profiles) ? data.profiles : (Array.isArray(data) ? data : []);
  let imported = 0, skipped = 0;
  incoming.forEach(function (p) {
    if (!isValidProfile(p)) { skipped++; return; }
    if (_profiles.length >= MAX_PROFILES) { skipped++; return; }
    // Dedup por nome+server
    const dup = _profiles.find(function (x) { return x.name === p.name && x.server === p.server; });
    if (dup) { skipped++; return; }
    // Novo ID (evita colisão com existentes)
    const fresh = Object.assign({}, p, {
      id: 'p_' + crypto.randomBytes(6).toString('hex'),
      createdAt: Date.now(),
      lastUsed: 0,
    });
    _profiles.push(fresh);
    imported++;
  });
  persist();
  logger.info('ProfileStore: importados ' + imported + ', ignorados ' + skipped);
  return { imported: imported, skipped: skipped };
}

function onChange(cb) {
  if (typeof cb === 'function') _listeners.push(cb);
}

// Helper recursivo para remover diretório
function _rmrf(p) {
  if (fs.existsSync(p)) {
    fs.readdirSync(p).forEach(function (entry) {
      const cur = path.join(p, entry);
      if (fs.lstatSync(cur).isDirectory()) _rmrf(cur);
      else fs.unlinkSync(cur);
    });
    fs.rmdirSync(p);
  }
}

module.exports = {
  load: load,
  getAll: getAll,
  get: get,
  create: create,
  update: update,
  remove: remove,
  reorder: reorder,
  touch: touch,
  exportJSON: exportJSON,
  importJSON: importJSON,
  onChange: onChange,
  // v4.5: stats methods
  incrementLaunch: incrementLaunch,
  addPlayTime: addPlayTime,
  getStats: getStats,
  getPartitionName: function (id) { return 'persist:profile-' + id; },
  MAX_PROFILES: MAX_PROFILES,
  PALETTE: PALETTE,
};
