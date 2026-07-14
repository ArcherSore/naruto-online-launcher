/**
 * app/FlashUpdater.js — Clean Flash PPAPI on-demand downloader + cache
 * v1.0.0 (Fase 2 da migração v5.0 — Decisão A)
 *
 * FILOSOFIA:
 *   O repositório NÃO versiona mais os 32MB de binário Flash. O plugin é
 *   baixado sob demanda do build canônico do darktohka (clean-flash-builds),
 *   sempre na versão MAIS RECENTE, e cacheado localmente em
 *   `userData/flash-cache/`.
 *
 * BOOT FLOW (orquestrado por main.js):
 *   1. findFlashPlugin() (em flash/plugin.js) agora procura TAMBÉM no cache.
 *      - Se achar (cache quente) → boot normal, flags aplicadas antes de ready.
 *   2. Se não achar (first-run / cache vazio):
 *        a. flags.applyAll() roda SEM flashPath (outros switches antes de ready).
 *        b. app.ready → abre loading window → FlashUpdater.ensureLatest() async.
 *        c. Download + extração → escreve no cache.
 *        d. app.relaunch() + app.exit() → segundo boot acha o cache (passo 1).
 *   3. Update semanal em background (pós-boot, non-blocking): se cache > 7 dias,
 *      re-download para o PRÓXIMO boot (não relança — só refresca o cache).
 *
 * SOURCE canônico:
 *   https://github.com/darktohka/clean-flash-builds/releases/latest
 *   API:    https://api.github.com/repos/darktohka/clean-flash-builds/releases/latest
 *   Linux:  clean-flash-linux.tar.xz  →  libpepflashplayer.so + manifest.json
 *   Windows: clean-flash-windows.exe   →  pepflashplayer.dll (InnoSetup installer)
 *
 * PERFORMANCE:
 *   - Cache quente = stat síncrono, ~0ms.
 *   - First-run download = ~17MB, 5-30s conforme rede.
 *   - Relaunch = +1s de boot overhead UMA vez (first-run only).
 *
 * ROBUSTEZ:
 *   - GitHub API rate-limit (60/h anônimo): irrelevante p/ single-user.
 *   - Fall-through: se download falhar e cache existir (mesmo stale), usa cache.
 *   - Extração Linux via `tar -xJf` (universal). Windows via innoextract|7z.
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const logger = require('../utils/logger');

// ── Constants ────────────────────────────────────────────────────────────────

const API_HOST = 'api.github.com';
const API_PATH = '/repos/darktohka/clean-flash-builds/releases/latest';
const USER_AGENT = 'Shinobi-Launcher-FlashUpdater/1.0 (+https://github.com/Chrispsz/naruto-online-launcher)';

const CACHE_SUBDIR = 'flash-cache';
const CACHE_MANIFEST = 'cache-manifest.json';
const STALE_DAYS = 7;
const DOWNLOAD_TIMEOUT_MS = 120000; // 2 min p/ asset de 17MB em rede lenta

const PLUGIN_NAMES = {
  linux: 'libpepflashplayer.so',
  win32: 'pepflashplayer.dll',
};

// ── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Diretório de cache: userData/flash-cache/
 * Disponível antes de app.ready.
 * @returns {string}
 */
function getCacheDir() {
  return path.join(app.getPath('userData'), CACHE_SUBDIR);
}

/**
 * Path do binário plugin cacheado para a plataforma atual.
 * @returns {string}
 */
function getCachedPluginPath() {
  return path.join(getCacheDir(), PLUGIN_NAMES[process.platform] || PLUGIN_NAMES.linux);
}

/**
 * Path do manifest do cache (version + downloadDate).
 * @returns {string}
 */
function getCacheManifestPath() {
  return path.join(getCacheDir(), CACHE_MANIFEST);
}

// ── Cache queries ────────────────────────────────────────────────────────────

/**
 * Lê o cache-manifest.json. Retorna null se ausente/inválido.
 * @returns {Object|null} { version, downloadDate, assetName }
 */
function getCacheInfo() {
  try {
    const p = getCacheManifestPath();
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || !data.downloadDate) return null;
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Verifica se o binário cacheado existe E é maior que MIN_SIZE (não corrompido).
 * @returns {boolean}
 */
function hasCachedPlugin() {
  try {
    const p = getCachedPluginPath();
    if (!fs.existsSync(p)) return false;
    const stat = fs.statSync(p);
    return stat.size > 1024 * 1024; // >1MB
  } catch (_) {
    return false;
  }
}

/**
 * Cache está stale (mais de STALE_DAYS dias)?
 * @returns {boolean}
 */
function isCacheStale() {
  const info = getCacheInfo();
  if (!info) return true;
  const ageMs = Date.now() - new Date(info.downloadDate).getTime();
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

// ── GitHub API ───────────────────────────────────────────────────────────────

/**
 * Fetch JSON do GitHub API (release latest).
 * @returns {Promise<Object>} release object com assets[]
 */
function fetchLatestRelease() {
  return new Promise(function (resolve, reject) {
    const req = https.get({
      host: API_HOST,
      path: API_PATH,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github+json',
      },
      timeout: 30000,
    }, function (res) {
      // Follow redirect (GitHub API occasionally 302s)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github+json' }, timeout: 30000 }, function (r2) {
          _readJson(r2, resolve, reject);
        }).on('error', reject).on('timeout', function () { reject(new Error('GitHub API redirect timeout')); });
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('GitHub API HTTP ' + res.statusCode));
        return;
      }
      _readJson(res, resolve, reject);
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('GitHub API timeout')); });
  });
}

