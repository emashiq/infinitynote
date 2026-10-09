import { execFile } from 'node:child_process';
import path from 'node:path';
import { newDataKey, open, seal } from './note-crypto';

/**
 * The OS key of locked notes (D-113): on Windows, Windows Hello (PIN, fingerprint or face) confirms the user before
 * main releases a copy of a note's data key that the OS protects for this Windows account. Nothing else counts as an
 * OS key: where the platform cannot verify the user this way (Linux, Windows without Hello), it is not offered.
 */

export type OsKeyAvailability = { status: 'available' } | { status: 'unavailable' | 'unsupported'; reason: string };
export type OsKeyVerdict = 'verified' | 'canceled' | 'failed' | 'unavailable' | 'timeout';

export interface OsKeyVerifier {
  availability(): Promise<OsKeyAvailability>;
  /** Asks the user to confirm with the OS key; the prompt belongs to `windowHandle` (a native handle) when given. */
  verify(windowHandle: Buffer | null): Promise<OsKeyVerdict>;
}

/** Protects a key so only this OS account can read it back (Electron safeStorage: DPAPI on Windows). */
export interface KeyProtector {
  available(): boolean;
  protect(key: Buffer): Buffer;
  unprotect(blob: Buffer): Buffer;
}

export type ScriptOutcome = { kind: 'ok'; stdout: string } | { kind: 'timeout' } | { kind: 'error' };
/** Runs a fixed PowerShell script hidden and returns its output (injectable, so tests never start PowerShell). */
export type PowerShellRunner = (script: string, timeoutMs: number) => Promise<ScriptOutcome>;

export const AVAILABILITY_TIMEOUT_MS = 20_000;
export const VERIFY_TIMEOUT_MS = 120_000;
/** Shown in the Windows Hello prompt. A constant: no note title or other user text reaches the command line. */
export const HELLO_PROMPT = 'Unlock a note in Infinity Notes';

export const OS_KEY_MESSAGES = {
  linux: 'Linux has no OS key that Infinity Notes can verify. Use a password.',
  otherOs: 'This system has no OS key that Infinity Notes can verify. Use a password.',
  noDevice: 'Windows Hello is not available on this device.',
  notConfigured: 'Windows Hello is not set up for this Windows account.',
  disabled: 'Windows Hello is turned off by policy.',
  busy: 'Windows Hello is busy. Try again in a moment.',
  noProtection: 'Windows cannot protect keys for this account right now.',
  noAnswer: 'Windows Hello did not answer.',
} as const;

/** Loads WinRT into Windows PowerShell 5.1 and defines Await for IAsyncOperation results. */
const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]',
  "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  'function Await($operation, [Type]$resultType) {',
  '  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))',
  '  $null = $task.Wait(-1)',
  '  $task.Result',
  '}',
];

const AVAILABILITY_SCRIPT = [
  ...PRELUDE,
  '$result = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])',
  '[Console]::Out.Write("RESULT:$result")',
].join('\n');

/** IUserConsentVerifierInterop: the desktop-app entry that parents the prompt to a window, so it comes to the front. */
const INTEROP_SOURCE = [
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Runtime.InteropServices.WindowsRuntime;',
  '[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]',
  'public interface IUserConsentVerifierInterop {',
  '  [return: MarshalAs(UnmanagedType.IInspectable)]',
  '  object RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid);',
  '}',
  'public static class InfinityNotesHello {',
  '  public static object Request(Type verifier, Type operation, IntPtr window, string message) {',
  '    var interop = (IUserConsentVerifierInterop)WindowsRuntimeMarshal.GetActivationFactory(verifier);',
  '    Guid iid = operation.GUID;',
  '    return interop.RequestVerificationForWindowAsync(window, message, ref iid);',
  '  }',
  '}',
].join('\n');

/** The verification script for a window handle (a number main read from its own window, never user input). */
export function verificationScript(windowHandle: bigint): string {
  return [
    ...PRELUDE,
    `$message = '${HELLO_PROMPT}'`,
    '$resultType = [Windows.Security.Credentials.UI.UserConsentVerificationResult]',
    '$operation = $null',
    `$window = [IntPtr]::new([Int64]${windowHandle.toString()})`,
    'if ($window -ne [IntPtr]::Zero) {',
    '  try {',
    `    Add-Type -TypeDefinition @'\n${INTEROP_SOURCE}\n'@`,
    '    $operationType = $asTask.GetParameters()[0].ParameterType.GetGenericTypeDefinition().MakeGenericType($resultType)',
    '    $operation = [InfinityNotesHello]::Request([Windows.Security.Credentials.UI.UserConsentVerifier], $operationType, $window, $message)',
    '  } catch { $operation = $null }',
    '}',
    'if ($null -eq $operation) { $operation = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($message) }',
    '$result = Await $operation $resultType',
    '[Console]::Out.Write("RESULT:$result")',
  ].join('\n');
}

