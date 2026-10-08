import { Extension } from '@tiptap/core';

/** Ctrl+Enter toggles the checklist item at the cursor (UX_SPEC section 7). Elsewhere the key does nothing here. */
export const TaskToggle = Extension.create({
  name: 'taskToggle',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name !== 'taskItem') continue;
          const pos = $from.before(depth);
          return editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked });
            return true;
          });
        }
        return false;
      },
    };
  },
});
