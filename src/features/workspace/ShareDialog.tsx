import { useMemo, useState } from 'react';
import { buildShareable, type ShareOptions } from '../../application/transfer';
import type { TripDocument } from '../../domain/schema';
import {Dialog, Field} from '../../ui/components';
import { downloadText, slug } from '../../ui/download';

export function ShareDialog({ open, onClose, doc }: { open: boolean; onClose: () => void; doc: TripDocument }) {
  const [opts, setOpts] = useState<ShareOptions>({ omitExactDates: false, omitAccommodation: true, omitCosts: false });
  const share = useMemo(() => (open ? buildShareable(doc, opts) : null), [open, doc, opts]);
  const text = share ? JSON.stringify(share, null, 2) : '';
  return (
    <Dialog open={open} onClose={onClose} title="Share a copy">
      <p>This makes a file you can send yourself. Nothing is uploaded or published.</p>
      <p>
        <strong>Always left out:</strong> traveller names and contacts, booking references, private notes, journey and activity notes, and edit history.
      </p>
      <fieldset>
        <legend>Also leave out</legend>
        <Field label="Exact dates (use day numbers instead)" inline>
          {(id) => <input id={id} type="checkbox" checked={opts.omitExactDates} onChange={(e) => setOpts((o) => ({ ...o, omitExactDates: e.target.checked }))} />}
        </Field>
        <Field label="Accommodation names" inline>
          {(id) => <input id={id} type="checkbox" checked={opts.omitAccommodation} onChange={(e) => setOpts((o) => ({ ...o, omitAccommodation: e.target.checked }))} />}
        </Field>
        <Field label="Costs" inline>
          {(id) => <input id={id} type="checkbox" checked={opts.omitCosts} onChange={(e) => setOpts((o) => ({ ...o, omitCosts: e.target.checked }))} />}
        </Field>
      </fieldset>
      {share && (
        <>
          <p>
            Included: title, {share.places.length} places, {share.stays.length} stays, {share.travel.length} journeys, {share.activities.length} activities, {share.commitments.length} commitments, {share.evidence.length} evidence links
            {share.budget ? `, ${share.budget.length} budget lines` : ''}.
          </p>
          <h3>Preview of the file</h3>
          <pre className="preview-json" data-testid="share-preview">
            {text}
          </pre>
        </>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={() => downloadText(`${slug(doc.title)}-shareable.json`, text)}>
          Download shareable copy
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
