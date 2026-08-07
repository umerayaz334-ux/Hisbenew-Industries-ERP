import { useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./Payouts.css";

const statusOptions = [
  "Not Received",
  "Partially Received",
  "Received",
  "On Hold",
  "Disputed",
  "Refunded",
];

const createEmptyForm = () => ({
  payout_amount_usd: "",
  payout_received_date: "",
  payout_status: "Not Received",
  payment_source: "",
  payout_notes: "",
});

function Icon({ name, size = 18 }) {
  const paths = {
    money: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M7 9H6M18 15h-1" />
      </>
    ),
    missing: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 17h.01" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    orders: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M8 11h8M8 15h5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevron: <path d="m7 10 5 5 5-5" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="payouts-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {paths[name]}
      </g>
    </svg>
  );
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function localDateValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStatusClass(status) {
  return `is-${String(status || "Not Received")
    .replace(/\s+/g, "-")
    .toLowerCase()}`;
}

function getStatusLabel(status) {
  if (status === "Received") return "Paid";
  if (status === "Partially Received") return "Partial";
  if (status === "Not Received") return "Not paid";
  return status || "Not paid";
}

function PayoutRow({ isSaving, onEdit, onMarkPaid, order }) {
  const payoutAmount = Number(
    order.payout_amount_usd ||
      order.expected_payout_usd ||
      order.received_payout_usd ||
      0
  );
  const amountMissing = payoutAmount <= 0;

  return (
    <article className="payouts-list-row">
      <div className="payouts-order-cell">
        <strong>#{order.order_no}</strong>
        <span>{formatDate(order.order_date)}</span>
      </div>

      <div className="payouts-customer-cell">
        <strong>{order.customer_name || "Unknown customer"}</strong>
        <span>{order.platform || "Manual"}</span>
      </div>

      <div className="payouts-amount-cell">
        <span className="payouts-mobile-label">Payout</span>
        {amountMissing ? (
          <button
            className="payouts-missing-amount"
            onClick={() => onEdit(order)}
            type="button"
          >
            <Icon name="missing" size={14} />
            Add payout amount
          </button>
        ) : (
          <strong
            className={`payouts-money-value ${
              order.payout_status === "Received" ? "is-received" : ""
            }`}
          >
            USD {formatAmount(payoutAmount)}
          </strong>
        )}
      </div>

      <div className="payouts-status-cell">
        <span
          className={`payouts-status ${getStatusClass(order.payout_status)}`}
        >
          {getStatusLabel(order.payout_status)}
        </span>
        <small>{formatDate(order.payout_received_date)}</small>
      </div>

      <div className="payouts-actions">
        <button
          aria-label={`Edit payout for order ${order.order_no}`}
          className="payouts-icon-button"
          disabled={isSaving}
          onClick={() => onEdit(order)}
          title="Edit payout"
          type="button"
        >
          <Icon name="edit" size={16} />
        </button>
        {order.payout_status !== "Received" && (
          <button
            className="payouts-paid-button"
            disabled={isSaving}
            onClick={() => onMarkPaid(order)}
            type="button"
          >
            <Icon name="check" size={15} />
            {isSaving ? "Saving" : "Mark paid"}
          </button>
        )}
      </div>
    </article>
  );
}

function PayoutList({ isSaving, onEdit, onMarkPaid, orders }) {
  return (
    <div className="payouts-list">
      <div className="payouts-list-head" aria-hidden="true">
        <span>Order</span>
        <span>Customer</span>
        <span>Payout</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      {orders.map((order) => (
        <PayoutRow
          isSaving={isSaving(order.id)}
          key={order.id}
          onEdit={onEdit}
          onMarkPaid={onMarkPaid}
          order={order}
        />
      ))}
    </div>
  );
}

function Payouts() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingOrderId, setSavingOrderId] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [amountFilter, setAmountFilter] = useState("All");
  const [notice, setNotice] = useState(null);
  const [formError, setFormError] = useState("");
  const [showSummary, setShowSummary] = useState(true);

  const fetchOrders = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);

    try {
      const response = await api.get("/orders");
      setOrders(response.data);
      setNotice((current) => (current?.type === "error" ? null : current));
    } catch (error) {
      console.error("Fetch payouts error:", error);
      setNotice({ type: "error", text: "Unable to load the payout ledger." });
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    let isActive = true;

    api
      .get("/orders")
      .then((response) => {
        if (isActive) setOrders(response.data);
      })
      .catch((error) => {
        console.error("Fetch payouts error:", error);
        if (isActive) {
          setNotice({
            type: "error",
            text: "Unable to load the payout ledger.",
          });
        }
      })
      .finally(() => {
        if (isActive) setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!editingOrder) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !savingOrderId) {
        setEditingOrder(null);
        setForm(createEmptyForm());
        setFormError("");
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingOrder, savingOrderId]);

  const summary = useMemo(() => {
    const totalPayouts = orders.reduce(
      (sum, order) =>
        sum +
        Number(
          order.payout_amount_usd ||
            order.expected_payout_usd ||
            order.received_payout_usd ||
            0
        ),
      0
    );
    const totalReceived = orders.reduce(
      (sum, order) => sum + Number(order.received_payout_usd || 0),
      0
    );

    return {
      outstanding: Math.max(totalPayouts - totalReceived, 0),
      totalPayouts,
      totalReceived,
      orders: orders.length,
      pending: orders.filter((order) =>
        ["Not Received", "Partially Received", "On Hold"].includes(
          order.payout_status || "Not Received"
        )
      ).length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return [...orders]
      .filter((order) => {
        const matchesSearch =
          !query ||
          [order.order_no, order.customer_name, order.platform].some((value) =>
            String(value || "").toLowerCase().includes(query)
          );
        const matchesStatus =
          statusFilter === "All" || order.payout_status === statusFilter;
        const hasAmount =
          Number(
            order.payout_amount_usd ||
              order.expected_payout_usd ||
              order.received_payout_usd ||
              0
          ) > 0;
        const matchesAmount =
          amountFilter === "All" ||
          (amountFilter === "Missing" && !hasAmount) ||
          (amountFilter === "Recorded" && hasAmount);

        return matchesSearch && matchesStatus && matchesAmount;
      })
      .sort(
        (first, second) =>
          new Date(second.order_date || 0) - new Date(first.order_date || 0)
      );
  }, [amountFilter, orders, searchQuery, statusFilter]);

  const payoutGroups = useMemo(() => {
    const actionRequired = filteredOrders.filter((order) => {
      const payoutAmount = Number(
        order.payout_amount_usd ||
          order.expected_payout_usd ||
          order.received_payout_usd ||
          0
      );

      return payoutAmount <= 0 || order.payout_status === "Not Received";
    });
    const otherPayouts = filteredOrders.filter(
      (order) =>
        Number(
          order.payout_amount_usd ||
            order.expected_payout_usd ||
            order.received_payout_usd ||
            0
        ) > 0 &&
        order.payout_status !== "Not Received"
    );

    return [
      {
        key: "action-required",
        title: "Action required",
        description: "Orders with a missing amount or payout not received.",
        icon: "missing",
        orders: actionRequired,
      },
      {
        key: "recorded",
        title: "Other payouts",
        description: "Paid, partial, held, disputed, and refunded payouts.",
        icon: "money",
        orders: otherPayouts,
      },
    ];
  }, [filteredOrders]);
  const [actionRequiredGroup, ...ledgerPayoutGroups] = payoutGroups;
  const ledgerOrderCount = ledgerPayoutGroups.reduce(
    (total, group) => total + group.orders.length,
    0
  );

  const buildPayload = (order, values) => {
    const payoutAmount = Number(values.payout_amount_usd || 0);
    const payoutIsReceived = ["Received", "Partially Received"].includes(
      values.payout_status
    );

    return {
      order_total_usd: Number(order.order_total_usd || 0),
      platform_fee_usd: Number(order.platform_fee_usd || 0),
      deduction_usd: Number(order.deduction_usd || 0),
      expected_payout_usd: payoutAmount,
      expected_payout_date: order.expected_payout_date || null,
      payment_source: values.payment_source.trim() || null,
      payout_status: values.payout_status,
      received_payout_usd: payoutIsReceived ? payoutAmount : 0,
      remaining_payout_usd: null,
      exchange_rate: Number(order.exchange_rate || 0),
      received_pkr: Number(order.received_pkr || 0),
      bank_charges_pkr: Number(order.bank_charges_pkr || 0),
      final_received_pkr: Number(order.final_received_pkr || 0),
      payout_notes: values.payout_notes.trim() || null,
      payout_received_date:
        payoutIsReceived && values.payout_received_date
          ? `${values.payout_received_date}T00:00:00`
          : null,
    };
  };

  const openEdit = (order, nextStatus = null) => {
    setEditingOrder(order);
    setForm({
      payout_amount_usd:
        order.payout_amount_usd ||
        order.expected_payout_usd ||
        order.received_payout_usd ||
        "",
      payout_received_date: order.payout_received_date
        ? order.payout_received_date.slice(0, 10)
        : "",
      payout_status:
        nextStatus || order.payout_status || "Not Received",
      payment_source: order.payment_source || "",
      payout_notes: order.payout_notes || "",
    });
    setNotice(null);
    setFormError("");
  };

  const closeEdit = () => {
    if (savingOrderId) return;
    setEditingOrder(null);
    setForm(createEmptyForm());
    setFormError("");
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const savePayout = async (event) => {
    event.preventDefault();
    if (!editingOrder) return;

    const amount = Number(form.payout_amount_usd || 0);
    if (
      ["Received", "Partially Received"].includes(form.payout_status) &&
      amount <= 0
    ) {
      setFormError(
        "Enter the payout amount before marking this order as paid."
      );
      return;
    }

    setFormError("");
    setSavingOrderId(editingOrder.id);
    try {
      const response = await api.put(
        `/orders/${editingOrder.id}/payout`,
        buildPayload(editingOrder, form)
      );
      setEditingOrder(null);
      setForm(createEmptyForm());
      setNotice({
        type: "success",
        text:
          response.data.payout_status === "Partially Received"
            ? `Order #${editingOrder.order_no} was saved as a partial payout.`
            : `Payout for order #${editingOrder.order_no} was updated.`,
      });
      await fetchOrders({ quiet: true });
    } catch (error) {
      console.error("Update payout error:", error);
      setFormError(
        error.response?.data?.detail || "Unable to update the payout."
      );
    } finally {
      setSavingOrderId(null);
    }
  };

  const markPaid = async (order) => {
    const payoutAmount = Number(
      order.payout_amount_usd ||
        order.expected_payout_usd ||
        order.received_payout_usd ||
        0
    );

    if (payoutAmount <= 0) {
      openEdit(order, "Received");
      setFormError(
        `Add the payout amount for order #${order.order_no} before marking it paid.`
      );
      return;
    }

    const values = {
      payout_amount_usd: payoutAmount,
      payout_received_date: order.payout_received_date
        ? order.payout_received_date.slice(0, 10)
        : localDateValue(),
      payout_status: "Received",
      payment_source: order.payment_source || "",
      payout_notes: order.payout_notes || "",
    };

    setSavingOrderId(order.id);
    try {
      const response = await api.put(
        `/orders/${order.id}/payout`,
        buildPayload(order, values)
      );
      setNotice({
        type: "success",
        text:
          response.data.payout_status === "Received"
            ? `Order #${order.order_no} is marked paid.`
            : `Order #${order.order_no} remains partial because an expected balance is still due.`,
      });
      await fetchOrders({ quiet: true });
    } catch (error) {
      console.error("Mark payout paid error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Unable to mark the payout paid.",
      });
    } finally {
      setSavingOrderId(null);
    }
  };

  return (
    <div className="payouts-page">
      <header
        className={`payouts-page-header ${showSummary ? "is-expanded" : ""}`}
      >
        <div className="payouts-page-header-main">
          <div>
            <h1>Payouts</h1>
          </div>

          <div className="payouts-header-actions">
            <button
              aria-controls="payouts-header-summary"
              aria-expanded={showSummary}
              className="payouts-summary-toggle"
              onClick={() => setShowSummary((current) => !current)}
              type="button"
            >
              {showSummary ? "Hide summary" : "Show summary"}
              <Icon name="chevron" size={16} />
            </button>

          </div>
        </div>

        {showSummary && (
          <section
            aria-label="Payout summary"
            className="payouts-summary-strip"
            id="payouts-header-summary"
          >
            <article>
              <div className="payouts-summary-icon is-total">
                <Icon name="money" />
              </div>
              <div>
                <span>Total payouts</span>
                <strong>USD {formatAmount(summary.totalPayouts)}</strong>
              </div>
            </article>
            <article>
              <div className="payouts-summary-icon is-received">
                <Icon name="check" />
              </div>
              <div>
                <span>Payouts received</span>
                <strong>USD {formatAmount(summary.totalReceived)}</strong>
              </div>
            </article>
            <article>
              <div className="payouts-summary-icon is-orders">
                <Icon name="orders" />
              </div>
              <div>
                <span>Outstanding</span>
                <strong>USD {formatAmount(summary.outstanding)}</strong>
              </div>
            </article>
            <article>
              <div className="payouts-summary-icon is-pending">
                <Icon name="clock" />
              </div>
              <div>
                <span>Pending payouts</span>
                <strong>{summary.pending}</strong>
              </div>
            </article>
          </section>
        )}
      </header>

      {notice && (
        <div
          className={`payouts-notice is-${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
            type="button"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <section
        aria-labelledby="action-required-payouts-title"
        className="payouts-action-required-section"
      >
        <div className="payouts-action-required-header">
          <div className="payouts-group-heading">
            <div>
              <h2 id="action-required-payouts-title">Action required</h2>
              <p>Missing amounts and payouts that have not arrived.</p>
            </div>
          </div>
          <strong className="payouts-group-count">
            {actionRequiredGroup.orders.length}
          </strong>
        </div>

        {loading && orders.length === 0 ? (
          <div className="payouts-loading-list">
            {[1, 2].map((item) => (
              <div className="payouts-loading-row" key={item} />
            ))}
          </div>
        ) : actionRequiredGroup.orders.length > 0 ? (
          <PayoutList
            isSaving={(orderId) => savingOrderId === orderId}
            onEdit={openEdit}
            onMarkPaid={markPaid}
            orders={actionRequiredGroup.orders}
          />
        ) : (
          <div className="payouts-group-empty">
            No payouts currently require action.
          </div>
        )}
      </section>

      <section className="payouts-ledger">
        <div className="payouts-ledger-header">
          <div className="payouts-ledger-title">
            <div>
              <h2>Payout ledger</h2>
            </div>
            <span className="payouts-result-count">
              {ledgerOrderCount} shown
            </span>
          </div>

          <div className="payouts-toolbar">
            <label className="payouts-search">
              <Icon name="search" size={17} />
              <input
                aria-label="Search payouts"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search order, customer, or platform"
                value={searchQuery}
              />
            </label>

            <select
              aria-label="Filter by payout status"
              className="payouts-filter"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="All">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by payout amount"
              className="payouts-filter"
              onChange={(event) => setAmountFilter(event.target.value)}
              value={amountFilter}
            >
              <option value="All">All amounts</option>
              <option value="Missing">Amount missing</option>
              <option value="Recorded">Amount recorded</option>
            </select>
          </div>
        </div>

        {loading && orders.length === 0 ? (
          <div className="payouts-loading-list">
            {[1, 2, 3, 4].map((item) => (
              <div className="payouts-loading-row" key={item} />
            ))}
          </div>
        ) : ledgerOrderCount === 0 ? (
          <div className="payouts-empty-state">
            <div>
              <Icon name="money" size={24} />
            </div>
            <h3>No ledger payouts found</h3>
            <p>Try changing the search or payout filters.</p>
          </div>
        ) : (
          <PayoutList
            isSaving={(orderId) => savingOrderId === orderId}
            onEdit={openEdit}
            onMarkPaid={markPaid}
            orders={ledgerPayoutGroups.flatMap((group) => group.orders)}
          />
        )}
      </section>

      {editingOrder && (
        <div
          className="payouts-modal-overlay"
          onMouseDown={closeEdit}
          role="presentation"
        >
          <div
            aria-labelledby="payouts-modal-title"
            aria-modal="true"
            className="payouts-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="payouts-modal-header">
              <div>
                <h2 id="payouts-modal-title">
                  Order #{editingOrder.order_no}
                </h2>
                <p>
                  {editingOrder.customer_name} /{" "}
                  {editingOrder.platform || "Manual"}
                </p>
              </div>
              <button
                aria-label="Close payout editor"
                className="payouts-modal-close"
                disabled={Boolean(savingOrderId)}
                onClick={closeEdit}
                type="button"
              >
                <Icon name="close" size={17} />
              </button>
            </div>

            <form className="payouts-form" onSubmit={savePayout}>
              {formError && (
                <div className="payouts-form-error" role="alert">
                  <Icon name="missing" size={17} />
                  <span>{formError}</span>
                </div>
              )}

              <div className="payouts-form-grid">
                <label className="payouts-field is-highlighted">
                  <span>Payout amount (USD)</span>
                  <input
                    autoFocus
                    min="0"
                    name="payout_amount_usd"
                    onChange={handleFormChange}
                    placeholder="Enter payout amount"
                    step="0.01"
                    type="number"
                    value={form.payout_amount_usd}
                  />
                </label>

                <label className="payouts-field">
                  <span>Received date</span>
                  <input
                    name="payout_received_date"
                    onChange={handleFormChange}
                    type="date"
                    value={form.payout_received_date}
                  />
                </label>

                <label className="payouts-field">
                  <span>Payout status</span>
                  <select
                    name="payout_status"
                    onChange={handleFormChange}
                    value={form.payout_status}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="payouts-field">
                  <span>Payment source</span>
                  <input
                    name="payment_source"
                    onChange={handleFormChange}
                    placeholder="Bank, Payoneer, Wise..."
                    type="text"
                    value={form.payment_source}
                  />
                </label>

                <label className="payouts-field is-wide">
                  <span>Internal note</span>
                  <textarea
                    name="payout_notes"
                    onChange={handleFormChange}
                    placeholder="Add a reconciliation note"
                    rows="3"
                    value={form.payout_notes}
                  />
                </label>
              </div>

              <div className="payouts-modal-footer">
                <button
                  className="payouts-cancel-button"
                  disabled={Boolean(savingOrderId)}
                  onClick={closeEdit}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="payouts-save-button"
                  disabled={Boolean(savingOrderId)}
                  type="submit"
                >
                  {savingOrderId ? "Saving payout..." : "Save payout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Payouts;
