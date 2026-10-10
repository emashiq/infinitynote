/** A frame scheduler: `requestAnimationFrame` where the window has it, else a 16 ms timer. */
export interface FrameScheduler {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

export const windowFrames: FrameScheduler =
  typeof requestAnimationFrame === 'function'
    ? { request: (cb) => requestAnimationFrame(cb), cancel: (h) => cancelAnimationFrame(h) }
    : { request: (cb) => Number(setTimeout(cb, 16)), cancel: (h) => clearTimeout(h) };

/**
 * Runs `frame` once per animation frame only while there is work (D-170): `frame` returns true to run again (the
 * layout is still settling); `kick` starts it again after an interaction. An idle graph costs nothing.
 */
export class FrameLoop {
  private handle: number | null = null;

  constructor(
    private readonly frame: () => boolean,
    private readonly frames: FrameScheduler = windowFrames,
  ) {}

  kick(): void {
    if (this.handle !== null) return;
    this.handle = this.frames.request(() => {
      this.handle = null;
      if (this.frame()) this.kick();
    });
  }

  stop(): void {
    if (this.handle !== null) this.frames.cancel(this.handle);
    this.handle = null;
  }
}
