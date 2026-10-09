import { COPYRIGHT, DEVELOPER_CREDIT, PRODUCT_NAME } from '../../shared/app-identity';
import { SHORTCUT_GROUPS } from '../state/shortcuts';
import { useServices, useStore } from '../state/use-store';
import { Dialog } from '../ui/Dialog';

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-actions">
      <button type="button" className="btn btn-primary" data-autofocus="" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** Help → Keyboard shortcuts and Ctrl+/ (D-097, INF-KEY-06): every key the app answers to, by area. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcut-groups">
        {SHORTCUT_GROUPS.map((group) => (
          <table key={group.title} className="shortcut-table">
            <caption>{group.title}</caption>
            <tbody>
              {group.items.map((s) => (
                <tr key={s.keys}>
                  <td>
                    <kbd>{s.keys}</kbd>
                  </td>
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <CloseRow onClose={onClose} />
    </Dialog>
  );
}

/** Who made the app and under which terms: Help → About and Settings → About. */
export function AboutCredits() {
  return (
    <>
      <p>{DEVELOPER_CREDIT}</p>
      <p className="muted">{COPYRIGHT}. Free to use under the Infinity Notes Freeware License.</p>
    </>
  );
}

/** Help → About (D-097): name, version, runtime versions and credits. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useServices();
  const { info } = useStore(meta);
  return (
    <Dialog title={`About ${PRODUCT_NAME}`} onClose={onClose}>
      <p>Offline notes, stickies and reminders.</p>
      {info ? (
        <p className="muted">
          Version {info.version} · Electron {info.versions.electron} · {info.platform} {info.arch}
        </p>
      ) : null}
      <AboutCredits />
      <CloseRow onClose={onClose} />
    </Dialog>
  );
}
