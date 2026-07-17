/**
 * EventTimers — Lembretes de eventos com conversão matemática de fusos
 * v2.1.0
 *
 * REAVALIAÇÃO:
 *   v2.0 tinha timezone hardcoded America/Sao_Paulo. ERRADO para um produto global.
 *   v2.1: cada região de servidor (BR/NA/EU/HK) tem seu próprio fuso e catálogo.
 *   Conversão matemática server-TZ → user-local-TZ feita sem libs (apenas Date + offsets).
 *
 * REGIÕES SUPORTADAS:
 *   br — America/Sao_Paulo (UTC-3)
 *   na — America/New_York   (UTC-5/-4 DST)
 *   eu — Europe/Berlin      (UTC+1/+2 DST)
 *   hk — Asia/Hong_Kong     (UTC+8, sem DST)
 *
 * NOTIFICAÇÕES:
 *   - Nativas do SO via Electron Notification
 *   - Toggle global de mute (persistido em config)
 *   - Disparam X minutos antes do evento (configurável por evento)
 */

'use strict';

const { Notification } = require('electron');
const path = require('path');
const logger = require('../utils/logger');

// Offsets UTC aproximados por região (sem libs de TZ).
// DST é auto-detectado comparando o offset atual do Date com o offset base.
const REGION_TZ = {
  br: { name: 'Brasil', flag: '🇧🇷', baseOffset: -3 }, // UTC-3, sem DST
  na: { name: 'América do Norte', flag: '🇺🇸', baseOffset: -5 }, // UTC-5, DST -4
  eu: { name: 'Europa', flag: '🇪🇺', baseOffset: 1 }, // UTC+1, DST +2
  hk: { name: 'Hong Kong', flag: '🇭🇰', baseOffset: 8 } // UTC+8, sem DST
};

// Catálogo de eventos por região (horários no fuso do SERVIDOR)
// SOURCE (atualizado 2025):
//   - https://narutooasis.fandom.com/wiki/Timed_Events (autoritativo)
//   - https://naruto.narutowebgame.com/en/articlelist (news oficial)
//   - Padrões confirmados pela comunidade (Reddit r/naruto_online)
//
// NOTA: Daily Reset é 5:00 AM server-time (confirmado por fandom).
// Boss Mundial tem 2 janelas diárias (12:00 e 20:00 server-time).
// Arena 3v3 reset semanal. Team Dungeon tem cooldown diário.
// Eventos especiais (Bond, Treasure, Rebate) seguem calendário semanal no portal oficial.
//
// v5.9.3: Todos os nomes/descrições em PORTUGUÊS independente da região do
// servidor. Apenas os HORÁRIOS seguem o fuso do servidor (convertidos para
// o relógio local do usuário via nextOccurrenceMs). Idioma consistente.
const EVENTS_BY_REGION = {
  br: [
    {
      id: 'br-boss-mundial',
      name: 'Boss Mundial',
      hours: [12, 20],
      category: 'boss',
      remindMin: 5
    },
    { id: 'br-arena-3v3', name: 'Arena 3v3 (PvP)', hours: [18], category: 'arena', remindMin: 10 },
    {
      id: 'br-dungeon-team',
      name: 'Dungeon em Time',
      hours: [14, 21],
      category: 'dungeon',
      remindMin: 5
    },
    { id: 'br-guerra-cla', name: 'Guerra de Clã', hours: [20], category: 'social', remindMin: 30 },
    {
      id: 'br-arena-guild',
      name: 'Arena de Guildas',
      hours: [19],
      category: 'arena',
      remindMin: 15
    },
    {
      id: 'br-bond-checkin',
      name: 'Bond / Check-in Diário',
      hours: [5],
      category: 'social',
      remindMin: 0
    },
    { id: 'br-reset', name: 'Reset Diário (5h)', hours: [5], category: 'reset', remindMin: 0 }
  ],
  na: [
    { id: 'na-boss-world', name: 'Boss Mundial', hours: [11, 19], category: 'boss', remindMin: 5 },
    { id: 'na-arena-3v3', name: 'Arena 3v3 (PvP)', hours: [17], category: 'arena', remindMin: 10 },
    {
      id: 'na-dungeon',
      name: 'Dungeon em Time',
      hours: [13, 20],
      category: 'dungeon',
      remindMin: 5
    },
    { id: 'na-clan-war', name: 'Guerra de Clã', hours: [19], category: 'social', remindMin: 30 },
    {
      id: 'na-guild-arena',
      name: 'Arena de Guildas',
      hours: [18],
      category: 'arena',
      remindMin: 15
    },
    {
      id: 'na-bond-checkin',
      name: 'Bond / Check-in Diário',
      hours: [5],
      category: 'social',
      remindMin: 0
    },
    { id: 'na-reset', name: 'Reset Diário (5h)', hours: [5], category: 'reset', remindMin: 0 }
  ],
  eu: [
    { id: 'eu-boss-world', name: 'Boss Mundial', hours: [12, 20], category: 'boss', remindMin: 5 },
    { id: 'eu-arena-3v3', name: 'Arena 3v3 (PvP)', hours: [18], category: 'arena', remindMin: 10 },
    {
      id: 'eu-dungeon',
      name: 'Dungeon em Time',
      hours: [14, 21],
      category: 'dungeon',
      remindMin: 5
    },
    { id: 'eu-clan-war', name: 'Guerra de Clã', hours: [20], category: 'social', remindMin: 30 },
    {
      id: 'eu-guild-arena',
      name: 'Arena de Guildas',
      hours: [19],
      category: 'arena',
      remindMin: 15
    },
    {
      id: 'eu-bond-checkin',
      name: 'Bond / Check-in Diário',
      hours: [5],
      category: 'social',
      remindMin: 0
    },
    { id: 'eu-reset', name: 'Reset Diário (5h)', hours: [5], category: 'reset', remindMin: 0 }
  ],
  hk: [
    { id: 'hk-boss-world', name: 'Boss Mundial', hours: [12, 20], category: 'boss', remindMin: 5 },
    { id: 'hk-arena-3v3', name: 'Arena 3v3 (PvP)', hours: [18], category: 'arena', remindMin: 10 },
    {
      id: 'hk-dungeon',
      name: 'Dungeon em Time',
      hours: [14, 21],
      category: 'dungeon',
      remindMin: 5
    },
    { id: 'hk-clan-war', name: 'Guerra de Clã', hours: [20], category: 'social', remindMin: 30 },
    {
      id: 'hk-guild-arena',
      name: 'Arena de Guildas',
      hours: [19],
      category: 'arena',
      remindMin: 15
    },
    {
      id: 'hk-bond-checkin',
      name: 'Bond / Check-in Diário',
      hours: [5],
      category: 'social',
      remindMin: 0
    },
    { id: 'hk-reset', name: 'Reset Diário (5h)', hours: [5], category: 'reset', remindMin: 0 }
  ]
};

