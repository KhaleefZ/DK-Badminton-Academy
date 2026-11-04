import { useEffect, useState } from 'react';

export function usePagination(rows, pageSize = 8) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    pageCount,
    setPage,
    rows: rows.slice(start, start + pageSize),
    from: rows.length ? start + 1 : 0,
    to: Math.min(start + pageSize, rows.length),
    total: rows.length,
  };
}

export default function Pagination({ pager, noun = 'records' }) {
  const { page, pageCount, setPage, from, to, total } = pager;
  return (
    <div className="pagination">
      <p className="pagination__summary">
        Showing {from}–{to} of {total} {noun}
      </p>
      <nav className="pagination__controls" aria-label="Pagination">
        <button type="button" className="btn btn--ghost btn--md" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={`pagination__page${n === page ? ' is-current' : ''}`}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => setPage(n)}
          >
            {n}
          </button>
        ))}
        <button type="button" className="btn btn--ghost btn--md" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </div>
  );
}
