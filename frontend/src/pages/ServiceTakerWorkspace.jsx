import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./ServiceTakerWorkspace.css";

const money = (value, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(Number(value || 0));

const number = (value) => new Intl.NumberFormat("en-US").format(Number(value || 0));

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

const errorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
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
  recipient_name: "",
  recipient_company: "",
  address_line_1: "",
  city: "",
  state: "",
  postal_code: "",
  country: "USA",
  label_source: "Hisbenew",
  items: [{ product_id: "", quantity: 1 }],
});

function Status({ value }) {
  const key = String(value || "").toLowerCase().replace(/\s+/g, "-");
  return <span className={`service-status is-${key}`}>{value || "Unknown"}</span>;
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
            ×
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
  const [labelFile, setLabelFile] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [costForm, setCostForm] = useState({});
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
  const ledger = Array.isArray(data.ledger) ? data.ledger : [];
  const currency = data.client?.currency || clients[0]?.currency || "USD";

  const filterClientId =
    clientFilter === "all" || !clientFilter ? null : Number(clientFilter);
  const query = search.trim().toLowerCase();
  const matchesClient = (row) =>
    !filterClientId || Number(row.service_taker_id) === filterClientId;
  const matchesSearch = (...values) =>
    !query || values.some((value) => String(value || "").toLowerCase().includes(query));

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
            order.tracking_number
          )
      ),
    [orders, filterClientId, query]
  );
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || null;
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
  const readyToShipCount = dispatchQueue.filter(
    (order) => order.status === "Ready"
  ).length;
  const billableOrders = orders.filter(
    (order) => order.status !== "Cancelled" && Number(order.total_cost || 0) > 0
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

  const productsForClient = (serviceTakerId) =>
    products.filter(
      (product) =>
        product.is_active &&
        (!isAdmin || Number(product.service_taker_id) === Number(serviceTakerId))
    );

  const showSuccess = (message) => {
    setNotice(message);
    setError("");
  };

  const submitClient = async (event) => {
    event.preventDefault();
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
    setBusy("product");
    try {
      const collectionEndpoint = isAdmin
        ? "/service-takers/admin/products"
        : "/service-takers/portal/products";
      const optionalNumber = (value) => (value === "" ? null : Number(value));
      const payload = {
        ...productForm,
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
    setBusy("order");
    try {
      const endpoint = isAdmin
        ? "/service-takers/admin/orders"
        : "/service-takers/portal/orders";
      const response = await api.post(endpoint, {
        ...orderForm,
        service_taker_id: isAdmin ? Number(orderForm.service_taker_id) : null,
        items: orderForm.items.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
        })),
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
              "Ship order was created, but the label could not be uploaded."
            )
          );
          await load({ quiet: true });
          return;
        }
      }
      setModal("");
      setOrderForm(emptyOrder());
      setLabelFile(null);
      showSuccess("Ship order created and stock reserved.");
      await load({ quiet: true });
    } catch (submitError) {
      setError(errorMessage(submitError, "Ship order could not be created."));
    } finally {
      setBusy("");
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
      courier: order.courier || "",
      shipping_service: order.shipping_service || "",
      tracking_number: order.tracking_number || "",
      shipping_cost: order.shipping_cost || "",
      pick_pack_cost: order.pick_pack_cost || "",
      label_cost: order.label_cost || "",
      other_cost: order.other_cost || "",
      notes: order.notes || "",
    });
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
      showSuccess(`${order.request_no} shipped and client stock deducted.`);
      setSelectedOrderId(null);
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
      await api.post(`/service-takers/portal/orders/${order.id}/cancel`);
      showSuccess(`${order.request_no} cancelled and stock released.`);
      await load({ quiet: true });
    } catch (cancelError) {
      setError(errorMessage(cancelError, "Ship order could not be cancelled."));
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

  const tabs = [
    ["clients", "Service takers", clients.length],
    ["inventory", "Client inventory", products.length],
    ["inbound", "Inbound", data.stats?.open_inbounds || 0],
    ["orders", "Fulfillment", data.stats?.open_orders || 0],
  ];
  const portalPageTitle =
    activeTab === "dashboard"
      ? "Dashboard"
      : activeTab === "inbound"
      ? "Inbound"
      : activeTab === "orders"
        ? "Ship Order"
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

  const openOrderModal = () => {
    setOrderForm({
      ...emptyOrder(),
      service_taker_id:
        clientFilter !== "all" ? clientFilter : clients[0]?.id || "",
    });
    setModal("order");
  };

  if (loading) {
    return <div className="service-page-loading">Loading service fulfillment...</div>;
  }

  return (
    <div
      className={`service-workspace ${isAdmin ? "is-admin" : "is-portal"} ${
        activeTab === "dashboard" && !isAdmin ? "is-dashboard-view" : ""
      }`.trim()}
    >
      <header className="service-page-header">
        <div>
          <span className="service-eyebrow">
            {isAdmin ? "Third-party fulfillment" : portalPageTitle}
          </span>
          <h1>{isAdmin ? "Service Takers" : data.client?.company_name || "Service Portal"}</h1>
          <p>
            {isAdmin
              ? "Client inventory, inbound receiving, outbound requests, labels and charges"
              : `Fulfillment portal account ${data.client?.contact_name || ""}`}
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
            ×
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

        {activeTab !== "dashboard" && (
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
                <span>+</span> Ship Order
              </button>
            )}
          </div>
        </div>
        )}

        {activeTab === "dashboard" && !isAdmin && (
          <div className="service-dashboard-modern">
            <section className="service-kpi-grid" aria-label="Fulfillment overview">
              <article className="is-catalog">
                <span>Total SKUs</span>
                <strong>{number(activeProducts.length)}</strong>
                <small>{number(onHandUnits)} units in warehouse</small>
              </article>
              <article className={unavailableProducts.length ? "is-attention" : "is-healthy"}>
                <span>Unavailable SKUs</span>
                <strong>{number(unavailableProducts.length)}</strong>
                <small>
                  {unavailableProducts.length
                    ? `${number(outOfStockProducts.length)} out of stock / ${number(
                        fullyReservedProducts.length
                      )} fully reserved`
                    : "Every active SKU is available"}
                </small>
              </article>
              <article className="is-available">
                <span>Available units</span>
                <strong>{number(availableUnits)}</strong>
                <small>{number(reservedUnits)} reserved for dispatch</small>
              </article>
              <article className="is-dispatch">
                <span>Dispatch queue</span>
                <strong>{number(dispatchQueue.length)}</strong>
                <small>{number(readyToShipCount)} ready to ship</small>
              </article>
            </section>

            <section className="service-command-panel">
              <header className="service-dashboard-heading">
                <div>
                  <span>Live fulfillment</span>
                  <h2>Dispatch command center</h2>
                  <p>Track every shipment from label preparation to dispatch.</p>
                </div>
                <span className="service-live-indicator">
                  <i />
                  Live
                </span>
              </header>
              <div className="service-stage-rail">
                {dispatchStages.map(([status, label], index) => {
                  const stageCount = orders.filter(
                    (order) => order.status === status
                  ).length;
                  return (
                    <div
                      className={`${stageCount ? "has-work" : ""} ${
                        status === "Shipped" ? "is-complete" : ""
                      }`.trim()}
                      key={status}
                    >
                      <span>{index + 1}</span>
                      <div>
                        <small>{label}</small>
                        <strong>{number(stageCount)}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="service-dashboard-columns">
              <section className="service-queue-panel">
                <header className="service-dashboard-heading is-compact">
                  <div>
                    <span>Priority work</span>
                    <h2>Dispatch queue</h2>
                  </div>
                  <strong>{number(dispatchQueue.length)} open</strong>
                </header>
                {dispatchQueue.length === 0 ? (
                  <EmptyState
                    title="Dispatch queue is clear"
                    detail="New ship orders will appear here."
                  />
                ) : (
                  <div className="service-queue-table">
                    <div className="service-queue-head">
                      <span>Ship order</span>
                      <span>Destination</span>
                      <span>Units</span>
                      <span>Stage</span>
                    </div>
                    {dispatchQueue.slice(0, 7).map((order) => (
                      <div className="service-queue-row" key={order.id}>
                        <span>
                          <strong>{order.request_no}</strong>
                          <small>{order.recipient_name}</small>
                        </span>
                        <span>
                          <strong>{order.city || "Not set"}</strong>
                          <small>{order.state || order.country}</small>
                        </span>
                        <b>{number(order.item_quantity)}</b>
                        <Status value={order.status} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <aside className="service-inventory-health">
                <header className="service-dashboard-heading is-compact">
                  <div>
                    <span>Warehouse stock</span>
                    <h2>Inventory availability</h2>
                  </div>
                  <strong className={inventoryAvailabilityPercent === null ? "is-empty" : ""}>
                    {inventoryAvailabilityPercent === null
                      ? "No SKUs"
                      : `${inventoryAvailabilityPercent}%`}
                  </strong>
                </header>
                <div
                  className={`service-health-bar ${
                    inventoryAvailabilityPercent === null ? "is-empty" : ""
                  }`.trim()}
                  aria-label={
                    inventoryAvailabilityPercent === null
                      ? "No active SKUs"
                      : `${inventoryAvailabilityPercent}% of active SKUs have available stock`
                  }
                >
                  <span
                    style={{ width: `${inventoryAvailabilityPercent || 0}%` }}
                  />
                </div>
                <p className="service-health-caption">
                  {inventoryAvailabilityPercent === null
                    ? "Add products to begin warehouse stock tracking."
                    : `${number(availableProducts.length)} of ${number(activeProducts.length)} active SKUs have stock available to ship.`}
                </p>
                <div className="service-inventory-numbers">
                  <div>
                    <span>On hand</span>
                    <strong>{number(onHandUnits)}</strong>
                  </div>
                  <div>
                    <span>Reserved</span>
                    <strong>{number(reservedUnits)}</strong>
                  </div>
                  <div>
                    <span>Available</span>
                    <strong>{number(availableUnits)}</strong>
                  </div>
                </div>
                <div className="service-stock-attention">
                  <header>
                    <strong>SKU availability</strong>
                    <span>
                      {number(availableProducts.length)} / {number(activeProducts.length)} available
                    </span>
                  </header>
                  {stockTrackingProducts.length === 0 ? (
                    <p>Add a product to begin inventory tracking.</p>
                  ) : (
                    stockTrackingProducts.slice(0, 5).map((product) => {
                      const onHand = Number(product.quantity_on_hand || 0);
                      const reserved = Number(product.reserved_quantity || 0);
                      const available = Number(product.available_quantity || 0);
                      const stockState =
                        onHand <= 0
                          ? "Out of stock"
                          : available <= 0
                            ? "Fully reserved"
                            : "In stock";
                      const stockStateClass =
                        onHand <= 0
                          ? "is-out"
                          : available <= 0
                            ? "is-reserved"
                            : "is-in-stock";
                      return (
                      <div key={product.id}>
                        <span>
                          <strong>{product.name}</strong>
                          <small>
                            {product.sku} / On hand {number(onHand)} / Reserved{" "}
                            {number(reserved)} / Available {number(available)}
                          </small>
                        </span>
                        <b className={`service-stock-state ${stockStateClass}`}>
                          {stockState}
                        </b>
                      </div>
                      );
                    })
                  )}
                </div>
                <div className="service-inbound-summary">
                  <span>
                    <strong>Open inbound notices</strong>
                    <small>{number(incomingUnits)} units expected</small>
                  </span>
                  <b>{number(openInboundNotices.length)}</b>
                </div>
              </aside>
            </div>

            <section className="service-recent-panel">
              <header className="service-dashboard-heading is-compact">
                <div>
                  <span>Completed outbound</span>
                  <h2>Recent dispatches</h2>
                </div>
                <strong>{number(shippedOrders.length)} total</strong>
              </header>
              {shippedOrders.length === 0 ? (
                <EmptyState
                  title="No dispatches yet"
                  detail="Completed shipments will appear here with courier and tracking."
                />
              ) : (
                <div className="service-recent-table">
                  <div className="service-recent-head">
                    <span>Ship order</span>
                    <span>Customer</span>
                    <span>Courier & tracking</span>
                    <span>Units</span>
                    <span>Dispatched</span>
                  </div>
                  {shippedOrders.slice(0, 7).map((order) => (
                    <div className="service-recent-row" key={order.id}>
                      <strong>{order.request_no}</strong>
                      <span>{order.recipient_name}</span>
                      <span>
                        <strong>{order.courier || "Courier not set"}</strong>
                        <small>{order.tracking_number || "No tracking"}</small>
                      </span>
                      <b>{number(order.item_quantity)}</b>
                      <span>{shortDate(order.shipped_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
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

        {activeTab === "billing" && !isAdmin && (
          <div className="service-table-wrap">
            {billableOrders.length === 0 ? (
              <EmptyState title="No fulfillment charges" detail="Charges appear with ship orders." />
            ) : (
              <table className="service-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Shipping</th>
                    <th>Pick & pack</th>
                    <th>Label</th>
                    <th>Other</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billableOrders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <strong>{order.recipient_name}</strong>
                          <span>{shortDate(order.created_at)}</span>
                        </td>
                        <td>{money(order.shipping_cost, order.currency)}</td>
                        <td>{money(order.pick_pack_cost, order.currency)}</td>
                        <td>{money(order.label_cost, order.currency)}</td>
                        <td>{money(order.other_cost, order.currency)}</td>
                        <td><strong>{money(order.total_cost, order.currency)}</strong></td>
                        <td><Status value={order.status} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

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
          subtitle="Portal identity and default fulfillment rates"
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
              SKU
              <input
                disabled={Boolean(editingProductId)}
                onChange={(event) =>
                  setProductForm((current) => ({ ...current, sku: event.target.value }))
                }
                required
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
                        {product.sku} · {product.name}
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
                    ×
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
                    ×
                  </button>
                </div>
              ))}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
