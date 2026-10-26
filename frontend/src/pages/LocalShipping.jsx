import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./LocalShipping.css";
import BulkActions from "../components/BulkActions";

const dateTime = (value) => {
  if (!value) return "Date not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not available" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const amount = (value, currency = "PKR") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toLocaleString()}`;
  }
};

function ParcelThumbnail({ imageUrl, name }) {
  const [failed, setFailed] = useState(false);
  return <span className="local-shipping-thumbnail">
    {imageUrl && !failed ? <img src={getStaticUrl(imageUrl, { w: 160 })} alt={name || "Manufacturing order"} loading="lazy" onError={() => setFailed(true)} /> : (
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5v4" /></svg>
    )}
  </span>;
}

export default function LocalShipping() {
  const [requests, setRequests] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedRequests, setSelectedRequests] = useState([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await api.get("/service-takers/admin/dashboard");
      const orders = new Map((Array.isArray(data?.manufacturing_orders) ? data.manufacturing_orders : []).map((order) => [String(order.id), order]));
      setRequests((Array.isArray(data?.shipping_requests) ? data.shipping_requests : []).map((request) => {
        const order = request.request_type === "manufacturing" ? orders.get(String(request.id)) : null;
        return { ...request, thumbnail: order?.image_url || order?.product_image_url || null };
      }));
      setClients(Array.isArray(data?.clients) ? data.clients : []);
      setError("");
    } catch (loadError) {
      setError(loadError?.response?.data?.detail || "Could not load local shipping requests.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...requests]
      .filter((request) => statusFilter === "all" || (statusFilter === "attention" ? !["Shipped", "Delivered", "Cancelled"].includes(request.status) : request.status === (statusFilter === "delivered" ? "Delivered" : "Shipped")))
      .filter((request) => clientFilter === "all" || String(request.service_taker_id) === String(clientFilter))
      .filter((request) => !query || [request.request_no, request.company_name, request.recipient_name, request.item_description, request.shipping_address, request.tracking_number]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
  }, [requests, search, clientFilter, statusFilter]);

  const saveRequest = async (event, request) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const weight = String(form.get("shipping_weight_kg") || "").trim();
    const cost = String(form.get("shipping_cost") || "").trim();
    const requestKey = `${request.request_type || "parcel"}-${request.id}`;
    setBusyId(requestKey);
    setError("");
    setNotice("");
    try {
      const endpoint = request.request_type === "manufacturing"
        ? `/service-takers/admin/local-orders/${request.id}/shipping`
        : `/service-takers/admin/shipping-requests/${request.id}`;
      const { data } = await api.patch(endpoint, {
        status: form.get("status"),
        shipping_weight_kg: weight === "" ? null : Number(weight),
        shipping_cost: cost === "" ? 0 : Number(cost),
        courier: String(form.get("courier") || "").trim() || null,
        tracking_number: String(form.get("tracking_number") || "").trim() || null,
        ...(request.request_type === "manufacturing" ? { send_tracking_email: form.get("send_tracking_email") === "on" } : {}),
      });
      if (!data || data.id !== request.id) throw new Error("The shipping details were not confirmed by the server.");
      setNotice(`Saved shipping details for ${request.request_no}.`);
      await load(true);
    } catch (saveError) {
      setError(saveError?.response?.data?.detail || saveError?.message || "Could not save parcel details.");
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = requests.filter((request) => !["Shipped", "Delivered", "Cancelled"].includes(request.status)).length;
  const inTransitCount = requests.filter((request) => request.status === "Shipped").length;

  return (
    <main className="local-shipping-page">
      <header className="local-shipping-header">
        <div><span>CLIENT PARCELS</span><h1>Local Shipping</h1><p>Manage parcel requests and manufacturing order deliveries in one place.</p></div>
        <button type="button" onClick={() => load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh requests"}</button>
      </header>

      {error && <div className="local-shipping-alert is-error" role="alert">{error}</div>}
      {notice && <div className="local-shipping-alert is-notice" role="status">{notice}</div>}

      <section className="local-shipping-metrics" aria-label="Shipping summary">
        {[['all', 'All requests', requests.length], ['attention', 'Needs attention', activeCount], ['shipped', 'Shipped', inTransitCount], ['delivered', 'Delivered', requests.filter((request) => request.status === 'Delivered').length]].map(([value, label, count]) => (
          <button type="button" key={value} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}><span>{label}</span><strong>{count}</strong></button>
        ))}
      </section>

      <section className="local-shipping-board">
        <div className="local-shipping-tools">
          <div><h2>Parcel requests</h2><p>{visibleRequests.length} shown · newest requests first</p></div>
          <div className="local-shipping-filters">
            <input aria-label="Search parcel requests" onChange={(event) => setSearch(event.target.value)} placeholder="Search recipient, parcel, tracking…" value={search} />
            <select aria-label="Filter by client" onChange={(event) => setClientFilter(event.target.value)} value={clientFilter}>
              <option value="all">All clients</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name || client.name || `Client ${client.id}`}</option>)}
            </select>
          </div>
        </div>

        <BulkActions items={visibleRequests.map((request) => ({ ...request, key: `${request.request_type || "parcel"}-${request.id}` }))} selected={selectedRequests} setSelected={setSelectedRequests}
          statuses={["Submitted", "Processing", "Shipped", "Delivered", "Cancelled"]}
          fields={[{ name: "courier", label: "Courier" }, { name: "shipping_weight_kg", label: "Weight per parcel (kg)", type: "number" }, { name: "shipping_cost", label: "Shipping cost per parcel (request currency)", type: "number" }]}
          endpoint={(request) => request.request_type === "manufacturing" ? `/service-takers/admin/local-orders/${request.id}/shipping` : `/service-takers/admin/shipping-requests/${request.id}`}
          onRefresh={() => load(true)} onBusyChange={(value) => setBusyId(value ? "bulk" : null)} disabled={loading || busyId !== null}
          deleteHelp="Permanently delete selected shipping requests, including shipped or delivered parcels and their shipping charges. Client balances will change. For manufacturing deliveries, the manufacturing order stays; its shipping details and charge are removed. This cannot be undone." />
        {loading ? <div className="local-shipping-empty">Loading parcel requests…</div> : visibleRequests.length ? (
          <div className="local-shipping-list">
            {visibleRequests.map((request) => (
              <div className={`local-shipping-selectable ${selectedRequests.includes(`${request.request_type || "parcel"}-${request.id}`) ? "is-selected" : ""}`} key={`${request.request_type || "parcel"}-${request.id}`}>
              <input className="bulk-row-check" disabled={busyId !== null} type="checkbox" aria-label={`Select ${request.request_no}`} checked={selectedRequests.includes(`${request.request_type || "parcel"}-${request.id}`)} onChange={(event) => {
                const key = `${request.request_type || "parcel"}-${request.id}`;
                setSelectedRequests((current) => event.target.checked ? [...current, key] : current.filter((value) => value !== key));
              }} />
              <details className="local-shipping-card">
                <summary className="local-shipping-card-header">
                  <ParcelThumbnail key={request.thumbnail || "parcel"} imageUrl={request.thumbnail} name={request.item_description} />
                  <div className="local-shipping-identity"><span className="local-shipping-ref">{request.request_no}</span><strong title={request.company_name}>{request.company_name || "Client"}</strong></div>
                  <div className="local-shipping-recipient"><strong title={request.recipient_name}>{request.recipient_name || "No recipient"}</strong></div>
                  <span className={`local-shipping-status is-${String(request.status || "Submitted").toLowerCase()}`}>{request.status || "Submitted"}</span>
                  <span className="local-shipping-row-cost">{Number(request.shipping_cost || 0) > 0 ? amount(request.shipping_cost, request.currency || "PKR") : "Cost not set"}</span>
                  <span className="local-shipping-toggle"><span className="when-closed">Manage</span><span className="when-open">Close</span><span className="local-shipping-chevron" aria-hidden="true">⌄</span></span>
                </summary>
                <div className="local-shipping-expanded">
                <div className="local-shipping-details">
                  <div className="is-wide"><span>Request information</span><strong>{request.request_type === "manufacturing" ? `Manufacturing order · ${request.manufacturing_status || "In progress"}` : "Parcel request"}<br />Submitted {dateTime(request.created_at)}</strong></div>
                  <div><span>Recipient</span><strong>{request.recipient_name}</strong></div>
                  <div><span>Parcel details</span><strong>{request.item_description} · Quantity {request.quantity}</strong></div>
                  <div className="is-wide"><span>Shipping address</span><strong>{request.shipping_address}</strong></div>
                  {request.notes && <div className="is-wide"><span>Client notes</span><strong>{request.notes}</strong></div>}
                </div>
                <form className="local-shipping-admin-form" key={`${request.request_type || "parcel"}-${request.id}-${request.updated_at || ""}`} onSubmit={(event) => saveRequest(event, request)}>
                  <label>Shipping status<select defaultValue={request.status || "Submitted"} name="status"><option>Submitted</option><option>Processing</option><option>Shipped</option><option>Delivered</option><option>Cancelled</option></select></label>
                  <label>Weight (kg)<input defaultValue={request.shipping_weight_kg ?? ""} min="0" name="shipping_weight_kg" placeholder="Enter weight" step="0.01" type="number" /></label>
                  <label>Shipping cost ({request.currency || "PKR"})<input defaultValue={request.shipping_cost || ""} min="0" name="shipping_cost" placeholder="Optional" step="0.01" type="number" /></label>
                  <label>Courier<input defaultValue={request.courier || ""} maxLength="160" name="courier" placeholder="e.g. TCS" /></label>
                  <label>Tracking number<input defaultValue={request.tracking_number || ""} maxLength="200" name="tracking_number" placeholder="Enter after dispatch" /></label>
                  {request.request_type === "manufacturing" && <label className="local-order-email-choice"><input type="checkbox" name="send_tracking_email" />Send tracking email to service taker</label>}
                  <div className="local-shipping-form-actions"><strong>{Number(request.shipping_cost || 0) > 0 ? amount(request.shipping_cost, request.currency || "PKR") : "Cost not set"}</strong><button disabled={busyId !== null} type="submit">{busyId === `${request.request_type || "parcel"}-${request.id}` ? "Saving…" : "Save shipping details"}</button></div>
                </form>
                </div>
              </details>
              </div>
            ))}
          </div>
        ) : <div className="local-shipping-empty">{requests.length ? "No parcel requests match these filters." : "No client parcel requests yet. New requests will appear here."}</div>}
      </section>
    </main>
  );
}
