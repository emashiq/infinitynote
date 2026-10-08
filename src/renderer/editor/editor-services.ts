import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { AttachmentLimits } from './uploader';

/**
 * What the editor needs from the app; passed in so the same editor serves tabs and (Phase 04) stickies. Must be a
 * stable object (each editor instance creates its uploader from it once).
 */
export interface EditorServices {
  bridge: Pick<InfinityBridge, 'attachment' | 'shell'>;
  notify: (message: string) => void;
  limits: () => AttachmentLimits;
}
