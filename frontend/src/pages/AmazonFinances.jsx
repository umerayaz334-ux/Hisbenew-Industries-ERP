import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./AmazonFinances.css";

const EMPTY_SUMMARY = {
  transaction_count: 0,
  product_revenue: 0,
  shipping_revenue: 0,
  amazon_fees: 0,
  refunds: 0,
  reimbursements: 0,
  net_proceeds: 0,
  estimated_profit: 0,
  unmatched_order_count: 0,
  unreconciled_count: 0,
};

const responseError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join(" ") || fallback;
  }
  return typeof detail === "string" && detail ? detail : fallback;
};

const money = (value, currency = "USD") => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch {
    return `${currency || "USD"} ${Number(value || 0).toFixed(2)}`;
  }
};

const dateTime = (value) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Never" : parsed.toLocaleString();
};

const tone = (status) => {
  const value = String(status || "").toLowerCase();
  if (["completed", "released", "reconciled"].includes(value)) return "is-success";
  if (["failed", "difference"].includes(value)) return "is-error";
  if (["retrying", "deferred", "expected"].includes(value)) return "is-warning";
  return "is-working";
};

function AmazonFinances({ authenticatedUser }) {
  const [transactions, setTransactions] = useState([]);
  const [transactionTypes, setTransactionTypes] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [profitability, setProfitability] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [settlementSummary, setSettlementSummary] = useState({});
  const [balance, setBalance] = useState({
    amount: null,
    total_amount: null,
    available_amount: null,
    deferred_amount: null,
    deferred_transaction_count: 0,
    currency: "USD",
    updated_at: null,
    error: null,
    stale: true,
  });
  const [issues, setIssues] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [connection, setConnection] = useState(null);
  const [tab, setTab] = useState("transactions");
  const [search, setSearch] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [transactionStatus, setTransactionStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupBy, setGroupBy] = useState("sku");
  const [selectedSettlements, setSelectedSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isAdmin = ["admin", "super_admin"].includes(authenticatedUser?.role);
  const currency = connection?.currency || "USD";

  const loadWorkspace = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const [
          transactionResponse,
          profitabilityResponse,
          settlementResponse,
          issueResponse,
          jobResponse,
          connectionResponse,
          balanceResponse,
        ] = await Promise.all([
          api.get("/amazon/finances/transactions", {
            params: {
              search: search || undefined,
              transaction_type: transactionType || undefined,
              status: transactionStatus || undefined,
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
              limit: 1000,
            },
          }),
          api.get("/amazon/finances/profitability", {
            params: {
              group_by: groupBy,
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
            },
          }),
          api.get("/amazon/finances/settlements"),
          api.get("/amazon/finances/reconciliation-issues"),
          api.get("/amazon/finances/jobs", { params: { limit: 10 } }),
          api.get("/amazon/connection/status"),
          api.get("/amazon/finances/balance"),
        ]);
        setTransactions(transactionResponse.data?.items || []);
        setTransactionTypes(transactionResponse.data?.transaction_types || []);
        setSummary(transactionResponse.data?.summary || EMPTY_SUMMARY);
        setProfitability(profitabilityResponse.data?.items || []);
        setSettlements(settlementResponse.data?.items || []);
        setSettlementSummary(settlementResponse.data?.summary || {});
        setIssues(issueResponse.data?.items || []);
        setJobs(jobResponse.data || []);
        setBalance(
          balanceResponse.data || {
            amount: null,
            total_amount: null,
            available_amount: null,
            deferred_amount: null,
            deferred_transaction_count: 0,
            currency: "USD",
            updated_at: null,
            error: null,
            stale: true,
          }
        );
        setConnection({
          ...(connectionResponse.data || {}),
          currency:
            transactionResponse.data?.currency ||
            settlementResponse.data?.currency ||
            "USD",
        });
        setError("");
      } catch (loadError) {
        setError(
          responseError(
            loadError,
            "The Amazon finance workspace could not be loaded."
          )
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [dateFrom, dateTo, groupBy, search, transactionStatus, transactionType]
  );

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => loadWorkspace(), 200);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadWorkspace]);

  const postSettlements = async () => {
    if (!selectedSettlements.length) {
      setError("Select at least one settlement with an actual payout.");
      return;
    }
    const confirmed = window.confirm(
      "Post the selected actual Amazon payouts to ERP Accounting? Existing settlement entries will be updated, not duplicated."
    );
    if (!confirmed) return;
    setBusy("post-accounting");
    setMessage("");
    setError("");
    try {
      const response = await api.post(
        "/amazon/finances/settlements/post-accounting",
        {
          settlement_ids: selectedSettlements,
          confirm_posting: true,
        }
      );
      setMessage(
        `${response.data?.posted || 0} settlement payout(s) posted to ${response.data?.account_name || "ERP Accounting"}.`
      );
      setSelectedSettlements([]);
      await loadWorkspace({ quiet: true });
    } catch (postError) {
      setError(
        responseError(postError, "The selected settlements could not be posted.")
      );
    } finally {
      setBusy("");
    }
  };

  const toggleSettlement = (settlementId) => {
    setSelectedSettlements((current) =>
      current.includes(settlementId)
        ? current.filter((id) => id !== settlementId)
        : [...current, settlementId]
    );
  };

  const selectedActualTotal = useMemo(
    () =>
      settlements
        .filter((row) => selectedSettlements.includes(row.id))
        .reduce((total, row) => total + Number(row.actual_amount || 0), 0),
    [selectedSettlements, settlements]
  );

  if (!isAdmin) {
    return (
      <div className="amazon-finances-page">
        <div className="amazon-finances-state is-error">
          Only administrators can access Amazon financial data.
        </div>
      </div>
    );
  }

  return (
    <div className="amazon-finances-page">
      <header className="amazon-finances-top-bar">
        <div className="amazon-finances-top-title">
          <h1>📈 Amazon Finances</h1>
          <span className={`amazon-finances-badge ${tone(connection?.connection_status)}`}>
            ● {connection?.connection_status || "Not configured"}
          </span>
        </div>
        <div className="amazon-finances-top-meta">
          {jobs[0] && (
            <small>
              Synced {dateTime(jobs[0].completed_at || jobs[0].created_at)}
            </small>
          )}
        </div>
      </header>

      {message && <div className="amazon-finances-notice is-success">{message}</div>}
      {error && <div className="amazon-finances-notice is-error">{error}</div>}

      {/* Single Sleek Executive Summary Strip — No Card Noise */}
      <section className="amazon-finances-exec-bar">
        <div className="amazon-finances-exec-block is-primary">
          <span className="amazon-finances-exec-label">Total Balance</span>
          <strong className="amazon-finances-exec-value">
            {(balance.total_amount ?? balance.amount) == null
              ? "Not synced"
              : money(
                  balance.total_amount ?? balance.amount,
                  balance.currency || currency
                )}
          </strong>
          <div className="amazon-finances-exec-sub">
            <span>Avail: <strong>{money(balance.available_amount || 0, currency)}</strong></span>
            <span className="dot">•</span>
            <span>Deferred: <strong>{money(balance.deferred_amount || 0, currency)}</strong></span>
          </div>
        </div>

        <div className="amazon-finances-exec-divider" />

        <div className="amazon-finances-exec-strip">
          <div className="amazon-finances-exec-item">
            <span>Product Revenue</span>
            <strong className="is-blue">{money(summary.product_revenue, currency)}</strong>
          </div>
          <div className="amazon-finances-exec-item">
            <span>Amazon Fees</span>
            <strong className="is-red">-{money(summary.amazon_fees, currency)}</strong>
          </div>
          <div className="amazon-finances-exec-item">
            <span>Refunds</span>
            <strong className="is-red">-{money(summary.refunds, currency)}</strong>
          </div>
          <div className="amazon-finances-exec-item">
            <span>Net Proceeds</span>
            <strong className="is-green">{money(summary.net_proceeds, currency)}</strong>
          </div>
        </div>

        <div className="amazon-finances-exec-divider" />

        <div className="amazon-finances-exec-block is-highlight">
          <span className="amazon-finances-exec-label">Est. Profit Margin</span>
          <strong className="amazon-finances-exec-value is-indigo">
            {money(summary.estimated_profit, currency)}
          </strong>
          <small className="amazon-finances-exec-badge">
            {issues.length > 0 ? `⚠️ ${issues.length} audit issues` : "✓ Reconciled"}
          </small>
        </div>
      </section>

      <section className="amazon-finances-workspace">
        <div className="amazon-finances-tabs">
          {[
            ["transactions", "Transactions", transactions.length],
            ["profitability", "Profitability", profitability.length],
            ["settlements", "Settlements", settlements.length],
            ["issues", "Reconciliation", issues.length],
          ].map(([value, label, count]) => (
            <button
              key={value}
              className={tab === value ? "is-active" : ""}
              onClick={() => setTab(value)}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>

        <div className="amazon-finances-filters">
          {tab === "transactions" && (
            <>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order ID, transaction, SKU, ASIN, settlement…"
              />
              <select
                value={transactionType}
                onChange={(event) => setTransactionType(event.target.value)}
              >
                <option value="">All transaction types</option>
                {transactionTypes.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                value={transactionStatus}
                onChange={(event) => setTransactionStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="RELEASED">Released</option>
                <option value="DEFERRED">Deferred</option>
                <option value="DEFERRED_RELEASED">Deferred released</option>
              </select>
            </>
          )}
          {tab === "profitability" && (
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="sku">Group by Seller SKU</option>
              <option value="asin">Group by ASIN</option>
              <option value="order">Group by Amazon order</option>
              <option value="marketplace">Group by marketplace</option>
              <option value="date">Group by date</option>
            </select>
          )}
          {["transactions", "profitability"].includes(tab) && (
            <>
              <label>
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
            </>
          )}
        </div>

        {loading ? (
          <div className="amazon-finances-state">Loading Amazon finances…</div>
        ) : tab === "transactions" ? (
          <div className="amazon-finances-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date / transaction</th>
                  <th>Order / SKU</th>
                  <th>Type</th>
                  <th>Revenue</th>
                  <th>Fees</th>
                  <th>Refund / reimbursement</th>
                  <th>Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{dateTime(row.transaction_date)}</strong>
                      <small>{row.transaction_id}</small>
                    </td>
                    <td>
                      <strong>{row.amazon_order_id || "No order reference"}</strong>
                      <small>{row.seller_sku || row.asin || "Transaction level"}</small>
                    </td>
                    <td>
                      {row.transaction_type}
                      <small>{row.settlement_reference || "Settlement pending"}</small>
                    </td>
                    <td>{money(Number(row.product_revenue) + Number(row.shipping_revenue), row.currency)}</td>
                    <td className="is-negative">{money(row.amazon_fees, row.currency)}</td>
                    <td>
                      <span className="is-negative">{money(row.refund_amount, row.currency)}</span>
                      <small className="is-positive">
                        +{money(row.reimbursement_amount, row.currency)}
                      </small>
                    </td>
                    <td>
                      <strong>{money(row.net_amount, row.currency)}</strong>
                      <small>Profit {money(row.estimated_profit, row.currency)}</small>
                    </td>
                    <td>
                      <span className={`amazon-finances-badge ${tone(row.transaction_status)}`}>
                        {row.transaction_status}
                      </span>
                      {!row.order_matched && row.amazon_order_id && (
                        <small className="is-negative">Order unmatched</small>
                      )}
                    </td>
                  </tr>
                ))}
                {!transactions.length && (
                  <tr>
                    <td colSpan="8" className="amazon-finances-empty">
                      No financial transactions match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "profitability" ? (
          <div className="amazon-finances-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{groupBy}</th>
                  <th>Transactions / units</th>
                  <th>Revenue</th>
                  <th>Amazon fees</th>
                  <th>Refunds</th>
                  <th>ERP product cost</th>
                  <th>Net proceeds</th>
                  <th>Estimated profit</th>
                </tr>
              </thead>
              <tbody>
                {profitability.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.label}</strong></td>
                    <td>
                      {Number(row.transaction_count || 0).toLocaleString()}
                      <small>{Number(row.unit_count || 0).toLocaleString()} units</small>
                    </td>
                    <td>{money(Number(row.product_revenue) + Number(row.shipping_revenue), row.currency)}</td>
                    <td className="is-negative">{money(row.amazon_fees, row.currency)}</td>
                    <td className="is-negative">{money(row.refunds, row.currency)}</td>
                    <td>{money(row.product_cost, row.currency)}</td>
                    <td>{money(row.net_proceeds, row.currency)}</td>
                    <td>
                      <strong className={Number(row.estimated_profit) >= 0 ? "is-positive" : "is-negative"}>
                        {money(row.estimated_profit, row.currency)}
                      </strong>
                      <small>
                        {Number(row.margin_percent || 0).toFixed(1)}% margin
                        {!row.profit_complete
                          ? ` · ${row.unmapped_line_count} line(s) missing ERP cost`
                          : ""}
                      </small>
                    </td>
                  </tr>
                ))}
                {!profitability.length && (
                  <tr>
                    <td colSpan="8" className="amazon-finances-empty">
                      Run a finance sync to build profitability.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : tab === "settlements" ? (
          <>
            <div className="amazon-finances-settlement-action">
              <span>
                {selectedSettlements.length} selected · {money(selectedActualTotal, currency)}
              </span>
              <button
                disabled={!selectedSettlements.length || Boolean(busy)}
                onClick={postSettlements}
              >
                {busy === "post-accounting" ? "Posting…" : "Post actual payouts to Accounting"}
              </button>
            </div>
            <div className="amazon-finances-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Select" />
                    <th>Settlement</th>
                    <th>Period</th>
                    <th>Expected</th>
                    <th>Actual</th>
                    <th>Difference</th>
                    <th>Status</th>
                    <th>ERP entry</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedSettlements.includes(row.id)}
                          disabled={!Number(row.actual_amount)}
                          onChange={() => toggleSettlement(row.id)}
                        />
                      </td>
                      <td>
                        <strong>{row.settlement_reference}</strong>
                        <small>{row.transaction_count} transactions</small>
                      </td>
                      <td>
                        {dateTime(row.latest_transaction_date)}
                        <small>Started {dateTime(row.first_transaction_date)}</small>
                      </td>
                      <td>{money(row.expected_amount, row.currency)}</td>
                      <td>{money(row.actual_amount, row.currency)}</td>
                      <td className={Math.abs(Number(row.difference_amount)) > 0.01 ? "is-negative" : "is-positive"}>
                        {money(row.difference_amount, row.currency)}
                      </td>
                      <td>
                        <span className={`amazon-finances-badge ${tone(row.settlement_status)}`}>
                          {row.settlement_status}
                        </span>
                      </td>
                      <td>{row.erp_accounting_entry_id ? `#${row.erp_accounting_entry_id}` : "Not posted"}</td>
                    </tr>
                  ))}
                  {!settlements.length && (
                    <tr>
                      <td colSpan="8" className="amazon-finances-empty">
                        Settlement references will appear after Amazon supplies them.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="amazon-finances-issues">
            {issues.map((issue) => (
              <article key={issue.key} className={`is-${issue.severity}`}>
                <div>
                  <strong>{issue.issue_type}</strong>
                  <span>{issue.reference}</span>
                </div>
                <p>{issue.detail}</p>
                {issue.transaction_id && <small>{issue.transaction_id}</small>}
              </article>
            ))}
            {!issues.length && (
              <div className="amazon-finances-state is-success">
                No finance reconciliation issues found.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="amazon-finances-jobs">
        <div>
          <p className="amazon-finances-eyebrow">Audit & recovery</p>
          <h2>Recent finance sync jobs</h2>
        </div>
        <div className="amazon-finances-job-list">
          {jobs.map((job) => (
            <article key={job.id}>
              <div>
                <strong>Job #{job.id}</strong>
                <span>{dateTime(job.created_at)}</span>
              </div>
              <span className={`amazon-finances-badge ${tone(job.status)}`}>{job.status}</span>
              <span>
                {job.response_summary?.imported !== undefined
                  ? `${job.response_summary.imported} transactions`
                  : job.error_message || "Waiting for result"}
              </span>
            </article>
          ))}
          {!jobs.length && <p>No finance sync jobs yet.</p>}
        </div>
      </section>
    </div>
  );
}

export default AmazonFinances;
