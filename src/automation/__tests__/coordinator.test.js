'use strict';

const { createCoordinator } = require('../coordinator');

describe('profile automation coordinator', () => {
  test('grants one owned lease per profile and rejects stale release', () => {
    const coordinator = createCoordinator();
    const first = coordinator.tryAcquire('p_aaaaaaaa', 'run-1');
    expect(first.ok).toBe(true);
    expect(first.lease.profileId).toBe('p_aaaaaaaa');
    expect(first.lease.runId).toBe('run-1');
    expect(coordinator.owns(first.lease)).toBe(true);
    expect(coordinator.tryAcquire('p_aaaaaaaa', 'run-2')).toEqual({
      ok: false,
      error: 'profile-busy'
    });
    expect(coordinator.release({ profileId: 'p_aaaaaaaa', token: {} })).toBe(false);
    expect(coordinator.release(first.lease)).toBe(true);
    expect(coordinator.release(first.lease)).toBe(false);
  });

  test('serializes actions FIFO for one lease while another profile runs independently', async () => {
    const coordinator = createCoordinator();
    const a = coordinator.tryAcquire('p_aaaaaaaa', 'run-a').lease;
    const b = coordinator.tryAcquire('p_bbbbbbbb', 'run-b').lease;
    const order = [];
    let releaseFirst;
    const gate = new Promise(function (resolve) {
      releaseFirst = resolve;
    });
    const first = coordinator.enqueue(a, async function () {
      order.push('a1-start');
      await gate;
      order.push('a1-end');
    });
    const second = coordinator.enqueue(a, async function () {
      order.push('a2');
    });
    await coordinator.enqueue(b, async function () {
      order.push('b1');
    });
    expect(order).toEqual(['a1-start', 'b1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['a1-start', 'b1', 'a1-end', 'a2']);
  });

  test('continues the action tail after a rejected action and fences released leases', async () => {
    const coordinator = createCoordinator();
    const lease = coordinator.tryAcquire('p_aaaaaaaa', 'run-a').lease;
    const first = coordinator.enqueue(lease, function () {
      return Promise.reject(new Error('first failed'));
    });
    const secondAction = jest.fn(function () {
      return 'second-result';
    });
    const second = coordinator.enqueue(lease, secondAction);
    await expect(first).rejects.toThrow('first failed');
    await expect(second).resolves.toBe('second-result');
    expect(secondAction).toHaveBeenCalledTimes(1);
    coordinator.release(lease);
    await expect(coordinator.enqueue(lease, secondAction)).rejects.toMatchObject({
      code: 'profile-busy'
    });
  });

  test('returns profile-busy immediately without queuing another run', async () => {
    const coordinator = createCoordinator();
    const active = coordinator.tryAcquire('p_aaaaaaaa', 'run-a');
    const action = deferredAction();
    const executing = coordinator.enqueue(active.lease, action.run);
    await Promise.resolve();
    expect(coordinator.tryAcquire('p_aaaaaaaa', 'run-b')).toEqual({
      ok: false,
      error: 'profile-busy'
    });
    expect(action.calls).toBe(1);
    action.resolve();
    await executing;
  });

  test('keeps per-profile tails independent and a stale token cannot release a newer lease', async () => {
    const coordinator = createCoordinator();
    const first = coordinator.tryAcquire('p_aaaaaaaa', 'run-a').lease;
    const other = coordinator.tryAcquire('p_bbbbbbbb', 'run-b').lease;
    expect(coordinator.release(first)).toBe(true);
    const newer = coordinator.tryAcquire('p_aaaaaaaa', 'run-a2').lease;
    expect(coordinator.release(first)).toBe(false);
    expect(coordinator.owns(newer)).toBe(true);
    expect(coordinator.owns(other)).toBe(true);
  });
});

function deferredAction() {
  let resolve;
  const record = {
    calls: 0,
    resolve: function () { resolve(); },
    run: function () {
      record.calls++;
      return new Promise(function (done) { resolve = done; });
    }
  };
  return record;
}