function _readJson(stream, resolve, reject) {
  let body = '';
  stream.setEncoding('utf8');
  stream.on('data', function (c) { body += c; });
  stream.on('end', function () {
    try { resolve(JSON.parse(body)); }
    catch (e) { reject(new Error('GitHub API JSON inválido: ' + e.message)); }
  });
  stream.on('error', reject);
}

/**
 * Encontra o asset correto para a plataforma atual no release.
 * Linux: nome contém "linux" e termina .tar.xz
 * Windows: nome contém "windows" e termina .exe
 * @param {Object} release
 * @returns {Object} asset { name, browser_download_url, size }
 */
function pickAsset(release) {
  const assets = (release && release.assets) || [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const name = (a.name || '').toLowerCase();
    if (process.platform === 'win32') {
      if (name.indexOf('windows') !== -1 && name.endsWith('.exe')) return a;
    } else {
      if (name.indexOf('linux') !== -1 && name.endsWith('.tar.xz')) return a;
    }
  }
  return null;
}

// ── Download ─────────────────────────────────────────────────────────────────

/**
 * Baixa um asset via streaming para um arquivo temporário.
 * @param {string} url - browser_download_url
 * @param {string} destPath - caminho destino
 * @param {Function} [onProgress] - (percent 0-100, downloadedMB, totalMB)
 * @returns {Promise<string>} destPath
 */
function downloadAsset(url, destPath, onProgress) {
  return new Promise(function (resolve, reject) {
    const file = fs.createWriteStream(destPath);
    let total = 0;
    let contentLength = 0;
    let lastReport = 0;

    function doRequest(targetUrl) {
      const req = https.get(targetUrl, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: DOWNLOAD_TIMEOUT_MS,
      }, function (res) {
        // Follow redirects (GitHub releases redirect to S3/codeload)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close(function () { try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ } });
          reject(new Error('Download HTTP ' + res.statusCode));
          return;
        }
        contentLength = parseInt(res.headers['content-length'] || '0', 10);
        res.on('data', function (chunk) {
          total += chunk.length;
          const now = Date.now();
          // Throttle progress reports to 4/s
          if (onProgress && (now - lastReport > 250 || total === contentLength)) {
            lastReport = now;
            const pct = contentLength > 0 ? Math.min(100, Math.round((total / contentLength) * 100)) : 0;
            onProgress(pct, (total / 1048576).toFixed(1), (contentLength / 1048576).toFixed(1));
          }
        });
        res.pipe(file);
      });
      req.on('error', function (err) {
        file.close(function () { try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ } });
        reject(err);
      });
      req.on('timeout', function () {
        req.destroy(new Error('Download timeout'));
      });
    }

    file.on('finish', function () { file.close(function () { resolve(destPath); }); });
    file.on('error', function (err) {
      try { fs.unlinkSync(destPath); } catch (_) { /* ignore */ }
      reject(err);
    });

    doRequest(url);
  });
}

// ── Extraction ───────────────────────────────────────────────────────────────

/**
 * Extrai o asset baixado para o diretório de cache.
 * Linux: tar -xJf (tar.xz) → libpepflashplayer.so + manifest.json
 * Windows: innoextract | 7z x (InnoSetup .exe) → pepflashplayer.dll
 * @param {string} archivePath
 * @param {string} destDir
 * @returns {Promise<void>}
 */
function extractAsset(archivePath, destDir) {
  return new Promise(function (resolve, reject) {
    if (process.platform === 'win32') {
      // InnoSetup installer — try innoextract first, then 7z
      _tryExtractWin(archivePath, destDir, function (err) {
        if (err) reject(err); else resolve();
      });
    } else {
      // Linux: tar -xJf <archive> -C <dest>
      execFile('tar', ['-xJf', archivePath, '-C', destDir], { timeout: 60000 }, function (err) {
        if (err) reject(new Error('tar extraction failed: ' + (err.message || err))); else resolve();
      });
    }
  });
}

