import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./ManufacturingServicePortal.css";
import ServiceAccountSettings from "../components/ServiceAccountSettings";

const activeStatuses = new Set(["Quote requested", "Quoted", "Deposit pending", "Confirmed", "In production", "Quality check", "Ready"]);
const steps = ["Quote requested", "Quoted", "Confirmed", "In production", "Quality check", "Ready", "Completed"];
const emptyOrders = [];

const formatMoney = (value, currency = "USD") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString()}`;
  }
};

const formatDate = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Date pending";

const amountDue = (order) => Math.max(0, Number(order?.balance_due || 0));

function DashboardMetricGlyph({ name }) {
  const common = { "aria-hidden": true, fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.8, viewBox: "0 0 24 24" };
  if (name === "balance") return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.4c-.5-.7-1.4-1.1-2.7-1.1-1.4 0-2.3.6-2.3 1.6 0 2.5 5.1.9 5.1 3.8 0 1.1-1.1 1.9-2.8 1.9-1.3 0-2.4-.4-3.1-1.2M12 6.8v1.4m0 7.7v1.4" /></svg>;
  if (name === "shipping") return <svg {...common}><path d="M3 7.5h11v9H3zM14 10h4l3 3v3.5h-7z" /><circle cx="7" cy="18.5" r="1.8" /><circle cx="18" cy="18.5" r="1.8" /><path d="M6 10.5h5" /></svg>;
  if (name === "factory") return <svg {...common}><path d="M3.5 20V9.5l5 3V9.5l5 3V5.5h7V20zM7 16h.01M11 16h.01M16 9h.01M19 9h.01M16 13h.01M19 13h.01" /></svg>;
  return <svg {...common}><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5v-1h6v1M8.5 9h7M8.5 12.5h7M8.5 16h4" /></svg>;
}

function MspIcon({ name }) {
  const common = { "aria-hidden": true, fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.9, viewBox: "0 0 24 24" };
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "receipt") return <svg {...common}><path d="M6 3.8h12v16l-2.2-1.4-1.9 1.4-1.9-1.4-2 1.4-2-1.4L6 20zM9 8h6M9 12h6M9 16h3" /></svg>;
  if (name === "pending") return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>;
  if (name === "charge") return <svg {...common}><path d="M12 19V5m-5 5 5-5 5 5" /></svg>;
  if (name === "payment") return <svg {...common}><path d="M12 5v14m-5-5 5 5 5-5" /></svg>;
  if (name === "shipping") return <svg {...common}><path d="m8 16 8-8M8 8h8v8" /></svg>;
  if (name === "products") return <svg {...common}><path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9zM3.5 7.5 12 12l8.5-4.5M12 12v9M8 5l8.5 4.5" /></svg>;
  return <svg {...common}><path d="m9 5 7 7-7 7" /></svg>;
}

export default function ManufacturingServicePortal({ section, data, load, error, onError, authenticatedUser, onLogout }) {
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showShippingRequest, setShowShippingRequest] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("open");
  const [orderForm, setOrderForm] = useState({ product_name: "", quantity: "1", notes: "", shipping_requested: false, shipping_recipient_name: "", shipping_address: "" });
  const [orderImage, setOrderImage] = useState(null);
  const [shippingForm, setShippingForm] = useState({ recipient_name: "", shipping_address: "", item_description: "", quantity: "1" });
  const imagePreviewUrl = useMemo(() => orderImage ? URL.createObjectURL(orderImage) : "", [orderImage]);
  const [paymentForm, setPaymentForm] = useState({ amount: "", note: "" });
  const [paymentProof, setPaymentProof] = useState(null);

  const orders = Array.isArray(data?.manufacturing_orders) ? data.manufacturing_orders : emptyOrders;
  const products = Array.isArray(data?.products) ? data.products : emptyOrders;
  const currency = data?.client?.currency || "PKR";
  const shippingRequests = Array.isArray(data?.shipping_requests) ? data.shipping_requests : emptyOrders;
  const shippingRequestsInTransit = shippingRequests.filter((shipment) => shipment.status === "Shipped").length;
  const activeShippingRequests = shippingRequests.filter((shipment) => !["Shipped", "Delivered", "Cancelled"].includes(shipment.status));
  const productionOrders = orders.filter((order) => ["Confirmed", "In production", "Quality check", "Ready"].includes(order.status));
  const quoteRequests = orders.filter((order) => ["Quote requested", "Quoted", "Deposit pending"].includes(order.status));
  const payments = useMemo(() => orders.flatMap((order) => (order.payments || []).map((payment) => ({ ...payment, order }))).sort((a, b) => new Date(b.paid_at || b.created_at || 0) - new Date(a.paid_at || a.created_at || 0)), [orders]);
  const allocatedOrderBalances = useMemo(() => {
    let unallocatedPayments = payments
      .filter((payment) => payment.status === "Confirmed")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const balances = new Map();
    [...orders]
      .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0))
      .forEach((order) => {
        if (["Cancelled", "Rejected"].includes(order.status)) {
          balances.set(order.id, 0);
          return;
        }
        const quote = Number(order.quoted_total || (Number(order.quoted_unit_price || 0) * Number(order.quantity || 0) + Number(order.other_cost || 0)));
        const appliedPayment = Math.min(quote, unallocatedPayments);
        balances.set(order.id, Math.max(0, Math.round((quote - appliedPayment + Number.EPSILON) * 100) / 100));
        unallocatedPayments = Math.max(0, unallocatedPayments - appliedPayment);
      });
    return balances;
  }, [orders, payments]);
  const orderBalanceDue = (order) => allocatedOrderBalances.get(order.id) ?? amountDue(order);
  const openOrders = orders.filter((order) => activeStatuses.has(order.status));
  const completedOrders = orders.filter((order) => order.status === "Completed");
  const pendingPayments = payments.filter((payment) => payment.status === "Pending confirmation");
  const totalDue = Number(data?.stats?.account_balance_due ?? orders.reduce((total, order) => total + amountDue(order), 0));
  const advanceCredit = Number(data?.stats?.advance_credit || 0);
  const netAccountBalance = totalDue - advanceCredit;
  const billingActivity = useMemo(() => [
    ...payments.map((payment) => ({ ...payment, activityType: "payment", activityDate: payment.paid_at || payment.created_at })),
    ...orders
      .filter((order) => !["Cancelled", "Rejected"].includes(order.status))
      .flatMap((order) => [
        {
          id: `charge-${order.id}`,
          order,
          activityType: "charge",
          label: "Order charge",
          amount: Number(order.quoted_total || (Number(order.quoted_unit_price || 0) * Number(order.quantity || 0) + Number(order.other_cost || 0))),
          activityDate: order.quoted_at || order.updated_at || order.created_at,
        },
        ...(Number(order.shipping_cost || 0) > 0 ? [{
          id: `shipping-charge-${order.id}`,
          order,
          activityType: "charge",
          label: "Shipping charge",
          amount: Number(order.shipping_cost),
          activityDate: order.updated_at || order.created_at,
        }] : []),
      ])
      .filter((activity) => activity.amount > 0),
    ...(Array.isArray(data?.shipping_requests) ? data.shipping_requests : [])
      .filter((shipment) => shipment.status !== "Cancelled" && Number(shipment.shipping_cost || 0) > 0)
      .map((shipment) => ({
        id: `parcel-shipping-charge-${shipment.id}`,
        order: { request_no: shipment.request_no, currency: shipment.currency || currency },
        activityType: "charge",
        label: "Parcel shipping",
        amount: Number(shipment.shipping_cost),
        activityDate: shipment.updated_at || shipment.created_at,
      })),
  ].sort((left, right) => {
    const timeDifference = new Date(right.activityDate || 0).getTime() - new Date(left.activityDate || 0).getTime();
    if (timeDifference) return timeDifference;
    return String(right.id || "").localeCompare(String(left.id || ""), undefined, { numeric: true });
  }), [data?.shipping_requests, orders, payments, currency]);
  const activeTab = section === "billing" ? "payments" : section === "manufacturing" ? "orders" : section === "shipping" ? "shipping" : section === "account" ? "account" : "dashboard";
  const title = activeTab === "payments" ? "Payments" : activeTab === "orders" ? "Manufacturing orders" : activeTab === "shipping" ? "Shipping" : activeTab === "account" ? "Account" : "Manufacturing";
  const firstName = String(authenticatedUser?.name || authenticatedUser?.username || "there").trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!imagePreview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setImagePreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [imagePreview]);

  useEffect(() => () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  const submitOrder = async (event) => {
    event.preventDefault();
    if (!orderForm.product_name.trim()) return onError("Add a product or design name first.");
    if (!Number(orderForm.quantity) || Number(orderForm.quantity) < 1) return onError("Enter a quantity of at least one.");
    setBusy("new-order");
    let createdOrderId = null;
    try {
      const response = await api.post("/service-takers/portal/local-orders", {
        product_name: orderForm.product_name.trim(),
        quantity: Number(orderForm.quantity),
        notes: orderForm.notes.trim() || null,
        shipping_requested: Boolean(orderForm.shipping_requested),
        shipping_recipient_name: orderForm.shipping_requested ? orderForm.shipping_recipient_name.trim() : null,
        shipping_address: orderForm.shipping_requested ? orderForm.shipping_address.trim() : null,
      });
      createdOrderId = response.data?.id || null;
      if (orderImage && response.data?.id) {
        const body = new FormData();
        body.append("image_file", orderImage);
        await api.post(`/service-takers/portal/local-orders/${response.data.id}/image`, body);
      }
      setShowNewOrder(false);
      setOrderForm({ product_name: "", quantity: "1", notes: "", shipping_requested: false, shipping_recipient_name: "", shipping_address: "" });
      setOrderImage(null);
      setNotice("Order request sent. The factory will review it and prepare a quote.");
      await load({ quiet: true });
    } catch (submitError) {
      if (createdOrderId) {
        setShowNewOrder(false);
        setOrderForm({ product_name: "", quantity: "1", notes: "", shipping_requested: false, shipping_recipient_name: "", shipping_address: "" });
        setOrderImage(null);
        onError("Order request was saved, but its product image could not be uploaded. Open the order and ask the company to attach it.");
        await load({ quiet: true });
        return;
      }
      const detail = submitError?.response?.data?.detail;
      const status = submitError?.response?.status;
      const requestUrl = submitError?.config?.url || "/service-takers/portal/local-orders";
      const requestBase = submitError?.config?.baseURL || "the configured API";
      const requestOrigin = (() => {
        try {
          return new URL(requestBase, window.location.origin).origin;
        } catch {
          return String(requestBase);
        }
      })();
      if (!submitError?.response) {
        console.error("Order request had no HTTP response", {
          requestOrigin,
          requestUrl,
          code: submitError?.code || "unknown",
          browserOnline: typeof navigator === "undefined" ? undefined : navigator.onLine,
        });
      }
      onError(
        detail ||
          (status
            ? `The order request failed (HTTP ${status}). Please refresh and try again.`
            : `Could not reach the order service at ${requestOrigin}. ${submitError?.code || submitError?.message || "Check your connection and try again."}`)
      );
    } finally {
      setBusy("");
    }
  };

  const submitShippingRequest = async (event) => {
    event.preventDefault();
    setBusy("shipping-request");
    try {
      await api.post("/service-takers/portal/shipping-requests", {
        recipient_name: shippingForm.recipient_name.trim(),
        shipping_address: shippingForm.shipping_address.trim(),
        item_description: shippingForm.item_description.trim(),
        quantity: Number(shippingForm.quantity || 1),
      });
      setShippingForm({ recipient_name: "", shipping_address: "", item_description: "", quantity: "1" });
      setShowShippingRequest(false);
      setNotice("Shipping request sent to the company.");
      await load({ quiet: true });
    } catch (requestError) {
      onError(requestError?.response?.data?.detail || "Shipping request could not be submitted.");
    } finally {
      setBusy("");
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!Number(paymentForm.amount) || Number(paymentForm.amount) <= 0) return onError("Enter the amount paid.");
    if (!paymentProof) return onError("Attach the payment screenshot or receipt.");
    setBusy("payment");
    try {
      const body = new FormData();
      body.append("amount", paymentForm.amount);
      body.append("note", paymentForm.note.trim());
      body.append("proof_file", paymentProof);
      await api.post("/service-takers/portal/payments", body);
      setShowPayment(false);
      setPaymentForm({ amount: "", note: "" });
      setPaymentProof(null);
      setNotice("Payment received and marked In review. It will count after the company approves it.");
      await load({ quiet: true });
    } catch (submitError) {
      onError(submitError?.response?.data?.detail || "The payment receipt could not be submitted.");
    } finally {
      setBusy("");
    }
  };

  const startPayment = () => {
    setPaymentForm({ amount: totalDue > 0 ? String(totalDue) : "", note: "" });
    setPaymentProof(null);
    setShowPayment(true);
  };

  const shownOrders = orders.filter((order) => filter === "all" || (filter === "completed" ? order.status === "Completed" : activeStatuses.has(order.status)));

  const orderCard = (order, compact = false) => {
    const image = order.image_url || order.product_image_url;
    const statusIndex = Math.max(0, steps.indexOf(order.status === "Deposit pending" ? "Quoted" : order.status));
    const progressPercent = (statusIndex / (steps.length - 1)) * 100;
    return (
      <article className="msp-order-card" key={order.id}>
        <div className="msp-order-main">
          {image ? <button aria-label={`View image of ${order.product_name}`} className="msp-order-image is-previewable" onClick={() => setImagePreview({ src: getStaticUrl(image, { w: 1400 }), alt: order.product_name || "Product" })} type="button"><img alt={order.product_name} loading="lazy" src={getStaticUrl(image, { w: 360 })} /></button> : <div className="msp-order-image"><span>{String(order.product_name || "P").slice(0, 1).toUpperCase()}</span></div>}
          <div className="msp-order-identity">
            <span className="msp-order-ref">{order.request_no}</span>
            <h3>{order.product_name}</h3>
            <p>{Number(order.quantity || 0).toLocaleString()} units <span>·</span> Submitted {formatDate(order.created_at)}</p>
          </div>
          <span className={`msp-status ${order.status === "Completed" ? "is-complete" : order.status === "Rejected" || order.status === "Cancelled" ? "is-closed" : ""}`}>{order.status}</span>
        </div>
        {!['Rejected', 'Cancelled'].includes(order.status) && <div className="msp-order-progress" role="progressbar" aria-label={`Order progress: ${order.status}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPercent}>
          <span className="msp-order-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>}
        <div className="msp-order-meta">
          <div><span>Quoted total</span><strong>{Number(order.quoted_total || 0) > 0 ? formatMoney(order.quoted_total, order.currency || currency) : "Quote pending"}</strong></div>
          <div><span>Balance due</span><strong className={orderBalanceDue(order) > 0 ? "is-due" : ""}>{formatMoney(orderBalanceDue(order), order.currency || currency)}</strong></div>
          <div><span>Expected ready</span><strong>{formatDate(order.estimated_ready_at || order.requested_ready_at)}</strong></div>
          {amountDue(order) > 0 && Number(order.quoted_total || 0) > 0 && <button className="msp-secondary-button" onClick={() => startPayment(order)} type="button">Submit payment</button>}
        </div>
        {!compact && Number(order.quoted_total || 0) > 0 && <details className="msp-cost-breakdown"><summary>View cost breakdown</summary><div><span>Unit price × quantity <strong>{formatMoney(Number(order.quoted_unit_price || 0) * Number(order.quantity || 0), order.currency || currency)}</strong></span>{Number(order.other_cost || 0) > 0 && <span>{order.other_cost_label || "Other cost"} <strong>{formatMoney(order.other_cost, order.currency || currency)}</strong></span>}<span className="msp-cost-total">Total quote <strong>{formatMoney(order.quoted_total, order.currency || currency)}</strong></span></div></details>}
        {!compact && order.notes && <p className="msp-order-notes"><strong>Your note:</strong> {order.notes}</p>}
        {!compact && order.admin_notes && <p className="msp-order-update"><strong>Factory update:</strong> {order.admin_notes}</p>}
        {!compact && (order.courier || order.tracking_number) && (
          <div className="msp-tracking">
            <span className="msp-tracking-icon" aria-hidden="true">↗</span>
            <div><span>Delivery tracking</span><strong>{order.courier || "Courier"}{order.tracking_number ? ` · ${order.tracking_number}` : ""}</strong></div>
            {order.tracking_number && <button onClick={() => navigator.clipboard?.writeText(order.tracking_number)} type="button">Copy</button>}
          </div>
        )}
        {!compact && order.updates?.length > 0 && <details className="msp-order-updates"><summary>Order updates <span>{order.updates.length}</span></summary><div>{order.updates.slice(0, 5).map((update) => <p key={update.id}><strong>{update.status}</strong><span>{update.message}</span><time>{formatDate(update.created_at)}</time></p>)}</div></details>}
      </article>
    );
  };

  return (
    <main className={`manufacturing-service-portal ${activeTab === "dashboard" ? "msp-dashboard-view" : activeTab === "shipping" ? "msp-shipping-page" : ""}`.trim()}>
      <div className="msp-content">
        <div className="msp-page-heading"><div><h1>{activeTab === "dashboard" ? `${greeting}, ${firstName}` : title}</h1></div><div className="msp-heading-actions">{activeTab === "orders" && <button className="msp-primary-button" onClick={() => setShowNewOrder(true)} type="button"><span>＋</span> New order</button>}{activeTab === "payments" && orders.length > 0 && <button className="msp-primary-button" onClick={() => startPayment()} type="button"><span>＋</span> Submit payment</button>}</div></div>

        {(error || notice) && <div className={`msp-notice ${error ? "is-error" : "is-success"}`} role="status"><span>{error || notice}</span>{error && <button onClick={() => onError("")} type="button" aria-label="Dismiss">×</button>}</div>}

        {activeTab === "dashboard" && <>
          <section className="msp-summary-grid" aria-label="Manufacturing overview">
            {[
              { label: "Open orders", value: openOrders.length, icon: "orders", tone: "violet", href: "local-orders", footer: "View your orders" },
              { label: "In production", value: productionOrders.length, icon: "factory", tone: "blue", href: "local-orders", footer: "Track progress" },
              { label: advanceCredit > 0 ? "Advance credit" : "Balance due", value: new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(advanceCredit > 0 ? advanceCredit : totalDue)), icon: "balance", tone: "amber", href: "charges", footer: "View payments", currency },
              { label: "Parcel requests", value: activeShippingRequests.length, icon: "shipping", tone: "teal", href: "shipping", footer: `${shippingRequestsInTransit} shipped · ${shippingRequests.filter((shipment) => shipment.status === "Delivered").length} delivered` },
            ].map((metric) => <a className={`msp-summary-card is-${metric.tone}`} href={`/portal/service-taker/${metric.href}`} key={metric.icon}>
              <div className="msp-summary-top"><span className="msp-summary-label">{metric.label}</span><span className="msp-summary-icon"><DashboardMetricGlyph name={metric.icon} /></span></div>
              <div className="msp-summary-value">{metric.currency && <span className="msp-summary-currency">{metric.currency}</span>}<strong>{metric.value}</strong></div>
              <div className="msp-summary-footer"><span>{metric.footer}</span><span aria-hidden="true">↗</span></div>
            </a>)}
          </section>
          <div className="msp-dashboard-grid">
            <div className="msp-dashboard-main">
            <section className="msp-section msp-dashboard-orders"><div className="msp-section-heading"><div><span className="msp-eyebrow">YOUR WORK</span><h2>Open orders</h2></div><a href="/portal/service-taker/local-orders">All orders <span>→</span></a></div>{openOrders.length ? <div className="msp-order-list">{openOrders.slice(0, 3).map((order) => orderCard(order, true))}</div> : <div className="msp-empty"><span>✦</span><h3>No open orders</h3><button className="msp-secondary-button" onClick={() => setShowNewOrder(true)} type="button">Create an order</button></div>}</section>
          <section className="msp-section msp-dashboard-shipping"><div className="msp-section-heading"><div><span className="msp-eyebrow">PARCEL DELIVERY</span><h2>Recent shipping requests</h2></div><a href="/portal/service-taker/shipping">View shipping <span>→</span></a></div>{shippingRequests.length ? <div className="msp-shipping-list">{shippingRequests.slice(0, 3).map((shipment) => <a className="msp-dashboard-shipment" href="/portal/service-taker/shipping" key={shipment.id}><span className="msp-dashboard-metric-icon is-blue"><DashboardMetricGlyph name="shipping" /></span><span><strong>{shipment.item_description}</strong><small>{shipment.request_no} · {shipment.recipient_name}</small></span><span className={`msp-status ${shipment.status === "Delivered" ? "is-complete" : ""}`}>{shipment.status}</span></a>)}</div> : <div className="msp-dashboard-shipping-empty"><span>No parcel requests yet</span><a href="/portal/service-taker/shipping">Request shipping <MspIcon name="chevron" /></a></div>}</section>
            </div>
            <aside className="msp-dashboard-sidebar">
              <section className="msp-dashboard-actions"><span className="msp-eyebrow">QUICK ACTIONS</span><div className="msp-quick-action-row"><button className="msp-quick-action-card is-primary" onClick={() => setShowNewOrder(true)} type="button"><span className="msp-quick-action-icon"><MspIcon name="plus" /></span><span><strong>New order</strong><small>Request production</small></span><b><MspIcon name="chevron" /></b></button><button className="msp-quick-action-card" onClick={() => startPayment()} type="button"><span className="msp-quick-action-icon"><MspIcon name="receipt" /></span><span><strong>Payment</strong><small>Upload a receipt</small></span><b><MspIcon name="chevron" /></b></button><a className="msp-quick-action-card" href="/portal/service-taker/shipping"><span className="msp-quick-action-icon"><MspIcon name="shipping" /></span><span><strong>Send parcel</strong><small>Enter parcel details</small></span><b><MspIcon name="chevron" /></b></a></div></section>
              <section className="msp-dashboard-recent"><div className="msp-section-heading"><div><span className="msp-eyebrow">LATEST</span><h2>Payments</h2></div><a href="/portal/service-taker/charges">View all</a></div>{payments.length ? payments.slice(0, 3).map((payment) => <div className="msp-dashboard-payment" key={payment.id}><span className={`msp-dashboard-payment-icon ${payment.status === "Pending confirmation" ? "is-review" : payment.status === "Rejected" ? "is-rejected" : ""}`}>{payment.status === "Rejected" ? "!" : payment.status === "Pending confirmation" ? "…" : "↑"}</span><span><strong>Payment made</strong><small>{payment.order.request_no}</small></span><span className="msp-dashboard-payment-value"><strong>{formatMoney(payment.amount, payment.order.currency || currency)}</strong>{payment.status === "Pending confirmation" && <small>In review</small>}{payment.status === "Rejected" && <small>Needs attention</small>}</span></div>) : <p className="msp-dashboard-no-payments">No payments recorded yet.</p>}</section>
            </aside>
          </div>

        </>}

        {activeTab === "orders" && <section className="msp-section"><div className="msp-filter-row"><div className="msp-filter-pills">{[{ key: "open", label: "Open", count: openOrders.length }, { key: "completed", label: "Completed", count: completedOrders.length }, { key: "all", label: "All orders", count: orders.length }].map((item) => <button className={filter === item.key ? "is-active" : ""} key={item.key} onClick={() => setFilter(item.key)} type="button">{item.label}<span>{item.count}</span></button>)}</div></div>{shownOrders.length ? <div className="msp-order-list">{shownOrders.map(orderCard)}</div> : <div className="msp-empty"><span>✦</span><h3>No {filter === "completed" ? "completed" : "open"} orders</h3><p>Create a request and follow every update here.</p><button className="msp-secondary-button" onClick={() => setShowNewOrder(true)} type="button">Create an order</button></div>}</section>}

        {activeTab === "shipping" && <section className="msp-section msp-shipping-view"><div className="msp-shipping-toolbar"><button className="msp-primary-button msp-shipping-open-button" onClick={() => setShowShippingRequest(true)} type="button"><MspIcon name="plus" /><span>Send a parcel</span></button></div>{showShippingRequest && <div className="msp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowShippingRequest(false); }}><section aria-labelledby="msp-shipping-title" aria-modal="true" className="msp-modal" role="dialog"><header><div><span className="msp-eyebrow">NEW SHIPMENT</span><h2 id="msp-shipping-title">Send a parcel</h2></div><button aria-label="Close" onClick={() => setShowShippingRequest(false)} type="button">×</button></header><form className="msp-shipping-dialog-form" onSubmit={submitShippingRequest}><label>Recipient name<input autoComplete="name" maxLength={200} onChange={(event) => setShippingForm((current) => ({ ...current, recipient_name: event.target.value }))} required value={shippingForm.recipient_name} /></label><label>Shipping address<textarea autoComplete="street-address" maxLength={2000} onChange={(event) => setShippingForm((current) => ({ ...current, shipping_address: event.target.value }))} required rows="3" value={shippingForm.shipping_address} /></label><label>Item details<textarea maxLength={2000} onChange={(event) => setShippingForm((current) => ({ ...current, item_description: event.target.value }))} placeholder="Describe the parcel contents" required rows="2" value={shippingForm.item_description} /></label><label>Quantity<input min="1" max="100000" onChange={(event) => setShippingForm((current) => ({ ...current, quantity: event.target.value }))} required type="number" value={shippingForm.quantity} /></label><div className="msp-modal-actions"><button className="msp-secondary-button" onClick={() => setShowShippingRequest(false)} type="button">Cancel</button><button className="msp-primary-button" disabled={busy === "shipping-request"} type="submit">{busy === "shipping-request" ? "Submitting..." : "Send parcel"}</button></div></form></section></div>}{shippingRequests.length ? <div className="msp-order-list">{shippingRequests.map((shipment) => <article className="msp-shipping-card" key={shipment.id}><div className="msp-order-main"><span className="msp-dashboard-metric-icon is-blue"><DashboardMetricGlyph name="shipping" /></span><div className="msp-order-identity"><span className="msp-order-ref">{shipment.request_no}</span><h3>{shipment.item_description}</h3><p>{shipment.quantity} items · {formatDate(shipment.created_at)}</p></div><span className={`msp-status ${shipment.status === "Delivered" ? "is-complete" : ""}`}>{shipment.status}</span></div><div className="msp-shipping-details"><div><span>Recipient</span><strong>{shipment.recipient_name}</strong></div><div><span>Delivery address</span><strong>{shipment.shipping_address}</strong></div><div><span>Courier / tracking</span><strong>{[shipment.courier, shipment.tracking_number].filter(Boolean).join(" · ") || "Not dispatched yet"}</strong></div>{shipment.shipping_weight_kg != null || shipment.shipping_cost > 0 ? <div><span>Weight / shipping cost</span><strong>{shipment.shipping_weight_kg != null ? `${shipment.shipping_weight_kg} kg` : "Weight pending"}{shipment.shipping_cost > 0 ? ` | ${formatMoney(shipment.shipping_cost, shipment.currency || currency)}` : ""}</strong></div> : null}{shipment.notes && <div><span>Notes</span><strong>{shipment.notes}</strong></div>}</div></article>)}</div> : <div className="msp-empty"><span><DashboardMetricGlyph name="shipping" /></span><h3>No shipments yet</h3><p>Your parcels and tracking details will appear here.</p></div>}</section>}

        {activeTab === "payments" && <section className="msp-section msp-payments-view">
          <div className="msp-payment-summary">
            <div><span>Paid</span><strong>{formatMoney(orders.reduce((sum, order) => sum + Number(order.paid_total || 0), 0), currency)}</strong></div>
            <div><span>In review</span><strong>{formatMoney(pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0), currency)}</strong></div>
            <div className={netAccountBalance < 0 ? "is-credit" : netAccountBalance > 0 ? "is-due" : ""}><span>{netAccountBalance < 0 ? "Advance credit" : "Balance due"}</span><strong>{formatMoney(Math.abs(netAccountBalance), currency)}</strong></div>
          </div>
          <div className="msp-section-heading msp-payment-heading"><h2>Payment activity</h2></div>
          {billingActivity.length ? <div className="msp-payment-list">{billingActivity.map((activity) => {
            const { order } = activity;
            if (activity.activityType === "charge") {
              return <article className="msp-payment-card is-charge" key={activity.id}>
                <span className="msp-payment-symbol is-charge" aria-label={`${activity.label} added to balance`} title={`${activity.label} added to balance`}><MspIcon name="charge" /></span>
                <small className="msp-payment-date">{formatDate(activity.activityDate)}</small>
                <div className="msp-payment-info"><div className="msp-payment-inline"><div className="msp-payment-title"><strong>{activity.label}</strong><span>{order.request_no}</span></div></div></div>
                <div className="msp-payment-trailing"><strong className="msp-payment-amount">{formatMoney(activity.amount, order.currency || currency)}</strong></div>
              </article>;
            }
            const payment = activity;
            const statusClass = payment.status === "Pending confirmation" ? "is-review" : payment.status === "Rejected" ? "is-rejected" : "is-approved";
            return (
              <article className="msp-payment-card" key={payment.id}>
                <span className={`msp-payment-symbol ${statusClass} ${payment.status === "Confirmed" ? "is-outgoing" : ""}`} aria-label={payment.status === "Pending confirmation" ? "Payment awaiting review" : payment.status === "Rejected" ? "Payment needs attention" : "Payment made by customer"} title={payment.status === "Confirmed" ? "Payment made by customer" : payment.status === "Pending confirmation" ? "Payment awaiting review" : "Payment needs attention"}>{payment.status === "Pending confirmation" ? <MspIcon name="pending" /> : payment.status === "Rejected" ? "!" : <MspIcon name="payment" />}</span>
                <small className="msp-payment-date">{formatDate(payment.paid_at || payment.created_at)}</small>
                <div className="msp-payment-info">
                  <div className="msp-payment-inline">
                    <div className="msp-payment-title"><strong>Payment made</strong><span>{payment.order.request_no}</span></div>
                    {payment.status === "Pending confirmation" && <span className="msp-payment-status is-review">In review</span>}
                    {payment.status === "Rejected" && <span className="msp-payment-status is-rejected">Needs attention</span>}
                  </div>
                </div>
                <div className="msp-payment-trailing">
                  <strong className="msp-payment-amount">{formatMoney(payment.amount, payment.order.currency || currency)}</strong>
                  {payment.proof_url && <a href={getStaticUrl(payment.proof_url)} rel="noreferrer" target="_blank">Receipt ↗</a>}
                </div>
              </article>
            );
          })}</div> : <div className="msp-empty"><span>✓</span><h3>No payments yet</h3></div>}
        </section>}

        {activeTab === "account" && <ServiceAccountSettings key={data?.client?.id} client={data?.client} authenticatedUser={authenticatedUser} load={load} onLogout={onLogout} />}
      </div>

      {showNewOrder && <div className="msp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNewOrder(false); }}><section aria-label="New manufacturing request" aria-modal="true" className="msp-modal" role="dialog"><header><div><span className="msp-eyebrow">NEW REQUEST</span></div><button onClick={() => setShowNewOrder(false)} type="button" aria-label="Close">×</button></header><form onSubmit={submitOrder}><label>Product or design name<input autoFocus maxLength={240} onChange={(event) => setOrderForm((current) => ({ ...current, product_name: event.target.value }))} placeholder="e.g. Custom Damascus chef knife" required value={orderForm.product_name} /></label><div className="msp-form-two"><label>Quantity<input min="1" onChange={(event) => setOrderForm((current) => ({ ...current, quantity: event.target.value }))} required type="number" value={orderForm.quantity} /></label><label className="msp-photo-input">Product photo <span>{orderImage?.name || "Add a reference image"}</span><input accept="image/png,image/jpeg,image/webp" onChange={(event) => setOrderImage(event.target.files?.[0] || null)} type="file" /></label></div>{imagePreviewUrl && <img className="msp-image-preview" alt="Product preview" src={imagePreviewUrl} /> }<label className="msp-shipping-toggle"><span><strong>Add shipping</strong><small>Request delivery with this manufacturing order</small></span><input checked={orderForm.shipping_requested} onChange={(event) => setOrderForm((current) => ({ ...current, shipping_requested: event.target.checked, shipping_recipient_name: event.target.checked ? current.shipping_recipient_name : "", shipping_address: event.target.checked ? current.shipping_address : "" }))} type="checkbox" /></label>{orderForm.shipping_requested && <div className="msp-shipping-fields"><label>Recipient name<input autoComplete="name" maxLength={200} onChange={(event) => setOrderForm((current) => ({ ...current, shipping_recipient_name: event.target.value }))} placeholder="Who will receive the parcel?" required value={orderForm.shipping_recipient_name} /></label><label>Shipping address<textarea autoComplete="street-address" maxLength={2000} onChange={(event) => setOrderForm((current) => ({ ...current, shipping_address: event.target.value }))} placeholder="Enter the complete delivery address" required rows="3" value={orderForm.shipping_address} /></label></div>}<label>Notes and specifications<textarea maxLength={6000} onChange={(event) => setOrderForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Enter further details here..." rows="4" value={orderForm.notes} /></label><div className="msp-modal-actions"><button className="msp-secondary-button" onClick={() => setShowNewOrder(false)} type="button">Cancel</button><button className="msp-primary-button" disabled={busy === "new-order"} type="submit">{busy === "new-order" ? "Sending…" : "Send order request"}</button></div></form></section></div>}

      {showPayment && <div className="msp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPayment(false); }}><section aria-labelledby="msp-payment-title" aria-modal="true" className="msp-modal" role="dialog"><header><div><span className="msp-eyebrow">ACCOUNT PAYMENT</span><h2 id="msp-payment-title">Submit a payment</h2><p>Extra payment stays as advance credit after approval.</p></div><button onClick={() => setShowPayment(false)} type="button" aria-label="Close">×</button></header><form onSubmit={submitPayment}><label>Amount<input min="0.01" onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} required step="0.01" type="number" value={paymentForm.amount} /></label><label className="msp-photo-input">Screenshot or receipt <span>{paymentProof?.name || "Choose a file (image or PDF)"}</span><input accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setPaymentProof(event.target.files?.[0] || null)} required type="file" /></label><label>Note (optional)<textarea maxLength={2000} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} placeholder="Transaction reference" rows="2" value={paymentForm.note} /></label><div className="msp-modal-actions"><button className="msp-secondary-button" onClick={() => setShowPayment(false)} type="button">Cancel</button><button className="msp-primary-button" disabled={busy === "payment"} type="submit">{busy === "payment" ? "Submitting…" : "Submit for approval"}</button></div></form></section></div>}

      {imagePreview && <div className="msp-image-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setImagePreview(null); }}><div aria-label={`Image preview: ${imagePreview.alt}`} aria-modal="true" className="msp-image-lightbox-dialog" role="dialog"><button aria-label="Close image preview" className="msp-image-lightbox-close" onClick={() => setImagePreview(null)} type="button">×</button><img alt={imagePreview.alt} src={imagePreview.src} /></div></div>}
    </main>
  );
}
