import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import PageHeader from '../layout/PageHeader';
import Button from '../components/Button';
import Dialog from '../components/Dialog';
import Field from '../components/Field';
import Notice from '../components/Notice';
import Panel from '../components/Panel';
import PasswordField from '../components/PasswordField';
import StatusBadge from '../components/StatusBadge';
import { ROLE_LABELS } from '../auth/authService';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../store/WorkspaceContext';
import { api } from '../lib/api';

const MAX_ACTIVE = 5;
const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const HISTORY_LABELS = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.account_locked': 'Locked after failed attempts',
  'auth.logout': 'Signed out',
  'auth.logout_all': 'Signed out everywhere',
  'auth.confirm_failed': 'Wrong password on a confirmation',
  'auth.password_changed': 'Changed password',
  'auth.password_reset': 'Reset password by email',
  'auth.reset_requested': 'Requested a reset link',
  'staff.created': 'Account created',
  'staff.updated': 'Details changed',
  'staff.deactivated': 'Deactivated',
  'staff.reactivated': 'Reactivated',
  'staff.password_reset': 'Temporary password issued',
  'staff.deleted': 'Moved to trash',
  'staff.restored': 'Restored from trash',
};

const formatDateTime = (value) =>
  value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : 'Never';

/** Asks for the signed-in Owner's password; every change here needs it. */
function ConfirmField({ value, onChange, error, hideKey }) {
  return (
    <PasswordField
      label="Your password"
      autoComplete="current-password"
      required
      hint="Enter your own password to confirm."
      hideKey={hideKey}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
    />
  );
}

function StaffDialog({ person, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: person?.name ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    role: person?.role ?? 'front_desk',
  });
  const [currentPassword, setCurrentPassword] = useState('');
  const [submits, setSubmits] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const errors = {
    ...(!form.name.trim() && { name: 'Enter a name.' }),
    ...(!EMAIL.test(form.email.trim()) && { email: 'Enter a valid email.' }),
    ...(!currentPassword && { currentPassword: 'Enter your password to confirm.' }),
  };
  const show = (field) => (submits > 0 ? errors[field] : undefined);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    if (Object.keys(errors).length || pending) return;
    setPending(true);
    setError('');
    try {
      const body = { ...form, currentPassword };
      const result = person ? await api(`/staff/${person.id}`, { method: 'PATCH', body }) : await api('/staff', { method: 'POST', body });
      onSaved(result);
    } catch (err) {
      setError(err.message);
      setCurrentPassword('');
      setPending(false);
    }
  };

  return (
    <Dialog
      title={person ? `Edit ${person.name}` : 'Add staff'}
      description={person ? undefined : `Up to ${MAX_ACTIVE} active accounts. They’ll get a temporary password to replace at first sign-in.`}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : person ? 'Save changes' : 'Add staff'}
          </Button>
        </>
      }
    >
      {error && (
        <div role="alert" className="staff-dialog__alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      <div className="form-grid">
        <Field label="Full name" required autoComplete="off" value={form.name} onChange={set('name')} error={show('name')} />
        <Field label="Email" type="email" required autoComplete="off" value={form.email} onChange={set('email')} error={show('email')} />
        <Field label="Phone (optional)" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={set('phone')} />
        <Field as="select" label="Role" options={ROLE_OPTIONS} value={form.role} onChange={set('role')} />
        <div className="form-grid__full">
          <ConfirmField value={currentPassword} onChange={setCurrentPassword} error={show('currentPassword')} hideKey={submits} />
        </div>
      </div>
    </Dialog>
  );
}

