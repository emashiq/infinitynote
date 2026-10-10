interface Reveal {
  webContentsId: number;
  /** Epoch ms at which the sticky blurs again unless it is used before. */
  deadline: number;
}

/**
 * Which locked stickies are revealed, in which window, and until when (D-172). Pure state: the caller passes the time
 * (main's injectable clock) and acts on what `expired` returns, so tests drive it with a fake clock.
 */
export class RevealTimers {
  private readonly reveals = new Map<string, Reveal>();

  /** @param durationMs how long a revealed sticky stays revealed without interaction (read at each reveal and touch). */
  constructor(private readonly durationMs: () => number) {}

  reveal(noteId: string, webContentsId: number, now: number): void {
    this.reveals.set(noteId, { webContentsId, deadline: now + this.durationMs() });
  }

  /** Interaction in the window: the blur moves out again. False when that window does not show the note. */
  touch(noteId: string, webContentsId: number, now: number): boolean {
    const reveal = this.reveals.get(noteId);
    if (reveal?.webContentsId !== webContentsId || reveal.deadline <= now) return false;
    reveal.deadline = now + this.durationMs();
    return true;
  }

  isRevealed(noteId: string, webContentsId: number, now: number): boolean {
    const reveal = this.reveals.get(noteId);
    return reveal?.webContentsId === webContentsId && reveal.deadline > now;
  }

  /** Forgets the reveal; returns the window that showed the note, or null when it was not revealed. */
  conceal(noteId: string): number | null {
    const reveal = this.reveals.get(noteId);
    if (!reveal) return null;
    this.reveals.delete(noteId);
    return reveal.webContentsId;
  }

  /** Notes whose deadline has passed (still recorded until concealed). */
  expired(now: number): string[] {
    return [...this.reveals].filter(([, r]) => r.deadline <= now).map(([noteId]) => noteId);
  }

  revealed(): string[] {
    return [...this.reveals.keys()];
  }
}
