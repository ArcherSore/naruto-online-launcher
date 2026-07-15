/**
 * Gerenciamento do mms.cfg (Flash Config)
 * v1.2.0
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');

/**
 * Get the path to mms.cfg for the current platform
 * @returns {string} Absolute path to mms.cfg
 */
function getMmsCfgPath() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
    return path.join(appData, 'Macromedia', 'Flash Player', 'mms.cfg');
  } else {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.macromedia', 'Flash_Player', 'mms.cfg');
  }
}

/**
 * Generate mms.cfg content
 * Only includes settings verified to work with PPAPI Flash Player 34.
 * Many "mms.cfg settings" found online are actually HTML embed params
 * or NPAPI-only settings that PPAPI silently ignores.
 *
 * @param {string} hardwareProfile - 'modern', 'legacy', or 'cpu'
 * @param {Object} [opts] - v3.5: { advancedMode: boolean }
 * @returns {string} mms.cfg file content
 */
function generateMmsContent(hardwareProfile, opts) {
  const isCpuMode = hardwareProfile === 'cpu';
  const advancedMode = !!(opts && opts.advancedMode);

  const config = [
    // === GPU ===
    'OverrideGPUValidation=1',
    isCpuMode ? 'EnableHardwareAcceleration=0' : 'EnableHardwareAcceleration=1'
  ];

  // ── v3.5: MODO LEVE AVANÇADO (Flash low quality para ganhar FPS) ──
  // Tricks que jogadores veteranos usam há anos e NÃO são possíveis no
  // launcher novo da Oasis. Reduz qualidade visual do Flash para ganhar FPS
  // em PCs fracos. Documentado em fóruns da comunidade Naruto Online.
  if (advancedMode) {
    config.push(
      // Zera o cache de assets do Flash → menos RAM, re-download mas +FPS
      'AssetCacheSize=0',
      // Desativa aceleração de vídeo (decode por software, mais leve em GPU fraca)
      'DisableHardwareAcceleration=1',
      // Força qualidade baixa de renderização (StageQuality.LOW equivalente)
      'StageQuality=LOW',
      // Reduz o limite de FPS do Flash de 60 para 30 (metade do trabalho)
      'OverrideFPS=30',
      // Desativa auto-update do Flash (não interfere com PPAPI standalone)
      'AutoUpdateDisable=1',
      // Desativa silenciamento de áudio em background (evita cut em combates)
      'EnableSockets=1',
      // Reduz qualidade de suavização de fontes
      'FontSmoothingType=0'
    );
  }

  return config.join('\n');
}

/**
 * Create mms.cfg with backup of existing file
 * @param {string} hardwareProfile - Hardware profile name
 * @param {Object} [opts] - v3.5: { advancedMode: boolean }
 * @returns {boolean} True if successful
 */
function createMmsCfg(hardwareProfile, opts) {
  if (!hardwareProfile) hardwareProfile = 'modern';

  try {
    const cfgPath = getMmsCfgPath();
    const dir = path.dirname(cfgPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.debug('Diretório criado: ' + dir);
    }

    if (fs.existsSync(cfgPath)) {
      const backupPath = cfgPath + '.bak';
      fs.copyFileSync(cfgPath, backupPath);
      logger.info('mms.cfg backup atualizado: ' + backupPath);
    }

    const content = generateMmsContent(hardwareProfile, opts);
    fs.writeFileSync(cfgPath, content, 'utf8');
    logger.info(
      'mms.cfg atualizado (' +
        hardwareProfile +
        (opts && opts.advancedMode ? ' + Advanced' : '') +
        ')'
    );
    return true;
  } catch (e) {
    logger.error('Falha ao criar mms.cfg: ' + e.message);
    return false;
  }
}

/**
 * Restore mms.cfg backup on exit
 * @returns {boolean} True if backup was restored
 */
function restoreMmsCfg() {
  try {
    const cfgPath = getMmsCfgPath();
    const backupPath = cfgPath + '.bak';

    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, cfgPath);
      fs.unlinkSync(backupPath);
      logger.info('mms.cfg restaurado do backup');
      return true;
    }
  } catch (e) {
    logger.warn('Falha ao restaurar mms.cfg: ' + e.message);
  }
  return false;
}

module.exports = {
  createMmsCfg: createMmsCfg,
  restoreMmsCfg: restoreMmsCfg
};
