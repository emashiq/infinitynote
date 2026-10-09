import { describe, expect, it } from 'vitest';
import { linuxSandboxMode, pidNamespaceDepth, seccompField, type LinuxSandboxProbe } from '../support/linux-sandbox';

const userNs: LinuxSandboxProbe = { ownUserNamespace: true, ownPidNamespace: true, seccomp: '2', suidHelper: false };

describe('Linux renderer sandbox verdict used by the E2E sandbox checks (CL-F1)', () => {
  it('the user-namespace sandbox (WSL, unrestricted kernels) passes', () => {
    expect(linuxSandboxMode(userNs)).toBe('user-namespace');
    expect(linuxSandboxMode({ ...userNs, suidHelper: true })).toBe('user-namespace');
  });

  it('the setuid helper sandbox passes with its own PID namespace and seccomp, without its own user namespace', () => {
    expect(linuxSandboxMode({ ...userNs, ownUserNamespace: false, suidHelper: true })).toBe('suid');
  });

  it('negative control: --no-sandbox shares both namespaces and fails even with seccomp and a setuid helper present', () => {
    expect(linuxSandboxMode({ ownUserNamespace: false, ownPidNamespace: false, seccomp: '2', suidHelper: true })).toBe('none');
    expect(linuxSandboxMode({ ownUserNamespace: false, ownPidNamespace: false, seccomp: '2', suidHelper: false })).toBe('none');
  });

  it('a PID namespace without a user namespace is not accepted unless the helper is setuid root', () => {
    expect(linuxSandboxMode({ ...userNs, ownUserNamespace: false })).toBe('none');
  });

  it('no seccomp filter, or an unreadable one, fails in every mode', () => {
    expect(linuxSandboxMode({ ...userNs, seccomp: '0' })).toBe('none');
    expect(linuxSandboxMode({ ...userNs, seccomp: 'missing' })).toBe('none');
    expect(linuxSandboxMode({ ...userNs, ownUserNamespace: false, suidHelper: true, seccomp: '0' })).toBe('none');
  });
});

describe('/proc/<pid>/status fields read by the sandbox probe', () => {
  const status = (lines: string[]) => ['Name:\tinfinity-notes', 'State:\tS (sleeping)', ...lines].join('\n');

  it('counts the PID namespaces in NSpid: a renderer in its own PID namespace has one more than main', () => {
    expect(pidNamespaceDepth(status(['NSpid:\t20100']))).toBe(1);
    expect(pidNamespaceDepth(status(['NSpid:\t20278\t2']))).toBe(2);
    expect(pidNamespaceDepth(status(['NSpid:\t31\t20278\t2']))).toBe(3);
  });

  it('a missing NSpid line counts as no namespace, so the probe fails closed', () => {
    expect(pidNamespaceDepth(status([]))).toBe(0);
  });

  it('reads the seccomp mode, or reports it missing', () => {
    expect(seccompField(status(['Seccomp:\t2', 'Seccomp_filters:\t1']))).toBe('2');
    expect(seccompField(status(['Seccomp:\t0']))).toBe('0');
    expect(seccompField(status([]))).toBe('missing');
  });
});
