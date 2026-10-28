import { useEffect, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "./DialogProvider";
import "../pages/Workers.css";

const ignoreConnections = () => {};

export default function WorkerForwarding({ workers, onConnectionsChange = ignoreConnections, onDefaultChange }) {
  const confirmDialog = useConfirmDialog();
  const [connections, setConnections] = useState([]);
  const [workerId, setWorkerId] = useState("");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [defaultConnectionId, setDefaultConnectionId] = useState("");

  const refresh = async () => {
    const [{ data }, settings] = await Promise.all([api.get("/order-forwarding/connections"), api.get("/order-forwarding/settings")]);
    setConnections(data);
    onConnectionsChange(data.filter((row) => row.outgoing && row.is_active));
    setDefaultConnectionId(String(settings.data.default_connection_id || ""));
    onDefaultChange?.(settings.data.default_connection_id);
  };

  useEffect(() => {
    let canceled = false;
    Promise.all([api.get("/order-forwarding/connections"), api.get("/order-forwarding/settings")]).then(([{ data }, settings]) => {
      if (!canceled) {
        setConnections(data);
        onConnectionsChange(data.filter((row) => row.outgoing && row.is_active));
        setDefaultConnectionId(String(settings.data.default_connection_id || ""));
        onDefaultChange?.(settings.data.default_connection_id);
      }
    }).catch((err) => {
      if (!canceled) setError(err.response?.data?.detail || "Forwarding connections could not be loaded.");
    });
    return () => { canceled = true; };
  }, [onConnectionsChange, onDefaultChange]);

  const run = async (action) => {
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (err) { setError(err.response?.data?.detail || "Forwarding could not be updated."); }
    finally { setBusy(false); }
  };

  return (
    <section className="workers-assignment-panel" aria-label="Cross-company order forwarding">
      <h2>Forward orders across companies</h2>
      <p>Workers keep their existing login. Create a code in the receiving company, then enter it in the company sending orders.</p>
      <div className="workers-order-handoff-form">
        <label>Default receiving worker
          <select value={defaultConnectionId} onChange={(event) => setDefaultConnectionId(event.target.value)}>
            <option value="">Choose each time</option>
            {connections.filter((row) => row.outgoing && row.is_active).map((row) => <option key={row.id} value={row.id}>{row.worker_name} / {row.company_name}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => run(async () => {
          const value = defaultConnectionId ? Number(defaultConnectionId) : null;
          await api.put("/order-forwarding/settings", { default_connection_id: value });
          onDefaultChange?.(value);
          setMessage("Default worker saved. Existing assignments stay with their current worker.");
        })}>Save default worker</button>
      </div>
      <p>This worker is preselected when you open the share icon on Orders or Shipping. Changing the default only affects new assignments. Connect another approved worker below to select them instead.</p>
      <div className="workers-order-handoff-form">
        <label>
          Receive orders with this worker
          <select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
            <option value="">Select your worker</option>
            {workers.filter((worker) => worker.is_active).map((worker) => (
              <option key={worker.id} value={worker.id}>{worker.name}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!workerId || busy} onClick={() => run(async () => {
          const { data } = await api.post(`/order-forwarding/workers/${workerId}/code`);
          setIssued(data);
        })}>Create forwarding code</button>
        <label>
          Connect a worker from another company
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste their forwarding code" autoComplete="off" />
        </label>
        <button type="button" disabled={!code.trim() || busy} onClick={() => run(async () => {
          await api.post("/order-forwarding/connections", { code: code.trim() });
          setCode("");
          await refresh();
          setMessage("Worker connected. Select them under Unfulfilled orders below to forward a task.");
        })}>Connect worker</button>
      </div>
      {issued && (
        <p>Forwarding code: <code style={{ userSelect: "all", overflowWrap: "anywhere" }}>{issued.code}</code>
          {" "}<button type="button" onClick={() => run(async () => {
            await navigator.clipboard.writeText(issued.code);
            setMessage("Code copied.");
          })}>Copy code</button>
          <br />Single use. Expires {new Date(issued.expires_at + (issued.expires_at.endsWith("Z") ? "" : "Z")).toLocaleString()}. Share only with the company allowed to send work.</p>
      )}
      {connections.filter((row) => row.is_active).map((row) => (
        <div className="workers-order-handoff-card" key={row.id}>
          <span>{row.outgoing ? "Send to" : `Receive from ${row.source_company_name}:`} {row.worker_name} / {row.company_name}</span>
          <button type="button" disabled={busy} onClick={async () => {
            const confirmed = await confirmDialog({ title: "Disconnect worker", message: "Stop future forwarding and cancel all unfinished tasks for this connection?", confirmText: "Disconnect" });
            if (confirmed) run(async () => {
              await api.delete(`/order-forwarding/connections/${row.id}`);
              await refresh();
              setMessage("Worker disconnected. Refresh the task board to see canceled tasks.");
            });
          }}>Disconnect</button>
        </div>
      ))}
      {busy && <p role="status">Updating forwarding…</p>}
      {message && <p className="workers-task-success" role="status">{message}</p>}
      {error && <p className="workers-task-error" role="alert">{error}</p>}
    </section>
  );
}
