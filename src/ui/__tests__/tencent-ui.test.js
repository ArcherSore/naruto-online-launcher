'use strict';

const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..');

function readUiFile(name) {
  return fs.readFileSync(path.join(UI_DIR, name), 'utf8');
}

function withoutHtmlComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '');
}

describe('腾讯 Profile 管理界面边界', () => {
  const html = withoutHtmlComments(readUiFile('index.html'));
  const setupHtml = withoutHtmlComments(readUiFile(path.join('setup', 'setup.html')));
  const appSource = readUiFile('app.js');
  const styles = readUiFile('styles.css');

  test('HTML 不再呈现国际服 region/server 本地选择控件', () => {
    ['regionTabs', 'fRegion', 'fServer', 'btnPickServer', 'serverHint', 'filterRegion'].forEach(
      function (id) {
        expect(html).not.toMatch(new RegExp('id=["\\\']' + id + '["\\\']'));
      }
    );
    expect(html).not.toMatch(/Buscar conta por nome, servidor ou região/i);
    expect(setupHtml).not.toMatch(/class=["']region-(?:grid|btn)["']|data-region=/i);
    expect(setupHtml).not.toMatch(/setup\.region\.|selectedRegion|region:\s*selectedRegion/i);
  });

  test('HTML 不再呈现邮箱、密码、tempmail、Vault 或旧凭据备份控件', () => {
    [
      'vaultModal',
      'fVaultUser',
      'fVaultPass',
      'saveVault',
      'removeVault',
      'devTempmailCreate',
      'devApiLoginEmail',
      'advBackupExport',
      'advBackupImport'
    ].forEach(function (id) {
      expect(html).not.toMatch(new RegExp('id=["\\\']' + id + '["\\\']'));
    });
    expect(html).not.toMatch(/tempmail|credenciais|auto-login|type=["']password["']/i);
  });

  test('renderer 不再动态生成旧 region/server、Vault 或 auto-login 控件', () => {
    expect(appSource).not.toMatch(
      /data-act=["'](?:switch-server|vault)["']|filterRegion|filterVault|autologin-badge|has-vault/
    );
    expect(appSource).not.toMatch(
      /ipcRenderer\.(?:invoke|send)\(["'](?:servers:|vault:|tempmail:|auto-login:)/
    );
    expect(appSource).not.toMatch(/createTempmail|openVault|buildServerOptions|renderRegionTabs/);
  });

  test('样式表不再保留旧可见控件的专用样式', () => {
    expect(styles).not.toMatch(
      /\.card\.has-vault|\.server-switch|#regionTabs|@keyframes\s+vaultPulse/
    );
  });

  test('管理界面源码不包含 Oasis 或其他国际服品牌入口', () => {
    expect([html, setupHtml, appSource].join('\n')).not.toMatch(
      /Oasis|narutowebgame\.com|ShinobiLauncher\/|logintype=/i
    );
  });

  test('默认可见文案为中文且不展示旧启动器品牌', () => {
    expect(html).toMatch(/<html lang="zh-CN">/);
    expect([html, setupHtml, appSource].join('\n')).not.toMatch(
      /Bem-vindo|Carregando|Português|Shinobi Launcher/i
    );
    expect([html, appSource].join('\n')).toMatch(/[\u4e00-\u9fff]/);
  });

  test('管理卡片不显示流程状态说明或动态恢复动作', () => {
    expect(appSource).not.toMatch(
      /STAGE_LABELS|RECOVERY_LABELS|flowSummary|flow-state|flow-recovery-actions/
    );
    expect(styles).not.toMatch(/\.flow-state|\.flow-recovery-actions/);
    expect(appSource).not.toMatch(
      /autoSelect|autoEnterGame|selectLastServer|data-action=["'](?:auto-select|enter-game)/
    );
  });

  test('未启动显示“打开”，运行中常态显示安全刷新按钮', () => {
    expect(appSource).toMatch(/data-action=["']launch["']>打开<\/button>/);
    expect(appSource).not.toMatch(/打开官方扫码\/选服页/);
    expect(appSource).toMatch(/data-action=["']refresh["']>刷新<\/button>/);
    expect(appSource).toMatch(/ipcRenderer\.send\(["']profile:refresh["'],\s*profileId\)/);
  });

  test('Debug 模式提供管理窗口 CDP POC，且不通过游戏窗口 DevTools 触发', () => {
    expect(html).toMatch(/id=["']automationModal["']/);
    expect(html).toMatch(/id=["']automationCaptureBtn["'][^>]*>[\s\S]*获取坐标/);
    expect(html).toMatch(/id=["']automationRunBtn["'][^>]*>Run<\/button>/);
    expect(html).toMatch(/id=["']automationCoordinateList["']/);
    expect(appSource).toMatch(/process\.env\.SHINOBI_DEBUG\s*===\s*["']1["']/);
    expect(appSource).toMatch(/automation-demo:manager-recording-begin/);
    expect(appSource).toMatch(/automation-demo:manager-record-point/);
    expect(appSource).toMatch(/automation-demo:manager-recording-clear/);
    expect(appSource).toMatch(/automation-demo:manager-run-script/);
    expect(appSource).not.toMatch(
      /dev:toggle-devtools.*automation-demo|automation-demo.*toggleDevTools/s
    );
  });
});
