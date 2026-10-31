import { useEffect, useState } from 'react';
import { MemoryTripRepository } from './application/memoryRepository';
import type { TripRepository } from './application/repository';
import { DexieTripRepository } from './storage/dexieRepository';
import { HomeView } from './features/home/HomeView';
import { SetupView } from './features/setup/SetupView';
import { Workspace } from './features/workspace/Workspace';

type Route = { name: 'home' } | { name: 'new' } | { name: 'trip'; id: string; generate: boolean };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'new') return { name: 'new' };
  const m = /^trip\/([A-Za-z0-9_.:-]+)(\?generate=1)?$/.exec(h);
  if (m) return { name: 'trip', id: decodeURIComponent(m[1]!), generate: Boolean(m[2]) };
  return { name: 'home' };
}

function makeRepository(): TripRepository {
  try {
    if (typeof indexedDB !== 'undefined') return new DexieTripRepository();
  } catch {
    /* fall through */
  }
  return new MemoryTripRepository();
}

export function App() {
  const [repo] = useState(makeRepository);
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!online && (
        <div className="banner info no-print" role="status" style={{ margin: 0, borderRadius: 0 }}>
          You are offline. Planning, editing, saving and export still work here. No remote services are used.
        </div>
      )}
      {!repo.durable && (
        <div className="banner warn no-print" role="alert" style={{ margin: 0, borderRadius: 0 }}>
          This browser is not allowing local storage, so trips will be lost when you close the tab. Export a backup to keep your work.
        </div>
      )}
      {route.name === 'home' && <HomeView repo={repo} />}
      {route.name === 'new' && <SetupView repo={repo} />}
      {route.name === 'trip' && <Workspace key={route.id} repo={repo} tripId={route.id} autoGenerate={route.generate} />}
    </>
  );
}
