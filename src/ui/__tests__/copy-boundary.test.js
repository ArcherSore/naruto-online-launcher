'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const SURFACES = {
  'setup.window': ['src/main.js', 'src/ui/setup/setup.html'],
  'manager.window': [
    'src/config/optimization.js',
    'src/ui/index.html',
    'src/ui/app.js',
    'src/ui/manager/ManagerWindow.js'
  ],
  'manager.toast-dialog': ['src/ui/manager/IpcRouter.js'],
  'game.loading.inline': ['src/app/Launcher.js'],
  'game.loading.asset': ['src/ui/loading/loading.html'],
  'native.flash-missing': ['src/main.js'],
  'profile.generated-name': ['src/profiles/store.js', 'src/ui/manager/IpcRouter.js'],
  'diagnostics.export': ['src/utils/diagnostics.js', 'src/ui/manager/IpcRouter.js'],
  'linux.install': ['linux/install.sh'],
  'linux.uninstall': ['linux/uninstall.sh'],
  'linux.run-error': ['linux/run.sh'],
  'linux.desktop': ['linux/naruto-online.desktop', 'linux/install.sh'],
  'package.desktop': ['package.json'],
  'tray-menu-notification': []
};

const PROTECTED_PREFIXES = [
  'docs/',
  'specs/',
  'node_modules/',
  'flash/',
  'src/app/TencentLaunchFlow.js',
  'src/app/SessionLifecycle.js',
  'src/config/urls.js',
  'src/network/inspector.js',
  'src/profiles/partition.js',
  'src/utils/logger.js'
];

