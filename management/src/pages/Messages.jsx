import { useState } from 'react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import StatusBadge from '../components/StatusBadge';
import Pagination, { usePagination } from '../components/Pagination';
import { EmptyState } from '../components/States';
import { FilterBar, SearchFilter, SelectFilter } from '../components/Filters';
import { useCan } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';
import { CHANNEL_LABELS, formatInstant, MESSAGE_LABELS, MESSAGE_STATUS, MESSAGE_TONES, whatsappChatUrl } from '../lib/format';
import { useResource } from '../lib/useResource';
import ViewTabs from '../components/ViewTabs';
import { INBOX } from '../layout/sections';

const STATUS_OPTIONS = [{ value: 'all', label: 'All messages' }, ...Object.entries(MESSAGE_STATUS).map(([value, label]) => ({ value, label }))];
const CHANNEL_OPTIONS = [{ value: 'all', label: 'WhatsApp and email' }, ...Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))];

/** The message without its private-link lines, for staff to send by hand in WhatsApp. */
const chatText = (body) =>
  body
    .split('\n')
    .filter((line) => !line.includes('{{link}}') && !line.startsWith('Keep this link private'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export default function Messages() {
  const { notify } = useWorkspace();
  const can = useCan();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [channel, setChannel] = useState('all');
  const search = new URLSearchParams();
  if (query.trim()) search.set('q', query.trim());
  if (status !== 'all') search.set('status', status);
  if (channel !== 'all') search.set('channel', channel);
  const { data, error, reload } = useResource(`/messages?${search}`);
  const rows = data?.messages ?? [];
  // WhatsApp messages that were sent by email instead, so staff don't try them again.
  const replaced = new Set(rows.map((m) => m.fallbackOf).filter(Boolean));
  const pager = usePagination(rows, 12);

  const act = async (message, action, done) => {
    try {
      await api(`/messages/${message.id}/${action}`, { method: 'POST' });
      reload();
      notify(done);
    } catch (err) {
      notify(err.message);
    }
  };

  return (
    <>
      <PageHeader title={INBOX.label} subtitle="Every WhatsApp message and email the system sends or is waiting to send." action={can('settings.manage') ? <Button to="/settings">WhatsApp and email settings</Button> : undefined} />
      <ViewTabs tabs={INBOX.tabs} label="Enquiries and messages" />

      <FilterBar>
        <SearchFilter label="Search recipient or subject" value={query} onChange={setQuery} />
        <SelectFilter label="Channel" value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
        <SelectFilter label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </FilterBar>

      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}

      <Panel title="Message history" meta={`${rows.length} ${rows.length === 1 ? 'message' : 'messages'}`}>
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>To</th>
                    <th>When</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.rows.map((m) => (
                    <tr key={m.id}>
                      <td className="data-table__key">
                        {MESSAGE_LABELS[m.template] ?? m.template}
                        <span className="data-table__sub">
                          {CHANNEL_LABELS[m.channel] ?? m.channel}
                          {m.audience === 'owner' ? ' · to owner' : ''}
                          {m.fallbackOf ? ' · instead of WhatsApp' : ''} · {m.subject}
                        </span>
                      </td>
                      <td>{m.recipient}</td>
                      <td>{formatInstant(m.sentAt ?? m.createdAt)}</td>
                      <td>
                        <StatusBadge tone={MESSAGE_TONES[m.status]}>{MESSAGE_STATUS[m.status]}</StatusBadge>
                        {m.lastError && <span className="data-table__sub">{m.lastError}</span>}
                        {replaced.has(m.id) && <span className="data-table__sub">Sent by email instead.</span>}
                      </td>
                      <td>
                        <div className="staff-actions">
                          {(m.status === 'failed' || m.status === 'queued') && !replaced.has(m.id) && (m.channel === 'email' || m.status === 'failed') && (
                            <button type="button" className="link-button small" onClick={() => act(m, 'retry', 'Trying again shortly.')}>
                              {m.status === 'failed' ? 'Try again' : 'Send now'}
                            </button>
                          )}
                          {m.status === 'queued' && (
                            <button type="button" className="link-button small" onClick={() => act(m, 'cancel', 'Message cancelled.')}>
                              Cancel
                            </button>
                          )}
                          {m.channel === 'whatsapp' && m.audience === 'customer' && m.status === 'failed' && !replaced.has(m.id) && (
                            <a className="link-button small" href={whatsappChatUrl(m.recipient, chatText(m.body))} target="_blank" rel="noreferrer">
                              Open in WhatsApp
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination pager={pager} noun="messages" />
          </>
        ) : (
          <EmptyState title="No messages" text={data ? 'Messages appear here when bookings or enquiries come in.' : 'Loading…'} />
        )}
      </Panel>
    </>
  );
}
