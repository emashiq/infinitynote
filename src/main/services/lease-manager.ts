import type { NoteLeaseEventType } from '../../shared/contracts/notes';
import { AppError } from './app-error';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';

export interface LeaseHolder {
  viewId: string;
  webContentsId: number;
}

export interface LeaseManagerDeps {
  ids: IdGenerator;
  clock: Clock;
  requestRelease: (holder: LeaseHolder, noteId: string) => void;
  emit: (event: NoteLeaseEventType) => void;
  takeTimeoutMs?: number;
}

interface Lease {
  viewId: string;
  webContentsId: number;
  token: string;
}

interface PendingTake {
  requesterViewId: string;
  finish: () => void;
}

export type AcquireResult = { granted: true; leaseToken: string } | { granted: false; holderViewId: string };
export type VerifyResult = 'ok' | 'lost' | 'forbidden';

export class LeaseManager {
  private readonly leases = new Map<string, Lease>();
  private readonly bindings = new Map<string, number>();
  private readonly revoked = new Set<string>();
  private readonly pending = new Map<string, PendingTake>();
  private readonly takeTimeoutMs: number;

  constructor(private readonly deps: LeaseManagerDeps) {
    this.takeTimeoutMs = deps.takeTimeoutMs ?? 3000;
  }

  private bind(viewId: string, wcId: number): void {
    const bound = this.bindings.get(viewId);
    if (bound === undefined) {
      this.bindings.set(viewId, wcId);
      return;
    }
    if (bound !== wcId) throw new AppError('FORBIDDEN', 'This view belongs to another window');
  }

  private grant(noteId: string, viewId: string, wcId: number): Lease {
    const lease: Lease = { viewId, webContentsId: wcId, token: this.deps.ids.uuid() };
    this.leases.set(noteId, lease);
    this.deps.emit({ noteId, holderViewId: viewId });
    return lease;
  }

  acquire(noteId: string, viewId: string, wcId: number): AcquireResult {
    this.bind(viewId, wcId);
    const held = this.leases.get(noteId);
    if (!held) return { granted: true, leaseToken: this.grant(noteId, viewId, wcId).token };
    if (held.viewId === viewId) return { granted: true, leaseToken: held.token };
    return { granted: false, holderViewId: held.viewId };
  }

  release(noteId: string, viewId: string, token: string, wcId: number): { released: boolean } {
    this.bind(viewId, wcId);
    const held = this.leases.get(noteId);
    if (!held || held.viewId !== viewId || held.token !== token) return { released: false };
    this.leases.delete(noteId);
    this.deps.emit({ noteId, holderViewId: null });
    this.pending.get(noteId)?.finish();
    return { released: true };
  }

  async take(noteId: string, viewId: string, wcId: number): Promise<{ leaseToken: string }> {
    this.bind(viewId, wcId);
    const held = this.leases.get(noteId);
    if (held && held.viewId === viewId) return { leaseToken: held.token };
    if (!held) return { leaseToken: this.grant(noteId, viewId, wcId).token };
    if (this.pending.has(noteId)) {
      throw new AppError('CONFLICT', 'Edit control is already being transferred');
    }

    const oldToken = held.token;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(noteId);
        resolve();
      };
      const timer = setTimeout(finish, this.takeTimeoutMs);
      this.pending.set(noteId, { requesterViewId: viewId, finish });
      this.deps.requestRelease({ viewId: held.viewId, webContentsId: held.webContentsId }, noteId);
    });

    if (this.bindings.get(viewId) !== wcId) {
      throw new AppError('CONFLICT', 'The requesting window was closed');
    }
    const still = this.leases.get(noteId);
    if (still && still.token === oldToken) {
      this.revoked.add(oldToken);
      this.leases.delete(noteId);
    } else if (still) {
      // Someone else acquired it while the take was waiting.
      throw new AppError('CONFLICT', 'Edit control changed while waiting');
    }
    return { leaseToken: this.grant(noteId, viewId, wcId).token };
  }

  verify(noteId: string, viewId: string, token: string, wcId: number): VerifyResult {
    const bound = this.bindings.get(viewId);
    if (bound !== undefined && bound !== wcId) return 'forbidden';
    const held = this.leases.get(noteId);
    if (held && held.viewId === viewId && held.token === token && held.webContentsId === wcId) return 'ok';
    return 'lost';
  }

  isRevoked(token: string): boolean {
    return this.revoked.has(token);
  }

  holderOf(noteId: string): string | null {
    return this.leases.get(noteId)?.viewId ?? null;
  }

  webContentsDestroyed(wcId: number): void {
    for (const [noteId, lease] of [...this.leases]) {
      if (lease.webContentsId !== wcId) continue;
      this.leases.delete(noteId);
      this.revoked.add(lease.token);
      this.deps.emit({ noteId, holderViewId: null });
      this.pending.get(noteId)?.finish();
    }
    for (const [viewId, bound] of [...this.bindings]) {
      if (bound === wcId) this.bindings.delete(viewId);
    }
    for (const p of [...this.pending.values()]) {
      if (!this.bindings.has(p.requesterViewId)) p.finish();
    }
  }
}
