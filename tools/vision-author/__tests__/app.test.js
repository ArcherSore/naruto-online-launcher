'use strict';

const helpers = require('./helpers');

function fakeElement() {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
    options: [],
    addEventListener: function (type, listener) { listeners[type] = listener; },
    dispatch: function (type, event) { return listeners[type](event || {}); },
    appendChild: function (child) { this.options.push(child); },
    remove: function (index) { this.options.splice(index, 1); },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 960, height: 540 }; },
    setPointerCapture: jest.fn(),
    releasePointerCapture: jest.fn()
  };
}

function fakeDocument() {
  const ids = [
    'profile-select', 'refresh-profiles', 'capture-image', 'capture-empty', 'freeze-button',
    'resume-button', 'status-value', 'profile-value', 'image-size-value', 'content-size-value',
    'captured-at-value', 'contract-value', 'error-panel', 'viewer', 'template-mode', 'roi-mode',
    'template-overlay', 'roi-overlay', 'template-value', 'roi-value', 'preview-image',
    'script-select', 'template-id', 'template-id-help', 'save-button', 'save-result', 'roi-output', 'find-output',
    'wait-output'
  ];
  const elements = {};
  ids.forEach(function (id) { elements[id] = fakeElement(); });
  elements['profile-select'].options.push({ value: '', textContent: '选择当前 Launcher Profile' });
  elements['script-select'].options.push({ value: '', textContent: '选择可信脚本' });
  return {
    elements: elements,
    getElementById: function (id) { return elements[id]; },
    createElement: function () { return fakeElement(); },
    querySelectorAll: function () { return []; }
  };
}

function result(profileId, epoch, frameId) {
  return {
    frame: {
      frameId: frameId,
      profile: { id: profileId, name: profileId },
      selectionEpoch: epoch,
      pngDataUrl: 'data:image/png;base64,cG5n',
      imageSize: { width: 1920, height: 1080 },
      contentSize: { width: 1920, height: 1080 },
      capturedAt: 1,
      contract: { valid: true, failures: [] }
    }
  };
}