/** Confirms deactivate, reactivate, reset, trash or restore with the Owner's password. */
function ActionDialog({ action, onClose, onDone }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [submits, setSubmits] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSubmits((n) => n + 1);
    if (!currentPassword || pending) return;
    setPending(true);
    setError('');
    try {
      onDone(await api(action.path, { method: action.method ?? 'POST', body: { currentPassword } }));
    } catch (err) {
      setError(err.message);
      setCurrentPassword('');
      setPending(false);
    }
  };

  return (
    <Dialog
      title={action.title}
      description={action.description}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} icon={false}>
            Cancel
          </Button>
          <Button type="submit" variant={action.danger ? 'danger' : 'primary'} icon={false} disabled={pending} aria-busy={pending}>
            {pending ? 'Working…' : action.label}
          </Button>
        </>
      }
    >
      {error && (
        <div role="alert" className="staff-dialog__alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      <ConfirmField value={currentPassword} onChange={setCurrentPassword} error={submits > 0 && !currentPassword ? 'Enter your password to confirm.' : undefined} hideKey={submits} />
    </Dialog>
  );
}

function TemporaryPasswordDialog({ person, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog
      title="Temporary password"
      description={`Give this to ${person} privately. They must replace it when they sign in.`}
      onClose={onClose}
      footer={
        <Button variant="primary" icon={false} onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="temp-password">
        <code className="temp-password__value">{password}</code>
        <Button icon={false} size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Notice tone="warning">This is shown once. Nobody can look it up again, but you can issue a new one.</Notice>
    </Dialog>
  );
}

function HistoryDialog({ person, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api(`/staff/${person.id}/history`, { signal: controller.signal })
      .then(({ history }) => setRows(history))
      .catch((err) => err.name !== 'AbortError' && setError(err.message));
    return () => controller.abort();
  }, [person.id]);

  return (
    <Dialog
      title={`History · ${person.name}`}
      description="The latest 50 sign-ins and account changes."
      onClose={onClose}
      footer={
        <Button variant="primary" icon={false} onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && <Notice tone="warning">{error}</Notice>}
      {!rows && !error && <p className="muted small">Loading…</p>}
      {rows && !rows.length && <p className="muted small">Nothing recorded yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="staff-history">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{HISTORY_LABELS[row.action] ?? row.action}</strong>
              <span className="muted small">
                {formatDateTime(row.createdAt)}
                {row.actorName && row.actorName !== person.name ? ` · by ${row.actorName}` : ''}
                {row.ip ? ` · ${row.ip}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export default function Staff() {
  const { user } = useAuth();
  const { notify } = useWorkspace();
  const [staff, setStaff] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // null, 'new', or a staff record
  const [action, setAction] = useState(null);
  const [temporary, setTemporary] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const { staff: rows } = await api('/staff');
      setStaff(rows);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = staff?.filter((s) => !s.deletedAt) ?? [];
  const trash = staff?.filter((s) => s.deletedAt) ?? [];
  const activeCount = current.filter((s) => s.status === 'active').length;
  const atLimit = activeCount >= MAX_ACTIVE;

  const confirmAction = (person, kind) => {
    const actions = {
      deactivate: {
        path: `/staff/${person.id}/deactivate`,
        title: `Deactivate ${person.name}?`,
        description: 'They’ll be signed out immediately and can’t sign in until reactivated.',
        label: 'Deactivate',
        danger: true,
        done: 'Account deactivated.',
      },
      reactivate: { path: `/staff/${person.id}/reactivate`, title: `Reactivate ${person.name}?`, label: 'Reactivate', done: 'Account reactivated.' },
      reset: {
        path: `/staff/${person.id}/reset-password`,
        title: `Issue a temporary password for ${person.name}?`,
        description: 'Their current password stops working, and all their devices are signed out.',
        label: 'Issue password',
        danger: true,
      },
      delete: {
        path: `/staff/${person.id}`,
        method: 'DELETE',
        title: `Move ${person.name} to the trash?`,
        description: 'They’ll be signed out, and their history is kept. You can restore the account later.',
        label: 'Move to trash',
        danger: true,
        done: 'Account moved to the trash.',
      },
      restore: {
        path: `/staff/${person.id}/restore`,
        title: `Restore ${person.name}?`,
        description: 'The account comes back inactive. Reactivate it when they need access.',
        label: 'Restore',
        done: 'Account restored as inactive.',
      },
    };
    setAction({ ...actions[kind], kind, person });
  };

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={staff ? `${activeCount} of ${MAX_ACTIVE} active logins in use.` : 'Admin logins and roles.'}
        action={
          <Button variant="primary" onClick={() => setEditing('new')} disabled={atLimit || !staff}>
            Add staff
          </Button>
        }
      />

      {loadError && (
        <div role="alert">
          <Notice tone="warning">{loadError}</Notice>
        </div>
      )}
      {atLimit && <Notice>All {MAX_ACTIVE} active logins are in use. Deactivate one to add someone new.</Notice>}

      <Panel title="Admin logins" meta={staff ? `${current.length} ${current.length === 1 ? 'account' : 'accounts'}` : 'Loading…'}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {current.map((person) => {
                const self = person.id === user.id;
                return (
                  <tr key={person.id}>
                    <td className="data-table__key staff-id">{person.staffNo}</td>
                    <td>
                      {person.name}
                      {self && ' (you)'}
                      <div className="data-table__sub">{person.email}</div>
                    </td>
                    <td>{ROLE_LABELS[person.role]}</td>
                    <td>
                      <span className="staff-status">
                        <StatusBadge tone={person.status === 'active' ? 'success' : 'tint'}>{person.status === 'active' ? 'Active' : 'Inactive'}</StatusBadge>
                        {person.locked && <StatusBadge tone="danger">Locked</StatusBadge>}
                        {person.mustChangePassword && <StatusBadge tone="warning">Temporary password</StatusBadge>}
                      </span>
                    </td>
                    <td>{formatDateTime(person.lastLoginAt)}</td>
                    <td>
                      <div className="staff-actions">
                        <button type="button" className="link-button small" onClick={() => setEditing(person)}>
                          Edit
                        </button>
                        <button type="button" className="link-button small" onClick={() => setHistory(person)}>
                          History
                        </button>
                        {!self && (
                          <>
                            <button type="button" className="link-button small" onClick={() => confirmAction(person, 'reset')}>
                              Reset password
                            </button>
                            {person.status === 'active' ? (
                              <button type="button" className="link-button small" onClick={() => confirmAction(person, 'deactivate')}>
                                Deactivate
                              </button>
                            ) : (
                              <button type="button" className="link-button small" disabled={atLimit} onClick={() => confirmAction(person, 'reactivate')}>
                                Reactivate
                              </button>
                            )}
                            <button type="button" className="link-button small" onClick={() => confirmAction(person, 'delete')}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {trash.length > 0 && (
        <Panel title="Trash" meta={`${trash.length} ${trash.length === 1 ? 'account' : 'accounts'}`}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff ID</th>
                  <th>Name</th>
                  <th>Deleted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {trash.map((person) => (
                  <tr key={person.id}>
                    <td className="data-table__key staff-id">{person.staffNo}</td>
                    <td>
                      {person.name}
                      <div className="data-table__sub">{person.email}</div>
                    </td>
                    <td>{formatDateTime(person.deletedAt)}</td>
                    <td>
                      <div className="staff-actions">
                        <button type="button" className="link-button small" onClick={() => confirmAction(person, 'restore')}>
                          Restore
                        </button>
                        <button type="button" className="link-button small" onClick={() => setHistory(person)}>
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <AnimatePresence>
        {editing && (
          <StaffDialog
            key="edit"
            person={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={(result) => {
              const wasNew = editing === 'new';
              setEditing(null);
              load();
              if (wasNew) setTemporary({ person: result.staff.name, password: result.temporaryPassword });
              else notify('Staff details saved.');
            }}
          />
        )}
        {action && (
          <ActionDialog
            key="action"
            action={action}
            onClose={() => setAction(null)}
            onDone={(result) => {
              const { kind, person, done } = action;
              setAction(null);
              load();
              if (kind === 'reset') setTemporary({ person: person.name, password: result.temporaryPassword });
              else notify(done);
            }}
          />
        )}
        {temporary && <TemporaryPasswordDialog key="temporary" person={temporary.person} password={temporary.password} onClose={() => setTemporary(null)} />}
        {history && <HistoryDialog key="history" person={history} onClose={() => setHistory(null)} />}
      </AnimatePresence>
    </>
  );
}