const TECHNICAL_TERMS = [
  'Naruto Online',
  'Flash',
  'PPAPI',
  'SWF',
  'GPU',
  'CPU',
  'RAM',
  'GC',
  'FPS',
  'Session',
  'Profile',
  'Partition',
  'URL',
  'JSON',
  'ZIP',
  'DOM',
  'IPC',
  'AppImage',
  'FUSE',
  'X11',
  'Wayland',
  'DevTools',
  'GitHub',
  'QQ',
  'MB',
  'KB/s',
  'ETA'
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function isProtectedPath(relativePath) {
  return PROTECTED_PREFIXES.some(
    prefix => relativePath === prefix || relativePath.startsWith(prefix)
  );
}

function visibleCopy(relativePath) {
  const source = read(relativePath);
  if (relativePath.endsWith('.sh')) {
    return source
      .split(/\r?\n/)
      .filter(
        line =>
          !/>>|Uninstall Log/.test(line) &&
          /\b(?:echo|log_(?:info|warn|error|step)|read -r|read -rp)\b|^(?:Name|Comment|GenericName)=/.test(
            line
          )
      )
      .join('\n');
  }
  if (relativePath.endsWith('.js')) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/logger\.(?:debug|info|warn|error)\([\s\S]*?\);/g, '')
      .replace(/\berror:\s*(['"])[^\r\n]*?\1/g, '');
  }
  if (relativePath.endsWith('.html')) {
    return source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }
  return source;
}

describe('launcher-owned copy boundary registry', () => {
  test.each(Object.entries(SURFACES))(
    '%s has existing sources or is explicitly N/A',
    (_, files) => {
      if (files.length === 0) {
        expect(files).toEqual([]);
        return;
      }
      files.forEach(file => expect(fs.existsSync(path.join(ROOT, file))).toBe(true));
    }
  );

  test('protected paths are excluded from launcher-owned copy scans', () => {
    expect(isProtectedPath('docs/REPO_MAP.md')).toBe(true);
    expect(isProtectedPath('specs/001-tencent-game-launch/spec.md')).toBe(true);
    expect(isProtectedPath('src/app/TencentLaunchFlow.js')).toBe(true);
    expect(isProtectedPath('src/profiles/partition.js')).toBe(true);
    expect(isProtectedPath('src/ui/index.html')).toBe(false);
  });

  test('surface registry includes dormant and system-integration assets', () => {
    expect(SURFACES['game.loading.asset']).toContain('src/ui/loading/loading.html');
    expect(SURFACES['linux.install']).toContain('linux/install.sh');
    expect(SURFACES['package.desktop']).toContain('package.json');
  });

  test('runtime language source uses zh-CN and excludes Portuguese locales', () => {
    const i18n = require('../../config/i18n');
    expect(i18n.DEFAULT_LANGUAGE).toBe('zh-CN');
    expect(i18n.getLanguage()).toBe('zh-CN');
    expect(i18n.SUPPORTED).toContain('zh-CN');
    expect(i18n.SUPPORTED).not.toEqual(expect.arrayContaining(['pt', 'pt-BR', 'pt_BR']));
  });

  test('setup first frame and runtime locale sets stay in parity', () => {
    const setup = read('src/ui/setup/setup.html');
    const i18n = require('../../config/i18n');
    const setupLocales = Array.from(setup.matchAll(/data-lang="([^"]+)"/g), match => match[1]);
    expect(setup).toMatch(/<html lang="zh-CN">/);
    expect(setup).toMatch(/class="lang-btn active" data-lang="zh-CN"/);
    expect(new Set(setupLocales)).toEqual(new Set(i18n.SUPPORTED));
    expect(setup).not.toMatch(/data-lang="pt(?:-BR|_BR)?"/i);
  });

  test('launcher-owned reachable surfaces contain no known Portuguese or legacy product copy', () => {
    const source = Object.values(SURFACES)
      .flat()
      .filter(file => !isProtectedPath(file))
      .map(visibleCopy)
      .join('\n');
    expect(source).not.toMatch(
      /Bem-vindo|Carregando|Tentar novamente|Perfil não encontrado|Exportar perfis|Diagnóstico falhou|Português|Balanceado|Qualidade|Máximo FPS|Padrão|Compatibilidade|Oasis|narutowebgame\.com|Shinobi Launcher/i
    );
  });

  test('optimization presets returned to the UI use Chinese copy', () => {
    const presets = require('../../config/optimization').listForUI();
    presets.forEach(preset => {
      expect(preset.name).toMatch(/[\u4e00-\u9fff]/);
      expect(preset.description).toMatch(/[\u4e00-\u9fff]/);
    });
  });

  test('desktop and shell display strings are Chinese while machine fields remain', () => {
    const install = visibleCopy('linux/install.sh');
    const uninstall = visibleCopy('linux/uninstall.sh');
    const run = visibleCopy('linux/run.sh');
    const desktop = read('linux/naruto-online.desktop');
    const packageJson = JSON.parse(read('package.json'));

    expect([install, uninstall, run, desktop].join('\n')).not.toMatch(
      /Installer|Uninstaller|Please run the installer again|Instalação|Desinstalação/i
    );
    expect(desktop).toMatch(/Comment=.*[\u4e00-\u9fff]/);
    expect(packageJson.build.linux.desktop.Comment).toMatch(/[\u4e00-\u9fff]/);
    expect(packageJson.build.productName).toBe('Naruto Online');
    expect(packageJson.build.linux.desktop.StartupWMClass).toBe('Naruto Online');
  });

  test('technical allowlist is explicit and excludes ordinary English actions', () => {
    expect(TECHNICAL_TERMS).toEqual(
      expect.arrayContaining(['Flash', 'PPAPI', 'Session', 'Profile', 'URL', 'ZIP'])
    );
    expect(TECHNICAL_TERMS).not.toEqual(
      expect.arrayContaining(['Save', 'Exit', 'Play', 'Installer', 'Uninstaller'])
    );
  });

  test('protected content categories remain represented by scoped exclusions', () => {
    expect(PROTECTED_PREFIXES).toEqual(
      expect.arrayContaining([
        'docs/',
        'specs/',
        'flash/',
        'src/app/TencentLaunchFlow.js',
        'src/profiles/partition.js',
        'src/utils/logger.js'
      ])
    );
    expect(PROTECTED_PREFIXES).not.toContain('src/ui/');
  });
});

module.exports = {
  PROTECTED_PREFIXES,
  ROOT,
  SURFACES,
  TECHNICAL_TERMS,
  isProtectedPath,
  read,
  visibleCopy
};
