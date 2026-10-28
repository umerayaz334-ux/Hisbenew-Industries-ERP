import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/api";
import "./ForwardOrderButton.css";

const OPEN = new Set(["New", "Ready", "In Progress", "Pending Verification"]);

export default function ForwardOrderButton({ order, taskType, onForwarded }) {
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [step, setStep] = useState(taskType || "Preparation");
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  let user;
  try { user = JSON.parse(window.localStorage.getItem("erpUser") || "null"); } catch { user = null; }
  const allowed = ["admin", "super_admin"].includes(user?.role);
  const orderId = order?.order_id || order?.id;
  const closed = ["shipped", "dispatched", "in transit", "delivered", "canceled", "cancelled"].includes(String(order?.shipping_status || "").toLowerCase()) || ["canceled", "cancelled"].includes(String(order?.status || "").toLowerCase());

  useEffect(() => {
    if (!open) return undefined;
    dialog.current?.showModal();
    let active = true;
    Promise.all([
      api.get("/order-forwarding/connections"),
      api.get("/order-forwarding/settings"),
      api.get("/order-workflow/tasks", { params: { order_id: orderId } }),
    ]).then(([links, settings, work]) => {
      if (!active) return;
      const outgoing = links.data.filter((row) => row.outgoing && row.is_active);
      setConnections(outgoing);
      setTasks(work.data);
      const selected = outgoing.find((row) => row.id === settings.data.default_connection_id) || (outgoing.length === 1 ? outgoing[0] : null);
      setConnectionId(selected ? String(selected.id) : "");
      setCompanyId(selected ? String(selected.target_tenant_id) : "");
      const preparationDone = work.data.some((row) => row.task_type === "Preparation" && row.status === "Completed");
      setStep(taskType || ((order.items || []).some((item) => item.manufacturing_required) && !preparationDone ? "Preparation" : "Shipping"));
    }).catch((err) => {
      if (active) setError(err.response?.data?.detail || "Could not load connected companies. Please try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, orderId, order.items, taskType]);

  if (!allowed || closed || !orderId) return null;
  const companies = [...new Map(connections.map((row) => [String(row.target_tenant_id), row.company_name])).entries()];
  const workers = connections.filter((row) => String(row.target_tenant_id) === companyId);
  const existing = tasks.find((row) => row.task_type === step && OPEN.has(row.status));

  const submit = async (event) => {
    event.preventDefault();
    if (!connectionId || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/order-forwarding/orders/${orderId}`, {
        connection_id: Number(connectionId), task_type: step,
        notes: notes.trim() || null, due_at: due ? new Date(due).toISOString() : null,
      });
      setTasks((current) => [...current, data]);
      setSuccess(`Order #${order.order_no} forwarded to ${data.assigned_worker_name}.`);
      dialog.current?.scrollTo(0, 0);
      // Assignment has succeeded even if refreshing the background page fails.
      try { await onForwarded?.(data); } catch { /* The saved task remains visible in this dialog. */ }
    } catch (err) {
      setError(err.response?.data?.detail || "The order could not be forwarded. Refresh and retry.");
    } finally { setBusy(false); }
  };

  return <>
    <button type="button" className="order-forward-icon" aria-label={`Forward order #${order.order_no}`} title="Forward order to a connected company"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setLoading(true); setError(""); setSuccess(""); setNotes(""); setDue(""); setOpen(true); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg>
    </button>
    {open && createPortal(<dialog ref={dialog} className="order-forward-dialog" aria-labelledby={`forward-title-${orderId}`} onClick={(event) => event.stopPropagation()}
      onCancel={(event) => { if (busy) event.preventDefault(); else setOpen(false); }} onClose={() => setOpen(false)}>
      <header><div><h2 id={`forward-title-${orderId}`}>Forward order</h2><p>#{order.order_no}</p></div><button type="button" aria-label="Close forwarding popup" disabled={busy} onClick={() => setOpen(false)}>×</button></header>
      {success && <p className="order-forward-success" role="status">{success}</p>}
      {loading ? <p role="status">Loading connected companies…</p> : <form onSubmit={submit}>
        <p>The worker receives this task through their existing login. Your company keeps the original order.</p>
        {connections.length === 0 && !error && <p>No receiving companies are connected yet. <a href="/settings?tab=forwarding">Connect a worker in Settings → Order forwarding.</a></p>}
        <label>Connected company<select required value={companyId} onChange={(event) => {
          const id = event.target.value; setCompanyId(id);
          const options = connections.filter((row) => String(row.target_tenant_id) === id);
          setConnectionId(options.length === 1 ? String(options[0].id) : "");
        }}><option value="">Select company</option>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Receiving worker<select required value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">Select worker</option>{workers.map((row) => <option key={row.id} value={row.id}>{row.worker_name}</option>)}</select></label>
        <label>Task<select value={step} onChange={(event) => { setStep(event.target.value); setSuccess(""); }}><option>Preparation</option><option>Shipping</option></select></label>
        <label>Instructions<textarea rows="3" maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What should the worker do?" /></label>
        <label>Due date (optional)<input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></label>
        {existing && !success && <p role="status">{step} is already assigned to {existing.assigned_worker_name || "a worker"} ({existing.status}). Cancel that assignment in Workers before forwarding again.</p>}
        <a href="/settings?tab=forwarding">Change default worker in Settings</a>
        <footer><button type="button" disabled={busy} onClick={() => setOpen(false)}>Close</button><button type="submit" disabled={loading || busy || !connectionId || Boolean(existing) || Boolean(success)}>{busy ? "Forwarding…" : "Forward order"}</button></footer>
      </form>}
      {error && <p className="order-forward-error" role="alert">{error}</p>}
    </dialog>, document.body)}
  </>;
}
