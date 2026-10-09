import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_TIMEOUT_MS,
  createFakeOsKeyVerifier,
  createMemoryKeyProtector,
  createWindowsHelloVerifier,
  handleNumber,
  HELLO_PROMPT,
  OS_KEY_MESSAGES,
  platformVerifier,
  safeStorageProtector,
  verificationScript,
  VERIFY_TIMEOUT_MS,
  type PowerShellRunner,
  type ScriptOutcome,
} from '../../src/main/locks/os-key';

/** A PowerShell runner that answers from a queue and records the scripts and timeouts it was given. */
function fakeRunner(...outcomes: ScriptOutcome[]) {
  const calls: Array<{ script: string; timeoutMs: number }> = [];
  const run: PowerShellRunner = async (script, timeoutMs) => {
    calls.push({ script, timeoutMs });
    return outcomes.shift() ?? { kind: 'error' };
  };
  return { run, calls };
}

const ok = (result: string): ScriptOutcome => ({ kind: 'ok', stdout: `RESULT:${result}` });

describe('Windows Hello adapter (D-113)', () => {
  it('maps UserConsentVerifier availability to available or the reason it is not', async () => {
    const cases: Array<[ScriptOutcome, unknown]> = [
      [ok('Available'), { status: 'available' }],
      [ok('DeviceNotPresent'), { status: 'unavailable', reason: OS_KEY_MESSAGES.noDevice }],
      [ok('NotConfiguredForUser'), { status: 'unavailable', reason: OS_KEY_MESSAGES.notConfigured }],
      [ok('DisabledByPolicy'), { status: 'unavailable', reason: OS_KEY_MESSAGES.disabled }],
      [ok('DeviceBusy'), { status: 'unavailable', reason: OS_KEY_MESSAGES.busy }],
      [{ kind: 'ok', stdout: 'garbage' }, { status: 'unavailable', reason: OS_KEY_MESSAGES.noAnswer }],
      [{ kind: 'timeout' }, { status: 'unavailable', reason: OS_KEY_MESSAGES.noAnswer }],
      [{ kind: 'error' }, { status: 'unavailable', reason: OS_KEY_MESSAGES.noAnswer }],
    ];
    for (const [outcome, expected] of cases) {
      const { run, calls } = fakeRunner(outcome);
      expect(await createWindowsHelloVerifier(run).availability()).toEqual(expected);
      expect(calls[0]!.timeoutMs).toBe(AVAILABILITY_TIMEOUT_MS);
      expect(calls[0]!.script).toContain('CheckAvailabilityAsync');
    }
  });

  it('unlocks only on Verified; canceled, failed, unavailable and timeout are told apart', async () => {
    const cases: Array<[ScriptOutcome, string]> = [
      [ok('Verified'), 'verified'],
      [ok('Canceled'), 'canceled'],
      [ok('RetriesExhausted'), 'failed'],
      [ok('DeviceBusy'), 'failed'],
      [ok('NotConfiguredForUser'), 'unavailable'],
      [ok('DeviceNotPresent'), 'unavailable'],
      [{ kind: 'ok', stdout: 'Verifiedish' }, 'failed'],
      [{ kind: 'error' }, 'failed'],
      [{ kind: 'timeout' }, 'timeout'],
    ];
    for (const [outcome, expected] of cases) {
      const { run, calls } = fakeRunner(outcome);
      expect(await createWindowsHelloVerifier(run).verify(null), JSON.stringify(outcome)).toBe(expected);
      expect(calls[0]!.timeoutMs).toBe(VERIFY_TIMEOUT_MS);
    }
  });

  it('builds the verification script from constants and the window handle number only', async () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(0x1a2b3cn);
    const { run, calls } = fakeRunner(ok('Verified'));
    await createWindowsHelloVerifier(run).verify(handle);
    const script = calls[0]!.script;
    expect(script).toBe(verificationScript(0x1a2b3cn));
    expect(script).toContain(`[IntPtr]::new([Int64]${0x1a2b3c})`);
    expect(script).toContain(`$message = '${HELLO_PROMPT}'`);
    // The prompt belongs to the window (interop), with the plain call as the fallback.
    expect(script).toContain('RequestVerificationForWindowAsync');
    expect(script).toContain('RequestVerificationAsync($message)');
    expect(HELLO_PROMPT).not.toMatch(/['"`$]/);
    expect(handleNumber(null)).toBe(0n);
    const small = Buffer.alloc(4);
    small.writeUInt32LE(77);
    expect(handleNumber(small)).toBe(77n);
  });

  it('offers no OS key on Linux or other systems, with the reason', async () => {
    const linux = platformVerifier('linux', fakeRunner().run);
    expect(await linux.availability()).toEqual({ status: 'unsupported', reason: OS_KEY_MESSAGES.linux });
    expect(await linux.verify(null)).toBe('unavailable');
    expect(await platformVerifier('darwin', fakeRunner().run).availability()).toEqual({ status: 'unsupported', reason: OS_KEY_MESSAGES.otherOs });
    const { run, calls } = fakeRunner(ok('Available'));
    expect(await platformVerifier('win32', run).availability()).toEqual({ status: 'available' });
    expect(calls).toHaveLength(1);
  });

  it('protects keys through safeStorage and, in tests, through a process-bound protector', () => {
    const stored: string[] = [];
    const protector = safeStorageProtector({
      isEncryptionAvailable: () => true,
      encryptString: (text) => {
        stored.push(text);
        return Buffer.from(`enc:${text}`);
      },
      decryptString: (blob) => blob.toString().slice(4),
    });
    const key = Buffer.from('0123456789abcdef0123456789abcdef');
    expect(protector.unprotect(protector.protect(key)).equals(key)).toBe(true);
    expect(stored).toEqual([key.toString('base64')]);

    const memory = createMemoryKeyProtector();
    const blob = memory.protect(key);
    expect(blob.includes(key)).toBe(false);
    expect(memory.unprotect(blob).equals(key)).toBe(true);
    expect(() => createMemoryKeyProtector().unprotect(blob)).toThrow();
  });

  it('the fake verifier answers from its queue and refuses while unavailable', async () => {
    const fake = createFakeOsKeyVerifier();
    fake.state.answers.push('canceled');
    expect(await fake.verifier.verify(null)).toBe('canceled');
    expect(await fake.verifier.verify(Buffer.alloc(8))).toBe('verified');
    fake.state.availability = { status: 'unavailable', reason: 'off' };
    expect(await fake.verifier.verify(null)).toBe('unavailable');
    expect(fake.state.calls).toBe(3);
  });
});
