import { useState } from 'react';
import { MoveDialog } from '../tree/MoveDialog';
import { useServices, useStore } from '../state/use-store';
import type { Outcome } from '../state/store';
import { ConfirmDialog } from './ConfirmDialog';
import { NameDialog } from './NameDialog';

function ConfirmRunner({
  title,
  body,
  confirmLabel,
  confirmFirst,
  run,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmFirst: boolean;
  run: () => Promise<Outcome<unknown>>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      confirmFirst={confirmFirst}
      error={error}
      onClose={onClose}
      onConfirm={() => {
        void run().then((res) => {
          if (res.ok) onClose();
          else setError(res.message);
        });
      }}
    />
  );
}

/** Renders whichever dialog UiStore.dialog names. */
export function DialogHost() {
  const services = useServices();
  const { tree, ui } = services;
  const { dialog } = useStore(ui.store);
  const treeState = useStore(tree.store);
  if (!dialog) return null;
  const close = () => ui.closeDialog();
  // The removed row takes the focus with it, so hand the focus to the surviving parent row (keyboard users never land on body).
  const focusRow = (key: string | null) => {
    if (key) tree.select(key);
    ui.requestFocus({ target: 'tree' });
  };
  const after = async (result: Promise<Outcome<unknown>>, key: string | null): Promise<Outcome<unknown>> => {
    const res = await result;
    if (res.ok) focusRow(key);
    return res;
  };

  switch (dialog.kind) {
    case 'newProject':
      return (
        <NameDialog
          title="New project"
          initial="New project"
          submitLabel="Create"
          onClose={close}
          onSubmit={async (name) => {
            const res = await tree.createProject(name);
            if (res.ok) close();
            return res.ok ? null : res.message;
          }}
        />
      );
    case 'newFolder':
      return (
        <NameDialog
          title="New folder"
          initial="New folder"
          submitLabel="Create"
          onClose={close}
          onSubmit={async (name) => {
            const res = await tree.createFolder(dialog.target, name);
            if (res.ok) close();
            return res.ok ? null : res.message;
          }}
        />
      );
    case 'move':
      return <MoveDialog nodeKey={dialog.key} onClose={close} />;
    case 'confirmTrash': {
      const node = treeState.model.nodes.get(dialog.key);
      if (!node?.id) return null;
      const id = node.id;
      const run = () => after(node.kind === 'project' ? tree.trashProject(id) : node.kind === 'folder' ? tree.trashFolder(id) : tree.trashNote(id), node.parentKey);
      return (
        <ConfirmRunner
          title="Move to Trash?"
          body={`“${node.label}” will be moved to Trash. You can restore it from Trash.`}
          confirmLabel="Move to Trash"
          confirmFirst
          run={run}
          onClose={close}
        />
      );
    }
    case 'confirmPurge':
      return (
        <ConfirmRunner
          title="Delete forever?"
          body={`${dialog.count === 1 ? '1 item' : `${dialog.count} items`} will be deleted forever. This cannot be undone.`}
          confirmLabel="Delete forever"
          confirmFirst={false}
          run={() => after(tree.purge(dialog.batchId), 'trash')}
          onClose={close}
        />
      );
    case 'confirmEmptyTrash':
      return (
        <ConfirmRunner
          title="Empty trash?"
          body={`${dialog.count === 1 ? '1 item' : `${dialog.count} items`} will be deleted forever. This cannot be undone.`}
          confirmLabel="Empty trash"
          confirmFirst={false}
          run={() => after(tree.emptyTrash(), 'trash')}
          onClose={close}
        />
      );
    default:
      return null;
  }
}
