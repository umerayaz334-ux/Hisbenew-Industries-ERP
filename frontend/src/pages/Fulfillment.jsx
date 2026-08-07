import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import "./Fulfillment.css";

const createShipmentItem = () => ({ product_id: "", quantity: 1 });

const createShipmentBox = (number = 1) => ({
  box_number: String(number),
  weight_kg: "",
  length_cm: "",
  width_cm: "",
  height_cm: "",
  location: "",
  notes: "",
  items: [createShipmentItem()],
});

const createShipmentForm = () => ({
  shipment_no: "",
  destination_name: "Fulfillment center",
  source_stock: "Factory",
  notes: "",
  boxes: [createShipmentBox(1)],
});

const createOrderItem = () => ({ product_id: "", quantity: 1 });

const createOrderForm = () => ({
  fulfillment_order_no: "",
  customer_name: "",
  platform: "",
  ship_to: "",
  notes: "",
  label_file: null,
  items: [createOrderItem()],
});

const createDiscrepancyForm = (boxItemId = "") => ({
  box_item_id: boxItemId ? String(boxItemId) : "",
  reason: "Damaged",
  direction: "remove",
  quantity: 1,
  reference: "",
  notes: "",
});

const DISCREPANCY_REASONS = [
  ["Damaged", "remove"],
  ["Missing", "remove"],
  ["Customer return", "add"],
  ["Recovered", "add"],
  ["Count correction", null],
];

const discrepancyDirectionForReason = (reason, currentDirection = "remove") => {
  const option = DISCREPANCY_REASONS.find(([value]) => value === reason);
  return option?.[1] || currentDirection;
};

const formatNumber = (value) =>
  Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });

const getBoxTrackingId = (box, shipmentNumber = "") => {
  const recordId = box?.box_id || box?.id;
  if (recordId) return `BX-${String(recordId).padStart(6, "0")}`;

  const shipmentNo = String(box?.shipment_no || shipmentNumber || "").trim();
  const rawBoxNumber = String(box?.box_number || "").trim();
  const boxNumber = /^\d+$/.test(rawBoxNumber)
    ? rawBoxNumber.padStart(2, "0")
    : rawBoxNumber.toUpperCase();

  if (shipmentNo && boxNumber) return `${shipmentNo}-B${boxNumber}`;

  return boxNumber ? `BOX-${boxNumber}` : "Unassigned box";
};

const escapeLabelHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]
  );

const createBoxBarcodeSvg = (trackingId) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, trackingId, {
    format: "CODE128",
    width: 2,
    height: 68,
    margin: 8,
    displayValue: false,
    background: "#ffffff",
    lineColor: "#000000",
  });
  return svg.outerHTML;
};

