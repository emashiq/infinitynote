import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { Result } from '../../shared/contracts/envelope';

/** What the lock screen and the lock settings show of a lock. */
export interface LockTargetStatus {
  locked: boolean;
  unlocked: boolean;
  hello: boolean;
  /** A sticky PIN is set (notes only). */
  pin: boolean;
}

/**
 * A locked note (D-111) or document (D-185) as the lock screen and the lock dialogs see it: the same steps on the
 * channels of its kind, so both use one unlock screen and one settings dialog.
 */
export interface LockTarget {
  /** How the dialogs name the item. */
  noun: 'note' | 'document';
  status(): Promise<Result<LockTargetStatus>>;
  unlock(password: string): Promise<Result<unknown>>;
  unlockHello(): Promise<Result<unknown>>;
  lockNow(): Promise<Result<unknown>>;
  changePassword(currentPassword: string, newPassword: string): Promise<Result<unknown>>;
  setHello(password: string, enabled: boolean): Promise<Result<unknown>>;
  remove(password: string): Promise<Result<unknown>>;
}

type LockBridge = Pick<InfinityBridge, 'lock'>;

export function noteLockTarget(bridge: LockBridge, noteId: string): LockTarget {
  const { lock } = bridge;
  return {
    noun: 'note',
    status: () => lock.status({ noteId }),
    unlock: (password) => lock.unlock({ noteId, password }),
    unlockHello: () => lock.unlockHello({ noteId }),
    lockNow: () => lock.lockNow({ noteId }),
    changePassword: (currentPassword, newPassword) => lock.changePassword({ noteId, currentPassword, newPassword }),
    setHello: (password, enabled) => lock.setHello({ noteId, password, enabled }),
    remove: (password) => lock.remove({ noteId, password }),
  };
}

export function documentLockTarget(bridge: LockBridge, documentId: string): LockTarget {
  const { lock } = bridge;
  return {
    noun: 'document',
    status: async () => {
      const res = await lock.documentStatus({ documentId });
      return res.ok ? { ok: true, data: { ...res.data, pin: false } } : res;
    },
    unlock: (password) => lock.documentUnlock({ documentId, password }),
    unlockHello: () => lock.documentUnlockHello({ documentId }),
    lockNow: () => lock.documentLockNow({ documentId }),
    changePassword: (currentPassword, newPassword) => lock.documentChangePassword({ documentId, currentPassword, newPassword }),
    setHello: (password, enabled) => lock.documentSetHello({ documentId, password, enabled }),
    remove: (password) => lock.documentRemove({ documentId, password }),
  };
}
