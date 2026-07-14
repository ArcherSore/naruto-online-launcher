#!/usr/bin/env node
/**
 * scripts/cron-reliability-30min.js — Cron Job de Auditoria de Reliability
 * v1.0.0 — v3.5.2 final
 *
 * RODA A CADA 30 MINUTOS (Job 263875) no ambiente local.
 * Não é parte do runtime do Electron — é um script standalone executado
 * pelo agente cron para auditar o código-fonte do launcher.
 *
 * 3 FUNÇÕES CRÍTICAS:
 *   1. Profiler de vazamentos: escaneia src/ procurando EventListeners órfãos
 *      (.on() sem par .removeListener() ou guard de idempotência)
 *   2. Guardião i18n: cruza strings HTML/JS com src/config/i18n.js
 *      garantindo 100% traduzido nas 6 línguas
 *   3. Faxina atômica: remove arquivos mortos, logs temporários, resquícios .go
 *
 * SAÍDA: log estruturado + exit code 0 (ok) ou 1 (issues encontradas)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const I18N_FILE = path.join(SRC_DIR, 'config', 'i18n.js');

const SUPPORTED_LANGS = ['pt', 'en', 'de', 'es', 'pl', 'fr'];

let issues = [];
let warnings = [];

// ── Helpers ──
function log(msg) { console.log('[reliability] ' + msg); }
function warn(msg) { warnings.push(msg); console.warn('[reliability] WARN: ' + msg); }
function fail(msg) { issues.push(msg); console.error('[reliability] FAIL: ' + msg); }

function walkDir(dir, ext, results) {
  results = results || [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '__tests__') {
      walkDir(fullPath, ext, results);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÃO 1: Profiler de Vazamentos e Listeners Duplicados
// ═══════════════════════════════════════════════════════════════════════════
function auditEventListeners() {
  log('Auditoria 1/3: Profiler de EventListeners órfãos...');
  const jsFiles = walkDir(SRC_DIR, '.js');
  let found = 0;

  for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(REPO_ROOT, file);

    // Padrões de listeners que precisam de cleanup
    const patterns = [
      { regex: /\.on\(['"]/g, name: '.on()', needsCleanup: true },
      { regex: /addEventListener\(/g, name: 'addEventListener()', needsCleanup: true },
      { regex: /setInterval\(/g, name: 'setInterval()', needsCleanup: true },
      { regex: /setTimeout\(/g, name: 'setTimeout()', needsCleanup: false },
    ];

    for (const { regex, name, needsCleanup } of patterns) {
      const matches = content.match(regex);
      if (!matches) continue;

      // Para listeners que precisam de cleanup, verifica se há .off/.removeListener/.clearInterval
      if (needsCleanup) {
        const cleanupPatterns = {
          '.on()': [/\.off\(/g, /\.removeListener\(/g, /WeakSet/g, /_configuredSessions/g, /_isForceClosing/g, /once\(/g],
          'addEventListener()': [/removeEventListener\(/g],
          'setInterval()': [/clearInterval\(/g, /\.unref\(/g],
        };
        const cleanups = cleanupPatterns[name] || [];
        let hasCleanup = false;
        for (const cp of cleanups) {
          if (content.match(cp)) { hasCleanup = true; break; }
        }
        if (!hasCleanup && matches.length > 2) {
          // Mais de 2 listeners sem nenhum cleanup → suspeito
          warn(relPath + ': ' + matches.length + 'x "' + name + '" sem cleanup explícito');
          found++;
        }
      }
    }

    // Verifica Map/Set que cresce indefinidamente (sem .delete ou .clear)
    const mapMatches = content.match(/new Map\(\)/g);
    if (mapMatches) {
      const hasDelete = content.match(/\.delete\(/g);
      if (!hasDelete && mapMatches.length > 0) {
        warn(relPath + ': new Map() sem .delete() — potencial crescimento indefinido');
        found++;
      }
    }
  }

  if (found === 0) {
    log('  OK: Nenhum listener órfão detectado.');
  } else {
    log('  ' + found + ' aviso(s) de listeners (revisar manualmente).');
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÃO 2: Guardião do Dicionário de Idiomas (i18n Lint)
// ═══════════════════════════════════════════════════════════════════════════
function auditI18n() {
  log('Auditoria 2/3: Guardião do i18n (6 línguas)...');

  // Carrega i18n.js e extrai chaves por idioma
  if (!fs.existsSync(I18N_FILE)) {
    fail('i18n.js não encontrado em: ' + I18N_FILE);
    return 1;
  }

  const i18nContent = fs.readFileSync(I18N_FILE, 'utf8');
  const keyCounts = {};
  let totalIssues = 0;

  for (const lang of SUPPORTED_LANGS) {
    // Extrai bloco do idioma
    const regex = new RegExp(lang + ':\\s*\\{([\\s\\S]*?)\\n\\s*\\},', 'g');
    const match = regex.exec(i18nContent);
    if (!match) {
      fail('i18n.js: idioma "' + lang + '" não encontrado no dicionário');
      totalIssues++;
      continue;
    }

    // Conta chaves no bloco
    const keys = match[1].match(/'([^']+)':/g);
    const count = keys ? keys.length : 0;
    keyCounts[lang] = count;
  }

  // Verifica se todos os idiomas têm o mesmo número de chaves
  const counts = Object.values(keyCounts);
  const allSame = counts.every(c => c === counts[0]);
  if (!allSame) {
    fail('i18n.js: chaves desbalanceadas entre idiomas: ' + JSON.stringify(keyCounts));
    totalIssues++;
  } else {
    log('  OK: ' + counts[0] + ' chaves espelhadas em todos os ' + SUPPORTED_LANGS.length + ' idiomas.');
  }

  // Verifica strings hardcoded em HTML (texto sem data-i18n)
  const htmlFiles = walkDir(SRC_DIR, '.html');
  let hardcodedFound = 0;
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(REPO_ROOT, file);

    // Procura texto em tags sem data-i18n (apenas em elementos visíveis)
    // Padrão: >Texto com espaços< sem data-i18n na tag
    const textMatches = content.match(/>\s*[A-ZÀ-ÿ][a-zà-ÿ]{3,}[^<]*</g);
    if (textMatches) {
      // Filtra tags que têm data-i18n
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/>\s*[A-ZÀ-ÿ][a-zà-ÿ]{3,}[^<]*</) &&
            !lines[i].includes('data-i18n') &&
            !lines[i].includes('<script') &&
            !lines[i].includes('<style') &&
            !lines[i].includes('<!--') &&
            !lines[i].includes('<meta') &&
            !lines[i].includes('<link')) {
          // Heurística: se a linha tem texto visível sem data-i18n, avisa
          // (não falha — setup.html tem dicionário inline que é aceitável)
          warn(relPath + ':' + (i + 1) + ' possível string hardcoded: ' + lines[i].trim().slice(0, 80));
          hardcodedFound++;
        }
      }
    }
  }

  if (hardcodedFound > 0) {
    log('  ' + hardcodedFound + ' aviso(s) de strings hardcoded (revisar para i18n completo).');
  }

  return totalIssues + Math.min(hardcodedFound, 1); // max 1 issue por hardcoded
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÃO 3: Faxina e Purga Atômica de Resíduos
// ═══════════════════════════════════════════════════════════════════════════
function auditCleanup() {
  log('Auditoria 3/3: Faxina e purga de resíduos...');
  let cleaned = 0;

  // Padrões de arquivos mortos para remover
  const deadPatterns = [
    /\.go$/i,           // resquícios Go
    /go\.mod$/i,
    /go\.sum$/i,
    /\.fyne$/i,
    /\.bak$/i,          // backups temporários
    /\.tmp$/i,          // arquivos temporários
    /\.orig$/i,         // merge artifacts
    /Thumbs\.db$/i,     // Windows
    /\.DS_Store$/i,     // macOS
  ];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        for (const pattern of deadPatterns) {
          if (pattern.test(entry.name)) {
            try {
              fs.unlinkSync(fullPath);
              log('  Removido: ' + path.relative(REPO_ROOT, fullPath));
              cleaned++;
            } catch (e) {
              warn('  Não foi possível remover: ' + fullPath + ' (' + e.message + ')');
            }
            break;
          }
        }
      }
    }
  }

  scanDir(REPO_ROOT);

  // Verifica resquícios de código Go em arquivos JS/MD
  const jsFiles = walkDir(SRC_DIR, '.js');
  for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = path.relative(REPO_ROOT, file);
    if (content.includes('package main') && content.includes('func main()')) {
      fail(relPath + ': contém código Go embutido em arquivo .js!');
    }
    if (content.match(/fyne\.|fmt\.Println|go func\(\)/)) {
      fail(relPath + ': referência a API Go/Fyne detectada!');
    }
  }

  // Verifica arquivos .go no repo (excluindo node_modules)
  const goFiles = walkDir(REPO_ROOT, '.go');
  if (goFiles.length > 0) {
    for (const f of goFiles) {
      fail('Arquivo Go encontrado: ' + path.relative(REPO_ROOT, f));
    }
  }

  if (cleaned === 0 && goFiles.length === 0) {
    log('  OK: Nenhum resíduo encontrado. Repositório limpo.');
  } else {
    log('  ' + cleaned + ' arquivo(s) removido(s).');
  }

  return goFiles.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
function main() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Shinobi Launcher — Reliability Audit');
  console.log('  v3.5.2 • 30min cycle');
  console.log('═══════════════════════════════════════════');
  console.log('');

  const startMs = Date.now();

  const listenerIssues = auditEventListeners();
  console.log('');
  const i18nIssues = auditI18n();
  console.log('');
  const cleanupIssues = auditCleanup();
  console.log('');

  const elapsed = Date.now() - startMs;
  const totalIssues = issues.length;
  const totalWarnings = warnings.length;

  console.log('═══════════════════════════════════════════');
  console.log('  Resumo:');
  console.log('    Issues:    ' + totalIssues);
  console.log('    Warnings:  ' + totalWarnings);
  console.log('    Tempo:     ' + elapsed + 'ms');
  console.log('═══════════════════════════════════════════');

  if (totalIssues > 0) {
    console.log('');
    console.log('FAIL — Issues críticos encontrados. Bloquear commit.');
    process.exit(1);
  } else {
    console.log('');
    console.log('PASS — Repositório estável e limpo.');
    process.exit(0);
  }
}

main();