let _muted = false;
let _timer = null;
let _remindListeners = [];

/**
 * Calcula o offset UTC ATUAL do usuário (incluindo DST local) em horas.
 * Ex: São Paulo no verão = -3, Nova York no verão = -4.
 */
function getUserOffsetHours() {
  const now = new Date();
  return -now.getTimezoneOffset() / 60;
}

/**
 * Calcula o offset UTC ATUAL de uma região de servidor.
 * Aproximação: usa o offset base + detecção de DST via diferença janeiro/julho.
 * Para br/hk (sem DST) é direto. Para na/eu detectamos DST.
 */
function getServerOffsetHours(region) {
  const r = REGION_TZ[region];
  if (!r) return 0;
  if (region === 'br' || region === 'hk') return r.baseOffset; // sem DST

  // Detecção de DST: compara offset de janeiro vs julho no fuso do servidor
  // Simplificação: usamos o offset base + 1 se estamos no hemisfério correto para DST
  const now = new Date();
  const month = now.getUTCMonth(); // 0-11
  // NA DST: mar-nov. EU DST: mar-out.
  const inDST = region === 'na' ? month >= 2 && month <= 10 : month >= 2 && month <= 9;
  return r.baseOffset + (inDST ? 1 : 0);
}

/**
 * Diferença em horas entre o fuso do servidor e o fuso do usuário.
 * serverHour (no fuso do servidor) → userHour (no fuso do usuário)
 * userHour = serverHour + (userOffset - serverOffset)
 */
function serverToUserOffsetHours(region) {
  return getUserOffsetHours() - getServerOffsetHours(region);
}

/**
 * Calcula o timestamp (ms) da próxima ocorrência de um evento no fuso do servidor,
 * convertido para o relógio local do usuário.
 * @param {string} region
 * @param {number} hourUTC do servidor (0-23)
 * @returns {number} timestamp ms
 */
