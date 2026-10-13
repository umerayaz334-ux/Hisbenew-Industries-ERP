import { useEffect, useState } from "react";
import api from "../api/api";
import "./MuseSettings.css";

export default function MuseSettings() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [rotate, setRotate] = useState(false);
  const base = new URL(api.defaults.baseURL || "/", window.location.origin).href.replace(/\/$/, "");
  const instructions = `Muse AI - ERP connection
Base URL: ${base}/integrations/muse
Authorization: Bearer ${key || "<YOUR_EXISTING_API_KEY>"}
Content-Type: application/json
Scope: this key's company only. All prices are USD.

1. Products
GET /products to compare exact SKUs. POST /products to create missing ones:
{"article_no":"SKU-123","name":"Product name","unit_price_usd":25,"image_url":"https://example.com/product.jpg"}
Use the catalog wholesale price. image_url is optional; use a lasting public image URL. HTTP 200 confirms the product. Existing SKUs are returned unchanged.

2. Orders
Create missing products first, then POST /orders:
{"order_no":"FAIRE-1001","order_date":"2026-10-13T12:00:00+05:00","customer_name":"Jane Smith","company_name":"Sample Shop","phone":"+12125550123","shipping_address":"123 Main St, New York, NY 10001, USA","platform":"Faire","estimated_net_usd":45,"items":[{"article_no":"SKU-123","quantity":2,"unit_price_usd":25}]}
Customers are matched by phone, then name + company, or created if missing. Optional customer_id must belong to this company.

3. Confirm processing
Orders and payouts return HTTP 202 (queued). Processing starts promptly; backup checks run every 5 seconds. Poll GET /submissions every 2 seconds until Applied or Failed. Fix and resend failures. Identical retries are safe; do not change accepted submissions.

4. Final payouts
Daily at 08:00 Asia/Karachi, GET /pending-payouts and verify payment at the sales source. Once settled, POST /payouts:
{"order_no":"FAIRE-1001","actual_paid_usd":45,"paid_at":"2026-10-14T08:00:00+05:00"}
Send the final received total, never an estimate or installment. Stop tracking when Applied.`;
  useEffect(() => { setCopied(false); }, [instructions]);
  const load = async () => {
    try { setData((await api.get("/muse-settings")).data); setError(""); }
    catch (e) { setError(e.response?.data?.detail || "Unable to load Muse settings."); }
  };
  useEffect(() => {
    if (!open) return;
    load();
    const timer = setInterval(load, 2000);
    const escape = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", escape);
    return () => { clearInterval(timer); document.removeEventListener("keydown", escape); };
  }, [open]);
  const generate = async () => {
    setBusy(true);
    try { setKey((await api.post("/muse-settings/key")).data.api_key); setRotate(false); await load(); }
    catch (e) { setError(e.response?.data?.detail || "Unable to generate API key."); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="orders-create-button" onClick={() => setOpen(true)}>⚙ Settings</button>
    {open && <div className="muse-overlay"><section className="muse-panel" role="dialog" aria-modal="true" aria-labelledby="muse-title">
      <div className="muse-heading"><h2 id="muse-title">Orders API · Muse AI</h2><button type="button" autoFocus onClick={() => setOpen(false)}>Close</button></div>
      <p className="muse-summary">Connect Muse to add products with images, submit orders and report payouts. This API key works only for this company.</p>
      <p className="muse-hint">Processing starts on arrival. Ask Muse to check payments daily at 8:00 AM Pakistan time.</p>
      {error && <p role="alert">{error}</p>}
      {data && <>
        <label className="muse-label">API base URL<input readOnly value={`${base}/integrations/muse`} /></label>
        <p className="muse-hint">Share your public HTTPS URL with Muse. Localhost works only on this computer.</p>
        <button type="button" disabled={busy} onClick={() => data.configured ? setRotate(true) : generate()}>{data.configured ? "Replace API key" : "Generate API key"}</button>
        {rotate && <p>Replacing the key disconnects the previous Muse setup. <button type="button" disabled={busy} onClick={generate}>Replace key now</button> <button type="button" onClick={() => setRotate(false)}>Cancel</button></p>}
        {key && <label>New API key — copy now; it is not stored in readable form<input readOnly value={key} /></label>}
        <h3>Send to Muse</h3>
        <p className="muse-hint">Copy the connection details and examples below.{!key && " Add your existing API key, or generate one if you have not set up Muse yet."}</p>
        <textarea aria-label="Muse connection instructions" readOnly rows={10} value={instructions} />
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(instructions); setCopied(true); } catch { setError("Select and copy the instructions manually."); } }} className="muse-copy">{copied ? "Copied!" : "Copy setup for Muse"}</button>
        <div className="muse-heading muse-status-heading"><h3>Recent submissions</h3><button type="button" onClick={load}>Refresh</button></div>
        {!data.submissions.length && <p className="muse-empty">No submissions yet. Muse activity will appear here.</p>}
        {data.submissions.map(row => <div className="muse-submission" key={row.id}><strong>{row.order_no}</strong> · {row.kind} · {row.status}{row.error && <p>{row.error}</p>}{row.status === "Failed" && <button type="button" onClick={async () => { try { await api.post(`/muse-settings/retry/${row.id}`); await load(); } catch { setError("Unable to retry submission."); } }}>Retry now</button>}</div>)}
      </>}
    </section></div>}
  </>;
}
