'use strict';

const crypto = require('crypto');
const { validSize } = require('../../../src/automation/coordinates');
const frameModule = require('./frame');

function sessionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createBridgeSession(options) {
  const opts = options || {};
  if (!opts.profileStore || typeof opts.profileStore.getAll !== 'function') {
    throw new TypeError('profileStore is required');
  }
  if (!opts.backend || typeof opts.backend.capture !== 'function') {
    throw new TypeError('backend is required');
  }
  const frameFactory = opts.frameFactory || function (capture, profile, epoch) {
    return frameModule.createCaptureFrame(capture, profile, epoch, {
      expectedProfileId: profile.id,
      codec: opts.codec
    });
  };
  const sessionId = opts.sessionId || 'session-' + crypto.randomBytes(16).toString('hex');
  const catalog = new Map();
  let capturePending = false;
  let candidate = null;
  let displayed = null;
  let frozen = null;
  let preview = null;
  let closed = false;

  function readProfiles() {
    const profiles = opts.profileStore.getAll();
    return Array.isArray(profiles) ? profiles : [];
  }

  function stateAvailable(profileId) {
    let state;
    try { state = opts.backend.getWindowState(profileId); } catch (_) { return false; }
    return !!(state && state.available === true && validSize(state.contentSize));
  }

  function listProfiles() {
    if (closed) throw sessionError('connection-closed');
    catalog.clear();
    const profiles = readProfiles().reduce(function (result, profile) {
      if (!profile || typeof profile.id !== 'string' || typeof profile.name !== 'string') return result;
      const option = Object.freeze({
        id: profile.id,
        name: profile.name,
        available: stateAvailable(profile.id)
      });
      catalog.set(profile.id, option);
      result.push(option);
      return result;
    }, []);
    return { profiles: profiles };
  }

  function requireProfile(profileId) {
    const option = catalog.get(profileId);
    if (!option) throw sessionError('profile-not-found');
    const current = typeof opts.profileStore.get === 'function'
      ? opts.profileStore.get(profileId)
      : readProfiles().find(function (profile) { return profile && profile.id === profileId; });
    if (!current) throw sessionError('profile-not-found');
    if (!option.available || !stateAvailable(profileId)) throw sessionError('profile-unavailable');
    return Object.freeze({ id: option.id, name: option.name });
  }

  async function capture(request) {
    if (closed) throw sessionError('connection-closed');
    if (!request || !Number.isInteger(request.selectionEpoch) || request.selectionEpoch < 0) {
      throw sessionError('invalid-request');
    }
    const profile = requireProfile(request.profileId);
    if (capturePending) throw sessionError('capture-busy');
    capturePending = true;
    try {
      const capture = typeof opts.backend.captureImage === 'function'
        ? opts.backend.captureImage
        : opts.backend.capture;
      const result = await capture(profile.id);
      requireProfile(profile.id);
      const frame = frameFactory(result, profile, request.selectionEpoch);
      if (!frame || !frame.publicFrame || typeof frame.frameId !== 'string') {
        throw sessionError('capture-failed');
      }
      if (candidate && candidate !== frozen) candidate = null;
      candidate = frame;
      return { frame: frame.publicFrame };
    } catch (error) {
      if (error && error.code && error.code !== 'window-unavailable') throw error;
      throw sessionError(error && error.code === 'window-unavailable' ? 'profile-unavailable' : 'capture-failed');
    } finally {
      capturePending = false;
    }
  }

  function identityMatches(frame, request) {
    return !!frame && frame.frameId === request.frameId &&
      frame.profile.id === request.profileId && frame.selectionEpoch === request.selectionEpoch;
  }

  function markDisplayed(request) {
    if (closed) throw sessionError('connection-closed');
    if (!request || !identityMatches(candidate, request)) throw sessionError('frame-stale');
    displayed = candidate;
    return { displayedFrameId: displayed.frameId };
  }

  function freezeFrame(request) {
    if (closed) throw sessionError('connection-closed');
    if (!request || !identityMatches(displayed, request)) throw sessionError('frame-stale');
    frozen = displayed;
    candidate = frozen;
    preview = null;
    return { frame: frameModule.frozenPublicFrame(frozen) };
  }

  function createPreview(request) {
    if (closed) throw sessionError('connection-closed');
    if (!frozen || !request || request.frozenFrameId !== frozen.frameId) {
      throw sessionError('frame-stale');
    }
    preview = frameModule.createPreviewArtifact(frozen, request.templateRect, {
      nativeImage: opts.nativeImage,
      now: opts.now
    });
    return { preview: preview.publicPreview };
  }

  function getPreview(previewId) {
    if (!preview || preview.previewId !== previewId) throw sessionError('preview-stale');
    return preview;
  }

  function listScripts() {
    if (!opts.catalog || typeof opts.catalog.listScripts !== 'function') throw sessionError('invalid-request');
    return opts.catalog.listScripts();
  }

  function requireSave(request) {
    if (!frozen || !request || request.frozenFrameId !== frozen.frameId) throw sessionError('frame-stale');
    const artifact = getPreview(request.previewId);
    if (artifact.frozenFrameId !== frozen.frameId) throw sessionError('preview-stale');
    if (!frozen.contract || frozen.contract.valid !== true) throw sessionError('frame-contract-invalid');
    if (!stateAvailable(frozen.profile.id)) throw sessionError('profile-unavailable');
    if (!opts.catalog || !opts.writer) throw sessionError('invalid-request');
    opts.catalog.resolve(request.scriptId);
    return {
      artifact: artifact,
      binding: {
        sessionId: sessionId,
        frozenFrameId: frozen.frameId,
        previewId: artifact.previewId,
        scriptId: request.scriptId,
        templateId: request.templateId,
        replacementGrant: request.replacementGrant
      }
    };
  }

  function savePreflight(request) {
    const save = requireSave(request);
    delete save.binding.replacementGrant;
    return opts.writer.preflight(save.binding);
  }

  function saveCommit(request) {
    const save = requireSave(request);
    return opts.writer.commit(save.binding, save.artifact.png, save.artifact.imageSize);
  }

  function releaseFrame(request) {
    const frameId = request && request.frameId;
    let released = false;
    if (frozen && (!frameId || frozen.frameId === frameId)) {
      frozen = null;
      preview = null;
      released = true;
    }
    if (displayed && (!frameId || displayed.frameId === frameId)) {
      displayed = null;
      released = true;
    }
    if (candidate && (!frameId || candidate.frameId === frameId)) {
      candidate = null;
      released = true;
    }
    if (released && opts.writer && typeof opts.writer.clearSession === 'function') {
      opts.writer.clearSession(sessionId);
    }
    return { released: released || true };
  }

  function close() {
    if (closed) return { closed: true };
    closed = true;
    candidate = null;
    displayed = null;
    frozen = null;
    preview = null;
    if (opts.writer && typeof opts.writer.clearSession === 'function') opts.writer.clearSession(sessionId);
    catalog.clear();
    if (typeof opts.onClose === 'function') opts.onClose();
    return { closed: true };
  }

  function dispatch(op, payload) {
    if (op === 'profiles.list') return listProfiles();
    if (op === 'capture') return capture(payload);
    if (op === 'frame.displayed') return markDisplayed(payload);
    if (op === 'frame.freeze') return freezeFrame(payload);
    if (op === 'frame.release') return releaseFrame(payload);
    if (op === 'preview.create') return createPreview(payload);
    if (op === 'scripts.list') return listScripts();
    if (op === 'template.save.preflight') return savePreflight(payload);
    if (op === 'template.save.commit') return saveCommit(payload);
    if (op === 'session.close') return close();
    throw sessionError('invalid-request');
  }

  function snapshot() {
    return Object.freeze({
      capturePending: capturePending,
      displayedFrameId: displayed ? displayed.frameId : null,
      frozenFrameId: frozen ? frozen.frameId : null,
      previewId: preview ? preview.previewId : null,
      closed: closed
    });
  }

  return Object.freeze({
    capture: capture,
    close: close,
    createPreview: createPreview,
    dispatch: dispatch,
    freezeFrame: freezeFrame,
    getPreview: getPreview,
    listProfiles: listProfiles,
    listScripts: listScripts,
    markDisplayed: markDisplayed,
    releaseFrame: releaseFrame,
    saveCommit: saveCommit,
    savePreflight: savePreflight,
    snapshot: snapshot
  });
}

module.exports = { createBridgeSession: createBridgeSession, sessionError: sessionError };
