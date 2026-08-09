'use strict';

const CODES = Object.freeze({
  SCRIPTS_ROOT_UNAVAILABLE: 'scripts-root-unavailable',
  MANIFEST_READ_FAILED: 'manifest-read-failed',
  MANIFEST_JSON_INVALID: 'manifest-json-invalid',
  MANIFEST_INVALID: 'manifest-invalid',
  MANIFEST_SCHEMA_INCOMPATIBLE: 'manifest-schema-incompatible',
  SCRIPT_ID_CONFLICT: 'script-id-conflict',
  ENTRY_OUTSIDE_PACKAGE: 'entry-outside-package',
  ENTRY_MISSING: 'entry-missing',
  ENTRY_LOAD_FAILED: 'entry-load-failed',
  ENTRY_CONTRACT_INVALID: 'entry-contract-invalid',
  API_VERSION_INCOMPATIBLE: 'api-version-incompatible',
  SCRIPT_NOT_FOUND: 'script-not-found',
  PROFILE_NOT_FOUND: 'profile-not-found',
  PROFILE_BUSY: 'profile-busy',
  GAME_NOT_READY: 'game-not-ready',
  WINDOW_UNAVAILABLE: 'window-unavailable',
  CONFIG_INVALID: 'config-invalid',
  COORDINATES_MISSING: 'coordinates-missing',
  COORDINATES_INVALID: 'coordinates-invalid',
  RUN_NOT_ACTIVE: 'run-not-active',
  RUN_CANCELLED: 'run-cancelled',
  RUN_TIMEOUT: 'run-timeout',
  SCRIPT_FAILED: 'script-failed',
  CAPTURE_FAILED: 'capture-failed',
  CAPTURE_EXPIRED: 'capture-expired',
  CDP_UNAVAILABLE: 'cdp-unavailable',
  CDP_ALREADY_ATTACHED: 'cdp-already-attached',
  CDP_ATTACH_FAILED: 'cdp-attach-failed',
  CDP_DETACHED: 'cdp-detached',
  CDP_DISPATCH_FAILED: 'cdp-dispatch-failed',
  ACTION_TIMEOUT: 'action-timeout',
  STORAGE_READ_FAILED: 'storage-read-failed',
  STORAGE_WRITE_FAILED: 'storage-write-failed'
});

const SAFE_MESSAGES = Object.freeze({
  'scripts-root-unavailable': '内置脚本目录不可用',
  'manifest-read-failed': '无法读取内置脚本 manifest',
  'manifest-json-invalid': '内置脚本 manifest 不是有效 JSON',
  'manifest-invalid': '内置脚本 manifest 不符合 v1 合同',
  'manifest-schema-incompatible': '内置脚本 manifest 版本不兼容',
  'script-id-conflict': '内置脚本 ID 冲突',
  'entry-outside-package': '内置脚本入口位于脚本包之外',
  'entry-missing': '内置脚本入口不存在',
  'entry-load-failed': '内置脚本入口加载失败',
  'entry-contract-invalid': '内置脚本入口导出合同无效',
  'api-version-incompatible': '内置脚本 API 版本不兼容',
  'script-not-found': '未找到指定内置脚本',
  'profile-not-found': '未找到指定 Profile',
  'profile-busy': '该 Profile 正在执行其他自动化任务',
  'game-not-ready': '游戏尚未就绪',
  'window-unavailable': 'Profile 游戏窗口不可用',
  'config-invalid': '脚本配置无效或不兼容',
  'coordinates-missing': '尚未记录脚本坐标',
  'coordinates-invalid': '脚本坐标无效或不兼容',
  'run-not-active': '指定运行已不再活动',
  'run-cancelled': '脚本运行已取消',
  'run-timeout': '脚本运行超过时限',
  'script-failed': '内置脚本执行失败',
  'capture-failed': '游戏画面截图失败',
  'capture-expired': '录点截图已过期，请重新截图',
  'cdp-unavailable': '后台输入通道不可用',
  'cdp-already-attached': '后台输入通道正被调试工具占用',
  'cdp-attach-failed': '无法连接后台输入通道',
  'cdp-detached': '后台输入通道意外断开',
  'cdp-dispatch-failed': '后台点击派发失败',
  'action-timeout': '自动化动作超过时限',
  'storage-read-failed': '无法读取脚本用户数据',
  'storage-write-failed': '无法保存脚本用户数据'
});

const KNOWN_CODES = new Set(Object.values(CODES));

class AutomationError extends Error {
  constructor(code) {
    const safeCode = KNOWN_CODES.has(code) ? code : CODES.SCRIPT_FAILED;
    super(SAFE_MESSAGES[safeCode]);
    this.name = 'AutomationError';
    this.code = safeCode;
    this.safeMessage = SAFE_MESSAGES[safeCode];
  }
}

function toAutomationError(error, fallbackCode) {
  if (error instanceof AutomationError) return error;
  if (error && KNOWN_CODES.has(error.code)) return new AutomationError(error.code);
  return new AutomationError(KNOWN_CODES.has(fallbackCode) ? fallbackCode : CODES.SCRIPT_FAILED);
}

function toSafeError(error, fallbackCode) {
  const safe = toAutomationError(error, fallbackCode);
  return Object.freeze({ code: safe.code, safeMessage: safe.safeMessage });
}

function isKnownCode(code) {
  return KNOWN_CODES.has(code);
}

module.exports = {
  AutomationError: AutomationError,
  CODES: CODES,
  SAFE_MESSAGES: SAFE_MESSAGES,
  isKnownCode: isKnownCode,
  toAutomationError: toAutomationError,
  toSafeError: toSafeError
};
