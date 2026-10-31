import { useEffect, useId, useRef, type ReactNode } from 'react';
import { isSafeHttpUrl } from '../domain/schema';
import type { ConstraintStatus } from '../domain/constraints';

export function StatusBadge({ status }: { status: ConstraintStatus }) {
  const map = {
    satisfied: { cls: 'ok', icon: '✓', text: 'Met' },
    violated: { cls: 'bad', icon: '✕', text: 'Broken' },
    unresolved: { cls: 'open', icon: '?', text: 'Unresolved' },
  } as const;
  const m = map[status];
  return (
    <span className={`badge ${m.cls}`}>
      <span aria-hidden="true">{m.icon}</span> {m.text}
    </span>
  );
}

export function Badge({ kind = 'neutral', children }: { kind?: 'ok' | 'bad' | 'open' | 'neutral' | 'lock'; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/** Renders a link only for http(s) URLs; anything else is shown as inert text. */
export function SafeLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <span className="muted">no source</span>;
  if (!isSafeHttpUrl(href)) return <span className="muted">unsafe link removed</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

export function Field({ label, hint, children, inline }: { label: string; hint?: string; children: (id: string) => ReactNode; inline?: boolean }) {
  const id = useId();
  return (
    <div className={`field${inline ? ' inline' : ''}`}>
      {inline ? children(id) : null}
      <label htmlFor={id}>
        {label}
        {hint ? <span className="hint"> {hint}</span> : null}
      </label>
      {inline ? null : children(id)}
    </div>
  );
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <div className="dialog-body">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="small" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1f6f78" />
      <path d="M14 40c8-3 14-12 18-24 4 12 10 21 18 24-6 1-12 3-18 9-6-6-12-8-18-9z" fill="#fbf8f3" />
      <circle cx="46" cy="18" r="5" fill="#e0735a" />
    </svg>
  );
}
