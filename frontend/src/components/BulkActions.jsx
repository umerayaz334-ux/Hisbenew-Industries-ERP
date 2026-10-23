import { useState } from "react";
import api from "../api/api";
import { errorDetailText } from "../utils/apiError";
import "./BulkActions.css";

export default function BulkActions({ items, selected, setSelected, statuses, fields, endpoint, onRefresh, onBusyChange, disabled = false, deleteHelp }) {
  const [mode, setMode] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const chosen = items.filter((item) => selected.includes(item.key));
  const all = items.length > 0 && chosen.length === items.length;
  const toggleAll = () => setSelected(all ? [] : items.map((item) => item.key));

  const apply = async (event) => {
    event.preventDefault();
    if (busy || !chosen.length) return;
    const form = new FormData(event.currentTarget);
    const payload = {};
    if (mode !== "delete") {
      for (const [key, value] of form.entries()) {
        if (String(value).trim() !== "") payload[key] = fields.find((field) => field.name === key)?.type === "number" ? Number(value) : String(value).trim();
      }
      if (!Object.keys(payload).length) { setReport({ text: "Choose a status or enter at least one field to change.", failures: [] }); return; }
    }
    setBusy(true);
    onBusyChange?.(true);
    setReport(null);
    const successes = [];
    const failures = [];
    for (const item of chosen) {
      try {
        if (mode === "delete") await api.delete(endpoint(item));
        else await api.patch(endpoint(item), payload);
        successes.push(item.key);
      } catch (error) {
        failures.push(`${item.request_no}: ${errorDetailText(error?.response?.data?.detail) || error.message || "Request failed"}`);
      }
    }
    setSelected((current) => current.filter((key) => !successes.includes(key)));
    try { await onRefresh(); } catch { failures.push("Could not refresh the list. Refresh before trying again."); }
    setReport({ text: `${successes.length} ${mode === "delete" ? "deleted" : "updated"}. ${failures.length ? `${failures.length} failed; unsuccessful items remain selected.` : ""}`, failures });
    if (!failures.length) setMode("");
    setBusy(false);
    onBusyChange?.(false);
  };

  return <div className="bulk-actions">
    <div className="bulk-actions-bar">
      <label className="bulk-select"><input type="checkbox" checked={all} ref={(node) => { if (node) node.indeterminate = chosen.length > 0 && !all; }} onChange={toggleAll} disabled={busy || disabled || !items.length} /> Select shown</label>
      <strong>{chosen.length} selected</strong>
      <button type="button" disabled={!chosen.length || busy || disabled} onClick={() => { setMode("status"); setReport(null); }}>Change status</button>
      <button type="button" disabled={!chosen.length || busy || disabled} onClick={() => { setMode("edit"); setReport(null); }}>Bulk edit</button>
      <button className="bulk-delete" type="button" disabled={!chosen.length || busy || disabled} onClick={() => { setMode("delete"); setReport(null); }}>Delete</button>
      {chosen.length > 0 && <button type="button" disabled={busy} onClick={() => { setSelected([]); setMode(""); }}>Clear</button>}
      {busy && <span role="status">Applying changes…</span>}
    </div>
    {mode && chosen.length > 0 && <form className="bulk-actions-editor" onSubmit={apply} key={mode}>
      <fieldset disabled={busy || disabled}>
        <legend>{mode === "delete" ? "Delete selected requests" : mode === "edit" ? "Edit selected requests" : "Change shipping / order status"}</legend>
        <p>{mode === "delete" ? deleteHelp : "Changes apply to every selected request. Blank fields stay unchanged."}</p>
        <details className="bulk-review"><summary>Review {chosen.length} selected requests</summary><ul>{chosen.map((item) => <li key={item.key}>{item.request_no} — {item.company_name}</li>)}</ul></details>
        {mode !== "delete" ? <div className="bulk-fields">
          <label>Status<select name="status" required={mode === "status"} defaultValue=""><option value="">Keep current status</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          {mode === "edit" && fields.map((field) => <label key={field.name}>{field.label}<input name={field.name} type={field.type || "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" ? "0.01" : undefined} maxLength={field.maxLength || 160} placeholder="Unchanged" /></label>)}
        </div> : <label className="bulk-select"><input type="checkbox" required /> I confirm deletion of the selected requests.</label>}
        <div className="bulk-editor-buttons"><button type="submit" className={mode === "delete" ? "bulk-delete" : "bulk-apply"}>{busy ? "Applying…" : `${mode === "delete" ? "Delete" : "Apply to"} ${chosen.length} requests`}</button><button type="button" onClick={() => setMode("")}>Cancel</button></div>
      </fieldset>
    </form>}
    {report && <div className="bulk-report" role={report.failures.length ? "alert" : "status"}>{report.text}{report.failures.length > 0 && <ul>{report.failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul>}</div>}
  </div>;
}
