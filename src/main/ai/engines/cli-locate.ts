import fs from 'node:fs';
import path from 'node:path';
import type { AiCli } from '../../../shared/ai/engines';

/** The extensions a program found on PATH may have on Windows, in the order tried (PATHEXT when set). */
function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const listed = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^\.[a-z0-9]+$/.test(e));
  // A tool is a program or an npm shim; scripts of other kinds are never run.
  return listed.filter((e) => ['.exe', '.cmd', '.bat', '.com'].includes(e));
}

async function isProgram(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return false;
    if (platform !== 'win32') await fs.promises.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The PATH entries of the environment (Windows spells the variable `Path`). */
function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const value = key ? (env[key] ?? '') : '';
  const delimiter = platform === 'win32' ? ';' : ':';
  return value
    .split(delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d !== '' && (platform === 'win32' ? path.win32.isAbsolute(d) : path.posix.isAbsolute(d)));
}

/**
 * Finds a command-line tool (D-192): the program chosen in Settings when there is one (it must still exist), else the
 * first `claude` / `codex` on PATH (on Windows `claude.exe`, `claude.cmd`, … by PATHEXT). Relative PATH entries are
 * ignored, so a tool is never picked up from the working folder. Null when there is none.
 */
export async function locateCli(cli: AiCli, chosen: string | null, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (chosen !== null) return (await isProgram(chosen, platform)) ? chosen : null;
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const names = platform === 'win32' ? windowsExtensions(env).map((ext) => `${cli}${ext}`) : [cli];
  for (const dir of pathEntries(env, platform)) {
    for (const name of names) {
      const file = join(dir, name);
      if (await isProgram(file, platform)) return file;
    }
  }
  return null;
}
