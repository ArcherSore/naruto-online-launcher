/**
 * 腾讯 Profile 的持久 Partition 映射与 Session 获取。
 *
 * 登录态完全由 Chromium 的 `persist:profile-<id>` Session 保存。本模块不读取、
 * 复制、序列化或恢复 Cookie。
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { app, session } = require('electron');
const logger = require('../utils/logger');

let _batataMode = false;

/**
 * Set whether shadow (ephemeral) partitions should be the default.
 * Called from memory/guard when Modo Batata toggles.
 * @param {boolean} batata
 */
function setBatataMode(batata) {
  _batataMode = !!batata;
  logger.info(
    'partition: lightweightMode=' + _batataMode + ' shadowDefault=' + shouldUseShadow(null)
  );
}

// Compatibility with the upstream MemoryGuard terminology. Tencent profiles
// remain persistent regardless of the low-spec flag.
function setLowSpecMode(enabled) {
  setBatataMode(enabled);
}

/**
 * Decide se um perfil deve usar shadow (ephemeral) partition.
 * @param {Object|null} profile - profile object (may have .shadow override)
 * @returns {boolean}
 */
function shouldUseShadow(profile) {
  if (profile && profile.shadow === true) return true;
  if (_batataMode) return true;
  return false;
}

/**
 * 返回腾讯 Profile 的唯一持久 Partition 名称。
 * shadow/batata 标志是待调用者审计的旧能力，不得改变腾讯 Session 映射。
 * @param {Object|string} profile
 * @returns {string}
 */
function getPartitionName(profile) {
  const id = typeof profile === 'string' ? profile : profile && profile.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('profile id is required');
  }
  return 'persist:profile-' + id;
}

/**
 * 获取与 Profile 持久映射绑定的隔离 Electron Session。
 * @param {Object|string} profile
 * @returns {Electron.Session}
 */
function getProfileSession(profile) {
  return session.fromPartition(getPartitionName(profile));
}

/**
 * Cria eageramente o diretório da partition persistente no disco.
 * Necessário para que bunshin/clone de um perfil recém-criado não falhe com
 * "user-data-dir do origem não existe" (o Chromium só cria o dir no primeiro
 * launch — sem isso, operações que dependem do dir antes do primeiro launch
 * quebram).
 *
 * Em shadow mode (partition:profile-<id>), a partition é ephemeral e NÃO tem
 * dir em disco — este método é no-op.
 *
 * @param {Object|string} profile - profile object ou id
 * @returns {boolean} true se criou ou já existia
 */
function ensurePartitionDir(profile) {
  const id = typeof profile === 'string' ? profile : profile && profile.id;
  if (typeof id !== 'string' || id.length === 0) return false;

  try {
    const dir = path.join(app.getPath('userData'), 'Partitions', 'profile-' + id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info('partition: directory created eagerly path=' + dir);
    }
    return true;
  } catch (e) {
    logger.warn('partition: ensurePartitionDir failed: ' + e.message);
    return false;
  }
}

module.exports = {
  setBatataMode: setBatataMode,
  setLowSpecMode: setLowSpecMode,
  shouldUseShadow: shouldUseShadow,
  getPartitionName: getPartitionName,
  getProfileSession: getProfileSession,
  ensurePartitionDir: ensurePartitionDir
};
