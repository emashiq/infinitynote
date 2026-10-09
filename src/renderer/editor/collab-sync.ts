import { Extension, type Editor } from '@tiptap/core';
import { Step } from '@tiptap/pm/transform';
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { REMOTE_META, type SendableSteps } from './content';

/** The ProseMirror collab plugin (D-103): it tracks this view's unconfirmed steps from the version the editor opened at. */
export function collabSync(version: number, clientID: string) {
  return Extension.create({
    name: 'collabSync',
    addProseMirrorPlugins: () => [collab({ version, clientID })],
  });
}

export function syncVersion(editor: Editor): number {
  return getVersion(editor.state);
}

export function sendableOf(editor: Editor): SendableSteps | null {
  const sendable = sendableSteps(editor.state);
  return sendable ? { version: sendable.version, steps: sendable.steps.map((s) => s.toJSON() as { stepType: string }) } : null;
}

/**
 * Applies main's confirmed steps from `version` on: other views' steps are rebased under this view's unconfirmed ones,
 * and this view's own confirm them. The selection stays where the user put it.
 */
export function receiveSteps(editor: Editor, version: number, steps: ReadonlyArray<{ stepType: string }>, clientIDs: readonly string[]): 'applied' | 'gap' {
  const local = getVersion(editor.state);
  if (version > local) return 'gap';
  const skip = local - version;
  if (skip >= steps.length) return 'applied';
  const parsed = steps.slice(skip).map((json) => Step.fromJSON(editor.schema, json));
  const tr = receiveTransaction(editor.state, parsed, clientIDs.slice(skip), { mapSelectionBackward: true });
  editor.view.dispatch(tr.setMeta(REMOTE_META, true));
  return 'applied';
}