const buildBoxLabelDocument = (shipment, boxes) => {
  const labels = boxes.map((box) => {
    const trackingId = getBoxTrackingId(box, shipment.shipment_no);
    const items = (box.items || []).filter((item) => Number(item.quantity || 0) > 0);
    const visibleItems = items.slice(0, 7);
    const remainingItems = Math.max(items.length - visibleItems.length, 0);
    const dimensions = [box.length_cm, box.width_cm, box.height_cm]
      .map((value) => (Number(value || 0) > 0 ? Number(value) : null))
      .filter((value) => value !== null);
    const totalUnits =
      box.total_units ??
      items.reduce((total, item) => total + Number(item.quantity || 0), 0);

    const itemRows = visibleItems.length
      ? visibleItems
          .map(
            (item) => `
              <tr>
                <td>${escapeLabelHtml(item.article_no || "SKU")}</td>
                <td>${escapeLabelHtml(item.product_name || "")}</td>
                <td>${escapeLabelHtml(formatNumber(item.quantity))}</td>
              </tr>`
          )
          .join("")
      : '<tr><td colspan="3">Contents recorded in ERP</td></tr>';

    return `
      <article class="box-label">
        <header>
          <div>
            <span>HISBENEW INDUSTRIES</span>
            <strong>FULFILLMENT BOX</strong>
          </div>
          <b>${escapeLabelHtml(trackingId)}</b>
        </header>

        <section class="barcode">
          ${createBoxBarcodeSvg(trackingId)}
          <strong>${escapeLabelHtml(trackingId)}</strong>
          <small>SCAN BOX ID IN ERP</small>
        </section>

        <section class="shipment">
          <div class="shipment-id">
            <small>SHIPMENT</small>
            <strong>${escapeLabelHtml(shipment.shipment_no)}</strong>
          </div>
          <div>
            <small>CARTON</small>
            <strong>${escapeLabelHtml(box.box_number)} / ${escapeLabelHtml(
              shipment.carton_count || boxes.length
            )}</strong>
          </div>
        </section>

        <section class="destination">
          <small>DESTINATION</small>
          <strong>${escapeLabelHtml(
            shipment.destination_name || "Fulfillment center"
          )}</strong>
        </section>

        <section class="facts">
          <div><small>UNITS</small><strong>${escapeLabelHtml(
            formatNumber(totalUnits)
          )}</strong></div>
          <div><small>WEIGHT</small><strong>${
            box.weight_kg ? `${escapeLabelHtml(box.weight_kg)} kg` : "—"
          }</strong></div>
          <div><small>SIZE (CM)</small><strong>${
            dimensions.length === 3
              ? escapeLabelHtml(dimensions.join(" × "))
              : "—"
          }</strong></div>
          <div><small>SOURCE</small><strong>${escapeLabelHtml(
            shipment.source_stock || "PK"
          )}</strong></div>
        </section>

        <section class="contents">
          <div class="section-title">BOX CONTENTS</div>
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Qty</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
          ${
            remainingItems
              ? `<p>+ ${escapeLabelHtml(remainingItems)} more SKU${
                  remainingItems === 1 ? "" : "s"
                } in ERP</p>`
              : ""
          }
        </section>

        <footer>
          <span>Sent ${escapeLabelHtml(formatUtcLocal(shipment.sent_at))}</span>
          <strong>Keep barcode visible</strong>
        </footer>
      </article>`;
  });

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeLabelHtml(shipment.shipment_no)} box labels</title>
        <style>
          * { box-sizing: border-box; }
          @page { size: 4in 6in; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
          .box-label { width: 4in; height: 6in; padding: .18in; overflow: hidden; page-break-after: always; break-after: page; display: flex; flex-direction: column; gap: .1in; }
          .box-label:last-child { page-break-after: auto; break-after: auto; }
          header { display: flex; min-height: .48in; align-items: center; justify-content: space-between; gap: .12in; border-bottom: 3px solid #111; padding-bottom: .08in; }
          header div { display: grid; gap: 2px; }
          header span { font-size: 8px; font-weight: 700; letter-spacing: .08em; }
          header div strong { font-size: 15px; letter-spacing: .02em; }
          header > b { padding: 6px 8px; border: 2px solid #111; font-size: 13px; white-space: nowrap; }
          .barcode { display: grid; justify-items: center; gap: 1px; padding: .03in 0; }
          .barcode svg { display: block; width: 100%; max-width: 3.45in; height: .76in; }
          .barcode strong { font-size: 16px; letter-spacing: .16em; }
          .barcode small { font-size: 7px; font-weight: 700; letter-spacing: .12em; }
          .shipment { display: grid; grid-template-columns: minmax(0, 1fr) 1in; border: 2px solid #111; }
          .shipment > div { display: grid; gap: 3px; padding: 8px; }
          .shipment > div + div { border-left: 2px solid #111; text-align: center; }
          small { font-size: 7px; font-weight: 700; letter-spacing: .08em; }
          .shipment strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
          .destination { display: grid; gap: 3px; padding: 7px 8px; border: 1.5px solid #111; }
          .destination strong { font-size: 14px; }
          .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1.5px solid #111; }
          .facts div { display: grid; min-width: 0; gap: 3px; padding: 7px 5px; text-align: center; }
          .facts div + div { border-left: 1px solid #111; }
          .facts strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
          .contents { min-height: 0; flex: 1; overflow: hidden; border: 1.5px solid #111; }
          .section-title { padding: 5px 7px; border-bottom: 1.5px solid #111; background: #111; color: #fff; font-size: 8px; font-weight: 700; letter-spacing: .08em; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { overflow: hidden; padding: 4px 5px; border-bottom: 1px solid #bbb; font-size: 8px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
          th { background: #eee; font-size: 7px; letter-spacing: .04em; text-transform: uppercase; }
          th:first-child, td:first-child { width: 29%; font-weight: 700; }
          th:last-child, td:last-child { width: 12%; text-align: right; }
          .contents p { margin: 4px 6px; font-size: 7px; font-weight: 700; }
          footer { display: flex; justify-content: space-between; gap: 10px; padding-top: 2px; font-size: 7px; }
          footer strong { text-transform: uppercase; }
          @media screen {
            body { display: grid; justify-content: center; gap: 18px; padding: 18px; background: #e7e7e7; }
            .box-label { background: #fff; box-shadow: 0 5px 22px rgba(0,0,0,.18); }
          }
          @media print {
            body { display: block; }
            .box-label { box-shadow: none; }
          }
        </style>
      </head>
      <body>${labels.join("")}</body>
    </html>`;
};

const prepareBoxLabelWindow = () => {
  const printWindow = window.open(
    "",
    "_blank",
    "width=760,height=860,scrollbars=yes,resizable=yes"
  );
  if (!printWindow) return null;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html>
      <head><title>Preparing box labels</title></head>
      <body style="margin:0;display:grid;min-height:100vh;place-items:center;font-family:Arial,sans-serif;color:#303030">
        <p>Preparing printable box labels...</p>
      </body>
    </html>`);
  printWindow.document.close();
  return printWindow;
};

const printBoxLabels = (shipment, boxes, preparedWindow = null) => {
  const printableBoxes = (boxes || []).filter(Boolean);
  if (!shipment || printableBoxes.length === 0) {
    preparedWindow?.close();
    return false;
  }

  const printWindow = preparedWindow || prepareBoxLabelWindow();
  if (!printWindow) return false;

  printWindow.document.open();
  printWindow.document.write(buildBoxLabelDocument(shipment, printableBoxes));
  printWindow.document.close();
  printWindow.opener = null;

  window.setTimeout(() => {
    if (printWindow.closed) return;
    printWindow.focus();
    printWindow.print();
  }, 300);
  return true;
};

const getShipmentDateMeta = (value) => {
  const date = parseUtcLocal(value);
  if (!date) {
    return { key: "undated", label: "Date not available" };
  }

  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  return {
    key,
    label: date.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
};

const cleanNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const errorText = (error, fallback) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.message ||
  fallback;

const isOrderShipped = (order) =>
  String(order?.status || "").trim().toLowerCase() === "shipped";

const getOrderReadiness = (order) => {
  if (isOrderShipped(order)) return { state: "shipped", shortageQuantity: 0 };

  const shortageQuantity = (order?.pick_plan || []).reduce(
    (total, line) => total + Number(line.shortage_quantity || 0),
    0
  );

  if (shortageQuantity > 0) return { state: "shortage", shortageQuantity };
  if (!order?.label_file_url) return { state: "label", shortageQuantity: 0 };
  return { state: "ready", shortageQuantity: 0 };
};

const readinessLabel = {
  ready: "Ready",
  label: "Need label",
  shortage: "Short stock",
  shipped: "Shipped",
};

const normalizeStatusText = (value) => String(value || "").trim().toLowerCase();

const isShipmentReceived = (shipment) =>
  normalizeStatusText(shipment?.status) === "received" || Boolean(shipment?.received_at);

const getShipmentStatusKey = (shipment) => {
  const status = normalizeStatusText(shipment?.status);
  if (status === "canceled") return "canceled";
  if (isShipmentReceived(shipment)) return "received";
  if (status.includes("received") || status === "delivered") return "partial";
  return "transit";
};

const getShipmentReceiptState = (shipment) => {
  const received = isShipmentReceived(shipment);
  return {
    received,
    adminReceived: received || Boolean(shipment?.admin_received_at),
    fulfillmentReceived: received || Boolean(shipment?.fulfillment_received_at),
  };
};

const getOrderSkuCount = (order) =>
  (order?.items || []).filter((item) => Number(item.quantity || 0) > 0).length;

const getOrderBoxCount = (order) => {
  const boxKeys = new Set();
  const addPickBox = (pick) => {
    const key = pick?.box_id || pick?.box_number || pick?.box_item_id;
    if (key) boxKeys.add(String(key));
  };

  if (isOrderShipped(order)) {
    (order?.picks || []).forEach(addPickBox);
  } else {
    (order?.pick_plan || []).forEach((line) =>
      (line?.picks || []).forEach(addPickBox)
    );
  }

  return boxKeys.size;
};

const orderMatchesSearch = (order, query) => {
  if (!query) return true;
  return [
    order.fulfillment_order_no,
    order.customer_name,
    order.platform,
    order.ship_to,
    ...(order.items || []).map((item) => item.article_no),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
};

function Icon({ name, size = 18 }) {
  const paths = {
    box: (
      <>
        <path d="m3 7 9 5 9-5" />
        <path d="M12 12v9" />
        <path d="m5 5 7-3 7 3 2 2v10l-9 5-9-5V7l2-2Z" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="18" cy="19" r="2" />
      </>
    ),
    order: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </>
    ),
    warehouse: (
      <>
        <path d="M3 20V9l9-5 9 5v11" />
        <path d="M7 20v-7h10v7" />
        <path d="M9 16h6" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    locate: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    merge: (
      <>
        <path d="M7 7h10" />
        <path d="m14 4 3 3-3 3" />
        <path d="M17 17H7" />
        <path d="m10 14-3 3 3 3" />
      </>
    ),
    print: (
      <>
        <path d="M7 9V3h10v6" />
        <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
        <path d="M7 14h10v7H7z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    warning: (
      <>
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="fulfillment-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name] || paths.box}
    </svg>
  );
}

function Fulfillment({
  userRole = "admin",
  initialTab = "orders",
  onWarehouseTabChange = null,
}) {
  const isWarehouseUser = userRole === "warehouse";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [dashboard, setDashboard] = useState({
    stats: {},
    shipments: [],
    orders: [],
    inventory: [],
    inventoryLocations: [],
    discrepancies: [],
  });
  const [products, setProducts] = useState([]);
  const [shipmentForm, setShipmentForm] = useState(createShipmentForm);
  const [printLabelsAfterSend, setPrintLabelsAfterSend] = useState(true);
  const [orderForm, setOrderForm] = useState(createOrderForm);
  const [loading, setLoading] = useState(true);
  const [savingShipment, setSavingShipment] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [shippingOrderId, setShippingOrderId] = useState(null);
  const [receivingShipmentKey, setReceivingShipmentKey] = useState(null);
  const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [notice, setNotice] = useState(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("unfulfilled");
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [locationDrafts, setLocationDrafts] = useState({});
  const [savingLocationId, setSavingLocationId] = useState(null);
  const [mergeDrafts, setMergeDrafts] = useState({});
  const [mergingBoxId, setMergingBoxId] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [shipmentStatusFilter, setShipmentStatusFilter] = useState("all");
  const [selectedShipmentId, setSelectedShipmentId] = useState(null);
  const [selectedBoxId, setSelectedBoxId] = useState(null);
  const [selectedInventoryProductId, setSelectedInventoryProductId] = useState(null);
  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = useState(false);
  const [discrepancyForm, setDiscrepancyForm] = useState(createDiscrepancyForm);
  const [savingDiscrepancy, setSavingDiscrepancy] = useState(false);

  useEffect(() => {
    const tabSyncId = window.setTimeout(() => setActiveTab(initialTab), 0);
    return () => window.clearTimeout(tabSyncId);
  }, [initialTab]);

  useEffect(() => {
    const modalIsOpen =
      isOrderModalOpen || isShipmentModalOpen || isDiscrepancyModalOpen;
    if (!modalIsOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeActiveModal = (event) => {
      if (event.key !== "Escape") return;
      if (isDiscrepancyModalOpen) setIsDiscrepancyModalOpen(false);
      else if (isShipmentModalOpen) setIsShipmentModalOpen(false);
      else setIsOrderModalOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeActiveModal);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeActiveModal);
    };
  }, [isDiscrepancyModalOpen, isOrderModalOpen, isShipmentModalOpen]);

  const loadFulfillment = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [dashboardResponse, productsResponse] = await Promise.all([
        api.get("/fulfillment/dashboard"),
        isWarehouseUser ? Promise.resolve({ data: [] }) : api.get("/products"),
      ]);
      setDashboard({
        stats: dashboardResponse.data?.stats || {},
        shipments: Array.isArray(dashboardResponse.data?.shipments)
          ? dashboardResponse.data.shipments
          : [],
        orders: Array.isArray(dashboardResponse.data?.orders)
          ? dashboardResponse.data.orders
          : [],
        inventory: Array.isArray(dashboardResponse.data?.inventory)
          ? dashboardResponse.data.inventory
          : [],
        inventoryLocations: Array.isArray(dashboardResponse.data?.inventory_locations)
          ? dashboardResponse.data.inventory_locations
          : [],
        discrepancies: Array.isArray(dashboardResponse.data?.discrepancies)
          ? dashboardResponse.data.discrepancies
          : [],
      });
      setProducts(Array.isArray(productsResponse.data) ? productsResponse.data : []);
    } catch (error) {
      console.error("Fulfillment loading error:", error);
      setNotice({
        type: "error",
        text: "Fulfillment data could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, [isWarehouseUser]);

  useEffect(() => {
    const loadId = window.setTimeout(() => loadFulfillment({ quiet: true }), 0);
    return () => window.clearTimeout(loadId);
  }, [loadFulfillment]);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const productOptions = useMemo(
    () =>
      [...products].sort((a, b) =>
        String(a.article_no || "").localeCompare(String(b.article_no || ""))
      ),
    [products]
  );

  const shipmentSourceStockField =
    String(shipmentForm.source_stock || "Factory").toLowerCase() === "usa"
      ? "usa_stock"
      : "factory_stock";
  const shipmentSourceStockLabel =
    shipmentSourceStockField === "usa_stock" ? "USA stock" : "Factory stock";

  const getProductById = useCallback(
    (productId) => {
      if (!productId) return null;
      return productsById.get(productId) || productsById.get(Number(productId)) || null;
    },
    [productsById]
  );

  const getProductSourceStock = (product) =>
    Number(product?.[shipmentSourceStockField] || 0);

  const fulfillmentTabs = useMemo(
    () => [
      {
        key: "orders",
        label: isWarehouseUser ? "Dispatch orders" : "Order queue",
        hint: isWarehouseUser ? "Pick, pack, and dispatch" : "Review fulfillment readiness",
        icon: "order",
      },
      {
        key: "shipments",
        label: isWarehouseUser ? "Inbound shipments" : "Shipments",
        hint: isWarehouseUser ? "Confirm warehouse receipts" : "Send and reconcile stock",
        icon: "truck",
      },
      {
        key: "inventory",
        label: "Warehouse stock",
        hint: "Boxes, locations, and exceptions",
        icon: "warehouse",
      },
    ],
    [isWarehouseUser]
  );

  const selectTab = (tab) => {
    setActiveTab(tab);
    if (isWarehouseUser && onWarehouseTabChange) {
      onWarehouseTabChange(tab);
    }
  };

  const filteredOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return dashboard.orders.filter((order) => {
      const readiness = getOrderReadiness(order);
      const status = String(order.status || "").toLowerCase();
      const shipped = status === "shipped";
      const matchesStatus =
        orderStatusFilter === "all" ||
        (orderStatusFilter === "shipped" && shipped) ||
        (orderStatusFilter === "unfulfilled" && !shipped) ||
        (!shipped && orderStatusFilter === readiness.state);
      if (!matchesStatus) return false;
      return orderMatchesSearch(order, query);
    });
  }, [dashboard.orders, orderSearch, orderStatusFilter]);

  const dispatchedHistoryOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return [...(dashboard.orders || [])]
      .filter((order) => isOrderShipped(order) && orderMatchesSearch(order, query))
      .sort(
        (a, b) =>
          new Date(b.shipped_at || b.updated_at || b.created_at || 0).getTime() -
          new Date(a.shipped_at || a.updated_at || a.created_at || 0).getTime()
      );
  }, [dashboard.orders, orderSearch]);

  const queueStats = useMemo(() => {
    const orders = dashboard.orders || [];
    const unfulfilled = orders.filter((order) => !isOrderShipped(order));
    return {
      ready: unfulfilled.filter((order) => getOrderReadiness(order).state === "ready")
        .length,
      label: unfulfilled.filter((order) => getOrderReadiness(order).state === "label")
        .length,
      shortage: unfulfilled.filter(
        (order) => getOrderReadiness(order).state === "shortage"
      ).length,
      shipped: orders.filter((order) => isOrderShipped(order)).length,
      unfulfilled: unfulfilled.length,
    };
  }, [dashboard.orders]);

  const queueFilters = useMemo(
    () => [
      ["ready", "Ready", queueStats.ready],
      ["label", "Need label", queueStats.label],
      ["shortage", "Short stock", queueStats.shortage],
    ],
    [queueStats.label, queueStats.ready, queueStats.shortage]
  );

  const inventoryByProduct = useMemo(() => {
    const grouped = new Map();
    dashboard.inventory.forEach((item) => {
      const existing = grouped.get(item.product_id) || {
        product_id: item.product_id,
        article_no: item.article_no,
        product_name: item.product_name,
        available_quantity: 0,
        boxes: [],
      };
      existing.available_quantity += Number(item.available_quantity || 0);
      existing.boxes.push(item);
      grouped.set(item.product_id, existing);
    });
    return [...grouped.values()].sort((a, b) =>
      String(a.article_no || "").localeCompare(String(b.article_no || ""))
    );
  }, [dashboard.inventory]);

  const filteredInventoryGroups = useMemo(() => {
    const query = stockSearch.trim().toLowerCase();
    if (!query) return inventoryByProduct;

    return inventoryByProduct.filter((group) =>
      [
        group.article_no,
        group.product_name,
        ...(group.boxes || []).map((item) => item.box_number),
        ...(group.boxes || []).map((item) => item.location),
        ...(group.boxes || []).map((item) => item.shipment_no),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [inventoryByProduct, stockSearch]);

  const boxStockRows = useMemo(() => {
    return (dashboard.shipments || [])
      .flatMap((shipment) =>
        (shipment.boxes || []).map((box) => ({
          ...box,
          shipment_id: shipment.id,
          shipment_no: shipment.shipment_no,
          status: shipment.status,
          destination_name: shipment.destination_name,
          source_stock: shipment.source_stock,
          sent_at: shipment.sent_at,
          admin_received_at: shipment.admin_received_at,
          fulfillment_received_at: shipment.fulfillment_received_at,
          received_at: shipment.received_at,
        }))
      )
      .filter((box) => isShipmentReceived(box) && Number(box.available_units || 0) > 0)
      .sort((a, b) =>
        String(a.box_number || "").localeCompare(String(b.box_number || ""))
      );
  }, [dashboard.shipments]);

  const boxStockUnits = useMemo(
    () =>
      boxStockRows.reduce(
        (total, box) => total + Number(box.available_units || 0),
        0
      ),
    [boxStockRows]
  );

  const shipmentRows = useMemo(() => {
    return [...(dashboard.shipments || [])].sort(
      (a, b) =>
        (parseUtcLocal(b.sent_at)?.getTime() || 0) -
        (parseUtcLocal(a.sent_at)?.getTime() || 0)
    );
  }, [dashboard.shipments]);

  const shipmentStats = useMemo(() => {
    const shipments = dashboard.shipments || [];
    return {
      inTransit: shipments.filter((shipment) => !isShipmentReceived(shipment)).length,
      received: shipments.filter((shipment) => isShipmentReceived(shipment)).length,
    };
  }, [dashboard.shipments]);

  const commandMetrics = useMemo(() => {
    if (isWarehouseUser) {
      return [
        {
          label: "Active orders",
          value: queueStats.unfulfilled,
          help: "Waiting for dispatch",
          icon: "order",
          tone: "blue",
        },
        {
          label: "In transit",
          value: shipmentStats.inTransit,
          help: "Awaiting receipt",
          icon: "truck",
          tone: "amber",
        },
        {
          label: "Stock boxes",
          value: boxStockRows.length,
          help: "Active warehouse boxes",
          icon: "box",
          tone: "violet",
        },
        {
          label: "Box units",
          value: boxStockUnits,
          help: "Available to fulfill",
          icon: "warehouse",
          tone: "green",
        },
      ];
    }

    return [
      {
        label: "Ready",
        value: queueStats.ready,
        help: "Orders ready to ship",
        icon: "check",
        tone: "green",
      },
      {
        label: "In transit",
        value: shipmentStats.inTransit,
        help: "Shipments en route",
        icon: "truck",
        tone: "amber",
      },
      {
        label: "Dispatched",
        value: dispatchedHistoryOrders.length,
        help: "Completed orders",
        icon: "order",
        tone: "blue",
      },
      {
        label: "Box units",
        value: boxStockUnits,
        help: "Available to fulfill",
        icon: "warehouse",
        tone: "violet",
      },
    ];
  }, [
    boxStockRows.length,
    boxStockUnits,
    dispatchedHistoryOrders.length,
    isWarehouseUser,
    queueStats.ready,
    queueStats.unfulfilled,
    shipmentStats.inTransit,
  ]);

  const inTransitShipmentRows = useMemo(
    () => shipmentRows.filter((shipment) => !isShipmentReceived(shipment)),
    [shipmentRows]
  );

  const receivedShipmentRows = useMemo(
    () => shipmentRows.filter((shipment) => isShipmentReceived(shipment)),
    [shipmentRows]
  );

  const filteredBoxStockRows = useMemo(() => {
    const query = stockSearch.trim().toLowerCase();
    if (!query) return boxStockRows;

    return boxStockRows.filter((box) =>
      [
        box.box_number,
        getBoxTrackingId(box),
        box.location,
        box.shipment_no,
        box.destination_name,
        box.source_stock,
        ...(box.items || []).map((item) => item.article_no),
        ...(box.items || []).map((item) => item.product_name),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [boxStockRows, stockSearch]);

  const selectedOrder = useMemo(
    () =>
      filteredOrders.find((order) => order.id === selectedOrderId) ||
      filteredOrders[0] ||
      null,
    [filteredOrders, selectedOrderId]
  );

  const shipmentViewRows = useMemo(() => {
    const statusRows =
      shipmentStatusFilter === "received"
        ? receivedShipmentRows
        : shipmentStatusFilter === "all"
          ? shipmentRows
          : inTransitShipmentRows;
    const query = shipmentSearch.trim().toLowerCase();
    if (!query) return statusRows;

    return statusRows.filter((shipment) =>
      [
        shipment.shipment_no,
        shipment.destination_name,
        shipment.source_stock,
        shipment.status,
        ...(shipment.boxes || []).map((box) => box.box_number),
        ...(shipment.boxes || []).map((box) =>
          getBoxTrackingId(box, shipment.shipment_no)
        ),
        ...(shipment.boxes || []).flatMap((box) =>
          (box.items || []).flatMap((item) => [item.article_no, item.product_name])
        ),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [
    inTransitShipmentRows,
    receivedShipmentRows,
    shipmentSearch,
    shipmentRows,
    shipmentStatusFilter,
  ]);

  const selectedShipment = useMemo(
    () =>
      shipmentViewRows.find((shipment) => shipment.id === selectedShipmentId) ||
      shipmentViewRows[0] ||
      null,
    [selectedShipmentId, shipmentViewRows]
  );

  const shipmentDateGroups = useMemo(() => {
    const groups = [];
    const groupsByDate = new Map();

    shipmentViewRows.forEach((shipment) => {
      const date = getShipmentDateMeta(shipment.sent_at);
      let group = groupsByDate.get(date.key);
      if (!group) {
        group = { ...date, shipments: [] };
        groupsByDate.set(date.key, group);
        groups.push(group);
      }
      group.shipments.push(shipment);
    });

    return groups;
  }, [shipmentViewRows]);

  const selectedBox = useMemo(
    () =>
      filteredBoxStockRows.find((box) => box.id === selectedBoxId) ||
      filteredBoxStockRows[0] ||
      null,
    [filteredBoxStockRows, selectedBoxId]
  );

  const selectedBoxTargetOptions = useMemo(
    () =>
      selectedBox
        ? boxStockRows.filter((targetBox) => targetBox.id !== selectedBox.id)
        : [],
    [boxStockRows, selectedBox]
  );

  const selectedInventoryGroup = useMemo(
    () =>
      filteredInventoryGroups.find(
        (group) => group.product_id === selectedInventoryProductId
      ) ||
      filteredInventoryGroups[0] ||
      null,
    [filteredInventoryGroups, selectedInventoryProductId]
  );

  const shipmentTotals = useMemo(() => {
    const boxes = shipmentForm.boxes.length;
    const units = shipmentForm.boxes.reduce(
      (total, box) =>
        total +
        box.items.reduce(
          (itemTotal, item) => itemTotal + Math.max(Number(item.quantity || 0), 0),
          0
        ),
      0
    );
    return { boxes, units };
  }, [shipmentForm.boxes]);

  const shipmentSkuTotals = useMemo(() => {
    const totals = new Map();
    shipmentForm.boxes.forEach((box) => {
      box.items.forEach((item) => {
        if (!item.product_id) return;
        const key = String(item.product_id);
        const quantity = Math.max(Number(item.quantity || 0), 0);
        totals.set(key, (totals.get(key) || 0) + quantity);
      });
    });
    return totals;
  }, [shipmentForm.boxes]);

  const updateShipmentField = (field, value) => {
    setShipmentForm((current) => ({ ...current, [field]: value }));
  };

  const updateShipmentBox = (boxIndex, field, value) => {
    setShipmentForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, index) =>
        index === boxIndex ? { ...box, [field]: value } : box
      ),
    }));
  };

  const addShipmentBox = () => {
    setShipmentForm((current) => ({
      ...current,
      boxes: [...current.boxes, createShipmentBox(current.boxes.length + 1)],
    }));
  };

  const removeShipmentBox = (boxIndex) => {
    setShipmentForm((current) => ({
      ...current,
      boxes:
        current.boxes.length === 1
          ? current.boxes
          : current.boxes.filter((_, index) => index !== boxIndex),
    }));
  };

  const updateShipmentItem = (boxIndex, itemIndex, field, value) => {
    setShipmentForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, currentBoxIndex) =>
        currentBoxIndex === boxIndex
          ? {
              ...box,
              items: box.items.map((item, currentItemIndex) =>
                currentItemIndex === itemIndex ? { ...item, [field]: value } : item
              ),
            }
          : box
      ),
    }));
  };

  const addShipmentItem = (boxIndex) => {
    setShipmentForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, index) =>
        index === boxIndex
          ? { ...box, items: [...box.items, createShipmentItem()] }
          : box
      ),
    }));
  };

  const removeShipmentItem = (boxIndex, itemIndex) => {
    setShipmentForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, currentBoxIndex) =>
        currentBoxIndex === boxIndex
          ? {
              ...box,
              items:
                box.items.length === 1
                  ? box.items
                  : box.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex),
            }
          : box
      ),
    }));
  };

  const updateOrderField = (field, value) => {
    setOrderForm((current) => ({ ...current, [field]: value }));
  };

  const updateOrderItem = (itemIndex, field, value) => {
    setOrderForm((current) => ({
      ...current,
      items: current.items.map((item, index) =>
        index === itemIndex ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addOrderItem = () => {
    setOrderForm((current) => ({
      ...current,
      items: [...current.items, createOrderItem()],
    }));
  };

  const removeOrderItem = (itemIndex) => {
    setOrderForm((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, index) => index !== itemIndex),
    }));
  };

  const submitShipment = async (event) => {
    event.preventDefault();
    setSavingShipment(true);
    setNotice(null);
    let preparedLabelWindow = null;

    try {
      const boxes = shipmentForm.boxes.map((box) => ({
        box_number: box.box_number.trim(),
        weight_kg: cleanNumber(box.weight_kg),
        length_cm: cleanNumber(box.length_cm),
        width_cm: cleanNumber(box.width_cm),
        height_cm: cleanNumber(box.height_cm),
        location: box.location.trim() || null,
        notes: box.notes.trim() || null,
        items: box.items.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Math.max(Number(item.quantity || 0), 0),
        })),
      }));

      if (
        boxes.some(
          (box) =>
            !box.box_number ||
            box.items.some((item) => !item.product_id || item.quantity <= 0)
        )
      ) {
        throw new Error("Every box row needs a box number, SKU, and quantity.");
      }

      if (printLabelsAfterSend) {
        preparedLabelWindow = prepareBoxLabelWindow();
      }

      const response = await api.post("/fulfillment/shipments", {
        shipment_no: shipmentForm.shipment_no.trim() || null,
        destination_name: shipmentForm.destination_name.trim() || null,
        source_stock: shipmentForm.source_stock,
        notes: shipmentForm.notes.trim() || null,
        boxes,
      });
      const createdShipment = response.data;
      const labelsOpened = printLabelsAfterSend
        ? printBoxLabels(
            createdShipment,
            createdShipment.boxes || [],
            preparedLabelWindow
          )
        : false;

      setShipmentForm(createShipmentForm());
      setIsShipmentModalOpen(false);
      setNotice({
        type: "success",
        text: printLabelsAfterSend
          ? labelsOpened
            ? "Shipment sent. Box labels opened for printing."
            : "Shipment sent. Labels are ready—allow pop-ups and use Print all labels."
          : "Shipment sent. Box labels are ready in shipment details.",
      });
      await loadFulfillment({ quiet: true });
      setActiveTab("shipments");
      setShipmentStatusFilter("all");
      setSelectedShipmentId(createdShipment.id);
    } catch (error) {
      if (preparedLabelWindow && !preparedLabelWindow.closed) {
        preparedLabelWindow.close();
      }
      setNotice({
        type: "error",
        text: errorText(error, "Shipment could not be created."),
      });
    } finally {
      setSavingShipment(false);
    }
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    setSavingOrder(true);
    setNotice(null);

    try {
      const items = orderForm.items.map((item) => ({
        product_id: Number(item.product_id),
        quantity: Math.max(Number(item.quantity || 0), 0),
      }));
      if (items.some((item) => !item.product_id || item.quantity <= 0)) {
        throw new Error("Every order row needs a SKU and quantity.");
      }

      const formData = new FormData();
      formData.append("fulfillment_order_no", orderForm.fulfillment_order_no.trim());
      formData.append("customer_name", orderForm.customer_name.trim());
      formData.append("platform", orderForm.platform.trim());
      formData.append("ship_to", orderForm.ship_to.trim());
      formData.append("notes", orderForm.notes.trim());
      formData.append("items_json", JSON.stringify(items));
      if (orderForm.label_file) {
        formData.append("label_file", orderForm.label_file);
      }

      await api.post("/fulfillment/orders", formData);
      setOrderForm(createOrderForm());
      setIsOrderModalOpen(false);
      setNotice({ type: "success", text: "Fulfillment order added." });
      await loadFulfillment({ quiet: true });
      setActiveTab("orders");
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(error, "Fulfillment order could not be added."),
      });
    } finally {
      setSavingOrder(false);
    }
  };

  const shipOrder = async (order) => {
    setShippingOrderId(order.id);
    setNotice(null);
    try {
      await api.patch(`/fulfillment/orders/${order.id}/ship`);
      setNotice({
        type: "success",
        text: `${order.fulfillment_order_no} marked shipped.`,
      });
      await loadFulfillment({ quiet: true });
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(error, "Order could not be shipped."),
      });
    } finally {
      setShippingOrderId(null);
    }
  };

  const uploadOrderLabel = async (orderId, file) => {
    if (!file) return;
    setNotice(null);
    const formData = new FormData();
    formData.append("label_file", file);
    try {
      await api.post(`/fulfillment/orders/${orderId}/label`, formData);
      setNotice({ type: "success", text: "Label file updated." });
      await loadFulfillment({ quiet: true });
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(error, "Label file could not be uploaded."),
      });
    }
  };

  const handlePrintBoxLabels = (shipment, boxes = shipment?.boxes || []) => {
    const opened = printBoxLabels(shipment, boxes);
    if (!opened) {
      setNotice({
        type: "error",
        text: "Labels could not open. Allow pop-ups for the ERP and try again.",
      });
    }
  };

  const receiveShipment = async (shipment, party) => {
    const receiptKey = `${shipment.id}-${party}`;
    setReceivingShipmentKey(receiptKey);
    setNotice(null);
    try {
      await api.post(`/fulfillment/shipments/${shipment.id}/receive`, { party });
      setNotice({
        type: "success",
        text:
          party === "admin"
            ? `${shipment.shipment_no} marked as delivered.`
            : `${shipment.shipment_no} receipt confirmed.`,
      });
      await loadFulfillment({ quiet: true });
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(
          error,
          party === "admin"
            ? "Shipment could not be marked as delivered."
            : "Shipment receipt could not be confirmed."
        ),
      });
    } finally {
      setReceivingShipmentKey(null);
    }
  };

  const updateLocationDraft = (boxId, value) => {
    setLocationDrafts((current) => ({ ...current, [boxId]: value }));
  };

  const saveBoxLocation = async (box) => {
    setSavingLocationId(box.id);
    setNotice(null);
    try {
      const location = locationDrafts[box.id] ?? box.location ?? "";
      await api.patch(`/fulfillment/boxes/${box.id}/location`, {
        location: location.trim() || null,
      });
      setNotice({
        type: "success",
        text: `${getBoxTrackingId(box)} location saved.`,
      });
      await loadFulfillment({ quiet: true });
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(error, "Box location could not be saved."),
      });
    } finally {
      setSavingLocationId(null);
    }
  };

  const updateMergeDraft = (boxId, field, value) => {
    setMergeDrafts((current) => ({
      ...current,
      [boxId]: {
        ...(current[boxId] || {}),
        [field]: value,
      },
    }));
  };

  const mergeBox = async (box) => {
    const draft = mergeDrafts[box.id] || {};
    const targetBoxId = Number(draft.target_box_id || 0);
    if (!targetBoxId) {
      setNotice({ type: "error", text: "Choose a target box to merge into." });
      return;
    }

    setMergingBoxId(box.id);
    setNotice(null);
    try {
      await api.post("/fulfillment/boxes/merge", {
        source_box_id: box.id,
        target_box_id: targetBoxId,
        note: (draft.note || "").trim() || null,
      });
      setMergeDrafts((current) => {
        const next = { ...current };
        delete next[box.id];
        return next;
      });
      setNotice({
        type: "success",
        text: `${getBoxTrackingId(box)} merged.`,
      });
      await loadFulfillment({ quiet: true });
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(error, "Boxes could not be merged."),
      });
    } finally {
      setMergingBoxId(null);
    }
  };

  const openDiscrepancyForm = (boxItem) => {
    setDiscrepancyForm(createDiscrepancyForm(boxItem?.id));
    setIsDiscrepancyModalOpen(true);
  };

  const updateDiscrepancyField = (field, value) => {
    setDiscrepancyForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "reason") {
        next.direction = discrepancyDirectionForReason(value, current.direction);
      }
      return next;
    });
  };

  const submitDiscrepancy = async (event) => {
    event.preventDefault();
    const boxItemId = Number(discrepancyForm.box_item_id || 0);
    const quantity = Math.max(Number(discrepancyForm.quantity || 0), 0);
    if (!boxItemId || quantity <= 0) {
      setNotice({ type: "error", text: "Choose box stock and enter a quantity." });
      return;
    }

    setSavingDiscrepancy(true);
    setNotice(null);
    try {
      await api.post("/fulfillment/inventory/discrepancies", {
        box_item_id: boxItemId,
        reason: discrepancyForm.reason,
        direction: discrepancyForm.direction,
        quantity,
        reference: discrepancyForm.reference.trim() || null,
        notes: discrepancyForm.notes.trim() || null,
      });
      setIsDiscrepancyModalOpen(false);
      setDiscrepancyForm(createDiscrepancyForm());
      setNotice({
        type: "success",
        text: "Fulfillment discrepancy recorded and box stock updated.",
      });
      await loadFulfillment({ quiet: true });
    } catch (error) {
      setNotice({
        type: "error",
        text: errorText(error, "Discrepancy could not be recorded."),
      });
    } finally {
      setSavingDiscrepancy(false);
    }
  };

  const renderDiscrepancyForm = () => {
    const selectedBoxItem = (dashboard.inventoryLocations || []).find(
      (item) => String(item.id) === String(discrepancyForm.box_item_id)
    );
    const isCountCorrection = discrepancyForm.reason === "Count correction";
    const isRemoving = discrepancyForm.direction === "remove";

    return (
      <form
        className="fulfillment-panel fulfillment-form-panel fulfillment-entry-modal"
        onSubmit={submitDiscrepancy}
      >
        <div className="fulfillment-panel-header">
          <div>
            <h2 id="discrepancy-modal-title">Record inventory discrepancy</h2>
            <p>Damage, missing units, returns, recovered stock, or count correction</p>
          </div>
          <div className="fulfillment-modal-actions">
            <button
              className="fulfillment-primary-button"
              disabled={savingDiscrepancy}
              type="submit"
            >
              <Icon name="warning" />
              {savingDiscrepancy ? "Saving..." : "Save discrepancy"}
            </button>
            <button
              className="fulfillment-secondary-action"
              onClick={() => setIsDiscrepancyModalOpen(false)}
              type="button"
            >
              <Icon name="close" />
              Close
            </button>
          </div>
        </div>

        <div className="fulfillment-form-grid">
          <label className="fulfillment-wide-field">
            Fulfillment box stock
            <select
              onChange={(event) =>
                updateDiscrepancyField("box_item_id", event.target.value)
              }
              required
              value={discrepancyForm.box_item_id}
            >
              <option value="">Choose SKU and box...</option>
              {(dashboard.inventoryLocations || []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.article_no} / {getBoxTrackingId(item)} / {item.shipment_no} / {formatNumber(item.available_quantity)} available
                </option>
              ))}
            </select>
          </label>
          <label>
            What happened
            <select
              onChange={(event) => updateDiscrepancyField("reason", event.target.value)}
              value={discrepancyForm.reason}
            >
              {DISCREPANCY_REASONS.map(([reason]) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
          </label>
          <label>
            Inventory effect
            <select
              disabled={!isCountCorrection}
              onChange={(event) =>
                updateDiscrepancyField("direction", event.target.value)
              }
              value={discrepancyForm.direction}
            >
              <option value="remove">Remove from available</option>
              <option value="add">Add to available</option>
            </select>
          </label>
          <label>
            Quantity
            <input
              max={isRemoving ? Number(selectedBoxItem?.available_quantity || 0) : undefined}
              min="1"
              onChange={(event) =>
                updateDiscrepancyField("quantity", event.target.value)
              }
              required
              type="number"
              value={discrepancyForm.quantity}
            />
          </label>
          <label>
            Reference
            <input
              onChange={(event) =>
                updateDiscrepancyField("reference", event.target.value)
              }
              placeholder="Order, return, claim, or shipment no"
              value={discrepancyForm.reference}
            />
          </label>
          <label className="fulfillment-wide-field">
            Notes
            <textarea
              onChange={(event) => updateDiscrepancyField("notes", event.target.value)}
              placeholder="Condition, receiving details, return status, or count explanation"
              value={discrepancyForm.notes}
            />
          </label>
        </div>
        <p className="fulfillment-discrepancy-impact">
          {selectedBoxItem
            ? `${selectedBoxItem.article_no} in ${getBoxTrackingId(selectedBoxItem)}: ${formatNumber(selectedBoxItem.available_quantity)} available before this entry.`
            : "Choose the exact received box so fulfillment picking stays accurate."}
        </p>
      </form>
    );
  };

  const renderOrderForm = () => (
    <form
      className="fulfillment-panel fulfillment-form-panel fulfillment-entry-modal"
      onSubmit={submitOrder}
    >
      <div className="fulfillment-panel-header">
        <div>
          <h2 id="order-modal-title">Add fulfillment order</h2>
          <p>Order items and label file</p>
        </div>
        <div className="fulfillment-modal-actions">
          <button
            className="fulfillment-primary-button"
            disabled={savingOrder}
            type="submit"
          >
            <Icon name="plus" />
            {savingOrder ? "Saving..." : "Add order"}
          </button>
          <button
            className="fulfillment-secondary-action"
            onClick={() => setIsOrderModalOpen(false)}
            type="button"
          >
            <Icon name="close" />
            Close
          </button>
        </div>
      </div>
      <div className="fulfillment-form-grid">
        <label>
          Order no
          <input
            onChange={(event) =>
              updateOrderField("fulfillment_order_no", event.target.value)
            }
            placeholder="Auto"
            value={orderForm.fulfillment_order_no}
          />
        </label>
        <label>
          Customer
          <input
            onChange={(event) => updateOrderField("customer_name", event.target.value)}
            placeholder="Customer or marketplace buyer"
            value={orderForm.customer_name}
          />
        </label>
        <label>
          Platform
          <input
            onChange={(event) => updateOrderField("platform", event.target.value)}
            placeholder="Amazon, Shopify, Manual..."
            value={orderForm.platform}
          />
        </label>
        <label>
          Label file
          <input
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.txt,.csv,.xls,.xlsx,.doc,.docx,.zip,.btw"
            onChange={(event) =>
              updateOrderField("label_file", event.target.files?.[0] || null)
            }
            type="file"
          />
        </label>
        <label className="fulfillment-wide-field">
          Ship to
          <textarea
            onChange={(event) => updateOrderField("ship_to", event.target.value)}
            placeholder="Delivery name, address, or fulfillment reference"
            value={orderForm.ship_to}
          />
        </label>
        <label className="fulfillment-wide-field">
          Notes
          <textarea
            onChange={(event) => updateOrderField("notes", event.target.value)}
            placeholder="Packing notes"
            value={orderForm.notes}
          />
        </label>
      </div>

      <div className="fulfillment-lines">
        <div className="fulfillment-lines-header">
          <strong>SKU quantities</strong>
          <button onClick={addOrderItem} type="button">
            <Icon name="plus" />
            Add SKU
          </button>
        </div>
        {orderForm.items.map((item, index) => (
          <div className="fulfillment-line" key={`order-item-${index}`}>
            <select
              aria-label="Order SKU"
              onChange={(event) => updateOrderItem(index, "product_id", event.target.value)}
              required
              value={item.product_id}
            >
              <option value="">Select SKU</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.article_no} - {product.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Order quantity"
              min="1"
              onChange={(event) => updateOrderItem(index, "quantity", event.target.value)}
              required
              type="number"
              value={item.quantity}
            />
            <button
              aria-label="Remove order SKU"
              onClick={() => removeOrderItem(index)}
              type="button"
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </form>
  );

  const renderShipmentForm = () => (
    <form
      className="fulfillment-panel fulfillment-form-panel fulfillment-entry-modal"
      onSubmit={submitShipment}
    >
      <div className="fulfillment-panel-header">
        <div>
          <h2 id="shipment-modal-title">Create / send shipment</h2>
          <p>
            {formatNumber(shipmentTotals.boxes)} boxes,{" "}
            {formatNumber(shipmentTotals.units)} units
          </p>
        </div>
        <div className="fulfillment-modal-actions">
          <button
            className="fulfillment-primary-button"
            disabled={savingShipment}
            type="submit"
          >
            <Icon name="truck" />
            {savingShipment
              ? "Sending..."
              : printLabelsAfterSend
                ? "Send & print labels"
                : "Send shipment"}
          </button>
          <button
            className="fulfillment-secondary-action"
            onClick={() => setIsShipmentModalOpen(false)}
            type="button"
          >
            <Icon name="close" />
            Close
          </button>
        </div>
      </div>

      <div className="fulfillment-form-grid">
        <label>
          Shipment no
          <input
            onChange={(event) => updateShipmentField("shipment_no", event.target.value)}
            placeholder="Auto"
            value={shipmentForm.shipment_no}
          />
        </label>
        <label>
          Destination
          <input
            onChange={(event) =>
              updateShipmentField("destination_name", event.target.value)
            }
            value={shipmentForm.destination_name}
          />
        </label>
        <label>
          Source stock
          <select
            onChange={(event) => updateShipmentField("source_stock", event.target.value)}
            value={shipmentForm.source_stock}
          >
            <option value="Factory">Factory stock</option>
            <option value="USA">USA stock</option>
          </select>
        </label>
        <label className="fulfillment-wide-field">
          Notes
          <textarea
            onChange={(event) => updateShipmentField("notes", event.target.value)}
            placeholder="Shipment reference, carrier, or receiving notes"
            value={shipmentForm.notes}
          />
        </label>
      </div>

      <label className="fulfillment-print-option">
        <input
          checked={printLabelsAfterSend}
          onChange={(event) => setPrintLabelsAfterSend(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Print box labels after sending</strong>
          <small>Opens one scannable 4 × 6 label for every box.</small>
        </span>
      </label>

      <div className="fulfillment-box-editor">
        {shipmentForm.boxes.map((box, boxIndex) => (
          <section className="fulfillment-box-form" key={`box-${boxIndex}`}>
            <div className="fulfillment-box-form-header">
              <strong>Box {box.box_number || boxIndex + 1}</strong>
              <button onClick={() => removeShipmentBox(boxIndex)} type="button">
                <Icon name="close" />
              </button>
            </div>
            <div className="fulfillment-form-grid is-box-grid">
              <label>
                Box no
                <input
                  onChange={(event) =>
                    updateShipmentBox(boxIndex, "box_number", event.target.value)
                  }
                  required
                  value={box.box_number}
                />
              </label>
              <label>
                Weight kg
                <input
                  min="0"
                  onChange={(event) =>
                    updateShipmentBox(boxIndex, "weight_kg", event.target.value)
                  }
                  step="0.01"
                  type="number"
                  value={box.weight_kg}
                />
              </label>
              <label>
                L cm
                <input
                  min="0"
                  onChange={(event) =>
                    updateShipmentBox(boxIndex, "length_cm", event.target.value)
                  }
                  step="0.1"
                  type="number"
                  value={box.length_cm}
                />
              </label>
              <label>
                W cm
                <input
                  min="0"
                  onChange={(event) =>
                    updateShipmentBox(boxIndex, "width_cm", event.target.value)
                  }
                  step="0.1"
                  type="number"
                  value={box.width_cm}
                />
              </label>
              <label>
                H cm
                <input
                  min="0"
                  onChange={(event) =>
                    updateShipmentBox(boxIndex, "height_cm", event.target.value)
                  }
                  step="0.1"
                  type="number"
                  value={box.height_cm}
                />
              </label>
              <label>
                Location
                <input
                  onChange={(event) =>
                    updateShipmentBox(boxIndex, "location", event.target.value)
                  }
                  placeholder="Aisle / shelf / bin"
                  value={box.location}
                />
              </label>
            </div>
            <div className="fulfillment-lines">
              <div className="fulfillment-lines-header">
                <strong>Box SKUs</strong>
                <button onClick={() => addShipmentItem(boxIndex)} type="button">
                  <Icon name="plus" />
                  Add SKU
                </button>
              </div>
              {box.items.map((item, itemIndex) => {
                const selectedProduct = getProductById(item.product_id);
                const selectedKey = selectedProduct
                  ? String(selectedProduct.id)
                  : String(item.product_id || "");
                const sourceStock = getProductSourceStock(selectedProduct);
                const shipmentSkuTotal = shipmentSkuTotals.get(selectedKey) || 0;
                const remainingStock = Math.max(sourceStock - shipmentSkuTotal, 0);
                const isOverSourceStock =
                  Boolean(selectedProduct) && shipmentSkuTotal > sourceStock;

                return (
                  <div
                    className="fulfillment-line"
                    key={`box-${boxIndex}-item-${itemIndex}`}
                  >
                    <select
                      aria-label="Shipment SKU"
                      onChange={(event) =>
                        updateShipmentItem(
                          boxIndex,
                          itemIndex,
                          "product_id",
                          event.target.value
                        )
                      }
                      required
                      value={item.product_id}
                    >
                      <option value="">Select SKU</option>
                      {productOptions.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.article_no} - {product.name} |{" "}
                          {shipmentSourceStockLabel}:{" "}
                          {formatNumber(getProductSourceStock(product))} | F{" "}
                          {formatNumber(product.factory_stock)} / USA{" "}
                          {formatNumber(product.usa_stock)}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Shipment quantity"
                      min="1"
                      onChange={(event) =>
                        updateShipmentItem(
                          boxIndex,
                          itemIndex,
                          "quantity",
                          event.target.value
                        )
                      }
                      required
                      type="number"
                      value={item.quantity}
                    />
                    <button
                      aria-label="Remove shipment SKU"
                      onClick={() => removeShipmentItem(boxIndex, itemIndex)}
                      type="button"
                    >
                      <Icon name="close" />
                    </button>
                    {selectedProduct && (
                      <div
                        className={`fulfillment-stock-hint ${
                          isOverSourceStock ? "is-warning" : ""
                        }`.trim()}
                      >
                        <span>
                          <strong>{shipmentSourceStockLabel}</strong>{" "}
                          {formatNumber(sourceStock)}
                        </span>
                        <span>
                          Factory {formatNumber(selectedProduct.factory_stock)} / USA{" "}
                          {formatNumber(selectedProduct.usa_stock)} / Reserved{" "}
                          {formatNumber(selectedProduct.reserved_stock)}
                        </span>
                        <span>
                          {isOverSourceStock
                            ? `Over stock by ${formatNumber(
                                shipmentSkuTotal - sourceStock
                              )}`
                            : `After shipment ${formatNumber(remainingStock)} left`}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <button className="fulfillment-secondary-button" onClick={addShipmentBox} type="button">
          <Icon name="plus" />
          Add box
        </button>
      </div>
    </form>
  );

  const renderModal = (titleId, content, onClose) =>
    createPortal(
      <div
        className="fulfillment-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="fulfillment-modal-shell"
          role="dialog"
        >
          {content}
        </div>
      </div>,
      document.body
    );

  const renderOrderDetail = () => {
    if (!selectedOrder) {
      return (
        <div className="fulfillment-detail-empty">
          <Icon name="order" size={24} />
          <strong>No order selected</strong>
          <span>Select an order.</span>
        </div>
      );
    }

    const isShipped = isOrderShipped(selectedOrder);
    const readiness = getOrderReadiness(selectedOrder);
    const shortages = (selectedOrder.pick_plan || []).filter(
      (line) => Number(line.shortage_quantity || 0) > 0
    );
    const canShip =
      !isShipped && shortages.length === 0 && Boolean(selectedOrder.label_file_url);

    return (
      <>
        <div className="fulfillment-detail-title">
          <span
            className={`fulfillment-status is-${
              isShipped ? "shipped" : readiness.state
            }`}
          >
            {readinessLabel[isShipped ? "shipped" : readiness.state]}
          </span>
          <h2>{selectedOrder.fulfillment_order_no}</h2>
          <p>
            {selectedOrder.customer_name ||
              selectedOrder.platform ||
              "Fulfillment order"}
          </p>
        </div>

        <div className="fulfillment-detail-grid">
          <span>
            <small>Units</small>
            <strong>{formatNumber(selectedOrder.total_units)}</strong>
          </span>
          <span>
            <small>SKUs</small>
            <strong>{formatNumber(getOrderSkuCount(selectedOrder))}</strong>
          </span>
          <span>
            <small>Boxes</small>
            <strong>{formatNumber(getOrderBoxCount(selectedOrder))}</strong>
          </span>
        </div>

        <section className="fulfillment-detail-section">
          <div className="fulfillment-detail-section-head">
            <h3>Dispatch</h3>
          </div>
          <div className="fulfillment-action-row">
            {selectedOrder.label_file_url ? (
              <a
                className="fulfillment-file-link"
                href={getStaticUrl(selectedOrder.label_file_url)}
                rel="noreferrer"
                target="_blank"
              >
                <Icon name="file" />
                {selectedOrder.label_file_name || "Download label"}
              </a>
            ) : (
              <span className="fulfillment-muted">
                {isWarehouseUser ? "Waiting for admin label" : "No label uploaded"}
              </span>
            )}
            {!isWarehouseUser && (
              <label className="fulfillment-upload-button">
                Upload
                <input
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.txt,.csv,.xls,.xlsx,.doc,.docx,.zip,.btw"
                  onChange={(event) =>
                    uploadOrderLabel(selectedOrder.id, event.target.files?.[0])
                  }
                  type="file"
                />
              </label>
            )}
            {!isShipped && (
              <button
                className="fulfillment-primary-button"
                disabled={shippingOrderId === selectedOrder.id || !canShip}
                onClick={() => shipOrder(selectedOrder)}
                type="button"
              >
                <Icon name="check" />
                {shippingOrderId === selectedOrder.id ? "Shipping..." : "Mark shipped"}
              </button>
            )}
          </div>
          {!isShipped && !canShip && (
            <div className="fulfillment-blockers">
              {!selectedOrder.label_file_url && (
                <span>
                  {isWarehouseUser
                    ? "Admin label upload pending."
                    : "Upload a label before shipping."}
                </span>
              )}
              {shortages.length > 0 && <span>Resolve stock shortages before shipping.</span>}
            </div>
          )}
        </section>

        {selectedOrder.ship_to && (
          <section className="fulfillment-detail-section">
            <div className="fulfillment-detail-section-head">
              <h3>Address</h3>
            </div>
            <p className="fulfillment-address">{selectedOrder.ship_to}</p>
          </section>
        )}

        <section className="fulfillment-detail-section">
          <div className="fulfillment-detail-section-head">
            <h3>{isShipped ? "Picked" : "Items"}</h3>
          </div>
          <div className="fulfillment-pick-table">
            <div className="fulfillment-pick-head">
              <span>SKU</span>
              <span>{isShipped ? "Box" : "Needed"}</span>
              <span>{isShipped ? "Shipment" : "Pick"}</span>
              <span>{isShipped ? "Qty" : "State"}</span>
            </div>
            {isShipped
              ? (selectedOrder.picks || []).map((pick) => (
                  <div className="fulfillment-pick-row" key={pick.id}>
                    <span>
                      <strong>{pick.article_no}</strong>
                      <small>{pick.product_name}</small>
                    </span>
                    <span>
                      {getBoxTrackingId(pick)}
                      {pick.location ? <small>{pick.location}</small> : null}
                    </span>
                    <span>{pick.shipment_no}</span>
                    <span>{formatNumber(pick.quantity)}</span>
                  </div>
                ))
              : (selectedOrder.pick_plan || []).map((line) => (
                  <div className="fulfillment-pick-row" key={line.product_id}>
                    <span>
                      <strong>{line.article_no}</strong>
                      <small>{line.product_name}</small>
                    </span>
                    <span>{formatNumber(line.required_quantity)}</span>
                    <span className="fulfillment-box-pills">
                      {line.picks.length === 0 ? (
                        <em>No box</em>
                      ) : (
                        line.picks.map((pick) => (
                          <b key={`${line.product_id}-${pick.box_item_id}`}>
                            {getBoxTrackingId(pick)}: {formatNumber(pick.quantity)}
                            {pick.location ? <small>{pick.location}</small> : null}
                          </b>
                        ))
                      )}
                    </span>
                    <span>
                      {line.shortage_quantity > 0 ? (
                        <span className="fulfillment-warning">
                          Short {formatNumber(line.shortage_quantity)}
                        </span>
                      ) : (
                        <span className="fulfillment-ready">Ready</span>
                      )}
                    </span>
                  </div>
                ))}
          </div>
        </section>
      </>
    );
  };

  const renderShipmentDetail = () => {
    if (!selectedShipment) {
      return (
        <div className="fulfillment-detail-empty">
          <Icon name="truck" size={24} />
          <strong>No shipment selected</strong>
          <span>Select a shipment.</span>
        </div>
      );
    }

    const receiptState = getShipmentReceiptState(selectedShipment);
    const receiptParty = isWarehouseUser ? "fulfillment" : "admin";
    const partyReceived =
      receiptParty === "admin"
        ? receiptState.adminReceived
        : receiptState.fulfillmentReceived;
    const receiptKey = `${selectedShipment.id}-${receiptParty}`;
    const isReceiving = receivingShipmentKey === receiptKey;

    return (
      <>
        <div className="fulfillment-detail-title">
          <span className={`fulfillment-status is-${getShipmentStatusKey(selectedShipment)}`}>
            {selectedShipment.status}
          </span>
          <h2>{selectedShipment.shipment_no}</h2>
          <p>{selectedShipment.destination_name || "Fulfillment center"}</p>
        </div>

        <div className="fulfillment-detail-grid">
          <span>
            <small>Units</small>
            <strong>{formatNumber(selectedShipment.total_units)}</strong>
          </span>
          <span>
            <small>Boxes</small>
            <strong>{formatNumber(selectedShipment.carton_count)}</strong>
          </span>
          <span>
            <small>Source</small>
            <strong>{selectedShipment.source_stock}</strong>
          </span>
        </div>

        <section className="fulfillment-detail-section">
          <div className="fulfillment-detail-section-head">
            <h3>Delivery confirmation</h3>
          </div>
          <div className="fulfillment-receipt-steps">
            <span className={receiptState.adminReceived ? "is-done" : ""}>
              <Icon name="check" size={14} />
              ERP delivered
              <small>
                {selectedShipment.admin_received_at
                  ? formatUtcLocal(selectedShipment.admin_received_at)
                  : receiptState.adminReceived
                    ? "Delivered"
                    : "Pending"}
              </small>
            </span>
            <span className={receiptState.fulfillmentReceived ? "is-done" : ""}>
              <Icon name="warehouse" size={14} />
              Fulfillment received
              <small>
                {selectedShipment.fulfillment_received_at
                  ? formatUtcLocal(selectedShipment.fulfillment_received_at)
                  : receiptState.fulfillmentReceived
                    ? "Confirmed"
                    : "Pending"}
              </small>
            </span>
          </div>
          <button
            className="fulfillment-primary-button is-wide"
            disabled={isReceiving || partyReceived || receiptState.received}
            onClick={() => receiveShipment(selectedShipment, receiptParty)}
            type="button"
          >
            <Icon name="check" />
            {isReceiving
              ? isWarehouseUser
                ? "Confirming..."
                : "Marking delivered..."
              : partyReceived || receiptState.received
                ? isWarehouseUser
                  ? "Confirmed"
                  : "Delivered"
                : isWarehouseUser
                  ? "Confirm fulfillment received"
                  : "Mark as delivered"}
          </button>
        </section>

        <section className="fulfillment-detail-section">
          <div className="fulfillment-detail-section-head">
            <h3>Boxes</h3>
            <button
              className="fulfillment-secondary-action fulfillment-print-all"
              onClick={() => handlePrintBoxLabels(selectedShipment)}
              type="button"
            >
              <Icon name="print" size={14} />
              Print all labels
            </button>
          </div>
          <div className="fulfillment-box-table">
            {(selectedShipment.boxes || []).map((box) => (
              <div className="fulfillment-box-row has-label-print" key={box.id}>
                <span>
                  <strong>{getBoxTrackingId(box, selectedShipment.shipment_no)}</strong>
                  <small>
                    Carton {box.box_number} · {box.location || "No location"}
                  </small>
                </span>
                <span>{formatNumber(box.total_units)} units</span>
                <span>{formatNumber(box.available_units || box.total_units)} available</span>
                <button
                  aria-label={`Print label for ${getBoxTrackingId(
                    box,
                    selectedShipment.shipment_no
                  )}`}
                  className="fulfillment-box-label-button"
                  onClick={() => handlePrintBoxLabels(selectedShipment, [box])}
                  title="Print this box label"
                  type="button"
                >
                  <Icon name="print" size={14} />
                  Print
                </button>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  };

  const renderInventoryDetail = () => {
    if (isWarehouseUser) {
      if (!selectedBox) {
        return (
          <div className="fulfillment-detail-empty">
            <Icon name="box" size={24} />
            <strong>No box selected</strong>
            <span>Select a box.</span>
          </div>
        );
      }

      const mergeDraft = mergeDrafts[selectedBox.id] || {};
      const locationValue =
        locationDrafts[selectedBox.id] ?? selectedBox.location ?? "";

      return (
        <>
          <div className="fulfillment-detail-title">
            <span className="fulfillment-status is-received">Stock box</span>
            <h2>{getBoxTrackingId(selectedBox)}</h2>
            <p>
              {selectedBox.shipment_no} · Carton {selectedBox.box_number} ·{" "}
              {selectedBox.source_stock}
            </p>
          </div>
          <div className="fulfillment-detail-grid">
            <span>
              <small>Units</small>
              <strong>{formatNumber(selectedBox.available_units)}</strong>
            </span>
            <span>
              <small>Location</small>
              <strong>{selectedBox.location || "None"}</strong>
            </span>
            <span>
              <small>Sent</small>
              <strong>{formatUtcLocal(selectedBox.sent_at)}</strong>
            </span>
          </div>

          <section className="fulfillment-detail-section">
            <div className="fulfillment-detail-section-head">
              <h3>Location</h3>
            </div>
            <div className="fulfillment-inline-form">
              <label className="fulfillment-location-field">
                <Icon name="locate" />
                <input
                  aria-label={`Location for ${getBoxTrackingId(selectedBox)}`}
                  onChange={(event) =>
                    updateLocationDraft(selectedBox.id, event.target.value)
                  }
                  placeholder="Aisle / shelf / bin"
                  value={locationValue}
                />
              </label>
              <button
                className="fulfillment-secondary-action"
                disabled={savingLocationId === selectedBox.id}
                onClick={() => saveBoxLocation(selectedBox)}
                type="button"
              >
                {savingLocationId === selectedBox.id ? "Saving..." : "Save location"}
              </button>
            </div>
          </section>

          <section className="fulfillment-detail-section">
            <div className="fulfillment-detail-section-head">
              <h3>Merge</h3>
            </div>
            <div className="fulfillment-inline-form is-merge">
              <select
                aria-label={`Merge ${getBoxTrackingId(selectedBox)} into another box`}
                onChange={(event) =>
                  updateMergeDraft(selectedBox.id, "target_box_id", event.target.value)
                }
                value={mergeDraft.target_box_id || ""}
              >
                <option value="">Merge into...</option>
                {selectedBoxTargetOptions.map((targetBox) => (
                  <option key={targetBox.id} value={targetBox.id}>
                    {getBoxTrackingId(targetBox)} / {targetBox.shipment_no} /{" "}
                    {targetBox.location || "No location"} /{" "}
                    {formatNumber(targetBox.available_units)} units
                  </option>
                ))}
              </select>
              <input
                aria-label="Merge note"
                onChange={(event) =>
                  updateMergeDraft(selectedBox.id, "note", event.target.value)
                }
                placeholder="Optional note"
                value={mergeDraft.note || ""}
              />
              <button
                className="fulfillment-secondary-action"
                disabled={
                  mergingBoxId === selectedBox.id ||
                  selectedBoxTargetOptions.length === 0
                }
                onClick={() => mergeBox(selectedBox)}
                type="button"
              >
                <Icon name="merge" />
                {mergingBoxId === selectedBox.id ? "Merging..." : "Merge"}
              </button>
            </div>
          </section>

          <section className="fulfillment-detail-section">
            <div className="fulfillment-detail-section-head">
              <h3>Contents</h3>
            </div>
            <div className="fulfillment-box-item-grid">
              {(selectedBox.items || [])
                .filter((item) => Number(item.available_quantity || 0) > 0)
                .map((item) => (
                  <span key={item.id}>
                    {item.article_no}
                    <strong>{formatNumber(item.available_quantity)}</strong>
                    <small>{item.product_name}</small>
                  </span>
                ))}
            </div>
          </section>
        </>
      );
    }

    if (!selectedInventoryGroup) {
      return (
        <div className="fulfillment-detail-empty">
          <Icon name="inventory" size={24} />
          <strong>No stock selected</strong>
          <span>Select stock.</span>
        </div>
      );
    }

    const product = productsById.get(selectedInventoryGroup.product_id);
    return (
      <>
        <div className="fulfillment-detail-title">
          <span className="fulfillment-status is-received">Box stock</span>
          <h2>{selectedInventoryGroup.article_no}</h2>
          <p>{selectedInventoryGroup.product_name}</p>
        </div>
        <div className="fulfillment-detail-grid">
          <span>
            <small>Fulfillment</small>
            <strong>{formatNumber(selectedInventoryGroup.available_quantity)}</strong>
          </span>
          <span>
            <small>Factory</small>
            <strong>{formatNumber(product?.factory_stock)}</strong>
          </span>
          <span>
            <small>USA</small>
            <strong>{formatNumber(product?.usa_stock)}</strong>
          </span>
        </div>
        <section className="fulfillment-detail-section">
          <div className="fulfillment-detail-section-head">
            <h3>Boxes</h3>
          </div>
          <div className="fulfillment-box-table">
            {selectedInventoryGroup.boxes.map((item) => (
              <div className="fulfillment-box-row" key={item.id}>
                <span>
                  <strong>{getBoxTrackingId(item)}</strong>
                  <small>{item.shipment_no} · Carton {item.box_number}</small>
                </span>
                <span>
                  <strong>{formatNumber(item.available_quantity)}</strong>
                  <small>available units</small>
                </span>
                <span>
                  <strong>{item.location || "No location"}</strong>
                  <small>warehouse location</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  };

  return (
    <div className={`fulfillment-page ${isWarehouseUser ? "is-warehouse-view" : ""}`}>
      <header className="fulfillment-page-header">
        <nav aria-label="Fulfillment status" className="fulfillment-tabs">
          {fulfillmentTabs.map(({ key: tab, label, hint, icon }) => {
            const tabCount =
              tab === "orders"
                ? queueStats.unfulfilled
                : tab === "shipments"
                  ? shipmentStats.inTransit
                  : isWarehouseUser
                    ? boxStockRows.length
                    : inventoryByProduct.length;

            return (
              <button
                aria-current={activeTab === tab ? "page" : undefined}
                className={activeTab === tab ? "is-active" : ""}
                key={tab}
                onClick={() => selectTab(tab)}
                type="button"
              >
                <span className="fulfillment-tab-icon">
                  <Icon name={icon} size={18} />
                </span>
                <span className="fulfillment-tab-copy">
                  <b>{label}</b>
                  <small>{hint}</small>
                </span>
                <strong>{formatNumber(tabCount)}</strong>
              </button>
            );
          })}
        </nav>

        <div className="fulfillment-header-actions">
          {!isWarehouseUser && activeTab === "orders" && (
            <button
              className="fulfillment-primary-button"
              onClick={() => setIsOrderModalOpen(true)}
              type="button"
            >
              <Icon name="plus" />
              Add order
            </button>
          )}
          {!isWarehouseUser && activeTab === "shipments" && (
            <button
              className="fulfillment-primary-button"
              onClick={() => setIsShipmentModalOpen(true)}
              type="button"
            >
              <Icon name="truck" />
              Send shipment
            </button>
          )}
          {activeTab === "inventory" && dashboard.inventoryLocations.length > 0 && (
            <button
              className="fulfillment-primary-button"
              onClick={() => {
                const selectedLocation = isWarehouseUser
                  ? dashboard.inventoryLocations.find(
                      (item) => item.box_id === selectedBox?.id
                    )
                  : dashboard.inventoryLocations.find(
                      (item) =>
                        item.product_id === selectedInventoryGroup?.product_id
                    );
                openDiscrepancyForm(selectedLocation);
              }}
              type="button"
            >
              <Icon name="warning" />
              Record discrepancy
            </button>
          )}
          <button
            aria-controls="fulfillment-header-summary"
            aria-expanded={showSummary}
            className="fulfillment-summary-toggle"
            onClick={() => setShowSummary((current) => !current)}
            type="button"
          >
            {showSummary ? "Hide overview" : "Overview"}
            <span aria-hidden="true" className="fulfillment-toggle-chevron" />
          </button>
        </div>

        {showSummary && (
          <section
            aria-label="Fulfillment overview"
            className="fulfillment-summary-strip"
            id="fulfillment-header-summary"
          >
            {commandMetrics.map((metric) => (
              <button
                className={`fulfillment-summary-card is-${metric.tone}`}
                key={metric.label}
                onClick={() => {
                  if (metric.label === "Ready") {
                    selectTab("orders");
                    setOrderStatusFilter("ready");
                  } else if (metric.label === "In transit") {
                    selectTab("shipments");
                    setShipmentStatusFilter("in-transit");
                  } else if (metric.label === "Dispatched") {
                    selectTab("orders");
                    setOrderStatusFilter("shipped");
                  } else if (
                    metric.label.includes("Box") ||
                    metric.label.includes("Stock")
                  ) {
                    selectTab("inventory");
                  }
                }}
                type="button"
              >
                <span className="fulfillment-summary-icon">
                  <Icon name={metric.icon} size={18} />
                </span>
                <span className="fulfillment-summary-copy">
                  <small>{metric.label}</small>
                  <strong>{formatNumber(metric.value)}</strong>
                  <em>{metric.help}</em>
                </span>
              </button>
            ))}
          </section>
        )}
      </header>

      {notice && (
        <div
          aria-live="polite"
          className={`fulfillment-alert is-${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} type="button">
            Close
          </button>
        </div>
      )}

      {!isWarehouseUser && isOrderModalOpen &&
        renderModal(
          "order-modal-title",
          renderOrderForm(),
          () => setIsOrderModalOpen(false)
        )}
      {!isWarehouseUser && isShipmentModalOpen &&
        renderModal(
          "shipment-modal-title",
          renderShipmentForm(),
          () => setIsShipmentModalOpen(false)
        )}
      {isDiscrepancyModalOpen &&
        renderModal(
          "discrepancy-modal-title",
          renderDiscrepancyForm(),
          () => setIsDiscrepancyModalOpen(false)
        )}

      {loading ? (
        <section className="fulfillment-shell">
          <div className="fulfillment-empty">Loading fulfillment workspace...</div>
        </section>
      ) : (
        <section className="fulfillment-shell">
          {activeTab === "orders" && (
            <div className="fulfillment-workbench">
              <section className="fulfillment-list-pane">
                <div className="fulfillment-pane-head">
                  <div className="fulfillment-pane-intro">
                    <h2>Order queue</h2>
                  </div>
                  <div className="fulfillment-pane-controls">
                    <label className="fulfillment-search">
                      <Icon name="search" />
                      <input
                        aria-label="Search fulfillment orders"
                        onChange={(event) => setOrderSearch(event.target.value)}
                        placeholder="Search order, customer, or SKU"
                        value={orderSearch}
                      />
                    </label>
                    <div className="fulfillment-tools">
                      <span className="fulfillment-result-count">
                        {formatNumber(filteredOrders.length)}{" "}
                        {filteredOrders.length === 1 ? "order" : "orders"}
                      </span>
                      <select
                        aria-label="Filter fulfillment orders"
                        onChange={(event) => setOrderStatusFilter(event.target.value)}
                        value={orderStatusFilter}
                      >
                        <option value="unfulfilled">Unfulfilled</option>
                        <option value="ready">Ready to ship</option>
                        <option value="label">Need label</option>
                        <option value="shortage">Short stock</option>
                        <option value="shipped">Shipped</option>
                        <option value="all">All orders</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="fulfillment-filter-row" aria-label="Order queue">
                  {queueFilters.map(([filter, label, value]) => (
                    <button
                      className={`fulfillment-filter-chip is-${filter} ${
                        orderStatusFilter === filter ? "is-active" : ""
                      }`.trim()}
                      key={filter}
                      onClick={() => setOrderStatusFilter(filter)}
                      type="button"
                    >
                      <strong>{formatNumber(value)}</strong>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="fulfillment-empty">No orders match this view.</div>
                ) : (
                  <div className="fulfillment-data-table is-orders">
                    <div className="fulfillment-table-head">
                      <span>Status</span>
                      <span>Order</span>
                      <span>Units</span>
                      <span>Boxes</span>
                      <span>Label</span>
                    </div>
                    {filteredOrders.map((order) => {
                      const shipped = isOrderShipped(order);
                      const readiness = getOrderReadiness(order);
                      const state = shipped ? "shipped" : readiness.state;
                      const boxCount = getOrderBoxCount(order);
                      return (
                        <button
                          className={`fulfillment-table-row ${
                            selectedOrder?.id === order.id ? "is-selected" : ""
                          }`}
                          key={order.id}
                          onClick={() => setSelectedOrderId(order.id)}
                          type="button"
                        >
                          <span className={`fulfillment-status is-${state}`}>
                            {readinessLabel[state]}
                          </span>
                          <span>
                            <strong>{order.fulfillment_order_no}</strong>
                            <small>
                              {order.customer_name || order.platform || "Fulfillment order"}
                            </small>
                          </span>
                          <span>
                            <strong>{formatNumber(order.total_units)}</strong>
                            <small>{formatNumber(getOrderSkuCount(order))} SKUs</small>
                          </span>
                          <span>
                            <strong>{boxCount ? formatNumber(boxCount) : "Pending"}</strong>
                            <small>{shipped ? "Picked" : "Planned"}</small>
                          </span>
                          <span>
                            <strong>{order.label_file_url ? "Ready" : "Missing"}</strong>
                            <small>{order.platform || "-"}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <aside className="fulfillment-detail-pane" aria-label="Order detail">
                {renderOrderDetail()}
              </aside>
            </div>
          )}

          {activeTab === "shipments" && (
            <div className="fulfillment-workbench">
              <section className="fulfillment-list-pane">
                <div className="fulfillment-pane-head">
                  <div className="fulfillment-pane-intro">
                    <h2>Shipments</h2>
                  </div>
                  <div className="fulfillment-pane-controls">
                    <label className="fulfillment-search">
                      <Icon name="search" />
                      <input
                        aria-label="Search fulfillment shipments"
                        onChange={(event) => setShipmentSearch(event.target.value)}
                        placeholder="Search shipment, box, or SKU"
                        value={shipmentSearch}
                      />
                    </label>
                    <div className="fulfillment-tools">
                      <span className="fulfillment-filter-label">Filter</span>
                      <div
                        className="fulfillment-segmented"
                        aria-label="Filter shipments by status"
                        role="group"
                      >
                        <button
                          className={shipmentStatusFilter === "in-transit" ? "is-active" : ""}
                          onClick={() => setShipmentStatusFilter("in-transit")}
                          type="button"
                        >
                          In transit
                          <strong>{formatNumber(shipmentStats.inTransit)}</strong>
                        </button>
                        <button
                          className={shipmentStatusFilter === "received" ? "is-active" : ""}
                          onClick={() => setShipmentStatusFilter("received")}
                          type="button"
                        >
                          Received
                          <strong>{formatNumber(shipmentStats.received)}</strong>
                        </button>
                        <button
                          className={shipmentStatusFilter === "all" ? "is-active" : ""}
                          onClick={() => setShipmentStatusFilter("all")}
                          type="button"
                        >
                          All
                          <strong>{formatNumber(shipmentRows.length)}</strong>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {shipmentViewRows.length === 0 ? (
                  <div className="fulfillment-empty">No shipments in this view.</div>
                ) : (
                  <div className="fulfillment-data-table is-shipments">
                    <div className="fulfillment-table-head">
                      <span>Status</span>
                      <span>Shipment</span>
                      <span>Units</span>
                      <span>Boxes</span>
                      <span>Sent</span>
                    </div>
                    {shipmentDateGroups.map((group) => (
                      <section className="fulfillment-shipment-date-group" key={group.key}>
                        <div className="fulfillment-shipment-date-heading">
                          <strong>{group.label}</strong>
                          <span>
                            {formatNumber(group.shipments.length)}{" "}
                            {group.shipments.length === 1 ? "shipment" : "shipments"}
                          </span>
                        </div>
                        {group.shipments.map((shipment) => (
                          <button
                            className={`fulfillment-table-row ${
                              selectedShipment?.id === shipment.id ? "is-selected" : ""
                            }`}
                            key={shipment.id}
                            onClick={() => setSelectedShipmentId(shipment.id)}
                            type="button"
                          >
                            <span
                              className={`fulfillment-status is-${getShipmentStatusKey(shipment)}`}
                            >
                              {shipment.status}
                            </span>
                            <span>
                              <strong>{shipment.shipment_no}</strong>
                              <small>{shipment.destination_name || "Fulfillment center"}</small>
                            </span>
                            <span>
                              <strong>{formatNumber(shipment.total_units)}</strong>
                              <small>{shipment.source_stock}</small>
                            </span>
                            <span>
                              <strong>{formatNumber(shipment.carton_count)}</strong>
                              <small>cartons</small>
                            </span>
                            <span>
                              <strong>{formatUtcLocal(shipment.sent_at)}</strong>
                              <small>{isShipmentReceived(shipment) ? "Received" : "Waiting"}</small>
                            </span>
                          </button>
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </section>

              <aside className="fulfillment-detail-pane" aria-label="Shipment detail">
                {renderShipmentDetail()}
              </aside>
            </div>
          )}

          {activeTab === "inventory" && (
            <>
              <div className="fulfillment-workbench">
              <section className="fulfillment-list-pane">
                <div className="fulfillment-pane-head">
                  <div className="fulfillment-pane-intro">
                    <h2>{isWarehouseUser ? "Active boxes" : "Inventory"}</h2>
                  </div>
                  <div className="fulfillment-pane-controls">
                    <label className="fulfillment-search">
                      <Icon name="search" />
                      <input
                        aria-label="Search fulfillment inventory"
                        onChange={(event) => setStockSearch(event.target.value)}
                        placeholder="Search SKU, box, shipment, or location"
                        value={stockSearch}
                      />
                    </label>
                    <span className="fulfillment-result-count">
                      {isWarehouseUser
                        ? `${formatNumber(filteredBoxStockRows.length)} boxes`
                        : `${formatNumber(filteredInventoryGroups.length)} SKUs`}
                    </span>
                  </div>
                </div>

                {isWarehouseUser ? (
                  filteredBoxStockRows.length === 0 ? (
                    <div className="fulfillment-empty">No active box stock found.</div>
                  ) : (
                    <div className="fulfillment-data-table is-boxes">
                      <div className="fulfillment-table-head">
                        <span>Box ID</span>
                        <span>Units</span>
                        <span>Location</span>
                        <span>Shipment</span>
                      </div>
                      {filteredBoxStockRows.map((box) => (
                        <button
                          className={`fulfillment-table-row ${
                            selectedBox?.id === box.id ? "is-selected" : ""
                          }`}
                          key={box.id}
                          onClick={() => setSelectedBoxId(box.id)}
                          type="button"
                        >
                          <span>
                            <strong>{getBoxTrackingId(box)}</strong>
                            <small>Carton {box.box_number} · {box.source_stock}</small>
                          </span>
                          <span>
                            <strong>{formatNumber(box.available_units)}</strong>
                            <small>available</small>
                          </span>
                          <span>
                            <strong>{box.location || "No location"}</strong>
                            <small>warehouse shelf</small>
                          </span>
                          <span>
                            <strong>{box.shipment_no}</strong>
                            <small>{formatUtcLocal(box.sent_at)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                ) : filteredInventoryGroups.length === 0 ? (
                  <div className="fulfillment-empty">No fulfillment box stock available.</div>
                ) : (
                  <div className="fulfillment-data-table is-stock">
                    <div className="fulfillment-table-head">
                      <span>SKU</span>
                      <span>Fulfillment</span>
                      <span>Boxes</span>
                      <span>ERP stock</span>
                    </div>
                    {filteredInventoryGroups.map((group) => {
                      const product = productsById.get(group.product_id);
                      return (
                        <button
                          className={`fulfillment-table-row ${
                            selectedInventoryGroup?.product_id === group.product_id
                              ? "is-selected"
                              : ""
                          }`}
                          key={group.product_id}
                          onClick={() => setSelectedInventoryProductId(group.product_id)}
                          type="button"
                        >
                          <span>
                            <strong>{group.article_no}</strong>
                            <small>{group.product_name}</small>
                          </span>
                          <span>
                            <strong>{formatNumber(group.available_quantity)}</strong>
                            <small>units</small>
                          </span>
                          <span>
                            <strong>{formatNumber(group.boxes.length)}</strong>
                            <small>boxes</small>
                          </span>
                          <span>
                            <strong>
                              {formatNumber(product?.factory_stock)} / {formatNumber(product?.usa_stock)}
                            </strong>
                            <small>factory / USA</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

                <aside className="fulfillment-detail-pane" aria-label="Stock detail">
                  {renderInventoryDetail()}
                </aside>
              </div>

              <section
                aria-label="Fulfillment inventory discrepancy history"
                className="fulfillment-discrepancy-history"
              >
                <div className="fulfillment-discrepancy-history-head">
                  <div>
                    <h2>Discrepancy history</h2>
                    <p>Damage, missing units, returns, recoveries, and count corrections</p>
                  </div>
                  <span>{formatNumber(dashboard.discrepancies.length)} entries</span>
                </div>
                {dashboard.discrepancies.length === 0 ? (
                  <div className="fulfillment-empty">No fulfillment discrepancies recorded.</div>
                ) : (
                  <div className="fulfillment-discrepancy-table">
                    {dashboard.discrepancies.slice(0, 20).map((entry) => {
                      const delta = Number(entry.quantity_delta || 0);
                      return (
                        <div className="fulfillment-discrepancy-row" key={entry.id}>
                          <span>
                            <strong>{entry.reason}</strong>
                            <small>{entry.article_no} / {getBoxTrackingId(entry)}</small>
                          </span>
                          <strong className={delta >= 0 ? "is-add" : "is-remove"}>
                            {delta > 0 ? "+" : ""}{formatNumber(delta)}
                          </strong>
                          <span>
                            <strong>{formatNumber(entry.available_before)} -&gt; {formatNumber(entry.available_after)}</strong>
                            <small>available before / after</small>
                          </span>
                          <span>
                            <strong>{entry.reference || entry.shipment_no}</strong>
                            <small>{entry.notes || "No note"}</small>
                          </span>
                          <span>
                            <strong>{entry.created_by_name || "ERP user"}</strong>
                            <small>{formatUtcLocal(entry.created_at)}</small>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export default Fulfillment;
