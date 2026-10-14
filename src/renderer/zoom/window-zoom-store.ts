import type { InfinityBridge } from '../../shared/contracts/bridge';
import { DEFAULT_ZOOM, type ZoomAction, type ZoomPercent } from '../../shared/zoom';
import { createStore, type Store } from '../state/store';

/**
 * The main window's zoom as its title bar shows it (D-186): main applies and keeps it; this follows the answers and
 * `window:zoomChanged`.
 */
export class WindowZoomStore {
  readonly store: Store<{ percent: ZoomPercent }>;

  constructor(
    private readonly bridge: Pick<InfinityBridge, 'window'>,
    initial: ZoomPercent = DEFAULT_ZOOM,
  ) {
    this.store = createStore({ percent: initial });
  }

  /** Zooms the window; resolves with the refusal's message, or null. */
  async change(action: ZoomAction): Promise<string | null> {
    const res = await this.bridge.window.zoom({ action });
    if (!res.ok) return res.error.message;
    this.follow(res.data.percent);
    return null;
  }

  follow(percent: ZoomPercent): void {
    this.store.setState({ percent });
  }
}
