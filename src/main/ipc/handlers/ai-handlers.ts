import type { CommentTargetType } from '../../../shared/contracts/comments';
import type { AiService } from '../../ai/ai-service';
import type { CommentService } from '../../comments/comment-service';
import { AppError } from '../../services/app-error';
import type { HandlerContext, IpcRouter } from '../router';

/**
 * AI actions (D-190). The main window may use every channel; a sticky window only those about its own note (D-064):
 * a target must be its note, and a thread must be one of its note's.
 */
export function registerAiHandlers(router: IpcRouter, deps: { ai: () => AiService; comments: () => CommentService }): void {
  const own = (ctx: HandlerContext, target: CommentTargetType): void => {
    if (ctx.sender.role === 'sticky' && (target.kind !== 'note' || target.id !== ctx.sender.noteId)) throw new AppError('FORBIDDEN', 'Not allowed');
  };
  const ownThread = (ctx: HandlerContext, threadId: string): void => {
    if (ctx.sender.role === 'sticky') own(ctx, deps.comments().threadTarget(threadId).target);
  };
  router.register('ai:status', () => deps.ai().status());
  router.register('ai:acknowledge', (req) => deps.ai().acknowledge(req.engine));
  router.register('ai:context', (req, ctx) => {
    own(ctx, req.target);
    return deps.ai().fileOptions(req.target);
  });
  router.register('ai:pickFiles', (_req, ctx) => deps.ai().pickFiles(ctx));
  router.register('ai:ask', (req, ctx) => {
    own(ctx, req.target);
    return deps.ai().ask(req, ctx);
  });
  router.register('ai:followUp', (req, ctx) => {
    ownThread(ctx, req.threadId);
    return deps.ai().followUp(req);
  });
  router.register('ai:wait', (req, ctx) => {
    ownThread(ctx, req.threadId);
    return deps.ai().wait(req.threadId);
  });
  router.register('ai:stop', (req, ctx) => {
    ownThread(ctx, req.threadId);
    return deps.ai().stop(req.threadId);
  });
  router.register('ai:thread', (req, ctx) => {
    ownThread(ctx, req.threadId);
    return deps.ai().thread(req.threadId);
  });
  router.register('ai:deleteThread', (req, ctx) => {
    ownThread(ctx, req.threadId);
    return deps.ai().deleteThread(req.threadId);
  });
  router.register('ai:config', () => deps.ai().config());
  router.register('ai:setKey', (req) => deps.ai().setKey(req.provider, req.key));
  router.register('ai:cliPath', (req, ctx) => deps.ai().cliPath(req.cli, req.action, ctx));
  router.register('ai:test', (req) => deps.ai().test(req.engine));
}
