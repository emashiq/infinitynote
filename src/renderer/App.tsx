import { useEffect, useState } from 'react';
import type { AppInfoType } from '../shared/contracts/app';
import type { InfinityBridge } from '../shared/contracts/bridge';
import { getBridge } from './bridge';
import { FoundationScreen } from './shell/FoundationScreen';
import { StartupErrorScreen } from './startup/StartupErrorScreen';

type Load = { state: 'pending' } | { state: 'ready'; info: AppInfoType } | { state: 'failed'; message: string };

export function App({ bridge }: { bridge?: InfinityBridge }) {
  const api = bridge ?? getBridge();
  const [load, setLoad] = useState<Load>({ state: 'pending' });

  useEffect(() => {
    let cancelled = false;
    void api.app.getInfo().then((result) => {
      if (cancelled) return;
      setLoad(result.ok ? { state: 'ready', info: result.data } : { state: 'failed', message: result.error.message });
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (load.state === 'pending') return <main aria-busy="true" />;
  if (load.state === 'failed') {
    return (
      <main className="screen-center">
        <p role="alert">{load.message}</p>
      </main>
    );
  }
  if (load.info.startup.status === 'error') {
    return <StartupErrorScreen bridge={api} code={load.info.startup.code} />;
  }
  return <FoundationScreen bridge={api} info={load.info} />;
}
