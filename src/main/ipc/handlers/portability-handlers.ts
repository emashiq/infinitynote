import type { PortabilityService } from '../../portability/portability-service';
import type { IpcRouter } from '../router';

/** Backup, restore, export and import (Phase 08, D-099); main window only. Every path comes from a main-process dialog. */
export function registerPortabilityHandlers(router: IpcRouter, portability: () => PortabilityService): void {
  router.register('backup:create', (_req, ctx) => portability().createBackup(ctx));
  router.register('backup:prepareRestore', (_req, ctx) => portability().prepareRestore(ctx));
  router.register('backup:restore', () => portability().restore());
  router.register('backup:status', () => portability().status());
  router.register('backup:setAuto', (req) => portability().setAuto(req));
  router.register('backup:chooseAutoFolder', (_req, ctx) => portability().chooseAutoFolder(ctx));
  router.register('backup:deleteRollback', () => portability().deleteRollback());
  router.register('export:markdown', (req, ctx) => portability().exportNote(req, ctx));
  router.register('export:noteDocument', (req, ctx) => portability().exportNoteDocument(req, ctx));
  router.register('note:print', (req) => portability().printNote(req));
  router.register('export:portable', (_req, ctx) => portability().exportPortable(ctx));
  router.register('import:portable', (_req, ctx) => portability().importPortable(ctx));
}
