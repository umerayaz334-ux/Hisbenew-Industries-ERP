import { useEffect, useState } from "react";
import api from "../api/api";
import "./EtsyListings.css";

const ROOT = "/service-takers/portal/etsy";
const labels = {
  taxonomy_id: "Etsy category", readiness_state_id: "Processing profile", shipping_profile_id: "Shipping profile",
  return_policy_id: "Return policy", shop_section_id: "Shop section", who_made: "Who made it?", when_made: "When was it made?",
  type: "Product type", is_supply: "Craft supply", is_customizable: "Accept custom orders", should_auto_renew: "Automatic renewal",
  is_taxable: "Apply shop tax rules", production_partner_ids: "Production partners", image_ids: "Existing Etsy image references",
  asset_id: "ERP attachment reference", listing_image_id: "Existing Etsy image reference", rank: "Photo position",
  alt_text: "Image description for accessibility", sku: "SKU", entries: "Entries", products: "Variants",
  property_values: "Variation choices", property_id: "Attribute reference", property_name: "Attribute name",
  value_ids: "Etsy option references", values: "Values", scale_id: "Measurement scale", offerings: "Price and availability",
  is_enabled: "Available for sale", price_on_property: "Attributes that change price", quantity_on_property: "Attributes that change stock",
  sku_on_property: "Attributes that change SKU", readiness_state_on_property: "Attributes that change processing time",
  gpsr_manufacturer_type: "Manufacturer type", gpsr_manufacturer_id: "Manufacturer record",
  gpsr_responsible_person_type: "EU responsible person type", gpsr_responsible_person_id: "EU responsible person record",
  gpsr_serial_number: "Serial / batch number", gpsr_safety_warnings: "Product safety information",
  ecgt_garan_brand: "Guarantee brand", ecgt_garan_model: "Guarantee model", ecgt_garan_years: "Guarantee duration (years)",
  ecgt_garan_guarantee_details: "Guarantee terms", ecgt_other_commercial_guarantee_details: "Additional warranty details",
  ecgt_after_sales_service_info: "After-sales service and repair information", ecgt_software_update_details: "Software update support",
};
const title = (key) => labels[key] || key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const errorText = (error) => {
  const value = error?.response?.data?.detail || error.message || "Please try again.";
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item.msg).join(" · ") : String(value);
};
const groups = [
  { name: "Product details", fields: ["title", "description", "type", "who_made", "when_made", "is_supply", "taxonomy_id", "materials", "tags", "styles", "shop_section_id", "production_partner_ids", "is_customizable"] },
  { name: "Photos & files", fields: ["image_ids"], operations: ["uploadListingImage", "uploadListingVideo", "uploadListingFile", "updateVariationImages"] },
  { name: "Price & variations", fields: ["price", "quantity", "should_auto_renew", "is_taxable"], operations: ["updateListingInventory"] },
  { name: "Category attributes", operations: ["updateListingProperty"] },
  { name: "Shipping & returns", fields: ["shipping_profile_id", "readiness_state_id", "return_policy_id", "processing_min", "processing_max", "item_weight", "item_weight_unit", "item_length", "item_width", "item_height", "item_dimensions_unit"] },
  { name: "Personalization", operations: ["updateListingPersonalization"] },
  { name: "Safety & guarantees", prefix: ["gpsr_", "ecgt_"] },
  { name: "Translations", operations: ["updateListingTranslation"] },
  { name: "Review & history" },
];
const operationNames = {
  uploadListingImage: "Photo descriptions and order", uploadListingVideo: "Video details", uploadListingFile: "Digital download details",
  updateVariationImages: "Variation photos", updateListingInventory: "Variants and stock", updateListingProperty: "Category-specific attributes",
  updateListingPersonalization: "Personalization questions", updateListingTranslation: "Translated listings",
};

function PrimitiveArray({ value, schema, onChange, name }) {
  const [text, setText] = useState((value || []).join("\n"));
  return <label>{title(name)}<textarea value={text} rows="3" placeholder="One value per line" onChange={(e) => {
    setText(e.target.value);
    const parts = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
    onChange(schema.items.type === "integer" ? parts.map(Number) : parts);
  }} /></label>;
}

