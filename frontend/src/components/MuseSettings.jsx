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
  const instructions = `Muse AI integration\nBase URL: ${base}/integrations/muse\nAuthorization: Bearer ${key || "<API_KEY>"}\nContent-Type: application/json\nCurrency: USD\n\nGET /products returns all products in your company as [{id, article_no, name, unit_price_usd, image_url}]. Compare exact article numbers with your catalog. Before submitting an order with a missing SKU, POST /products:\n${JSON.stringify({article_no:"YOUR-ARTICLE",name:"Product name",unit_price_usd:50,image_url:"https://example.com/catalog/product.jpg"},null,2)}\nUse the wholesale catalog price in USD. image_url is optional: provide a publicly accessible direct HTTP/HTTPS image URL (HTTPS recommended), or omit it / send null. The ERP stores the URL, so the image must remain available at that address. HTTP 200 returns the saved product immediately; creation is not queued. Existing article numbers return the existing product without changing its name, price, or image. Verify the article number using GET /products, then submit the order. Use the same API key for both product endpoints.\n\nPOST /orders when a new order arrives:\n${JSON.stringify({order_no:"FAIRE-1001",order_date:"2026-10-10T12:00:00+05:00",customer_name:"Jane Smith",company_name:"Sample Shop",phone:"+12125550123",shipping_address:"123 Main St, New York, NY 10001, USA",platform:"Faire",estimated_net_usd:82.10,items:[{article_no:"YOUR-ARTICLE",quantity:2,unit_price_usd:50}]},null,2)}\n\nThe ERP starts processing as soon as a submission arrives, with a backup queue check every 5 seconds while its server is running. HTTP 202 means queued, not applied. Poll GET /submissions every 2 seconds until Applied or Failed. Correct and resend failed payloads. Repeating an identical order or payout is safe; do not change an accepted submission.\n\nExisting customers are matched by normalized phone, then customer name + company name. An optional customer_id explicitly links an existing customer in this company. Ambiguous matches fail for review. Create any missing article numbers with POST /products first. After fixing a missing SKU, resend the failed order and check GET /submissions until Applied. Quantity is units, unit_price_usd is the per-unit gross price.\n\nDaily at 08:00 Asia/Karachi (03:00 UTC), GET /pending-payouts and check payment at the original sales source. Once settled, POST /payouts:\n${JSON.stringify({order_no:"FAIRE-1001",actual_paid_usd:80,paid_at:"2026-10-11T08:00:00+05:00"},null,2)}\n\nactual_paid_usd is the final total, not an incremental payment. The ERP keeps the original estimate, records the actual payment in Payouts and Accounting, and removes the order from pending payouts. Stop tracking after the payout submission is Applied. Never report an estimate as a received payment.`;
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
      <p>Muse can list and create products, submit orders and report final payouts here. The ERP starts processing new submissions <strong>as soon as they arrive</strong> and updates Customers, Orders, inventory reservations, Payouts and Accounting.</p>
      <p>Muse checks the sales source for payments daily at <strong>8:00 AM Pakistan time</strong>.</p>
      {error && <p role="alert">{error}</p>}
      {data && <>
        <label>Products endpoint (GET / POST)<input readOnly value={`${base}/integrations/muse/products`} /></label>
        <label>Orders endpoint<input readOnly value={`${base}/integrations/muse/orders`} /></label>
        <p>Use your publicly reachable HTTPS server URL when sharing with Muse. A localhost or private network URL is only reachable on that network.</p>
        <button type="button" disabled={busy} onClick={() => data.configured ? setRotate(true) : generate()}>{data.configured ? "Replace API key" : "Generate API key"}</button>
        {rotate && <p>Replacing the key disconnects the previous Muse setup. <button type="button" disabled={busy} onClick={generate}>Replace key now</button> <button type="button" onClick={() => setRotate(false)}>Cancel</button></p>}
        {key && <label>New API key — copy now; it is not stored in readable form<input readOnly value={key} /></label>}
        <h3>Instructions to send to Muse</h3>
        <textarea readOnly rows={15} value={instructions} />
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(instructions); setCopied(true); } catch { setError("Select and copy the instructions manually."); } }}>{copied ? "Copied" : "Copy instructions"}</button>
        <h3>Recent submissions</h3>
        <button type="button" onClick={load}>Refresh status</button>
        {!data.submissions.length && <p>No submissions yet.</p>}
        {data.submissions.map(row => <div className="muse-submission" key={row.id}><strong>{row.order_no}</strong> · {row.kind} · {row.status}{row.error && <p>{row.error}</p>}{row.status === "Failed" && <button type="button" onClick={async () => { try { await api.post(`/muse-settings/retry/${row.id}`); await load(); } catch { setError("Unable to retry submission."); } }}>Retry now</button>}</div>)}
      </>}
    </section></div>}
  </>;
}
