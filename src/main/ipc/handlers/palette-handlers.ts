import type { PaletteService } from '../../services/palette-service';
import type { IpcRouter } from '../router';

export function registerPaletteHandlers(router: IpcRouter, palette: () => PaletteService): void {
  router.register('palette:searchTitles', (req) => palette().searchTitles(req.query, req.limit));
  router.register('links:search', (req) => palette().searchLinkTargets(req.query, req.limit));
}
