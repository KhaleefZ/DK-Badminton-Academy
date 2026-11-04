import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../components/Dialog';
import Notice from '../components/Notice';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';
import { formatDate, formatPaise } from '../lib/format';

const EMPTY = { customers: [], bookings: [], receipts: [], enquiries: [], memberships: [] };

/** Global search across customers, bookings and receipts, opened from the top bar. */
export default function SearchDialog({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const q = query.trim();

  useEffect(() => {
    if (!q) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((found) => {
          setResults(found);
          setError('');
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setError(err.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const { customers, bookings, receipts, enquiries, memberships } = results ?? EMPTY;

  return (
    // Search opens instantly: it's a "get me there now" action, so motion would only delay it.
    <Dialog title="Search" onClose={onClose} animated={false}>
      <input
        className="field__control"
        type="search"
        autoFocus
        placeholder="Name, phone, email, or any customer, member, booking or receipt number"
        aria-label="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <Notice tone="warning">{error}</Notice>}
      {q && results && (
        <div className="search-results">
          <p className="search-results__group">Customers</p>
          {customers.length ? (
            customers.map((c) => (
              <Link key={c.id} to={`/customers?selected=${c.id}`} onClick={onClose} className="search-results__item">
                <span>
                  <strong>{c.customerNo}</strong> · {c.name} · {c.phone}
                </span>
              </Link>
            ))
          ) : (
            <p className="search-results__empty">No customers match.</p>
          )}
          <p className="search-results__group">Bookings</p>
          {bookings.length ? (
            bookings.map((b) => (
              <Link key={b.id} to={`/bookings/records/${b.bookingNo}`} onClick={onClose} className="search-results__item">
                <span>
                  <strong>{b.bookingNo}</strong> · {b.customer.name} · {formatDate(b.date)} · {b.start}–{b.end}
                </span>
                <StatusBadge status={b.paymentState} />
              </Link>
            ))
          ) : (
            <p className="search-results__empty">No bookings match.</p>
          )}
          {receipts.length > 0 && <p className="search-results__group">Receipts</p>}
          {receipts.map((r) => (
            <Link key={r.id} to={r.bookingNo ? `/bookings/records/${r.bookingNo}` : `/payments?receipt=${r.receiptNo}`} onClick={onClose} className="search-results__item">
              <span>
                <strong>{r.receiptNo}</strong> · {r.bookingNo ?? 'Membership'} · {formatPaise(r.amountPaise)}
              </span>
            </Link>
          ))}
          {memberships.length > 0 && <p className="search-results__group">Memberships</p>}
          {memberships.map((m) => (
            <Link key={m.id} to={`/memberships?selected=${m.id}`} onClick={onClose} className="search-results__item">
              <span>
                <strong>{m.membershipNo}</strong> · {m.holderName} · until {formatDate(m.endsOn)}
              </span>
            </Link>
          ))}
          {enquiries.length > 0 && <p className="search-results__group">Enquiries</p>}
          {enquiries.map((e) => (
            <Link key={e.id} to={`/enquiries?selected=${e.id}`} onClick={onClose} className="search-results__item">
              <span>
                <strong>{e.enquiryNo}</strong> · {e.name}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Dialog>
  );
}
