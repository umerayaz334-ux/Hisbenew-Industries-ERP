import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import api from "../api/api";
import "./AmazonFbaInbound.css";

const EMPTY_SUMMARY = {
  plan_count: 0,
  active_plan_count: 0,
  shipment_count: 0,
  planned_quantity: 0,
  shipped_quantity: 0,
  received_quantity: 0,
  missing_quantity: 0,
  damaged_quantity: 0,
  discrepancy_quantity: 0,
  plans_with_issues: 0,
};

const EMPTY_CREATE_FORM = {
  plan_name: "",
  source_warehouse_id: "FACTORY",
  source_address_reference: "Main factory dispatch address",
  packing_type: "CASE_PACKED",
  source_address: {
    name: "",
    company_name: "Hisbenew Industries",
    address_line1: "",
    address_line2: "",
    city: "",
    district_or_county: "",
    state_or_province_code: "",
    postal_code: "",
    country_code: "PK",
    phone_number: "",
    email: "",
  },
  items: [{ product_id: "", quantity: 1, prep_owner: "SELLER", label_owner: "SELLER" }],
  confirm_external_creation: false,
};

const TERMINAL_JOB_STATUSES = new Set([
  "Completed",
  "Failed",
  "Retrying",
  "Cancelled",
]);

const number = (value) => Number(value || 0).toLocaleString();

const dateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
};

const responseError = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

const statusTone = (status) => {
  const value = String(status || "").toUpperCase();
  if (["RECEIVING", "IN_TRANSIT", "SHIPPED", "CONFIRMED"].includes(value)) {
    return "is-progress";
  }
  if (["CLOSED", "COMPLETED", "DELIVERED"].includes(value)) return "is-success";
  if (["VOIDED", "CANCELLED", "ERROR", "FAILED"].includes(value)) return "is-error";
  return "is-working";
};