function nextOccurrenceMs(region, serverHour) {
  const serverOffset = getServerOffsetHours(region);

  // Converte hora do servidor para UTC
  const utcHour = serverHour - serverOffset;

  // Agora encontra a próxima ocorrência desse UTC hour
  const now = new Date();
  const candidate = new Date();
  candidate.setUTCHours(utcHour, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.getTime();
}

/**
 * Lista os eventos de uma região com countdown até o próximo disparo.
 * @param {string} region
 * @returns {Array}
 */
function getUpcoming(region) {
  const events = EVENTS_BY_REGION[region] || EVENTS_BY_REGION.br;
  return events
    .map(function (ev) {
      // Pega a próxima ocorrência entre as horas do evento
      let soonest = Infinity;
      for (let i = 0; i < ev.hours.length; i++) {
        const occ = nextOccurrenceMs(region, ev.hours[i]);
        if (occ < soonest) soonest = occ;
      }
      const fireAt = soonest - ev.remindMin * 60 * 1000;
      const ms = fireAt - Date.now();
      return {
        id: ev.id,
        name: ev.name,
        hours: ev.hours,
        category: ev.category,
        remindMin: ev.remindMin,
        region: region,
        nextFireMs: ms,
        nextFireLabel: formatCountdown(ms),
        // Hora no fuso do servidor (para display)
        userTimeLabel: formatUserTime(soonest, region)
      };
    })
    .sort(function (a, b) {
      return a.nextFireMs - b.nextFireMs;
    });
}

function formatCountdown(ms) {
  if (ms < 0) return 'agora';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + m + 'min';
  if (m > 0) return m + 'min';
  return Math.floor(ms / 1000) + 's';
}

function formatUserTime(ms, region) {
  var meta = REGION_TZ[region] || REGION_TZ.br;
  var d = new Date(ms);
  var h = (((d.getUTCHours() + meta.baseOffset) % 24) + 24) % 24;
  var m = d.getUTCMinutes();
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function isMuted() {
  return _muted;
}
function setMuted(m) {
  _muted = !!m;
  logger.info('EventTimers: notificações ' + (_muted ? 'MUTADAS' : 'ativas'));
}

function onRemind(cb) {
  if (typeof cb === 'function') _remindListeners.push(cb);
}

function showNotification(event, region) {
  if (_muted) return;
  if (!Notification.isSupported()) return;
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    const r = REGION_TZ[region] || {};
    const n = new Notification({
      title: r.flag + ' ' + event.name + ' em ' + event.remindMin + 'min',
      body: 'Começa às ' + event.hours.join('h e ') + 'h (' + r.name + ')',
      icon: iconPath,
      silent: false
    });
    n.show();
  } catch (e) {
    logger.debug('EventTimers: notificação falhou: ' + e.message);
  }
  _remindListeners.forEach(function (cb) {
    try {
      cb({ event: event, region: region });
    } catch (_) {
      /* ignore */
    }
  });
}

/**
 * v3.4: Inicia o loop com perfis completos (respeita notificationsEnabled por perfil).
 * Filtra apenas regiões de perfis que têm notificationsEnabled !== false.
 * @param {Array<Object>} profiles - perfis completos com region + notificationsEnabled
 */
function startWithProfiles(profiles) {
  if (_timer) return;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return start(['br']);
  }
  // Filtra apenas perfis com notificationsEnabled (default true)
  const enabledProfiles = profiles.filter(function (p) {
    return p && p.notificationsEnabled !== false;
  });
  if (enabledProfiles.length === 0) {
    logger.info('EventTimers: nenhum perfil com notificações habilitadas — daemon ocioso');
    return;
  }
  // Extrai regiões únicas dos perfis habilitados
  const regions = [];
  enabledProfiles.forEach(function (p) {
    if (p.region && regions.indexOf(p.region) === -1) regions.push(p.region);
  });
  if (regions.length === 0) regions.push('br');
  logger.info(
    'EventTimers: iniciado (v3.4) — ' +
      enabledProfiles.length +
      '/' +
      profiles.length +
      ' perfil(is) com notificações, regiões: ' +
      regions.join(', ')
  );
  start(regions);
}

/**
 * Inicia o loop. Monitora TODAS as regiões ativas (para perfis de regiões diferentes).
 * A cada 30s checa se algum lembrete deve disparar.
 * @param {Array<string>} activeRegions — regiões dos perfis ativos
 */
function start(activeRegions) {
  if (_timer) return;
  const regions = Array.isArray(activeRegions) && activeRegions.length > 0 ? activeRegions : ['br'];
  logger.info('EventTimers: iniciado — regiões monitoradas: ' + regions.join(', '));

  // Estado: map region+eventId → já lembrou (evita duplo disparo)
  const fired = new Set();

  _timer = setInterval(function () {
    const now = Date.now();
    regions.forEach(function (region) {
      const events = EVENTS_BY_REGION[region] || [];
      events.forEach(function (ev) {
        ev.hours.forEach(function (hour) {
          const occ = nextOccurrenceMs(region, hour);
          const fireAt = occ - ev.remindMin * 60 * 1000;
          const key = region + ':' + ev.id + ':' + occ;
          // Dispara se estamos na janela de 0-60s após o fireAt e não disparamos ainda
          if (now >= fireAt && now < fireAt + 60000 && !fired.has(key)) {
            fired.add(key);
            showNotification(ev, region);
            // Limpa o set periodicamente (mantém <1000 entradas)
            if (fired.size > 500) {
              const it = fired.values();
              for (let i = 0; i < 400; i++) fired.delete(it.next().value);
            }
          }
        });
      });
    });
  }, 30000);

  if (_timer.unref) _timer.unref();
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = {
  start: start,
  startWithProfiles: startWithProfiles,
  stop: stop,
  getUpcoming: getUpcoming,
  isMuted: isMuted,
  setMuted: setMuted,
  onRemind: onRemind,
  REGION_TZ: REGION_TZ,
  EVENTS_BY_REGION: EVENTS_BY_REGION,
  getUserOffsetHours: getUserOffsetHours,
  getServerOffsetHours: getServerOffsetHours,
  serverToUserOffsetHours: serverToUserOffsetHours
};