function _tryExtractWin(archivePath, destDir, cb) {
  // innoextract é mais limpo p/ InnoSetup, mas raramente instalado. 7z é comum.
  // 1. innoextract -d <dest> <archive>
  execFile('innoextract', ['-d', destDir, archivePath], { timeout: 60000 }, function (err1) {
    if (!err1) return cb(null);
    // 2. 7z x -o<dest> <archive>
    execFile('7z', ['x', '-o' + destDir, '-y', archivePath], { timeout: 60000 }, function (err2) {
      if (!err2) return cb(null);
      cb(new Error('Windows extraction failed (innoextract/7z ausentes): ' + (err2.message || err2)));
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Garante que o Clean Flash PPAPI mais recente está no cache.
 * Baixa + extrai + escreve cache-manifest.json. Retorna o path do plugin.
 *
 * @param {string} [platform] - process.platform (default atual)
 * @param {Function} [onProgress] - (percent, downloadedMB, totalMB, phase)
 * @returns {Promise<string>} caminho absoluto do binário plugin no cache
 */
async function ensureLatest(platform, onProgress) {
  const plat = platform || process.platform;
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  logger.info('FlashUpdater: buscando release mais recente do Clean Flash...');

  const release = await fetchLatestRelease();
  const asset = pickAsset(release);
  if (!asset) {
    throw new Error('Nenhum asset Flash encontrado para plataforma "' + plat + '" no release ' + (release.tag_name || '?'));
  }
  logger.info('FlashUpdater: release ' + (release.tag_name || '?') + ' → asset "' + asset.name + '" (' + (asset.size / 1048576).toFixed(1) + 'MB)');

  if (onProgress) onProgress(0, '0', (asset.size / 1048576).toFixed(1), 'download');

  const archivePath = path.join(cacheDir, asset.name);
  await downloadAsset(asset.browser_download_url, archivePath, function (pct, dl, tot) {
    if (onProgress) onProgress(pct, dl, tot, 'download');
  });

  if (onProgress) onProgress(100, (asset.size / 1048576).toFixed(1), (asset.size / 1048576).toFixed(1), 'extract');

  // Extrai para o cache dir (sobrescreve binário antigo)
  await extractAsset(archivePath, cacheDir);

  // Limpa o archive temporário
  try { fs.unlinkSync(archivePath); } catch (_) { /* ignore */ }

  // Verifica que o plugin foi extraído
  const pluginPath = getCachedPluginPath();
  if (!fs.existsSync(pluginPath)) {
    throw new Error('Extração concluída mas plugin não encontrado em ' + pluginPath);
  }

  // Escreve cache-manifest.json
  const version = _extractVersion(release, cacheDir);
  const manifest = {
    version: version,
    downloadDate: new Date().toISOString(),
    assetName: asset.name,
    releaseTag: release.tag_name || null,
    source: 'darktohka/clean-flash-builds',
  };
  fs.writeFileSync(getCacheManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');

  logger.info('FlashUpdater: ✅ Clean Flash ' + version + ' cacheado em ' + cacheDir);
  if (onProgress) onProgress(100, '', '', 'done');
  return pluginPath;
}

/**
 * Extrai a versão do Flash do release tag ou do manifest.json extraído.
 * @param {Object} release
 * @param {string} cacheDir
 * @returns {string}
 */
function _extractVersion(release, cacheDir) {
  // Tenta ler o manifest.json extraído (darktohka inclui um)
  try {
    const m = path.join(cacheDir, 'manifest.json');
    if (fs.existsSync(m)) {
      const data = JSON.parse(fs.readFileSync(m, 'utf8'));
      if (process.platform === 'linux' && data.linux_version) return data.linux_version;
      if (data.version) return data.version;
    }
  } catch (_) { /* ignore */ }
  // Fallback: parse do tag name (ex: "v34.0.0.137")
  const tag = (release && release.tag_name) || '';
  const match = tag.match(/(\d+(?:\.\d+)+)/);
  return match ? match[1] : '34.0.0.0';
}

/**
 * Refresh em background se o cache estiver stale (não bloqueia o boot).
 * Só refresca o cache para o PRÓXIMO boot — não relança.
 * @param {string} [platform]
 * @returns {Promise<void>}
 */
async function refreshIfStale(platform) {
  if (!hasCachedPlugin()) return; // nothing to refresh
  if (!isCacheStale()) return; // fresh enough
  logger.info('FlashUpdater: cache stale (>' + STALE_DAYS + 'd) — atualizando em background...');
  try {
    await ensureLatest(platform);
    logger.info('FlashUpdater: cache atualizado em background (válido para próximo boot)');
  } catch (e) {
    logger.warn('FlashUpdater: refresh background falhou (' + e.message + ') — mantendo cache atual');
  }
}

module.exports = {
  ensureLatest: ensureLatest,
  refreshIfStale: refreshIfStale,
  // cache queries (usadas por flash/plugin.js)
  getCacheDir: getCacheDir,
  getCachedPluginPath: getCachedPluginPath,
  hasCachedPlugin: hasCachedPlugin,
  getCacheInfo: getCacheInfo,
  isCacheStale: isCacheStale,
  // pure helpers (expostos p/ testes unitários)
  pickAsset: pickAsset,
  // constants (p/ testes)
  CACHE_SUBDIR: CACHE_SUBDIR,
  STALE_DAYS: STALE_DAYS,
};
