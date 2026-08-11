import React, { useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./WorkerLedgerModal.css";

const formatCurrency = (value) =>
  `Rs. ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  })}`;

const getTaskEarning = (task) =>
  Number(
    task.labor_cost ||
      Number(task.completed_quantity || task.assigned_quantity || 0) *
        Number(task.rate_per_piece || 0)
  );

export function buildWorkerLedgerEntries(workerId, tasks, payments) {
  if (!workerId) return { entries: [], totalEarned: 0, totalPaid: 0, balance: 0 };

  const taskEntries = (tasks || [])
    .filter((task) => {
      const wId = String(task.worker_id || task.assigned_worker_id || "");
      const statusLower = String(task.status || "").toLowerCase();
      const isDone = statusLower === "completed" || statusLower === "verified";
      return wId === String(workerId) && isDone;
    })
    .map((task) => {
      const earned = getTaskEarning(task);
      const qty = Number(task.completed_quantity || task.assigned_quantity || 1);
      const rate = Number(task.rate_per_piece || 0);
      const rawDate = task.completed_at || task.actual_completion_time || task.updated_at || task.created_at;

      return {
        id: `task-${task.id}`,
        rawDate,
        dateFormatted: rawDate ? formatUtcLocal(rawDate) : "Completed job",
        type: "job",
        typeLabel: "Job Completed",
        title: task.step_name || "Production step",
        subtitle: `${task.source_type === "Order" ? "Order: " : ""}${
          task.product_name || task.custom_product_name || task.article_no || "Custom work"
        }`,
        quantity: qty,
        rate: rate,
        earned: earned,
        paid: 0,
        note: task.notes || task.delay_reason || "",
      };
    });

  const paymentEntries = (payments || [])
    .filter((payment) => String(payment.worker_id) === String(workerId))
    .map((payment) => {
      const amount = Number(payment.amount || 0);
      const rawDate = payment.paid_at || payment.created_at;

      return {
        id: `payment-${payment.id}`,
        rawDate,
        dateFormatted: rawDate ? formatUtcLocal(rawDate) : "Payout",
        type: "payout",
        typeLabel: "Payout Recorded",
        title: `Payout via ${payment.payment_method || "Cash"}`,
        subtitle: payment.payment_reference
          ? `Ref: ${payment.payment_reference}`
          : "Direct payment",
        quantity: null,
        rate: null,
        earned: 0,
        paid: amount,
        note: payment.note || "",
      };
    });

  const sortedEntries = [...taskEntries, ...paymentEntries].sort((a, b) => {
    const timeA = a.rawDate ? new Date(a.rawDate).getTime() : 0;
    const timeB = b.rawDate ? new Date(b.rawDate).getTime() : 0;
    return timeA - timeB;
  });

  let runningBalance = 0;
  let totalEarned = 0;
  let totalPaid = 0;

  const entriesWithBalance = sortedEntries.map((entry) => {
    totalEarned += entry.earned;
    totalPaid += entry.paid;
    runningBalance = runningBalance + entry.earned - entry.paid;
    return {
      ...entry,
      runningBalance,
    };
  });

  return {
    entries: entriesWithBalance,
    totalEarned,
    totalPaid,
    balance: runningBalance,
  };
}

export default function WorkerLedgerModal({
  worker,
  workers = [],
  tasks = [],
  payments = [],
  onClose,
  onRecordPayout,
  onSelectWorker,
}) {
  const [fetchedTasks, setFetchedTasks] = useState([]);
  const [fetchedPayments, setFetchedPayments] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const currentWorkerId = worker?.id;

  useEffect(() => {
    if (!currentWorkerId) return;

    if (tasks.length === 0 || payments.length === 0) {
      setLoadingData(true);
      Promise.all([
        api.get("/production/tasks").catch(() => ({ data: [] })),
        api.get("/order-workflow/tasks").catch(() => ({ data: [] })),
        api.get("/worker-payments").catch(() => ({ data: [] })),
      ])
        .then(([prodRes, orderRes, payRes]) => {
          const prodTasks = prodRes.data || [];
          const orderTasks = orderRes.data || [];
          setFetchedTasks([...prodTasks, ...orderTasks]);
          setFetchedPayments(payRes.data || []);
        })
        .finally(() => {
          setLoadingData(false);
        });
    }
  }, [currentWorkerId, tasks.length, payments.length]);

  const activeTasks = tasks.length > 0 ? tasks : fetchedTasks;
  const activePayments = payments.length > 0 ? payments : fetchedPayments;

  const ledgerData = useMemo(
    () => buildWorkerLedgerEntries(currentWorkerId, activeTasks, activePayments),
    [currentWorkerId, activeTasks, activePayments]
  );

  const filteredEntries = useMemo(() => {
    let result = [...ledgerData.entries];

    if (filterType === "jobs") {
      result = result.filter((e) => e.type === "job");
    } else if (filterType === "payouts") {
      result = result.filter((e) => e.type === "payout");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.subtitle.toLowerCase().includes(q) ||
          e.note.toLowerCase().includes(q) ||
          e.typeLabel.toLowerCase().includes(q)
      );
    }

    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      result = result.filter((e) => e.rawDate && new Date(e.rawDate).getTime() >= fromTime);
    }

    if (dateTo) {
      const toTime = new Date(dateTo).setHours(23, 59, 59, 999);
      result = result.filter((e) => e.rawDate && new Date(e.rawDate).getTime() <= toTime);
    }

    return result.reverse();
  }, [ledgerData.entries, filterType, searchQuery, dateFrom, dateTo]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="worker-ledger-modal-overlay" onClick={onClose}>
      <div className="worker-ledger-modal" onClick={(e) => e.stopPropagation()}>
        {/* Printable Statement Header */}
        <div className="wlm-header">
          <div>
            <span className="wlm-kicker">Worker Account Statement</span>
            <div className="wlm-worker-selector-wrap">
              {workers.length > 0 && onSelectWorker ? (
                <select
                  className="wlm-worker-select"
                  value={currentWorkerId}
                  onChange={(e) => {
                    const selected = workers.find((w) => String(w.id) === e.target.value);
                    if (selected) onSelectWorker(selected);
                  }}
                >
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.role || "Worker"})
                    </option>
                  ))}
                </select>
              ) : (
                <h2>{worker?.name || "Worker Ledger"}</h2>
              )}
            </div>
            <p className="wlm-sub">
              {worker?.role || "Worker"} • {worker?.phone || "No phone"} • Rate:{" "}
              {worker?.rate_per_piece ? formatCurrency(worker.rate_per_piece) + "/pc" : "Standard"}
            </p>
          </div>

          <div className="wlm-header-actions">
            <button className="wlm-btn wlm-btn-secondary" onClick={handlePrint} type="button">
              Print Statement
            </button>
            <button className="wlm-close-btn" onClick={onClose} type="button">
              ✕
            </button>
          </div>
        </div>

        {/* Statement KPI Cards */}
        <div className="wlm-summary-cards">
          <div className="wlm-card wlm-card-earned">
            <span>Total Earned (Completed Jobs)</span>
            <strong>{formatCurrency(ledgerData.totalEarned)}</strong>
            <small>{ledgerData.entries.filter((e) => e.type === "job").length} completed jobs</small>
          </div>

          <div className="wlm-card wlm-card-paid">
            <span>Total Paid (Payouts Recorded)</span>
            <strong>{formatCurrency(ledgerData.totalPaid)}</strong>
            <small>{ledgerData.entries.filter((e) => e.type === "payout").length} payouts made</small>
          </div>

          <div
            className={`wlm-card wlm-card-balance ${
              ledgerData.balance > 0 ? "is-payable" : ledgerData.balance < 0 ? "is-advance" : "is-clear"
            }`}
          >
            <span>Remaining Account Balance</span>
            <strong>{formatCurrency(Math.abs(ledgerData.balance))}</strong>
            <small>
              {ledgerData.balance > 0
                ? "Net payable to worker"
                : ledgerData.balance < 0
                ? "Advance balance held"
                : "Account fully settled"}
            </small>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="wlm-toolbar">
          <div className="wlm-type-tabs">
            <button
              className={filterType === "all" ? "is-active" : ""}
              onClick={() => setFilterType("all")}
              type="button"
            >
              All Transactions ({ledgerData.entries.length})
            </button>
            <button
              className={filterType === "jobs" ? "is-active" : ""}
              onClick={() => setFilterType("jobs")}
              type="button"
            >
              Jobs Earned ({ledgerData.entries.filter((e) => e.type === "job").length})
            </button>
            <button
              className={filterType === "payouts" ? "is-active" : ""}
              onClick={() => setFilterType("payouts")}
              type="button"
            >
              Payouts Made ({ledgerData.entries.filter((e) => e.type === "payout").length})
            </button>
          </div>

          <div className="wlm-filter-inputs">
            <input
              className="wlm-search-input"
              placeholder="Search statement..."
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <input
              className="wlm-date-input"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              className="wlm-date-input"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {/* Ledger Statement Table */}
        <div className="wlm-table-wrap">
          {loadingData ? (
            <div style={{ textAlign: "center", padding: "3rem" }}>Loading statement transactions...</div>
          ) : filteredEntries.length === 0 ? (
            <div className="wlm-empty-state">
              <h3>No statement transactions found</h3>
              <p>Completed jobs and recorded payouts for this worker will appear here.</p>
            </div>
          ) : (
            <table className="wlm-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Transaction Description</th>
                  <th>Quantity & Rate</th>
                  <th style={{ textAlign: "right" }}>Earned (+)</th>
                  <th style={{ textAlign: "right" }}>Paid (-)</th>
                  <th style={{ textAlign: "right" }}>Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className={`wlm-row-${entry.type}`}>
                    <td className="wlm-date-cell">{entry.dateFormatted}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span className={`wlm-badge wlm-badge-${entry.type}`}>{entry.typeLabel}</span>
                        <strong className="wlm-entry-title">{entry.title}</strong>
                      </div>
                      <span className="wlm-entry-sub">{entry.subtitle}</span>
                      {entry.note && <small className="wlm-entry-note">Note: {entry.note}</small>}
                    </td>
                    <td>
                      {entry.quantity !== null && (
                        <>
                          {entry.quantity} pcs @ {formatCurrency(entry.rate)}/pc
                        </>
                      )}
                    </td>
                    <td className="wlm-num-cell">
                      {entry.earned > 0 ? (
                        <span className="wlm-earned-val">+{formatCurrency(entry.earned)}</span>
                      ) : (
                        <span className="wlm-muted">—</span>
                      )}
                    </td>
                    <td className="wlm-num-cell">
                      {entry.paid > 0 ? (
                        <span className="wlm-paid-val">-{formatCurrency(entry.paid)}</span>
                      ) : (
                        <span className="wlm-muted">—</span>
                      )}
                    </td>
                    <td className="wlm-num-cell">
                      <strong className="wlm-balance-val">
                        {formatCurrency(Math.abs(entry.runningBalance))}
                        <small style={{ fontWeight: "normal", color: "#64748b", marginLeft: "4px" }}>
                          {entry.runningBalance > 0
                            ? "(Owed)"
                            : entry.runningBalance < 0
                            ? "(Adv)"
                            : "(Clear)"}
                        </small>
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
