import { useEffect, useRef, useState } from 'react';
import type { StartupErrorCodeType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';

export const STARTUP_ERROR_COPY: Record<StartupErrorCodeType, string> = {
  MIGRATION_FAILED: 'Database upgrade failed; your data was not changed',
  SCHEMA_TOO_NEW: 'This notebook was created by a newer version of Infinity Notes. Your data was not changed.',
  DB_OPEN_FAILED: 'Infinity Notes could not open its database. Your data was not changed.',
};

export function StartupErrorScreen({ bridge, code }: { bridge: InfinityBridge; code: StartupErrorCodeType }) {
  const showRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    showRef.current?.focus();
  }, []);

  const showFolder = async () => {
    const result = await bridge.app.showDataFolder();
    setMessage(result.ok ? null : result.error.message);
  };

  return (
    <main className="screen-center startup-error">
      <div role="alert">
        <h1>{STARTUP_ERROR_COPY[code]}</h1>
      </div>
      <div className="button-row">
        <button ref={showRef} type="button" className="btn btn-primary" onClick={() => void showFolder()}>
          Show data folder
        </button>
        <button type="button" className="btn" onClick={() => void bridge.app.quit()}>
          Quit
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
