/**
 * app/CpuOptimizer.js — Otimizações de CPU para Flash Player (v1.0.0)
 *
 * Responsabilidade ÚNICA: aplicar otimizações de CPU/Scheduler no processo
 * renderer do Electron onde o Flash PPAPI roda.
 *
 * CONTEXTO CRÍTICO — Flash é SINGLE-THREADED:
 *   O ActionScript (lógica do jogo Naruto Online) roda em UM thread só dentro
 *   do processo renderer do Electron. Mesmo que a CPU tenha 16 núcleos, o Flash
 *   só usa 1 para a lógica principal. O scheduler do Linux/Windows move esse
 *   thread entre núcleos (cache thrashing) — fixar em um núcleo P (performance)
 *   reduz cache misses e dá ganho real de FPS (5-15% em CPUs híbridas).
 *
 * Otimizações aplicadas (Linux only — Windows/macOS não suportam):
 *   1. CPU affinity: fixa o renderer PID em um conjunto de núcleos P-cores
 *      (Intel Alder Lake+ híbrido) ou nos primeiros N núcleos (CPUs uniformes).
 *   2. Nice priority: -5 (maior prioridade dentro do limite do usuário).
 *   3. oom_score_adj: -500 (kernel não mata em OOM, prefere matar outros).
 *   4. SCHED_BATCH no renderer NÃO (quebra input), apenas no GC daemon se houver.
 *
 * Como Electron não expõe setAffinity direto, usamos `taskset` externo via
 * child_process.execFile. Em AppImage sem taskset, falha silenciosamente.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

let _appliedPids = new Set(); // pids já otimizados (evita reapply)

/**
 * Detecta o layout de núcleos P (performance) vs E (efficiency) em CPUs híbridas.
 *
 * Em Intel Alder Lake+ (12a gen+), o kernel Linux expõe em
 * /sys/devices/cpu_atom/cpus (E-cores) e /sys/devices/cpu_core/cpus (P-cores).
 *
 * @returns {Object} { pCores: [0,1,2,3], eCores: [4,5,6,7], isHybrid: bool }
 */
function detectCoreTopology() {
  const totalCores = os.cpus().length;
  const pCores = [];
  const eCores = [];

  if (process.platform === 'linux') {
    try {
      // P-cores (cpu_core): high-performance
      if (fs.existsSync('/sys/devices/cpu_core/cpus')) {
        const raw = fs.readFileSync('/sys/devices/cpu_core/cpus', 'utf8').trim();
        // Formato: "0-7" ou "0 1 2 3" ou "0,2,4,6"
        _parseCpuList(raw).forEach(function (n) { pCores.push(n); });
      }
      // E-cores (cpu_atom): efficient
      if (fs.existsSync('/sys/devices/cpu_atom/cpus')) {
        const raw = fs.readFileSync('/sys/devices/cpu_atom/cpus', 'utf8').trim();
        _parseCpuList(raw).forEach(function (n) { eCores.push(n); });
      }
    } catch (_) {
      /* ignore */
    }
  }

  // Fallback: se não achou P/E separados, todos os núcleos são P (CPU uniforme).
  // Em CPUs AMD ou Intel non-hybrid, o scheduler já faz bom work distribution.
  if (pCores.length === 0 && eCores.length === 0) {
    for (let i = 0; i < totalCores; i++) pCores.push(i);
  }

  return {
    pCores: pCores,
    eCores: eCores,
    isHybrid: pCores.length > 0 && eCores.length > 0,
    totalCores: totalCores
  };
}

/**
 * Parser de listas de CPU do kernel (/sys/devices/.../cpus).
 * Formatos suportados: "0-7", "0,2,4-6", "0 1 2", "0-3,8-11".
 * @param {string} raw
 * @returns {number[]}
 */
function _parseCpuList(raw) {
  if (!raw || raw === '\n') return [];
  const out = [];
  // Pode ter vírgula ou espaço como separador
  const parts = raw.split(/[,\s]+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      for (let i = start; i <= end; i++) out.push(i);
    } else if (/^\d+$/.test(part)) {
      out.push(parseInt(part, 10));
    }
  }
  return out;
}

