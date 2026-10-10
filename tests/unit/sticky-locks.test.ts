import { describe, expect, it } from 'vitest';
import { AttemptBackoff, SerialAttempts } from '../../src/main/locks/attempt-backoff';
import { createPinRecord, DEFAULT_PIN_KDF, isPinFormat, parsePinKdf, PIN_KDF_LIMITS, verifyPin } from '../../src/main/locks/pin-verifier';
import { RevealTimers } from '../../src/main/locks/reveal-timers';
import { createFakeClock } from '../../src/main/services/clock';

const CHEAP = { name: 'scrypt', N: 1024, r: 8, p: 1 } as const;

describe('PIN verifier (D-173)', () => {
  it('accepts 4 to 8 digits only', () => {
    for (const pin of ['0000', '12345678', '4821']) expect(isPinFormat(pin), pin).toBe(true);
    for (const pin of ['123', '123456789', '12a4', ' 1234', '１２３４', '']) expect(isPinFormat(pin), pin).toBe(false);
  });

  it('verifies the right PIN and refuses others; the record holds neither the PIN nor a fixed salt', async () => {
    const record = await createPinRecord('4821', CHEAP);
    expect(record.salt).toHaveLength(16);
    expect(record.verifier).toHaveLength(32);
    expect(record.verifier.includes(Buffer.from('4821'))).toBe(false);
    expect(await verifyPin('4821', record)).toBe(true);
    expect(await verifyPin('4822', record)).toBe(false);
    expect(await verifyPin('48210', record)).toBe(false);
    const again = await createPinRecord('4821', CHEAP);
    expect(again.salt.equals(record.salt)).toBe(false);
    expect(again.verifier.equals(record.verifier)).toBe(false);
  });

  it('a changed verifier, salt or unusable parameters never verify', async () => {
    const record = await createPinRecord('4821', CHEAP);
    const flipped = Buffer.from(record.verifier);
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);
    expect(await verifyPin('4821', { ...record, verifier: flipped })).toBe(false);
    expect(await verifyPin('4821', { ...record, verifier: record.verifier.subarray(0, 31) })).toBe(false);
    expect(await verifyPin('4821', { ...record, salt: Buffer.alloc(16) })).toBe(false);
    expect(await verifyPin('4821', { ...record, kdf: JSON.stringify({ ...CHEAP, N: 2 ** 9 }) })).toBe(false);
  });

  it('keeps stored parameters within bounds', () => {
    expect(parsePinKdf(JSON.stringify(DEFAULT_PIN_KDF))).toEqual(DEFAULT_PIN_KDF);
    expect(Math.log2(DEFAULT_PIN_KDF.N)).toBeGreaterThanOrEqual(PIN_KDF_LIMITS.minLogN);
    expect(Math.log2(DEFAULT_PIN_KDF.N)).toBeLessThanOrEqual(PIN_KDF_LIMITS.maxLogN);
    for (const bad of [
      { ...CHEAP, N: 2 ** 9 },
      { ...CHEAP, N: 2 ** 17 },
      { ...CHEAP, N: 1000 },
      { ...CHEAP, r: 0 },
      { ...CHEAP, r: 17 },
      { ...CHEAP, p: 5 },
      { ...CHEAP, name: 'pbkdf2' },
    ]) {
      expect(parsePinKdf(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(parsePinKdf('not json')).toBeNull();
    expect(parsePinKdf('null')).toBeNull();
  });
});

describe('attempt backoff (D-111, D-173)', () => {
  it('three free attempts, then 1, 2, 4 ... up to 30 seconds; clearing starts over', () => {
    const clock = createFakeClock(0);
    const backoff = new AttemptBackoff(() => clock.now());
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      backoff.record('n');
      waits.push(backoff.retryInSeconds('n'));
    }
    expect(waits).toEqual([0, 0, 1, 2, 4, 8, 16, 30, 30]);
    expect(backoff.count('n')).toBe(9);
    clock.advance(30_000);
    expect(backoff.retryInSeconds('n')).toBe(0);
    backoff.clear('n');
    expect(backoff.count('n')).toBe(0);
    expect(backoff.retryInSeconds('other')).toBe(0);
  });

  it('serial attempts start after the previous one settled, failed or not', async () => {
    const serial = new SerialAttempts();
    const order: string[] = [];
    let release!: () => void;
    const first = serial.run('n', () => new Promise<void>((resolve) => (release = resolve)).then(() => void order.push('first')));
    const second = serial.run('n', async () => void order.push('second'));
    const failing = serial.run('n', async () => {
      throw new Error('wrong');
    });
    const after = serial.run('n', async () => void order.push('after'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await first;
    await second;
    await expect(failing).rejects.toThrow('wrong');
    await after;
    expect(order).toEqual(['first', 'second', 'after']);
  });
});

describe('reveal timers (D-172)', () => {
  it('a reveal lasts the setting without interaction; touches move the deadline; expiry is reported once concealed', () => {
    const clock = createFakeClock(1_000);
    let seconds = 60;
    const timers = new RevealTimers(() => seconds * 1000);
    timers.reveal('a', 3, clock.now());
    expect(timers.isRevealed('a', 3, clock.now())).toBe(true);
    expect(timers.isRevealed('a', 4, clock.now())).toBe(false);
    clock.advance(59_999);
    expect(timers.expired(clock.now())).toEqual([]);
    expect(timers.touch('a', 3, clock.now())).toBe(true);
    clock.advance(59_999);
    expect(timers.isRevealed('a', 3, clock.now())).toBe(true);
    clock.advance(1);
    expect(timers.isRevealed('a', 3, clock.now())).toBe(false);
    expect(timers.expired(clock.now())).toEqual(['a']);
    // A touch after the deadline does not bring it back.
    expect(timers.touch('a', 3, clock.now())).toBe(false);
    expect(timers.conceal('a')).toBe(3);
    expect(timers.conceal('a')).toBeNull();
    expect(timers.expired(clock.now())).toEqual([]);

    // A changed setting applies from the next reveal or touch.
    seconds = 30;
    timers.reveal('b', 5, clock.now());
    clock.advance(30_000);
    expect(timers.expired(clock.now())).toEqual(['b']);
  });

  it('touches from another window are ignored and every note has its own deadline', () => {
    const clock = createFakeClock(0);
    const timers = new RevealTimers(() => 30_000);
    timers.reveal('a', 3, 0);
    clock.advance(10_000);
    timers.reveal('b', 4, clock.now());
    expect(timers.touch('a', 4, clock.now())).toBe(false);
    clock.advance(20_000);
    expect(timers.expired(clock.now())).toEqual(['a']);
    expect(timers.revealed().sort()).toEqual(['a', 'b']);
  });
});
