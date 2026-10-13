import { useState } from "react";
import "./Pagination.css";

export function usePagination(items, pageSize = 20) {
  const key = items.map((item) => item.id).join(",");
  const [position, setPosition] = useState({ key, page: 1 });
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = position.key === key ? Math.min(position.page, totalPages) : 1;
  const setPage = (next) => setPosition({ key, page: Math.max(1, Math.min(next, totalPages)) });
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, setPage, totalPages, total: items.length, pageSize };
}

export default function Pagination({ pagination, label = "Records" }) {
  const { page, setPage, totalPages, total, pageSize } = pagination;
  if (!total) return null;
  const pages = [...new Set([1, 2, 3, page, totalPages])]
    .filter((number) => number <= totalPages)
    .sort((a, b) => a - b);
  return <nav className="record-pagination" aria-label={`${label} pagination`}>
    <span className="record-pagination-count">{(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}</span>
    <div className="record-pagination-buttons">
      <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">&larr;</button>
      {pages.flatMap((number, index) => [
        index > 0 && number - pages[index - 1] > 1
          ? <span key={`gap-${number}`} aria-hidden="true">&hellip;</span>
          : null,
        <button type="button" key={number} aria-label={`Page ${number}`} aria-current={number === page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>,
      ])}
      <button type="button" disabled={page === totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">&rarr;</button>
    </div>
  </nav>;
}
