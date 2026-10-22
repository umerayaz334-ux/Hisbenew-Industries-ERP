import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./ManufacturingServicePortal.css";

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

export default function ManufacturingServicePortal({ section, data, load, error, onError, authenticatedUser }) {
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("open");
  const [orderForm, setOrderForm] = useState({ product_name: "", quantity: "1", notes: "" });
  const [orderImage, setOrderImage] = useState(null);
  const imagePreviewUrl = useMemo(() => orderImage ? URL.createObjectURL(orderImage) : "", [orderImage]);
  const [paymentForm, setPaymentForm] = useState({ manufacturing_order_id: "", amount: "", payment_type: "Deposit", note: "" });
  const [paymentProof, setPaymentProof] = useState(null);

  const orders = Array.isArray(data?.manufacturing_orders) ? data.manufacturing_orders : emptyOrders;
  const currency = data?.client?.currency || "PKR";
  const payments = useMemo(() => orders.flatMap((order) => (order.payments || []).map((payment) => ({ ...payment, order }))).sort((a, b) => new Date(b.paid_at || b.created_at || 0) - new Date(a.paid_at || a.created_at || 0)), [orders]);
  const payableOrders = orders.filter((order) => !["Cancelled", "Rejected"].includes(order.status) && Number(order.quoted_total || 0) > 0 && amountDue(order) > 0);
  const openOrders = orders.filter((order) => activeStatuses.has(order.status));
  const completedOrders = orders.filter((order) => order.status === "Completed");
  const pendingPayments = payments.filter((payment) => payment.status === "Pending confirmation");
  const totalDue = orders.reduce((total, order) => total + amountDue(order), 0);
  const onTheWayOrders = orders.filter((order) => order.status === "Shipped");
  const activeTab = section === "billing" ? "payments" : section === "manufacturing" ? "orders" : "dashboard";
  const title = activeTab === "payments" ? "Payments" : activeTab === "orders" ? "Manufacturing orders" : "Manufacturing";
  const firstName = String(authenticatedUser?.name || authenticatedUser?.username || "there").trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
      });
      createdOrderId = response.data?.id || null;
      if (orderImage && response.data?.id) {
        const body = new FormData();
        body.append("image_file", orderImage);
        await api.post(`/service-takers/portal/local-orders/${response.data.id}/image`, body);
      }
      setShowNewOrder(false);
      setOrderForm({ product_name: "", quantity: "1", notes: "" });
      setOrderImage(null);
      setNotice("Order request sent. The factory will review it and prepare a quote.");
      await load({ quiet: true });
    } catch (submitError) {
      if (createdOrderId) {
        setShowNewOrder(false);
        setOrderForm({ product_name: "", quantity: "1", notes: "" });
        setOrderImage(null);
        onError("Order request was saved, but its product image could not be uploaded. Open the order and ask the company to attach it.");
        await load({ quiet: true });
        return;
      }
      onError(submitError?.response?.data?.detail || "The order request could not be sent.");
    } finally {
      setBusy("");
    }
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!paymentForm.manufacturing_order_id) return onError("Choose the order this payment is for.");
    if (!Number(paymentForm.amount) || Number(paymentForm.amount) <= 0) return onError("Enter the amount paid.");
    if (!paymentProof) return onError("Attach the payment screenshot or receipt.");
    setBusy("payment");
    try {
      const body = new FormData();
      body.append("amount", paymentForm.amount);
      body.append("payment_type", paymentForm.payment_type);
      body.append("note", paymentForm.note.trim());
      body.append("proof_file", paymentProof);
      await api.post(`/service-takers/portal/local-orders/${paymentForm.manufacturing_order_id}/payments`, body);
      setShowPayment(false);
      setPaymentForm({ manufacturing_order_id: "", amount: "", payment_type: "Deposit", note: "" });
      setPaymentProof(null);
      setNotice("Payment received and marked In review. It will count after the company approves it.");
      await load({ quiet: true });
    } catch (submitError) {
      onError(submitError?.response?.data?.detail || "The payment receipt could not be submitted.");
    } finally {
      setBusy("");
    }
  };

  const startPayment = (order = null) => {
    const selected = order || payableOrders[0];
    setPaymentForm({
      manufacturing_order_id: selected ? String(selected.id) : "",
      amount: selected ? String(amountDue(selected)) : "",
      payment_type: selected?.status === "Ready" ? "Balance" : "Deposit",
      note: "",
    });
    setPaymentProof(null);
    setShowPayment(true);
  };

  const shownOrders = orders.filter((order) => filter === "all" || (filter === "completed" ? order.status === "Completed" : activeStatuses.has(order.status)));

  const orderCard = (order) => {
    const image = order.image_url || order.product_image_url;
    const statusIndex = Math.max(0, steps.indexOf(order.status === "Deposit pending" ? "Quoted" : order.status));
    const progressPercent = (statusIndex / (steps.length - 1)) * 100;
    return (
      <article className="msp-order-card" key={order.id}>
        <div className="msp-order-main">
          <div className="msp-order-image">
            {image ? <img alt={order.product_name} loading="lazy" src={getStaticUrl(image, { w: 360 })} /> : <span>{String(order.product_name || "P").slice(0, 1).toUpperCase()}</span>}
          </div>
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
          <div><span>Balance due</span><strong className={amountDue(order) > 0 ? "is-due" : ""}>{formatMoney(order.balance_due, order.currency || currency)}</strong></div>
          <div><span>Expected ready</span><strong>{formatDate(order.estimated_ready_at || order.requested_ready_at)}</strong></div>
          {amountDue(order) > 0 && Number(order.quoted_total || 0) > 0 && <button className="msp-secondary-button" onClick={() => startPayment(order)} type="button">Submit payment</button>}
        </div>
        {Number(order.quoted_total || 0) > 0 && <details className="msp-cost-breakdown"><summary>View cost breakdown</summary><div><span>Unit price × quantity <strong>{formatMoney(Number(order.quoted_unit_price || 0) * Number(order.quantity || 0), order.currency || currency)}</strong></span><span>Other cost <strong>{formatMoney(order.other_cost, order.currency || currency)}</strong></span><span className="msp-cost-total">Total quote <strong>{formatMoney(order.quoted_total, order.currency || currency)}</strong></span></div></details>}
        {order.notes && <p className="msp-order-notes"><strong>Your note:</strong> {order.notes}</p>}
        {order.admin_notes && <p className="msp-order-update"><strong>Factory update:</strong> {order.admin_notes}</p>}
        {(order.courier || order.tracking_number) && (
          <div className="msp-tracking">
            <span className="msp-tracking-icon" aria-hidden="true">↗</span>
            <div><span>Delivery tracking</span><strong>{order.courier || "Courier"}{order.tracking_number ? ` · ${order.tracking_number}` : ""}</strong></div>
            {order.tracking_number && <button onClick={() => navigator.clipboard?.writeText(order.tracking_number)} type="button">Copy</button>}
          </div>
        )}
        {order.updates?.length > 0 && <details className="msp-order-updates"><summary>Order updates <span>{order.updates.length}</span></summary><div>{order.updates.slice(0, 5).map((update) => <p key={update.id}><strong>{update.status}</strong><span>{update.message}</span><time>{formatDate(update.created_at)}</time></p>)}</div></details>}
      </article>
    );
  };

  return (
    <main className={`manufacturing-service-portal ${activeTab === "dashboard" ? "msp-dashboard-view" : ""}`.trim()}>
      <div className="msp-content">
        <div className="msp-page-heading"><div><h1>{activeTab === "dashboard" ? `${greeting}, ${firstName}` : title}</h1></div><div className="msp-heading-actions">{activeTab !== "payments" && <button className="msp-primary-button" onClick={() => setShowNewOrder(true)} type="button"><span>＋</span> New order</button>}{activeTab === "payments" && payableOrders.length > 0 && <button className="msp-primary-button" onClick={() => startPayment()} type="button"><span>＋</span> Submit payment</button>}</div></div>

        {(error || notice) && <div className={`msp-notice ${error ? "is-error" : "is-success"}`} role="status"><span>{error || notice}</span>{error && <button onClick={() => onError("")} type="button" aria-label="Dismiss">×</button>}</div>}

        {activeTab === "dashboard" && <>
          <section className="msp-hero msp-overview-card"><span className="msp-hero-kicker">ORDERS AT A GLANCE</span><div className="msp-overview-metrics"><div><span>Open orders</span><strong>{openOrders.length}</strong></div><div><span>Balance due</span><strong>{formatMoney(totalDue, currency)}</strong></div><div><span>On the way</span><strong>{onTheWayOrders.length}</strong></div></div></section>
          <section className="msp-section"><div className="msp-section-heading"><div><h2>Open orders</h2></div><a href="/portal/service-taker/local-orders">View all <span>→</span></a></div>{openOrders.length ? <div className="msp-order-list">{openOrders.slice(0, 3).map(orderCard)}</div> : <div className="msp-empty"><span>✦</span><h3>No open orders</h3><button className="msp-secondary-button" onClick={() => setShowNewOrder(true)} type="button">Create an order</button></div>}</section>
        </>}

        {activeTab === "orders" && <section className="msp-section"><div className="msp-filter-row"><div className="msp-filter-pills">{[{ key: "open", label: "Open", count: openOrders.length }, { key: "completed", label: "Completed", count: completedOrders.length }, { key: "all", label: "All orders", count: orders.length }].map((item) => <button className={filter === item.key ? "is-active" : ""} key={item.key} onClick={() => setFilter(item.key)} type="button">{item.label}<span>{item.count}</span></button>)}</div><button className="msp-secondary-button msp-desktop-new" onClick={() => setShowNewOrder(true)} type="button">＋ New order</button></div>{shownOrders.length ? <div className="msp-order-list">{shownOrders.map(orderCard)}</div> : <div className="msp-empty"><span>✦</span><h3>No {filter === "completed" ? "completed" : "open"} orders</h3><p>Create a request and follow every update here.</p><button className="msp-secondary-button" onClick={() => setShowNewOrder(true)} type="button">Create an order</button></div>}</section>}

        {activeTab === "payments" && <section className="msp-section msp-payments-view">
          <div className="msp-payment-summary">
            <div><span>Paid</span><strong>{formatMoney(orders.reduce((sum, order) => sum + Number(order.paid_total || 0), 0), currency)}</strong></div>
            <div><span>In review</span><strong>{formatMoney(pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0), currency)}</strong></div>
            <div><span>Due</span><strong>{formatMoney(totalDue, currency)}</strong></div>
          </div>
          <div className="msp-section-heading msp-payment-heading"><h2>Payment activity</h2></div>
          {payments.length ? <div className="msp-payment-list">{payments.map((payment) => {
            const statusClass = payment.status === "Pending confirmation" ? "is-review" : payment.status === "Rejected" ? "is-rejected" : "is-approved";
            return (
              <article className="msp-payment-card" key={payment.id}>
                <span className={`msp-payment-symbol ${statusClass}`} aria-hidden="true">{payment.status === "Pending confirmation" ? "…" : payment.status === "Rejected" ? "!" : "✓"}</span>
                <div className="msp-payment-info">
                  <div className="msp-payment-inline">
                    <div className="msp-payment-title"><strong>{payment.payment_type || "Payment"}</strong><span>{payment.order.request_no} · {payment.order.product_name}</span></div>
                    <small>{formatDate(payment.paid_at || payment.created_at)}</small>
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
      </div>

      {showNewOrder && <div className="msp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNewOrder(false); }}><section aria-label="New manufacturing request" aria-modal="true" className="msp-modal" role="dialog"><header><div><span className="msp-eyebrow">NEW REQUEST</span></div><button onClick={() => setShowNewOrder(false)} type="button" aria-label="Close">×</button></header><form onSubmit={submitOrder}><label>Product or design name<input autoFocus maxLength={240} onChange={(event) => setOrderForm((current) => ({ ...current, product_name: event.target.value }))} placeholder="e.g. Custom Damascus chef knife" required value={orderForm.product_name} /></label><div className="msp-form-two"><label>Quantity<input min="1" onChange={(event) => setOrderForm((current) => ({ ...current, quantity: event.target.value }))} required type="number" value={orderForm.quantity} /></label><label className="msp-photo-input">Product photo <span>{orderImage?.name || "Add a reference image"}</span><input accept="image/png,image/jpeg,image/webp" onChange={(event) => setOrderImage(event.target.files?.[0] || null)} type="file" /></label></div>{imagePreviewUrl && <img className="msp-image-preview" alt="Product preview" src={imagePreviewUrl} /> }<label>Notes and specifications<textarea maxLength={6000} onChange={(event) => setOrderForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Enter further details here..." rows="4" value={orderForm.notes} /></label><div className="msp-modal-actions"><button className="msp-secondary-button" onClick={() => setShowNewOrder(false)} type="button">Cancel</button><button className="msp-primary-button" disabled={busy === "new-order"} type="submit">{busy === "new-order" ? "Sending…" : "Send order request"}</button></div></form></section></div>}

      {showPayment && <div className="msp-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPayment(false); }}><section aria-labelledby="msp-payment-title" aria-modal="true" className="msp-modal" role="dialog"><header><div><span className="msp-eyebrow">PAYMENT RECEIPT</span><h2 id="msp-payment-title">Submit a payment</h2><p>We’ll add it to your account after admin approval.</p></div><button onClick={() => setShowPayment(false)} type="button" aria-label="Close">×</button></header><form onSubmit={submitPayment}><label>Order<select onChange={(event) => { const order = payableOrders.find((item) => String(item.id) === event.target.value); setPaymentForm((current) => ({ ...current, manufacturing_order_id: event.target.value, amount: order ? String(amountDue(order)) : "" })); }} required value={paymentForm.manufacturing_order_id}><option value="">Choose an order</option>{payableOrders.map((order) => <option key={order.id} value={order.id}>{order.request_no} · {order.product_name}</option>)}</select></label><div className="msp-form-two"><label>Payment type<select onChange={(event) => setPaymentForm((current) => ({ ...current, payment_type: event.target.value }))} value={paymentForm.payment_type}><option>Deposit</option><option>Balance</option><option>Payment</option></select></label><label>Amount<input min="0.01" onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} required step="0.01" type="number" value={paymentForm.amount} /></label></div><label className="msp-photo-input">Screenshot or receipt <span>{paymentProof?.name || "Choose a file (image or PDF)"}</span><input accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setPaymentProof(event.target.files?.[0] || null)} required type="file" /></label><label>Note (optional)<textarea maxLength={2000} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} placeholder="Bank reference or payment note" rows="2" value={paymentForm.note} /></label><div className="msp-modal-actions"><button className="msp-secondary-button" onClick={() => setShowPayment(false)} type="button">Cancel</button><button className="msp-primary-button" disabled={busy === "payment"} type="submit">{busy === "payment" ? "Submitting…" : "Submit for approval"}</button></div></form></section></div>}
    </main>
  );
}