function FieldEditor({ name, schema, value, onChange, required = false }) {
  if (schema.type === "object") return <div className="etsy-field-grid">{Object.entries(schema.properties || {}).map(([key, child]) =>
    <FieldEditor key={key} name={key} schema={child} value={value?.[key]} required={(schema.required || []).includes(key)} onChange={(v) => onChange({ ...(value || {}), [key]: v })} />)}</div>;
  if (schema.type === "array") {
    if (schema.items.type !== "object") return <PrimitiveArray name={name} schema={schema} value={value} onChange={onChange} />;
    return <div className="etsy-repeat"><h3>{title(name)}</h3>{(value || []).map((item, i) => <div className="etsy-repeat-item" key={i}>
      <div className="etsy-row"><strong>{title(name)} {i + 1}</strong><button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</button></div>
      <FieldEditor name={name} schema={schema.items} value={item} onChange={(v) => onChange(value.map((old, n) => n === i ? v : old))} />
    </div>)}<button type="button" onClick={() => onChange([...(value || []), {}])}>+ Add {name === "entries" ? "entry" : title(name).toLowerCase()}</button></div>;
  }
  if (schema.type === "boolean") return <label className="etsy-check"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />{title(name)}</label>;
  const choiceLabels = { i_did: "I did", someone_else: "Someone else", collective: "A member of my shop", made_to_order: "Made to order", physical: "Physical product", download: "Digital download", both: "Physical and digital (where supported)", text_input: "Text answer", seller: "Our shop", economic_operator: "Registered economic operator" };
  const long = /description|instructions|warnings|details|info/.test(name);
  const help = name.endsWith("_id") || name.endsWith("_ids") ? "Shop and category choices will be available after Etsy is connected. Reference numbers can be saved meanwhile." : null;
  return <label className={long ? "etsy-wide" : ""}><span>{title(name)}{required && <span className="etsy-required"> *</span>}</span>
    {schema.enum ? <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">Choose…</option>{schema.enum.map((item) => <option key={item} value={item}>{choiceLabels[item] || item.replaceAll("_", " ")}</option>)}</select>
      : long ? <textarea rows={name === "description" ? 6 : 3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      : <input type={["integer", "number"].includes(schema.type) ? "number" : "text"} step={schema.type === "integer" ? "1" : "any"} min={schema.minimum} value={value ?? ""} maxLength={name === "title" ? 140 : undefined} onChange={(e) => onChange(e.target.value === "" ? null : ["integer", "number"].includes(schema.type) ? Number(e.target.value) : e.target.value)} />}
    {help && <small>{help}</small>}
  </label>;
}

export default function EtsyListings() {
  const [workspace, setWorkspace] = useState(null);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState({});
  const [tab, setTab] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    let active = true;
    api.get(`${ROOT}/workspace`).then(({ data: result }) => { if (active) setWorkspace(result); }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  const adopt = (row) => {
    setSelected(row); setData(row.data); setNote(row.review_note || ""); setDirty(false);
    setWorkspace((old) => ({ ...old, drafts: [row, ...old.drafts.filter((item) => item.id !== row.id)] }));
  };
  const run = async (fn) => { setBusy(true); setError(""); setMessage(""); try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const choose = (row) => { if (dirty) { setError("Save your changes before opening another draft."); return; } adopt(row); setTab(0); setPreview(null); };
  const create = () => run(async () => {
    if (dirty) throw new Error("Save your changes before starting another draft.");
    const result = await api.post(`${ROOT}/drafts`, { data: { createDraftListing: { type: "physical", quantity: 1 } } });
    adopt(result.data); setTab(0);
  });
  const save = () => run(async () => {
    const result = await api.put(`${ROOT}/drafts/${selected.id}`, { revision: selected.revision, data });
    adopt(result.data); setMessage("Draft saved to ERP.");
  });
  const change = (operation, value) => { setData((old) => ({ ...old, [operation]: value })); setDirty(true); };
  const transition = (action) => run(async () => {
    if (dirty) throw new Error("Save changes before submitting or reviewing.");
    const result = await api.post(`${ROOT}/drafts/${selected.id}/transition`, { revision: selected.revision, action, note });
    adopt(result.data); setMessage(action === "approve" ? "Approved for future publishing. Nothing has been sent to Etsy." : "Listing status updated.");
  });
  const upload = (kind, file) => run(async () => {
    if (!file) return;
    if (dirty) throw new Error("Save your changes before uploading files.");
    const form = new FormData(); form.append("kind", kind); form.append("revision", selected.revision); form.append("file", file);
    const result = await api.post(`${ROOT}/drafts/${selected.id}/assets`, form);
    adopt(result.data); setMessage("File saved privately in ERP.");
  });
  const openFile = (asset) => run(async () => {
    const result = await api.get(`${ROOT}/drafts/${selected.id}/assets/${asset.id}`, { responseType: "blob" });
    if (asset.kind === "image") {
      const ext = asset.filename.split(".").pop().toLowerCase();
      const url = URL.createObjectURL(new Blob([result.data], { type: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}` }));
      setPreview({ url, name: asset.filename });
    } else {
      const url = URL.createObjectURL(result.data); const link = document.createElement("a"); link.href = url; link.download = asset.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  if (!workspace) return <main className="etsy-workspace"><h1>Etsy listings</h1><p role="status">{error || "Loading listing workspace…"}</p></main>;
  const editable = selected && ["Draft", "Changes requested"].includes(selected.status);
  const schema = workspace.catalog.draft_schemas;
  const base = schema.createDraftListing;
  const section = groups[tab];
  const fields = section.prefix ? Object.keys(base.properties).filter((key) => section.prefix.some((prefix) => key.startsWith(prefix))) : section.fields || [];
  return <main className="etsy-workspace">
    <header className="etsy-heading"><div><p className="etsy-eyebrow">HISBENEW · LISTING STUDIO</p><h1>Etsy listings</h1><p>{workspace.is_admin ? "Review your team's work and prepare approved listings for your shop." : "Prepare listings for the shop. Your administrator reviews and publishes."}</p></div><button className="etsy-primary" disabled={busy || dirty} onClick={create}>+ New listing</button></header>
    <div className="etsy-connection"><span className="etsy-dot" /><div><strong>Draft workspace ready · Etsy not connected</strong><p>{workspace.connection.message} No browser connection to Etsy is used on this page.</p></div></div>
    {error && <div className="etsy-error" role="alert">{error}</div>}{message && <div className="etsy-success" role="status">{message}</div>}
    <div className="etsy-layout"><aside className="etsy-drafts"><h2>{workspace.is_admin ? "Team drafts" : "My drafts"}</h2><input aria-label="Search drafts" placeholder="Search listings…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {workspace.drafts.filter((row) => row.title.toLowerCase().includes(filter.toLowerCase())).map((row) => <button key={row.id} className={selected?.id === row.id ? "etsy-draft active" : "etsy-draft"} onClick={() => choose(row)} disabled={busy}><strong>{row.title}</strong><span>{row.status}</span><small>#{row.id} · Revision {row.revision}</small></button>)}
      {!workspace.drafts.length && <p className="etsy-muted">Your first listing starts here. Add product information, then submit it for review.</p>}</aside>
      {!selected ? <section className="etsy-empty"><span>01 / PREPARE</span><h2>A clear path from product to listing.</h2><p>Product details → photos and variations → admin review → publication after connection.</p><button className="etsy-primary" onClick={create} disabled={busy}>Create a draft</button></section>
        : <section className="etsy-editor"><div className="etsy-editor-heading"><div><span className="etsy-status">{selected.status}</span><h2>{data.createDraftListing?.title || "Untitled listing"}</h2><small>{dirty ? "Unsaved changes" : `Saved · Revision ${selected.revision}`}</small></div>{editable && <button className="etsy-primary" onClick={save} disabled={busy || !dirty}>Save draft</button>}</div>
          {selected.review_note && <div className="etsy-review-note"><strong>Admin feedback</strong><p>{selected.review_note}</p></div>}
          <nav className="etsy-tabs" aria-label="Listing sections">{groups.map((group, i) => <button key={group.name} className={tab === i ? "active" : ""} onClick={() => setTab(i)}>{group.name}</button>)}</nav>
          <div className="etsy-section"><h2>{section.name}</h2>
            {tab === 3 && <p className="etsy-muted">Attributes depend on the selected Etsy category. The connected version will load its choices, scales and required attributes automatically. This workspace currently accepts reference values for preparation.</p>}
            {tab === 5 && <p className="etsy-muted">Etsy currently documents support for one text-answer question. Other question types appear in its API schema but must remain unavailable for publication until supported.</p>}
            {tab === 4 && <p className="etsy-muted">Choose the shop's shipping, processing and return policies after connection. Digital downloads do not use physical shipping profiles.</p>}
            {tab !== 8 && <fieldset disabled={!editable || busy} key={`${selected.id}-${selected.revision}-${tab}`} className="etsy-form">
              {tab === 1 && <><div className="etsy-uploads">{[["image", "Add photo", ".jpg,.jpeg,.png,.webp"], ["video", "Add video", ".mp4,.mov"], ["digital", "Add digital file", ".pdf,.zip,.png,.jpg,.jpeg,.txt,.svg,.stl,.epub,.mp3"]].map(([kind, label, accept]) => <label key={kind}>{label}<input type="file" accept={accept} disabled={dirty} onChange={(e) => { upload(kind, e.target.files[0]); e.target.value = ""; }} /></label>)}</div><p className="etsy-muted">Up to 20 photos, one video and five digital files. Save text changes before uploading.</p></>}
              <div className="etsy-field-grid">{fields.map((key) => <FieldEditor key={key} name={key} schema={base.properties[key]} value={data.createDraftListing?.[key]} required={base.required.includes(key)} onChange={(v) => change("createDraftListing", { ...data.createDraftListing, [key]: v })} />)}</div>
              {(section.operations || []).map((operation) => <details className="etsy-operation" key={operation} open={operation === "updateListingPersonalization"}><summary>{operationNames[operation]}</summary><FieldEditor name={operation} schema={schema[operation]} value={data[operation]} onChange={(v) => change(operation, v)} /></details>)}
            </fieldset>}
            {tab === 1 && <><div className="etsy-asset-list">{selected.assets.map((asset) => <div key={asset.id}><span><strong>{asset.filename}</strong><small>{asset.kind} · reference {asset.id} · {(asset.size / 1024).toFixed(0)} KB</small></span><button onClick={() => openFile(asset)} disabled={busy}>{asset.kind === "image" ? "Preview" : "Download"}</button>{editable && <button disabled={busy || dirty} onClick={() => run(async () => { const result = await api.delete(`${ROOT}/drafts/${selected.id}/assets/${asset.id}`, { params: { revision: selected.revision } }); adopt(result.data); })}>Remove</button>}</div>)}</div>{preview && <figure><img className="etsy-image-preview" src={preview.url} alt={preview.name} /><figcaption>{preview.name}</figcaption></figure>}</>}
            {tab === 8 && <><div className="etsy-review-summary"><h3>Preparation checks</h3>{selected.issues.length ? <ul>{selected.issues.map((issue) => <li key={issue}>{issue.replaceAll("createDraftListing.", "").replaceAll("_", " ")}</li>)}</ul> : <p>Basic field checks passed. Shop profiles, category rules and media still need Etsy validation after connection.</p>}</div>
              <label>Review message<textarea value={note} onChange={(e) => setNote(e.target.value)} readOnly={!workspace.is_admin} rows="3" /></label>
              <div className="etsy-actions">{editable && <button className="etsy-primary" disabled={busy || dirty} onClick={() => transition("submit")}>Submit for review</button>}
                {workspace.is_admin && selected.status === "In review" && <button className="etsy-primary" disabled={busy || dirty} onClick={() => transition("approve")}>Approve draft</button>}
                {workspace.is_admin && ["In review", "Approved"].includes(selected.status) && <><button disabled={busy || dirty} onClick={() => transition("return")}>Request changes</button><button disabled={busy || dirty} onClick={() => transition("reopen")}>Reopen for editing</button></>}
                {workspace.is_admin && <button disabled title="Connect and verify the UK publishing service first">Publish to Etsy · Not connected</button>}</div>
              <h3>Activity history</h3><ol className="etsy-history">{[...selected.history].reverse().map((event, i) => <li key={i}><strong>{event.action}</strong><small>{event.actor} · {new Date(event.at + "Z").toLocaleString()}</small></li>)}</ol>
            </>}
          </div><footer className="etsy-footer"><span>{workspace.is_admin ? "Only admins can approve and publish." : "Your access is for listing preparation only."}</span><button disabled={tab === 0} onClick={() => setTab(tab - 1)}>Back</button><button onClick={() => setTab(Math.min(tab + 1, 8))} disabled={tab === 8}>Next section →</button></footer>
        </section>}
    </div><p className="etsy-trademark">The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.</p>
  </main>;
}
