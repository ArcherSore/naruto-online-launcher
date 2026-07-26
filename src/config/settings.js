/**
 * Carregamento e Salvamento de Configuração
 * v1.2.0 - Window bounds persistence, async file operations
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('../utils/logger');
const { isValidRegion, getDefaultRegion } = require('./regions');
const { isValidProfile, getDefaultProfile } = require('./hardware');
const { isValidPreset, getDefaultPreset } = require('./optimization');
const i18n = require('./i18n');

function normalizeLanguage(language) {
  return typeof language === 'string' && i18n.SUPPORTED.indexOf(language) !== -1
    ? language
    : i18n.DEFAULT_LANGUAGE;
}

/**
 * Get the configuration file path
 * @returns {string} Absolute path to config.json
 */
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

/**
 * Validate and sanitize configuration values
 * @param {Object} rawConfig - Raw configuration from file
 * @returns {Object} Validated configuration
 */
function validateConfig(rawConfig) {
  const region = rawConfig && rawConfig.region;
  const hardwareProfile = rawConfig && rawConfig.hardwareProfile;
  const forceBatata = rawConfig && rawConfig.forceBatata;

  const optimizationPreset = rawConfig && rawConfig.optimizationPreset;

  const validated = {
    region: isValidRegion(region) ? region : getDefaultRegion(),
    hardwareProfile: isValidProfile(hardwareProfile) ? hardwareProfile : getDefaultProfile(),
    forceBatata: forceBatata === true ? true : forceBatata === false ? false : undefined,
    windowBounds: (rawConfig && rawConfig.windowBounds) || null,
    // v3.5: onboarding + i18n + Modo Leve Avançado
    firstBoot: rawConfig && rawConfig.firstBoot === false ? false : true, // default true até concluir setup
    language: normalizeLanguage(rawConfig && rawConfig.language),
    advancedMode: rawConfig && rawConfig.advancedMode === true, // Modo Leve Avançado (Flash low quality)
    // v5.0.0: optimization preset (performance/balanced/quality) — aplicado em flags.js
    optimizationPreset: isValidPreset(optimizationPreset) ? optimizationPreset : getDefaultPreset()
  };

  if (region !== undefined && !isValidRegion(region)) {
    logger.warn('Config: invalid region=' + region + ', using default=' + validated.region);
  }
  if (hardwareProfile !== undefined && !isValidProfile(hardwareProfile)) {
    logger.warn(
      'Config: invalid hardwareProfile=' +
        hardwareProfile +
        ', using default=' +
        validated.hardwareProfile
    );
  }

  return validated;
}

/**
 * Load configuration from disk, falling back to defaults
 * @returns {Object} Configuration object
 */
function loadConfig() {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      logger.info('Config: using defaults (first run)');
      return validateConfig({});
    }

    // v5.9.15: Reject unreasonably large config files (prevent OOM on corruption)
    var stat = fs.statSync(configPath);
    if (stat.size > 1 * 1024 * 1024) {
      logger.error('Config file too large (' + stat.size + ' bytes), using defaults');
      return validateConfig({});
    }

    const rawContent = fs.readFileSync(configPath, 'utf8');
    let rawConfig;

    try {
      rawConfig = JSON.parse(rawContent);
    } catch (parseError) {
      logger.error('Config: invalid JSON, using defaults: ' + parseError.message);
      return validateConfig({});
    }

    const config = validateConfig(rawConfig);
    logger.info('Config: loaded region=' + config.region + ', profile=' + config.hardwareProfile);

    return config;
  } catch (e) {
    logger.error('Config: load failed, using defaults: ' + e.message);
    return validateConfig({});
  }
}

/**
 * Save configuration to disk (atomic write via tmp + rename)
 * @param {Object} config - Configuration object
 * @returns {boolean} True if saved successfully
 */
function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    const content = JSON.stringify(
      {
        region: config.region,
        hardwareProfile: config.hardwareProfile,
        forceBatata: config.forceBatata,
        windowBounds: config.windowBounds || null,
        // v3.5
        firstBoot: config.firstBoot === false ? false : true,
        language: normalizeLanguage(config.language),
        advancedMode: config.advancedMode === true,
        // v5.0.0: optimization preset
        optimizationPreset: config.optimizationPreset || getDefaultPreset()
      },
      null,
      2
    );

    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, configPath);
    logger.info('Config: saved');
    return true;
  } catch (e) {
    logger.error('Config: save failed: ' + e.message);
    return false;
  }
}

module.exports = {
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  validateConfig: validateConfig,
  normalizeLanguage: normalizeLanguage
};
