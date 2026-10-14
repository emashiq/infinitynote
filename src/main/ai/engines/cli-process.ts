import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/** The most output a tool may print before it is stopped. */
export const MAX_CLI_OUTPUT_BYTES = 16 * 1024 * 1024;
/** How long a stopped tool on Linux gets after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2000;

/**
 * An argument a tool may get (D-192): one token of letters, digits and `-_.,:=/@+`. Arguments are fixed flags, model
 * names, session IDs and file names the app made, never the user's text (that goes on stdin), so nothing a shell would
 * read as syntax or a second command can reach a command line.
 */
const SAFE_ARG = /^[A-Za-z0-9_.,:=/@+-]+$/;
/**
 * A program path cmd.exe runs inside quotes: no quote (it would end them), no `%` or `!` (variables expand even inside
 * quotes; delayed expansion is also turned off), no `^` and no control characters such as line breaks.
 */
const SAFE_CMD_PATH = /^[^"%!^\p{Cc}]+$/u;

export interface CliInvocation {
  command: string;
  args: string[];
  /** cmd.exe gets its command line as it is (the quotes are the app's own). */
  verbatim: boolean;
}

/**
 * How to start a tool. An npm-installed tool on Windows is a `.cmd` shim, which only cmd.exe can run (Node refuses to
 * spawn batch files without a shell since CVE-2024-27980); it is started as `cmd.exe /d /v:off /s /c ""shim" args"`
 * (no AutoRun commands, no delayed expansion) with the checked arguments. Anything else is spawned directly, without a
 * shell.
 */
export function cliInvocation(file: string, args: readonly string[], platform: NodeJS.Platform, comSpec = 'cmd.exe'): CliInvocation {
  const bad = args.find((a) => !SAFE_ARG.test(a));
  if (bad !== undefined) throw new Error('An argument for the tool is not allowed');
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    if (!SAFE_CMD_PATH.test(file)) throw new Error('The program path cannot be run');
    return { command: comSpec, args: ['/d', '/v:off', '/s', '/c', `""${file}" ${args.join(' ')}"`], verbatim: true };
  }
  return { command: file, args: [...args], verbatim: false };
}

export interface CliRunRequest {
  file: string;
  args: readonly string[];
  cwd: string;
  /** The prompt: written to the tool's standard input, then closed. */
  stdin: string;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The tool could not be started (not found, not a program). */
export class CliStartError extends Error {
  constructor(readonly code: string | undefined) {
    super(`The tool could not be started${code ? ` (${code})` : ''}`);
    this.name = 'CliStartError';
  }
}

export interface CliProcessDeps {
  platform: NodeJS.Platform;
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  /** Ends a process and everything it started. */
  killTree: (child: ChildProcess) => void;
  comSpec?: string;
}

/** Windows: `taskkill /T /F` ends the shim, the tool and anything they started. Elsewhere: the process group. */
export function killProcessTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  if (platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
    return;
  }
  const signalGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      child.kill(sig);
    }
  };
  signalGroup('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
  }, KILL_GRACE_MS).unref();
}

export const NODE_CLI_PROCESS: CliProcessDeps = {
  platform: process.platform,
  spawn: (command, args, options) => spawn(command, args, options),
  killTree: (child) => killProcessTree(child),
  comSpec: process.env.ComSpec,
};

/**
 * Runs a tool headless (D-192): no window, the prompt on stdin, output collected up to a limit. Aborting the signal
 * (Stop, the timeout) ends the whole process tree and rejects with the signal's reason. On Linux the tool leads its
 * own process group, so the group can be ended.
 */
export function runCli(req: CliRunRequest, deps: CliProcessDeps = NODE_CLI_PROCESS): Promise<CliResult> {
  return new Promise<CliResult>((resolve, reject) => {
    if (req.signal.aborted) {
      reject(req.signal.reason);
      return;
    }
    const invocation = cliInvocation(req.file, req.args, deps.platform, deps.comSpec);
    const child = deps.spawn(invocation.command, invocation.args, {
      cwd: req.cwd,
      env: req.env ?? process.env,
      windowsHide: true,
      windowsVerbatimArguments: invocation.verbatim,
      detached: deps.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: unknown = null;
    const stop = (reason: unknown) => {
      if (failure !== null) return;
      failure = reason;
      deps.killTree(child);
    };
    const onAbort = () => stop(req.signal.reason);
    req.signal.addEventListener('abort', onAbort, { once: true });
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_CLI_OUTPUT_BYTES) stop(new Error('The tool printed too much output'));
      else into.push(chunk);
    };
    child.stdout?.on('data', collect(stdout));
    child.stderr?.on('data', collect(stderr));
    // A tool that exits before reading its input closes the pipe; its exit code tells what happened.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(req.stdin, 'utf8');
    child.on('error', (err: NodeJS.ErrnoException) => {
      req.signal.removeEventListener('abort', onAbort);
      reject(failure ?? new CliStartError(err.code));
    });
    child.on('close', (code) => {
      req.signal.removeEventListener('abort', onAbort);
      if (failure !== null) reject(failure);
      else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}
