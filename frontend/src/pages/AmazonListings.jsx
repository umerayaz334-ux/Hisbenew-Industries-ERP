import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./AmazonListings.css";

const responseError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join(" ") || fallback;
  }
  return typeof detail === "string" && detail ? detail : fallback;
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

const formatPrice = (value, currency) => {
  if (value === null || value === undefined) return "Not provided";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(value));
  } catch {
    return `${currency || "USD"} ${Number(value).toFixed(2)}`;
  }
};

const quantity = (value) =>
  new Intl.NumberFormat().format(
    Number.isFinite(Number(value)) ? Number(value) : 0
  );

const jobTone = (status) => {
  if (status === "Completed") return "is-success";
  if (["Failed", "Cancelled"].includes(status)) return "is-error";
  if (status === "Retrying") return "is-warning";
  return "is-working";
};

function ListingThumbnail({ imageUrl, title }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <div className="amazon-listings-thumbnail">
      {imageUrl && !failed ? (
        <img
          alt={title || "Amazon listing"}
          loading="lazy"
          onError={() => setFailed(true)}
          src={getStaticUrl(imageUrl)}
        />
      ) : (
        <span aria-label="No product image">No image</span>
      )}
    </div>
  );
}

function InventoryCell({ listing }) {
  const inventory = listing.fba_inventory;
  const hasListingQuantity =
    listing.last_amazon_quantity !== null &&
    listing.last_amazon_quantity !== undefined;

  if (!inventory) {
    return (
      <div
        className="amazon-listings-inventory is-unavailable"
        tabIndex={0}
      >
        <strong>
          {hasListingQuantity ? quantity(listing.last_amazon_quantity) : "—"}
        </strong>
        <span>
          {listing.fba_enabled ? "FBA details not synced" : "Listing quantity"}
        </span>
        <small>Hover for details</small>
        <div className="amazon-listings-inventory-popover" role="tooltip">
          <strong>Inventory breakdown unavailable</strong>
          <p>
            {listing.fba_enabled
              ? "Run FBA Inventory sync to load available, reserved, transfer, processing, damaged, and inbound quantities."
              : "Detailed FC inventory buckets apply to Amazon-fulfilled listings."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="amazon-listings-inventory" tabIndex={0}>
      <strong>{quantity(inventory.fulfillable_quantity)}</strong>
      <span>FBA available</span>
      <small>Total at Amazon {quantity(inventory.total_quantity)}</small>
      <div className="amazon-listings-inventory-popover" role="tooltip">
        <div className="amazon-listings-inventory-popover-heading">
          <strong>Amazon inventory details</strong>
          <span>Available now: {quantity(inventory.fulfillable_quantity)}</span>
        </div>
        <dl>
          <div>
            <dt>Reserved</dt>
            <dd>{quantity(inventory.reserved_quantity)}</dd>
          </div>
          <div>
            <dt>Customer orders</dt>
            <dd>{quantity(inventory.pending_customer_order_quantity)}</dd>
          </div>
          <div>
            <dt>FC transfer</dt>
            <dd>{quantity(inventory.pending_transshipment_quantity)}</dd>
          </div>
          <div>
            <dt>FC processing</dt>
            <dd>{quantity(inventory.fc_processing_quantity)}</dd>
          </div>
          <div>
            <dt>Inbound</dt>
            <dd>{quantity(inventory.inbound_quantity)}</dd>
          </div>
          <div>
            <dt>Inbound working</dt>
            <dd>{quantity(inventory.inbound_working_quantity)}</dd>
          </div>
          <div>
            <dt>Inbound shipped</dt>
            <dd>{quantity(inventory.inbound_shipped_quantity)}</dd>
          </div>
          <div>
            <dt>Inbound receiving</dt>
            <dd>{quantity(inventory.inbound_receiving_quantity)}</dd>
          </div>
          <div>
            <dt>Unfulfillable</dt>
            <dd>{quantity(inventory.unfulfillable_quantity)}</dd>
          </div>
          <div>
            <dt>Damaged</dt>
            <dd>{quantity(inventory.damaged_quantity)}</dd>
          </div>
          <div>
            <dt>Researching</dt>
            <dd>{quantity(inventory.researching_quantity)}</dd>
          </div>
          <div>
            <dt>Total at Amazon</dt>
            <dd>{quantity(inventory.total_quantity)}</dd>
          </div>
        </dl>
        <small>
          Inventory synced {formatDateTime(inventory.last_successful_sync)}
        </small>
      </div>
    </div>
  );
}

function StockHealth({ listing }) {
  const inventory = listing.fba_inventory;
  let label = inventory?.health;
  if (!label && !listing.fba_enabled) {
    const listingQuantity = Number(listing.last_amazon_quantity);
    if (Number.isFinite(listingQuantity)) {
      label = listingQuantity > 0 ? "Healthy" : "Out of stock";
    }
  }
  label ||= "Not synced";
  const tone =
    label === "Healthy"
      ? "is-healthy"
      : label === "Low stock"
        ? "is-low"
        : label === "Out of stock"
          ? "is-out"
          : "is-unknown";

  return (
    <div className="amazon-listings-stock-health">
      <span className={tone}>{label}</span>
      {inventory ? (
        <small>
          Minimum {quantity(inventory.minimum_fba_quantity)} available
        </small>
      ) : (
        <small>
          {listing.fba_enabled ? "Sync FBA inventory" : "Based on listing qty"}
        </small>
      )}
    </div>
  );
}

function AmazonListings({ authenticatedUser }) {
  const confirmDialog = useConfirmDialog();
  const [listings, setListings] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    mapped: 0,
    unmapped: 0,
    with_issues: 0,
    variation_parents_hidden: 0,
  });
  const [products, setProducts] = useState([]);
  const [connection, setConnection] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mappingStatus, setMappingStatus] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [mappingTarget, setMappingTarget] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [issueTarget, setIssueTarget] = useState(null);
  const isAdmin = ["admin", "super_admin"].includes(authenticatedUser?.role);

  const loadListings = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.get("/amazon/listings", {
        params: {
          search: search || undefined,
          mapping_status: mappingStatus || undefined,
          fulfillment_mode: fulfillmentMode || undefined,
          issues_only: issuesOnly || undefined,
          limit: 200,
        },
      });
      setListings(response.data?.items || []);
      setSummary(
        response.data?.summary || {
          total: 0,
          mapped: 0,
          unmapped: 0,
          with_issues: 0,
          variation_parents_hidden: 0,
        }
      );
      setError("");
    } catch (loadError) {
      setError(responseError(loadError, "Amazon listings could not be loaded."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [fulfillmentMode, issuesOnly, mappingStatus, search]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    Promise.all([
      api.get("/products"),
      api.get("/amazon/connection/status"),
      api.get("/amazon/listings/jobs", { params: { limit: 10 } }),
    ])
      .then(([productResponse, connectionResponse, jobResponse]) => {
        if (cancelled) return;
        setProducts(productResponse.data || []);
        setConnection(connectionResponse.data || null);
        setJobs(jobResponse.data || []);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            responseError(
              loadError,
              "Amazon listing workspace could not be initialized."
            )
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => loadListings(), 250);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadListings]);

  const autoMatch = async () => {
    setBusy("match");
    setMessage("");
    setError("");
    try {
      const response = await api.post("/amazon/listings/auto-match");
      await loadListings({ quiet: true });
      setMessage(
        `${response.data?.matched || 0} listing${
          response.data?.matched === 1 ? "" : "s"
        } matched by exact Seller SKU. ${response.data?.unmatched || 0} remain unmatched.`
      );
    } catch (matchError) {
      setError(responseError(matchError, "Listings could not be auto-matched."));
    } finally {
      setBusy("");
    }
  };

  const openMapping = (listing) => {
    setMappingTarget(listing);
    setSelectedProductId(listing.product_id ? String(listing.product_id) : "");
    setProductSearch(listing.erp_sku || listing.seller_sku || "");
  };

  const connectMapping = async () => {
    if (!mappingTarget || !selectedProductId) return;
    setBusy(`map-${mappingTarget.id}`);
    setMessage("");
    setError("");
    try {
      await api.post(`/amazon/listings/${mappingTarget.id}/connect`, {
        product_id: Number(selectedProductId),
      });
      setMappingTarget(null);
      await loadListings({ quiet: true });
      setMessage("Amazon offer connected to the selected ERP product.");
    } catch (mapError) {
      setError(responseError(mapError, "The product mapping could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const disconnectMapping = async (listing) => {
    const confirmed = await confirmDialog({
      title: "Disconnect product mapping?",
      message: `${listing.seller_sku} will remain imported, but it will no longer be connected to ${listing.erp_sku || "this ERP product"}.`,
      tone: "warning",
      confirmText: "Disconnect mapping",
    });
    if (!confirmed) return;
    setBusy(`disconnect-${listing.id}`);
    setMessage("");
    setError("");
    try {
      await api.post(`/amazon/listings/${listing.id}/disconnect`);
      setMappingTarget(null);
      await loadListings({ quiet: true });
      setMessage("Product mapping disconnected. The Amazon listing was preserved.");
    } catch (disconnectError) {
      setError(
        responseError(disconnectError, "The product mapping could not be disconnected.")
      );
    } finally {
      setBusy("");
    }
  };

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    const values = term
      ? products.filter(
          (product) =>
            String(product.article_no || "").toLowerCase().includes(term) ||
            String(product.name || "").toLowerCase().includes(term)
        )
      : products;
    return values.slice(0, 80);
  }, [productSearch, products]);

  const summaryCards = [
    ["Sellable offers", summary.total, "Variation parents excluded"],
    ["Mapped", summary.mapped, "Connected to ERP products"],
    ["Unmatched", summary.unmapped, "Needs exact SKU or manual mapping"],
    ["With issues", summary.with_issues, "Amazon warnings or errors"],
  ];

  if (!isAdmin) {
    return (
      <div className="amazon-listings-page">
        <section className="amazon-listings-access">
          <span>Administrator access required</span>
          <h1>Amazon listings</h1>
          <p>Only authorized administrators can import or map Amazon offers.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="amazon-listings-page">
      <header className="amazon-listings-header">
        <div>
          <span className="amazon-listings-eyebrow">Amazon · Catalog operations</span>
          <h1>Listings & product mapping</h1>
        </div>
        <div className="amazon-listings-header-actions">
          <span
            className={`amazon-listings-connection ${
              connection?.connection_status === "Connected"
                ? "is-connected"
                : "is-offline"
            }`}
          >
            {connection?.connection_status || "Checking connection"}
          </span>
          <button
            className="amazon-listings-secondary-button"
            disabled={Boolean(busy) || !summary.total}
            onClick={autoMatch}
            type="button"
          >
            {busy === "match" ? "Matching…" : "Auto match"}
          </button>
        </div>
      </header>

      <main className="amazon-listings-content">
        {message && (
          <section className="amazon-listings-notice is-success" role="status">
            {message}
          </section>
        )}
        {error && (
          <section className="amazon-listings-notice is-error" role="alert">
            {error}
          </section>
        )}
        {connection && connection.connection_status !== "Connected" && (
          <section className="amazon-listings-notice is-warning" role="alert">
            Connect and test the Amazon account in Amazon Settings before using
            Sync all Amazon data. Previously synchronized data remains available.
          </section>
        )}

        <section className="amazon-listings-summary-grid">
          {summaryCards.map(([label, value, detail]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </section>

        <section className="amazon-listings-workspace">
          <div className="amazon-listings-section-heading">
            <span>
              {listings.length} shown
              {summary.variation_parents_hidden > 0
                ? ` · ${summary.variation_parents_hidden} variation parent${
                    summary.variation_parents_hidden === 1 ? "" : "s"
                  } hidden`
                : ""}
            </span>
          </div>

          <div className="amazon-listings-filters">
            <label className="is-search">
              <span>Search</span>
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Seller SKU, ASIN, FNSKU or title"
                value={search}
              />
            </label>
            <label>
              <span>Mapping</span>
              <select
                onChange={(event) => setMappingStatus(event.target.value)}
                value={mappingStatus}
              >
                <option value="">All mappings</option>
                <option value="mapped">Mapped</option>
                <option value="unmapped">Unmatched</option>
              </select>
            </label>
            <label>
              <span>Fulfillment</span>
              <select
                onChange={(event) => setFulfillmentMode(event.target.value)}
                value={fulfillmentMode}
              >
                <option value="">All channels</option>
                <option value="FBA">FBA</option>
                <option value="FBM">FBM</option>
                <option value="BOTH">FBA + FBM</option>
              </select>
            </label>
            <label className="amazon-listings-check">
              <input
                checked={issuesOnly}
                onChange={(event) => setIssuesOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Issues only</span>
            </label>
          </div>

          {loading ? (
            <div className="amazon-listings-empty">Loading imported listings…</div>
          ) : !listings.length ? (
            <div className="amazon-listings-empty">
              <strong>No imported listings found</strong>
              <p>
                Use Sync all Amazon data in Amazon Settings. The ERP will then
                connect exact Seller SKU and ERP article-number matches.
              </p>
            </div>
          ) : (
            <div className="amazon-listings-table-wrap">
              <table className="amazon-listings-table">
                <thead>
                  <tr>
                    <th>Amazon offer</th>
                    <th>Fulfillment</th>
                    <th>Price</th>
                    <th>Current inventory</th>
                    <th>Stock health</th>
                    <th>ERP mapping</th>
                    <th>Listing health</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((listing) => (
                    <tr key={listing.id}>
                      <td>
                        <div className="amazon-listings-offer-cell">
                          <ListingThumbnail
                            imageUrl={listing.image_url}
                            title={listing.product_title || listing.seller_sku}
                          />
                          <div>
                            <strong>{listing.seller_sku}</strong>
                            <span>
                              {listing.product_title || "Title not provided"}
                            </span>
                            <small>
                              ASIN {listing.asin || "—"} · FNSKU{" "}
                              {listing.fnsku || "Not provided"}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="amazon-listings-channel">
                          {listing.fulfillment_mode}
                        </span>
                      </td>
                      <td>
                        <strong>
                          {formatPrice(listing.amazon_price, listing.currency)}
                        </strong>
                      </td>
                      <td>
                        <InventoryCell listing={listing} />
                      </td>
                      <td>
                        <StockHealth listing={listing} />
                      </td>
                      <td>
                        {listing.product_id ? (
                          <>
                            <strong>{listing.erp_sku}</strong>
                            <span>{listing.erp_product_name}</span>
                            <button
                              className="amazon-listings-link-button"
                              onClick={() => openMapping(listing)}
                              type="button"
                            >
                              Change
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="amazon-listings-unmapped">
                              Unmatched
                            </span>
                            <button
                              className="amazon-listings-link-button"
                              onClick={() => openMapping(listing)}
                              type="button"
                            >
                              Map product
                            </button>
                          </>
                        )}
                      </td>
                      <td>
                        <span
                          className={`amazon-listings-status ${
                            listing.product_status === "Active"
                              ? "is-active"
                              : "is-inactive"
                          }`}
                        >
                          {listing.product_status || "Inactive"}
                        </span>
                        {listing.issue_count > 0 ? (
                          <button
                            className="amazon-listings-issue-button"
                            onClick={() => setIssueTarget(listing)}
                            type="button"
                          >
                            {listing.issue_count} issue
                            {listing.issue_count === 1 ? "" : "s"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="amazon-listings-jobs">
          <div className="amazon-listings-section-heading">
            <div>
              <span className="amazon-listings-eyebrow">Synchronization</span>
              <h2>Recent listing jobs</h2>
            </div>
          </div>
          {!jobs.length ? (
            <p className="amazon-listings-jobs-empty">
              No listing synchronization jobs recorded yet.
            </p>
          ) : (
            <div className="amazon-listings-job-list">
              {jobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{job.job_type}</strong>
                    <span>Job #{job.id} · {formatDateTime(job.created_at)}</span>
                  </div>
                  <span className={`amazon-listings-job-status ${jobTone(job.status)}`}>
                    {job.status}
                  </span>
                  <div>
                    <span>
                      Attempt {job.attempt_count} / {job.maximum_attempts}
                    </span>
                    {job.error_message && <small>{job.error_message}</small>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {mappingTarget && (
        <div
          className="amazon-listings-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMappingTarget(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="amazon-mapping-title"
            aria-modal="true"
            className="amazon-listings-modal"
            role="dialog"
          >
            <span className="amazon-listings-eyebrow">Manual mapping</span>
            <h2 id="amazon-mapping-title">{mappingTarget.seller_sku}</h2>
            <p>
              Select the ERP product this Amazon offer belongs to. One ERP
              product may connect to multiple Amazon offers.
            </p>
            <label>
              Search ERP products
              <input
                autoFocus
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Article number or product name"
                value={productSearch}
              />
            </label>
            <div className="amazon-listings-product-picker">
              {filteredProducts.map((product) => (
                <label
                  className={
                    selectedProductId === String(product.id) ? "is-selected" : ""
                  }
                  key={product.id}
                >
                  <input
                    checked={selectedProductId === String(product.id)}
                    name="amazon-product"
                    onChange={() => setSelectedProductId(String(product.id))}
                    type="radio"
                  />
                  <span>
                    <strong>{product.article_no}</strong>
                    <small>{product.name}</small>
                  </span>
                </label>
              ))}
              {!filteredProducts.length && (
                <p>No ERP products match this search.</p>
              )}
            </div>
            <div className="amazon-listings-modal-actions">
              {mappingTarget.product_id && (
                <button
                  className="amazon-listings-secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => disconnectMapping(mappingTarget)}
                  type="button"
                >
                  {busy === `disconnect-${mappingTarget.id}`
                    ? "Disconnecting…"
                    : "Disconnect mapping"}
                </button>
              )}
              <button
                className="amazon-listings-secondary-button"
                onClick={() => setMappingTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="amazon-listings-primary-button"
                disabled={!selectedProductId || Boolean(busy)}
                onClick={connectMapping}
                type="button"
              >
                {busy === `map-${mappingTarget.id}` ? "Saving…" : "Save mapping"}
              </button>
            </div>
          </section>
        </div>
      )}

      {issueTarget && (
        <div
          className="amazon-listings-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIssueTarget(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="amazon-issues-title"
            aria-modal="true"
            className="amazon-listings-modal"
            role="dialog"
          >
            <span className="amazon-listings-eyebrow">Listing health</span>
            <h2 id="amazon-issues-title">{issueTarget.seller_sku}</h2>
            <p>Sanitized issues returned by Amazon for this listing.</p>
            <div className="amazon-listings-issue-list">
              {issueTarget.listing_issues.map((issue, index) => (
                <article key={`${issue.code}-${index}`}>
                  <div>
                    <strong>{issue.severity || "WARNING"}</strong>
                    <span>{issue.code || "listing_issue"}</span>
                  </div>
                  <p>{issue.message}</p>
                  {issue.attribute_names?.length > 0 && (
                    <small>{issue.attribute_names.join(", ")}</small>
                  )}
                </article>
              ))}
            </div>
            <div className="amazon-listings-modal-actions">
              <button
                className="amazon-listings-primary-button"
                onClick={() => setIssueTarget(null)}
                type="button"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AmazonListings;
