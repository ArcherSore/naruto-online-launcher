'use strict';

const fs = require('fs');
const path = require('path');

describe('main automation shutdown wiring', () => {
  test('delays the first before-quit until asynchronous automation cleanup settles', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
    const beforeQuit = source.slice(source.indexOf("app.on('before-quit'"),
      source.indexOf("app.on('window-all-closed'"));
    expect(beforeQuit).toContain('event.preventDefault()');
    expect(beforeQuit).toContain('Promise.resolve(automationService.shutdown())');
    expect(beforeQuit).toContain('automationShutdownStarted');
    expect(beforeQuit).toContain('app.quit()');
  });

  test('logs only a registry summary and safe per-package registration identity', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
    const start = source.indexOf('automationService = createAutomationService');
    const end = source.indexOf("require('./ui/manager/StateBroadcaster')", start);
    const registration = source.slice(start, end);
    expect(registration).toContain('automationService.listCatalog()');
    expect(registration).toContain('automationService.registrationIssues()');
    expect(registration).toContain("logger.info('Automation: registry scan complete'");
    expect(registration).toContain("logger.warn('Automation: package registration rejected'");
    ['registeredCount', 'issueCount', 'packageName', 'scriptId', 'errorCode'].forEach(function (field) {
      expect(registration).toContain(field);
    });
    expect(registration).not.toMatch(/entryPath|packageRoot|safeMessage|manifest\s*:/);
  });
});