function AmazonFbaInbound({ authenticatedUser }) {
  const [plans, setPlans] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [jobs, setJobs] = useState([]);
  const [connection, setConnection] = useState(null);
  const [products, setProducts] = useState([]);
  const [tab, setTab] = useState("plans");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState(null);
  const [expandedShipmentId, setExpandedShipmentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [activeJob, setActiveJob] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [trackingTarget, setTrackingTarget] = useState(null);
  const [trackingForm, setTrackingForm] = useState({
    carrier_name: "",
    tracking_number: "",
    mark_shipped: false,
    submit_to_amazon: false,
    confirm_stock_movement: false,
  });
  const [reconcileTarget, setReconcileTarget] = useState(null);
  const [reconcileRows, setReconcileRows] = useState([]);
  const [reconcileNote, setReconcileNote] = useState("");
  const [cartonTarget, setCartonTarget] = useState(null);
  const [cartonForm, setCartonForm] = useState({
    carton_reference: "",
    box_id: "",
    tracking_number: "",
    quantity: 1,
    length: "",
    width: "",
    height: "",
    dimension_unit: "CM",
    weight: "",
    weight_unit: "KG",
  });
  const [placementTarget, setPlacementTarget] = useState(null);
  const [placementOptions, setPlacementOptions] = useState([]);
  const isAdmin = authenticatedUser?.role === "admin";

  const loadPlans = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.get("/amazon/fba/inbound/plans", {
        params: {
          search: search || undefined,
          status: status || undefined,
          issues_only: issuesOnly || undefined,
        },
      });
      setPlans(response.data?.items || []);
      setSummary(response.data?.summary || EMPTY_SUMMARY);
      setError("");
    } catch (loadError) {
      setError(responseError(loadError, "FBA inbound plans could not be loaded."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [issuesOnly, search, status]);

  const loadShipments = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.get("/amazon/fba/inbound/shipments", {
        params: {
          search: search || undefined,
          status: status || undefined,
          discrepancies_only: issuesOnly || undefined,
        },
      });
      setShipments(response.data?.items || []);
      setError("");
    } catch (loadError) {
      setError(responseError(loadError, "FBA inbound shipments could not be loaded."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [issuesOnly, search, status]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [connectionResponse, jobResponse, productResponse] = await Promise.all([
        api.get("/amazon/connection/status"),
        api.get("/amazon/fba/inbound/jobs", { params: { limit: 10 } }),
        api.get("/products"),
      ]);
      setConnection(connectionResponse.data || null);
      setJobs(jobResponse.data || []);
      setProducts(Array.isArray(productResponse.data) ? productResponse.data : []);
    } catch (loadError) {
      setError(responseError(loadError, "The FBA inbound workspace could not be initialized."));
    }
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([
      loadPlans({ quiet: true }),
      loadShipments({ quiet: true }),
      loadReferenceData(),
    ]);
  }, [loadPlans, loadReferenceData, loadShipments]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => loadReferenceData(), 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadReferenceData]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = window.setTimeout(() => {
      if (tab === "plans") loadPlans();
      else loadShipments();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadPlans, loadShipments, tab]);

  const pollJob = async (initialJob) => {
    let current = initialJob;
    setActiveJob(current);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (TERMINAL_JOB_STATUSES.has(current?.status)) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const response = await api.get(`/amazon/fba/inbound/jobs/${current.id}`);
      current = response.data;
      setActiveJob(current);
    }
    await reloadAll();
    if (current?.status === "Completed") {
      setMessage("Amazon FBA inbound synchronization completed.");
      setError("");
    } else if (current?.error_message) {
      setError(current.error_message);
    }
    return current;
  };

  const importPlans = async () => {
    setBusy("import");
    setMessage("");
    setError("");
    try {
      const response = await api.post("/amazon/fba/inbound/plans/import");
      setMessage("Recent Amazon inbound plans queued for import.");
      await pollJob(response.data);
    } catch (importError) {
      setError(responseError(importError, "Inbound plans could not be imported."));
    } finally {
      setBusy("");
    }
  };

  const syncPlan = async (plan) => {
    setBusy(`plan-${plan.id}`);
    setMessage("");
    try {
      const response = await api.post(`/amazon/fba/inbound/plans/${plan.id}/sync`);
      await pollJob(response.data);
    } catch (syncError) {
      setError(responseError(syncError, "The inbound plan could not be synchronized."));
    } finally {
      setBusy("");
    }
  };

  const refreshShipment = async (shipment) => {
    setBusy(`shipment-${shipment.id}`);
    setMessage("");
    try {
      const response = await api.post(
        `/amazon/fba/inbound/shipments/${shipment.id}/refresh`
      );
      await pollJob(response.data);
    } catch (refreshError) {
      setError(responseError(refreshError, "The shipment could not be refreshed."));
    } finally {
      setBusy("");
    }
  };

  const updateCreateAddress = (field, value) => {
    setCreateForm((current) => ({
      ...current,
      source_address: { ...current.source_address, [field]: value },
    }));
  };

  const updateCreateItem = (index, field, value) => {
    setCreateForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addCreateItem = () => {
    setCreateForm((current) => ({
      ...current,
      items: [
        ...current.items,
        { product_id: "", quantity: 1, prep_owner: "SELLER", label_owner: "SELLER" },
      ],
    }));
  };

  const removeCreateItem = (index) => {
    setCreateForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const submitCreatePlan = async (event) => {
    event.preventDefault();
    setBusy("create");
    setMessage("");
    setError("");
    try {
      await api.post("/amazon/fba/inbound/plans", {
        ...createForm,
        items: createForm.items.map((item) => ({
          ...item,
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
        })),
      });
      setShowCreate(false);
      setCreateForm(EMPTY_CREATE_FORM);
      setMessage("Inbound plan created in Amazon Seller Central.");
      await reloadAll();
    } catch (createError) {
      setError(responseError(createError, "The inbound plan could not be created."));
    } finally {
      setBusy("");
    }
  };

  const openPlacement = async (plan) => {
    setBusy(`options-${plan.id}`);
    setError("");
    try {
      const response = await api.get(
        `/amazon/fba/inbound/plans/${plan.id}/options`
      );
      setPlacementOptions(response.data?.items || []);
      setPlacementTarget(plan);
    } catch (optionError) {
      setError(responseError(optionError, "Placement options could not be loaded."));
    } finally {
      setBusy("");
    }
  };

  const confirmPlacement = async (option) => {
    if (!placementTarget) return;
    const approved = window.confirm(
      "Accept this placement option in Amazon Seller Central? Amazon may apply placement fees."
    );
    if (!approved) return;
    setBusy(`confirm-${placementTarget.id}`);
    try {
      await api.post(
        `/amazon/fba/inbound/plans/${placementTarget.id}/confirm`,
        {
          placement_option_id: option.placement_option_id,
          confirm_external_action: true,
        }
      );
      setPlacementTarget(null);
      setPlacementOptions([]);
      setMessage("Amazon placement option confirmation submitted.");
      await reloadAll();
    } catch (confirmError) {
      setError(responseError(confirmError, "Placement could not be confirmed."));
    } finally {
      setBusy("");
    }
  };

  const openTracking = (shipment) => {
    setTrackingTarget(shipment);
    setTrackingForm({
      carrier_name: shipment.carrier_name || "",
      tracking_number: shipment.tracking_number || "",
      mark_shipped: false,
      submit_to_amazon: false,
      confirm_stock_movement: false,
    });
  };

  const saveTracking = async (event) => {
    event.preventDefault();
    if (!trackingTarget) return;
    setBusy(`tracking-${trackingTarget.id}`);
    setError("");
    try {
      await api.put(
        `/amazon/fba/inbound/shipments/${trackingTarget.id}/tracking`,
        trackingForm
      );
      setTrackingTarget(null);
      setMessage(
        trackingForm.mark_shipped
          ? "Tracking saved and stock moved to FBA In Transit."
          : "Shipment tracking saved."
      );
      await reloadAll();
    } catch (trackingError) {
      setError(responseError(trackingError, "Tracking could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const openReconcile = (shipment) => {
    setReconcileTarget(shipment);
    setReconcileRows(
      shipment.items.map((item) => ({
        shipment_item_id: item.id,
        seller_sku: item.seller_sku,
        quantity_shipped: item.quantity_shipped,
        quantity_received: item.quantity_received,
        quantity_missing: item.quantity_missing,
        quantity_damaged: item.quantity_damaged,
      }))
    );
    setReconcileNote("");
  };

  const updateReconcile = (index, field, value) => {
    setReconcileRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    );
  };

  const submitReconcile = async (event) => {
    event.preventDefault();
    if (!reconcileTarget) return;
    setBusy(`reconcile-${reconcileTarget.id}`);
    try {
      await api.post(
        `/amazon/fba/inbound/shipments/${reconcileTarget.id}/reconcile`,
        {
          items: reconcileRows.map((row) => ({
            shipment_item_id: row.shipment_item_id,
            quantity_received: Number(row.quantity_received),
            quantity_missing: Number(row.quantity_missing),
            quantity_damaged: Number(row.quantity_damaged),
          })),
          note: reconcileNote || undefined,
          confirm_reconciliation: true,
        }
      );
      setReconcileTarget(null);
      setMessage("Inbound quantities reconciled with append-only stock movements.");
      await reloadAll();
    } catch (reconcileError) {
      setError(responseError(reconcileError, "The shipment could not be reconciled."));
    } finally {
      setBusy("");
    }
  };

  const openCarton = (shipment) => {
    setCartonTarget(shipment);
    setCartonForm({
      carton_reference: "",
      box_id: "",
      tracking_number: shipment.tracking_number || "",
      quantity: 1,
      length: "",
      width: "",
      height: "",
      dimension_unit: "CM",
      weight: "",
      weight_unit: "KG",
    });
  };

  const saveCarton = async (event) => {
    event.preventDefault();
    if (!cartonTarget) return;
    setBusy(`carton-${cartonTarget.id}`);
    try {
      const numericOrNull = (value) => (value === "" ? null : Number(value));
      await api.put(
        `/amazon/fba/inbound/shipments/${cartonTarget.id}/cartons`,
        {
          cartons: [
            {
              ...cartonForm,
              quantity: Number(cartonForm.quantity),
              length: numericOrNull(cartonForm.length),
              width: numericOrNull(cartonForm.width),
              height: numericOrNull(cartonForm.height),
              weight: numericOrNull(cartonForm.weight),
            },
          ],
        }
      );
      setCartonTarget(null);
      setMessage("Carton details saved.");
      await reloadAll();
    } catch (cartonError) {
      setError(responseError(cartonError, "Carton details could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const retrieveLabels = async (shipment, labelType) => {
    setBusy(`label-${shipment.id}-${labelType}`);
    try {
      const response = await api.get(
        `/amazon/fba/inbound/shipments/${shipment.id}/labels`,
        { params: { label_type: labelType } }
      );
      const documents = response.data?.items || [];
      documents.forEach((document) => {
        window.open(document.download_url, "_blank", "noopener,noreferrer");
      });
      setMessage(
        documents.length
          ? `${labelType === "ITEM" ? "Item" : "Box"} label document opened.`
          : "Amazon did not return a label document yet."
      );
    } catch (labelError) {
      setError(responseError(labelError, "Labels could not be retrieved."));
    } finally {
      setBusy("");
    }
  };

  const cards = useMemo(
    () => [
      ["Inbound plans", summary.plan_count, `${summary.active_plan_count} active`],
      ["Shipments", summary.shipment_count, "Amazon destinations"],
      ["Planned", summary.planned_quantity, "units"],
      ["In transit", summary.shipped_quantity, "units shipped"],
      ["Received", summary.received_quantity, "Amazon confirmed"],
      ["Missing", summary.missing_quantity, "separate ledger"],
      ["Damaged", summary.damaged_quantity, "separate ledger"],
      ["Discrepancy", summary.discrepancy_quantity, `${summary.plans_with_issues} plans need review`],
    ],
    [summary]
  );

  if (!isAdmin) {
    return (
      <main className="amazon-inbound-page">
        <section className="amazon-inbound-access">
          Amazon FBA inbound is available to administrators only.
        </section>
      </main>
    );
  }

  return (
    <main className="amazon-inbound-page">
      <header className="amazon-inbound-header">
        <div>
          <span className="amazon-inbound-eyebrow">Amazon Seller Central · Phase 5</span>
          <h1>FBA Inbound</h1>
          <p>
            Plan factory-to-Amazon shipments, track cartons and labels, and
            reconcile every received, missing, or damaged unit with append-only movements.
          </p>
        </div>
        <div className="amazon-inbound-header-actions">
          <span
            className={`amazon-inbound-connection ${
              connection?.connection_status === "Connected" ? "is-connected" : ""
            }`}
          >
            {connection?.connection_status || "Not configured"}
          </span>
          <button type="button" onClick={() => setShowCreate(true)}>
            Create inbound plan
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={busy === "import"}
            onClick={importPlans}
          >
            Import from Amazon
          </button>
        </div>
      </header>

      <section className="amazon-inbound-safety">
        <strong>Controlled stock flow</strong>
        <span>Factory Available → FBA In Transit only when you mark a shipment shipped.</span>
        <span>Amazon source addresses and temporary label URLs are never stored.</span>
      </section>

      {message ? <div className="amazon-inbound-notice is-success">{message}</div> : null}
      {error ? <div className="amazon-inbound-notice is-error">{error}</div> : null}
      {activeJob && !TERMINAL_JOB_STATUSES.has(activeJob.status) ? (
        <div className="amazon-inbound-progress">
          <span className="amazon-inbound-spinner" />
          <div>
            <strong>{activeJob.job_type}</strong>
            <small>Status: {activeJob.status}</small>
          </div>
        </div>
      ) : null}

      <section className="amazon-inbound-summary">
        {cards.map(([label, value, note]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{number(value)}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className="amazon-inbound-workspace">
        <div className="amazon-inbound-section-heading">
          <div>
            <span className="amazon-inbound-eyebrow">Inbound operations</span>
            <h2>{tab === "plans" ? "Plans and placement" : "Shipments and reconciliation"}</h2>
          </div>
          <div className="amazon-inbound-tabs">
            <button
              type="button"
              className={tab === "plans" ? "is-active" : ""}
              onClick={() => setTab("plans")}
            >
              Plans
            </button>
            <button
              type="button"
              className={tab === "shipments" ? "is-active" : ""}
              onClick={() => setTab("shipments")}
            >
              Shipments
            </button>
          </div>
        </div>

        <div className="amazon-inbound-filters">
          <label>
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tab === "plans" ? "Plan name or reference" : "Shipment or destination"}
            />
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="WORKING">Working</option>
              <option value="READY_TO_SHIP">Ready to ship</option>
              <option value="IN_TRANSIT">In transit</option>
              <option value="RECEIVING">Receiving</option>
              <option value="SHIPPED">Shipped</option>
              <option value="CLOSED">Closed</option>
              <option value="VOIDED">Voided</option>
            </select>
          </label>
          <label className="amazon-inbound-check">
            <input
              type="checkbox"
              checked={issuesOnly}
              onChange={(event) => setIssuesOnly(event.target.checked)}
            />
            Issues only
          </label>
        </div>

        {loading ? (
          <div className="amazon-inbound-empty">Loading FBA inbound records…</div>
        ) : tab === "plans" ? (
          plans.length === 0 ? (
            <div className="amazon-inbound-empty">
              No inbound plans yet. Import existing Send-to-Amazon plans or create a new one.
            </div>
          ) : (
            <div className="amazon-inbound-table-wrap">
              <table className="amazon-inbound-table">
                <thead>
                  <tr>
                    <th>Inbound plan</th>
                    <th>Status</th>
                    <th>Planned</th>
                    <th>Progress</th>
                    <th>Issues</th>
                    <th>Last Amazon update</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <Fragment key={plan.id}>
                      <tr>
                        <td>
                          <div className="amazon-inbound-identity">
                            <strong>{plan.plan_name}</strong>
                            <span>{plan.inbound_plan_id}</span>
                            <small>{plan.source_address_reference || "Amazon Seller Central"}</small>
                          </div>
                        </td>
                        <td>
                          <span className={`amazon-inbound-status ${statusTone(plan.status)}`}>
                            {plan.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>{number(plan.planned_quantity)} units</td>
                        <td>
                          <div className="amazon-inbound-quantity-stack">
                            <span>{number(plan.shipped_quantity)} shipped</span>
                            <small>{number(plan.received_quantity)} received</small>
                          </div>
                        </td>
                        <td>
                          <span className={plan.issue_count ? "amazon-inbound-issue" : "amazon-inbound-clear"}>
                            {plan.issue_count ? `${number(plan.issue_count)} issue(s)` : "Clear"}
                          </span>
                        </td>
                        <td>{dateTime(plan.last_amazon_update)}</td>
                        <td>
                          <div className="amazon-inbound-actions">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPlanId((current) => current === plan.id ? null : plan.id)
                              }
                            >
                              {expandedPlanId === plan.id ? "Hide" : "Details"}
                            </button>
                            <button
                              type="button"
                              disabled={busy === `plan-${plan.id}`}
                              onClick={() => syncPlan(plan)}
                            >
                              Sync
                            </button>
                            <button
                              type="button"
                              disabled={busy === `options-${plan.id}`}
                              onClick={() => openPlacement(plan)}
                            >
                              Placement
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedPlanId === plan.id ? (
                        <tr className="amazon-inbound-detail-row">
                          <td colSpan="7">
                            <div className="amazon-inbound-detail">
                              <div className="amazon-inbound-detail-grid">
                                <div><span>Packing</span><strong>{plan.packing_type}</strong></div>
                                <div><span>Marketplace</span><strong>{plan.marketplace_id}</strong></div>
                                <div><span>Missing</span><strong>{number(plan.missing_quantity)}</strong></div>
                                <div><span>Damaged</span><strong>{number(plan.damaged_quantity)}</strong></div>
                                <div><span>Discrepancy</span><strong>{number(plan.discrepancy_quantity)}</strong></div>
                              </div>
                              <h3>Plan items</h3>
                              <div className="amazon-inbound-item-list">
                                {plan.items.map((item) => (
                                  <article key={item.id}>
                                    <div>
                                      <strong>{item.erp_product_name || item.seller_sku}</strong>
                                      <span>{item.seller_sku}</span>
                                      <small>{item.fnsku || "FNSKU pending"}</small>
                                    </div>
                                    <dl>
                                      <div><dt>Planned</dt><dd>{number(item.quantity_planned)}</dd></div>
                                      <div><dt>Factory available</dt><dd>{number(item.factory_stock)}</dd></div>
                                      <div><dt>Mapping</dt><dd>{item.is_mapped ? "Mapped" : "Unmapped"}</dd></div>
                                    </dl>
                                  </article>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : shipments.length === 0 ? (
          <div className="amazon-inbound-empty">
            No shipments are available. Synchronize a confirmed inbound plan first.
          </div>
        ) : (
          <div className="amazon-inbound-table-wrap">
            <table className="amazon-inbound-table is-shipments">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Status</th>
                  <th>Destination</th>
                  <th>Units</th>
                  <th>Reconciliation</th>
                  <th>Tracking</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((shipment) => (
                  <Fragment key={shipment.id}>
                    <tr>
                      <td>
                        <div className="amazon-inbound-identity">
                          <strong>{shipment.shipment_name || "Amazon shipment"}</strong>
                          <span>{shipment.shipment_confirmation_id || shipment.amazon_shipment_id}</span>
                          <small>{dateTime(shipment.last_amazon_update)}</small>
                        </div>
                      </td>
                      <td>
                        <span className={`amazon-inbound-status ${statusTone(shipment.shipment_status)}`}>
                          {shipment.shipment_status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>{shipment.destination_code || "Pending"}</td>
                      <td>
                        <div className="amazon-inbound-quantity-stack">
                          <span>{number(shipment.shipped_quantity)} shipped</span>
                          <small>{number(shipment.received_quantity)} received</small>
                        </div>
                      </td>
                      <td>
                        <div className="amazon-inbound-quantity-stack">
                          <span>{number(shipment.discrepancy_quantity)} open</span>
                          <small>
                            {number(shipment.missing_quantity)} missing · {number(shipment.damaged_quantity)} damaged
                          </small>
                        </div>
                      </td>
                      <td>{shipment.tracking_number || "Not recorded"}</td>
                      <td>
                        <div className="amazon-inbound-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedShipmentId((current) =>
                                current === shipment.id ? null : shipment.id
                              )
                            }
                          >
                            {expandedShipmentId === shipment.id ? "Hide" : "Details"}
                          </button>
                          <button type="button" onClick={() => refreshShipment(shipment)}>Refresh</button>
                          <button type="button" onClick={() => openTracking(shipment)}>Tracking</button>
                          <button type="button" onClick={() => openReconcile(shipment)}>Reconcile</button>
                        </div>
                      </td>
                    </tr>
                    {expandedShipmentId === shipment.id ? (
                      <tr className="amazon-inbound-detail-row">
                        <td colSpan="7">
                          <div className="amazon-inbound-detail">
                            <div className="amazon-inbound-detail-actions">
                              <button type="button" onClick={() => openCarton(shipment)}>Add carton</button>
                              <button type="button" onClick={() => retrieveLabels(shipment, "ITEM")}>Item labels</button>
                              <button type="button" onClick={() => retrieveLabels(shipment, "BOX")}>Box labels</button>
                            </div>
                            <h3>Shipment items</h3>
                            <div className="amazon-inbound-item-list">
                              {shipment.items.map((item) => (
                                <article key={item.id}>
                                  <div>
                                    <strong>{item.erp_product_name || item.seller_sku}</strong>
                                    <span>{item.seller_sku}</span>
                                    {item.issues.map((issue) => <small key={issue} className="is-error">{issue}</small>)}
                                  </div>
                                  <dl>
                                    <div><dt>Shipped</dt><dd>{number(item.quantity_shipped)}</dd></div>
                                    <div><dt>Received</dt><dd>{number(item.quantity_received)}</dd></div>
                                    <div><dt>Missing</dt><dd>{number(item.quantity_missing)}</dd></div>
                                    <div><dt>Damaged</dt><dd>{number(item.quantity_damaged)}</dd></div>
                                    <div><dt>Open</dt><dd>{number(item.quantity_in_discrepancy)}</dd></div>
                                  </dl>
                                </article>
                              ))}
                            </div>
                            <h3>Movement history</h3>
                            <div className="amazon-inbound-movements">
                              {shipment.movements.length ? shipment.movements.map((movement) => (
                                <div key={movement.id}>
                                  <span>{dateTime(movement.created_at)}</span>
                                  <strong>{movement.movement_type}</strong>
                                  <span>{movement.from_location.replaceAll("_", " ")} → {movement.to_location.replaceAll("_", " ")}</span>
                                  <b>{number(movement.quantity)}</b>
                                </div>
                              )) : <p>No stock movements recorded for this shipment.</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="amazon-inbound-jobs">
        <div className="amazon-inbound-section-heading">
          <div>
            <span className="amazon-inbound-eyebrow">Operational history</span>
            <h2>Recent inbound synchronization jobs</h2>
          </div>
        </div>
        {jobs.length ? (
          <div className="amazon-inbound-job-list">
            {jobs.map((job) => (
              <article key={job.id}>
                <div>
                  <strong>{job.job_type} #{job.id}</strong>
                  <span>{dateTime(job.created_at)}</span>
                  {job.error_message ? <small>{job.error_message}</small> : null}
                </div>
                <span className={`amazon-inbound-status ${statusTone(job.status)}`}>{job.status}</span>
              </article>
            ))}
          </div>
        ) : <div className="amazon-inbound-empty is-compact">No inbound jobs yet.</div>}
      </section>

      {showCreate ? (
        <div className="amazon-inbound-modal-backdrop" role="presentation">
          <form className="amazon-inbound-modal is-wide" onSubmit={submitCreatePlan}>
            <div className="amazon-inbound-modal-heading">
              <div><span className="amazon-inbound-eyebrow">External action</span><h2>Create inbound plan</h2></div>
              <button type="button" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <p>This creates a real plan in Amazon Seller Central. The address is sent once and is not stored in the ERP.</p>
            <div className="amazon-inbound-form-grid">
              <label><span>Plan name</span><input required value={createForm.plan_name} onChange={(event) => setCreateForm((current) => ({ ...current, plan_name: event.target.value }))} /></label>
              <label><span>Source warehouse</span><input required value={createForm.source_warehouse_id} onChange={(event) => setCreateForm((current) => ({ ...current, source_warehouse_id: event.target.value }))} /></label>
              <label><span>Address reference</span><input required value={createForm.source_address_reference} onChange={(event) => setCreateForm((current) => ({ ...current, source_address_reference: event.target.value }))} /></label>
              <label><span>Contact name</span><input required value={createForm.source_address.name} onChange={(event) => updateCreateAddress("name", event.target.value)} /></label>
              <label><span>Company</span><input value={createForm.source_address.company_name} onChange={(event) => updateCreateAddress("company_name", event.target.value)} /></label>
              <label className="is-span-2"><span>Address line 1</span><input required value={createForm.source_address.address_line1} onChange={(event) => updateCreateAddress("address_line1", event.target.value)} /></label>
              <label><span>City</span><input required value={createForm.source_address.city} onChange={(event) => updateCreateAddress("city", event.target.value)} /></label>
              <label><span>State / province</span><input value={createForm.source_address.state_or_province_code} onChange={(event) => updateCreateAddress("state_or_province_code", event.target.value)} /></label>
              <label><span>Postal code</span><input required value={createForm.source_address.postal_code} onChange={(event) => updateCreateAddress("postal_code", event.target.value)} /></label>
              <label><span>Country code</span><input required maxLength="2" value={createForm.source_address.country_code} onChange={(event) => updateCreateAddress("country_code", event.target.value.toUpperCase())} /></label>
              <label><span>Phone</span><input required value={createForm.source_address.phone_number} onChange={(event) => updateCreateAddress("phone_number", event.target.value)} /></label>
              <label><span>Email</span><input type="email" value={createForm.source_address.email} onChange={(event) => updateCreateAddress("email", event.target.value)} /></label>
            </div>
            <div className="amazon-inbound-form-section">
              <div><h3>Products and quantities</h3><button type="button" onClick={addCreateItem}>Add product</button></div>
              {createForm.items.map((item, index) => (
                <div className="amazon-inbound-form-item" key={`create-item-${index}`}>
                  <select required value={item.product_id} onChange={(event) => updateCreateItem(index, "product_id", event.target.value)}>
                    <option value="">Choose ERP product</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.article_no} — {product.name} ({number(product.factory_stock)} available)</option>)}
                  </select>
                  <input type="number" min="1" required value={item.quantity} onChange={(event) => updateCreateItem(index, "quantity", event.target.value)} />
                  <button type="button" disabled={createForm.items.length === 1} onClick={() => removeCreateItem(index)}>Remove</button>
                </div>
              ))}
            </div>
            <label className="amazon-inbound-confirm">
              <input type="checkbox" checked={createForm.confirm_external_creation} onChange={(event) => setCreateForm((current) => ({ ...current, confirm_external_creation: event.target.checked }))} />
              I understand this creates an inbound plan in Amazon Seller Central.
            </label>
            <div className="amazon-inbound-modal-actions">
              <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="is-primary" type="submit" disabled={busy === "create" || !createForm.confirm_external_creation}>Create in Amazon</button>
            </div>
          </form>
        </div>
      ) : null}

      {trackingTarget ? (
        <div className="amazon-inbound-modal-backdrop" role="presentation">
          <form className="amazon-inbound-modal" onSubmit={saveTracking}>
            <div className="amazon-inbound-modal-heading"><h2>Shipment tracking</h2><button type="button" onClick={() => setTrackingTarget(null)}>×</button></div>
            <label><span>Carrier</span><input required value={trackingForm.carrier_name} onChange={(event) => setTrackingForm((current) => ({ ...current, carrier_name: event.target.value }))} /></label>
            <label><span>Tracking number</span><input required value={trackingForm.tracking_number} onChange={(event) => setTrackingForm((current) => ({ ...current, tracking_number: event.target.value }))} /></label>
            <label className="amazon-inbound-confirm"><input type="checkbox" checked={trackingForm.mark_shipped} onChange={(event) => setTrackingForm((current) => ({ ...current, mark_shipped: event.target.checked, confirm_stock_movement: false }))} />Mark shipped and move planned units to FBA In Transit</label>
            {trackingForm.mark_shipped ? <label className="amazon-inbound-confirm is-warning"><input type="checkbox" checked={trackingForm.confirm_stock_movement} onChange={(event) => setTrackingForm((current) => ({ ...current, confirm_stock_movement: event.target.checked }))} />Confirm the Factory Available stock deduction</label> : null}
            <label className="amazon-inbound-confirm"><input type="checkbox" checked={trackingForm.submit_to_amazon} onChange={(event) => setTrackingForm((current) => ({ ...current, submit_to_amazon: event.target.checked }))} />Submit carton tracking to Amazon (requires Amazon box IDs)</label>
            <div className="amazon-inbound-modal-actions"><button type="button" onClick={() => setTrackingTarget(null)}>Cancel</button><button className="is-primary" type="submit" disabled={busy === `tracking-${trackingTarget.id}` || (trackingForm.mark_shipped && !trackingForm.confirm_stock_movement)}>Save tracking</button></div>
          </form>
        </div>
      ) : null}

      {reconcileTarget ? (
        <div className="amazon-inbound-modal-backdrop" role="presentation">
          <form className="amazon-inbound-modal is-wide" onSubmit={submitReconcile}>
            <div className="amazon-inbound-modal-heading"><div><span className="amazon-inbound-eyebrow">Append-only corrections</span><h2>Reconcile shipment</h2></div><button type="button" onClick={() => setReconcileTarget(null)}>×</button></div>
            <div className="amazon-inbound-reconcile-list">
              {reconcileRows.map((row, index) => (
                <article key={row.shipment_item_id}>
                  <div><strong>{row.seller_sku}</strong><span>{number(row.quantity_shipped)} shipped</span></div>
                  <label><span>Received</span><input type="number" min="0" value={row.quantity_received} onChange={(event) => updateReconcile(index, "quantity_received", event.target.value)} /></label>
                  <label><span>Missing</span><input type="number" min="0" value={row.quantity_missing} onChange={(event) => updateReconcile(index, "quantity_missing", event.target.value)} /></label>
                  <label><span>Damaged</span><input type="number" min="0" value={row.quantity_damaged} onChange={(event) => updateReconcile(index, "quantity_damaged", event.target.value)} /></label>
                </article>
              ))}
            </div>
            <label><span>Reconciliation note</span><textarea value={reconcileNote} onChange={(event) => setReconcileNote(event.target.value)} /></label>
            <div className="amazon-inbound-modal-actions"><button type="button" onClick={() => setReconcileTarget(null)}>Cancel</button><button className="is-primary" type="submit" disabled={busy === `reconcile-${reconcileTarget.id}`}>Record movements</button></div>
          </form>
        </div>
      ) : null}

      {cartonTarget ? (
        <div className="amazon-inbound-modal-backdrop" role="presentation">
          <form className="amazon-inbound-modal" onSubmit={saveCarton}>
            <div className="amazon-inbound-modal-heading"><h2>Add or update carton</h2><button type="button" onClick={() => setCartonTarget(null)}>×</button></div>
            <div className="amazon-inbound-form-grid">
              <label><span>ERP carton reference</span><input value={cartonForm.carton_reference} onChange={(event) => setCartonForm((current) => ({ ...current, carton_reference: event.target.value }))} /></label>
              <label><span>Amazon box ID</span><input value={cartonForm.box_id} onChange={(event) => setCartonForm((current) => ({ ...current, box_id: event.target.value }))} /></label>
              <label><span>Length (cm)</span><input type="number" min="0" step="0.01" value={cartonForm.length} onChange={(event) => setCartonForm((current) => ({ ...current, length: event.target.value }))} /></label>
              <label><span>Width (cm)</span><input type="number" min="0" step="0.01" value={cartonForm.width} onChange={(event) => setCartonForm((current) => ({ ...current, width: event.target.value }))} /></label>
              <label><span>Height (cm)</span><input type="number" min="0" step="0.01" value={cartonForm.height} onChange={(event) => setCartonForm((current) => ({ ...current, height: event.target.value }))} /></label>
              <label><span>Weight (kg)</span><input type="number" min="0" step="0.01" value={cartonForm.weight} onChange={(event) => setCartonForm((current) => ({ ...current, weight: event.target.value }))} /></label>
            </div>
            <div className="amazon-inbound-modal-actions"><button type="button" onClick={() => setCartonTarget(null)}>Cancel</button><button className="is-primary" type="submit">Save carton</button></div>
          </form>
        </div>
      ) : null}

      {placementTarget ? (
        <div className="amazon-inbound-modal-backdrop" role="presentation">
          <section className="amazon-inbound-modal">
            <div className="amazon-inbound-modal-heading"><div><span className="amazon-inbound-eyebrow">Amazon options</span><h2>Placement options</h2></div><button type="button" onClick={() => setPlacementTarget(null)}>×</button></div>
            {placementOptions.length ? placementOptions.map((option) => (
              <article className="amazon-inbound-option" key={option.placement_option_id}>
                <div><strong>{option.shipment_count} shipment destination(s)</strong><span>{option.status}</span>{option.fees.map((fee) => <small key={`${fee.type}-${fee.amount}`}>{fee.type}: {fee.currency} {fee.amount}</small>)}</div>
                <button type="button" disabled={busy === `confirm-${placementTarget.id}`} onClick={() => confirmPlacement(option)}>Accept option</button>
              </article>
            )) : <div className="amazon-inbound-empty is-compact">Amazon has not offered placement options yet. Synchronize the plan after packing is complete.</div>}
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default AmazonFbaInbound;
