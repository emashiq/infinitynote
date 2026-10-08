import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { PaletteService } from '../../services/palette-service';
import type { IpcRouter } from '../router';
import { need } from './need';

export function registerPaletteHandlers(router: IpcRouter, get: () => PaletteService | null): void {
  router.register({
    channel: 'palette:searchTitles',
    ...CHANNEL_SCHEMAS['palette:searchTitles'],
    handler: (req: { query: string; limit?: number }) => need(get).searchTitles(req.query, req.limit),
  });
}
