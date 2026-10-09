import { ReminderDialog } from '../reminders/ReminderDialog';
import { SuggestionCard } from '../reminders/SuggestionCard';
import { AboutDialog, ShortcutsDialog } from '../shell/HelpDialogs';
import { MoveDialog } from '../tree/MoveDialog';
import { useServices, useStore } from '../state/use-store';
import type { Outcome } from '../state/store';
import { ConfirmRunner, TRASH_CONFIRM } from './ConfirmDialog';
import { NameDialog } from './NameDialog';

/** Renders whichever dialog UiStore.dialog names. */
export function DialogHost() {
  const services = useServices();
  const { tree, ui, tabs, notices } = services;
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
          title={TRASH_CONFIRM.title}
          body={TRASH_CONFIRM.body(node.label)}
          confirmLabel={TRASH_CONFIRM.confirmLabel}
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
    case 'reminder': {
      const controller = tabs.activeController();
      return (
        <ReminderDialog
          key={dialog.reminder?.id ?? dialog.noteId}
          noteId={dialog.noteId}
          reminder={dialog.reminder}
          blockId={dialog.blockId}
          title={dialog.title}
          persistBlocks={controller?.noteId === dialog.noteId ? () => controller.persistBlockIds() : null}
          onClose={close}
        />
      );
    }
    case 'suggestion': {
      const controller = tabs.activeController();
      const own = controller?.noteId === dialog.request.noteId ? controller : null;
      return (
        <SuggestionCard
          request={dialog.request}
          bridge={services.bridge}
          persist={async () => (own ? (await own.flush()).ok : true)}
          persistBlocks={() => (own ? own.persistBlockIds() : Promise.resolve(false))}
          notify={(message) => notices.push(message, 'info')}
          onClose={close}
        />
      );
    }
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    default:
      return null;
  }
}
