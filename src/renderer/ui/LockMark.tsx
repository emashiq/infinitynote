import { Lock } from 'lucide-react';

/** The small lock that marks a locked note in the tree, tabs, Home and search (D-111). */
export function LockMark({ size = 12 }: { size?: number }) {
  return <Lock size={size} strokeWidth={1.75} role="img" aria-label="Locked" className="lock-mark" />;
}
