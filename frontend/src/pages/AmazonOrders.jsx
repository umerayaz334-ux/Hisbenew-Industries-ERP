import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./AmazonOrders.css";

const EMPTY_SUMMARY = {
  order_count: 0,
  orders_today: 0,
  unit_count: 0,
  revenue: 0,
  pending_count: 0,
  unshipped_count: 0,
  partially_shipped_count: 0,
  shipped_count: 0,
  cancelled_count: 0,
  mapped_item_count: 0,
  unmapped_item_count: 0,
  orders_with_issues: 0,
};

const responseError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join(" ") || fallback;
  }
  return typeof detail === "string" && detail ? detail : fallback;
};

const number = (value) =>
  new Intl.NumberFormat().format(Number.isFinite(Number(value)) ? Number(value) : 0);

const money = (value, currency = "USD") => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(value || 0));
  } catch {
    return `${currency || "USD"} ${Number(value || 0).toFixed(2)}`;
  }
};

const formatDateTime = (value) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const statusTone = (status) => {
  if (["SHIPPED", "Completed"].includes(status)) return "is-success";
  if (["CANCELLED", "UNFULFILLABLE", "Failed", "Cancelled"].includes(status)) {
    return "is-error";
  }
  if (["PARTIALLY_SHIPPED", "Retrying"].includes(status)) return "is-warning";
  return "is-working";
};

