import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./AmazonFbaInventory.css";

const EMPTY_SUMMARY = {
  sku_count: 0,
  fulfillable_quantity: 0,
  inbound_quantity: 0,
  reserved_quantity: 0,
  unfulfillable_quantity: 0,
  researching_quantity: 0,
  total_quantity: 0,
  low_stock_count: 0,
  discrepancy_count: 0,
  mapped_count: 0,
  unmapped_count: 0,
};

const responseError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join(" ") || fallback;
  }
  return typeof detail === "string" && detail ? detail : fallback;
};

const quantity = (value) =>
  new Intl.NumberFormat().format(Number.isFinite(Number(value)) ? Number(value) : 0);

const formatDateTime = (value) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const jobTone = (status) => {
  if (status === "Completed") return "is-success";
  if (["Failed", "Cancelled"].includes(status)) return "is-error";
  if (status === "Retrying") return "is-warning";
  return "is-working";
};

function QuantityDetail({ total, parts }) {
  return (
    <div className="amazon-fba-quantity">
      <strong>{quantity(total)}</strong>
      <small>{parts}</small>
    </div>
  );
}

function AmazonFbaInventory({ authenticatedUser, embedded = false }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [jobs, setJobs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [mappedOnly, setMappedOnly] = useState(false);
  const [discrepanciesOnly, setDiscrepanciesOnly] = useState(false);
  const [activeView, setActiveView] = useState("inventory");
  const [historyTarget, setHistoryTarget] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [thresholdDrafts, setThresholdDrafts] = useState({});
  const isAdmin = ["admin", "super_admin"].includes(authenticatedUser?.role);

  const loadInventory = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const response = await api.get("/amazon/fba/inventory", {
          params: {
            search: search || undefined,
            low_stock_only: lowStockOnly || undefined,
            mapped_only: mappedOnly || undefined,
            discrepancies_only: discrepanciesOnly || undefined,
            limit: 500,
          },
        });
        setItems(response.data?.items || []);
        setSummary(response.data?.summary || EMPTY_SUMMARY);
        setError("");
      } catch (loadError) {
        setError(
          responseError(loadError, "Amazon FBA inventory could not be loaded.")
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [discrepanciesOnly, lowStockOnly, mappedOnly, search]
  );

  const loadReferenceData = useCallback(async () => {
    try {
      const [connectionResponse, locationResponse, jobResponse] =
        await Promise.all([
          api.get("/amazon/connection/status"),
          api.get("/amazon/fba/inventory/locations"),
          api.get("/amazon/fba/inventory/jobs", { params: { limit: 10 } }),
        ]);
      setConnection(connectionResponse.data || null);
      setLocations(locationResponse.data || []);
      setJobs(jobResponse.data || []);
    } catch (loadError) {
      setError(
        responseError(
          loadError,
          "The Amazon FBA inventory workspace could not be initialized."
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
    const timer = window.setTimeout(() => loadInventory(), 250);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadInventory]);

  const openHistory = async (item) => {
    setHistoryTarget(item);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await api.get(
        `/amazon/fba/inventory/${item.id}/history`,
        { params: { limit: 100 } }
      );
      setHistory(response.data || []);
    } catch (historyError) {
      setError(responseError(historyError, "Inventory history could not be loaded."));
    } finally {
      setHistoryLoading(false);
    }
  };

  const saveThreshold = async (item) => {
    const rawValue = thresholdDrafts[item.id] ?? item.minimum_fba_quantity;
    const minimum = Number(rawValue);
    if (!Number.isInteger(minimum) || minimum < 0) {
      setError("Minimum FBA quantity must be a whole number of zero or more.");
      return;
    }
    setBusy(`threshold-${item.id}`);
    setMessage("");
    setError("");
    try {
      await api.patch(`/amazon/fba/inventory/${item.id}/threshold`, {
        minimum_fba_quantity: minimum,
      });
      await loadInventory({ quiet: true });
      setMessage(`Low-stock threshold saved for ${item.seller_sku}.`);
    } catch (thresholdError) {
      setError(
        responseError(thresholdError, "The low-stock threshold could not be saved.")
      );
    } finally {
      setBusy("");
    }
  };

  const summaryCards = useMemo(
    () => [
      ["FBA SKUs", summary.sku_count, `${summary.mapped_count} mapped`],
      ["Fulfillable", summary.fulfillable_quantity, "Available at Amazon"],
      ["Inbound", summary.inbound_quantity, "Working, shipped, receiving"],
      ["Reserved", summary.reserved_quantity, "Amazon-controlled"],
      ["Unfulfillable", summary.unfulfillable_quantity, "Includes damaged units"],
      ["Researching", summary.researching_quantity, "Under Amazon review"],
      ["Low stock", summary.low_stock_count, "At or below minimum"],
      ["Discrepancies", summary.discrepancy_count, "Needs reconciliation"],
    ],
    [summary]
  );

  if (!isAdmin) {
    return (
      <main className={`amazon-fba-page ${embedded ? "is-embedded" : ""}`}>
        <section className="amazon-fba-access">
          Amazon FBA inventory is available to administrators only.
        </section>
      </main>
    );
  }

  return (
    <main className={`amazon-fba-page ${embedded ? "is-embedded" : ""}`}>
      <header className="amazon-fba-header">
        <div>
          <span className="amazon-fba-eyebrow">Amazon Seller Central · Phase 3</span>
          <h1>FBA Inventory</h1>
          <p>
            Amazon is the source of truth for every FBA balance. Factory and USA
            quantities remain separate and are never overwritten by this sync.
          </p>
        </div>
        <div className="amazon-fba-header-actions">
          <span
            className={`amazon-fba-connection ${
              connection?.connection_status === "Connected"
                ? "is-connected"
                : "is-offline"
            }`}
          >
            {connection?.connection_status || "Not configured"}
          </span>
          <span className="amazon-fba-readonly">FBA quantities read-only</span>
        </div>
      </header>

      <div className="amazon-fba-content">
        {message ? (
          <div className="amazon-fba-notice is-success">{message}</div>
        ) : null}
        {error ? <div className="amazon-fba-notice is-error">{error}</div> : null}

        <section className="amazon-fba-summary-grid">
          {summaryCards.map(([label, value, detail]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{quantity(value)}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </section>

        <section className="amazon-fba-locations">
          <div>
            <strong>Logical Amazon locations</strong>
            <small>Read-only · source of truth: Amazon</small>
          </div>
          <div className="amazon-fba-location-list">
            {locations.map((location) => (
              <span key={location.id}>{location.location_name}</span>
            ))}
          </div>
        </section>

        <section className="amazon-fba-workspace">
          <div className="amazon-fba-section-heading">
            <div>
              <span className="amazon-fba-eyebrow">Inventory control</span>
              <h2>Amazon and ERP stock view</h2>
            </div>
            <span>
              Showing {quantity(items.length)} of {quantity(summary.sku_count)} FBA
              SKUs
            </span>
          </div>

          <div className="amazon-fba-tabs" role="tablist">
            <button
              type="button"
              className={activeView === "inventory" ? "is-active" : ""}
              onClick={() => setActiveView("inventory")}
            >
              FBA inventory
            </button>
            <button
              type="button"
              className={activeView === "reconciliation" ? "is-active" : ""}
              onClick={() => setActiveView("reconciliation")}
            >
              Reconciliation
            </button>
          </div>

          <div className="amazon-fba-filters">
            <label>
              <span>Search</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Seller SKU, FNSKU, ASIN or product"
              />
            </label>
            <label className="amazon-fba-check">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(event) => setLowStockOnly(event.target.checked)}
              />
              Low stock only
            </label>
            <label className="amazon-fba-check">
              <input
                type="checkbox"
                checked={mappedOnly}
                onChange={(event) => setMappedOnly(event.target.checked)}
              />
              Mapped only
            </label>
            <label className="amazon-fba-check">
              <input
                type="checkbox"
                checked={discrepanciesOnly}
                onChange={(event) => setDiscrepanciesOnly(event.target.checked)}
              />
              Discrepancies only
            </label>
          </div>

          <div className="amazon-fba-table-wrap">
            {loading ? (
              <div className="amazon-fba-empty">Loading Amazon FBA inventory…</div>
            ) : items.length === 0 ? (
              <div className="amazon-fba-empty">
                No FBA inventory matches the selected filters. Run a sync after
                listings have been imported.
              </div>
            ) : activeView === "inventory" ? (
              <table className="amazon-fba-table">
                <thead>
                  <tr>
                    <th>Amazon item</th>
                    <th>Fulfillable</th>
                    <th>Inbound</th>
                    <th>Reserved</th>
                    <th>Unfulfillable</th>
                    <th>Researching</th>
                    <th>Total</th>
                    <th>Minimum</th>
                    <th>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={item.is_low_stock ? "is-low" : ""}>
                      <td>
                        <div className="amazon-fba-item">
                          <strong>{item.seller_sku}</strong>
                          <span>{item.product_name || "Amazon product"}</span>
                          <small>
                            FNSKU {item.fnsku || "—"} · ASIN {item.asin || "—"}
                          </small>
                          <div>
                            <span
                              className={`amazon-fba-tag ${
                                item.is_mapped ? "is-mapped" : "is-unmapped"
                              }`}
                            >
                              {item.is_mapped
                                ? `ERP ${item.erp_sku}`
                                : "Not mapped"}
                            </span>
                            {item.is_low_stock ? (
                              <span className="amazon-fba-tag is-low">Low stock</span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="is-number">
                        <strong>{quantity(item.fulfillable_quantity)}</strong>
                      </td>
                      <td>
                        <QuantityDetail
                          total={item.inbound_quantity}
                          parts={`Working ${quantity(
                            item.inbound_working_quantity
                          )} · Shipped ${quantity(
                            item.inbound_shipped_quantity
                          )} · Receiving ${quantity(
                            item.inbound_receiving_quantity
                          )}`}
                        />
                      </td>
                      <td>
                        <QuantityDetail
                          total={item.reserved_quantity}
                          parts={`Orders ${quantity(
                            item.pending_customer_order_quantity
                          )} · Transfer ${quantity(
                            item.pending_transshipment_quantity
                          )} · Processing ${quantity(
                            item.fc_processing_quantity
                          )}`}
                        />
                      </td>
                      <td>
                        <QuantityDetail
                          total={item.unfulfillable_quantity}
                          parts={`Damaged ${quantity(item.damaged_quantity)}`}
                        />
                      </td>
                      <td className="is-number">
                        {quantity(item.researching_quantity)}
                      </td>
                      <td className="is-number">
                        <strong>{quantity(item.total_quantity)}</strong>
                      </td>
                      <td>
                        <div className="amazon-fba-threshold">
                          <input
                            type="number"
                            min="0"
                            value={
                              thresholdDrafts[item.id] ??
                              item.minimum_fba_quantity
                            }
                            onChange={(event) =>
                              setThresholdDrafts((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            aria-label={`Minimum FBA quantity for ${item.seller_sku}`}
                          />
                          <button
                            type="button"
                            disabled={busy === `threshold-${item.id}`}
                            onClick={() => saveThreshold(item)}
                          >
                            Save
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="amazon-fba-date">
                          <span>{formatDateTime(item.last_amazon_update)}</span>
                          <button type="button" onClick={() => openHistory(item)}>
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="amazon-fba-table is-reconciliation">
                <thead>
                  <tr>
                    <th>Mapped item</th>
                    <th>Factory</th>
                    <th>USA</th>
                    <th>Factory reserved</th>
                    <th>Factory available</th>
                    <th>FBA inbound</th>
                    <th>FBA fulfillable</th>
                    <th>FBA reserved</th>
                    <th>FBA unavailable</th>
                    <th>Total owned</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="amazon-fba-item">
                          <strong>{item.erp_sku || item.seller_sku}</strong>
                          <span>{item.erp_product_name || item.product_name}</span>
                          <small>Seller SKU {item.seller_sku}</small>
                        </div>
                      </td>
                      <td className="is-number">{quantity(item.factory_stock)}</td>
                      <td className="is-number">{quantity(item.usa_stock)}</td>
                      <td className="is-number">
                        {quantity(item.factory_reserved_quantity)}
                      </td>
                      <td className="is-number">
                        <strong>{quantity(item.factory_available_quantity)}</strong>
                      </td>
                      <td className="is-number">{quantity(item.inbound_quantity)}</td>
                      <td className="is-number">
                        {quantity(item.fulfillable_quantity)}
                      </td>
                      <td className="is-number">{quantity(item.reserved_quantity)}</td>
                      <td className="is-number">
                        {quantity(
                          item.unfulfillable_quantity + item.researching_quantity
                        )}
                      </td>
                      <td className="is-number">
                        <strong>{quantity(item.total_owned_quantity)}</strong>
                      </td>
                      <td>
                        {item.discrepancy_reasons.length ? (
                          <ul className="amazon-fba-discrepancies">
                            {item.discrepancy_reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="amazon-fba-ok">Reconciled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="amazon-fba-jobs">
          <div className="amazon-fba-section-heading">
            <div>
              <span className="amazon-fba-eyebrow">Operational history</span>
              <h2>Recent inventory jobs</h2>
            </div>
          </div>
          {jobs.length === 0 ? (
            <div className="amazon-fba-empty is-compact">No sync jobs yet.</div>
          ) : (
            <div className="amazon-fba-job-list">
              {jobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>FBA inventory sync #{job.id}</strong>
                    <span>{formatDateTime(job.created_at)}</span>
                    {job.error_message ? <small>{job.error_message}</small> : null}
                  </div>
                  <div>
                    <span className={`amazon-fba-job-status ${jobTone(job.status)}`}>
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
          className="amazon-fba-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHistoryTarget(null);
          }}
        >
          <section
            className="amazon-fba-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="amazon-fba-history-title"
          >
            <header>
              <div>
                <span className="amazon-fba-eyebrow">Quantity snapshots</span>
                <h2 id="amazon-fba-history-title">
                  {historyTarget.seller_sku}
                </h2>
              </div>
              <button type="button" onClick={() => setHistoryTarget(null)}>
                Close
              </button>
            </header>
            {historyLoading ? (
              <div className="amazon-fba-empty">Loading history…</div>
            ) : history.length === 0 ? (
              <div className="amazon-fba-empty">
                No quantity changes have been recorded yet.
              </div>
            ) : (
              <div className="amazon-fba-history-list">
                {history.map((snapshot) => (
                  <article key={snapshot.id}>
                    <div>
                      <strong>{formatDateTime(snapshot.snapshot_at)}</strong>
                      <span>
                        Amazon updated {formatDateTime(snapshot.last_amazon_update)}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Fulfillable</dt>
                        <dd>{quantity(snapshot.fulfillable_quantity)}</dd>
                      </div>
                      <div>
                        <dt>Inbound</dt>
                        <dd>
                          {quantity(
                            snapshot.inbound_working_quantity +
                              snapshot.inbound_shipped_quantity +
                              snapshot.inbound_receiving_quantity
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Reserved</dt>
                        <dd>{quantity(snapshot.reserved_quantity)}</dd>
                      </div>
                      <div>
                        <dt>Unfulfillable</dt>
                        <dd>{quantity(snapshot.unfulfillable_quantity)}</dd>
                      </div>
                      <div>
                        <dt>Researching</dt>
                        <dd>{quantity(snapshot.researching_quantity)}</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd>{quantity(snapshot.total_quantity)}</dd>
                      </div>
                    </dl>
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

export default AmazonFbaInventory;
