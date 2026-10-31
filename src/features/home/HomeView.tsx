import { useCallback, useEffect, useRef, useState } from 'react';
import type { TripRepository, TripSummary } from '../../application/repository';
import { parseImport } from '../../application/transfer';
import { DEFAULT_PACK } from '../../catalogue';
import { formatDate } from '../../domain/dates';
import { demoTrip } from '../../fixtures';
import { navigate } from '../../ui/navigation';
import { Badge, LiveRegion, Logo } from '../../ui/components';

export function HomeView({ repo }: { repo: TripRepository }) {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setTrips(await repo.list());
    } catch (err) {
      setErrors([`Could not read saved trips: ${(err as Error).message}`]);
      setTrips([]);
    }
  }, [repo]);
  useEffect(() => {
    let live = true;
    repo
      .list()
      .then((t) => live && setTrips(t))
      .catch((err: Error) => {
        if (!live) return;
        setErrors([`Could not read saved trips: ${err.message}`]);
        setTrips([]);
      });
    return () => {
      live = false;
    };
  }, [repo]);

  const openDemo = async () => {
    const existing = trips?.find((t) => t.isSynthetic);
    if (existing) return navigate(`/trip/${existing.id}`);
    const doc = await repo.create(demoTrip());
    navigate(`/trip/${doc.id}`);
  };

  const onImport = async (file: File) => {
    setErrors([]);
    const text = await file.text();
    const r = parseImport(text, new Set((trips ?? []).map((t) => t.id)));
    if (!r.ok) {
      setErrors(r.errors);
      setMessage('Import failed. Nothing was changed.');
      return;
    }
    try {
      const doc = await repo.create(r.doc);
      setMessage(`Imported ${doc.title}.`);
      navigate(`/trip/${doc.id}`);
    } catch (err) {
      setErrors([(err as Error).message]);
    }
  };

  const remove = async (t: TripSummary) => {
    if (!window.confirm(`Delete “${t.title}” from this browser? Export a backup first if you want to keep it.`)) return;
    await repo.remove(t.id);
    setMessage(`Deleted ${t.title}.`);
    await refresh();
  };

  return (
    <>
      <header className="app-header">
        <a className="brand" href="#/">
          <Logo /> Holiday Planner
        </a>
      </header>
      <main id="main" className="page">
        <LiveRegion message={message} />
        <h1>Plan a holiday around what is fixed</h1>
        <p className="muted" style={{ maxWidth: '46rem' }}>
          Start with your dates and commitments. The planner suggests one route with its reasons, shows what every change would do before it happens, and keeps
          everything in this browser. No account, no tracking, no paid services.
        </p>
        <div className="hero">
          <section className="card">
            <h2>Plan a trip</h2>
            <p>Enter dates, travellers, interests and anything fixed. Automatic routes cover {DEFAULT_PACK.title}; anywhere else you can plan by hand.</p>
            <a className="button primary" href="#/new">
              Start a new trip
            </a>
          </section>
          <section className="card">
            <h2>Explore the demo</h2>
            <p>A wholly fictional trip that shows locks, transfers, budget gaps and change previews. Its places, events, times and prices are invented.</p>
            <button type="button" onClick={openDemo}>
              Open the fictional demo
            </button>
          </section>
          <section className="card">
            <h2>Import a backup</h2>
            <p>Restore a private backup exported from this app. The file is checked before anything is saved.</p>
            <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" id="import-file" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            <button type="button" onClick={() => fileInput.current?.click()}>
              Choose a file…
            </button>
          </section>
        </div>
        {errors.length > 0 && (
          <div className="banner warn" role="alert">
            <strong>Not imported.</strong>
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <section className="card">
          <h2>Your trips</h2>
          {trips === null ? (
            <p>Loading…</p>
          ) : trips.length === 0 ? (
            <p className="muted">No trips saved in this browser yet.</p>
          ) : (
            <ul className="trip-list">
              {trips.map((t) => (
                <li key={t.id}>
                  <span>
                    <a href={`#/trip/${t.id}`}>{t.title}</a> {t.isSynthetic && <Badge kind="open">Fictional demo</Badge>}{' '}
                    <small>
                      {t.firstNight && t.leaveDate ? `${formatDate(t.firstNight)} – ${formatDate(t.leaveDate)} · ` : ''}revision {t.revision}
                    </small>
                  </span>
                  <button type="button" className="small danger" onClick={() => remove(t)} aria-label={`Delete ${t.title}`}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Trips are stored only in this browser. Browsers can clear storage, so export a backup of anything important.
          </p>
        </section>
      </main>
    </>
  );
}
