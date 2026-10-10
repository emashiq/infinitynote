import type { CommentService } from '../../comments/comment-service';
import type { GraphService } from '../../graph/graph-service';
import type { IpcRouter } from '../router';

/** Comments on notes and documents (D-165) and the relation graph (D-170); main window only. */
export function registerCommentAndGraphHandlers(router: IpcRouter, deps: { comments: () => CommentService; graph: () => GraphService }): void {
  router.register('comment:list', (req) => deps.comments().list(req.target));
  router.register('comment:create', (req) => deps.comments().create(req));
  router.register('comment:reply', (req) => deps.comments().reply(req));
  router.register('comment:edit', (req) => deps.comments().edit(req));
  router.register('comment:delete', (req) => deps.comments().deleteComment(req.commentId));
  router.register('comment:deleteThread', (req) => deps.comments().deleteThread(req.threadId));
  router.register('comment:resolve', (req) => deps.comments().resolve(req));
  router.register('graph:build', (req) => deps.graph().build(req));
  router.register('graph:local', (req) => deps.graph().local(req));
}
