'use strict';

const fs = require('fs');
const path = require('path');

describe('manager automation panel assets', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  test('contains a generic automation dialog, script list, and coordinate image', () => {
    expect(html).toContain('id="automationModal"');
    expect(html).toContain('id="automationCapture"');
    expect(html).toContain('id="automationScriptList"');
    expect(html).toContain("img-src 'self' data:");
    expect(css).toContain('.automation-capture-wrap img[hidden]');
  });

  test('offers screenshot ROI selection and in-launcher Vision matching/clicking', () => {
    expect(html).toContain('id="automationVisionSelectBtn"');
    expect(html).toContain('id="automationSelectionOverlay"');
    expect(html).toContain('id="automationMatchOverlay"');
    expect(html).toContain('id="automationVisionRoiText"');
    expect(html).toContain('id="automationVisionCenterText"');
    expect(html).toContain('id="automationVisionTemplateId"');
    expect(html).toContain('id="automationVisionThreshold"');
    expect(html).toContain('id="automationVisionMatchBtn"');
    expect(html).toContain('id="automationVisionMatchClickBtn"');
    expect(html).toContain('id="automationVisionMatchText"');
    expect(html).toContain('id="automationVisionCopyBtn"');
    expect(js).toContain("automationCaptureMode = 'vision-roi'");
    expect(js).toContain("'automation:recording:add-point'");
    expect(js).toContain("'automation:vision:templates'");
    expect(js).toContain("'automation:vision:test'");
    expect(js).toContain("click: shouldClick");
    expect(js).toContain("clipboard.writeText('--roi '");
    expect(css).toContain('.automation-selection-overlay');
    expect(css).toContain('.automation-match-overlay');
  });

  test('renders script identity and uses only generic versioned channels', () => {
    expect(js).toContain('script.id');
    expect(js).toContain('script.version');
    expect(js).toContain('script.apiVersion');
    ['automation:list', 'automation:start', 'automation:recording:begin',
      'automation:recording:add-point', 'automation:vision:templates',
      'automation:vision:test', 'automation:coordinates:clear'].forEach(function (channel) {
      expect(js).toContain("'" + channel + "'");
    });
    expect(js).not.toContain('automation-demo:');
  });

  test('uses target availability for start and recording while keeping readiness diagnostic', () => {
    expect(js).toContain('const runnable = automationTarget.available === true;');
    expect(js).not.toContain(
      'const runnable = automationTarget.available === true && automationTarget.gameReady === true;'
    );
    expect(js).not.toContain('!automationTarget.available || !automationTarget.gameReady');
    expect(js).toContain('elements.automationRecord.disabled');
    expect(js).toContain("ipcRenderer.on('launch-flow:status'");
    expect(js).toContain("state.stage === 'GAME_READY'");
  });

  test('renders stop/stopping, restores status snapshots, and has fixed recovery copy', () => {
    expect(js).toContain("'automation:stop'");
    expect(js).toContain("stopping: '停止中'");
    expect(js).toContain("ipcRenderer.on('automation:status'");
    expect(js).toContain("ipcRenderer.on('automation:statuses'");
    ['profile-busy', 'cdp-already-attached', 'run-timeout', 'window-unavailable',
      'coordinates-invalid', 'vision-input-invalid', 'vision-template-not-found',
      'vision-timeout'].forEach(function (code) {
      expect(js).toContain("'" + code + "'");
    });
  });

  test('updates availability for the selected Profile when its game window opens or closes', () => {
    expect(js).toContain('state.profileId === automationProfileId');
    expect(js).toContain('automationTarget.available = state.open === true');
  });
});