describe('Vision Author renderer state races', () => {
  beforeEach(function () { jest.useFakeTimers(); });
  afterEach(function () { jest.useRealTimers(); });

  test('drops a late frame after rapid Profile switch', async () => {
    const first = helpers.deferred();
    const bridge = {
      capture: jest.fn(function (request) {
        return request.profileId === 'p_aaaaaaaa'
          ? first.promise
          : Promise.resolve(result('p_bbbbbbbb', request.selectionEpoch, 'frame-b'));
      }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    controller.selectProfile('p_bbbbbbbb');
    first.resolve(result('p_aaaaaaaa', 1, 'late-a'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().selectedProfileId).toBe('p_bbbbbbbb');
    expect(controller.getState().displayedFrameId).toBe(null);
    expect(bridge.markDisplayed).not.toHaveBeenCalledWith(expect.objectContaining({ frameId: 'late-a' }));

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().displayedFrameId).toBe('frame-b');
  });

  test('Freeze racing an in-flight response keeps the previous displayed frame', async () => {
    const second = helpers.deferred();
    let call = 0;
    const bridge = {
      capture: jest.fn(function (request) {
        call += 1;
        return call === 1
          ? Promise.resolve(result(request.profileId, request.selectionEpoch, 'old'))
          : second.promise;
      }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(async request => ({ frame: { frameId: request.frameId } })),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    const freezing = controller.freeze();
    second.resolve(result('p_aaaaaaaa', 1, 'late'));
    await freezing;
    await Promise.resolve();
    expect(controller.getState()).toEqual(expect.objectContaining({
      mode: 'FROZEN',
      displayedFrameId: 'old',
      frozenFrameId: 'old'
    }));
  });

  test('disconnect and capture failure produce finite recoverable states', async () => {
    const bridge = {
      capture: jest.fn()
        .mockRejectedValueOnce({ code: 'capture-failed', safeMessage: '失败', recovery: '重试' })
        .mockResolvedValueOnce(result('p_aaaaaaaa', 1, 'recovered')),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.selectProfile('p_aaaaaaaa');
    await Promise.resolve();
    expect(controller.getState().error).toEqual(expect.objectContaining({ code: 'capture-failed', recovery: '重试' }));
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().displayedFrameId).toBe('recovered');
    controller.disconnect({ code: 'connection-closed', safeMessage: '断开', recovery: '重启' });
    expect(controller.getState()).toEqual(expect.objectContaining({
      mode: 'DISCONNECTED',
      error: expect.objectContaining({ code: 'connection-closed', recovery: '重启' })
    }));
    const count = bridge.capture.mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect(bridge.capture).toHaveBeenCalledTimes(count);
  });

  test('refreshes Profile availability in place without duplicating options', async () => {
    const document = fakeDocument();
    const select = document.elements['profile-select'];
    const bridge = {
      listProfiles: jest.fn()
        .mockResolvedValueOnce({ profiles: [{ id: 'p_aaaaaaaa', name: 'A', available: false }] })
        .mockResolvedValueOnce({ profiles: [{ id: 'p_aaaaaaaa', name: 'A', available: true }] })
    };
    const { refreshProfileOptions } = require('../app/app');

    await refreshProfileOptions(document, bridge, select);
    expect(select.options).toHaveLength(2);
    expect(select.options[1]).toEqual(expect.objectContaining({ value: 'p_aaaaaaaa', disabled: true }));

    await refreshProfileOptions(document, bridge, select);
    expect(select.options).toHaveLength(2);
    expect(select.options[1]).toEqual(expect.objectContaining({ value: 'p_aaaaaaaa', disabled: false }));
  });

  test('renders the active Template rectangle during pointermove and commits only on pointerup', async () => {
    const document = fakeDocument();
    const bridge = {
      listProfiles: jest.fn(async () => ({ profiles: [{ id: 'p_aaaaaaaa', name: 'A', available: true }] })),
      listScripts: jest.fn(async () => ({ scripts: [] })),
      capture: jest.fn(async request => result(request.profileId, request.selectionEpoch, 'frame-live')),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(async request => ({ frame: { frameId: request.frameId } })),
      releaseFrame: jest.fn(async () => ({ released: true })),
      createPreview: jest.fn(async () => ({ preview: { previewId: 'preview-1', pngDataUrl: 'data:image/png;base64,cG5n' } })),
      onDisconnected: jest.fn()
    };
    const { initializeRenderer } = require('../app/app');
    const controller = initializeRenderer(document, bridge);
    const profileSelect = document.elements['profile-select'];
    profileSelect.value = 'p_aaaaaaaa';
    profileSelect.dispatch('change');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    document.elements['template-mode'].dispatch('click');
    document.elements.viewer.dispatch('pointerdown', { clientX: 100, clientY: 50, pointerId: 7 });
    await Promise.resolve();
    await Promise.resolve();
    document.elements.viewer.dispatch('pointermove', { clientX: 300, clientY: 200, pointerId: 7 });

    const overlay = document.elements['template-overlay'];
    expect(overlay.hidden).toBe(false);
    expect(overlay.style).toEqual(expect.objectContaining({
      left: '100px',
      top: '50px',
      width: '200px',
      height: '150px'
    }));
    expect(controller.getState().draft.template).toBeUndefined();

    document.elements.viewer.dispatch('pointerup', { clientX: 300, clientY: 200, pointerId: 7 });
    expect(controller.getState().draft.template).toEqual(expect.objectContaining({
      x: 200,
      y: 100,
      width: 400,
      height: 300
    }));
    controller.disconnect();
  });

  test('does not restart image decoding when Live state changes without a new frame', async () => {
    const document = fakeDocument();
    const image = document.elements['capture-image'];
    const sourceWrites = [];
    let source = '';
    Object.defineProperty(image, 'src', {
      configurable: true,
      get: function () { return source; },
      set: function (value) {
        source = value;
        sourceWrites.push(value);
      }
    });
    const secondCapture = helpers.deferred();
    let captureCount = 0;
    const bridge = {
      listProfiles: jest.fn(async () => ({ profiles: [{ id: 'p_aaaaaaaa', name: 'A', available: true }] })),
      listScripts: jest.fn(async () => ({ scripts: [] })),
      capture: jest.fn(function (request) {
        captureCount += 1;
        return captureCount === 1
          ? Promise.resolve(result(request.profileId, request.selectionEpoch, 'frame-1'))
          : secondCapture.promise;
      }),
      markDisplayed: jest.fn(async request => ({ displayedFrameId: request.frameId })),
      freezeFrame: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true })),
      onDisconnected: jest.fn()
    };
    const { initializeRenderer } = require('../app/app');
    const controller = initializeRenderer(document, bridge);
    document.elements['profile-select'].value = 'p_aaaaaaaa';
    document.elements['profile-select'].dispatch('change');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sourceWrites).toEqual(['data:image/png;base64,cG5n']);

    controller.tick();
    expect(controller.getState().capturePending).toBe(true);
    expect(sourceWrites).toHaveLength(1);

    secondCapture.resolve(result('p_aaaaaaaa', 1, 'frame-2'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sourceWrites).toHaveLength(2);
    controller.disconnect();
  });

  test('explains an invalid templateId and suggests the valid kebab-case form', () => {
    const document = fakeDocument();
    const bridge = {
      listProfiles: jest.fn(async () => ({ profiles: [] })),
      listScripts: jest.fn(async () => ({ scripts: [] })),
      capture: jest.fn(),
      markDisplayed: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true })),
      onDisconnected: jest.fn()
    };
    const { initializeRenderer } = require('../app/app');
    const controller = initializeRenderer(document, bridge);
    const input = document.elements['template-id'];
    const help = document.elements['template-id-help'];

    input.value = 'entry_activity';
    input.dispatch('input');

    expect(input.dataset.valid).toBe('false');
    expect(help.textContent).toContain('不能使用下划线');
    expect(help.textContent).toContain('entry-activity');
    expect(document.elements['save-button'].disabled).toBe(true);
    controller.disconnect();
  });

  test('save preflight reports template-id-invalid instead of frame-stale', async () => {
    const bridge = {
      capture: jest.fn(),
      markDisplayed: jest.fn(),
      releaseFrame: jest.fn(async () => ({ released: true }))
    };
    const { createLiveController } = require('../app/app');
    const controller = createLiveController({ bridge: bridge });
    controller.setTemplateId('entry_activity');

    await expect(controller.savePreflight()).rejects.toEqual(expect.objectContaining({
      code: 'template-id-invalid'
    }));
  });

  test('disables Chromium background throttling for the fixed Live schedule', () => {
    const { createAuthorWindowOptions } = require('../app/main');
    const options = createAuthorWindowOptions();
    expect(options.webPreferences).toEqual(expect.objectContaining({
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }));
  });

  test('calls native timers with their Electron Renderer host as receiver', () => {
    const host = {
      setInterval: jest.fn(function () {
        if (this !== host) throw new TypeError('Illegal invocation');
        return 41;
      }),
      clearInterval: jest.fn(function () {
        if (this !== host) throw new TypeError('Illegal invocation');
      })
    };
    const { createDefaultTimers } = require('../app/app');
    const timers = createDefaultTimers(host);
    const callback = jest.fn();
    expect(timers.setInterval(callback, 1000)).toBe(41);
    expect(function () { timers.clearInterval(41); }).not.toThrow();
    expect(host.setInterval).toHaveBeenCalledWith(callback, 1000);
    expect(host.clearInterval).toHaveBeenCalledWith(41);
  });

  test('restores copy button labels after success and failure feedback', async () => {
    const { createCopyFeedback } = require('../app/app');
    const successButton = fakeElement();
    successButton.textContent = '复制 ROI';
    const success = createCopyFeedback({
      button: successButton,
      copy: jest.fn(async function () { return { copied: true }; })
    });
    await success.trigger();
    expect(successButton.textContent).toBe('已复制');
    jest.advanceTimersByTime(1499);
    expect(successButton.textContent).toBe('已复制');
    jest.advanceTimersByTime(1);
    expect(successButton.textContent).toBe('复制 ROI');

    const failureButton = fakeElement();
    failureButton.textContent = '复制 find()';
    const failure = createCopyFeedback({
      button: failureButton,
      copy: jest.fn(async function () { throw new Error('clipboard unavailable'); })
    });
    await failure.trigger();
    expect(failureButton.textContent).toBe('复制失败');
    jest.advanceTimersByTime(1500);
    expect(failureButton.textContent).toBe('复制 find()');
  });

  test('ignores stale copy completions and resets feedback when output changes', async () => {
    const first = helpers.deferred();
    const second = helpers.deferred();
    const button = fakeElement();
    button.textContent = '复制 waitFor()';
    const copy = jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { createCopyFeedback } = require('../app/app');
    const feedback = createCopyFeedback({ button: button, copy: copy });
    const firstTrigger = feedback.trigger();
    const secondTrigger = feedback.trigger();
    first.resolve({ copied: true });
    await firstTrigger;
    expect(button.textContent).toBe('复制 waitFor()');
    second.resolve({ copied: true });
    await secondTrigger;
    expect(button.textContent).toBe('已复制');
    feedback.reset();
    expect(button.textContent).toBe('复制 waitFor()');
    jest.advanceTimersByTime(2000);
    expect(button.textContent).toBe('复制 waitFor()');
  });
});

