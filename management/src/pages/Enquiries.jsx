import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Field from '../components/Field';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import Pagination, { usePagination } from '../components/Pagination';
import { EmptyState } from '../components/States';
import { FilterBar, SearchFilter, SelectFilter } from '../components/Filters';
import ActionDialog from '../dialogs/ActionDialog';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { formatInstant } from '../lib/format';
import { useResource } from '../lib/useResource';
import ViewTabs from '../components/ViewTabs';
import { INBOX } from '../layout/sections';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All enquiries' },
  { value: 'new', label: 'New' },
  { value: 'handled', label: 'Handled' },
];

function EnquiryDetail({ enquiry, onChanged, onDelete }) {
  const [notes, setNotes] = useState(enquiry.notes ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setNotes(enquiry.notes ?? ''), [enquiry.id, enquiry.notes]);

  const save = async (status, message) => {
    setPending(true);
    setError('');
    try {
      await api(`/enquiries/${enquiry.id}`, { method: 'PATCH', body: { status, notes } });
      onChanged(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel className="detail-panel">
      <div className="detail-panel__head">
        <h2 className="detail-panel__id">{enquiry.enquiryNo}</h2>
        <StatusBadge tone={enquiry.status === 'new' ? 'warning' : 'success'}>{enquiry.status === 'new' ? 'New' : 'Handled'}</StatusBadge>
      </div>
      <hr className="rule" />
      <p className="detail-panel__name">{enquiry.name}</p>
      <p className="detail-panel__lines">
        <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a>
        {enquiry.phone && (
          <>
            <br />
            <a href={`tel:${enquiry.phone}`}>{enquiry.phone}</a>
          </>
        )}
        <br />
        Received {formatInstant(enquiry.createdAt)}
        {enquiry.topic && (
          <>
            <br />
            Topic: {enquiry.topic}
          </>
        )}
        {enquiry.preferred && (
          <>
            <br />
            Preferred: {enquiry.preferred}
          </>
        )}
      </p>
      <hr className="rule" />
      <p className="enquiry-message">{enquiry.message}</p>
      <hr className="rule" />
      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      <Field as="textarea" label="Staff notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="detail-panel__actions">
        {enquiry.status === 'new' ? (
          <Button variant="primary" disabled={pending} onClick={() => save('handled', `${enquiry.enquiryNo} marked as handled.`)}>
            Mark as handled
          </Button>
        ) : (
          <Button disabled={pending} onClick={() => save('new', `${enquiry.enquiryNo} reopened.`)}>
            Reopen
          </Button>
        )}
        <Button disabled={pending} onClick={() => save(enquiry.status, 'Notes saved.')}>
          Save notes
        </Button>
        <Button onClick={onDelete}>Delete enquiry</Button>
      </div>
    </Panel>
  );
}

export default function Enquiries() {
  const { notify } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('selected');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [deleting, setDeleting] = useState(false);

  const search = new URLSearchParams();
  if (query.trim()) search.set('q', query.trim());
  if (status !== 'all') search.set('status', status);
  const { data, error, reload } = useResource(`/enquiries?${search}`);
  const rows = data?.enquiries ?? [];
  const pager = usePagination(rows, 10);
  const selected = rows.find((e) => e.id === selectedId);
  const select = (id) => setParams({ selected: id }, { replace: true });
  const changed = (message) => {
    reload();
    notify(message);
  };

  return (
    <>
      <PageHeader title={INBOX.label} subtitle="Questions sent from the website’s contact form." />
      <ViewTabs tabs={INBOX.tabs} label="Enquiries and messages" />

      <FilterBar>
        <SearchFilter label="Search name, email, phone, message or number" value={query} onChange={setQuery} />
        <SelectFilter label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </FilterBar>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <div className="detail-layout">
        <Panel title="Inbox" meta={`${rows.filter((e) => e.status === 'new').length} new`}>
          {rows.length ? (
            <>
              <div className="table-wrap">
                <table className="data-table data-table--interactive">
                  <thead>
                    <tr>
                      <th>Enquiry</th>
                      <th>From</th>
                      <th>Received</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.rows.map((e) => (
                      <tr key={e.id} className={e.id === selectedId ? 'is-selected' : undefined} onClick={() => select(e.id)}>
                        <td className="data-table__key">
                          <button type="button" className="link-button" onClick={() => select(e.id)}>
                            {e.enquiryNo}
                          </button>
                          <span className="data-table__sub">{e.topic}</span>
                        </td>
                        <td>
                          {e.name}
                          <span className="data-table__sub">{e.email}</span>
                        </td>
                        <td>{formatInstant(e.createdAt)}</td>
                        <td>
                          <StatusBadge tone={e.status === 'new' ? 'warning' : 'success'}>{e.status === 'new' ? 'New' : 'Handled'}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination pager={pager} noun="enquiries" />
            </>
          ) : (
            <EmptyState title="No enquiries" text={data ? 'Nothing here yet. Enquiries from the website’s contact form appear in this list.' : 'Loading…'} />
          )}
        </Panel>

        {selected ? (
          <EnquiryDetail enquiry={selected} onChanged={changed} onDelete={() => setDeleting(true)} />
        ) : (
          <Panel className="detail-panel">
            <p className="small muted">Select an enquiry to read it.</p>
          </Panel>
        )}
      </div>

      <AnimatePresence>
        {deleting && selected && (
          <ActionDialog
            key="delete"
            title={`Delete ${selected.enquiryNo}?`}
            description="This permanently removes the message and its notes."
            label="Delete enquiry"
            onClose={() => setDeleting(false)}
            onConfirm={async () => {
              await api(`/enquiries/${selected.id}`, { method: 'DELETE' });
              setDeleting(false);
              setParams({}, { replace: true });
              changed('Enquiry deleted.');
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
