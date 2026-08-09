'use strict';

const { AutomationError } = require('./errors');

function createCoordinator() {
  const leases = new Map();

  function owns(lease) {
    if (!lease || typeof lease.profileId !== 'string') return false;
    const current = leases.get(lease.profileId);
    return !!(current && !current.released && current.token === lease.token);
  }

  function tryAcquire(profileId, runId) {
    if (leases.has(profileId)) return { ok: false, error: 'profile-busy' };
    const token = Object.freeze({});
    const lease = Object.freeze({ profileId: profileId, runId: runId || null, token: token });
    leases.set(profileId, {
      token: token,
      lease: lease,
      released: false,
      actionTail: Promise.resolve()
    });
    return { ok: true, lease: lease };
  }

  function enqueue(lease, action) {
    if (!owns(lease) || typeof action !== 'function') {
      return Promise.reject(new AutomationError('profile-busy'));
    }
    const record = leases.get(lease.profileId);
    const execution = record.actionTail.then(function () {
      if (!owns(lease)) throw new AutomationError('profile-busy');
      return action();
    });
    record.actionTail = execution.catch(function () {});
    return execution;
  }

  function release(lease) {
    if (!owns(lease)) return false;
    const record = leases.get(lease.profileId);
    record.released = true;
    leases.delete(lease.profileId);
    return true;
  }

  function getActiveLease(profileId) {
    const record = leases.get(profileId);
    return record && !record.released ? record.lease : null;
  }

  function whenIdle(lease) {
    if (!owns(lease)) return Promise.resolve();
    return leases.get(lease.profileId).actionTail;
  }

  return Object.freeze({
    tryAcquire: tryAcquire,
    enqueue: enqueue,
    release: release,
    owns: owns,
    getActiveLease: getActiveLease,
    whenIdle: whenIdle
  });
}

module.exports = { createCoordinator: createCoordinator };
