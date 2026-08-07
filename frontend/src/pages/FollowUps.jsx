import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./FollowUps.css";

const FOLLOW_UP_STATUSES = [
  ["Open", "Open"],
  ["Pending", "Pending"],
  ["Followed Up", "Followed up"],
  ["Review Provided", "Review provided"],
  ["No Review", "No review"],
  ["Closed", "Closed"],
  ["All", "All"],
];

const createDraft = (followUp) => ({
  channel: followUp.channel || "WhatsApp",
  message: followUp.message || "",
  review_note: followUp.review_note || "",
});

const OPEN_FOLLOW_UP_STATUSES = new Set(["Pending", "Followed Up", "No Review"]);

const statusClassName = (status) =>
  `is-${String(status || "pending")
    .toLowerCase()
    .replace(/\s+/g, "-")}`;

const hasReviewProvided = (followUp) =>
  Boolean(followUp.review_provided) || followUp.status === "Review Provided";

function FollowUps() {
  const [followUps, setFollowUps] = useState([]);
  const [statusFilter, setStatusFilter] = useState("Open");
  const [searchQuery, setSearchQuery] = useState("");
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadFollowUps = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");

    try {
      const response = await api.get("/order-follow-ups");
      const rows = Array.isArray(response.data) ? response.data : [];
      setFollowUps(rows);
      setDrafts((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          if (!next[row.id]) next[row.id] = createDraft(row);
        });
        return next;
      });
    } catch (loadError) {
      console.error("Follow-up load error:", loadError);
      setError("Follow-up queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      loadFollowUps();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [loadFollowUps]);

  const summary = useMemo(
    () => ({
      pending: followUps.filter((item) => item.status === "Pending").length,
      followed: followUps.filter((item) => item.status === "Followed Up").length,
      reviews: followUps.filter((item) => hasReviewProvided(item)).length,
      noReview: followUps.filter((item) => item.status === "No Review").length,
      open: followUps.filter((item) =>
        OPEN_FOLLOW_UP_STATUSES.has(item.status)
      ).length,
    }),
    [followUps]
  );

  const filteredFollowUps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const statusFiltered = followUps.filter((item) => {
      if (statusFilter === "All") return true;
      if (statusFilter === "Open") return OPEN_FOLLOW_UP_STATUSES.has(item.status);
      return item.status === statusFilter;
    });

    if (!query) return statusFiltered;

    return statusFiltered.filter((item) =>
      [
        item.order_no,
        item.customer_name,
        item.customer_phone,
        item.customer_email,
        item.platform,
        item.status,
        item.channel,
        item.review_note,
        ...(item.items || []).flatMap((orderItem) => [
          orderItem.article_no,
          orderItem.product_name,
        ]),
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [followUps, searchQuery, statusFilter]);

  const handleDraftChange = (followUpId, field, value) => {
    setDrafts((current) => ({
      ...current,
      [followUpId]: {
        ...(current[followUpId] || {}),
        [field]: value,
      },
    }));
  };

  const updateFollowUp = async (followUp, status) => {
    const draft = drafts[followUp.id] || createDraft(followUp);
    setSavingId(`${followUp.id}-${status}`);
    setError("");
    setNotice("");

    try {
      const response = await api.patch(`/order-follow-ups/${followUp.id}`, {
        status,
        channel: draft.channel,
        message: draft.message,
        review_provided:
          status === "Review Provided"
            ? true
            : status === "No Review"
              ? false
              : followUp.review_provided,
        review_note: draft.review_note,
      });
      const updated = response.data;
      setFollowUps((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      setDrafts((current) => ({
        ...current,
        [updated.id]: createDraft(updated),
      }));
      setNotice(`Order #${followUp.order_no} updated to ${status}.`);
      await loadFollowUps({ quiet: true });
    } catch (saveError) {
      console.error("Follow-up update error:", saveError);
      setError(saveError.response?.data?.detail || "Follow-up could not be updated.");
    } finally {
      setSavingId("");
    }
  };

  const formatDate = (value) => (value ? formatUtcLocal(value) : "-");

  return (
    <div className="followups-page">
      <header className="followups-header">
        <div>
          <span>Post delivery</span>
          <h1>Follow Ups</h1>
          <p>Track review requests after delivery and close the customer loop.</p>
        </div>
        <button onClick={() => loadFollowUps()} type="button">
          Refresh
        </button>
      </header>

      <section className="followups-summary" aria-label="Follow-up summary">
        <article>
          <span>Open</span>
          <strong>{summary.open}</strong>
        </article>
        <article>
          <span>Pending</span>
          <strong>{summary.pending}</strong>
        </article>
        <article>
          <span>Followed up</span>
          <strong>{summary.followed}</strong>
        </article>
        <article>
          <span>Reviews</span>
          <strong>{summary.reviews}</strong>
        </article>
        <article>
          <span>No review</span>
          <strong>{summary.noReview}</strong>
        </article>
      </section>

      <section className="followups-workspace">
        <div className="followups-toolbar">
          <div className="followups-tabs" aria-label="Follow-up status">
            {FOLLOW_UP_STATUSES.map(([value, label]) => (
              <button
                aria-pressed={statusFilter === value}
                className={statusFilter === value ? "is-active" : ""}
                key={value}
                onClick={() => setStatusFilter(value)}
                type="button"
              >
                {label}
                <strong>
                  {value === "All"
                    ? followUps.length
                    : value === "Open"
                      ? summary.open
                      : followUps.filter((item) => item.status === value).length}
                </strong>
              </button>
            ))}
          </div>
          <label className="followups-search">
            <span>Search</span>
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Order, customer, phone"
              value={searchQuery}
            />
          </label>
        </div>

        {notice && <div className="followups-notice">{notice}</div>}
        {error && <div className="followups-error">{error}</div>}

        {loading ? (
          <div className="followups-empty">Loading follow-ups...</div>
        ) : filteredFollowUps.length === 0 ? (
          <div className="followups-empty">No follow-ups match this view.</div>
        ) : (
          <div className="followups-list">
            {filteredFollowUps.map((followUp) => {
              const draft = drafts[followUp.id] || createDraft(followUp);
              const reviewProvided = hasReviewProvided(followUp);
              const itemCount = (followUp.items || []).reduce(
                (total, item) => total + Number(item.quantity || 0),
                0
              );
              return (
                <article
                  className={`followups-card ${statusClassName(followUp.status)}`}
                  key={followUp.id}
                >
                  <div className="followups-card-main">
                    <div>
                      <span className="followups-order">#{followUp.order_no}</span>
                      <h2>{followUp.customer_name || "Unknown customer"}</h2>
                      <p>
                        {followUp.platform || "Manual"} / Delivered / Due{" "}
                        {formatDate(followUp.follow_up_due_at)}
                      </p>
                    </div>
                    <div className="followups-card-badges">
                      <span className={`followups-status ${statusClassName(followUp.status)}`}>
                        {followUp.status}
                      </span>
                      <span
                        className={`followups-review-pill ${
                          reviewProvided ? "is-provided" : "is-waiting"
                        }`}
                      >
                        {reviewProvided ? "Review provided" : "Review pending"}
                      </span>
                    </div>
                  </div>

                  <div className="followups-contact-grid">
                    <div>
                      <span>Phone</span>
                      <strong>{followUp.customer_phone || "-"}</strong>
                    </div>
                    <div>
                      <span>Email</span>
                      <strong>{followUp.customer_email || "-"}</strong>
                    </div>
                    <div>
                      <span>Followed up</span>
                      <strong>{formatDate(followUp.followed_up_at)}</strong>
                    </div>
                    <div>
                      <span>Order</span>
                      <strong>
                        <a href={`/portal/orders/${followUp.order_id}`}>
                          Open order
                        </a>
                      </strong>
                    </div>
                    <div>
                      <span>Articles</span>
                      <strong>{itemCount} pcs</strong>
                    </div>
                  </div>

                  {(followUp.items || []).length > 0 && (
                    <div className="followups-items">
                      {(followUp.items || []).slice(0, 5).map((item) => {
                        const imageUrl = getStaticUrl(item.product_image_url);
                        return (
                          <div
                            className="followups-item"
                            key={item.id || `${item.article_no}-${item.quantity}`}
                          >
                            {imageUrl ? (
                              <img
                                alt={item.article_no || item.product_name || "Article"}
                                src={imageUrl}
                              />
                            ) : (
                              <span className="followups-item-placeholder">SKU</span>
                            )}
                            <span>
                              <strong>{item.article_no || "Article"}</strong>
                              <small>{item.product_name || "Order item"}</small>
                            </span>
                            <em>x {item.quantity}</em>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="followups-edit-grid">
                    <label>
                      <span>Channel</span>
                      <select
                        onChange={(event) =>
                          handleDraftChange(followUp.id, "channel", event.target.value)
                        }
                        value={draft.channel}
                      >
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="Email">Email</option>
                        <option value="Phone">Phone</option>
                        <option value="Faire">Faire</option>
                        <option value="Manual">Manual</option>
                      </select>
                    </label>
                    <label>
                      <span>Message sent</span>
                      <textarea
                        onChange={(event) =>
                          handleDraftChange(followUp.id, "message", event.target.value)
                        }
                        placeholder="What was sent to the customer?"
                        value={draft.message}
                      />
                    </label>
                    <label>
                      <span>Review note</span>
                      <textarea
                        onChange={(event) =>
                          handleDraftChange(followUp.id, "review_note", event.target.value)
                        }
                        placeholder="Review link, rating, or reason if no review"
                        value={draft.review_note}
                      />
                    </label>
                  </div>

                  <div className="followups-actions">
                    <button
                      disabled={savingId === `${followUp.id}-Followed Up`}
                      onClick={() => updateFollowUp(followUp, "Followed Up")}
                      type="button"
                    >
                      Mark followed up
                    </button>
                    <button
                      disabled={savingId === `${followUp.id}-Review Provided`}
                      onClick={() => updateFollowUp(followUp, "Review Provided")}
                      type="button"
                    >
                      Review provided
                    </button>
                    <button
                      disabled={savingId === `${followUp.id}-No Review`}
                      onClick={() => updateFollowUp(followUp, "No Review")}
                      type="button"
                    >
                      No review
                    </button>
                    <button
                      disabled={savingId === `${followUp.id}-${followUp.status}`}
                      onClick={() => updateFollowUp(followUp, followUp.status)}
                      type="button"
                    >
                      Save notes
                    </button>
                    <button
                      disabled={savingId === `${followUp.id}-Closed`}
                      onClick={() => updateFollowUp(followUp, "Closed")}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default FollowUps;