/**
 * Aplica CPU affinity no PID via `taskset -cp <cores> <pid>`.
 * @param {number} pid - Process ID
 * @param {number[]} cores - Lista de núcleos (ex: [0,1,2,3])
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function _applyTaskset(pid, cores) {
  return new Promise(function (resolve) {
    if (process.platform !== 'linux') {
      return resolve({ ok: false, error: 'not-linux' });
    }
    if (!pid || cores.length === 0) {
      return resolve({ ok: false, error: 'invalid-args' });
    }
    const coresArg = cores.join(',');
    execFile('taskset', ['-cp', coresArg, String(pid)], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'pipe']
    }, function (err) {
      if (err) {
        // taskset não disponível (AppImage minimal) ou sem permissão
        logger.debug('CpuOptimizer: taskset falhou pid=' + pid + ' cores=' + coresArg +
          ' — ' + err.message);
        return resolve({ ok: false, error: err.message });
      }
      logger.info('CpuOptimizer: affinity aplicada pid=' + pid + ' cores=[' + coresArg + ']');
      resolve({ ok: true });
    });
  });
}

/**
 * Aplica nice priority via `renice -n <priority> -p <pid>`.
 * Usuário semum pode setar nice de 0 a 19 (menor prioridade). Para nice negativo
 * (-5, mais prioridade), precisa de CAP_SYS_NICE. Tentamos -5, se falha cai pra 0.
 * @param {number} pid
 * @param {number} priority - valor nice (-20 a 19)
 * @returns {Promise<{ok: boolean, priority?: number, error?: string}>}
 */
function _applyRenice(pid, priority) {
  return new Promise(function (resolve) {
    if (process.platform !== 'linux') {
      return resolve({ ok: false, error: 'not-linux' });
    }
    execFile('renice', ['-n', String(priority), '-p', String(pid)], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'pipe']
    }, function (err) {
      if (err) {
        logger.debug('CpuOptimizer: renice falhou pid=' + pid + ' n=' + priority +
          ' — ' + err.message);
        return resolve({ ok: false, error: err.message });
      }
      logger.info('CpuOptimizer: nice=' + priority + ' aplicado pid=' + pid);
      resolve({ ok: true, priority: priority });
    });
  });
}

/**
 * Ajusta oom_score_adj para -500 (kernel prefere matar outros processos em OOM).
 * Escreve diretamente em /proc/<pid>/oom_score_adj (não precisa de root se for
 * o próprio processo ou filho). Em AppImage, o renderer é filho → permitido.
 * @param {number} pid
 * @param {number} score - valor de -1000 (nunca matar) a 1000 (sempre matar)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function _applyOomScoreAdj(pid, score) {
  return new Promise(function (resolve) {
    if (process.platform !== 'linux') {
      return resolve({ ok: false, error: 'not-linux' });
    }
    const path = '/proc/' + pid + '/oom_score_adj';
    fs.writeFile(path, String(score), function (err) {
      if (err) {
        logger.debug('CpuOptimizer: oom_score_adj falhou pid=' + pid +
          ' — ' + err.message);
        return resolve({ ok: false, error: err.message });
      }
      logger.info('CpuOptimizer: oom_score_adj=' + score + ' aplicado pid=' + pid);
      resolve({ ok: true });
    });
  });
}

/**
 * Aplica todas as otimizações de CPU em um renderer PID.
 *
 * @param {number} pid - PID do processo renderer do Electron
 * @param {Object} opts - { preset: 'performance'|'balanced'|'quality',
 *                          topology: detectCoreTopology() result (optional),
 *                          extraCores: número de núcleos extras além do P-core principal }
 * @returns {Promise<{affinity, nice, oom}>}
 */
