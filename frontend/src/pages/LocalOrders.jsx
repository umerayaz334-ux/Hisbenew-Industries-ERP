import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./LocalOrders.css";
import "./ServiceTakerWorkspace.css";

const isRupeeCurrency = (curr) => String(curr || "").toUpperCase() === "PKR";

const formatAmountForInput = (val, curr = "USD") => {
  const amount = Number(val || 0);
  if (!amount) return "";
  return isRupeeCurrency(curr) ? String(Math.round(amount)) : String(amount);
};

const sanitizeAmountInput = (val, curr = "USD") => {
  const next = String(val ?? "");
  return isRupeeCurrency(curr) ? next.replace(/[^\d]/g, "") : next;
};

const money = (val, curr = "PKR") => {
  const amount = Number(val || 0);
  if (isRupeeCurrency(curr)) {
    return `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: curr || "USD" }).format(amount);
};

const number = (val) => new Intl.NumberFormat("en-US").format(Number(val || 0));

const proofIsImage = (url = "") => /\.(png|jpg|jpeg|webp)$/i.test(String(url).split("?")[0]);

function PaymentProofThumb({ payment }) {
  const proofUrl = payment?.proof_url ? getStaticUrl(payment.proof_url) : "";
  if (!proofUrl) {
    return (
      <div className="local-payment-proof-thumb is-empty">
        <span>No proof</span>
      </div>
    );
  }
  return (
    <a
      className="local-payment-proof-thumb"
      href={proofUrl}
      onClick={(event) => event.stopPropagation()}
      rel="noreferrer"
      target="_blank"
      title="Open payment proof"
    >
      {proofIsImage(payment.proof_url) ? (
        <img alt="Payment proof" src={proofUrl} />
      ) : (
        <span>PDF</span>
      )}
    </a>
  );
}
const formatDateTime = (val) => {
  if (!val) return "Not set";
  const d = new Date(val);
  return Number.isNaN(d.getTime())
    ? "Not set"
    : d.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const shortDate = (val) => {
  if (!val) return "Not set";
  const d = new Date(val);
  return Number.isNaN(d.getTime())
    ? "Not set"
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const manufacturingRoadmapSteps = [
  "Quote requested",
  "Quoted",
  "Deposit pending",
  "Confirmed",
  "In production",
  "Quality check",
  "Ready",
  "Completed",
];

const openAcceptedManufacturingStatuses = [
  "Deposit pending",
  "Confirmed",
  "In production",
  "Quality check",
  "Ready",
];

const manufacturingStepIndex = (status) => {
  const index = manufacturingRoadmapSteps.indexOf(status);
  return index;
};

const workflowMilestones = [
  { key: "Quote requested", label: "Requested" },
  { key: "Quoted", label: "Quoted" },
  { key: "Deposit pending", label: "Deposit" },
  { key: "Confirmed", label: "Confirmed" },
  { key: "In production", label: "In Production" },
  { key: "Quality check", label: "QC" },
  { key: "Ready", label: "Ready" },
  { key: "Completed", label: "Completed" },
];

function LocalOrderWorkflowTimeline({ order, onSelectStage = null, interactive = false }) {
  if (!order) return null;
  const currentStatus = order.status || "Quote requested";
  const isRejectedOrCancelled = ["Rejected", "Cancelled"].includes(currentStatus);
  const activeIdx = manufacturingStepIndex(currentStatus);

  const getMilestoneDate = (milestone, idx) => {
    if (milestone.key === "Quote requested" || idx === 0) return order.created_at ? shortDate(order.created_at) : "Created";
    if (milestone.key === "Confirmed" && order.confirmed_at) return shortDate(order.confirmed_at);
    if (milestone.key === "In production" && order.production_started_at) return shortDate(order.production_started_at);
    if (milestone.key === "Ready" && order.ready_at) return shortDate(order.ready_at);
    if (milestone.key === "Completed" && order.completed_at) return shortDate(order.completed_at);
    
    const matchingUpdate = (order.updates || []).find((u) => u.status === milestone.key);
    if (matchingUpdate?.created_at) return shortDate(matchingUpdate.created_at);

    if (idx <= activeIdx && order.updated_at) return shortDate(order.updated_at);
    return null;
  };

  const calculateProgressPercent = () => {
    if (isRejectedOrCancelled || activeIdx < 0) return 0;
    if (activeIdx >= workflowMilestones.length - 1) return 100;
    return Math.round((activeIdx / (workflowMilestones.length - 1)) * 100);
  };

  return (
    <div className={`service-workflow-timeline-wrapper ${isRejectedOrCancelled ? "is-closed" : ""}`}>
      <div className="service-workflow-timeline-track-container">
        <button
          type="button"
          className="service-workflow-nav-btn is-prev"
          aria-label="Previous milestone"
          onClick={() => {
            if (interactive && onSelectStage && activeIdx > 0) {
              onSelectStage(manufacturingRoadmapSteps[activeIdx - 1]);
            }
          }}
          disabled={!interactive || activeIdx <= 0}
          title="Previous Stage"
        >
          <span>&#8249;</span>
        </button>

        <div className="service-workflow-timeline-rail">
          <div className="service-workflow-track-bg">
            <div
              className="service-workflow-track-fill"
              style={{ width: `${calculateProgressPercent()}%` }}
            />
          </div>

          {workflowMilestones.map((milestone, idx) => {
            const isCompleted = !isRejectedOrCancelled && activeIdx > idx;
            const isCurrent = !isRejectedOrCancelled && activeIdx === idx;
            const isPending = !isRejectedOrCancelled && activeIdx < idx;
            const dateStr = getMilestoneDate(milestone, idx);

            return (
              <div
                key={milestone.key}
                className={`service-workflow-node ${isCompleted ? "is-completed" : ""} ${
                  isCurrent ? "is-current" : ""
                } ${isPending ? "is-pending" : ""} ${interactive ? "is-clickable" : ""}`}
                onClick={() => {
                  if (interactive && onSelectStage) {
                    onSelectStage(milestone.key);
                  }
                }}
                title={`${milestone.label} - ${dateStr || "Pending"}`}
              >
                <div className="service-workflow-node-date">
                  {dateStr || (isCurrent ? "In Progress" : "\u00A0")}
                </div>

                <div className="service-workflow-node-dot">
                  {isCompleted ? (
                    <span className="service-workflow-check">&#10003;</span>
                  ) : (
                    <span className="service-workflow-inner-circle" />
                  )}
                </div>

                <div className="service-workflow-node-label">{milestone.label}</div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="service-workflow-nav-btn is-next"
          aria-label="Next milestone"
          onClick={() => {
            if (interactive && onSelectStage && activeIdx < manufacturingRoadmapSteps.length - 1) {
              onSelectStage(manufacturingRoadmapSteps[activeIdx + 1]);
            }
          }}
          disabled={!interactive || activeIdx >= manufacturingRoadmapSteps.length - 1}
          title="Next Stage"
        >
          <span>&#8250;</span>
        </button>
      </div>
    </div>
  );
}

const pendingDepositPayments = (order) =>
  (order?.payments || []).filter((payment) => payment.status === "Pending confirmation");

export default function LocalOrders() {
  const [data, setData] = useState({ clients: [], manufacturing_orders: [], orders: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [quoteForm, setQuoteForm] = useState({
    status: "Quoted",
    quoted_unit_price: "",
    tooling_cost: "",
    deposit_required: "",
    estimated_ready_at: "",
    update_message: "",
    admin_notes: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_type: "Deposit",
    method: "Bank Transfer",
    reference: "",
    note: "",
  });
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showCancelOrder, setShowCancelOrder] = useState(false);
  const [cancelConfirmText, setCancelConfirmText] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get("/service-takers/admin/dashboard");
      const nextData = res.data || {};
      setData(nextData);
      setError("");
      return nextData;
    } catch (e) {
      setError("Failed to load local manufacturing orders.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const orders = Array.isArray(data.manufacturing_orders) ? data.manufacturing_orders : [];
  const clients = Array.isArray(data.clients) ? data.clients : [];
  const fulfillmentOrders = Array.isArray(data.orders) ? data.orders : [];
  const pendingPaymentRows = useMemo(
    () =>
      orders.flatMap((order) =>
        pendingDepositPayments(order).map((payment) => ({ order, payment }))
      ),
    [orders]
  );
  const pendingPaymentTotal = useMemo(
    () => pendingPaymentRows.reduce((sum, row) => sum + Number(row.payment.amount || 0), 0),
    [pendingPaymentRows]
  );
  const selectedServiceTakerOpenOrders = useMemo(() => {
    if (!selectedOrder) return [];
    return orders
      .filter(
        (order) =>
          order.id !== selectedOrder.id &&
          Number(order.service_taker_id) === Number(selectedOrder.service_taker_id) &&
          openAcceptedManufacturingStatuses.includes(order.status)
      )
      .slice(0, 5);
  }, [orders, selectedOrder]);

  // Helper to calculate total pending balance for a specific service taker across all orders & services
  const getServiceTakerTotalPendingBalance = (serviceTakerId) => {
    if (!serviceTakerId) return 0;
    const clientLocalDue = orders
      .filter((o) => Number(o.service_taker_id) === Number(serviceTakerId) && openAcceptedManufacturingStatuses.includes(o.status))
      .reduce((sum, o) => sum + Number(o.balance_due || 0), 0);
    const clientOrderDue = fulfillmentOrders
      .filter((o) => Number(o.service_taker_id) === Number(serviceTakerId) && o.status !== "Cancelled")
      .reduce((sum, o) => sum + Number(o.total_cost || 0), 0);
    return Math.round((clientLocalDue + clientOrderDue + Number.EPSILON) * 100) / 100;
  };

  const handleSelectOrder = (order) => {
    setSelectedOrder(order);
    setQuoteForm({
      status: order.status || "Quote requested",
      quoted_unit_price: order.quoted_unit_price ?? "",
      tooling_cost: order.tooling_cost ?? "",
      deposit_required: order.deposit_required ?? "",
      estimated_ready_at: order.estimated_ready_at ? order.estimated_ready_at.slice(0, 10) : "",
      update_message: "",
      admin_notes: order.admin_notes || "",
    });
    setShowRecordPayment(false);
    setShowActivityLog(false);
    setShowCancelOrder(false);
    setCancelConfirmText("");
    setPaymentForm({
      amount: formatAmountForInput(order.deposit_balance_due > 0 ? order.deposit_balance_due : (order.balance_due > 0 ? order.balance_due : ""), order.currency),
      payment_type: order.deposit_balance_due > 0 ? "Deposit" : "Balance",
      method: "Bank Transfer",
      reference: "",
      note: "",
    });
  };

  const advanceManufacturingStage = async (order, targetStage) => {
    if (!order || !targetStage) return;
    setBusy(`stage-${targetStage}`);
    try {
      await api.patch(`/service-takers/admin/local-orders/${order.id}`, {
        status: targetStage,
        update_message: `Workflow advanced to ${targetStage} from company console.`,
      });
      setNotice(`Order status updated to ${targetStage}.`);
      const nextData = await loadData(true);
      const updated = (nextData?.manufacturing_orders || []).find((o) => o.id === order.id);
      if (updated) handleSelectOrder(updated);
    } catch (err) {
      setError(err?.response?.data?.detail || `Failed to update status to ${targetStage}.`);
    } finally {
      setBusy("");
    }
  };

  const handleSaveQuote = async (e) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setBusy("save-quote");
    try {
      const payload = {
        status: quoteForm.status,
        quoted_unit_price: quoteForm.quoted_unit_price === "" ? null : Number(quoteForm.quoted_unit_price),
        tooling_cost: quoteForm.tooling_cost === "" ? null : Number(quoteForm.tooling_cost),
        deposit_required: quoteForm.deposit_required === "" ? null : Number(quoteForm.deposit_required),
        estimated_ready_at: quoteForm.estimated_ready_at ? `${quoteForm.estimated_ready_at}T00:00:00` : null,
        update_message: quoteForm.update_message || null,
        admin_notes: quoteForm.admin_notes || null,
      };
      await api.patch(`/service-takers/admin/local-orders/${selectedOrder.id}`, payload);
      setNotice("Quote & order status updated successfully.");
      const nextData = await loadData(true);
      const updated = (nextData?.manufacturing_orders || []).find((o) => o.id === selectedOrder.id);
      if (updated) handleSelectOrder(updated);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not save quote.");
    } finally {
      setBusy("");
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!selectedOrder || !paymentForm.amount) return;
    setBusy("record-payment");
    try {
      await api.post(`/service-takers/admin/local-orders/${selectedOrder.id}/payments`, {
        amount: Number(paymentForm.amount),
        payment_type: paymentForm.payment_type,
        method: paymentForm.method,
        reference: paymentForm.reference,
        note: paymentForm.note,
      });
      setNotice("Payment recorded successfully.");
      setPaymentForm((prev) => ({ ...prev, amount: "", reference: "", note: "" }));
      const nextData = await loadData(true);
      const updated = (nextData?.manufacturing_orders || []).find((o) => o.id === selectedOrder.id);
      if (updated) handleSelectOrder(updated);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not record payment.");
    } finally {
      setBusy("");
    }
  };

  const handleConfirmPayment = async (payment, orderOverride = null) => {
    const orderForPayment = orderOverride || selectedOrder;
    if (!orderForPayment || !payment) return;
    setBusy(`confirm-payment-${payment.id}`);
    try {
      await api.post(
        `/service-takers/admin/local-orders/${orderForPayment.id}/payments/${payment.id}/confirm`
      );
      setNotice(`${orderForPayment.request_no} ${payment.payment_type || "payment"} confirmed successfully.`);
      const refreshed = await loadData(true);
      const updated = (refreshed?.manufacturing_orders || []).find((o) => o.id === orderForPayment.id);
      if (updated && selectedOrder?.id === orderForPayment.id) handleSelectOrder(updated);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not confirm payment.");
    } finally {
      setBusy("");
    }
  };
  const cancelSelectedOrder = async () => {
    if (!selectedOrder || cancelConfirmText.trim() !== selectedOrder.request_no) return;
    setBusy(`cancel-order-${selectedOrder.id}`);
    try {
      await api.patch(`/service-takers/admin/local-orders/${selectedOrder.id}`, {
        status: "Cancelled",
        update_message: `Order ${selectedOrder.request_no} cancelled by company.`,
      });
      setNotice(`${selectedOrder.request_no} cancelled.`);
      setShowCancelOrder(false);
      setCancelConfirmText("");
      const refreshed = await loadData(true);
      const updated = (refreshed?.manufacturing_orders || []).find((order) => order.id === selectedOrder.id);
      if (updated) handleSelectOrder(updated);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not cancel order.");
    } finally {
      setBusy("");
    }
  };
  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (clientFilter !== "all" && String(o.service_taker_id) !== String(clientFilter)) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(o.request_no || "").toLowerCase().includes(q) ||
        String(o.company_name || "").toLowerCase().includes(q) ||
        String(o.product_name || "").toLowerCase().includes(q) ||
        String(o.steel_type || "").toLowerCase().includes(q) ||
        String(o.status || "").toLowerCase().includes(q)
      );
    });
  }, [orders, clientFilter, statusFilter, search]);

  const stats = useMemo(() => {
    const totalRequests = orders.length;
    const pendingQuotes = orders.filter((o) => o.status === "Quote requested").length;
    const inProd = orders.filter((o) => o.status === "In production" || o.status === "Confirmed").length;
    const totalDue = orders.reduce((sum, o) => sum + Number(o.balance_due || 0), 0);
    const pendingDeposits = pendingPaymentRows.length;
    return { totalRequests, pendingQuotes, inProd, totalDue, pendingDeposits, pendingPaymentTotal };
  }, [orders, pendingPaymentRows, pendingPaymentTotal]);
  const statusList = [
    "all",
    "Quote requested",
    "Quoted",
    "Rejected",
    "Deposit pending",
    "Confirmed",
    "In production",
    "Quality check",
    "Ready",
    "Completed",
    "Cancelled",
  ];

  return (
    <div className="local-orders-page">
      <header className="local-orders-header">
        <div>
          <h1>Local Orders</h1>
          <p>Company-side manufacturing workflows, client quotes, and milestone timelines.</p>
        </div>
        <div className="local-orders-header-actions">
          <button className="local-btn-secondary" onClick={() => loadData()}>
            Refresh
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div style={{
          padding: "10px 16px",
          borderRadius: 6,
          background: error ? "#fee2e2" : "#dcfce7",
          color: error ? "#991b1b" : "#166534",
          fontSize: 13,
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>{error || notice}</span>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontWeight: "bold" }} onClick={() => { setError(""); setNotice(""); }}>x</button>
        </div>
      )}

      <section className="local-orders-metrics">
        <div className="local-orders-metric-card">
          <span>Total Requests</span>
          <strong>{number(stats.totalRequests)}</strong>
          <small>Active & Completed</small>
        </div>
        <div className="local-orders-metric-card is-warning">
          <span>Quote Needed</span>
          <strong>{number(stats.pendingQuotes)}</strong>
          <small>Awaiting company price</small>
        </div>
        <div className="local-orders-metric-card">
          <span>Payment Checks</span>
          <strong>{number(stats.pendingDeposits)}</strong>
          <small>{money(stats.pendingPaymentTotal)} waiting</small>
        </div>
        <div className="local-orders-metric-card">
          <span>Total Dues</span>
          <strong>{money(stats.totalDue)}</strong>
          <small>Pending balance</small>
        </div>
      </section>

      {pendingPaymentRows.length > 0 && (
        <section className="local-payment-confirmation-board">
          <header>
            <div>
              <span>Payment confirmations</span>
              <h2>{money(pendingPaymentTotal)}</h2>
            </div>
            <strong>{number(pendingPaymentRows.length)} pending</strong>
          </header>
          <div className="local-payment-confirmation-grid">
            {pendingPaymentRows.map(({ order, payment }) => (
              <article key={payment.id} onClick={() => handleSelectOrder(order)}>
                <PaymentProofThumb payment={payment} />
                <div className="local-payment-confirmation-main">
                  <strong>{order.company_name}</strong>
                  <span>{order.request_no} / {order.product_name}</span>
                  <small>{payment.note || "Client payment proof"}</small>
                </div>
                <div className="local-payment-confirmation-amount">
                  <span>{payment.payment_type || "Payment"}</span>
                  <strong>{money(payment.amount, order.currency)}</strong>
                  <small>{shortDate(payment.created_at)}</small>
                </div>
                <div className="local-payment-confirmation-actions">
                  <button
                    className="local-btn-primary"
                    disabled={busy === `confirm-payment-${payment.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleConfirmPayment(payment, order);
                    }}
                    type="button"
                  >
                    Confirm
                  </button>
                  <button
                    className="local-btn-secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectOrder(order);
                    }}
                    type="button"
                  >
                    Open
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="local-orders-filter-bar">
        <input
          className="local-search-input"
          placeholder="Search orders, clients, products, steel..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="local-filter-select"
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>
        <div className="local-orders-status-pills">
          {statusList.map((st) => (
            <button
              key={st}
              className={`local-status-pill ${statusFilter === st ? "is-active" : ""}`}
              onClick={() => setStatusFilter(st)}
              type="button"
            >
              {st === "all" ? "All" : st}
            </button>
          ))}
        </div>
      </div>

      <div className="local-orders-content-layout">
        <div className="local-orders-table-card">
          <div className="local-orders-table-wrapper">
            <table className="local-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Service Taker</th>
                  <th>Product</th>
                  <th>Specs</th>
                  <th>Qty</th>
                  <th>Quote</th>
                  <th>Deposit</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: "center", padding: "36px", color: "#64748b" }}>
                      No local manufacturing requests found.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((ord) => {
                    const badgeClass = `is-${String(ord.status || '').toLowerCase().replace(/\s+/g, '-')}`;
                    return (
                      <tr
                        key={ord.id}
                        className={selectedOrder?.id === ord.id ? "is-selected" : ""}
                        onClick={() => handleSelectOrder(ord)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <strong>{ord.request_no}</strong>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{shortDate(ord.created_at)}</div>
                        </td>
                        <td>
                          <strong>{ord.company_name}</strong>
                          <div style={{ fontSize: 10.5, color: '#0f766e', fontWeight: 600 }}>
                            Pending: {money(getServiceTakerTotalPendingBalance(ord.service_taker_id), ord.currency)}
                          </div>
                        </td>
                        <td>
                          <div className="local-order-product-cell">
                            <div className="local-order-thumb">
                              {ord.image_url ? (
                                <img alt={ord.product_name} src={getStaticUrl(ord.image_url)} />
                              ) : (
                                <span>{String(ord.product_name || ord.request_no).charAt(0)}</span>
                              )}
                            </div>
                            <div>
                              <strong>{ord.product_name}</strong>
                              <small>{shortDate(ord.estimated_ready_at || ord.requested_ready_at)}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: 11.5, color: '#475569' }}>
                            {[ord.steel_type, ord.tang_type, ord.blade_length_in ? `${ord.blade_length_in}in` : null].filter(Boolean).join(" / ") || "Custom Spec"}
                          </span>
                        </td>
                        <td><strong>{number(ord.quantity)}</strong></td>
                        <td><strong>{money(ord.quoted_total, ord.currency)}</strong></td>
                        <td>{money(ord.deposit_required, ord.currency)}</td>
                        <td>
                          <strong style={{ color: Number(ord.balance_due || 0) > 0 ? "#b45309" : "#15803d" }}>
                            {money(ord.balance_due, ord.currency)}
                          </strong>
                          <div style={{ fontSize: 10.5, color: "#64748b" }}>Paid: {money(ord.paid_total, ord.currency)}</div>
                        </td>
                        <td>
                          <span className={`local-orders-badge ${badgeClass}`}>{ord.status}</span>
                        </td>
                        <td>
                          {["Rejected", "Cancelled"].includes(ord.status) ? (
                            <button
                              className="local-btn-secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectOrder(ord);
                              }}
                              type="button"
                              style={{ opacity: 0.8 }}
                            >
                              View Details
                            </button>
                          ) : (
                            <button
                              className="local-btn-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectOrder(ord);
                              }}
                              type="button"
                            >
                              Process &#8594;
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Redesigned Full Process Popup Modal for Local Orders */}
      {selectedOrder && (
        <div className="service-modal-backdrop" onMouseDown={() => setSelectedOrder(null)} role="presentation">
          <section
            aria-label="Local Order Process"
            className="service-modal service-local-order-process-modal"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
          >
            <header>
              <div>
                <h2>{selectedOrder.request_no} / {selectedOrder.product_name}</h2>
                <p>Company manufacturing console for {selectedOrder.company_name}</p>
              </div>
              <button
                aria-label="Close"
                className="service-icon-button"
                onClick={() => setSelectedOrder(null)}
                type="button"
              >
                x
              </button>
            </header>

            <div className="service-modal-body">
              <div className="service-process-modal-content">
                {/* Notice for Rejected / Cancelled Orders */}
                {["Rejected", "Cancelled"].includes(selectedOrder.status) && (
                  <div style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: selectedOrder.status === "Rejected" ? "#fef2f2" : "#f1f5f9",
                    border: selectedOrder.status === "Rejected" ? "1px solid #fecaca" : "1px solid #cbd5e1",
                    color: selectedOrder.status === "Rejected" ? "#991b1b" : "#475569",
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}>
                    <span style={{ fontSize: 18 }}>&#9888;</span>
                    <div>
                      <strong style={{ display: "block" }}>This order is {selectedOrder.status.toLowerCase()}.</strong>
                      <span style={{ fontSize: 11.5, fontWeight: 500 }}>
                        {selectedOrder.status === "Rejected"
                          ? "The quote was rejected by the customer or factory. Processing and modifications are closed."
                          : "This order was cancelled. No further manufacturing actions can be performed."}
                      </span>
                    </div>
                  </div>
                )}

                {/* Top Financial & Service Taker Balance Banner */}
                <div className="service-process-client-banner">
                  <div className="service-process-client-info">
                    <span className="service-process-badge">Service Taker</span>
                    <h3>{selectedOrder.company_name}</h3>
                    <p>
                      Requested {shortDate(selectedOrder.created_at)} / {selectedOrder.client_reference ? `Ref: ${selectedOrder.client_reference}` : 'Custom Order'}
                    </p>
                  </div>

                  {/* Highlighted Total Overall Pending Balance for this service taker */}
                  <div className="service-process-balance-highlight">
                    <span>Total Client Pending Balance</span>
                    <strong>
                      {money(
                        getServiceTakerTotalPendingBalance(selectedOrder.service_taker_id),
                        selectedOrder.currency
                      )}
                    </strong>
                    <small>Accepted local orders & fulfillment fees</small>
                  </div>
                </div>

                {selectedServiceTakerOpenOrders.length > 0 && (
                  <section className="local-client-open-orders">
                    <header>
                      <span>Other open orders</span>
                      <strong>{number(selectedServiceTakerOpenOrders.length)}</strong>
                    </header>
                    <div>
                      {selectedServiceTakerOpenOrders.map((order) => (
                        <button key={order.id} type="button" onClick={() => handleSelectOrder(order)}>
                          <span>{order.request_no}</span>
                          <strong>{order.product_name}</strong>
                          <small>{money(order.balance_due, order.currency)} due / {order.status}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {/* Automation Workflow Timeline */}
                <div className="service-process-workflow-section">
                  <div className="service-process-section-header">
                    <div>
                      <span>Automation Workflow</span>
                      <h4>Production Progress Timeline</h4>
                    </div>
                    <div className="service-workflow-quick-actions">
                      {selectedOrder.status === "Quote requested" && (
                        <button
                          type="button"
                          className="service-workflow-action-btn is-advance"
                          disabled={busy.startsWith("stage-")}
                          onClick={() => advanceManufacturingStage(selectedOrder, "Quoted")}
                        >
                          Give quote
                        </button>
                      )}
                      {["Quoted", "Deposit pending"].includes(selectedOrder.status) && (
                        <button
                          type="button"
                          className="service-workflow-action-btn is-advance"
                          disabled={busy.startsWith("stage-")}
                          onClick={() => advanceManufacturingStage(selectedOrder, "Confirmed")}
                        >
                          Confirm order
                        </button>
                      )}
                      {selectedOrder.status === "Confirmed" && (
                        <button
                          type="button"
                          className="service-workflow-action-btn is-advance"
                          disabled={busy.startsWith("stage-")}
                          onClick={() => advanceManufacturingStage(selectedOrder, "In production")}
                        >
                          Start production
                        </button>
                      )}
                      {selectedOrder.status === "In production" && (
                        <button
                          type="button"
                          className="service-workflow-action-btn is-advance"
                          disabled={busy.startsWith("stage-")}
                          onClick={() => advanceManufacturingStage(selectedOrder, "Quality check")}
                        >
                          Send to QC
                        </button>
                      )}
                      {selectedOrder.status === "Quality check" && (
                        <button
                          type="button"
                          className="service-workflow-action-btn is-advance"
                          disabled={busy.startsWith("stage-")}
                          onClick={() => advanceManufacturingStage(selectedOrder, "Ready")}
                        >
                          Mark ready
                        </button>
                      )}
                      {selectedOrder.status === "Ready" && (
                        <button
                          type="button"
                          className="service-workflow-action-btn is-complete"
                          disabled={busy.startsWith("stage-")}
                          onClick={() => advanceManufacturingStage(selectedOrder, "Completed")}
                        >
                          Mark completed
                        </button>
                      )}
                    </div>
                  </div>

                  <LocalOrderWorkflowTimeline
                    order={selectedOrder}
                    interactive={true}
                    onSelectStage={(newStage) => advanceManufacturingStage(selectedOrder, newStage)}
                  />
                </div>

                {/* Financial Status Summary Grid for this specific order */}
                <div className="service-process-stats-grid">
                  <div className="service-process-stat-card">
                    <span>Quoted Total</span>
                    <strong>{money(selectedOrder.quoted_total, selectedOrder.currency)}</strong>
                    <small>{number(selectedOrder.quantity)} units @ {money(selectedOrder.quoted_unit_price, selectedOrder.currency)}</small>
                  </div>
                  <div className="service-process-stat-card">
                    <span>Deposit Required</span>
                    <strong>{money(selectedOrder.deposit_required, selectedOrder.currency)}</strong>
                    <small>{money(selectedOrder.deposit_balance_due, selectedOrder.currency)} deposit due</small>
                  </div>
                  <div className="service-process-stat-card">
                    <span>Total Received</span>
                    <strong className="is-success">{money(selectedOrder.paid_total, selectedOrder.currency)}</strong>
                    <small>{(selectedOrder.payments || []).length} payment records</small>
                  </div>
                  <div className="service-process-stat-card is-highlight">
                    <span>This Order Balance Due</span>
                    <strong className={Number(selectedOrder.balance_due || 0) > 0 ? "is-due" : "is-settled"}>
                      {money(selectedOrder.balance_due, selectedOrder.currency)}
                    </strong>
                    <small>{Number(selectedOrder.balance_due || 0) > 0 ? "Pending payment" : "Fully Settled"}</small>
                  </div>
                </div>

                {/* Product Picture & Specifications */}
                <div className="service-process-specs-container">
                  <div className="service-process-spec-image-box">
                    {selectedOrder.image_url ? (
                      <img
                        alt={selectedOrder.product_name}
                        src={getStaticUrl(selectedOrder.image_url)}
                      />
                    ) : (
                      <div className="service-process-spec-no-image">
                        <span>{String(selectedOrder.product_name || selectedOrder.request_no).charAt(0)}</span>
                        <small>No photo uploaded</small>
                      </div>
                    )}
                    <label className="service-row-button is-file" style={{ marginTop: '8px', width: '100%', textAlign: 'center' }}>
                      {selectedOrder.image_url ? 'Replace Drawing' : 'Upload Drawing'}
                      <input
                        accept=".png,.jpg,.jpeg,.webp"
                        disabled={busy === 'upload-image'}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          const formData = new FormData();
                          formData.append("image_file", file);
                          setBusy('upload-image');
                          try {
                            await api.post(`/service-takers/admin/local-orders/${selectedOrder.id}/image`, formData);
                            setNotice("Product drawing updated.");
                            const nextData = await loadData(true);
                            const updated = (nextData?.manufacturing_orders || []).find((o) => o.id === selectedOrder.id);
                            if (updated) handleSelectOrder(updated);
                          } catch (err) {
                            setError("Failed to upload drawing.");
                          } finally {
                            setBusy('');
                          }
                        }}
                        type="file"
                      />
                    </label>
                  </div>

                  <div className="service-process-spec-details">
                    <h4>Product Specifications</h4>
                    <div className="service-spec-chips-grid">
                      <div>
                        <span>Quantity</span>
                        <strong>{number(selectedOrder.quantity)} Units</strong>
                      </div>
                      <div>
                        <span>Steel Type</span>
                        <strong>{selectedOrder.steel_type || 'N/A'}</strong>
                      </div>
                      <div>
                        <span>Tang</span>
                        <strong>{selectedOrder.tang_type || 'N/A'}</strong>
                      </div>
                      <div>
                        <span>Blade Size</span>
                        <strong>
                          {selectedOrder.blade_length_in ? `${selectedOrder.blade_length_in} in` : 'N/A'} / {selectedOrder.blade_thickness_mm ? `${selectedOrder.blade_thickness_mm} mm` : ''}
                        </strong>
                      </div>
                      <div>
                        <span>Overall Length</span>
                        <strong>{selectedOrder.overall_length_in ? `${selectedOrder.overall_length_in} in` : 'N/A'}</strong>
                      </div>
                      <div>
                        <span>Handle Material</span>
                        <strong>{selectedOrder.handle_material || 'N/A'}</strong>
                      </div>
                      <div>
                        <span>Sheath</span>
                        <strong>{selectedOrder.sheath_type || 'N/A'}</strong>
                      </div>
                      <div>
                        <span>Finish / Hardness</span>
                        <strong>{selectedOrder.finish || 'N/A'} {selectedOrder.hardness ? `(${selectedOrder.hardness})` : ''}</strong>
                      </div>
                      <div>
                        <span>Edge / Packaging</span>
                        <strong>{selectedOrder.edge_type || 'Plain'} / {selectedOrder.packaging || 'Bulk'}</strong>
                      </div>
                    </div>

                    {selectedOrder.notes && (
                      <div className="service-process-notes-callout">
                        <span>Client Notes / Instructions:</span>
                        <p>{selectedOrder.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pricing & Admin Management Form */}
                {!["Rejected", "Cancelled"].includes(selectedOrder.status) ? (
                <form
                  id="manufacturing-admin-edit-form"
                  className="service-process-form"
                  onSubmit={handleSaveQuote}
                >
                  <h4>Pricing & Administration</h4>
                  <div className="service-form-grid">
                    <label>
                      Status
                      <select
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            status: event.target.value,
                          }))
                        }
                        value={quoteForm.status || "Quote requested"}
                      >
                        {[
                          "Quote requested",
                          "Quoted",
                          "Rejected",
                          "Deposit pending",
                          "Confirmed",
                          "In production",
                          "Quality check",
                          "Ready",
                          "Completed",
                          "Cancelled",
                        ].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Unit Quote ({isRupeeCurrency(selectedOrder.currency) ? "Rs" : selectedOrder.currency || 'USD'})
                      <input
                      inputMode={isRupeeCurrency(selectedOrder.currency) ? "numeric" : "decimal"}
                        min="0"
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            quoted_unit_price: sanitizeAmountInput(event.target.value, selectedOrder.currency),
                          }))
                        }
                        step={isRupeeCurrency(selectedOrder.currency) ? "1" : "0.01"}
                        type="number"
                        value={quoteForm.quoted_unit_price ?? ""}
                      />
                    </label>
                    <label>
                      Tooling Cost ({isRupeeCurrency(selectedOrder.currency) ? "Rs" : selectedOrder.currency || 'USD'})
                      <input
                      inputMode={isRupeeCurrency(selectedOrder.currency) ? "numeric" : "decimal"}
                        min="0"
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            tooling_cost: sanitizeAmountInput(event.target.value, selectedOrder.currency),
                          }))
                        }
                        step={isRupeeCurrency(selectedOrder.currency) ? "1" : "0.01"}
                        type="number"
                        value={quoteForm.tooling_cost ?? ""}
                      />
                    </label>
                    <label>
                      Deposit Required ({isRupeeCurrency(selectedOrder.currency) ? "Rs" : selectedOrder.currency || 'USD'})
                      <input
                      inputMode={isRupeeCurrency(selectedOrder.currency) ? "numeric" : "decimal"}
                        min="0"
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            deposit_required: sanitizeAmountInput(event.target.value, selectedOrder.currency),
                          }))
                        }
                        step={isRupeeCurrency(selectedOrder.currency) ? "1" : "0.01"}
                        type="number"
                        value={quoteForm.deposit_required ?? ""}
                      />
                    </label>
                    <label>
                      Target Ready Date
                      <input
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            estimated_ready_at: event.target.value,
                          }))
                        }
                        type="date"
                        value={quoteForm.estimated_ready_at || ""}
                      />
                    </label>
                    <label className="service-wide-field">
                      Broadcast Update Message (Visible to Service Taker)
                      <textarea
                        placeholder="e.g. Damascus forging completed, moving to heat treatment..."
                        rows="2"
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            update_message: event.target.value,
                          }))
                        }
                        value={quoteForm.update_message || ""}
                      />
                    </label>
                    <label className="service-wide-field">
                      Internal Factory Notes (Private)
                      <textarea
                        placeholder="Worker assignments, batch codes, supplier steel notes..."
                        rows="2"
                        onChange={(event) =>
                          setQuoteForm((current) => ({
                            ...current,
                            admin_notes: event.target.value,
                          }))
                        }
                        value={quoteForm.admin_notes || ""}
                      />
                    </label>
                  </div>
                  <div className="service-detail-actions service-wide-field service-process-form-actions">
                    <button className="service-primary-button" disabled={busy === "save-quote"} type="submit">
                      {busy === "save-quote" ? "Saving..." : "Save quotation"}
                    </button>
                  </div>                </form>
                ) : null}

                {/* Payments & Verification Section */}
                <div className="service-process-payments-section">
                  <div className="service-process-section-header">
                    <div>
                      <span>Financial Management</span>
                      <h4>Payments & Proof Verification</h4>
                    </div>
                    {!["Rejected", "Cancelled"].includes(selectedOrder.status) && (
                      <button
                        type="button"
                        className={`service-workflow-action-btn ${showRecordPayment ? "is-complete" : "is-advance"}`}
                        onClick={() => setShowRecordPayment((prev) => !prev)}
                      >
                        {showRecordPayment ? "Hide Payment Form" : "+ Record Payment"}
                      </button>
                    )}
                  </div>

                  {/* Pending confirmation proofs uploaded by client */}
                  {(selectedOrder.payments || []).filter((p) => p.status === "Pending confirmation").length > 0 && (
                    <div className="service-process-pending-payments">
                      <h5>Pending Payment Confirmations</h5>
                      <div className="service-pending-confirmation-list" style={{ padding: 0 }}>
                        {(selectedOrder.payments || [])
                          .filter((p) => p.status === "Pending confirmation")
                          .map((payment) => (
                            <article key={payment.id} className="service-process-proof-card">
                              <div>
                                <strong>{payment.payment_type} Payment: {money(payment.amount, selectedOrder.currency)}</strong>
                                <span>{payment.note || "No note attached"} / Uploaded {shortDate(payment.created_at)}</span>
                              </div>
                              <div className="service-process-proof-actions">
                                <PaymentProofThumb payment={payment} />
                                <button
                                  type="button"
                                  className="service-primary-button is-compact"
                                  disabled={busy === `confirm-payment-${payment.id}`}
                                  onClick={() => handleConfirmPayment(payment, selectedOrder)}
                                >
                                  &#10003; Confirm & Settle
                                </button>
                              </div>
                            </article>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Record Manual Payment Form */}
                  {!["Rejected", "Cancelled"].includes(selectedOrder.status) && showRecordPayment && (
                  <div className="service-process-record-payment-box">
                    <h5>Record Manual Payment / Adjustment</h5>
                    <form className="service-form-grid" onSubmit={handleRecordPayment}>
                      <label>
                        Amount ({isRupeeCurrency(selectedOrder.currency) ? "Rs" : selectedOrder.currency || "USD"})
                        <input
                          inputMode={isRupeeCurrency(selectedOrder.currency) ? "numeric" : "decimal"}
                          min={isRupeeCurrency(selectedOrder.currency) ? "1" : "0.01"}
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              amount: sanitizeAmountInput(event.target.value, selectedOrder.currency),
                            }))
                          }
                          required
                          step={isRupeeCurrency(selectedOrder.currency) ? "1" : "0.01"}
                          type="number"
                          value={paymentForm.amount}
                        />
                      </label>
                      <label>
                        Payment Type
                        <select
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              payment_type: event.target.value,
                            }))
                          }
                          value={paymentForm.payment_type}
                        >
                          <option value="Deposit">Deposit</option>
                          <option value="Balance">Balance</option>
                          <option value="Adjustment">Adjustment</option>
                        </select>
                      </label>
                      <label>
                        Payment Method
                        <input
                          placeholder="Bank Transfer, Cash, Stripe..."
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              method: event.target.value,
                            }))
                          }
                          value={paymentForm.method}
                        />
                      </label>
                      <label>
                        Reference / Transaction ID
                        <input
                          placeholder="e.g. TXN-994812"
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              reference: event.target.value,
                            }))
                          }
                          value={paymentForm.reference}
                        />
                      </label>
                      <label className="service-wide-field">
                        Note
                        <textarea
                          rows="2"
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              note: event.target.value,
                            }))
                          }
                          value={paymentForm.note}
                        />
                      </label>
                      <div className="service-detail-actions service-wide-field">
                        <button
                          className="service-primary-button"
                          disabled={busy === "record-payment"}
                          type="submit"
                        >
                          Record Payment
                        </button>
                      </div>
                    </form>
                  </div>
                  )}
                </div>

                {!["Rejected", "Cancelled", "Completed"].includes(selectedOrder.status) && (
                  <section className="local-order-danger-zone">
                    <button
                      className="local-danger-text-button"
                      onClick={() => setShowCancelOrder((current) => !current)}
                      type="button"
                    >
                      Cancel order
                    </button>
                    {showCancelOrder && (
                      <div className="local-order-cancel-confirm">
                        <span>
                          Type <strong>{selectedOrder.request_no}</strong> to cancel this order.
                        </span>
                        <input
                          onChange={(event) => setCancelConfirmText(event.target.value)}
                          placeholder={selectedOrder.request_no}
                          value={cancelConfirmText}
                        />
                        <button
                          className="local-btn-secondary is-danger"
                          disabled={cancelConfirmText.trim() !== selectedOrder.request_no || busy === `cancel-order-${selectedOrder.id}`}
                          onClick={cancelSelectedOrder}
                          type="button"
                        >
                          {busy === `cancel-order-${selectedOrder.id}` ? "Cancelling..." : "Confirm cancel"}
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {/* Updates History Audit Trail (Collapsible, default closed) */}
                <div className="service-process-audit-timeline">
                  <div
                    className="service-process-section-header"
                    style={{ cursor: "pointer", userSelect: "none", marginBottom: showActivityLog ? 12 : 0 }}
                    onClick={() => setShowActivityLog((prev) => !prev)}
                  >
                    <div>
                      <span>Audit Trail</span>
                      <h4 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        Activity & Updates Log
                        <span style={{ fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 12 }}>
                          {(selectedOrder.updates || []).length} records
                        </span>
                      </h4>
                    </div>
                    <button
                      type="button"
                      className="service-workflow-action-btn is-advance"
                      style={{ padding: "4px 10px", fontSize: 11 }}
                    >
                      {showActivityLog ? "Hide log" : "View log"}
                    </button>
                  </div>

                  {showActivityLog && (
                    <>
                      {(selectedOrder.updates || []).length === 0 ? (
                        <p className="service-no-updates">No updates recorded yet.</p>
                      ) : (
                        <div className="service-process-update-items">
                          {(selectedOrder.updates || []).map((update) => {
                            const messageText = (update.message || "").toLowerCase();
                            const isServiceTaker =
                              update.actor_type === "service_taker" ||
                              update.status === "Quote requested" ||
                              messageText.includes("client") ||
                              messageText.includes("service taker") ||
                              messageText.includes("quote request submitted");
                            const updateMessage =
                              update.status === "Quote requested" && messageText.includes("quote request submitted")
                                ? "Quote request submitted by service taker."
                                : update.message;
                            return (
                              <div key={update.id} className="service-process-update-item">
                                <div className="service-process-update-icon">&#8226;</div>
                                <div className="service-process-update-content">
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                                    <strong style={{ color: "#0f766e" }}>{update.status}</strong>
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        padding: "2px 7px",
                                        borderRadius: 4,
                                        background: isServiceTaker ? "#e0f2fe" : "#fef3c7",
                                        color: isServiceTaker ? "#0369a1" : "#92400e",
                                        border: isServiceTaker ? "1px solid #bae6fd" : "1px solid #fde68a",
                                      }}
                                    >
                                      {isServiceTaker
                                        ? update.actor_name || selectedOrder.company_name || "Service Taker"
                                        : update.actor_name || "Company"}
                                    </span>
                                  </div>
                                  <p>{updateMessage}</p>
                                  <span style={{ fontSize: 10.5, color: "#64748b" }}>
                                    {formatDateTime(update.created_at)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <footer>
              <button
                className="service-secondary-button"
                onClick={() => setSelectedOrder(null)}
                type="button"
              >
                Close
              </button>
              {!["Rejected", "Cancelled"].includes(selectedOrder.status) && (
                <button
                  className="service-primary-button"
                  disabled={busy === "save-quote"}
                  form="manufacturing-admin-edit-form"
                  type="submit"
                >
                  Save quote & update
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}