function AmazonOrders({ authenticatedUser }) {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [jobs, setJobs] = useState([]);
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [mappingStatus, setMappingStatus] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const isAdmin = ["admin", "super_admin"].includes(authenticatedUser?.role);

  const loadOrders = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const response = await api.get("/amazon/orders", {
          params: {
            search: search || undefined,
            status: status || undefined,
            mapping_status: mappingStatus || undefined,
            issues_only: issuesOnly || undefined,
            limit: 500,
          },
        });
        setOrders(response.data?.items || []);
        setSummary(response.data?.summary || EMPTY_SUMMARY);
        setError("");
      } catch (loadError) {
        setError(responseError(loadError, "Amazon FBA orders could not be loaded."));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [issuesOnly, mappingStatus, search, status]
  );

  const loadReferenceData = useCallback(async () => {
    try {
      const [connectionResponse, jobResponse] = await Promise.all([
        api.get("/amazon/connection/status"),
        api.get("/amazon/orders/jobs", { params: { limit: 10 } }),
      ]);
      setConnection(connectionResponse.data || null);
      setJobs(jobResponse.data || []);
    } catch (loadError) {
      setError(
        responseError(
          loadError,
          "The Amazon FBA order workspace could not be initialized."
        )
      );
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => loadReferenceData(), 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadReferenceData]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => loadOrders(), 250);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadOrders]);

  const retryMapping = async (order) => {
    setBusy(`mapping-${order.id}`);
    setMessage("");
    setError("");
    try {
      const response = await api.post(
        `/amazon/orders/${encodeURIComponent(
          order.amazon_order_id
        )}/retry-mapping`
      );
      await loadOrders({ quiet: true });
      setMessage(
        `Product mapping checked: ${number(
          response.data?.mapped_items
        )} mapped, ${number(response.data?.unmapped_items)} unmapped.`
      );
    } catch (mappingError) {
      setError(responseError(mappingError, "Product mapping could not be retried."));
    } finally {
      setBusy("");
    }
  };

  const openHistory = async (order) => {
    setHistoryTarget(order);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await api.get(
        `/amazon/orders/${encodeURIComponent(order.amazon_order_id)}/history`
      );
      setHistory(response.data || []);
    } catch (historyError) {
      setError(responseError(historyError, "Order history could not be loaded."));
    } finally {
      setHistoryLoading(false);
    }
  };

  const cards = useMemo(
    () => [
      ["FBA orders", summary.order_count, `${summary.orders_today} today`],
      ["Units ordered", summary.unit_count, "Amazon fulfilled"],
      ["Revenue", money(summary.revenue, orders[0]?.currency), "Recent imported range"],
      ["Pending", summary.pending_count, "Amazon confirmation"],
      ["Unshipped", summary.unshipped_count, "Amazon processing"],
      ["Shipped", summary.shipped_count, "Completed by Amazon"],
      ["Unmapped items", summary.unmapped_item_count, "Needs product mapping"],
      ["Order issues", summary.orders_with_issues, "Needs review"],
    ],
    [orders, summary]
  );

  if (!isAdmin) {
    return (
      <main className="amazon-orders-page">
        <section className="amazon-orders-access">
          Amazon FBA orders are available to administrators only.
        </section>
      </main>
    );
  }

  return (
    <main className="amazon-orders-page">
      <header className="amazon-orders-header">
        <div>
          <span className="amazon-orders-eyebrow">
            Amazon Seller Central · Phase 4
          </span>
          <h1>FBA Orders</h1>
          <p>
            Read-only Amazon-fulfilled orders. No buyer addresses are requested,
            and these orders never reserve factory stock or enter factory
            picking, packing, shipping, or dispatch.
          </p>
        </div>
        <div className="amazon-orders-header-actions">
          <span
            className={`amazon-orders-connection ${
              connection?.connection_status === "Connected"
                ? "is-connected"
                : "is-offline"
            }`}
          >
            {connection?.connection_status || "Not configured"}
          </span>
          <span className="amazon-orders-safety">No customer PII</span>
        </div>
      </header>

      <div className="amazon-orders-content">
        {message ? (
          <div className="amazon-orders-notice is-success">{message}</div>
        ) : null}
        {error ? (
          <div className="amazon-orders-notice is-error">{error}</div>
        ) : null}

        <section className="amazon-orders-summary-grid">
          {cards.map(([label, value, detail]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{typeof value === "string" ? value : number(value)}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </section>

        <section className="amazon-orders-safety-strip">
          <div>
            <strong>Fulfillment channel: AMAZON</strong>
            <span>Amazon controls fulfillment and shipment status.</span>
          </div>
          <div>
            <strong>Factory workflow isolated</strong>
            <span>No ERP sales order, reservation, pick, pack, or dispatch record.</span>
          </div>
          <div>
            <strong>Non-restricted data only</strong>
            <span>Buyer and recipient datasets are not requested or stored.</span>
          </div>
        </section>

        <section className="amazon-orders-workspace">
          <div className="amazon-orders-section-heading">
            <div>
              <span className="amazon-orders-eyebrow">Order control</span>
              <h2>Recent Amazon-fulfilled orders</h2>
            </div>
            <span>
              Showing {number(orders.length)} of {number(summary.order_count)}
            </span>
          </div>

          <div className="amazon-orders-filters">
            <label>
              <span>Search</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order ID, Seller SKU, ASIN or product"
              />
            </label>
            <label>
              <span>Amazon status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="UNSHIPPED">Unshipped</option>
                <option value="PARTIALLY_SHIPPED">Partially shipped</option>
                <option value="SHIPPED">Shipped</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="UNFULFILLABLE">Unfulfillable</option>
              </select>
            </label>
            <label>
              <span>Product mapping</span>
              <select
                value={mappingStatus}
                onChange={(event) => setMappingStatus(event.target.value)}
              >
                <option value="">All mappings</option>
                <option value="Mapped">Mapped</option>
                <option value="Partially Mapped">Partially mapped</option>
                <option value="Unmapped">Unmapped</option>
              </select>
            </label>
            <label className="amazon-orders-check">
              <input
                type="checkbox"
                checked={issuesOnly}
                onChange={(event) => setIssuesOnly(event.target.checked)}
              />
              Issues only
            </label>
          </div>

          <div className="amazon-orders-table-wrap">
            {loading ? (
              <div className="amazon-orders-empty">Loading FBA orders…</div>
            ) : orders.length === 0 ? (
              <div className="amazon-orders-empty">
                No FBA orders match the selected filters. Import a controlled
                7–14 day range to begin.
              </div>
            ) : (
              <table className="amazon-orders-table">
                <thead>
                  <tr>
                    <th>Amazon order</th>
                    <th>Purchased</th>
                    <th>Status</th>
                    <th>Items</th>
                    <th>Order total</th>
                    <th>Product mapping</th>
                    <th>Last Amazon update</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <Fragment key={order.id}>
                      <tr>
                        <td>
                          <div className="amazon-orders-order-id">
                            <strong>{order.amazon_order_id}</strong>
                            <span>
                              {order.marketplace_name || order.marketplace_id}
                            </span>
                            <small>Fulfilled by Amazon</small>
                          </div>
                        </td>
                        <td>{formatDateTime(order.purchase_date)}</td>
                        <td>
                          <div className="amazon-orders-status-stack">
                            <span
                              className={`amazon-orders-status ${statusTone(
                                order.order_status
                              )}`}
                            >
                              {order.order_status.replaceAll("_", " ")}
                            </span>
                            <small>ERP view: {order.erp_status}</small>
                          </div>
                        </td>
                        <td>
                          <strong>{number(order.item_count)} lines</strong>
                          <small className="amazon-orders-cell-note">
                            {number(order.unit_count)} units
                          </small>
                        </td>
                        <td>
                          <strong>{money(order.order_total, order.currency)}</strong>
                          <small className="amazon-orders-cell-note">
                            Items {money(order.item_total, order.currency)}
                          </small>
                        </td>
                        <td>
                          <div className="amazon-orders-status-stack">
                            <span
                              className={`amazon-orders-mapping ${
                                order.mapping_status === "Mapped"
                                  ? "is-mapped"
                                  : "is-unmapped"
                              }`}
                            >
                              {order.mapping_status}
                            </span>
                            <small>
                              {number(order.mapped_item_count)} mapped ·{" "}
                              {number(order.unmapped_item_count)} unmapped
                            </small>
                          </div>
                        </td>
                        <td>{formatDateTime(order.last_amazon_update)}</td>
                        <td>
                          <div className="amazon-orders-actions">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedOrderId((current) =>
                                  current === order.id ? null : order.id
                                )
                              }
                            >
                              {expandedOrderId === order.id ? "Hide" : "Details"}
                            </button>
                            <button type="button" onClick={() => openHistory(order)}>
                              History
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedOrderId === order.id ? (
                        <tr
                          key={`${order.id}-details`}
                          className="amazon-orders-detail-row"
                        >
                          <td colSpan="8">
                            <div className="amazon-orders-detail">
                              <div className="amazon-orders-detail-heading">
                                <div>
                                  <strong>Order items</strong>
                                  <span>
                                    Shipment status: {order.shipment_status}
                                  </span>
                                </div>
                                {order.unmapped_item_count > 0 ? (
                                  <button
                                    type="button"
                                    disabled={busy === `mapping-${order.id}`}
                                    onClick={() => retryMapping(order)}
                                  >
                                    Retry product mapping
                                  </button>
                                ) : null}
                              </div>
                              {order.issues.length ? (
                                <div className="amazon-orders-issues">
                                  {order.issues.map((issue) => (
                                    <span
                                      key={`${issue.code}-${issue.amazon_order_item_id}`}
                                    >
                                      {issue.seller_sku
                                        ? `${issue.seller_sku}: `
                                        : ""}
                                      {issue.message}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <div className="amazon-orders-item-list">
                                {order.items.map((item) => (
                                  <article key={item.id}>
                                    <div>
                                      <strong>{item.seller_sku || "No Seller SKU"}</strong>
                                      <span>{item.title || "Amazon order item"}</span>
                                      <small>
                                        ASIN {item.asin || "—"} · Item{" "}
                                        {item.amazon_order_item_id}
                                      </small>
                                    </div>
                                    <dl>
                                      <div>
                                        <dt>Ordered</dt>
                                        <dd>{number(item.quantity_ordered)}</dd>
                                      </div>
                                      <div>
                                        <dt>Shipped</dt>
                                        <dd>{number(item.quantity_shipped)}</dd>
                                      </div>
                                      <div>
                                        <dt>Item total</dt>
                                        <dd>{money(item.item_price, item.currency)}</dd>
                                      </div>
                                      <div>
                                        <dt>ERP product</dt>
                                        <dd>{item.erp_sku || "Unmapped"}</dd>
                                      </div>
                                    </dl>
                                  </article>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="amazon-orders-jobs">
          <div className="amazon-orders-section-heading">
            <div>
              <span className="amazon-orders-eyebrow">Operational history</span>
              <h2>Recent order synchronization jobs</h2>
            </div>
          </div>
          {jobs.length === 0 ? (
            <div className="amazon-orders-empty is-compact">No order jobs yet.</div>
          ) : (
            <div className="amazon-orders-job-list">
              {jobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{job.job_type} #{job.id}</strong>
                    <span>{formatDateTime(job.created_at)}</span>
                    {job.error_message ? <small>{job.error_message}</small> : null}
                  </div>
                  <div>
                    <span
                      className={`amazon-orders-job-status ${statusTone(
                        job.status
                      )}`}
                    >
                      {job.status}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {historyTarget ? (
        <div
          className="amazon-orders-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHistoryTarget(null);
          }}
        >
          <section
            className="amazon-orders-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="amazon-order-history-title"
          >
            <header>
              <div>
                <span className="amazon-orders-eyebrow">Amazon status history</span>
                <h2 id="amazon-order-history-title">
                  {historyTarget.amazon_order_id}
                </h2>
              </div>
              <button type="button" onClick={() => setHistoryTarget(null)}>
                Close
              </button>
            </header>
            {historyLoading ? (
              <div className="amazon-orders-empty">Loading history…</div>
            ) : history.length === 0 ? (
              <div className="amazon-orders-empty">
                No status snapshots have been recorded.
              </div>
            ) : (
              <div className="amazon-orders-history-list">
                {history.map((snapshot) => (
                  <article key={snapshot.id}>
                    <span>{formatDateTime(snapshot.changed_at)}</span>
                    <div>
                      <strong>
                        {snapshot.previous_order_status || "Imported"}
                      </strong>
                      <span>→</span>
                      <strong>{snapshot.order_status}</strong>
                    </div>
                    <small>
                      ERP: {snapshot.previous_erp_status || "Imported"} →{" "}
                      {snapshot.erp_status}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default AmazonOrders;
