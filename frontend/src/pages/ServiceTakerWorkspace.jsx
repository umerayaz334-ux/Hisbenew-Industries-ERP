import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./ServiceTakerWorkspace.css";
import "./LocalOrders.css";

const isRupeeCurrency = (currency) => String(currency || "").toUpperCase() === "PKR";

const money = (value, currency = "USD") => {
  const amount = Number(value || 0);
  if (isRupeeCurrency(currency)) {
    return `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
};

const formatAmountForInput = (value, currency = "USD") => {
  const amount = Number(value || 0);
  if (!amount) return "";
  return isRupeeCurrency(currency) ? String(Math.round(amount)) : String(amount);
};

const sanitizeAmountInput = (value, currency = "USD") => {
  const next = String(value ?? "");
  return isRupeeCurrency(currency) ? next.replace(/[^\d]/g, "") : next;
};

const proofIsImage = (url = "") => /\.(png|jpg|jpeg|webp)$/i.test(String(url).split("?")[0]);

const number = (value) => new Intl.NumberFormat("en-US").format(Number(value || 0));

const optionalNumber = (value) =>
  value === "" || value === null || value === undefined ? null : Number(value);


const formatDateTime = (val) => {
  if (!val) return "Not set";
  const d = new Date(val);
  return Number.isNaN(d.getTime())
    ? "Not set"
    : d.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const shortDate = (value) => {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not set"
    : date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

const PAYMENT_PROOF_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf';

const errorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || item?.message || item?.detail)
      .filter(Boolean)
      .join(" ");
  }
  return fallback;
};

const emptyClient = () => ({
  company_name: "",
  contact_name: "",
  username: "",
  pin: "0000",
  email: "",
  phone: "",
  billing_address: "",
  currency: "USD",
  pick_pack_fee: "",
  additional_item_fee: "",
  label_fee: "",
  fulfillment_enabled: true,
  manufacturing_enabled: true,
  notes: "",
});

const emptyProduct = () => ({
  service_taker_id: "",
  sku: "",
  name: "",
  barcode: "",
  description: "",
  unit_weight_kg: "",
  length_cm: "",
  width_cm: "",
  height_cm: "",
  storage_location: "",
});

const emptyInbound = () => ({
  service_taker_id: "",
  client_reference: "",
  carrier: "",
  tracking_number: "",
  expected_at: "",
  notes: "",
  items: [{ product_id: "", quantity: 1 }],
});

const emptyOrder = () => ({
  service_taker_id: "",
  shipping_request_type: "stock",
  manufacturing_order_id: "",
  external_product_name: "",
  external_product_description: "",
  package_quantity: 1,
  package_weight_kg: "",
  package_length_cm: "",
  package_width_cm: "",
  package_height_cm: "",
  preferred_courier: "FedEx",
  shipping_service: "Economy",
  recipient_name: "",
  recipient_company: "",
  address_line_1: "",
  city: "",
  state: "",
  postal_code: "",
  country: "USA",
  label_source: "Hisbenew",
  notes: "",
  items: [{ product_id: "", quantity: 1 }],
});

const emptyManufacturing = () => ({
  service_taker_id: "",
  client_reference: "",
  product_id: "",
  product_name: "",
  quantity: 1,
  steel_type: "",
  tang_type: "",
  blade_thickness_mm: "",
  blade_length_in: "",
  overall_length_in: "",
  handle_material: "",
  sheath_type: "",
  finish: "",
  hardness: "",
  edge_type: "",
  packaging: "",
  target_unit_price: "",
  requested_ready_at: "",
  notes: "",
});
const emptyPortalPaymentProof = () => ({
  manufacturing_order_id: "",
  amount: "",
  payment_type: "Deposit",
  note: "",
});

function Status({ value }) {
  const key = String(value || "").toLowerCase().replace(/\s+/g, "-");
  return <span className={`service-status is-${key}`}>{value || "Unknown"}</span>;
}

const manufacturingRoadmapSteps = [
  "Quote requested",
  "Quoted",
  "Deposit pending",
  "Confirmed",
  "In production",
  "Quality check",
  "Ready",
  "Completed",
];

const manufacturingStepIndex = (status) => {
  const index = manufacturingRoadmapSteps.indexOf(status);
  return index;
};

const pendingManufacturingPayments = (order, type = '') =>
  (order?.payments || []).filter(
    (payment) =>
      payment.status === 'Pending confirmation' &&
      (!type || String(payment.payment_type || '').toLowerCase() === String(type).toLowerCase())
  );

const hasPendingManufacturingDeposit = (order) => pendingManufacturingPayments(order).length > 0;

const pendingManufacturingPaymentOfType = (order, type) => pendingManufacturingPayments(order, type).length > 0;

const liveManufacturingStatuses = [
  "Confirmed",
  "In production",
  "Quality check",
  "Ready",
];

const openFulfillmentStatuses = ["Submitted", "Awaiting label", "Processing", "Ready"];
const shippingRequestOptions = [
  {
    value: "stock",
    title: "Ship Hisbenew warehouse stock",
    detail: "Products stored in your Hisbenew inventory.",
  },
  {
    value: "manufactured",
    title: "Ship products made by Hisbenew",
    detail: "Finished local orders ready for delivery.",
  },
  {
    value: "external",
    title: "Ship any outside product",
    detail: "Use Hisbenew shipping channel for other parcels.",
  },
];
const courierOptions = ["FedEx", "DHL", "UPS", "USPS", "OnTrac", "Other"];
const shippingServiceOptions = ["Economy", "Express", "Priority", "Air freight", "Custom"];
const shippingTypeLabel = (value) =>
  shippingRequestOptions.find((option) => option.value === value)?.title ||
  "Ship Hisbenew warehouse stock";
const shippingProductSummary = (order) => {
  const requestType = order?.shipping_request_type || "stock";
  if (requestType === "manufactured") {
    return (
      order.product_description ||
      [order.manufacturing_request_no, order.manufacturing_product_name]
        .filter(Boolean)
        .join(" / ") ||
      "Hisbenew-made products"
    );
  }
  if (requestType === "external") {
    return order.product_description || "Outside product shipment";
  }
  const items = Array.isArray(order?.items) ? order.items : [];
  const first = items[0];
  if (!first) return "Warehouse SKU shipment";
  return [
    first.sku || "SKU",
    first.product_name || "Product",
    items.length > 1 ? `+ ${items.length - 1} more` : "",
  ]
    .filter(Boolean)
    .join(" / ");
};
const shippingPackageSummary = (order) => {
  const dims = [order?.package_length_cm, order?.package_width_cm, order?.package_height_cm]
    .filter((value) => Number(value || 0) > 0)
    .map((value) => Number(value).toLocaleString("en-US"));
  return [
    `${number(order?.item_quantity || order?.package_quantity || 1)} pcs`,
    Number(order?.package_weight_kg || 0) > 0 ? `${order.package_weight_kg} kg` : "",
    dims.length === 3 ? `${dims.join(" x ")} cm` : "",
  ]
    .filter(Boolean)
    .join(" / ");
};
const acceptedManufacturingStatuses = [
  "Deposit pending",
  "Confirmed",
  "In production",
  "Quality check",
  "Ready",
  "Completed",
];
const openAcceptedManufacturingStatuses = [
  "Deposit pending",
  "Confirmed",
  "In production",
  "Quality check",
  "Ready",
];

const manufacturingProgressPercent = (order) => {
  if (!order || ["Quote requested", "Rejected", "Cancelled"].includes(order.status)) return 0;
  if (order.status === "Completed") return 100;
  const index = manufacturingRoadmapSteps.indexOf(order.status);
  if (index < 0) return 0;
  return Math.max(8, Math.round(((index + 1) / manufacturingRoadmapSteps.length) * 100));
};

const canProceedLocalOrder = (order) =>
  ["Quoted", "Deposit pending"].includes(order?.status) &&
  Number(order?.quoted_total || 0) > 0 &&
  !pendingManufacturingPaymentOfType(order, "Deposit");

const canRejectLocalOrder = (order) =>
  ["Quote requested", "Quoted"].includes(order?.status) &&
  !hasPendingManufacturingDeposit(order);

const canRequestFinalManufacturingBalance = (order) =>
  ["Ready", "Completed"].includes(order?.status) &&
  Number(order?.balance_due || 0) > 0 &&
  !pendingManufacturingPaymentOfType(order, "Balance");

const defaultManufacturingPaymentAmount = (order, paymentType = "Deposit") => {
  if (!order) return "";
  const depositDue = Number(order.deposit_balance_due || order.deposit_required || 0);
  const balanceDue = Number(order.balance_due || 0);
  const amount = paymentType === "Balance" 
    ? (balanceDue > 0 ? balanceDue : Number(order.quoted_total || 0)) 
    : (depositDue > 0 ? depositDue : (balanceDue > 0 ? balanceDue : Number(order.quoted_total || 0)));
  return amount > 0 ? formatAmountForInput(amount, order.currency) : "";
};

const latestManufacturingUpdate = (order) => {
  const updates = Array.isArray(order?.updates) ? order.updates : [];
  return updates.length ? updates[0] : null;
};

function ManufacturingRoadmap({ order }) {
  const activeIndex = manufacturingStepIndex(order.status);
  return (
    <div className="service-manufacturing-roadmap" aria-label="Local order roadmap">
      {manufacturingRoadmapSteps.map((step, index) => (
        <span
          className={index <= activeIndex ? "is-active" : ""}
          key={step}
          title={step}
        >
          {step.replace("In production", "Production").replace("Quality check", "QC")}
        </span>
      ))}
    </div>
  );
}

const workflowMilestones = [
  { key: "Quote requested", label: "Requested" },
  { key: "Quoted", label: "Quoted" },
  { key: "Deposit pending", label: "Deposit" },
  { key: "Confirmed", label: "Confirmed" },
  { key: "In production", label: "In Production" },
  { key: "Quality check", label: "QC" },
  { key: "Ready", label: "Ready" },
  { key: "Completed", label: "Completed" },
];

function LocalOrderWorkflowTimeline({ order, onSelectStage = null, interactive = false }) {
  if (!order) return null;
  const currentStatus = order.status || "Quote requested";
  const isRejectedOrCancelled = ["Rejected", "Cancelled"].includes(currentStatus);
  const activeIdx = manufacturingStepIndex(currentStatus);

  const getMilestoneDate = (milestone, idx) => {
    if (milestone.key === "Quote requested" || idx === 0) return order.created_at ? shortDate(order.created_at) : "Created";
    if (milestone.key === "Confirmed" && order.confirmed_at) return shortDate(order.confirmed_at);
    if (milestone.key === "In production" && order.production_started_at) return shortDate(order.production_started_at);
    if (milestone.key === "Ready" && order.ready_at) return shortDate(order.ready_at);
    if (milestone.key === "Completed" && order.completed_at) return shortDate(order.completed_at);
    
    const matchingUpdate = (order.updates || []).find((u) => u.status === milestone.key);
    if (matchingUpdate?.created_at) return shortDate(matchingUpdate.created_at);

    if (idx <= activeIdx && order.updated_at) return shortDate(order.updated_at);
    return null;
  };

  const calculateProgressPercent = () => {
    if (isRejectedOrCancelled || activeIdx < 0) return 0;
    if (activeIdx >= workflowMilestones.length - 1) return 100;
    return Math.round((activeIdx / (workflowMilestones.length - 1)) * 100);
  };

  return (
    <div className={`service-workflow-timeline-wrapper ${isRejectedOrCancelled ? "is-closed" : ""}`}>
      <div className="service-workflow-timeline-track-container">
        <button
          type="button"
          className="service-workflow-nav-btn is-prev"
          aria-label="Previous milestone"
          onClick={() => {
            if (interactive && onSelectStage && activeIdx > 0) {
              onSelectStage(manufacturingRoadmapSteps[activeIdx - 1]);
            }
          }}
          disabled={!interactive || activeIdx <= 0}
          title="Previous Stage"
        >
          <span>&#8249;</span>
        </button>

        <div className="service-workflow-timeline-rail">
          <div className="service-workflow-track-bg">
            <div
              className="service-workflow-track-fill"
              style={{ width: `${calculateProgressPercent()}%` }}
            />
          </div>

          {workflowMilestones.map((milestone, idx) => {
            const isCompleted = !isRejectedOrCancelled && activeIdx > idx;
            const isCurrent = !isRejectedOrCancelled && activeIdx === idx;
            const isPending = !isRejectedOrCancelled && activeIdx < idx;
            const dateStr = getMilestoneDate(milestone, idx);

            return (
              <div
                key={milestone.key}
                className={`service-workflow-node ${isCompleted ? "is-completed" : ""} ${
                  isCurrent ? "is-current" : ""
                } ${isPending ? "is-pending" : ""} ${interactive ? "is-clickable" : ""}`}
                onClick={() => {
                  if (interactive && onSelectStage) {
                    onSelectStage(milestone.key);
                  }
                }}
                title={`${milestone.label} - ${dateStr || "Pending"}`}
              >
                <div className="service-workflow-node-date">
                  {dateStr || (isCurrent ? "In Progress" : "")}
                </div>

                <div className="service-workflow-node-dot">
                  {isCompleted ? (
                    <span className="service-workflow-check">&#10003;</span>
                  ) : (
                    <span className="service-workflow-inner-circle" />
                  )}
                </div>

                <div className="service-workflow-node-label">{milestone.label}</div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="service-workflow-nav-btn is-next"
          aria-label="Next milestone"
          onClick={() => {
            if (interactive && onSelectStage && activeIdx < manufacturingRoadmapSteps.length - 1) {
              onSelectStage(manufacturingRoadmapSteps[activeIdx + 1]);
            }
          }}
          disabled={!interactive || activeIdx >= manufacturingRoadmapSteps.length - 1}
          title="Next Stage"
        >
          <span>&#8250;</span>
        </button>
      </div>
    </div>
  );
}

function Modal({ title, subtitle, children, onClose, actions, className = "" }) {
  return (
    <div className="service-modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className={`service-modal ${className}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            aria-label="Close"
            className="service-icon-button"
            onClick={onClose}
            title="Close"
            type="button"
          >
            x
          </button>
        </header>
        <div className="service-modal-body">{children}</div>
        <footer>{actions}</footer>
      </section>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="service-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export default function ServiceTakerWorkspace({
  mode = "portal",
  initialTab = "inventory",
}) {
  const isAdmin = mode === "admin";
  const [data, setData] = useState({
    stats: {},
    clients: [],
    products: [],
    inbounds: [],
    orders: [],
    manufacturing_orders: [],
    ledger: [],
    client: null,
  });
  const [activeTab, setActiveTab] = useState(
    isAdmin ? "clients" : initialTab
  );
  const [clientFilter, setClientFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState("");
  const [clientForm, setClientForm] = useState(emptyClient);
  const [editingClientId, setEditingClientId] = useState(null);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingProductId, setEditingProductId] = useState(null);
  const [productImageFile, setProductImageFile] = useState(null);
  const [inboundForm, setInboundForm] = useState(emptyInbound);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [manufacturingForm, setManufacturingForm] = useState(emptyManufacturing);
  const [manufacturingImageFile, setManufacturingImageFile] = useState(null);
  const [depositOrder, setDepositOrder] = useState(null);
  const [manufacturingDepositProofFile, setManufacturingDepositProofFile] = useState(null);
  const [portalPaymentForm, setPortalPaymentForm] = useState(emptyPortalPaymentProof);
  const [portalPaymentProofFile, setPortalPaymentProofFile] = useState(null);
  const [selectedManufacturingId, setSelectedManufacturingId] = useState(null);
  const [manufacturingAdminForm, setManufacturingAdminForm] = useState({});
  const [manufacturingPaymentForm, setManufacturingPaymentForm] = useState({
    amount: "",
    payment_type: "Deposit",
    method: "",
    reference: "",
    note: "",
  });
  const [labelFile, setLabelFile] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [showAccountPayments, setShowAccountPayments] = useState(false);
  const [deleteClientTarget, setDeleteClientTarget] = useState(null);
  const [deleteClientConfirm, setDeleteClientConfirm] = useState("");
  const [costForm, setCostForm] = useState({});
  const [showManufacturingRecordPayment, setShowManufacturingRecordPayment] = useState(false);
  const [showManufacturingActivityLog, setShowManufacturingActivityLog] = useState(false);
  const [expandedPortalOrderIds, setExpandedPortalOrderIds] = useState([]);
  const [portalLocalStatusFilter, setPortalLocalStatusFilter] = useState("open");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.get(
        isAdmin
          ? "/service-takers/admin/dashboard"
          : "/service-takers/portal/dashboard"
      );
      setData(response.data || {});
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError, "Service fulfillment data could not be loaded."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (isAdmin || initialTab !== "dashboard") return undefined;
    const intervalId = window.setInterval(() => load({ quiet: true }), 30000);
    return () => window.clearInterval(intervalId);
  }, [initialTab, isAdmin, load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const clients = Array.isArray(data.clients) ? data.clients : [];
  const products = Array.isArray(data.products) ? data.products : [];
  const inbounds = Array.isArray(data.inbounds) ? data.inbounds : [];
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const manufacturingOrders = Array.isArray(data.manufacturing_orders)
    ? data.manufacturing_orders
    : [];
  const ledger = Array.isArray(data.ledger) ? data.ledger : [];
  const currency = data.client?.currency || clients[0]?.currency || "USD";
  const portalFulfillmentEnabled = isAdmin || data.client?.fulfillment_enabled !== false;
  const portalManufacturingEnabled = isAdmin || Boolean(data.client?.manufacturing_enabled);
  const portalAccountType = portalFulfillmentEnabled && portalManufacturingEnabled
    ? "Fulfillment and local orders"
    : portalManufacturingEnabled
      ? "Local orders"
      : "Fulfillment";

  const filterClientId =
    clientFilter === "all" || !clientFilter ? null : Number(clientFilter);
  const query = search.trim().toLowerCase();
  const matchesClient = (row) =>
    !filterClientId || Number(row.service_taker_id) === filterClientId;
  const matchesSearch = (...values) =>
    !query || values.some((value) => String(value || "").toLowerCase().includes(query));

  const visibleClients = useMemo(
    () => clients.filter((client) => matchesSearch(client.company_name, client.contact_name, client.username, client.email, client.phone)),
    [clients, query]
  );
const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          matchesClient(product) &&
          matchesSearch(product.sku, product.name, product.barcode, product.storage_location)
      ),
    [products, filterClientId, query]
  );
  const visibleInbounds = useMemo(
    () =>
      inbounds.filter(
        (inbound) =>
          matchesClient(inbound) &&
          matchesSearch(
            inbound.inbound_no,
            inbound.client_reference,
            inbound.company_name,
            inbound.tracking_number
          )
      ),
    [inbounds, filterClientId, query]
  );
  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          matchesClient(order) &&
          matchesSearch(
            order.request_no,
            order.client_reference,
            order.company_name,
            order.recipient_name,
            order.tracking_number,
            order.product_description,
            order.preferred_courier,
            order.courier
          )
      ),
    [orders, filterClientId, query]
  );
  const visibleManufacturing = useMemo(
    () =>
      manufacturingOrders.filter(
        (order) =>
          matchesClient(order) &&
          matchesSearch(
            order.request_no,
            order.client_reference,
            order.company_name,
            order.product_name,
            order.steel_type,
            order.tang_type,
            order.status
          )
      ),
    [manufacturingOrders, filterClientId, query]
  );
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || null;
  const selectedManufacturing =
    manufacturingOrders.find((order) => order.id === selectedManufacturingId) || null;
  const activeProducts = products.filter((product) => product.is_active);
  const outOfStockProducts = activeProducts.filter(
    (product) => Number(product.quantity_on_hand || 0) <= 0
  );
  const fullyReservedProducts = activeProducts.filter(
    (product) =>
      Number(product.quantity_on_hand || 0) > 0 &&
      Number(product.available_quantity || 0) <= 0
  );
  const unavailableProducts = activeProducts.filter(
    (product) => Number(product.available_quantity || 0) <= 0
  );
  const availableProducts = activeProducts.filter(
    (product) => Number(product.available_quantity || 0) > 0
  );
  const inventoryAvailabilityPercent = activeProducts.length
    ? Math.round(
        (availableProducts.length / activeProducts.length) * 100
      )
    : null;
  const stockTrackingProducts = [...activeProducts].sort((left, right) => {
    const rank = (product) => {
      const onHand = Number(product.quantity_on_hand || 0);
      const available = Number(product.available_quantity || 0);
      if (onHand <= 0) return 0;
      if (available <= 0) return 1;
      return 2;
    };
    return rank(left) - rank(right);
  });
  const openInboundNotices = inbounds.filter((inbound) =>
    ["Submitted", "Partially received"].includes(inbound.status)
  );
  const incomingUnits = openInboundNotices.reduce(
    (total, inbound) =>
      total +
      Math.max(
        0,
        Number(inbound.expected_quantity || 0) -
          Number(inbound.received_quantity || 0)
      ),
    0
  );
  const dispatchPriority = {
    Ready: 0,
    Processing: 1,
    "Awaiting label": 2,
    Submitted: 3,
  };
  const dispatchQueue = orders
    .filter((order) =>
      ["Awaiting label", "Submitted", "Processing", "Ready"].includes(order.status)
    )
    .sort(
      (left, right) =>
        dispatchPriority[left.status] - dispatchPriority[right.status]
    );
  const shippedOrders = orders
    .filter((order) => order.status === "Shipped")
    .sort(
      (left, right) =>
        new Date(right.shipped_at || right.updated_at || 0) -
        new Date(left.shipped_at || left.updated_at || 0)
    );
  const openShippingRequests = visibleOrders.filter((order) =>
    openFulfillmentStatuses.includes(order.status)
  );
  const stockShippingRequests = visibleOrders.filter(
    (order) => (order.shipping_request_type || "stock") === "stock"
  );
  const manufacturedShippingRequests = visibleOrders.filter(
    (order) => order.shipping_request_type === "manufactured"
  );
  const externalShippingRequests = visibleOrders.filter(
    (order) => order.shipping_request_type === "external"
  );
  const shippingCourierSummary = courierOptions.map((courier) => ({
    courier,
    count: visibleOrders.filter(
      (order) =>
        String(order.courier || order.preferred_courier || "").toLowerCase() ===
        courier.toLowerCase()
    ).length,
  }));
  const readyToShipCount = dispatchQueue.filter(
    (order) => order.status === "Ready"
  ).length;
  const billableOrders = orders.filter(
    (order) => order.status !== "Cancelled" && Number(order.total_cost || 0) > 0
  );
  const manufacturingDueOrders = manufacturingOrders.filter(
    (order) => !["Cancelled", "Rejected"].includes(order.status) && Number(order.balance_due || 0) > 0
  );
  const pendingManufacturingDeposits = manufacturingOrders.filter(
    (order) => !["Cancelled", "Rejected"].includes(order.status) && hasPendingManufacturingDeposit(order)
  );
  const pendingManufacturingPaymentRows = manufacturingOrders.flatMap((order) =>
    pendingManufacturingPayments(order).map((payment) => ({ order, payment }))
  );
  const allManufacturingPaymentHistoryRows = manufacturingOrders
    .flatMap((order) =>
      (order.payments || []).map((payment) => ({ order, payment }))
    )
    .sort(
      (a, b) =>
        new Date(b.payment.paid_at || b.payment.created_at || 0) -
        new Date(a.payment.paid_at || a.payment.created_at || 0)
    );
  const confirmedPaymentHistoryTotal = allManufacturingPaymentHistoryRows
    .filter((row) => row.payment.status === "Confirmed")
    .reduce((sum, row) => sum + Number(row.payment.amount || 0), 0);
  const pendingManufacturingPaymentTotal = pendingManufacturingPaymentRows.reduce(
    (sum, row) => sum + Number(row.payment.amount || 0),
    0
  );
  const paymentEligibleManufacturingOrders = manufacturingOrders.filter(
    (order) =>
      !["Cancelled", "Rejected"].includes(order.status) &&
      Number(order.quoted_total || 0) > 0
  );
  const portalPaymentSelectedOrder = manufacturingOrders.find(
    (order) => String(order.id) === String(portalPaymentForm.manufacturing_order_id)
  );
  const manufacturingShipmentOptions = manufacturingOrders.filter((order) => {
    if (!["Ready", "Completed"].includes(order.status)) return false;
    const selectedClientId = isAdmin ? orderForm.service_taker_id : data.client?.id;
    if (!selectedClientId) return true;
    return String(order.service_taker_id) === String(selectedClientId);
  });
  const localQuoteRequests = manufacturingOrders.filter(
    (order) => order.status === "Quote requested"
  ).length;
  const quotedLocalOrders = manufacturingOrders.filter(
    (order) => ["Quoted", "Deposit pending"].includes(order.status)
  ).length;
  const activeLocalOrders = manufacturingOrders.filter(
    (order) => liveManufacturingStatuses.includes(order.status)
  ).length;
  const readyLocalOrders = manufacturingOrders.filter((order) => order.status === "Ready").length;
  const localOrderBalanceDue = manufacturingDueOrders.reduce(
    (sum, order) => sum + Number(order.balance_due || 0),
    0
  );

  // Helper to calculate total pending balance for a specific service taker (across all local orders + fulfillment orders)
  const getServiceTakerTotalPendingBalance = (serviceTakerId) => {
    if (!serviceTakerId) return 0;
    const clientLocalDue = manufacturingOrders
      .filter((o) => Number(o.service_taker_id) === Number(serviceTakerId) && openAcceptedManufacturingStatuses.includes(o.status))
      .reduce((sum, o) => sum + Number(o.balance_due || 0), 0);
    const clientOrderDue = orders
      .filter((o) => Number(o.service_taker_id) === Number(serviceTakerId) && o.status !== "Cancelled")
      .reduce((sum, o) => sum + Number(o.total_cost || 0), 0);
    return roundToTwo(clientLocalDue + clientOrderDue);
  };

  const roundToTwo = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
  const selectedAccount = clients.find((client) => client.id === selectedAccountId) || null;
  const selectedAccountProducts = selectedAccount
    ? products.filter((product) => Number(product.service_taker_id) === Number(selectedAccount.id))
    : [];
  const selectedAccountOpenFulfillmentOrders = selectedAccount
    ? orders.filter(
        (order) =>
          Number(order.service_taker_id) === Number(selectedAccount.id) &&
          openFulfillmentStatuses.includes(order.status)
      )
    : [];
  const selectedAccountManufacturingOrders = selectedAccount
    ? manufacturingOrders.filter((order) => Number(order.service_taker_id) === Number(selectedAccount.id))
    : [];
  const selectedAccountAcceptedManufacturingOrders = selectedAccountManufacturingOrders.filter((order) =>
    acceptedManufacturingStatuses.includes(order.status)
  );
  const selectedAccountOpenManufacturingOrders = selectedAccountManufacturingOrders.filter((order) =>
    openAcceptedManufacturingStatuses.includes(order.status)
  );
  const selectedAccountPaymentRows = selectedAccountManufacturingOrders
    .flatMap((order) =>
      (order.payments || []).map((payment) => ({
        order,
        payment,
      }))
    )
    .sort(
      (left, right) =>
        new Date(right.payment.created_at || right.payment.paid_at || 0) -
        new Date(left.payment.created_at || left.payment.paid_at || 0)
    );
  const selectedAccountPendingPaymentRows = selectedAccountPaymentRows.filter(
    ({ payment }) => payment.status === "Pending confirmation"
  );
  const selectedAccountOpenBalance = roundToTwo(
    selectedAccountOpenManufacturingOrders.reduce((sum, order) => sum + Number(order.balance_due || 0), 0) +
      selectedAccountOpenFulfillmentOrders.reduce((sum, order) => sum + Number(order.total_cost || 0), 0)
  );
  const selectedAccountReceivedTotal = roundToTwo(
    selectedAccountPaymentRows
      .filter(({ payment }) => payment.status === "Confirmed")
      .reduce((sum, { payment }) => sum + Number(payment.amount || 0), 0)
  );
  const recentLocalOrders = manufacturingOrders
    .filter((order) => order.status !== "Cancelled")
    .sort(
      (left, right) =>
        new Date(right.updated_at || right.created_at || 0) -
        new Date(left.updated_at || left.created_at || 0)
    );
  const onHandUnits = Number(data.stats?.quantity_on_hand || 0);
  const availableUnits = Number(data.stats?.available_quantity || 0);
  const reservedUnits = Number(data.stats?.reserved_quantity || 0);
  const dispatchStages = [
    ["Awaiting label", "Awaiting label"],
    ["Submitted", "Submitted"],
    ["Processing", "Processing"],
    ["Ready", "Ready to ship"],
    ["Shipped", "Dispatched"],
  ];
  const localOrderStages = [
    ["Quote requested", "Requested"],
    ["Quoted", "Quoted"],
    ["Deposit pending", "Deposit"],
    ["Confirmed", "Confirmed"],
    ["In production", "Production"],
    ["Quality check", "QC"],
    ["Ready", "Ready"],
  ];

  const manufacturingSpec = (order) =>
    [
      order.steel_type,
      order.tang_type,
      order.blade_thickness_mm ? `${order.blade_thickness_mm} mm blade` : "",
      order.blade_length_in ? `${order.blade_length_in} in blade` : "",
      order.overall_length_in ? `${order.overall_length_in} in overall` : "",
      order.handle_material,
      order.sheath_type,
      order.finish,
    ]
      .filter(Boolean)
      .join(" / ");
  const productsForClient = (serviceTakerId) =>
    products.filter(
      (product) =>
        product.is_active &&
        (!isAdmin || Number(product.service_taker_id) === Number(serviceTakerId))
    );
  const manufacturingCatalogProducts = productsForClient(
    manufacturingForm.service_taker_id
  );

  const showSuccess = (message) => {
    setNotice(message);
    setError("");
  };

  const submitClient = async (event) => {
    event.preventDefault();
    if (!clientForm.fulfillment_enabled && !clientForm.manufacturing_enabled) {
      setError("Select at least one portal service.");
      return;
    }
    setBusy("client");
    try {
      const payload = {
        ...clientForm,
        pick_pack_fee: Number(clientForm.pick_pack_fee || 0),
        additional_item_fee: Number(clientForm.additional_item_fee || 0),
        label_fee: Number(clientForm.label_fee || 0),
      };
      if (editingClientId && !payload.pin) delete payload.pin;
      if (editingClientId) {
        await api.patch(`/service-takers/admin/clients/${editingClientId}`, payload);
      } else {
        await api.post("/service-takers/admin/clients", payload);
      }
      setModal("");
      setClientForm(emptyClient());
      setEditingClientId(null);
      showSuccess(
        editingClientId
          ? "Service taker account updated."
          : "Service taker and portal account created."
      );
      await load({ quiet: true });
    } catch (submitError) {
      setError(errorMessage(submitError, "Service taker could not be created."));
    } finally {
      setBusy("");
    }
  };

  const submitProduct = async (event) => {
    event.preventDefault();
    const productName = productForm.name.trim();
    if (!productName) {
      setError("Product name is required.");
      return;
    }
    setBusy("product");
    try {
      const collectionEndpoint = isAdmin
        ? "/service-takers/admin/products"
        : "/service-takers/portal/products";
      const optionalNumber = (value) => (value === "" ? null : Number(value));
      const payload = {
        ...productForm,
        sku: productForm.sku.trim() || null,
        name: productName,
        service_taker_id: isAdmin ? Number(productForm.service_taker_id) : null,
        unit_weight_kg: optionalNumber(productForm.unit_weight_kg),
        length_cm: optionalNumber(productForm.length_cm),
        width_cm: optionalNumber(productForm.width_cm),
        height_cm: optionalNumber(productForm.height_cm),
      };
      if (editingProductId) delete payload.sku;
      const response = editingProductId
        ? await api.patch(`${collectionEndpoint}/${editingProductId}`, payload)
        : await api.post(collectionEndpoint, payload);
      if (productImageFile) {
        const formData = new FormData();
        formData.append("image_file", productImageFile);
        try {
          await api.post(
            `${collectionEndpoint}/${response.data.id}/image`,
            formData
          );
        } catch (imageError) {
          setModal("");
          setEditingProductId(null);
          setProductImageFile(null);
          setProductForm(emptyProduct());
          setError(
            errorMessage(
              imageError,
              "Product saved, but its image could not be uploaded."
            )
          );
          await load({ quiet: true });
          return;
        }
      }
      closeProductModal();
      showSuccess(
        editingProductId
          ? "Product details updated."
          : "Product added to your separate catalog."
      );
      await load({ quiet: true });
    } catch (submitError) {
      setError(errorMessage(submitError, "Product could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const updateLine = (setter, lineIndex, field, value) => {
    setter((current) => ({
      ...current,
      items: current.items.map((item, index) =>
        index === lineIndex ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addLine = (setter) => {
    setter((current) => ({
      ...current,
      items: [...current.items, { product_id: "", quantity: 1 }],
    }));
  };

  const removeLine = (setter, lineIndex) => {
    setter((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, index) => index !== lineIndex),
    }));
  };

  const submitInbound = async (event) => {
    event.preventDefault();
    setBusy("inbound");
    try {
      const endpoint = isAdmin
        ? "/service-takers/admin/inbounds"
        : "/service-takers/portal/inbounds";
      await api.post(endpoint, {
        ...inboundForm,
        service_taker_id: isAdmin ? Number(inboundForm.service_taker_id) : null,
        expected_at: inboundForm.expected_at
          ? `${inboundForm.expected_at}T00:00:00`
          : null,
        items: inboundForm.items.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
        })),
      });
      setModal("");
      setInboundForm(emptyInbound());
      showSuccess("Inbound notice submitted.");
      await load({ quiet: true });
    } catch (submitError) {
      setError(errorMessage(submitError, "Inbound notice could not be submitted."));
    } finally {
      setBusy("");
    }
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    const requestType = orderForm.shipping_request_type || "stock";
    const stockItems = orderForm.items
      .filter((item) => item.product_id)
      .map((item) => ({
        product_id: Number(item.product_id),
        quantity: Number(item.quantity || 1),
      }));
    const selectedManufacturingShipment = manufacturingOrders.find(
      (order) => String(order.id) === String(orderForm.manufacturing_order_id)
    );
    const externalProductDescription = [
      orderForm.external_product_name,
      orderForm.external_product_description,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" - ");
    const productDescription =
      requestType === "external"
        ? externalProductDescription
        : requestType === "manufactured"
          ? selectedManufacturingShipment
            ? [
                selectedManufacturingShipment.request_no,
                selectedManufacturingShipment.product_name,
              ]
                .filter(Boolean)
                .join(" / ")
            : ""
          : "";

    if (requestType === "stock" && stockItems.length === 0) {
      setError("Select at least one warehouse SKU to ship.");
      return;
    }
    if (requestType === "manufactured" && !orderForm.manufacturing_order_id) {
      setError("Select a ready local order to ship.");
      return;
    }
    if (requestType === "external" && !productDescription) {
      setError("Enter the outside product or parcel details.");
      return;
    }

    setBusy("order");
    try {
      const endpoint = isAdmin
        ? "/service-takers/admin/orders"
        : "/service-takers/portal/orders";
      const response = await api.post(endpoint, {
        ...orderForm,
        service_taker_id: isAdmin ? Number(orderForm.service_taker_id) : null,
        shipping_request_type: requestType,
        manufacturing_order_id:
          requestType === "manufactured"
            ? Number(orderForm.manufacturing_order_id)
            : null,
        product_description: productDescription,
        package_quantity: Number(
          orderForm.package_quantity ||
            (requestType === "stock"
              ? stockItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
              : selectedManufacturingShipment?.quantity ||
                1)
        ),
        package_weight_kg: optionalNumber(orderForm.package_weight_kg),
        package_length_cm: optionalNumber(orderForm.package_length_cm),
        package_width_cm: optionalNumber(orderForm.package_width_cm),
        package_height_cm: optionalNumber(orderForm.package_height_cm),
        preferred_courier: orderForm.preferred_courier,
        shipping_service: orderForm.shipping_service,
        items: requestType === "stock" ? stockItems : [],
      });
      if (labelFile && response.data?.id) {
        try {
          const formData = new FormData();
          formData.append("label_file", labelFile);
          await api.post(
            isAdmin
              ? `/service-takers/admin/orders/${response.data.id}/label`
              : `/service-takers/portal/orders/${response.data.id}/label`,
            formData
          );
        } catch (uploadError) {
          setModal("");
          setOrderForm(emptyOrder());
          setLabelFile(null);
          setError(
            errorMessage(
              uploadError,
              "Shipping request was created, but the label could not be uploaded."
            )
          );
          await load({ quiet: true });
          return;
        }
      }
      setModal("");
      setOrderForm(emptyOrder());
      setLabelFile(null);
      showSuccess("Shipping request submitted.");
      await load({ quiet: true });
    } catch (submitError) {
      setError(errorMessage(submitError, "Shipping request could not be created."));
    } finally {
      setBusy("");
    }
  };

  const submitManufacturing = async (event) => {
    event.preventDefault();
    setBusy("manufacturing");
    try {
      const selectedQuoteProduct = products.find(
        (product) => String(product.id) === String(manufacturingForm.product_id)
      );
      const productName = selectedQuoteProduct
        ? selectedQuoteProduct.name
        : manufacturingForm.product_name.trim();
      if (!productName) {
        setError("Choose an existing product or enter a new product/design name.");
        return;
      }
      const endpoint = isAdmin
        ? "/service-takers/admin/local-orders"
        : "/service-takers/portal/local-orders";
      const response = await api.post(endpoint, {
        ...manufacturingForm,
        product_id: selectedQuoteProduct ? Number(selectedQuoteProduct.id) : null,
        product_name: productName,
        client_reference: manufacturingForm.client_reference || selectedQuoteProduct?.sku || "",
        service_taker_id: isAdmin ? Number(manufacturingForm.service_taker_id) : null,
        quantity: Number(manufacturingForm.quantity || 1),
        steel_type: isAdmin ? manufacturingForm.steel_type : "",
        tang_type: isAdmin ? manufacturingForm.tang_type : "",
        blade_thickness_mm: isAdmin ? optionalNumber(manufacturingForm.blade_thickness_mm) : null,
        blade_length_in: isAdmin ? optionalNumber(manufacturingForm.blade_length_in) : null,
        overall_length_in: isAdmin ? optionalNumber(manufacturingForm.overall_length_in) : null,
        handle_material: isAdmin ? manufacturingForm.handle_material : "",
        sheath_type: isAdmin ? manufacturingForm.sheath_type : "",
        finish: isAdmin ? manufacturingForm.finish : "",
        hardness: isAdmin ? manufacturingForm.hardness : "",
        edge_type: isAdmin ? manufacturingForm.edge_type : "",
        packaging: isAdmin ? manufacturingForm.packaging : "",
        target_unit_price: isAdmin ? optionalNumber(manufacturingForm.target_unit_price) : null,
        requested_ready_at: isAdmin && manufacturingForm.requested_ready_at
          ? `${manufacturingForm.requested_ready_at}T00:00:00`
          : null,
      });
      if (manufacturingImageFile && response.data?.id) {
        const formData = new FormData();
        formData.append("image_file", manufacturingImageFile);
        try {
          await api.post(`${endpoint}/${response.data.id}/image`, formData);
        } catch (imageError) {
          setError(
            errorMessage(
              imageError,
              "Quote request saved, but its product picture could not be uploaded."
            )
          );
          await load({ quiet: true });
          return;
        }
      }
      setModal("");
      setManufacturingImageFile(null);
      setManufacturingForm(emptyManufacturing());
      showSuccess("Local order quote request submitted.");
      await load({ quiet: true });
    } catch (submitError) {
      setError(errorMessage(submitError, "Local order quote could not be submitted."));
    } finally {
      setBusy("");
    }
  };

  const openManufacturingDetail = (order) => {
    setShowManufacturingRecordPayment(false);
    setShowManufacturingActivityLog(false);
    setSelectedManufacturingId(order.id);
    setManufacturingAdminForm({
      status: order.status || "Quote requested",
      client_reference: order.client_reference || "",
      steel_type: order.steel_type || "",
      tang_type: order.tang_type || "",
      blade_thickness_mm: order.blade_thickness_mm ?? "",
      blade_length_in: order.blade_length_in ?? "",
      overall_length_in: order.overall_length_in ?? "",
      handle_material: order.handle_material || "",
      sheath_type: order.sheath_type || "",
      finish: order.finish || "",
      hardness: order.hardness || "",
      edge_type: order.edge_type || "",
      packaging: order.packaging || "",
      quoted_unit_price: order.quoted_unit_price || "",
      tooling_cost: order.tooling_cost || "",
      deposit_required: order.deposit_required || "",
      estimated_ready_at: order.estimated_ready_at
        ? String(order.estimated_ready_at).slice(0, 10)
        : "",
      admin_notes: order.admin_notes || "",
      update_message: "",
    });
    setManufacturingPaymentForm({
      amount: "",
      payment_type: "Deposit",
      method: "",
      reference: "",
      note: "",
    });
    setModal("manufacturing-process");
  };

  const advanceManufacturingStage = async (order, targetStage) => {
    if (!order || !targetStage) return;
    setBusy(`stage-${targetStage}`);
    try {
      await api.patch(`/service-takers/admin/local-orders/${order.id}`, {
        status: targetStage,
        update_message: `Workflow advanced to ${targetStage} from company console.`,
      });
      showSuccess(`Order status updated to ${targetStage}.`);
      setManufacturingAdminForm((current) => ({ ...current, status: targetStage }));
      await load({ quiet: true });
    } catch (err) {
      setError(errorMessage(err, `Failed to update status to ${targetStage}.`));
    } finally {
      setBusy("");
    }
  };

  const confirmPendingPayment = async (order, payment) => {
    if (!order || !payment) return;
    setBusy(`confirm-payment-${payment.id}`);
    try {
      await api.post(`/service-takers/admin/local-orders/${order.id}/payments/${payment.id}/confirm`);
      showSuccess(`Payment of ${money(payment.amount, order.currency)} confirmed.`);
      await load({ quiet: true });
    } catch (err) {
      setError(errorMessage(err, "Failed to confirm payment."));
    } finally {
      setBusy("");
    }
  };

  const saveManufacturing = async (event) => {
    event.preventDefault();
    if (!selectedManufacturing) return;
    setBusy("save-manufacturing");
    try {
      await api.patch(
        `/service-takers/admin/local-orders/${selectedManufacturing.id}`,
        {
          ...manufacturingAdminForm,
          quoted_unit_price: Number(manufacturingAdminForm.quoted_unit_price || 0),
          tooling_cost: Number(manufacturingAdminForm.tooling_cost || 0),
          deposit_required: Number(manufacturingAdminForm.deposit_required || 0),
          blade_thickness_mm: optionalNumber(manufacturingAdminForm.blade_thickness_mm),
          blade_length_in: optionalNumber(manufacturingAdminForm.blade_length_in),
          overall_length_in: optionalNumber(manufacturingAdminForm.overall_length_in),
          estimated_ready_at: manufacturingAdminForm.estimated_ready_at
            ? `${manufacturingAdminForm.estimated_ready_at}T00:00:00`
            : null,
        }
      );
      showSuccess("Local order quote updated.");
      setManufacturingAdminForm((current) => ({ ...current, update_message: "" }));
      await load({ quiet: true });
    } catch (saveError) {
      setError(errorMessage(saveError, "Local order quote could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const recordManufacturingPayment = async (event) => {
    event.preventDefault();
    if (!selectedManufacturing) return;
    setBusy("manufacturing-payment");
    try {
      await api.post(
        `/service-takers/admin/local-orders/${selectedManufacturing.id}/payments`,
        {
          ...manufacturingPaymentForm,
          amount: Number(manufacturingPaymentForm.amount || 0),
        }
      );
      showSuccess("Local order payment recorded.");
      setManufacturingPaymentForm({
        amount: "",
        payment_type: "Deposit",
        method: "",
        reference: "",
        note: "",
      });
      await load({ quiet: true });
    } catch (paymentError) {
      setError(errorMessage(paymentError, "Local order payment could not be recorded."));
    } finally {
      setBusy("");
    }
  };

  const openManufacturingPaymentProof = (order = null, paymentType = "Payment") => {
    const defaultAmount = order
      ? defaultManufacturingPaymentAmount(order, paymentType)
      : (Number(localOrderBalanceDue || 0) > 0 ? formatAmountForInput(localOrderBalanceDue, currency) : "");
    setPortalPaymentForm({
      manufacturing_order_id: order?.id ? String(order.id) : "",
      amount: defaultAmount,
      payment_type: paymentType || "Payment",
      note: "",
    });
    setPortalPaymentProofFile(null);
    setModal("manufacturing-payment-proof");
  };

  const closeManufacturingPaymentProof = () => {
    setPortalPaymentForm(emptyPortalPaymentProof());
    setPortalPaymentProofFile(null);
    setModal("");
  };

  const openManufacturingDeposit = (order) => {
    if (Number(order?.deposit_balance_due || order?.deposit_required || 0) > 0) {
      openManufacturingPaymentProof(order, "Deposit");
      return;
    }
    setDepositOrder(order);
    setManufacturingDepositProofFile(null);
    setModal('manufacturing-deposit');
  };

  const closeManufacturingDeposit = () => {
    setDepositOrder(null);
    setManufacturingDepositProofFile(null);
    setModal('');
  };

  const goToServiceCharges = () => {
    const currentPath = window.location.pathname;
    const nextPath = currentPath.includes("/portal/")
      ? currentPath.replace(/\/portal\/.*/, "/portal/service-taker/charges")
      : "/portal/service-taker/charges";
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(
      new CustomEvent("erp:navigation", {
        detail: { page: "Service Charges", source: "navigation" },
      })
    );
    setActiveTab("billing");
  };

  const requestManufacturingDeposit = async () => {
    if (!depositOrder) return;
    setBusy(`manufacturing-deposit-${depositOrder.id}`);
    try {
      const formData = new FormData();
      if (manufacturingDepositProofFile) formData.append('proof_file', manufacturingDepositProofFile);
      await api.post(`/service-takers/portal/local-orders/${depositOrder.id}/deposit`, formData);
      showSuccess(`${depositOrder.request_no} deposit sent for company confirmation.`);
      closeManufacturingDeposit();
      goToServiceCharges();
      await load({ quiet: true });
    } catch (depositError) {
      setError(errorMessage(depositError, "Local order deposit could not be marked."));
    } finally {
      setBusy("");
    }
  };
  const rejectManufacturingQuote = async (order) => {
    if (!order) return;
    setBusy(`manufacturing-reject-${order.id}`);
    try {
      await api.post(`/service-takers/portal/local-orders/${order.id}/reject`);
      showSuccess(`${order.request_no} quote request closed.`);
      await load({ quiet: true });
    } catch (rejectError) {
      setError(errorMessage(rejectError, "Local order quote could not be closed."));
    } finally {
      setBusy("");
    }
  };

  const requestManufacturingBalance = (order) => {
    if (!order) return;
    openManufacturingPaymentProof(order, "Balance");
  };

  const submitManufacturingPaymentProof = async (event) => {
    event.preventDefault();
    if (!portalPaymentForm.amount || Number(portalPaymentForm.amount) <= 0) {
      setError("Enter the payment amount.");
      return;
    }
    if (!portalPaymentProofFile) {
      setError("Upload the payment screenshot or receipt.");
      return;
    }
    setBusy("manufacturing-payment-proof");
    try {
      const formData = new FormData();
      formData.append("amount", portalPaymentForm.amount);
      formData.append("payment_type", portalPaymentForm.payment_type || "Payment");
      formData.append("note", portalPaymentForm.note || "");
      formData.append("proof_file", portalPaymentProofFile);
      
      const targetOrder = portalPaymentForm.manufacturing_order_id
        ? manufacturingOrders.find((o) => String(o.id) === String(portalPaymentForm.manufacturing_order_id))
        : (manufacturingOrders.find((o) => !["Cancelled", "Rejected"].includes(o.status) && Number(o.balance_due || 0) > 0)
           || manufacturingOrders.find((o) => !["Cancelled", "Rejected"].includes(o.status))
           || manufacturingOrders[0]);

      const targetOrderId = targetOrder?.id || portalPaymentForm.manufacturing_order_id;
      const endpoint = targetOrderId
        ? `/service-takers/portal/local-orders/${targetOrderId}/payments`
        : `/service-takers/portal/payments`;

      await api.post(endpoint, formData);
      showSuccess("Payment screenshot sent for company confirmation.");
      closeManufacturingPaymentProof();
      goToServiceCharges();
      await load({ quiet: true });
    } catch (paymentError) {
      setError(errorMessage(paymentError, "Payment screenshot could not be submitted."));
    } finally {
      setBusy("");
    }
  };
  const uploadManufacturingPaymentProof = async (order, payment, file) => {
    if (!order || !payment || !file) return;
    setBusy(`manufacturing-proof-${payment.id}`);
    try {
      const formData = new FormData();
      formData.append('proof_file', file);
      await api.post(`/service-takers/portal/local-orders/${order.id}/payments/${payment.id}/proof`, formData);
      showSuccess('Payment proof uploaded for company confirmation.');
      await load({ quiet: true });
    } catch (proofError) {
      setError(errorMessage(proofError, 'Payment proof could not be uploaded.'));
    } finally {
      setBusy('');
    }
  };


  const receiveInbound = async (inbound) => {
    setBusy(`receive-${inbound.id}`);
    try {
      await api.post(`/service-takers/admin/inbounds/${inbound.id}/receive`, {
        items: [],
      });
      showSuccess(`${inbound.inbound_no} received into client inventory.`);
      await load({ quiet: true });
    } catch (receiveError) {
      setError(errorMessage(receiveError, "Inbound stock could not be received."));
    } finally {
      setBusy("");
    }
  };

  const cancelInbound = async (inbound) => {
    setBusy(`inbound-${inbound.id}`);
    try {
      await api.post(`/service-takers/portal/inbounds/${inbound.id}/cancel`);
      showSuccess(`${inbound.inbound_no} cancelled.`);
      await load({ quiet: true });
    } catch (cancelError) {
      setError(errorMessage(cancelError, "Inbound notice could not be cancelled."));
    } finally {
      setBusy("");
    }
  };

  const openOrderDetail = (order) => {
    setSelectedOrderId(order.id);
    setCostForm({
      status:
        order.status === "Awaiting label" || order.status === "Submitted"
          ? "Processing"
          : order.status,
      courier: order.courier || order.preferred_courier || "",
      shipping_service: order.shipping_service || "",
      tracking_number: order.tracking_number || "",
      shipping_cost: order.shipping_cost || "",
      pick_pack_cost: order.pick_pack_cost || "",
      label_cost: order.label_cost || "",
      other_cost: order.other_cost || "",
      notes: order.notes || "",
    });
    setLabelFile(null);
    setModal("order-detail");
  };

  const saveOrder = async (event) => {
    event.preventDefault();
    if (!selectedOrder) return;
    setBusy("save-order");
    try {
      await api.patch(`/service-takers/admin/orders/${selectedOrder.id}`, {
        ...costForm,
        shipping_cost: Number(costForm.shipping_cost || 0),
        pick_pack_cost: Number(costForm.pick_pack_cost || 0),
        label_cost: Number(costForm.label_cost || 0),
        other_cost: Number(costForm.other_cost || 0),
      });
      showSuccess("Fulfillment status and charges saved.");
      await load({ quiet: true });
    } catch (saveError) {
      setError(errorMessage(saveError, "Shipment request could not be updated."));
    } finally {
      setBusy("");
    }
  };

  const uploadOrderLabel = async (order, file) => {
    if (!file) return;
    setBusy(`label-${order.id}`);
    try {
      const formData = new FormData();
      formData.append("label_file", file);
      await api.post(
        isAdmin
          ? `/service-takers/admin/orders/${order.id}/label`
          : `/service-takers/portal/orders/${order.id}/label`,
        formData
      );
      showSuccess("Shipping label uploaded.");
      await load({ quiet: true });
    } catch (uploadError) {
      setError(errorMessage(uploadError, "Shipping label could not be uploaded."));
    } finally {
      setBusy("");
    }
  };

  const shipOrder = async (order) => {
    setBusy(`ship-${order.id}`);
    try {
      await api.post(`/service-takers/admin/orders/${order.id}/ship`);
      const stockNote = (order.shipping_request_type || "stock") === "stock" ? " and client stock deducted" : "";
      showSuccess(`${order.request_no} shipped${stockNote}.`);
      setSelectedOrderId(null);
      setModal("");
      await load({ quiet: true });
    } catch (shipError) {
      setError(errorMessage(shipError, "Shipment could not be completed."));
    } finally {
      setBusy("");
    }
  };

  const cancelOrder = async (order) => {
    setBusy(`cancel-${order.id}`);
    try {
      await api.post(
        isAdmin
          ? `/service-takers/admin/orders/${order.id}/cancel`
          : `/service-takers/portal/orders/${order.id}/cancel`
      );
      showSuccess(`${order.request_no} cancelled${(order.shipping_request_type || "stock") === "stock" ? " and stock released" : ""}.`);
      setSelectedOrderId(null);
      setModal("");
      await load({ quiet: true });
    } catch (cancelError) {
      setError(errorMessage(cancelError, "Shipping request could not be cancelled."));
    } finally {
      setBusy("");
    }
  };

  const toggleClient = async (client) => {
    setBusy(`client-${client.id}`);
    try {
      await api.patch(`/service-takers/admin/clients/${client.id}`, {
        is_active: !client.is_active,
      });
      showSuccess(`${client.company_name} ${client.is_active ? "paused" : "activated"}.`);
      await load({ quiet: true });
    } catch (toggleError) {
      setError(errorMessage(toggleError, "Account status could not be changed."));
    } finally {
      setBusy("");
    }
  };

  const editClient = (client) => {
    setEditingClientId(client.id);
    setClientForm({
      company_name: client.company_name || "",
      contact_name: client.contact_name || "",
      username: client.username || "",
      pin: "",
      email: client.email || "",
      phone: client.phone || "",
      billing_address: client.billing_address || "",
      currency: client.currency || "USD",
      pick_pack_fee: client.pick_pack_fee ?? "",
      additional_item_fee: client.additional_item_fee ?? "",
      label_fee: client.label_fee ?? "",
      fulfillment_enabled: client.fulfillment_enabled ?? true,
      manufacturing_enabled: client.manufacturing_enabled ?? false,
      notes: client.notes || "",
    });
    setModal("client");
  };

  const closeClientModal = () => {
    setModal("");
    setEditingClientId(null);
    setClientForm(emptyClient());
  };

  const openClientModal = () => {
    setEditingClientId(null);
    setClientForm(emptyClient());
    setModal("client");
  };

  const openClientAccount = (client) => {
    setSelectedAccountId(client.id);
    setShowAccountPayments(false);
    setModal("client-account");
  };

  const closeClientAccount = () => {
    setSelectedAccountId(null);
    setShowAccountPayments(false);
    setModal("");
  };

  const openDeleteClient = (client) => {
    setDeleteClientTarget(client);
    setDeleteClientConfirm("");
  };

  const closeDeleteClient = () => {
    setDeleteClientTarget(null);
    setDeleteClientConfirm("");
  };

  const deleteClient = async () => {
    if (!deleteClientTarget || deleteClientConfirm.trim() !== deleteClientTarget.company_name) return;
    setBusy(`delete-client-${deleteClientTarget.id}`);
    try {
      await api.post(`/service-takers/admin/clients/${deleteClientTarget.id}/delete`, null, {
        params: { confirmation: deleteClientConfirm.trim() },
      });
      showSuccess(`${deleteClientTarget.company_name} account deleted permanently.`);
      if (selectedAccountId === deleteClientTarget.id) {
        closeClientAccount();
      }
      closeDeleteClient();
      await load({ quiet: true });
    } catch (deleteError) {
      setError(errorMessage(deleteError, "Service taker account could not be deleted."));
    } finally {
      setBusy("");
    }
  };
const tabs = [
    ["clients", "Service takers", clients.length],
    ["inventory", "Client inventory", products.length],
    ["inbound", "Inbound", data.stats?.open_inbounds || 0],
    ["orders", "Shipping", data.stats?.open_orders || 0],
  ];
  const adminPageTitle = activeTab === "manufacturing" ? "Local Orders" : "Service Takers";
  const adminPageDetail =
    activeTab === "manufacturing"
      ? "Local manufacturing quotes, deposits, production timelines and customer balances"
      : "Client inventory, inbound receiving, outbound requests, labels and charges";
  const portalPageTitle =
    activeTab === "dashboard"
      ? "Dashboard"
      : activeTab === "inbound"
      ? "Inbound"
      : activeTab === "orders"
        ? "Shipping"
        : activeTab === "manufacturing"
          ? "Local Orders"
        : activeTab === "quotations"
          ? "Quotations"
        : activeTab === "billing"
          ? "Charges"
          : "Products & Inventory";

  const openProductModal = () => {
    setEditingProductId(null);
    setProductImageFile(null);
    setProductForm({
      ...emptyProduct(),
      service_taker_id:
        clientFilter !== "all" ? clientFilter : clients[0]?.id || "",
    });
    setModal("product");
  };

  const editProduct = (product) => {
    setEditingProductId(product.id);
    setProductImageFile(null);
    setProductForm({
      service_taker_id: product.service_taker_id || "",
      sku: product.sku || "",
      name: product.name || "",
      barcode: product.barcode || "",
      description: product.description || "",
      unit_weight_kg: product.unit_weight_kg ?? "",
      length_cm: product.length_cm ?? "",
      width_cm: product.width_cm ?? "",
      height_cm: product.height_cm ?? "",
      storage_location: product.storage_location || "",
    });
    setModal("product");
  };

  const closeProductModal = () => {
    setModal("");
    setEditingProductId(null);
    setProductImageFile(null);
    setProductForm(emptyProduct());
  };

  const uploadProductImage = async (product, file) => {
    if (!file) return;
    setBusy(`product-image-${product.id}`);
    try {
      const collectionEndpoint = isAdmin
        ? "/service-takers/admin/products"
        : "/service-takers/portal/products";
      const formData = new FormData();
      formData.append("image_file", file);
      await api.post(`${collectionEndpoint}/${product.id}/image`, formData);
      showSuccess("Product photo updated.");
      await load({ quiet: true });
    } catch (uploadError) {
      setError(errorMessage(uploadError, "Product photo could not be uploaded."));
    } finally {
      setBusy("");
    }
  };

  const openInboundModal = () => {
    setInboundForm({
      ...emptyInbound(),
      service_taker_id:
        clientFilter !== "all" ? clientFilter : clients[0]?.id || "",
    });
    setModal("inbound");
  };

  const openOrderModal = (preset = {}) => {
    const requestType = preset.shipping_request_type || "stock";
    setOrderForm({
      ...emptyOrder(),
      ...preset,
      shipping_request_type: requestType,
      service_taker_id:
        preset.service_taker_id ||
        (clientFilter !== "all" ? clientFilter : clients[0]?.id || ""),
      items:
        requestType === "stock"
          ? preset.items || [{ product_id: "", quantity: 1 }]
          : [],
    });
    setLabelFile(null);
    setModal("order");
  };

  const openManufacturingModal = (product = null) => {
    setManufacturingForm({
      ...emptyManufacturing(),
      service_taker_id:
        product?.service_taker_id ||
        (clientFilter !== "all" ? clientFilter : clients[0]?.id || ""),
      product_id: product?.id ? String(product.id) : "",
      product_name: product?.name || "",
      client_reference: product?.sku || "",
    });
    setManufacturingImageFile(null);
    setModal("manufacturing");
  };
  
  const toggleOrderExpansion = (orderId) => {
    setExpandedPortalOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  };

  if (loading) {
    return <div className="service-page-loading">Loading service portal...</div>;
  }

  return (
    <div
      className={`service-workspace ${isAdmin ? "is-admin" : "is-portal"} ${
        activeTab === "dashboard" && !isAdmin ? "is-dashboard-view" : ""
      }`.trim()}
    >
      {!(activeTab === "billing" && !isAdmin) && (
        <header className="service-page-header">
          <div>
            <span className="service-eyebrow">
              {isAdmin ? "Third-party fulfillment" : portalPageTitle}
            </span>
            <h1>{isAdmin ? adminPageTitle : data.client?.company_name || "Service Portal"}</h1>
            <p>
              {isAdmin
                ? adminPageDetail
                : `${portalAccountType} portal account ${data.client?.contact_name || ""}`}
            </p>
          </div>
          <div className="service-header-actions">
            <button className="service-secondary-button" onClick={() => load()} type="button">
              Refresh
            </button>
            {isAdmin && (
              <button className="service-primary-button" onClick={openClientModal} type="button">
                <span>+</span> Service taker
              </button>
            )}
          </div>
        </header>
      )}

      {(error || notice) && (
        <div className={`service-banner ${error ? "is-error" : "is-success"}`}>
          <span>{error || notice}</span>
          <button
            aria-label="Dismiss"
            onClick={() => {
              setError("");
              setNotice("");
            }}
            type="button"
          >
            x
          </button>
        </div>
      )}

      {isAdmin && (
        <section className="service-metrics" aria-label="Service fulfillment summary">
          <div>
            <span>Active clients</span>
            <strong>{number(data.stats?.active_service_takers)}</strong>
          </div>
          <div>
            <span>On hand</span>
            <strong>{number(data.stats?.quantity_on_hand)}</strong>
          </div>
          <div>
            <span>Reserved</span>
            <strong>{number(data.stats?.reserved_quantity)}</strong>
          </div>
          <div>
            <span>Available</span>
            <strong>{number(data.stats?.available_quantity)}</strong>
          </div>
          <div>
            <span>Open shipments</span>
            <strong>{number(data.stats?.open_orders)}</strong>
          </div>
          <div>
            <span>Fulfillment charges</span>
            <strong>{money(data.stats?.shipped_order_cost, currency)}</strong>
          </div>
        </section>
      )}



        {activeTab !== "dashboard" && !(activeTab === "billing" && !isAdmin) && (
        <div className="service-toolbar">
          <label className="service-search">
            <span>Search</span>
            <input
              aria-label="Search current view"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                activeTab === "inventory"
                  ? "Product name, SKU or barcode..."
                  : activeTab === "orders"
                    ? "Order number, customer or tracking..."
                    : activeTab === "manufacturing"
                      ? "Quote number, product, steel or status..."
                  : "Reference, tracking or recipient..."
              }
              value={search}
            />
          </label>
          {isAdmin && activeTab !== "clients" && (
            <select
              aria-label="Filter by service taker"
              onChange={(event) => setClientFilter(event.target.value)}
              value={clientFilter}
            >
              <option value="all">All service takers</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company_name}
                </option>
              ))}
            </select>
          )}
          <div className="service-toolbar-actions">
            {activeTab === "inventory" && (
              <button onClick={openProductModal} type="button">
                <span>+</span> Product
              </button>
            )}
            {activeTab === "inbound" && (
              <button onClick={openInboundModal} type="button">
                <span>+</span> Inbound
              </button>
            )}
            {activeTab === "orders" && (
              <button onClick={openOrderModal} type="button">
                <span>+</span> Shipping request
              </button>
            )}
          </div>
        </div>
      )}

      <section
        className={`service-workbench ${
          activeTab === "dashboard" && !isAdmin ? "is-dashboard" : ""
        }`.trim()}
      >
        {isAdmin && (
          <nav className="service-tabs" aria-label="Service fulfillment views">
            {tabs.map(([key, label, count]) => (
              <button
                className={activeTab === key ? "is-active" : ""}
                key={key}
                onClick={() => setActiveTab(key)}
                type="button"
              >
                <span>{label}</span>
                <b>{number(count)}</b>
              </button>
            ))}
          </nav>
        )}

        {activeTab === "dashboard" && !isAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "20px 24px", background: "#f8fafc", minHeight: "calc(100vh - 64px)", width: "100%", boxSizing: "border-box" }}>
            
            {/* Quick Actions Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  {data.client?.company_name || "Service Portal"} Overview
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 10 }}>
                  {portalAccountType}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {portalManufacturingEnabled && (
                  <>
                    <button
                      onClick={() => openManufacturingModal()}
                      type="button"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "#0f766e",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 6,
                        padding: "8px 14px",
                        fontSize: 12.5,
                        fontWeight: 650,
                        cursor: "pointer",
                      }}
                    >
                      + Request Quote
                    </button>
                    <button
                      
                      onClick={() => openManufacturingPaymentProof()}
                      type="button"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "#ffffff",
                        color: "#0f766e",
                        border: "1px solid #0f766e",
                        borderRadius: 6,
                        padding: "7px 13px",
                        fontSize: 12.5,
                        fontWeight: 650,
                        cursor: "pointer",
                      }}
                    >
                      + Add Payment Screenshot
                    </button>
                  </>
                )}
                {portalFulfillmentEnabled && (
                  <>
                    <button
                      onClick={openInboundModal}
                      type="button"
                      style={{
                        background: "#ffffff",
                        color: "#334155",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "7px 12px",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Inbound
                    </button>
                    <button
                      onClick={openOrderModal}
                      type="button"
                      style={{
                        background: "#0f766e",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 6,
                        padding: "8px 14px",
                        fontSize: 12.5,
                        fontWeight: 650,
                        cursor: "pointer",
                      }}
                    >
                      + Shipping
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Local Orders Manufacturing Section */}
            {portalManufacturingEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Metric Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                      Active Production
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                      {number(activeLocalOrders)}
                    </strong>
                    <small style={{ fontSize: 11.5, fontWeight: 600, color: "#16a34a" }}>
                      {number(readyLocalOrders)} ready for delivery
                    </small>
                  </div>

                  <div style={{ background: "#ffffff", border: (localQuoteRequests + quotedLocalOrders) > 0 ? "1px solid #fed7aa" : "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: (localQuoteRequests + quotedLocalOrders) > 0 ? "#9a3412" : "#64748b" }}>
                      Quotes Pending
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: (localQuoteRequests + quotedLocalOrders) > 0 ? "#d97706" : "#0f172a", lineHeight: 1.1 }}>
                      {number(localQuoteRequests + quotedLocalOrders)}
                    </strong>
                    <small style={{ fontSize: 11.5, fontWeight: 600, color: (localQuoteRequests + quotedLocalOrders) > 0 ? "#c2410c" : "#64748b" }}>
                      {number(quotedLocalOrders)} awaiting confirmation
                    </small>
                  </div>

                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                      Total Confirmed Paid
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", lineHeight: 1.1 }}>
                      {money(confirmedPaymentHistoryTotal, currency)}
                    </strong>
                    <small style={{ fontSize: 11.5, fontWeight: 600, color: "#059669" }}>
                      {allManufacturingPaymentHistoryRows.filter(r => r.payment.status === "Confirmed").length} verified payments
                    </small>
                  </div>

                  <div style={{ background: "#ffffff", border: Number(localOrderBalanceDue || 0) > 0 ? "1px solid #fecaca" : "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: Number(localOrderBalanceDue || 0) > 0 ? "#991b1b" : "#64748b" }}>
                      Remaining Balance Due
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: Number(localOrderBalanceDue || 0) > 0 ? "#dc2626" : "#0f172a", lineHeight: 1.1 }}>
                      {money(localOrderBalanceDue, currency)}
                    </strong>
                    <small style={{ fontSize: 11.5, fontWeight: 600, color: Number(localOrderBalanceDue || 0) > 0 ? "#b91c1c" : "#64748b" }}>
                      {number(pendingManufacturingPaymentRows.length)} waiting company check
                    </small>
                  </div>
                </div>

                {/* Production Stage Rail */}
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#475569" }}>
                        Local Orders Manufacturing Pipeline
                      </span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0f766e" }}>
                      {manufacturingOrders.length} total orders
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
                    {[
                      { key: "Quote requested", label: "Requested" },
                      { key: "Quoted", label: "Quoted" },
                      { key: "Deposit pending", label: "Deposit" },
                      { key: "Confirmed", label: "Confirmed" },
                      { key: "In production", label: "Production" },
                      { key: "Quality check", label: "QC" },
                      { key: "Ready", label: "Ready" },
                      { key: "Completed", label: "Completed" },
                    ].map((stage, idx) => {
                      const count = manufacturingOrders.filter(o => o.status === stage.key).length;
                      const hasWork = count > 0;
                      return (
                        <div
                          key={stage.key}
                          style={{
                            background: hasWork ? "#f0fdfa" : "#f8fafc",
                            border: hasWork ? "1px solid #99f6e4" : "1px solid #e2e8f0",
                            borderRadius: 6,
                            padding: "10px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: hasWork ? "#0f766e" : "#94a3b8" }}>#{idx + 1}</span>
                            <span style={{ fontSize: 14, fontWeight: 800, color: hasWork ? "#0f766e" : "#64748b" }}>{count}</span>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: hasWork ? "#134e4a" : "#475569", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {stage.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2-Column Split: Recent Orders & Recent Payments */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
                  
                  {/* Left Column: Recent Orders */}
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#0f172a" }}>
                        Recent Local Orders
                      </h3>
                      <button
                        onClick={() => setActiveTab("manufacturing")}
                        type="button"
                        style={{ background: "none", border: "none", color: "#0f766e", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}
                      >
                        View All ({manufacturingOrders.length}) Ã¢â€ â€™
                      </button>
                    </div>

                    {recentLocalOrders.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "30px 10px", color: "#64748b", fontSize: 13 }}>
                        No local manufacturing orders yet.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {recentLocalOrders.slice(0, 5).map((order) => {
                          const progress = manufacturingProgressPercent(order);
                          const imageUrl = order.image_url || order.product_image_url;
                          return (
                            <div
                              key={order.id}
                              onClick={() => setActiveTab("manufacturing")}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 12px",
                                background: "#f8fafc",
                                border: "1px solid #f1f5f9",
                                borderRadius: 6,
                                cursor: "pointer",
                                gap: 12,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 4,
                                    background: "#e2e8f0",
                                    overflow: "hidden",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  {imageUrl ? (
                                    <img alt={order.product_name} src={getStaticUrl(imageUrl)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  ) : (
                                    <span style={{ fontSize: 14, fontWeight: 800, color: "#64748b" }}>
                                      {String(order.product_name || order.request_no).charAt(0)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ minWidth: 0, overflow: "hidden" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <strong style={{ fontSize: 12.5, color: "#0f766e" }}>{order.request_no}</strong>
                                    <span style={{ fontSize: 11, color: "#64748b" }}>{shortDate(order.created_at)}</span>
                                  </div>
                                  <span style={{ fontSize: 12.5, fontWeight: 650, color: "#1e293b", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {order.product_name}
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>
                                    {Number(order.quoted_total || 0) > 0 ? money(order.quoted_total, order.currency) : "Pending"}
                                  </div>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: order.status === "Completed" ? "#475569" : "#16a34a" }}>
                                    {order.status === "Completed" ? "100%" : `${progress}%`}
                                  </span>
                                </div>
                                <Status value={order.status} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Recent Payments & Receipts */}
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#0f172a" }}>
                        Recent Payments & Receipts
                      </h3>
                      <button
                        onClick={() => setActiveTab("billing")}
                        type="button"
                        style={{ background: "none", border: "none", color: "#0f766e", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}
                      >
                        View All ({allManufacturingPaymentHistoryRows.length}) Ã¢â€ â€™
                      </button>
                    </div>

                    {allManufacturingPaymentHistoryRows.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "30px 10px", color: "#64748b", fontSize: 13 }}>
                        No payment records yet.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {allManufacturingPaymentHistoryRows.slice(0, 5).map(({ order, payment }) => (
                          <div
                            key={payment.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "10px 12px",
                              background: "#f8fafc",
                              border: "1px solid #f1f5f9",
                              borderRadius: 6,
                              gap: 12,
                            }}
                          >
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <strong style={{ fontSize: 13, color: "#0f172a" }}>{payment.payment_type || "Payment"}</strong>
                                <span style={{ fontSize: 11, color: "#64748b" }}>{formatDateTime(payment.paid_at || payment.created_at)}</span>
                              </div>
                              <span style={{ fontSize: 12, color: "#64748b", marginTop: 2, display: "block" }}>
                                {payment.method || "Bank Transfer"}{payment.note ? ` Ã‚Â· ${payment.note}` : ""}
                              </span>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ textAlign: "right" }}>
                                <strong style={{ fontSize: 13.5, color: payment.status === "Confirmed" ? "#16a34a" : "#d97706", display: "block" }}>
                                  {money(payment.amount, currency)}
                                </strong>
                                <Status value={payment.status || "Confirmed"} />
                              </div>
                              {payment.proof_url && (
                                <a
                                  href={getStaticUrl(payment.proof_url)}
                                  rel="noreferrer"
                                  target="_blank"
                                  style={{
                                    fontSize: 11,
                                    padding: "3px 7px",
                                    color: "#0f766e",
                                    fontWeight: 700,
                                    background: "#f0fdfa",
                                    border: "1px solid #ccfbf1",
                                    borderRadius: 4,
                                    textDecoration: "none",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Proof &#8599;
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            )}

            {/* Fulfillment Section if enabled */}
            {portalFulfillmentEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: portalManufacturingEnabled ? 12 : 0 }}>
                {portalManufacturingEnabled && (
                  <h3 style={{ margin: "10px 0 0 0", fontSize: 15, fontWeight: 750, color: "#0f172a" }}>
                    Shipping & Warehouse Inventory
                  </h3>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>Total SKUs</span>
                    <strong style={{ display: "block", fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{number(activeProducts.length)}</strong>
                    <small style={{ fontSize: 11, color: "#64748b" }}>{number(onHandUnits)} units on hand</small>
                  </div>
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>Available Units</span>
                    <strong style={{ display: "block", fontSize: 22, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>{number(availableUnits)}</strong>
                    <small style={{ fontSize: 11, color: "#64748b" }}>{number(reservedUnits)} units reserved</small>
                  </div>
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>Dispatch Queue</span>
                    <strong style={{ display: "block", fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{number(dispatchQueue.length)}</strong>
                    <small style={{ fontSize: 11, color: "#64748b" }}>{number(readyToShipCount)} ready to ship</small>
                  </div>
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>Dispatched</span>
                    <strong style={{ display: "block", fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{number(shippedOrders.length)}</strong>
                    <small style={{ fontSize: 11, color: "#64748b" }}>Completed outbound</small>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}


        {activeTab === "clients" && isAdmin && (
          <div className="service-client-grid">
            {clients.length === 0 ? (
              <EmptyState title="No service takers" detail="Create the first portal account." />
            ) : (
              clients
                .filter((client) =>
                  matchesSearch(client.company_name, client.contact_name, client.username)
                )
                .map((client) => (
                  <article className="service-client-card" key={client.id}>
                    <header>
                      <div>
                        <span>{client.contact_name}</span>
                        <h2>{client.company_name}</h2>
                      </div>
                      <Status value={client.is_active ? "Active" : "Paused"} />
                    </header>
                    <dl>
                      <div>
                        <dt>Portal user</dt>
                        <dd>{client.username}</dd>
                      </div>
                      <div>
                        <dt>SKUs</dt>
                        <dd>{number(client.product_count)}</dd>
                      </div>
                      <div>
                        <dt>Available</dt>
                        <dd>{number(client.available_quantity)}</dd>
                      </div>
                      <div>
                        <dt>Open work</dt>
                        <dd>{number(client.open_inbound_count + client.open_order_count)}</dd>
                      </div>
                    </dl>
                    <div className="service-rate-line">
                      <span>Pick & pack {money(client.pick_pack_fee, client.currency)}</span>
                      <span>Extra item {money(client.additional_item_fee, client.currency)}</span>
                      <span>Label {money(client.label_fee, client.currency)}</span>
                    </div>
                    <footer>
                      <button
                        className="service-text-button"
                        onClick={() => editClient(client)}
                        type="button"
                      >
                        Edit account
                      </button>
                      <button
                        className="service-text-button"
                        disabled={busy === `client-${client.id}`}
                        onClick={() => toggleClient(client)}
                        type="button"
                      >
                        {client.is_active ? "Pause portal" : "Activate portal"}
                      </button>
                    </footer>
                  </article>
                ))
            )}
          </div>
        )}

        {activeTab === "inventory" && !isAdmin && (
          <div className="service-table-wrap service-portal-product-list">
            {visibleProducts.length === 0 ? (
              <EmptyState
                title="No products yet"
                detail="Add your first product before sending stock to the warehouse."
              />
            ) : (
              <table className="service-table service-portal-products-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Barcode</th>
                    <th className="is-number">On hand</th>
                    <th className="is-number">Reserved</th>
                    <th className="is-number">Available</th>
                    <th>Weight</th>
                    <th>Dimensions</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="service-product-table-cell">
                          <div>
                            {product.image_url ? (
                              <img
                                alt={product.name}
                                src={getStaticUrl(product.image_url)}
                              />
                            ) : (
                              <span>{String(product.name || product.sku).charAt(0)}</span>
                            )}
                          </div>
                          <span>
                            <strong>{product.name}</strong>
                            <small>{product.sku}</small>
                            {product.description && (
                              <small title={product.description}>
                                {product.description}
                              </small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>{product.barcode || "Not set"}</td>
                      <td className="is-number">
                        <strong>{number(product.quantity_on_hand)}</strong>
                      </td>
                      <td className="is-number">{number(product.reserved_quantity)}</td>
                      <td className="is-number is-available">
                        <strong>{number(product.available_quantity)}</strong>
                      </td>
                      <td>
                        {product.unit_weight_kg
                          ? `${product.unit_weight_kg} kg`
                          : "Not set"}
                      </td>
                      <td>
                        {product.length_cm || product.width_cm || product.height_cm
                          ? `${product.length_cm || "-"} x ${product.width_cm || "-"} x ${product.height_cm || "-"} cm`
                          : "Not set"}
                      </td>
                      <td>
                        <Status
                          value={
                            product.stock_status ||
                            (Number(product.available_quantity || 0) > 0
                              ? "In stock"
                              : "Out of stock")
                          }
                        />
                      </td>
                      <td>
                        <div className="service-row-actions">
                          <button
                            className="service-row-button"
                            onClick={() => editProduct(product)}
                            type="button"
                          >
                            Edit
                          </button>
                          <label
                            className="service-row-button is-file"
                            title="Upload product photo"
                          >
                            {busy === `product-image-${product.id}`
                              ? "Uploading..."
                              : product.image_url
                                ? "Replace photo"
                                : "Add photo"}
                            <input
                              accept=".png,.jpg,.jpeg,.webp"
                              disabled={busy === `product-image-${product.id}`}
                              onChange={(event) => {
                                uploadProductImage(product, event.target.files?.[0]);
                                event.target.value = "";
                              }}
                              type="file"
                            />
                          </label>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "inventory" && isAdmin && (
          <div className="service-table-wrap">
            {visibleProducts.length === 0 ? (
              <EmptyState
                title="No product inventory"
                detail="Add a product to begin receiving stock."
              />
            ) : (
              <table className="service-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    {isAdmin && <th>Service taker</th>}
                    <th>Location</th>
                    <th>On hand</th>
                    <th>Reserved</th>
                    <th>Available</th>
                    <th>Weight / dimensions</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="service-product-table-cell">
                          <div>
                            {product.image_url ? (
                              <img alt="" src={getStaticUrl(product.image_url)} />
                            ) : (
                              <span>{String(product.name || product.sku).charAt(0)}</span>
                            )}
                          </div>
                          <span>
                            <strong>{product.name}</strong>
                            <small>{product.sku}</small>
                          </span>
                        </div>
                      </td>
                      {isAdmin && (
                        <td>
                          {clients.find((client) => client.id === product.service_taker_id)
                            ?.company_name || "Client"}
                        </td>
                      )}
                      <td>{product.storage_location || "Unassigned"}</td>
                      <td>{number(product.quantity_on_hand)}</td>
                      <td>{number(product.reserved_quantity)}</td>
                      <td>
                        <strong>{number(product.available_quantity)}</strong>
                      </td>
                      <td>
                        <strong>
                          {product.unit_weight_kg
                            ? `${product.unit_weight_kg} kg`
                            : "Not set"}
                        </strong>
                        <span>
                          {product.length_cm || product.width_cm || product.height_cm
                            ? `${product.length_cm || "-"} x ${product.width_cm || "-"} x ${product.height_cm || "-"} cm`
                            : "No dimensions"}
                        </span>
                      </td>
                      <td>
                        <Status
                          value={
                            product.stock_status ||
                            (Number(product.available_quantity || 0) > 0
                              ? "In stock"
                              : "Out of stock")
                          }
                        />
                      </td>
                      <td>
                        <div className="service-row-actions">
                          <button
                            className="service-row-button"
                            onClick={() => editProduct(product)}
                            type="button"
                          >
                            Edit
                          </button>
                          <label className="service-row-button is-file">
                            Photo
                            <input
                              accept=".png,.jpg,.jpeg,.webp"
                              disabled={busy === `product-image-${product.id}`}
                              onChange={(event) => {
                                uploadProductImage(product, event.target.files?.[0]);
                                event.target.value = "";
                              }}
                              type="file"
                            />
                          </label>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ledger.length > 0 && (
              <div className="service-ledger-band">
                <h3>Recent stock movements</h3>
                <div>
                  {ledger
                    .filter((entry) => matchesClient(entry))
                    .slice(0, 8)
                    .map((entry) => (
                      <span key={entry.id}>
                        <b className={entry.quantity_change > 0 ? "is-positive" : "is-negative"}>
                          {entry.quantity_change > 0 ? "+" : ""}
                          {entry.quantity_change}
                        </b>
                        <strong>{entry.sku}</strong>
                        <small>{entry.movement_type}</small>
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "inbound" && (
          <div className="service-table-wrap">
            {visibleInbounds.length === 0 ? (
              <EmptyState title="No inbound notices" detail="Submit stock before it arrives." />
            ) : (
              <table className="service-table">
                <thead>
                  <tr>
                    <th>Inbound</th>
                    {isAdmin && <th>Service taker</th>}
                    <th>Carrier / tracking</th>
                    <th>Expected</th>
                    <th>Units</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleInbounds.map((inbound) => (
                    <tr key={inbound.id}>
                      <td>
                        <strong>{inbound.inbound_no}</strong>
                        <span>{inbound.client_reference || "No client reference"}</span>
                      </td>
                      {isAdmin && <td>{inbound.company_name}</td>}
                      <td>
                        <strong>{inbound.carrier || "Not set"}</strong>
                        <span>{inbound.tracking_number || "No tracking"}</span>
                      </td>
                      <td>{shortDate(inbound.expected_at)}</td>
                      <td>
                        {number(inbound.received_quantity)} / {number(inbound.expected_quantity)}
                      </td>
                      <td><Status value={inbound.status} /></td>
                      <td>
                        {isAdmin &&
                          ["Submitted", "Partially received"].includes(inbound.status) && (
                            <button
                              className="service-row-button"
                              disabled={busy === `receive-${inbound.id}`}
                              onClick={() => receiveInbound(inbound)}
                              type="button"
                            >
                              Receive all
                            </button>
                          )}
                        {!isAdmin && inbound.status === "Submitted" && (
                          <button
                            className="service-row-button"
                            disabled={busy === `inbound-${inbound.id}`}
                            onClick={() => cancelInbound(inbound)}
                            type="button"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "orders" && !isAdmin && (
          <section className="service-ship-order-page">
            {visibleOrders.length === 0 ? (
              <EmptyState
                title="No ship orders"
                detail="Create a ship order when warehouse stock needs to go to a customer."
              />
            ) : (
              <div className="service-ship-order-scroll">
                <div className="service-ship-order-list">
                  <div className="service-ship-order-grid service-ship-order-head">
                    <span>Customer</span>
                    <span>Items</span>
                    <span>Shipping</span>
                    <span>Charges</span>
                    <span>Status</span>
                    <span aria-label="Actions" />
                  </div>
                  {visibleOrders.map((order) => {
                    const isCancelled = order.status === "Cancelled";
                    const canUploadLabel =
                      order.label_source === "Client" &&
                      !order.label_url &&
                      !["Shipped", "Cancelled"].includes(order.status);
                    const canCancel = ["Submitted", "Awaiting label"].includes(
                      order.status
                    );
                    return (
                      <article
                        className={`service-ship-order-grid service-ship-order-row ${
                          isCancelled ? "is-cancelled" : ""
                        }`.trim()}
                        key={order.id}
                      >
                        <div className="service-ship-order-customer">
                          <strong>{order.recipient_name}</strong>
                          {order.recipient_company && (
                            <small>{order.recipient_company}</small>
                          )}
                          <small>
                            {order.city}, {order.state} {order.postal_code}
                          </small>
                          <small>Created {shortDate(order.created_at)}</small>
                        </div>
                        <div className="service-ship-order-items-cell">
                          {(order.items || []).slice(0, 2).map((item) => (
                            <span key={item.id}>
                              <b>{item.sku}</b>
                              <small>x {number(item.quantity)}</small>
                            </span>
                          ))}
                          {(order.items || []).length > 2 && (
                            <small>+{number(order.items.length - 2)} more SKUs</small>
                          )}
                          <em>{number(order.item_quantity)} total units</em>
                        </div>
                        <div className="service-ship-order-shipping">
                          <strong>
                            {order.label_source === "Client"
                              ? "Your label"
                              : "Hisbenew label"}
                          </strong>
                          <small>{order.label_name || "Label pending"}</small>
                          <small>
                            {order.tracking_number
                              ? `${order.courier || "Carrier"} / ${order.tracking_number}`
                              : order.shipping_service || "Tracking pending"}
                          </small>
                        </div>
                        <div className="service-ship-order-cost">
                          <strong>
                            {money(isCancelled ? 0 : order.total_cost, order.currency)}
                          </strong>
                          <small>
                            {isCancelled
                              ? "No charge"
                              : order.total_cost
                                ? "Fulfillment total"
                                : "Pending"}
                          </small>
                        </div>
                        <div className="service-ship-order-status">
                          <Status value={order.status} />
                        </div>
                        <div className="service-ship-order-actions">
                          {order.label_url && (
                            <a
                              className="service-row-button"
                              href={getStaticUrl(order.label_url)}
                              rel="noreferrer"
                              target="_blank"
                            >
                              View label
                            </a>
                          )}
                          {canUploadLabel && (
                            <label
                              className="service-row-button is-file"
                              title="Upload shipping label"
                            >
                              {busy === `label-${order.id}`
                                ? "Uploading..."
                                : "Upload label"}
                              <input
                                accept=".pdf,.png,.jpg,.jpeg,.webp,.zpl,.zip,.btw"
                                disabled={busy === `label-${order.id}`}
                                onChange={(event) => {
                                  uploadOrderLabel(order, event.target.files?.[0]);
                                  event.target.value = "";
                                }}
                                type="file"
                              />
                            </label>
                          )}
                          {canCancel && (
                            <button
                              className="service-row-button is-danger"
                              disabled={busy === `cancel-${order.id}`}
                              onClick={() => cancelOrder(order)}
                              type="button"
                            >
                              Cancel
                            </button>
                          )}
                          {!order.label_url && !canUploadLabel && !canCancel && (
                            <span className="service-ship-order-no-action">
                              {isCancelled
                                ? "Closed"
                                : order.status === "Shipped"
                                  ? "Complete"
                                  : "In fulfillment"}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "orders" && isAdmin && (
          <div className={`service-order-layout ${selectedOrder && isAdmin ? "has-detail" : ""}`}>
            <div className="service-table-wrap">
              {visibleOrders.length === 0 ? (
                <EmptyState title="No shipment requests" detail="Create the first outbound request." />
              ) : (
                <table className="service-table">
                  <thead>
                    <tr>
                      <th>Request</th>
                      {isAdmin && <th>Service taker</th>}
                      <th>Recipient</th>
                      <th>Units</th>
                      <th>Label</th>
                      <th>Cost</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order) => (
                      <tr
                        className={selectedOrderId === order.id ? "is-selected" : ""}
                        key={order.id}
                      >
                        <td>
                          <strong>{order.request_no}</strong>
                          <span>{order.client_reference || shortDate(order.created_at)}</span>
                        </td>
                        {isAdmin && <td>{order.company_name}</td>}
                        <td>
                          <strong>{order.recipient_name}</strong>
                          <span>{order.city}, {order.state} {order.postal_code}</span>
                        </td>
                        <td>{number(order.item_quantity)}</td>
                        <td>
                          <strong>{order.label_source}</strong>
                          <span>{order.label_name || "Pending"}</span>
                        </td>
                        <td>{money(order.total_cost, order.currency)}</td>
                        <td><Status value={order.status} /></td>
                        <td>
                          {isAdmin ? (
                            <button
                              className="service-row-button"
                              onClick={() => openOrderDetail(order)}
                              type="button"
                            >
                              Process
                            </button>
                          ) : (
                            <div className="service-row-actions">
                              {order.label_source === "Client" &&
                                !order.label_url &&
                                !["Shipped", "Cancelled"].includes(order.status) && (
                                  <label className="service-row-button is-file">
                                    Label
                                    <input
                                      accept=".pdf,.png,.jpg,.jpeg,.webp,.zpl,.zip,.btw"
                                      onChange={(event) =>
                                        uploadOrderLabel(order, event.target.files?.[0])
                                      }
                                      type="file"
                                    />
                                  </label>
                                )}
                              {["Submitted", "Awaiting label"].includes(order.status) && (
                                <button
                                  className="service-row-button"
                                  onClick={() => cancelOrder(order)}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {selectedOrder && isAdmin && (
              <aside className="service-order-detail">
                <header>
                  <div>
                    <span>{selectedOrder.company_name}</span>
                    <h2>{selectedOrder.request_no}</h2>
                  </div>
                  <button
                    aria-label="Close details"
                    className="service-icon-button"
                    onClick={() => setSelectedOrderId(null)}
                    type="button"
                  >
                    ×
                  </button>
                </header>
                <div className="service-address-block">
                  <strong>{selectedOrder.recipient_name}</strong>
                  <span>{selectedOrder.address_line_1}</span>
                  {selectedOrder.address_line_2 && <span>{selectedOrder.address_line_2}</span>}
                  <span>
                    {selectedOrder.city}, {selectedOrder.state} {selectedOrder.postal_code}
                  </span>
                  <span>{selectedOrder.country}</span>
                </div>
                <div className="service-order-items">
                  {selectedOrder.items.map((item) => (
                    <span key={item.id}>
                      <strong>{item.sku}</strong>
                      <small>{item.product_name}</small>
                      <b>× {item.quantity}</b>
                    </span>
                  ))}
                </div>
                <form onSubmit={saveOrder}>
                  <div className="service-form-grid">
                    <label>
                      Status
                      <select
                        onChange={(event) =>
                          setCostForm((current) => ({ ...current, status: event.target.value }))
                        }
                        value={costForm.status || "Processing"}
                      >
                        <option value="Submitted">Submitted</option>
                        <option value="Processing">Processing</option>
                        <option value="Ready">Ready</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </label>
                    <label>
                      Courier
                      <input
                        onChange={(event) =>
                          setCostForm((current) => ({ ...current, courier: event.target.value }))
                        }
                        value={costForm.courier || ""}
                      />
                    </label>
                    <label>
                      Service
                      <input
                        onChange={(event) =>
                          setCostForm((current) => ({
                            ...current,
                            shipping_service: event.target.value,
                          }))
                        }
                        value={costForm.shipping_service || ""}
                      />
                    </label>
                    <label>
                      Tracking
                      <input
                        onChange={(event) =>
                          setCostForm((current) => ({
                            ...current,
                            tracking_number: event.target.value,
                          }))
                        }
                        value={costForm.tracking_number || ""}
                      />
                    </label>
                    {[
                      ["shipping_cost", "Shipping"],
                      ["pick_pack_cost", "Pick & pack"],
                      ["label_cost", "Label"],
                      ["other_cost", "Other"],
                    ].map(([field, label]) => (
                      <label key={field}>
                        {label} cost
                        <input
                          min="0"
                          onChange={(event) =>
                            setCostForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          step="0.01"
                          type="number"
                          value={costForm[field] ?? ""}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="service-detail-actions">
                    <button
                      className="service-secondary-button"
                      disabled={busy === "save-order"}
                      type="submit"
                    >
                      Save
                    </button>
                    <label className="service-secondary-button is-file">
                      {selectedOrder.label_url ? "Replace label" : "Upload label"}
                      <input
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.zpl,.zip,.btw"
                        onChange={(event) =>
                          uploadOrderLabel(selectedOrder, event.target.files?.[0])
                        }
                        type="file"
                      />
                    </label>
                    <button
                      className="service-primary-button"
                      disabled={busy === `ship-${selectedOrder.id}`}
                      onClick={() => shipOrder(selectedOrder)}
                      type="button"
                    >
                      Ship order
                    </button>
                  </div>
                </form>
              </aside>
            )}
          </div>
        )}

        

        {activeTab === "manufacturing" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: !isAdmin ? "20px 24px" : "0", background: !isAdmin ? "#f8fafc" : "transparent", minHeight: !isAdmin ? "calc(100vh - 64px)" : "auto", width: "100%", boxSizing: "border-box" }}>
            {!isAdmin ? (
              <>
                {/* Top Metrics Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                      Active Orders
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                      {number(activeLocalOrders)}
                    </strong>
                    <small style={{ fontSize: 12, fontWeight: 600, color: "#16a34a" }}>
                      {number(readyLocalOrders)} ready for delivery
                    </small>
                  </div>

                  <div style={{ background: "#ffffff", border: readyLocalOrders > 0 ? "1px solid #bbf7d0" : "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: readyLocalOrders > 0 ? "#15803d" : "#64748b" }}>
                      Ready For Delivery
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: readyLocalOrders > 0 ? "#16a34a" : "#0f172a", lineHeight: 1 }}>
                      {number(readyLocalOrders)}
                    </strong>
                    <small style={{ fontSize: 12, fontWeight: 600, color: readyLocalOrders > 0 ? "#15803d" : "#64748b" }}>
                      Finished & packaged
                    </small>
                  </div>

                  <div style={{ background: "#ffffff", border: Number(localOrderBalanceDue || 0) > 0 ? "1px solid #fecaca" : "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: Number(localOrderBalanceDue || 0) > 0 ? "#991b1b" : "#64748b" }}>
                      Total Balance Due
                    </span>
                    <strong style={{ fontSize: 24, fontWeight: 800, color: Number(localOrderBalanceDue || 0) > 0 ? "#dc2626" : "#0f172a", lineHeight: 1 }}>
                      {money(localOrderBalanceDue, currency)}
                    </strong>
                    <small style={{ fontSize: 12, fontWeight: 600, color: Number(localOrderBalanceDue || 0) > 0 ? "#b91c1c" : "#64748b" }}>
                      {number(pendingManufacturingPaymentRows.length)} waiting company check
                    </small>
                  </div>
                </div>

                {/* Tabs Filter and Action Bar */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {[
                      { key: "open", label: "Open Orders", count: visibleManufacturing.filter(o => ["Confirmed", "In production", "Quality check", "Ready"].includes(o.status)).length },
                      { key: "completed", label: "Completed", count: visibleManufacturing.filter(o => o.status === "Completed").length },
                      { key: "all", label: "All Orders", count: visibleManufacturing.filter(o => ["Confirmed", "In production", "Quality check", "Ready", "Completed"].includes(o.status)).length },
                    ].map((tab) => {
                      const isActive = portalLocalStatusFilter === tab.key;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setPortalLocalStatusFilter(tab.key)}
                          type="button"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "7px 14px",
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            border: isActive ? "1px solid #0f766e" : "1px solid #e2e8f0",
                            background: isActive ? "#0f766e" : "#f8fafc",
                            color: isActive ? "#ffffff" : "#475569",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <span>{tab.label}</span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: "1px 6px",
                              borderRadius: 10,
                              background: isActive ? "rgba(255,255,255,0.25)" : "#e2e8f0",
                              color: isActive ? "#ffffff" : "#475569",
                            }}
                          >
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => openManufacturingModal()}
                    type="button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "#0f766e",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: 650,
                      cursor: "pointer",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    }}
                  >
                    + Request New Quote
                  </button>
                </div>

                {/* Orders List with Collapsible Cards */}
                {visibleManufacturing.filter((ord) => {
                  if (portalLocalStatusFilter === "open") return ["Confirmed", "In production", "Quality check", "Ready"].includes(ord.status);
                  if (portalLocalStatusFilter === "completed") return ord.status === "Completed";
                  return ["Confirmed", "In production", "Quality check", "Ready", "Completed"].includes(ord.status);
                }).length === 0 ? (
                  <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
                    <p style={{ margin: "0 0 6px 0", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>No active manufacturing orders found</p>
                    <span style={{ fontSize: 13 }}>Check the Quotations tab to view submitted requests or click "+ Request New Quote" above.</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {visibleManufacturing
                      .filter((ord) => {
                        if (portalLocalStatusFilter === "open") return ["Confirmed", "In production", "Quality check", "Ready"].includes(ord.status);
                        if (portalLocalStatusFilter === "completed") return ord.status === "Completed";
                        return ["Confirmed", "In production", "Quality check", "Ready", "Completed"].includes(ord.status);
                      })
                      .map((order) => {
                        const isExpanded = expandedPortalOrderIds.includes(order.id);
                        const progress = manufacturingProgressPercent(order);
                        const expectedDate = order.estimated_ready_at || order.requested_ready_at;
                        const imageUrl = order.image_url || order.product_image_url;
                        const pendingPayment = pendingManufacturingPayments(order)[0];

                        return (
                          <div
                            key={order.id}
                            style={{
                              background: "#ffffff",
                              border: isExpanded ? "1px solid #0f766e" : "1px solid #e2e8f0",
                              borderRadius: 8,
                              overflow: "hidden",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {/* Card Header Summary Row */}
                            <div
                              onClick={() => toggleOrderExpansion(order.id)}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(220px, 1.4fr) minmax(180px, 1.3fr) 110px 100px 140px 125px",
                                alignItems: "center",
                                columnGap: 18,
                                rowGap: 12,
                                padding: "16px 20px",
                                cursor: "pointer",
                                background: isExpanded ? "#f8fafc" : "#ffffff",
                                borderBottom: isExpanded ? "1px solid #e2e8f0" : "none",
                              }}
                            >
                              {/* 1. Product Info */}
                              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                <div
                                  style={{
                                    width: 42,
                                    height: 42,
                                    borderRadius: 6,
                                    background: "#f1f5f9",
                                    border: "1px solid #e2e8f0",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                    flexShrink: 0,
                                  }}
                                >
                                  {imageUrl ? (
                                    <img alt={order.product_name} src={getStaticUrl(imageUrl)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  ) : (
                                    <span style={{ fontSize: 16, fontWeight: 800, color: "#64748b" }}>
                                      {String(order.product_name || order.request_no).charAt(0)}
                                    </span>
                                  )}
                                </div>
                                <div style={{ minWidth: 0, overflow: "hidden" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                    <strong style={{ color: "#0f766e", fontSize: 13.5 }}>{order.request_no}</strong>
                                    {order.client_reference && (
                                      <span style={{ fontSize: 11, color: "#64748b", textOverflow: "ellipsis", overflow: "hidden" }}>Ref: {order.client_reference}</span>
                                    )}
                                  </div>
                                  <h3 style={{ margin: "1px 0 0 0", fontSize: 14.5, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                                    {order.product_name}
                                  </h3>
                                  <span style={{ fontSize: 11, color: "#64748b", display: "block", whiteSpace: "nowrap" }}>
                                    Qty: <b>{number(order.quantity)} units</b> Ã‚Â· Ordered: {shortDate(order.created_at)}
                                  </span>
                                </div>
                              </div>

                              {/* 2. In-Between Progress Bar */}
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", paddingRight: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: order.status === "Completed" ? "#475569" : "#0f766e" }}>
                                    {order.status === "Completed" ? "Completed" : "Production Progress"}
                                  </span>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: order.status === "Completed" ? "#334155" : "#16a34a" }}>
                                    {order.status === "Completed" ? "100%" : `${progress}%`}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    height: 6,
                                    width: "100%",
                                    background: "#e2e8f0",
                                    borderRadius: 4,
                                    overflow: "hidden",
                                    position: "relative",
                                  }}
                                >
                                  <div
                                    style={{
                                      height: "100%",
                                      width: order.status === "Completed" ? "100%" : `${Math.max(progress, 6)}%`,
                                      background: order.status === "Completed" ? "#64748b" : "linear-gradient(90deg, #10b981 0%, #059669 100%)",
                                      borderRadius: 4,
                                      transition: "width 0.3s ease",
                                    }}
                                  />
                                </div>
                              </div>

                              {/* 3. Quote Total */}
                              <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Quote Total</span>
                                <div style={{ fontSize: 13.5, fontWeight: 750, color: "#0f172a", whiteSpace: "nowrap" }}>
                                  {Number(order.quoted_total || 0) > 0 ? money(order.quoted_total, order.currency) : "Awaiting Quote"}
                                </div>
                              </div>

                              {/* 4. Balance Due */}
                              <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Balance Due</span>
                                <div style={{ fontSize: 13.5, fontWeight: 750, color: Number(order.balance_due || 0) > 0 ? "#dc2626" : "#16a34a", whiteSpace: "nowrap" }}>
                                  {money(order.balance_due, order.currency)}
                                </div>
                              </div>

                              {/* 5. Status Badge */}
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                <Status value={order.status} />
                              </div>

                              {/* 6. Expand Button */}
                              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    color: "#0f766e",
                                    padding: "5px 11px",
                                    borderRadius: 6,
                                    background: "#f0fdfa",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {isExpanded ? "Collapse Ã¢â€“Â²" : "View Details Ã¢â€“Â¼"}
                                </span>
                              </div>
                            </div>

                            {/* Collapsible Details Body */}
                            {isExpanded && (
                              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18, background: "#ffffff" }}>
                                {/* Timeline Roadmap Box */}
                                <div style={{ background: "#f8fafc", padding: "18px 22px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: order.status === "Completed" ? "#64748b" : "#10b981" }} />
                                      <span style={{ fontSize: 12, fontWeight: 750, color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                        Production Timeline
                                      </span>
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 750, color: order.status === "Completed" ? "#475569" : "#0f766e" }}>
                                      {order.status === "Completed" ? "Completed" : `${progress}% Completed`}
                                    </span>
                                  </div>
                                  <LocalOrderWorkflowTimeline order={order} />
                                </div>

                                {/* Order Specs Grid */}
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 750, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                                    Product Specifications
                                  </div>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                                    <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Steel & Hardness</span>
                                      <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                        {order.steel_type || "Standard"} {order.hardness ? `(${order.hardness})` : ""}
                                      </strong>
                                    </div>
                                    <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Dimensions</span>
                                      <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                        {order.blade_length_in ? `${order.blade_length_in}" Blade` : "Standard Length"} {order.blade_thickness_mm ? `Ã‚Â· ${order.blade_thickness_mm}mm` : ""}
                                      </strong>
                                    </div>
                                    <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Handle & Sheath</span>
                                      <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                        {order.handle_material || "Standard"} {order.sheath_type ? `Ã‚Â· ${order.sheath_type}` : ""}
                                      </strong>
                                    </div>
                                    <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Target Ready Date</span>
                                      <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                        {shortDate(expectedDate)}
                                      </strong>
                                    </div>
                                  </div>
                                </div>

                                {/* Financial Summary Pill Cards & Actions Bar */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 11, color: "#64748b" }}>Unit Price:</span>
                                      <strong style={{ fontSize: 12.5, color: "#0f172a" }}>{Number(order.quoted_unit_price || 0) > 0 ? money(order.quoted_unit_price, order.currency) : "Ã¢â‚¬â€"}</strong>
                                    </div>
                                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 11, color: "#64748b" }}>Tooling / Mold:</span>
                                      <strong style={{ fontSize: 12.5, color: "#0f172a" }}>{money(order.tooling_cost, order.currency)}</strong>
                                    </div>
                                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 11, color: "#166534" }}>Deposit Required:</span>
                                      <strong style={{ fontSize: 12.5, color: "#15803d" }}>{money(order.deposit_required, order.currency)}</strong>
                                    </div>
                                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: 11, color: "#64748b" }}>Total Paid:</span>
                                      <strong style={{ fontSize: 12.5, color: "#16a34a" }}>{money(order.paid_total, order.currency)}</strong>
                                    </div>
                                  </div>

                                  {/* Actions */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    {canRequestFinalManufacturingBalance(order) && (
                                      <button
                                        disabled={busy === `manufacturing-balance-${order.id}`}
                                        onClick={() => requestManufacturingBalance(order)}
                                        type="button"
                                        style={{
                                          background: "#0f766e",
                                          color: "#ffffff",
                                          border: "none",
                                          borderRadius: 6,
                                          padding: "8px 16px",
                                          fontSize: 12.5,
                                          fontWeight: 700,
                                          cursor: "pointer",
                                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                        }}
                                      >
                                        Pay Remaining Balance
                                      </button>
                                    )}

                                    {pendingPayment && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        {pendingPayment.proof_url && (
                                          <a
                                            href={getStaticUrl(pendingPayment.proof_url)}
                                            rel="noreferrer"
                                            target="_blank"
                                            style={{
                                              fontSize: 12,
                                              padding: "6px 12px",
                                              color: "#0f766e",
                                              fontWeight: 600,
                                              background: "#f0fdfa",
                                              border: "1px solid #ccfbf1",
                                              borderRadius: 6,
                                              textDecoration: "none",
                                            }}
                                          >
                                            View Receipt &#8599;
                                          </a>
                                        )}
                                        <label
                                          style={{
                                            fontSize: 12,
                                            padding: "6px 12px",
                                            color: "#475569",
                                            fontWeight: 600,
                                            background: "#ffffff",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: 6,
                                            cursor: "pointer",
                                          }}
                                        >
                                          {pendingPayment.proof_url ? "Replace" : "Upload Receipt"}
                                          <input
                                            accept={PAYMENT_PROOF_ACCEPT}
                                            disabled={busy === `manufacturing-proof-${pendingPayment.id}`}
                                            onChange={(event) => uploadManufacturingPaymentProof(order, pendingPayment, event.target.files?.[0])}
                                            style={{ display: "none" }}
                                            type="file"
                                          />
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </>
            ) : (
              <div className="service-table-wrap">
                {visibleManufacturing.length === 0 ? (
                  <EmptyState title="No local orders" detail="Request a quote to start." />
                ) : (
                  <table className="service-table">
                    <thead>
                      <tr>
                        <th>Quote</th>
                        <th>Service taker</th>
                        <th>Product</th>
                        <th>Specs</th>
                        <th>Qty</th>
                        <th>Quote</th>
                        <th>Deposit</th>
                        <th>Balance</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleManufacturing.map((order) => (
                        <tr
                          className={selectedManufacturingId === order.id ? "is-selected" : ""}
                          key={order.id}
                        >
                          <td>
                            <strong>{order.request_no}</strong>
                            <span>{order.client_reference || shortDate(order.created_at)}</span>
                          </td>
                          <td>{order.company_name}</td>
                          <td>
                            <div className="service-product-table-cell service-manufacturing-product-cell">
                              <div>
                                {order.image_url ? (
                                  <img alt={order.product_name} src={getStaticUrl(order.image_url)} />
                                ) : (
                                  <span>{String(order.product_name || order.request_no).charAt(0)}</span>
                                )}
                              </div>
                              <span>
                                <strong>{order.product_name}</strong>
                                <small>{shortDate(order.estimated_ready_at || order.requested_ready_at)}</small>
                                {order.status !== "Quote requested" && order.status !== "Rejected" && order.status !== "Cancelled" && (
                                  <ManufacturingRoadmap order={order} />
                                )}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span>{manufacturingSpec(order) || "Custom knife build"}</span>
                          </td>
                          <td>{number(order.quantity)}</td>
                          <td>{money(order.quoted_total, order.currency)}</td>
                          <td>{money(order.deposit_required, order.currency)}</td>
                          <td>
                            <strong>{money(order.balance_due, order.currency)}</strong>
                            <span>Paid {money(order.paid_total, order.currency)}</span>
                          </td>
                          <td><Status value={order.status} /></td>
                          <td>
                            <button
                              className="service-row-button"
                              onClick={() => openManufacturingDetail(order)}
                              type="button"
                            >
                              {["Rejected", "Cancelled"].includes(order.status) ? "View Details" : "Process"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "quotations" && !isAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 24px", background: "#f8fafc", minHeight: "calc(100vh - 64px)", width: "100%", boxSizing: "border-box" }}>
            {/* Top Metrics Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                  Awaiting Factory Quote
                </span>
                <strong style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
                  {number(visibleManufacturing.filter(o => o.status === "Quote requested").length)}
                </strong>
                <small style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>
                  Submitted designs under review
                </small>
              </div>

              <div style={{ background: "#ffffff", border: visibleManufacturing.filter(o => ["Quoted", "Deposit pending"].includes(o.status)).length > 0 ? "1px solid #fed7aa" : "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: visibleManufacturing.filter(o => ["Quoted", "Deposit pending"].includes(o.status)).length > 0 ? "#9a3412" : "#64748b" }}>
                  Quoted / Action Needed
                </span>
                <strong style={{ fontSize: 24, fontWeight: 800, color: visibleManufacturing.filter(o => ["Quoted", "Deposit pending"].includes(o.status)).length > 0 ? "#d97706" : "#0f172a", lineHeight: 1 }}>
                  {number(visibleManufacturing.filter(o => ["Quoted", "Deposit pending"].includes(o.status)).length)}
                </strong>
                <small style={{ fontSize: 12, fontWeight: 600, color: visibleManufacturing.filter(o => ["Quoted", "Deposit pending"].includes(o.status)).length > 0 ? "#c2410c" : "#64748b" }}>
                  Quotes ready for your confirmation
                </small>
              </div>

              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                  Closed / Rejected
                </span>
                <strong style={{ fontSize: 24, fontWeight: 800, color: "#64748b", lineHeight: 1 }}>
                  {number(visibleManufacturing.filter(o => ["Rejected", "Cancelled"].includes(o.status)).length)}
                </strong>
                <small style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>
                  Declined or cancelled requests
                </small>
              </div>
            </div>

            {/* Action Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 750, color: "#0f172a" }}>
                  Custom Manufacturing Quotes
                </h3>
                <span style={{ fontSize: 12, fontWeight: 750, background: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: 12 }}>
                  {visibleManufacturing.filter(o => ["Quote requested", "Quoted", "Deposit pending", "Rejected", "Cancelled"].includes(o.status)).length}
                </span>
              </div>
              <button
                onClick={() => openManufacturingModal()}
                type="button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#0f766e",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 650,
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                + Request New Quote
              </button>
            </div>

            {/* Quotations List */}
            {visibleManufacturing.filter(o => ["Quote requested", "Quoted", "Deposit pending", "Rejected", "Cancelled"].includes(o.status)).length === 0 ? (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
                <p style={{ margin: "0 0 6px 0", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>No quotations found</p>
                <span style={{ fontSize: 13 }}>Click "+ Request New Quote" above to submit design requirements and get factory pricing.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {visibleManufacturing
                  .filter(o => ["Quote requested", "Quoted", "Deposit pending", "Rejected", "Cancelled"].includes(o.status))
                  .map((order) => {
                    const isExpanded = expandedPortalOrderIds.includes(order.id);
                    const expectedDate = order.estimated_ready_at || order.requested_ready_at;
                    const imageUrl = order.image_url || order.product_image_url;
                    const pendingPayment = pendingManufacturingPayments(order)[0];

                    return (
                      <div
                        key={order.id}
                        style={{
                          background: "#ffffff",
                          border: isExpanded ? "1px solid #0f766e" : "1px solid #e2e8f0",
                          borderRadius: 8,
                          overflow: "hidden",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {/* Summary Row */}
                        <div
                          onClick={() => toggleOrderExpansion(order.id)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(240px, 1.6fr) minmax(160px, 1.2fr) 120px 120px 140px 125px",
                            alignItems: "center",
                            columnGap: 18,
                            rowGap: 12,
                            padding: "16px 20px",
                            cursor: "pointer",
                            background: isExpanded ? "#f8fafc" : "#ffffff",
                            borderBottom: isExpanded ? "1px solid #e2e8f0" : "none",
                          }}
                        >
                          {/* 1. Product Info */}
                          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: 6,
                                background: "#f1f5f9",
                                border: "1px solid #e2e8f0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                                flexShrink: 0,
                              }}
                            >
                              {imageUrl ? (
                                <img alt={order.product_name} src={getStaticUrl(imageUrl)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <span style={{ fontSize: 16, fontWeight: 800, color: "#64748b" }}>
                                  {String(order.product_name || order.request_no).charAt(0)}
                                </span>
                              )}
                            </div>
                            <div style={{ minWidth: 0, overflow: "hidden" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                                <strong style={{ color: "#0f766e", fontSize: 13.5 }}>{order.request_no}</strong>
                                {order.client_reference && (
                                  <span style={{ fontSize: 11, color: "#64748b", textOverflow: "ellipsis", overflow: "hidden" }}>Ref: {order.client_reference}</span>
                                )}
                              </div>
                              <h3 style={{ margin: "1px 0 0 0", fontSize: 14.5, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                                {order.product_name}
                              </h3>
                              <span style={{ fontSize: 11, color: "#64748b", display: "block", whiteSpace: "nowrap" }}>
                                Qty: <b>{number(order.quantity)} units</b> Ã‚Â· Requested: {shortDate(order.created_at)}
                              </span>
                            </div>
                          </div>

                          {/* 2. Specs snippet */}
                          <div style={{ overflow: "hidden" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Spec</span>
                            <div style={{ fontSize: 12, color: "#334155", fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                              {manufacturingSpec(order) || "Custom specification"}
                            </div>
                          </div>

                          {/* 3. Quote Total */}
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Quoted Total</span>
                            <div style={{ fontSize: 13.5, fontWeight: 750, color: "#0f172a", whiteSpace: "nowrap" }}>
                              {Number(order.quoted_total || 0) > 0 ? money(order.quoted_total, order.currency) : "Awaiting Quote"}
                            </div>
                          </div>

                          {/* 4. Deposit Required */}
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Deposit Req</span>
                            <div style={{ fontSize: 13.5, fontWeight: 750, color: "#15803d", whiteSpace: "nowrap" }}>
                              {Number(order.deposit_required || 0) > 0 ? money(order.deposit_required, order.currency) : "Ã¢â‚¬â€"}
                            </div>
                          </div>

                          {/* 5. Status Badge */}
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <Status value={order.status} />
                          </div>

                          {/* 6. Expand Button */}
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11.5,
                                fontWeight: 700,
                                color: "#0f766e",
                                padding: "5px 11px",
                                borderRadius: 6,
                                background: "#f0fdfa",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isExpanded ? "Collapse Ã¢â€“Â²" : "View Details Ã¢â€“Â¼"}
                            </span>
                          </div>
                        </div>

                        {/* Collapsible Details Body */}
                        {isExpanded && (
                          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18, background: "#ffffff" }}>
                            {/* Product Specifications */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 750, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                                Submitted Specifications
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                                <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Steel & Hardness</span>
                                  <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                    {order.steel_type || "Standard"} {order.hardness ? `(${order.hardness})` : ""}
                                  </strong>
                                </div>
                                <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Dimensions</span>
                                  <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                    {order.blade_length_in ? `${order.blade_length_in}" Blade` : "Standard Length"} {order.blade_thickness_mm ? `Ã‚Â· ${order.blade_thickness_mm}mm` : ""}
                                  </strong>
                                </div>
                                <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Handle & Sheath</span>
                                  <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                    {order.handle_material || "Standard"} {order.sheath_type ? `Ã‚Â· ${order.sheath_type}` : ""}
                                  </strong>
                                </div>
                                <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block" }}>Target Ready Date</span>
                                  <strong style={{ fontSize: 13, color: "#0f172a", marginTop: 2, display: "block" }}>
                                    {shortDate(expectedDate)}
                                  </strong>
                                </div>
                              </div>
                            </div>

                            {/* Financial Summary & Direct Actions */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 11, color: "#64748b" }}>Unit Price:</span>
                                  <strong style={{ fontSize: 12.5, color: "#0f172a" }}>{Number(order.quoted_unit_price || 0) > 0 ? money(order.quoted_unit_price, order.currency) : "Awaiting Quote"}</strong>
                                </div>
                                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 11, color: "#64748b" }}>Tooling / Mold:</span>
                                  <strong style={{ fontSize: 12.5, color: "#0f172a" }}>{money(order.tooling_cost, order.currency)}</strong>
                                </div>
                                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 11, color: "#166534" }}>Deposit Required:</span>
                                  <strong style={{ fontSize: 12.5, color: "#15803d" }}>{money(order.deposit_required, order.currency)}</strong>
                                </div>
                              </div>

                              {/* Actions */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                {canProceedLocalOrder(order) && (
                                  <button
                                    disabled={busy === `manufacturing-deposit-${order.id}`}
                                    onClick={() => openManufacturingDeposit(order)}
                                    type="button"
                                    style={{
                                      background: "#0f766e",
                                      color: "#ffffff",
                                      border: "none",
                                      borderRadius: 6,
                                      padding: "8px 16px",
                                      fontSize: 12.5,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                    }}
                                  >
                                    Ã¢Å“â€œ Proceed & Pay Deposit
                                  </button>
                                )}

                                {canRejectLocalOrder(order) && (
                                  <button
                                    disabled={busy === `manufacturing-reject-${order.id}`}
                                    onClick={() => rejectManufacturingQuote(order)}
                                    type="button"
                                    style={{
                                      background: "#fff1f2",
                                      color: "#e11d48",
                                      border: "1px solid #fecdd3",
                                      borderRadius: 6,
                                      padding: "8px 14px",
                                      fontSize: 12.5,
                                      fontWeight: 650,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {order.status === "Quote requested" ? "Cancel Request" : "Reject Quote"}
                                  </button>
                                )}

                                {pendingPayment && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    {pendingPayment.proof_url && (
                                      <a
                                        href={getStaticUrl(pendingPayment.proof_url)}
                                        rel="noreferrer"
                                        target="_blank"
                                        style={{
                                          fontSize: 12,
                                          padding: "6px 12px",
                                          color: "#0f766e",
                                          fontWeight: 600,
                                          background: "#f0fdfa",
                                          border: "1px solid #ccfbf1",
                                          borderRadius: 6,
                                          textDecoration: "none",
                                        }}
                                      >
                                        View Receipt &#8599;
                                      </a>
                                    )}
                                    <label
                                      style={{
                                        fontSize: 12,
                                        padding: "6px 12px",
                                        color: "#475569",
                                        fontWeight: 600,
                                        background: "#ffffff",
                                        border: "1px solid #cbd5e1",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                      }}
                                    >
                                      {pendingPayment.proof_url ? "Replace" : "Upload Receipt"}
                                      <input
                                        accept={PAYMENT_PROOF_ACCEPT}
                                        disabled={busy === `manufacturing-proof-${pendingPayment.id}`}
                                        onChange={(event) => uploadManufacturingPaymentProof(order, pendingPayment, event.target.files?.[0])}
                                        style={{ display: "none" }}
                                        type="file"
                                      />
                                    </label>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
        
        {activeTab === "billing" && !isAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 24px", background: "#f8fafc", minHeight: "calc(100vh - 64px)", width: "100%", boxSizing: "border-box" }}>
            {/* Top Stat Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                  Total Confirmed Paid
                </span>
                <strong style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", lineHeight: 1 }}>
                  {money(confirmedPaymentHistoryTotal, currency)}
                </strong>
                <small style={{ fontSize: 12, fontWeight: 600, color: "#059669" }}>
                  {allManufacturingPaymentHistoryRows.filter(r => r.payment.status === "Confirmed").length} confirmed transactions
                </small>
              </div>

              <div style={{ background: "#ffffff", border: pendingManufacturingPaymentRows.length > 0 ? "1px solid #fed7aa" : "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: pendingManufacturingPaymentRows.length > 0 ? "#9a3412" : "#64748b" }}>
                  Waiting Confirmation
                </span>
                <strong style={{ fontSize: 24, fontWeight: 800, color: pendingManufacturingPaymentRows.length > 0 ? "#ea580c" : "#0f172a", lineHeight: 1 }}>
                  {money(pendingManufacturingPaymentTotal, currency)}
                </strong>
                <small style={{ fontSize: 12, fontWeight: 600, color: pendingManufacturingPaymentRows.length > 0 ? "#c2410c" : "#64748b" }}>
                  {pendingManufacturingPaymentRows.length} payment receipts waiting
                </small>
              </div>

              <div style={{ background: "#ffffff", border: Number(data.stats?.manufacturing_balance_due || 0) > 0 ? "1px solid #fecaca" : "1px solid #e2e8f0", borderRadius: 8, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: Number(data.stats?.manufacturing_balance_due || 0) > 0 ? "#991b1b" : "#64748b" }}>
                  Remaining Balance Due
                </span>
                <strong style={{ fontSize: 24, fontWeight: 800, color: Number(data.stats?.manufacturing_balance_due || 0) > 0 ? "#dc2626" : "#0f172a", lineHeight: 1 }}>
                  {money(data.stats?.manufacturing_balance_due, currency)}
                </strong>
                <small style={{ fontSize: 12, fontWeight: 600, color: Number(data.stats?.manufacturing_balance_due || 0) > 0 ? "#b91c1c" : "#64748b" }}>
                  Outstanding orders balance
                </small>
              </div>
            </div>

            {/* Action Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                  Payment Records & Receipts
                </h3>
                <span style={{ fontSize: 12, fontWeight: 700, background: "#f1f5f9", color: "#475569", padding: "2px 10px", borderRadius: 12 }}>
                  {allManufacturingPaymentHistoryRows.length} records
                </span>
              </div>
              <button
                
                onClick={() => openManufacturingPaymentProof()}
                type="button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#0f766e",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 650,
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                + Record Payment Screenshot
              </button>
            </div>

            {/* Table Container */}
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <div style={{ overflowX: "auto" }}>
                {allManufacturingPaymentHistoryRows.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
                    <p style={{ margin: "0 0 6px 0", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>No payment records found</p>
                    <span style={{ fontSize: 13 }}>Submitted payment screenshots and confirmed transactions will be displayed here.</span>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "12px 18px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>Date & Time</th>
                        <th style={{ padding: "12px 18px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>Description / Type</th>
                        <th style={{ padding: "12px 18px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>Amount Paid</th>
                        <th style={{ padding: "12px 18px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>Method & Details</th>
                        <th style={{ padding: "12px 18px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>
                        <th style={{ padding: "12px 18px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "right" }}>Proof Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allManufacturingPaymentHistoryRows.map(({ order, payment }) => (
                        <tr key={payment.id} style={{ borderBottom: "1px solid #f1f5f9", transition: "background 0.15s" }}>
                          <td style={{ padding: "14px 18px", whiteSpace: "nowrap" }}>
                            <strong style={{ fontSize: 13, color: "#0f172a", display: "block" }}>{formatDateTime(payment.paid_at || payment.created_at)}</strong>
                          </td>
                          <td style={{ padding: "14px 18px" }}>
                            <strong style={{ fontSize: 13.5, color: "#0f172a", display: "block" }}>{payment.payment_type || "Payment"}</strong>
                            {payment.note && (
                              <span style={{ fontSize: 12, color: "#64748b", display: "block", marginTop: 2 }}>{payment.note}</span>
                            )}
                          </td>
                          <td style={{ padding: "14px 18px", whiteSpace: "nowrap" }}>
                            <strong style={{ color: payment.status === "Confirmed" ? "#16a34a" : "#d97706", fontSize: 15, display: "block" }}>
                              {money(payment.amount, currency)}
                            </strong>
                          </td>
                          <td style={{ padding: "14px 18px" }}>
                            <span style={{ fontSize: 12.5, color: "#334155", fontWeight: 600, display: "block" }}>
                              {payment.method || "Bank Transfer"}
                            </span>
                            {payment.reference && (
                              <code style={{ fontSize: 11, background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, color: "#475569", display: "inline-block", marginTop: 3 }}>
                                Ref: {payment.reference}
                              </code>
                            )}
                          </td>
                          <td style={{ padding: "14px 18px", whiteSpace: "nowrap" }}>
                            <Status value={payment.status || "Confirmed"} />
                          </td>
                          <td style={{ padding: "14px 18px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                              {payment.proof_url ? (
                                <a
                                  href={getStaticUrl(payment.proof_url)}
                                  rel="noreferrer"
                                  target="_blank"
                                  style={{
                                    fontSize: 12,
                                    padding: "5px 11px",
                                    color: "#0f766e",
                                    fontWeight: 700,
                                    background: "#f0fdfa",
                                    border: "1px solid #ccfbf1",
                                    borderRadius: 5,
                                    textDecoration: "none",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  View Receipt &#8599;
                                </a>
                              ) : (
                                <span style={{ fontSize: 11.5, color: "#94a3b8" }}>No receipt</span>
                              )}
                              {payment.status === "Pending confirmation" && (
                                <label
                                  style={{
                                    fontSize: 12,
                                    padding: "5px 11px",
                                    color: "#475569",
                                    fontWeight: 600,
                                    background: "#ffffff",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: 5,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
                                >
                                  {payment.proof_url ? "Replace" : "Upload"}
                                  <input
                                    accept={PAYMENT_PROOF_ACCEPT}
                                    disabled={busy === `manufacturing-proof-${payment.id}`}
                                    onChange={(event) => uploadManufacturingPaymentProof(order, payment, event.target.files?.[0])}
                                    style={{ display: "none" }}
                                    type="file"
                                  />
                                </label>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

            {modal === "manufacturing-process" && selectedManufacturing && isAdmin && (
        <Modal
          actions={
            <>
              <button
                className="service-secondary-button"
                onClick={() => {
                  setModal("");
                  setSelectedManufacturingId(null);
                }}
                type="button"
              >
                Close
              </button>
              {!["Rejected", "Cancelled"].includes(selectedManufacturing.status) && (
                <button
                  className="service-primary-button"
                  disabled={busy === "save-manufacturing"}
                  form="manufacturing-admin-edit-form"
                  type="submit"
                >
                  Save quote & update
                </button>
              )}
            </>
          }
          className="service-local-order-process-modal"
          onClose={() => {
            setModal("");
            setSelectedManufacturingId(null);
          }}
          subtitle={`Company manufacturing console for ${selectedManufacturing.company_name}`}
          title={`${selectedManufacturing.request_no} / ${selectedManufacturing.product_name}`}
        >
          <div className="service-process-modal-content">
            {/* Notice for Rejected / Cancelled Orders */}
            {["Rejected", "Cancelled"].includes(selectedManufacturing.status) && (
              <div style={{
                padding: "12px 16px",
                borderRadius: 8,
                background: selectedManufacturing.status === "Rejected" ? "#fef2f2" : "#f1f5f9",
                border: selectedManufacturing.status === "Rejected" ? "1px solid #fecaca" : "1px solid #cbd5e1",
                color: selectedManufacturing.status === "Rejected" ? "#991b1b" : "#475569",
                fontSize: 13,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 10
              }}>
                <span style={{ fontSize: 18 }}>&#9888;</span>
                <div>
                  <strong style={{ display: "block" }}>This order is {selectedManufacturing.status.toLowerCase()}.</strong>
                  <span style={{ fontSize: 11.5, fontWeight: 500 }}>
                    {selectedManufacturing.status === "Rejected"
                      ? "The quote was rejected by the customer or factory. Processing and modifications are closed."
                      : "This order was cancelled. No further manufacturing actions can be performed."}
                  </span>
                </div>
              </div>
            )}

            {/* Top Financial & Service Taker Balance Banner */}
            <div className="service-process-client-banner">
              <div className="service-process-client-info">
                <span className="service-process-badge">Service Taker</span>
                <h3>{selectedManufacturing.company_name}</h3>
                <p>
                  Requested {shortDate(selectedManufacturing.created_at)} / {selectedManufacturing.client_reference ? `Ref: ${selectedManufacturing.client_reference}` : 'Custom Order'}
                </p>
              </div>

              {/* Highlighted Total Overall Pending Balance for this service taker */}
              <div className="service-process-balance-highlight">
                <span>Total Client Pending Balance</span>
                <strong>
                  {money(
                    getServiceTakerTotalPendingBalance(selectedManufacturing.service_taker_id),
                    selectedManufacturing.currency
                  )}
                </strong>
                <small>Accepted local orders & fulfillment fees</small>
              </div>
            </div>

            {/* Automation Workflow Timeline */}
            <div className="service-process-workflow-section">
              <div className="service-process-section-header">
                <div>
                  <span>Automation Workflow</span>
                  <h4>Production Progress Timeline</h4>
                </div>
                <div className="service-workflow-quick-actions">
                  {selectedManufacturing.status === "Quote requested" && (
                    <button
                      type="button"
                      className="service-workflow-action-btn is-advance"
                      disabled={busy.startsWith("stage-")}
                      onClick={() => advanceManufacturingStage(selectedManufacturing, "Quoted")}
                    >
                      Mark Quoted &#8594;
                    </button>
                  )}
                  {["Quoted", "Deposit pending"].includes(selectedManufacturing.status) && (
                    <button
                      type="button"
                      className="service-workflow-action-btn is-advance"
                      disabled={busy.startsWith("stage-")}
                      onClick={() => advanceManufacturingStage(selectedManufacturing, "Confirmed")}
                    >
                      Confirm Order &#8594;
                    </button>
                  )}
                  {selectedManufacturing.status === "Confirmed" && (
                    <button
                      type="button"
                      className="service-workflow-action-btn is-advance"
                      disabled={busy.startsWith("stage-")}
                      onClick={() => advanceManufacturingStage(selectedManufacturing, "In production")}
                    >
                      Start Production &#8594;
                    </button>
                  )}
                  {selectedManufacturing.status === "In production" && (
                    <button
                      type="button"
                      className="service-workflow-action-btn is-advance"
                      disabled={busy.startsWith("stage-")}
                      onClick={() => advanceManufacturingStage(selectedManufacturing, "Quality check")}
                    >
                      Send to QC &#8594;
                    </button>
                  )}
                  {selectedManufacturing.status === "Quality check" && (
                    <button
                      type="button"
                      className="service-workflow-action-btn is-advance"
                      disabled={busy.startsWith("stage-")}
                      onClick={() => advanceManufacturingStage(selectedManufacturing, "Ready")}
                    >
                      Mark Ready &#8594;
                    </button>
                  )}
                  {selectedManufacturing.status === "Ready" && (
                    <button
                      type="button"
                      className="service-workflow-action-btn is-complete"
                      disabled={busy.startsWith("stage-")}
                      onClick={() => advanceManufacturingStage(selectedManufacturing, "Completed")}
                    >
                      Complete Order &#10003;
                    </button>
                  )}
                </div>
              </div>

              <LocalOrderWorkflowTimeline
                order={selectedManufacturing}
                interactive={true}
                onSelectStage={(newStage) => advanceManufacturingStage(selectedManufacturing, newStage)}
              />
            </div>

            {/* Financial Status Summary Grid for this specific order */}
            <div className="service-process-stats-grid">
              <div className="service-process-stat-card">
                <span>Quoted Total</span>
                <strong>{money(selectedManufacturing.quoted_total, selectedManufacturing.currency)}</strong>
                <small>{number(selectedManufacturing.quantity)} units @ {money(selectedManufacturing.quoted_unit_price, selectedManufacturing.currency)}</small>
              </div>
              <div className="service-process-stat-card">
                <span>Deposit Required</span>
                <strong>{money(selectedManufacturing.deposit_required, selectedManufacturing.currency)}</strong>
                <small>{money(selectedManufacturing.deposit_balance_due, selectedManufacturing.currency)} deposit due</small>
              </div>
              <div className="service-process-stat-card">
                <span>Total Received</span>
                <strong className="is-success">{money(selectedManufacturing.paid_total, selectedManufacturing.currency)}</strong>
                <small>{(selectedManufacturing.payments || []).length} payment records</small>
              </div>
              <div className="service-process-stat-card is-highlight">
                <span>This Order Balance Due</span>
                <strong className={Number(selectedManufacturing.balance_due || 0) > 0 ? "is-due" : "is-settled"}>
                  {money(selectedManufacturing.balance_due, selectedManufacturing.currency)}
                </strong>
                <small>{Number(selectedManufacturing.balance_due || 0) > 0 ? "Pending payment" : "Fully Settled"}</small>
              </div>
            </div>

            {/* Product Picture & Specifications */}
            <div className="service-process-specs-container">
              <div className="service-process-spec-image-box">
                {selectedManufacturing.image_url ? (
                  <img
                    alt={selectedManufacturing.product_name}
                    src={getStaticUrl(selectedManufacturing.image_url)}
                  />
                ) : (
                  <div className="service-process-spec-no-image">
                    <span>{String(selectedManufacturing.product_name || selectedManufacturing.request_no).charAt(0)}</span>
                    <small>No photo uploaded</small>
                  </div>
                )}
                <label className="service-row-button is-file" style={{ marginTop: '8px', width: '100%', textAlign: 'center' }}>
                  {selectedManufacturing.image_url ? 'Replace Drawing' : 'Upload Drawing'}
                  <input
                    accept=".png,.jpg,.jpeg,.webp"
                    disabled={busy === 'upload-image'}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const formData = new FormData();
                      formData.append("image_file", file);
                      setBusy('upload-image');
                      try {
                        await api.post(`/service-takers/admin/local-orders/${selectedManufacturing.id}/image`, formData);
                        showSuccess("Product drawing updated.");
                        await load({ quiet: true });
                      } catch (err) {
                        setError(errorMessage(err, "Failed to upload drawing."));
                      } finally {
                        setBusy('');
                      }
                    }}
                    type="file"
                  />
                </label>
              </div>

              <div className="service-process-spec-details">
                <h4>Product Specifications</h4>
                <div className="service-spec-chips-grid">
                  <div>
                    <span>Quantity</span>
                    <strong>{number(selectedManufacturing.quantity)} Units</strong>
                  </div>
                  <div>
                    <span>Steel Type</span>
                    <strong>{selectedManufacturing.steel_type || 'N/A'}</strong>
                  </div>
                  <div>
                    <span>Tang</span>
                    <strong>{selectedManufacturing.tang_type || 'N/A'}</strong>
                  </div>
                  <div>
                    <span>Blade Size</span>
                    <strong>
                      {selectedManufacturing.blade_length_in ? `${selectedManufacturing.blade_length_in} in` : 'N/A'} / {selectedManufacturing.blade_thickness_mm ? `${selectedManufacturing.blade_thickness_mm} mm` : ''}
                    </strong>
                  </div>
                  <div>
                    <span>Overall Length</span>
                    <strong>{selectedManufacturing.overall_length_in ? `${selectedManufacturing.overall_length_in} in` : 'N/A'}</strong>
                  </div>
                  <div>
                    <span>Handle Material</span>
                    <strong>{selectedManufacturing.handle_material || 'N/A'}</strong>
                  </div>
                  <div>
                    <span>Sheath</span>
                    <strong>{selectedManufacturing.sheath_type || 'N/A'}</strong>
                  </div>
                  <div>
                    <span>Finish / Hardness</span>
                    <strong>{selectedManufacturing.finish || 'N/A'} {selectedManufacturing.hardness ? `(${selectedManufacturing.hardness})` : ''}</strong>
                  </div>
                  <div>
                    <span>Edge / Packaging</span>
                    <strong>{selectedManufacturing.edge_type || 'Plain'} / {selectedManufacturing.packaging || 'Bulk'}</strong>
                  </div>
                </div>

                {selectedManufacturing.notes && (
                  <div className="service-process-notes-callout">
                    <span>Client Notes / Instructions:</span>
                    <p>{selectedManufacturing.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Pricing & Admin Management Form */}
            {!["Rejected", "Cancelled"].includes(selectedManufacturing.status) ? (
            <form
              id="manufacturing-admin-edit-form"
              className="service-process-form"
              onSubmit={saveManufacturing}
            >
              <h4>Pricing & Administration</h4>
              <div className="service-form-grid">
                <label>
                  Status
                  <select
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    value={manufacturingAdminForm.status || "Quote requested"}
                  >
                    {[
                      "Quote requested",
                      "Quoted",
                      "Rejected",
                      "Deposit pending",
                      "Confirmed",
                      "In production",
                      "Quality check",
                      "Ready",
                      "Completed",
                      "Cancelled",
                    ].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="service-company-spec-panel service-wide-field">
                  <div className="service-company-spec-title">
                    <span>Production details</span>
                    <strong>Set by company</strong>
                  </div>
                  <div className="service-company-spec-grid">
                    <label>
                      Reference
                      <input
                        onChange={(event) =>
                          setManufacturingAdminForm((current) => ({
                            ...current,
                            client_reference: event.target.value,
                          }))
                        }
                        value={manufacturingAdminForm.client_reference || ""}
                      />
                    </label>
                    <label>
                      Steel
                      <select
                        onChange={(event) =>
                          setManufacturingAdminForm((current) => ({
                            ...current,
                            steel_type: event.target.value,
                          }))
                        }
                        value={manufacturingAdminForm.steel_type || ""}
                      >
                        <option value="">Select steel</option>
                        {["D2", "1095", "440C", "Damascus", "AUS-8", "VG10", "Custom"].map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tang
                      <select
                        onChange={(event) =>
                          setManufacturingAdminForm((current) => ({
                            ...current,
                            tang_type: event.target.value,
                          }))
                        }
                        value={manufacturingAdminForm.tang_type || ""}
                      >
                        <option value="">Select tang</option>
                        {["Full tang", "Half tang", "Rat-tail tang", "Hidden tang"].map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    {[
                      ["blade_thickness_mm", "Blade thickness mm"],
                      ["blade_length_in", "Blade length in"],
                      ["overall_length_in", "Overall size in"],
                    ].map(([field, label]) => (
                      <label key={field}>
                        {label}
                        <input
                          min="0"
                          onChange={(event) =>
                            setManufacturingAdminForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          step="0.01"
                          type="number"
                          value={manufacturingAdminForm[field] ?? ""}
                        />
                      </label>
                    ))}
                    {[
                      ["handle_material", "Handle", "Walnut, pakkawood, micarta"],
                      ["sheath_type", "Sheath", "Leather sheath"],
                      ["finish", "Finish", "Satin, mirror, stonewash"],
                      ["hardness", "Hardness", "58-60 HRC"],
                      ["edge_type", "Edge", "Plain, serrated, convex"],
                      ["packaging", "Packaging", "Box, pouch, bulk"],
                    ].map(([field, label, placeholder]) => (
                      <label key={field}>
                        {label}
                        <input
                          onChange={(event) =>
                            setManufacturingAdminForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          placeholder={placeholder}
                          value={manufacturingAdminForm[field] || ""}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <label>
                  Unit Quote ({isRupeeCurrency(selectedManufacturing.currency) ? "Rs" : selectedManufacturing.currency || 'USD'})
                  <input
                  inputMode={isRupeeCurrency(selectedManufacturing.currency) ? "numeric" : "decimal"}
                    min="0"
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        quoted_unit_price: sanitizeAmountInput(event.target.value, selectedManufacturing.currency),
                      }))
                    }
                    step={isRupeeCurrency(selectedManufacturing.currency) ? "1" : "0.01"}
                    type="number"
                    value={manufacturingAdminForm.quoted_unit_price ?? ""}
                  />
                </label>
                <label>
                  Tooling Cost ({isRupeeCurrency(selectedManufacturing.currency) ? "Rs" : selectedManufacturing.currency || 'USD'})
                  <input
                  inputMode={isRupeeCurrency(selectedManufacturing.currency) ? "numeric" : "decimal"}
                    min="0"
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        tooling_cost: sanitizeAmountInput(event.target.value, selectedManufacturing.currency),
                      }))
                    }
                    step={isRupeeCurrency(selectedManufacturing.currency) ? "1" : "0.01"}
                    type="number"
                    value={manufacturingAdminForm.tooling_cost ?? ""}
                  />
                </label>
                <label>
                  Deposit Required ({isRupeeCurrency(selectedManufacturing.currency) ? "Rs" : selectedManufacturing.currency || 'USD'})
                  <input
                  inputMode={isRupeeCurrency(selectedManufacturing.currency) ? "numeric" : "decimal"}
                    min="0"
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        deposit_required: sanitizeAmountInput(event.target.value, selectedManufacturing.currency),
                      }))
                    }
                    step={isRupeeCurrency(selectedManufacturing.currency) ? "1" : "0.01"}
                    type="number"
                    value={manufacturingAdminForm.deposit_required ?? ""}
                  />
                </label>
                <label>
                  Target Ready Date
                  <input
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        estimated_ready_at: event.target.value,
                      }))
                    }
                    type="date"
                    value={manufacturingAdminForm.estimated_ready_at || ""}
                  />
                </label>
                <label className="service-wide-field">
                  Broadcast Update Message (Visible to Service Taker)
                  <textarea
                    placeholder="e.g. Damascus forging completed, moving to heat treatment..."
                    rows="2"
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        update_message: event.target.value,
                      }))
                    }
                    value={manufacturingAdminForm.update_message || ""}
                  />
                </label>
                <label className="service-wide-field">
                  Internal Factory Notes (Private)
                  <textarea
                    placeholder="Worker assignments, batch codes, supplier steel notes..."
                    rows="2"
                    onChange={(event) =>
                      setManufacturingAdminForm((current) => ({
                        ...current,
                        admin_notes: event.target.value,
                      }))
                    }
                    value={manufacturingAdminForm.admin_notes || ""}
                  />
                </label>
              </div>
            </form>
            ) : null}

            {/* Payments & Verification Section */}
            <div className="service-process-payments-section">
              <div className="service-process-section-header">
                <div>
                  <span>Financial Management</span>
                  <h4>Payments & Proof Verification</h4>
                </div>
                {!["Rejected", "Cancelled"].includes(selectedManufacturing.status) && (
                  <button
                    type="button"
                    className={`service-workflow-action-btn ${showManufacturingRecordPayment ? "is-complete" : "is-advance"}`}
                    onClick={() => setShowManufacturingRecordPayment((prev) => !prev)}
                  >
                    {showManufacturingRecordPayment ? "Hide Payment Form" : "+ Record Payment"}
                  </button>
                )}
              </div>

              {/* Pending confirmation proofs uploaded by client */}
              {(selectedManufacturing.payments || []).filter((p) => p.status === "Pending confirmation").length > 0 && (
                <div className="service-process-pending-payments">
                  <h5>Pending Payment Confirmations</h5>
                  <div className="service-pending-confirmation-list" style={{ padding: 0 }}>
                    {(selectedManufacturing.payments || [])
                      .filter((p) => p.status === "Pending confirmation")
                      .map((payment) => (
                        <article key={payment.id} className="service-process-proof-card">
                          <div>
                            <strong>{payment.payment_type} Payment: {money(payment.amount, selectedManufacturing.currency)}</strong>
                            <span>{payment.note || "No note attached"} / Uploaded {shortDate(payment.created_at)}</span>
                          </div>
                          <div className="service-process-proof-actions">
                            {payment.proof_url ? (
                              <a
                                className="service-row-button"
                                href={getStaticUrl(payment.proof_url)}
                                rel="noreferrer"
                                target="_blank"
                              >
                                View Proof Screenshot &#8599;
                              </a>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '11px' }}>No screenshot</span>
                            )}
                            <button
                              type="button"
                              className="service-primary-button is-compact"
                              disabled={busy === `confirm-payment-${payment.id}`}
                              onClick={() => confirmPendingPayment(selectedManufacturing, payment)}
                            >
                              &#10003; Confirm & Settle
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                </div>
              )}

              {/* Record Manual Payment Form */}
              {!["Rejected", "Cancelled"].includes(selectedManufacturing.status) && showManufacturingRecordPayment && (
              <div className="service-process-record-payment-box">
                <h5>Record Manual Payment / Adjustment</h5>
                <form className="service-form-grid" onSubmit={recordManufacturingPayment}>
                  <label>
                    Amount ({isRupeeCurrency(selectedManufacturing.currency) ? "Rs" : selectedManufacturing.currency || "USD"})
                    <input
                      inputMode={isRupeeCurrency(selectedManufacturing.currency) ? "numeric" : "decimal"}
                      min={isRupeeCurrency(selectedManufacturing.currency) ? "1" : "0.01"}
                      onChange={(event) =>
                        setManufacturingPaymentForm((current) => ({
                          ...current,
                          amount: sanitizeAmountInput(event.target.value, selectedManufacturing.currency),
                        }))
                      }
                      required
                      step={isRupeeCurrency(selectedManufacturing.currency) ? "1" : "0.01"}
                      type="number"
                      value={manufacturingPaymentForm.amount}
                    />
                  </label>
                  <label>
                    Payment Type
                    <select
                      onChange={(event) =>
                        setManufacturingPaymentForm((current) => ({
                          ...current,
                          payment_type: event.target.value,
                        }))
                      }
                      value={manufacturingPaymentForm.payment_type}
                    >
                      <option value="Deposit">Deposit</option>
                      <option value="Balance">Balance</option>
                      <option value="Adjustment">Adjustment</option>
                    </select>
                  </label>
                  <label>
                    Payment Method
                    <input
                      placeholder="Bank Transfer, Cash, Stripe..."
                      onChange={(event) =>
                        setManufacturingPaymentForm((current) => ({
                          ...current,
                          method: event.target.value,
                        }))
                      }
                      value={manufacturingPaymentForm.method}
                    />
                  </label>
                  <label>
                    Reference / Transaction ID
                    <input
                      placeholder="e.g. TXN-994812"
                      onChange={(event) =>
                        setManufacturingPaymentForm((current) => ({
                          ...current,
                          reference: event.target.value,
                        }))
                      }
                      value={manufacturingPaymentForm.reference}
                    />
                  </label>
                  <label className="service-wide-field">
                    Note
                    <textarea
                      rows="2"
                      onChange={(event) =>
                        setManufacturingPaymentForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      value={manufacturingPaymentForm.note}
                    />
                  </label>
                  <div className="service-detail-actions service-wide-field">
                    <button
                      className="service-primary-button"
                      disabled={busy === "manufacturing-payment"}
                      type="submit"
                    >
                      Record Payment
                    </button>
                  </div>
                </form>
              </div>
              )}
            </div>

            {/* Updates History Audit Trail (Collapsible, default closed) */}
            <div className="service-process-audit-timeline">
              <div
                className="service-process-section-header"
                style={{ cursor: "pointer", userSelect: "none", marginBottom: showManufacturingActivityLog ? 12 : 0 }}
                onClick={() => setShowManufacturingActivityLog((prev) => !prev)}
              >
                <div>
                  <span>Audit Trail</span>
                  <h4 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    Activity & Updates Log
                    <span style={{ fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 12 }}>
                      {(selectedManufacturing.updates || []).length} records
                    </span>
                  </h4>
                </div>
                <button
                  type="button"
                  className="service-workflow-action-btn is-advance"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  {showManufacturingActivityLog ? "Hide log" : "View log"}
                </button>
              </div>

              {showManufacturingActivityLog && (
                <>
                  {(selectedManufacturing.updates || []).length === 0 ? (
                    <p className="service-no-updates">No updates recorded yet.</p>
                  ) : (
                    <div className="service-process-update-items">
                      {(selectedManufacturing.updates || []).map((update) => {
                        const messageText = (update.message || "").toLowerCase();
                        const isServiceTaker =
                          update.actor_type === "service_taker" ||
                          update.status === "Quote requested" ||
                          messageText.includes("client") ||
                          messageText.includes("service taker") ||
                          messageText.includes("quote request submitted");
                        const updateMessage =
                          update.status === "Quote requested" && messageText.includes("quote request submitted")
                            ? "Quote request submitted by service taker."
                            : update.message;
                        return (
                          <div key={update.id} className="service-process-update-item">
                            <div className="service-process-update-icon">&#8226;</div>
                            <div className="service-process-update-content">
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                                <strong style={{ color: "#0f766e" }}>{update.status}</strong>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 800,
                                    textTransform: "uppercase",
                                    padding: "2px 7px",
                                    borderRadius: 4,
                                    background: isServiceTaker ? "#e0f2fe" : "#fef3c7",
                                    color: isServiceTaker ? "#0369a1" : "#92400e",
                                    border: isServiceTaker ? "1px solid #bae6fd" : "1px solid #fde68a",
                                  }}
                                >
                                  {isServiceTaker ? update.actor_name || selectedManufacturing.company_name || "Service Taker" : update.actor_name || "Company"}
                                </span>
                              </div>
                              <p>{updateMessage}</p>
                              <span style={{ fontSize: 10.5, color: "#64748b" }}>{formatDateTime(update.created_at)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {modal === "client-account" && selectedAccount && isAdmin && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={closeClientAccount} type="button">
                Close
              </button>
              <button className="service-secondary-button" onClick={() => editClient(selectedAccount)} type="button">
                Edit account
              </button>
              <button className="service-danger-button" onClick={() => openDeleteClient(selectedAccount)} type="button">
                Delete account
              </button>
            </>
          }
          className="service-account-modal"
          onClose={closeClientAccount}
          subtitle="Open orders, balances, and payment history"
          title={selectedAccount.company_name}
        >
          <section className="service-account-modal-summary">
            <article>
              <span>Open confirmed orders</span>
              <strong>{number(selectedAccountOpenManufacturingOrders.length + selectedAccountOpenFulfillmentOrders.length)}</strong>
              <small>Accepted local orders and active fulfillment</small>
            </article>
            <article>
              <span>Open order balance</span>
              <strong>{money(selectedAccountOpenBalance, selectedAccount.currency)}</strong>
              <small>Quotations are not counted</small>
            </article>
            <article>
              <span>Received payments</span>
              <strong>{money(selectedAccountReceivedTotal, selectedAccount.currency)}</strong>
              <small>{number(selectedAccountPaymentRows.length)} local payment records</small>
            </article>
            <article>
              <span>Payment confirmations</span>
              <strong>{number(selectedAccountPendingPaymentRows.length)}</strong>
              <small>Waiting for company approval</small>
            </article>
          </section>

          <section className="service-account-panel">
            <header>
              <div>
                <span>Portal account</span>
                <h3>{selectedAccount.contact_name || selectedAccount.company_name}</h3>
              </div>
              <Status value={selectedAccount.is_active ? "Active" : "Paused"} />
            </header>
            <div className="service-account-info-grid">
              <div><span>Username</span><strong>{selectedAccount.username || "Not set"}</strong></div>
              <div><span>Email</span><strong>{selectedAccount.email || "Not added"}</strong></div>
              <div><span>Phone</span><strong>{selectedAccount.phone || "Not added"}</strong></div>
              <div><span>Products</span><strong>{number(selectedAccountProducts.length)} SKUs</strong></div>
              <div className="is-wide"><span>Billing address</span><strong>{selectedAccount.billing_address || "Not added"}</strong></div>
            </div>
          </section>

          <section className="service-account-panel">
            <header>
              <div>
                <span>Open orders</span>
                <h3>Confirmed buyer work</h3>
              </div>
              <strong className="service-account-total">{money(selectedAccountOpenBalance, selectedAccount.currency)}</strong>
            </header>
            {selectedAccountOpenManufacturingOrders.length === 0 && selectedAccountOpenFulfillmentOrders.length === 0 ? (
              <div className="service-account-empty">No confirmed open orders.</div>
            ) : (
              <div className="service-account-order-list">
                {selectedAccountOpenManufacturingOrders.map((order) => (
                  <button key={`mfg-${order.id}`} onClick={() => openManufacturingDetail(order)} type="button">
                    <span>Local order</span>
                    <strong>{order.request_no} / {order.product_name}</strong>
                    <small>{order.status} / Due {money(order.balance_due, order.currency)} / Ready {shortDate(order.estimated_ready_at)}</small>
                  </button>
                ))}
                {selectedAccountOpenFulfillmentOrders.map((order) => (
                  <button key={`ship-${order.id}`} onClick={() => openOrderDetail(order)} type="button">
                    <span>Fulfillment</span>
                    <strong>{order.request_no} / {order.recipient_name}</strong>
                    <small>{order.status} / Charges {money(order.total_cost, order.currency)} / {order.tracking_number || "Tracking not set"}</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="service-account-panel">
            <button className="service-account-collapse" onClick={() => setShowAccountPayments((current) => !current)} type="button">
              <span>Payment history</span>
              <strong>{number(selectedAccountPaymentRows.length)} records {showAccountPayments ? "-" : "+"}</strong>
            </button>
            {showAccountPayments && (
              selectedAccountPaymentRows.length === 0 ? (
                <div className="service-account-empty">No payment history yet.</div>
              ) : (
                <div className="service-account-payment-list">
                  {selectedAccountPaymentRows.map(({ order, payment }) => {
                    const proofUrl = payment.proof_url ? getStaticUrl(payment.proof_url) : "";
                    return (
                      <article key={payment.id}>
                        <div className="service-account-proof-thumb">
                          {proofUrl ? (
                            <a href={proofUrl} rel="noreferrer" target="_blank">
                              {proofIsImage(payment.proof_url) ? <img alt="Payment proof" src={proofUrl} /> : <span>PDF</span>}
                            </a>
                          ) : (
                            <span>No proof</span>
                          )}
                        </div>
                        <div>
                          <strong>{payment.payment_type || "Payment"} / {order.request_no}</strong>
                          <span>{order.product_name}</span>
                          <small>{payment.note || payment.reference || "No note added"}</small>
                        </div>
                        <div className="service-account-payment-amount">
                          <strong>{money(payment.amount, order.currency)}</strong>
                          <Status value={payment.status || "Confirmed"} />
                          <small>{shortDate(payment.created_at || payment.paid_at)}</small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            )}
          </section>
        </Modal>
      )}

      {deleteClientTarget && isAdmin && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={closeDeleteClient} type="button">
                Keep account
              </button>
              <button
                className="service-danger-button"
                disabled={deleteClientConfirm.trim() !== deleteClientTarget.company_name || busy === `delete-client-${deleteClientTarget.id}`}
                onClick={deleteClient}
                type="button"
              >
                {busy === `delete-client-${deleteClientTarget.id}` ? "Deleting..." : "Delete permanently"}
              </button>
            </>
          }
          className="service-delete-modal"
          onClose={closeDeleteClient}
          subtitle="This removes the service taker, portal user, products, local orders, fulfillment orders, payments, messages, and activity records."
          title="Delete service taker account"
        >
          <div className="service-delete-warning">
            <strong>{deleteClientTarget.company_name}</strong>
            <span>Type the exact company name to confirm permanent deletion.</span>
            <input
              autoFocus
              onChange={(event) => setDeleteClientConfirm(event.target.value)}
              placeholder={deleteClientTarget.company_name}
              value={deleteClientConfirm}
            />
          </div>
        </Modal>
      )}
      {modal === "client" && isAdmin && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={closeClientModal} type="button">
                Cancel
              </button>
              <button className="service-primary-button" disabled={busy === "client"} form="client-form" type="submit">
                {editingClientId ? "Save account" : "Create account"}
              </button>
            </>
          }
          onClose={closeClientModal}
          subtitle="Portal identity, services and default rates"
          title={editingClientId ? "Edit service taker" : "New service taker"}
        >
          <form className="service-form-grid" id="client-form" onSubmit={submitClient}>
            <label>
              Company name
              <input
                onChange={(event) =>
                  setClientForm((current) => ({ ...current, company_name: event.target.value }))
                }
                required
                value={clientForm.company_name}
              />
            </label>
            <label>
              Contact name
              <input
                onChange={(event) =>
                  setClientForm((current) => ({ ...current, contact_name: event.target.value }))
                }
                required
                value={clientForm.contact_name}
              />
            </label>
            <label>
              Portal username
              <input
                autoComplete="off"
                onChange={(event) =>
                  setClientForm((current) => ({ ...current, username: event.target.value }))
                }
                required
                value={clientForm.username}
              />
            </label>
            <label>
              {editingClientId ? "New 4-digit PIN" : "4-digit PIN"}
              <input
                autoComplete="new-password"
                inputMode="numeric"
                maxLength="4"
                minLength="4"
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    pin: event.target.value.replace(/\D/g, "").slice(0, 4),
                  }))
                }
                pattern="\d{4}"
                required={!editingClientId}
                value={clientForm.pin}
              />
            </label>
            <label>
              Email
              <input
                onChange={(event) =>
                  setClientForm((current) => ({ ...current, email: event.target.value }))
                }
                type="email"
                value={clientForm.email}
              />
            </label>
            <label>
              Phone
              <input
                onChange={(event) =>
                  setClientForm((current) => ({ ...current, phone: event.target.value }))
                }
                value={clientForm.phone}
              />
            </label>
            <fieldset className="service-access-choice service-wide-field">
              <legend>Portal services</legend>
              <div>
                {[
                  [
                    "fulfillment_enabled",
                    "Fulfillment",
                    "Products, inbound stock, ship orders and charges",
                  ],
                  [
                    "manufacturing_enabled",
                    "Local manufacturing",
                    "Quote requests, deposits, timelines and balances",
                  ],
                ].map(([field, title, detail]) => (
                  <label className={clientForm[field] ? "is-selected" : ""} key={field}>
                    <input
                      checked={Boolean(clientForm[field])}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setClientForm((current) => {
                          const otherField =
                            field === "fulfillment_enabled"
                              ? "manufacturing_enabled"
                              : "fulfillment_enabled";
                          if (!checked && !current[otherField]) return current;
                          return { ...current, [field]: checked };
                        });
                      }}
                      type="checkbox"
                    />
                    <span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {[
              ["pick_pack_fee", "Pick & pack fee"],
              ["additional_item_fee", "Additional item fee"],
              ["label_fee", "Hisbenew label fee"],
            ].map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  min="0"
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, [field]: event.target.value }))
                  }
                  step="0.01"
                  type="number"
                  value={clientForm[field]}
                />
              </label>
            ))}
            <label>
              Currency
              <select
                onChange={(event) =>
                  setClientForm((current) => ({ ...current, currency: event.target.value }))
                }
                value={clientForm.currency}
              >
                <option value="USD">USD</option>
                <option value="PKR">PKR</option>
                <option value="GBP">GBP</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="service-wide-field">
              Billing address
              <textarea
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    billing_address: event.target.value,
                  }))
                }
                value={clientForm.billing_address}
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === "product" && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={closeProductModal} type="button">
                Cancel
              </button>
              <button className="service-primary-button" disabled={busy === "product"} form="product-form" type="submit">
                {editingProductId ? "Save product" : "Add product"}
              </button>
            </>
          }
          onClose={closeProductModal}
          subtitle="Photos and physical details for this client-owned catalog"
          title={editingProductId ? "Edit product" : "Add product"}
        >
          <form className="service-form-grid" id="product-form" onSubmit={submitProduct}>
            {isAdmin && (
              <label className="service-wide-field">
                Service taker
                <select
                  disabled={Boolean(editingProductId)}
                  onChange={(event) =>
                    setProductForm((current) => ({
                      ...current,
                      service_taker_id: event.target.value,
                    }))
                  }
                  required
                  value={productForm.service_taker_id}
                >
                  <option value="">Select service taker</option>
                  {clients.filter((client) => client.is_active).map((client) => (
                    <option key={client.id} value={client.id}>{client.company_name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              SKU (optional)
              <input
                disabled={Boolean(editingProductId)}
                onChange={(event) =>
                  setProductForm((current) => ({ ...current, sku: event.target.value }))
                }
                placeholder="Auto if blank"
                value={productForm.sku}
              />
            </label>
            <label>
              Product name
              <input
                onChange={(event) =>
                  setProductForm((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={productForm.name}
              />
            </label>
            <label>
              Barcode
              <input
                onChange={(event) =>
                  setProductForm((current) => ({ ...current, barcode: event.target.value }))
                }
                value={productForm.barcode}
              />
            </label>
            {isAdmin && (
              <label>
                Storage location
                <input
                  onChange={(event) =>
                    setProductForm((current) => ({
                      ...current,
                      storage_location: event.target.value,
                    }))
                  }
                  placeholder="A-01-02"
                  value={productForm.storage_location}
                />
              </label>
            )}
            <label>
              Unit weight (kg, optional)
              <input
                min="0"
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    unit_weight_kg: event.target.value,
                  }))
                }
                step="0.001"
                type="number"
                value={productForm.unit_weight_kg}
              />
            </label>
            <fieldset className="service-dimensions service-wide-field">
              <legend>Dimensions in cm (optional)</legend>
              <div>
                <label>
                  Length
                  <input
                    min="0"
                    onChange={(event) =>
                      setProductForm((current) => ({
                        ...current,
                        length_cm: event.target.value,
                      }))
                    }
                    step="0.01"
                    type="number"
                    value={productForm.length_cm}
                  />
                </label>
                <label>
                  Width
                  <input
                    min="0"
                    onChange={(event) =>
                      setProductForm((current) => ({
                        ...current,
                        width_cm: event.target.value,
                      }))
                    }
                    step="0.01"
                    type="number"
                    value={productForm.width_cm}
                  />
                </label>
                <label>
                  Height
                  <input
                    min="0"
                    onChange={(event) =>
                      setProductForm((current) => ({
                        ...current,
                        height_cm: event.target.value,
                      }))
                    }
                    step="0.01"
                    type="number"
                    value={productForm.height_cm}
                  />
                </label>
              </div>
            </fieldset>
            <label className="service-wide-field">
              Description
              <textarea
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                value={productForm.description}
              />
            </label>
            <label className="service-wide-field">
              Product photo (optional)
              <span className="service-file-field">
                <input
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={(event) =>
                    setProductImageFile(event.target.files?.[0] || null)
                  }
                  type="file"
                />
                <span>
                  {productImageFile
                    ? productImageFile.name
                    : editingProductId
                      ? "Choose a new image to replace the current photo"
                      : "PNG, JPG or WebP, up to 8 MB"}
                </span>
              </span>
            </label>
          </form>
        </Modal>
      )}

      {modal === "inbound" && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={() => setModal("")} type="button">
                Cancel
              </button>
              <button className="service-primary-button" disabled={busy === "inbound"} form="inbound-form" type="submit">
                Submit inbound
              </button>
            </>
          }
          onClose={() => setModal("")}
          subtitle="Stock expected at the Hisbenew warehouse"
          title="New inbound notice"
        >
          <form className="service-form-grid" id="inbound-form" onSubmit={submitInbound}>
            {isAdmin && (
              <label className="service-wide-field">
                Service taker
                <select
                  onChange={(event) =>
                    setInboundForm((current) => ({
                      ...current,
                      service_taker_id: event.target.value,
                      items: [{ product_id: "", quantity: 1 }],
                    }))
                  }
                  required
                  value={inboundForm.service_taker_id}
                >
                  <option value="">Select service taker</option>
                  {clients.filter((client) => client.is_active).map((client) => (
                    <option key={client.id} value={client.id}>{client.company_name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Client reference
              <input
                onChange={(event) =>
                  setInboundForm((current) => ({
                    ...current,
                    client_reference: event.target.value,
                  }))
                }
                value={inboundForm.client_reference}
              />
            </label>
            <label>
              Expected date
              <input
                onChange={(event) =>
                  setInboundForm((current) => ({ ...current, expected_at: event.target.value }))
                }
                type="date"
                value={inboundForm.expected_at}
              />
            </label>
            <label>
              Carrier
              <input
                onChange={(event) =>
                  setInboundForm((current) => ({ ...current, carrier: event.target.value }))
                }
                value={inboundForm.carrier}
              />
            </label>
            <label>
              Tracking number
              <input
                onChange={(event) =>
                  setInboundForm((current) => ({
                    ...current,
                    tracking_number: event.target.value,
                  }))
                }
                value={inboundForm.tracking_number}
              />
            </label>
            <div className="service-lines service-wide-field">
              <header>
                <strong>Inbound items</strong>
                <button onClick={() => addLine(setInboundForm)} type="button">+ SKU</button>
              </header>
              {inboundForm.items.map((item, index) => (
                <div className="service-line" key={`inbound-${index}`}>
                  <select
                    onChange={(event) =>
                      updateLine(setInboundForm, index, "product_id", event.target.value)
                    }
                    required
                    value={item.product_id}
                  >
                    <option value="">Select SKU</option>
                    {productsForClient(inboundForm.service_taker_id).map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} / {product.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity"
                    min="1"
                    onChange={(event) =>
                      updateLine(setInboundForm, index, "quantity", event.target.value)
                    }
                    required
                    type="number"
                    value={item.quantity}
                  />
                  <button
                    aria-label="Remove item"
                    onClick={() => removeLine(setInboundForm, index)}
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </form>
        </Modal>
      )}

      {modal === "order" && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={() => setModal("")} type="button">
                Cancel
              </button>
              <button className="service-primary-button" disabled={busy === "order"} form="order-form" type="submit">
                Create ship order
              </button>
            </>
          }
          className="service-order-modal"
          onClose={() => setModal("")}
          subtitle="Customer delivery and warehouse items"
          title="New Ship Order"
        >
          <form
            className="service-form-grid service-order-form"
            id="order-form"
            onSubmit={submitOrder}
          >
            {isAdmin && (
              <label className="service-wide-field">
                Service taker
                <select
                  onChange={(event) =>
                    setOrderForm((current) => ({
                      ...current,
                      service_taker_id: event.target.value,
                      items: [{ product_id: "", quantity: 1 }],
                    }))
                  }
                  required
                  value={orderForm.service_taker_id}
                >
                  <option value="">Select service taker</option>
                  {clients.filter((client) => client.is_active).map((client) => (
                    <option key={client.id} value={client.id}>{client.company_name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Customer name
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    recipient_name: event.target.value,
                  }))
                }
                required
                value={orderForm.recipient_name}
              />
            </label>
            <label>
              Company (optional)
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    recipient_company: event.target.value,
                  }))
                }
                value={orderForm.recipient_company}
              />
            </label>
            <label className="service-wide-field">
              Street address
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    address_line_1: event.target.value,
                  }))
                }
                required
                value={orderForm.address_line_1}
              />
            </label>
            <label>
              City
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({ ...current, city: event.target.value }))
                }
                required
                value={orderForm.city}
              />
            </label>
            <label>
              State / province
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({ ...current, state: event.target.value }))
                }
                required
                value={orderForm.state}
              />
            </label>
            <label>
              Postal code
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({
                    ...current,
                    postal_code: event.target.value,
                  }))
                }
                required
                value={orderForm.postal_code}
              />
            </label>
            <label>
              Country
              <input
                onChange={(event) =>
                  setOrderForm((current) => ({ ...current, country: event.target.value }))
                }
                required
                value={orderForm.country}
              />
            </label>
            <fieldset className="service-label-choice service-wide-field">
              <legend>Label provided by</legend>
              <div>
                {[
                  ["Hisbenew", "Hisbenew", "Generate the shipping label"],
                  ["Client", "Me", "I will upload the shipping label"],
                ].map(([value, title, detail]) => (
                  <label
                    className={orderForm.label_source === value ? "is-selected" : ""}
                    key={value}
                  >
                    <input
                      checked={orderForm.label_source === value}
                      name="label_source"
                      onChange={() => {
                        setOrderForm((current) => ({
                          ...current,
                          label_source: value,
                        }));
                        if (value === "Hisbenew") setLabelFile(null);
                      }}
                      type="radio"
                      value={value}
                    />
                    <span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {orderForm.label_source === "Client" && (
              <label className="service-order-label-upload service-wide-field">
                Upload shipping label
                <input
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.zpl,.zip,.btw"
                  onChange={(event) => setLabelFile(event.target.files?.[0] || null)}
                  type="file"
                />
              </label>
            )}
            <div className="service-lines service-wide-field">
              <header>
                <strong>Ship order items</strong>
                <button onClick={() => addLine(setOrderForm)} type="button">+ SKU</button>
              </header>
              {orderForm.items.map((item, index) => (
                <div className="service-line" key={`order-${index}`}>
                  <select
                    onChange={(event) =>
                      updateLine(setOrderForm, index, "product_id", event.target.value)
                    }
                    required
                    value={item.product_id}
                  >
                    <option value="">Select SKU</option>
                    {productsForClient(orderForm.service_taker_id).map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} / {product.name} / {product.available_quantity} available
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity"
                    min="1"
                    onChange={(event) =>
                      updateLine(setOrderForm, index, "quantity", event.target.value)
                    }
                    required
                    type="number"
                    value={item.quantity}
                  />
                  <button
                    aria-label="Remove item"
                    onClick={() => removeLine(setOrderForm, index)}
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </form>
        </Modal>
      )}

      {modal === "manufacturing-payment-proof" && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={closeManufacturingPaymentProof} type="button">
                Cancel
              </button>
              <button
                className="service-primary-button"
                disabled={busy === "manufacturing-payment-proof"}
                form="manufacturing-payment-proof-form"
                type="submit"
              >
                Submit for confirmation
              </button>
            </>
          }
          className="service-payment-upload-modal"
          onClose={closeManufacturingPaymentProof}
          subtitle="Upload the transfer receipt or screenshot. Hisbenew will confirm it from company side."
          title="Add payment screenshot"
        >
          <form className="service-form-grid service-payment-proof-form" id="manufacturing-payment-proof-form" onSubmit={submitManufacturingPaymentProof}>
            <div className="service-wide-field" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#64748b", display: "block" }}>Account Total Balance Due</span>
                <strong style={{ fontSize: 18, fontWeight: 800, color: Number(localOrderBalanceDue || 0) > 0 ? "#dc2626" : "#16a34a" }}>
                  {money(localOrderBalanceDue, currency)}
                </strong>
              </div>
              <span style={{ fontSize: 11.5, color: "#64748b", textAlign: "right" }}>
                Recorded payments directly reduce your account due balance.
              </span>
            </div>
            <label>
              Payment type
              <select
                onChange={(event) => {
                  setPortalPaymentForm((current) => ({
                    ...current,
                    payment_type: event.target.value,
                  }));
                }}
                value={portalPaymentForm.payment_type}
              >
                <option value="Payment">Payment</option>
                <option value="Deposit">Deposit</option>
                <option value="Balance">Balance</option>
                <option value="Advance">Advance</option>
              </select>
            </label>
            <label>
              Amount ({isRupeeCurrency(currency) ? "Rs" : currency})
              <input
                inputMode={isRupeeCurrency(currency) ? "numeric" : "decimal"}
                min={isRupeeCurrency(currency) ? "1" : "0.01"}
                onChange={(event) =>
                  setPortalPaymentForm((current) => ({
                    ...current,
                    amount: sanitizeAmountInput(event.target.value, currency),
                  }))
                }
                required
                step={isRupeeCurrency(currency) ? "1" : "0.01"}
                type="number"
                value={portalPaymentForm.amount}
              />
            </label>
            <label className="service-wide-field service-file-field service-payment-proof-field">
              Payment screenshot / receipt
              <input
                accept={PAYMENT_PROOF_ACCEPT}
                onChange={(event) => setPortalPaymentProofFile(event.target.files?.[0] || null)}
                required
                type="file"
              />
              <span>{portalPaymentProofFile ? portalPaymentProofFile.name : "PNG, JPG, WebP or PDF proof"}</span>
            </label>
            <label className="service-wide-field">
              Note
              <textarea
                onChange={(event) => setPortalPaymentForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Transaction ID, bank name, or payment details"
                rows="2"
                value={portalPaymentForm.note}
              />
            </label>
          </form>
        </Modal>
      )}

      {modal === "manufacturing-deposit" && depositOrder && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={closeManufacturingDeposit} type="button">
                Cancel
              </button>
              <button
                className="service-primary-button"
                disabled={busy === `manufacturing-deposit-${depositOrder.id}`}
                onClick={requestManufacturingDeposit}
                type="button"
              >
                Make deposit
              </button>
            </>
          }
          onClose={closeManufacturingDeposit}
          subtitle="This will send the deposit to Hisbenew for company confirmation."
          title="Proceed to local order"
        >
          <div className="service-deposit-confirmation">
            <div>
              <span>Quote</span>
              <strong>{depositOrder.request_no}</strong>
            </div>
            <div>
              <span>Product</span>
              <strong>{depositOrder.product_name}</strong>
            </div>
            <div>
              <span>Quote total</span>
              <strong>{money(depositOrder.quoted_total, depositOrder.currency)}</strong>
            </div>
            <div>
              <span>Deposit required</span>
              <strong>{money(depositOrder.deposit_balance_due || depositOrder.deposit_required, depositOrder.currency)}</strong>
            </div>
            <label className='service-wide-field service-file-field service-payment-proof-field'>
              Deposit screenshot / receipt
              <input
                accept={PAYMENT_PROOF_ACCEPT}
                onChange={(event) => setManufacturingDepositProofFile(event.target.files?.[0] || null)}
                type='file'
              />
              <span>{manufacturingDepositProofFile ? manufacturingDepositProofFile.name : 'PNG, JPG, WebP or PDF proof for company confirmation'}</span>
            </label>
          </div>
        </Modal>
      )}

      {modal === "manufacturing" && (
        <Modal
          actions={
            <>
              <button className="service-secondary-button" onClick={() => setModal("")} type="button">
                Cancel
              </button>
              <button className="service-primary-button" disabled={busy === "manufacturing"} form="manufacturing-form" type="submit">
                Submit quote request
              </button>
            </>
          }
          onClose={() => {
            setManufacturingImageFile(null);
            setModal("");
          }}
          subtitle={isAdmin ? "Company-side technical request" : "Simple product request"}
          title="New Local Order Quote"
        >
          <form className="service-form-grid service-simple-quote-form" id="manufacturing-form" onSubmit={submitManufacturing}>
            {isAdmin && (
              <label className="service-wide-field">
                Service taker
                <select
                  onChange={(event) =>
                    setManufacturingForm((current) => ({
                      ...current,
                      service_taker_id: event.target.value,
                      product_id: "",
                      product_name: "",
                      client_reference: "",
                    }))
                  }
                  required
                  value={manufacturingForm.service_taker_id}
                >
                  <option value="">Select service taker</option>
                  {clients.filter((client) => client.is_active).map((client) => (
                    <option key={client.id} value={client.id}>{client.company_name}</option>
                  ))}
                </select>
              </label>
            )}
            {manufacturingCatalogProducts.length > 0 && (
              <label className="service-wide-field service-simple-quote-field">
                Select product
                <select
                  onChange={(event) => {
                    const selectedProduct = manufacturingCatalogProducts.find(
                      (product) => String(product.id) === String(event.target.value)
                    );
                    setManufacturingForm((current) => ({
                      ...current,
                      product_id: event.target.value,
                      product_name: selectedProduct?.name || "",
                      client_reference: selectedProduct?.sku || current.client_reference,
                    }));
                    if (selectedProduct?.image_url) setManufacturingImageFile(null);
                  }}
                  value={manufacturingForm.product_id}
                >
                  <option value="">New/custom product</option>
                  {manufacturingCatalogProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} / {product.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="service-wide-field service-simple-quote-field">
              {manufacturingForm.product_id ? "Selected product" : "New product/design name"}
              <input
                disabled={Boolean(manufacturingForm.product_id)}
                onChange={(event) =>
                  setManufacturingForm((current) => ({ ...current, product_name: event.target.value }))
                }
                placeholder="Enter product or design name"
                required={!manufacturingForm.product_id}
                value={manufacturingForm.product_name}
              />
            </label>

            <label className="service-simple-quote-field">
              Quantity
              <input
                min="1"
                onChange={(event) =>
                  setManufacturingForm((current) => ({ ...current, quantity: event.target.value }))
                }
                required
                type="number"
                value={manufacturingForm.quantity}
              />
            </label>

            <label className="service-wide-field service-simple-quote-field">
              Product picture / drawing
              <span className="service-file-field">
                <input
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={(event) => setManufacturingImageFile(event.target.files?.[0] || null)}
                  type="file"
                />
                <span>
                  {manufacturingImageFile ? manufacturingImageFile.name : "PNG, JPG or WebP product photo/drawing"}
                </span>
              </span>
            </label>

            <label className="service-wide-field service-simple-quote-field">
              Short note
              <textarea
                onChange={(event) =>
                  setManufacturingForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Optional reference, drawing details, or sample notes"
                rows="3"
                value={manufacturingForm.notes}
              />
            </label>

            {!isAdmin && (
              <div className="service-simple-quote-note service-wide-field">
                Hisbenew will review the request and set steel, tang, blade size, handle, finish, quote price, deposit, and ready date from the company side.
              </div>
            )}

            {isAdmin && (
              <>
                <label>
                  Reference
                  <input
                    onChange={(event) =>
                      setManufacturingForm((current) => ({ ...current, client_reference: event.target.value }))
                    }
                    value={manufacturingForm.client_reference}
                  />
                </label>
                <label>
                  Steel
                  <select
                    onChange={(event) =>
                      setManufacturingForm((current) => ({ ...current, steel_type: event.target.value }))
                    }
                    value={manufacturingForm.steel_type}
                  >
                    <option value="">Choose at company side</option>
                    {["D2", "1095", "440C", "Damascus", "AUS-8", "VG10", "Custom"].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tang
                  <select
                    onChange={(event) =>
                      setManufacturingForm((current) => ({ ...current, tang_type: event.target.value }))
                    }
                    value={manufacturingForm.tang_type}
                  >
                    <option value="">Choose at company side</option>
                    <option value="Full tang">Full tang</option>
                    <option value="Half tang">Half tang</option>
                    <option value="Rat-tail tang">Rat-tail tang</option>
                    <option value="Hidden tang">Hidden tang</option>
                  </select>
                </label>
                {[
                  ["blade_thickness_mm", "Blade thickness mm"],
                  ["blade_length_in", "Blade length in"],
                  ["overall_length_in", "Overall size in"],
                  ["target_unit_price", "Target unit price"],
                ].map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      min="0"
                      onChange={(event) =>
                        setManufacturingForm((current) => ({ ...current, [field]: event.target.value }))
                      }
                      step="0.01"
                      type="number"
                      value={manufacturingForm[field]}
                    />
                  </label>
                ))}
                {[
                  ["handle_material", "Handle material", "Walnut, pakkawood, micarta"],
                  ["sheath_type", "Sheath", "Leather sheath"],
                  ["finish", "Finish", "Satin, mirror, stonewash"],
                  ["hardness", "Hardness", "e.g. 58-60 HRC"],
                  ["edge_type", "Edge", "Plain, serrated, convex"],
                  ["packaging", "Packaging", "Box, pouch, bulk"],
                ].map(([field, label, placeholder]) => (
                  <label key={field}>
                    {label}
                    <input
                      onChange={(event) =>
                        setManufacturingForm((current) => ({ ...current, [field]: event.target.value }))
                      }
                      placeholder={placeholder}
                      value={manufacturingForm[field]}
                    />
                  </label>
                ))}
                <label>
                  Requested ready date
                  <input
                    onChange={(event) =>
                      setManufacturingForm((current) => ({ ...current, requested_ready_at: event.target.value }))
                    }
                    type="date"
                    value={manufacturingForm.requested_ready_at}
                  />
                </label>
              </>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}