async function optimizeRenderer(pid, opts) {
  opts = opts || {};
  const preset = opts.preset || 'balanced';

  if (!pid || pid <= 0) {
    return { affinity: { ok: false, error: 'invalid-pid' }, nice: { ok: false, error: 'invalid-pid' }, oom: { ok: false, error: 'invalid-pid' } };
  }

  // Idempotente: se já aplicamos pro mesmo PID, pula (mas re-aplica em reload).
  // Em reload, o PID pode ser reutilizado — checamos o Set antes de pular.
  // Removido: o renderer PID muda em cada reload (novo processo), então o Set
  // cresce indefinidamente. Limpar a cada 50 entradas (antes de adicionar a 51ª).
  if (_appliedPids.has(pid)) {
    return { affinity: { ok: true, skipped: true }, nice: { ok: true, skipped: true }, oom: { ok: true, skipped: true } };
  }
  if (_appliedPids.size >= 50) _appliedPids.clear();
  _appliedPids.add(pid);

  const topology = opts.topology || detectCoreTopology();

  // Performance: fixa em P-cores + 1 E-core reserva (para GC do V8 não competir
  // com o thread principal do Flash).
  // Balanced: fixa em P-cores apenas (deixa E-cores livres pra outras apps).
  // Quality: NÃO aplica affinity (deixa scheduler decidir — melhor pra multi-task).
  let cores = [];
  if (preset === 'quality') {
    // Sem affinity
  } else if (preset === 'performance') {
    // P-cores + 1 E-core (se híbrido) pra GC não competir com Flash thread
    if (topology.isHybrid && topology.pCores.length > 0) {
      cores = topology.pCores.slice();
      if (topology.eCores.length > 0) cores.push(topology.eCores[0]);
    } else {
      // CPU uniforme: primeiros min(4, total) núcleos
      cores = topology.pCores.slice(0, Math.min(4, topology.pCores.length));
    }
  } else {
    // Balanced: só P-cores (ou primeiros 2 se uniforme)
    if (topology.isHybrid) {
      cores = topology.pCores.slice(0, Math.max(1, Math.min(topology.pCores.length, 4)));
    } else {
      cores = topology.pCores.slice(0, Math.min(2, topology.pCores.length));
    }
  }

  const affinityPromise = cores.length > 0
    ? _applyTaskset(pid, cores)
    : Promise.resolve({ ok: true, skipped: 'quality-preset' });

  // Nice: -5 em performance (maior prioridade), 0 em balanced, +5 em quality
  // (menor prioridade — deixa outras apps terem prioridade se user está multitask).
  // Mas -5 provavelmente falha (sem CAP_SYS_NICE). Tentamos -5, se falha tenta 0.
  let niceTarget = preset === 'performance' ? -5 : preset === 'balanced' ? 0 : 5;
  const nicePromise = _applyRenice(pid, niceTarget).then(function (res) {
    if (!res.ok && niceTarget < 0) {
      // Retry com 0 (sem necessidade de CAP_SYS_NICE)
      return _applyRenice(pid, 0);
    }
    return res;
  });

  // OOM protection: -500 em performance/balanced, 0 em quality
  const oomScore = preset === 'quality' ? 0 : -500;
  const oomPromise = _applyOomScoreAdj(pid, oomScore);

  const [affinity, nice, oom] = await Promise.all([affinityPromise, nicePromise, oomPromise]);

  logger.info(
    'CpuOptimizer: pid=' + pid + ' preset=' + preset +
    ' affinity=' + (affinity.ok ? '✓' : '✗') +
    ' nice=' + (nice.ok ? (nice.priority !== undefined ? nice.priority : '✓') : '✗') +
    ' oom=' + (oom.ok ? '✓' : '✗')
  );

  return { affinity: affinity, nice: nice, oom: oom, cores: cores };
}

/**
 * Snapshot do estado atual (para UI mostrar ao user).
 * @returns {Object}
 */
function getStats() {
  const topo = detectCoreTopology();
  return {
    topology: topo,
    appliedPids: _appliedPids.size,
    platform: process.platform
  };
}

/**
 * Reseta estado interno (para testes).
 */
function _reset() {
  _appliedPids.clear();
}

module.exports = {
  detectCoreTopology: detectCoreTopology,
  optimizeRenderer: optimizeRenderer,
  getStats: getStats,
  // expostos p/ testes
  _reset: _reset,
  _parseCpuList: _parseCpuList,
  _applyTaskset: _applyTaskset,
  _applyRenice: _applyRenice,
  _applyOomScoreAdj: _applyOomScoreAdj
};
