import { describe, expect, it } from 'vitest';
import { createReminderSeams, onFreshTask } from '../../src/main/test-hooks';

describe('test hooks (F04-A2, D-084)', () => {
  it('db hooks run on a fresh macrotask, never inside the synchronous section that called them', async () => {
    let insideStatement = true;
    const observed = onFreshTask(() => insideStatement);
    // Still in the same task (as an inspector interrupt inside a running statement would be): the work has not run.
    insideStatement = false;
    expect(await observed).toBe(false);
  });

  it('a hook failure rejects the promise instead of throwing into the caller', async () => {
    await expect(
      onFreshTask(() => {
        throw new Error('This database connection is busy executing a query');
      }),
    ).rejects.toThrow('busy');
  });
});

describe('reminder seams (D-084)', () => {
  it('read a frozen clock, a fixed zone and fake notifications from the environment', () => {
    const seams = createReminderSeams({ INFINITY_NOTES_TEST_CLOCK: '2026-10-08T07:00:00Z', INFINITY_NOTES_TEST_ZONE: 'America/Chicago' });
    expect(seams.clock?.now()).toBe(Date.parse('2026-10-08T07:00:00Z'));
    seams.clock!.jump(5);
    expect(seams.clock!.monotonicNow()).toBe(0);
    expect(seams.zones?.current()).toBe('America/Chicago');
    expect(seams.notifications?.mode).toBe('ok');
  });

  it('without values (or with an invalid clock) nothing is replaced; INFINITY_NOTES_TEST_NOTIFY=real keeps real notifications', () => {
    const seams = createReminderSeams({ INFINITY_NOTES_TEST_CLOCK: 'yesterday', INFINITY_NOTES_TEST_NOTIFY: 'real' });
    expect(seams.clock).toBeNull();
    expect(seams.zones).toBeNull();
    expect(seams.notifications).toBeNull();
  });
});
