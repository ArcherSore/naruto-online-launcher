'use strict';

const path = require('path');

function entryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function configureApplicationIdentity(app, repoRoot) {
  let packageJson;
  try {
    packageJson = require(path.join(repoRoot, 'package.json'));
  } catch (_) {
    throw entryError('launcher-package-unavailable');
  }
  if (!packageJson || typeof packageJson.name !== 'string' || !packageJson.name) {
    throw entryError('launcher-package-invalid');
  }
  if (typeof app.setName === 'function') app.setName(packageJson.name);
  if (typeof app.getPath === 'function' && typeof app.setPath === 'function') {
    app.setPath('userData', path.join(app.getPath('appData'), packageJson.name));
  }
  return Object.freeze({ name: packageJson.name });
}

function startDeveloperLauncher(options) {
  const opts = options || {};
  const electron = opts.electron || require('electron');
  if (!electron || typeof electron !== 'object' || !electron.app) {
    throw entryError('electron-app-unavailable');
  }
  const processObject = opts.processObject || process;
  const repoRoot = path.resolve(opts.repoRoot || path.join(__dirname, '..', '..'));
  configureApplicationIdentity(electron.app, repoRoot);
  const bootstrap = opts.bootstrap || require('./launcher-bootstrap');
  const loadFormalMain = opts.loadFormalMain || require;
  const controller = bootstrap.createLauncherBootstrap({
    app: electron.app,
    processObject: processObject,
    repoRoot: repoRoot
  });
  if (!controller.environment || controller.environment.ok !== true) {
    const code = controller.environment && controller.environment.code
      ? controller.environment.code
      : 'unknown';
    throw entryError('vision-author-environment-invalid:' + code);
  }
  if (controller.install() !== true) throw entryError('vision-author-bootstrap-install-failed');
  loadFormalMain(path.join(repoRoot, 'src', 'main.js'));
  return controller;
}

module.exports = {
  configureApplicationIdentity: configureApplicationIdentity,
  entryError: entryError,
  startDeveloperLauncher: startDeveloperLauncher
};
