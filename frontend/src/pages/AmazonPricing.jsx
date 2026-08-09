import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./AmazonPricing.css";

const money = (value, currency = "USD") => {
  if (value === null || value === undefined || value === "") return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `${currency || "USD"} ${Number(value).toFixed(2)}`;
  }
};

const dateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
};

const inputDateTime = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
};

const numberOrNull = (value) =>
  String(value ?? "").trim() === "" ? null : Number(value);

const responseError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join(" ") || fallback;
  }
  return typeof detail === "string" && detail ? detail : fallback;
};

const statusTone = (status) => {
  const clean = String(status || "").toLowerCase();
  if (["approved", "submitted", "completed"].includes(clean)) return "is-success";
  if (["failed", "rejected"].includes(clean)) return "is-danger";
  if (["pending approval", "queued", "processing"].includes(clean)) return "is-warning";
  return "is-neutral";
};

const emptyEditor = {
  mapping_id: null,
  minimum_price: "",
  maximum_price: "",
  sale_price: "",
  sale_start_date: "",
  sale_end_date: "",
  sync_price: false,
  requested_price: "",
  reason: "",
};

function AmazonPricing({ authenticatedUser }) {
  const [offers, setOffers] = useState([]);
  const [changes, setChanges] = useState([]);
  const [summary, setSummary] = useState({});
  const [settings, setSettings] = useState({
    price_sync_enabled: false,
    approval_threshold_percent: 10,
    currency: "USD",
  });
  const [settingsDraft, setSettingsDraft] = useState({
    price_sync_enabled: false,
    approval_threshold_percent: 10,
  });
  const [tab, setTab] = useState("offers");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [selectedChanges, setSelectedChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isAdmin = ["admin", "super_admin"].includes(authenticatedUser?.role);

  const loadWorkspace = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [pricingResponse, changesResponse] = await Promise.all([
        api.get("/amazon/pricing", {
          params: { search: search || undefined, limit: 1000 },
        }),
        api.get("/amazon/pricing/changes", { params: { limit: 1000 } }),
      ]);
      const nextSettings = pricingResponse.data?.settings || {};
      setOffers(pricingResponse.data?.items || []);
      setSummary(pricingResponse.data?.summary || {});
      setChanges(changesResponse.data?.items || []);
      setSettings(nextSettings);
      setSettingsDraft({
        price_sync_enabled: Boolean(nextSettings.price_sync_enabled),
        approval_threshold_percent: Number(
          nextSettings.approval_threshold_percent || 10
        ),
      });
      setSelectedChanges((current) =>
        current.filter((id) =>
          (changesResponse.data?.items || []).some(
            (change) => change.id === id && change.status === "Approved"
          )
        )
      );
      setError("");
    } catch (loadError) {
      setError(
        responseError(loadError, "The Amazon pricing workspace could not be loaded.")
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => loadWorkspace(), 200);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadWorkspace]);

  useEffect(() => {
    const hasActive = changes.some((change) =>
      ["Queued", "Processing"].includes(change.status)
    );
    if (!hasActive) return undefined;
    const timer = window.setInterval(
      () => loadWorkspace({ quiet: true }),
      2000
    );
    return () => window.clearInterval(timer);
  }, [changes, loadWorkspace]);

  const visibleChanges = useMemo(() => {
    if (tab === "approvals") {
      return changes.filter((change) => change.status === "Pending Approval");
    }
    if (tab === "errors") {
      return changes.filter((change) => change.status === "Failed");
    }
    return changes;
  }, [changes, tab]);

  const openEditor = (offer) => {
    setEditor({
      ...emptyEditor,
      mapping_id: offer.mapping_id,
      minimum_price: offer.minimum_price ?? "",
      maximum_price: offer.maximum_price ?? "",
      sale_price: offer.sale_price ?? "",
      sale_start_date: inputDateTime(offer.sale_start_date),
      sale_end_date: inputDateTime(offer.sale_end_date),
      sync_price: Boolean(offer.sync_price),
      requested_price: offer.pending_price ?? offer.amazon_price ?? "",
      reason: "",
    });
    setMessage("");
    setError("");
  };

  const rulePayload = () => ({
    minimum_price: numberOrNull(editor.minimum_price),
    maximum_price: numberOrNull(editor.maximum_price),
    sale_price: numberOrNull(editor.sale_price),
    sale_start_date: editor.sale_start_date
      ? new Date(editor.sale_start_date).toISOString()
      : null,
    sale_end_date: editor.sale_end_date
      ? new Date(editor.sale_end_date).toISOString()
      : null,
    sync_price: Boolean(editor.sync_price),
  });

  const saveRules = async ({ close = true } = {}) => {
    setBusy("rules");
    setError("");
    try {
      await api.patch(`/amazon/pricing/${editor.mapping_id}/rules`, rulePayload());
      setMessage("Price safeguards saved. No Amazon price was changed.");
      if (close) setEditor(null);
      await loadWorkspace({ quiet: true });
      return true;
    } catch (saveError) {
      setError(responseError(saveError, "Price safeguards could not be saved."));
      return false;
    } finally {
      setBusy("");
    }
  };

  const requestPrice = async () => {
    setBusy("request");
    setError("");
    try {
      await api.patch(`/amazon/pricing/${editor.mapping_id}/rules`, rulePayload());
      const response = await api.post("/amazon/pricing/changes", {
        mapping_id: editor.mapping_id,
        requested_price: Number(editor.requested_price),
        reason: editor.reason || null,
      });
      const change = response.data;
      setMessage(
        change.status === "Pending Approval"
          ? `Price request recorded. The ${Number(
              change.change_percent || 0
            ).toFixed(1)}% change requires approval.`
          : "Price request passed the safeguards and is ready to queue."
      );
      setEditor(null);
      setTab(change.status === "Pending Approval" ? "approvals" : "history");
      await loadWorkspace({ quiet: true });
    } catch (requestError) {
      setError(responseError(requestError, "The price request could not be created."));
    } finally {
      setBusy("");
    }
  };

  const saveSettings = async () => {
    if (
      settingsDraft.price_sync_enabled &&
      !settings.price_sync_enabled &&
      !window.confirm(
        "Enable Amazon price publishing? Prices still require SKU controls and an approved request before submission."
      )
    ) {
      return;
    }
    setBusy("settings");
    setError("");
    try {
      await api.patch("/amazon/pricing/settings", {
        price_sync_enabled: Boolean(settingsDraft.price_sync_enabled),
        approval_threshold_percent: Number(
          settingsDraft.approval_threshold_percent
        ),
      });
      setMessage(
        settingsDraft.price_sync_enabled
          ? "Account-level price publishing enabled with safeguards."
          : "Amazon price publishing paused."
      );
      await loadWorkspace({ quiet: true });
    } catch (settingsError) {
      setError(
        responseError(settingsError, "Pricing controls could not be updated.")
      );
    } finally {
      setBusy("");
    }
  };

  const reviewChange = async (change, approved) => {
    const note = window.prompt(
      approved ? "Approval note (optional)" : "Reason for rejection (optional)",
      ""
    );
    if (note === null) return;
    setBusy(`review-${change.id}`);
    setError("");
    try {
      await api.post(`/amazon/pricing/changes/${change.id}/review`, {
        approved,
        review_note: note || null,
      });
      setMessage(approved ? "Price change approved." : "Price change rejected.");
      await loadWorkspace({ quiet: true });
    } catch (reviewError) {
      setError(responseError(reviewError, "The price request could not be reviewed."));
    } finally {
      setBusy("");
    }
  };

  const queueChange = async (change) => {
    if (
      !window.confirm(
        `Submit ${change.seller_sku} at ${money(
          change.requested_price,
          change.currency
        )} to Amazon?`
      )
    ) {
      return;
    }
    setBusy(`queue-${change.id}`);
    setError("");
    try {
      await api.post(`/amazon/pricing/changes/${change.id}/queue`);
      setMessage("Approved price change queued for Amazon.");
      await loadWorkspace({ quiet: true });
    } catch (queueError) {
      setError(responseError(queueError, "The price change could not be queued."));
    } finally {
      setBusy("");
    }
  };

  const bulkQueue = async () => {
    if (!selectedChanges.length) return;
    if (
      !window.confirm(
        `Submit ${selectedChanges.length} approved price change(s) to Amazon?`
      )
    ) {
      return;
    }
    setBusy("bulk");
    setError("");
    try {
      const response = await api.post("/amazon/pricing/bulk-sync", {
        change_ids: selectedChanges,
      });
      setMessage(
        `${Number(response.data?.queued || 0)} Amazon price job(s) queued.`
      );
      setSelectedChanges([]);
      await loadWorkspace({ quiet: true });
    } catch (bulkError) {
      setError(responseError(bulkError, "Bulk price synchronization failed."));
    } finally {
      setBusy("");
    }
  };

  const toggleChange = (id) => {
    setSelectedChanges((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  };

  if (!isAdmin) {
    return (
      <main className="amazon-pricing-page">
        <section className="amazon-pricing-denied">
          <span>Restricted workspace</span>
          <h1>Amazon Pricing</h1>
          <p>Administrator access is required to control Amazon prices.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="amazon-pricing-page">
      <header className="amazon-pricing-header">
        <div>
          <span className="amazon-pricing-eyebrow">Amazon · Phase 7</span>
          <h1>Controlled pricing</h1>
          <p>
            Set hard price boundaries, review large changes, and submit only
            explicitly approved offers.
          </p>
        </div>
        <div className="amazon-pricing-header-state">
          <span
            className={`amazon-pricing-master-status ${
              settings.price_sync_enabled ? "is-enabled" : "is-paused"
            }`}
          >
            {settings.price_sync_enabled ? "Publishing enabled" : "Publishing paused"}
          </span>
          <small>{settings.marketplace_id || "Amazon marketplace"}</small>
        </div>
      </header>

      <div className="amazon-pricing-content">
        {message && <div className="amazon-pricing-notice is-success">{message}</div>}
        {error && <div className="amazon-pricing-notice is-error">{error}</div>}

        {!settings.price_sync_enabled && (
          <div className="amazon-pricing-safety-banner">
            <strong>Safe mode is active.</strong>
            <span>
              You can configure and approve prices, but the ERP cannot publish
              them to Amazon.
            </span>
          </div>
        )}

        <section className="amazon-pricing-summary">
          <article>
            <span>Amazon offers</span>
            <strong>{Number(summary.total_offers || 0).toLocaleString()}</strong>
            <small>{summary.enabled_offers || 0} SKU controls enabled</small>
          </article>
          <article className="is-amber">
            <span>Awaiting approval</span>
            <strong>{Number(summary.pending_approval || 0).toLocaleString()}</strong>
            <small>Above the allowed change threshold</small>
          </article>
          <article className="is-green">
            <span>Ready to sync</span>
            <strong>{Number(summary.approved || 0).toLocaleString()}</strong>
            <small>Approved but not yet sent</small>
          </article>
          <article className="is-red">
            <span>Pricing errors</span>
            <strong>{Number(summary.errors || 0).toLocaleString()}</strong>
            <small>Rejected by Amazon or blocked locally</small>
          </article>
        </section>

        <section className="amazon-pricing-controls">
          <div>
            <span>Account safeguard</span>
            <h2>Publishing authority</h2>
            <p>
              A large price move is anything above this percentage and must be
              approved separately.
            </p>
          </div>
          <label className="amazon-pricing-toggle">
            <input
              type="checkbox"
              checked={settingsDraft.price_sync_enabled}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  price_sync_enabled: event.target.checked,
                }))
              }
            />
            <span>Allow approved price publishing</span>
          </label>
          <label>
            <span>Approval threshold</span>
            <div className="amazon-pricing-percent-input">
              <input
                type="number"
                min="1"
                max="100"
                step="0.5"
                value={settingsDraft.approval_threshold_percent}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    approval_threshold_percent: event.target.value,
                  }))
                }
              />
              <b>%</b>
            </div>
          </label>
          <button
            type="button"
            onClick={saveSettings}
            disabled={Boolean(busy)}
          >
            {busy === "settings" ? "Saving…" : "Save control"}
          </button>
        </section>

        <nav className="amazon-pricing-tabs">
          {[
            ["offers", "Offers", summary.total_offers],
            ["approvals", "Approvals", summary.pending_approval],
            ["history", "Sync history", changes.length],
            ["errors", "Errors", summary.errors],
          ].map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={tab === value ? "is-active" : ""}
              onClick={() => setTab(value)}
            >
              {label} <span>{Number(count || 0).toLocaleString()}</span>
            </button>
          ))}
        </nav>

        {tab === "offers" ? (
          <section className="amazon-pricing-panel">
            <div className="amazon-pricing-panel-heading">
              <div>
                <span>Offer controls</span>
                <h2>Amazon listing prices</h2>
              </div>
              <label className="amazon-pricing-search">
                <span>Search</span>
                <input
                  type="search"
                  placeholder="Seller SKU, ASIN or title"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>
            <div className="amazon-pricing-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Offer</th>
                    <th>Amazon price</th>
                    <th>Allowed range</th>
                    <th>Pending</th>
                    <th>Publishing</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => (
                    <tr key={offer.mapping_id}>
                      <td>
                        <strong>{offer.seller_sku}</strong>
                        <span>{offer.product_title || offer.erp_product_name || "Amazon offer"}</span>
                        <small>{offer.asin || "No ASIN"} · {offer.fulfillment_mode}</small>
                      </td>
                      <td className="is-money">
                        {money(offer.amazon_price, offer.currency)}
                      </td>
                      <td>
                        <span>
                          {money(offer.minimum_price, offer.currency)} –{" "}
                          {money(offer.maximum_price, offer.currency)}
                        </span>
                        {offer.sale_price !== null && (
                          <small>Sale {money(offer.sale_price, offer.currency)}</small>
                        )}
                      </td>
                      <td className="is-money">
                        {money(offer.pending_price, offer.currency)}
                      </td>
                      <td>
                        <span
                          className={`amazon-pricing-pill ${
                            offer.sync_price ? "is-success" : "is-neutral"
                          }`}
                        >
                          {offer.sync_price ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`amazon-pricing-pill ${statusTone(
                            offer.last_price_status
                          )}`}
                        >
                          {offer.last_price_status || "No request"}
                        </span>
                        {offer.last_error && <small className="is-error-text">{offer.last_error}</small>}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="amazon-pricing-row-button"
                          onClick={() => openEditor(offer)}
                        >
                          Configure
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && !offers.length && (
                    <tr>
                      <td colSpan="7" className="amazon-pricing-empty">
                        No Amazon offers match this search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="amazon-pricing-panel">
            <div className="amazon-pricing-panel-heading">
              <div>
                <span>
                  {tab === "approvals"
                    ? "Large changes"
                    : tab === "errors"
                      ? "Amazon rejections"
                      : "Audit trail"}
                </span>
                <h2>
                  {tab === "approvals"
                    ? "Approval queue"
                    : tab === "errors"
                      ? "Pricing errors"
                      : "Price change history"}
                </h2>
              </div>
              {tab === "history" && (
                <button
                  type="button"
                  className="amazon-pricing-bulk-button"
                  disabled={!selectedChanges.length || Boolean(busy)}
                  onClick={bulkQueue}
                >
                  {busy === "bulk"
                    ? "Queuing…"
                    : `Sync selected (${selectedChanges.length})`}
                </button>
              )}
            </div>
            <div className="amazon-pricing-table-wrap">
              <table>
                <thead>
                  <tr>
                    {tab === "history" && <th className="is-check"></th>}
                    <th>Request</th>
                    <th>Price change</th>
                    <th>Guardrail</th>
                    <th>Status</th>
                    <th>Amazon result</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleChanges.map((change) => (
                    <tr key={change.id}>
                      {tab === "history" && (
                        <td className="is-check">
                          <input
                            type="checkbox"
                            disabled={change.status !== "Approved"}
                            checked={selectedChanges.includes(change.id)}
                            onChange={() => toggleChange(change.id)}
                            aria-label={`Select ${change.seller_sku}`}
                          />
                        </td>
                      )}
                      <td>
                        <strong>{change.seller_sku}</strong>
                        <span>{change.product_title || change.erp_sku || "Amazon offer"}</span>
                        <small>{dateTime(change.created_at)}</small>
                      </td>
                      <td>
                        <strong>
                          {money(change.current_price, change.currency)} →{" "}
                          {money(change.requested_price, change.currency)}
                        </strong>
                        <small>
                          {change.change_percent === null
                            ? "New price baseline"
                            : `${Number(change.change_percent).toFixed(1)}% change`}
                        </small>
                      </td>
                      <td>
                        <span>
                          {money(change.minimum_price, change.currency)} –{" "}
                          {money(change.maximum_price, change.currency)}
                        </span>
                        <small>
                          Approval above {Number(
                            change.approval_threshold_percent || 0
                          ).toFixed(1)}%
                        </small>
                      </td>
                      <td>
                        <span className={`amazon-pricing-pill ${statusTone(change.status)}`}>
                          {change.status}
                        </span>
                        {change.reason && <small>{change.reason}</small>}
                      </td>
                      <td>
                        <span>{change.amazon_status || "Not submitted"}</span>
                        <small>{change.amazon_submission_id || "No submission ID"}</small>
                        {change.last_error && (
                          <small className="is-error-text">{change.last_error}</small>
                        )}
                      </td>
                      <td>
                        <div className="amazon-pricing-row-actions">
                          {change.status === "Pending Approval" && (
                            <>
                              <button
                                type="button"
                                className="is-approve"
                                disabled={Boolean(busy)}
                                onClick={() => reviewChange(change, true)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="is-reject"
                                disabled={Boolean(busy)}
                                onClick={() => reviewChange(change, false)}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {change.status === "Approved" && (
                            <button
                              type="button"
                              className="is-sync"
                              disabled={Boolean(busy)}
                              onClick={() => queueChange(change)}
                            >
                              Queue sync
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !visibleChanges.length && (
                    <tr>
                      <td
                        colSpan={tab === "history" ? "7" : "6"}
                        className="amazon-pricing-empty"
                      >
                        {tab === "errors"
                          ? "No Amazon pricing errors."
                          : tab === "approvals"
                            ? "No price changes are awaiting approval."
                            : "No price requests have been created yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {editor && (
        <div className="amazon-pricing-modal-backdrop" role="presentation">
          <section className="amazon-pricing-modal" role="dialog" aria-modal="true">
            <header>
              <div>
                <span>SKU safeguard</span>
                <h2>
                  {offers.find((offer) => offer.mapping_id === editor.mapping_id)
                    ?.seller_sku || "Amazon offer"}
                </h2>
              </div>
              <button type="button" onClick={() => setEditor(null)}>×</button>
            </header>
            <div className="amazon-pricing-modal-body">
              <div className="amazon-pricing-form-section">
                <div>
                  <span>Hard boundaries</span>
                  <h3>Price rules</h3>
                </div>
                <div className="amazon-pricing-form-grid">
                  <label>
                    <span>Minimum price</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editor.minimum_price}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          minimum_price: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Maximum price</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editor.maximum_price}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          maximum_price: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Sale price</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editor.sale_price}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          sale_price: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Sale starts</span>
                    <input
                      type="datetime-local"
                      value={editor.sale_start_date}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          sale_start_date: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Sale ends</span>
                    <input
                      type="datetime-local"
                      value={editor.sale_end_date}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          sale_end_date: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="amazon-pricing-modal-toggle">
                    <input
                      type="checkbox"
                      checked={editor.sync_price}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          sync_price: event.target.checked,
                        }))
                      }
                    />
                    <span>Allow this SKU to publish approved prices</span>
                  </label>
                </div>
              </div>

              <div className="amazon-pricing-form-section is-request">
                <div>
                  <span>Controlled request</span>
                  <h3>Propose a new regular price</h3>
                </div>
                <div className="amazon-pricing-form-grid">
                  <label>
                    <span>Requested price</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={editor.requested_price}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          requested_price: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="is-wide">
                    <span>Business reason</span>
                    <textarea
                      rows="3"
                      maxLength="1000"
                      placeholder="Optional note for the approval history"
                      value={editor.reason}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          reason: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <p>
                  Creating a request does not change Amazon. Large changes go to
                  the approval queue; smaller changes become ready to sync.
                </p>
              </div>
            </div>
            <footer>
              <button type="button" onClick={() => setEditor(null)}>Cancel</button>
              <button
                type="button"
                className="is-secondary"
                disabled={Boolean(busy)}
                onClick={() => saveRules()}
              >
                {busy === "rules" ? "Saving…" : "Save safeguards"}
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={Boolean(busy) || !Number(editor.requested_price)}
                onClick={requestPrice}
              >
                {busy === "request" ? "Creating…" : "Create price request"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

export default AmazonPricing;
