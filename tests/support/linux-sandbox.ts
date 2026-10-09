/** What /proc reports about a Linux renderer process compared with Electron's main process. */
export interface LinuxSandboxProbe {
  ownUserNamespace: boolean;
  ownPidNamespace: boolean;
  /** The `Seccomp:` field of /proc/<pid>/status ("2" is a seccomp-bpf filter). */
  seccomp: string;
  /** chrome-sandbox next to the executable is owned by root and setuid (the SUID sandbox can be used). */
  suidHelper: boolean;
}

export type LinuxSandboxMode = 'user-namespace' | 'suid' | 'none';

/**
 * Which Chromium Linux sandbox confines the renderer (CL-F1). The user-namespace sandbox gives it its own user and
 * PID namespaces. Where unprivileged user namespaces are restricted, Chromium uses the setuid chrome-sandbox helper,
 * which gives a new PID namespace but keeps the user namespace. Under --no-sandbox both namespaces are shared, while
 * the seccomp-bpf filter stays, so seccomp alone never decides.
 */
export function linuxSandboxMode(p: LinuxSandboxProbe): LinuxSandboxMode {
  if (p.seccomp !== '2' || !p.ownPidNamespace) return 'none';
  if (p.ownUserNamespace) return 'user-namespace';
  return p.suidHelper ? 'suid' : 'none';
}