const resultOf = (outcome: ScriptOutcome): string | null => (outcome.kind === 'ok' ? (/RESULT:(\w+)/.exec(outcome.stdout)?.[1] ?? null) : null);

/** A native window handle (HWND bytes from getNativeWindowHandle) as a number; 0 when there is none. */
export function handleNumber(windowHandle: Buffer | null): bigint {
  if (!windowHandle) return 0n;
  if (windowHandle.length >= 8) return windowHandle.readBigUInt64LE(0);
  if (windowHandle.length >= 4) return BigInt(windowHandle.readUInt32LE(0));
  return 0n;
}

/** Windows Hello through UserConsentVerifier, called from a hidden Windows PowerShell (no native module). */
export function createWindowsHelloVerifier(run: PowerShellRunner): OsKeyVerifier {
  return {
    async availability() {
      const outcome = await run(AVAILABILITY_SCRIPT, AVAILABILITY_TIMEOUT_MS);
      switch (resultOf(outcome)) {
        case 'Available':
          return { status: 'available' };
        case 'DeviceNotPresent':
          return { status: 'unavailable', reason: OS_KEY_MESSAGES.noDevice };
        case 'NotConfiguredForUser':
          return { status: 'unavailable', reason: OS_KEY_MESSAGES.notConfigured };
        case 'DisabledByPolicy':
          return { status: 'unavailable', reason: OS_KEY_MESSAGES.disabled };
        case 'DeviceBusy':
          return { status: 'unavailable', reason: OS_KEY_MESSAGES.busy };
        default:
          return { status: 'unavailable', reason: OS_KEY_MESSAGES.noAnswer };
      }
    },
    async verify(windowHandle) {
      const outcome = await run(verificationScript(handleNumber(windowHandle)), VERIFY_TIMEOUT_MS);
      if (outcome.kind === 'timeout') return 'timeout';
      switch (resultOf(outcome)) {
        case 'Verified':
          return 'verified';
        case 'Canceled':
          return 'canceled';
        case 'DeviceNotPresent':
        case 'NotConfiguredForUser':
        case 'DisabledByPolicy':
          return 'unavailable';
        default:
          return 'failed';
      }
    },
  };
}

/** Where no OS key can be verified: never available, never verifies. */
export function unsupportedVerifier(reason: string): OsKeyVerifier {
  return {
    availability: async () => ({ status: 'unsupported', reason }),
    verify: async () => 'unavailable',
  };
}

/** The OS key of this platform: Windows Hello on Windows, none elsewhere. */
export function platformVerifier(platform: NodeJS.Platform, run: PowerShellRunner = runHiddenPowerShell): OsKeyVerifier {
  if (platform === 'win32') return createWindowsHelloVerifier(run);
  return unsupportedVerifier(platform === 'linux' ? OS_KEY_MESSAGES.linux : OS_KEY_MESSAGES.otherOs);
}

/** Windows PowerShell 5.1 (it has the WinRT projection PowerShell 7 lacks) from the system folder, never from PATH. */
function powershellPath(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Runs a script hidden: no window, no profile, the script as -EncodedCommand (no quoting of any kind). */
export const runHiddenPowerShell: PowerShellRunner = (script, timeoutMs) =>
  new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      powershellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err && (err as { killed?: boolean }).killed) resolve({ kind: 'timeout' });
        else if (err) resolve({ kind: 'error' });
        else resolve({ kind: 'ok', stdout: String(stdout) });
      },
    );
  });

/** Electron safeStorage (DPAPI on Windows) as a key protector. */
export function safeStorageProtector(safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(blob: Buffer): string;
}): KeyProtector {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    protect: (key) => safeStorage.encryptString(key.toString('base64')),
    unprotect: (blob) => Buffer.from(safeStorage.decryptString(blob), 'base64'),
  };
}

// Test seams (integration tests and the E2E hooks; never used by a packaged build) ------------------------------------

/** A verifier whose availability and next answers a test sets. */
export function createFakeOsKeyVerifier(initial: OsKeyAvailability = { status: 'available' }) {
  const state = { availability: initial, answers: [] as OsKeyVerdict[], calls: 0, handles: [] as Array<Buffer | null> };
  const verifier: OsKeyVerifier = {
    availability: async () => state.availability,
    async verify(windowHandle) {
      state.calls += 1;
      state.handles.push(windowHandle);
      if (state.availability.status !== 'available') return 'unavailable';
      return state.answers.shift() ?? 'verified';
    },
  };
  return { verifier, state };
}

/** A protector bound to this process only: a random key in memory seals the protected keys. */
export function createMemoryKeyProtector(): KeyProtector {
  const secret = newDataKey();
  const owner = '00000000-0000-4000-8000-000000000000';
  return {
    available: () => true,
    protect: (key) => seal(secret, 'key', owner, key),
    unprotect: (blob) => open(secret, 'key', owner, blob),
  };
}
