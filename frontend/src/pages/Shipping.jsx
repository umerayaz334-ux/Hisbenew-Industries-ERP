import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import api, { API_BASE_URL, apiFetch, getAuthHeaders, getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import {
  COPY_STYLE_FIELDS,
  DEFAULT_LOCAL_PRINT_BRIDGE_URL,
  applyLabelDesignToItem,
  createLabelPrinterItemForProduct,
  fetchLocalPrinterBridge,
  getBarcodeHeightScale,
  getInitialLocalPrintBridgeUrl,
  getInitialPrinterConnectionMode,
  getLabelPrintCount,
  getLayerAlignment,
  getLayerOffset,
  getLayerOrder,
  getPrinterApiError,
  normalizeApiBaseUrl,
  pickLabelFields,
  readLabelPrinterSettings,
  shouldUseLocalPrinterBridgeByDefault,
} from "../utils/labelPrintUtils";
import "./Shipping.css";

function Icon({ name, size = 18 }) {
  const paths = {
    package: (
      <>
        <path d="m3 7 9 5 9-5M12 12v9" />
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
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    money: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M7 9H6M18 15h-1" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    phone: (
      <>
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.6a2 2 0 0 1-.5 2.1L9 10.7a16 16 0 0 0 4.3 4.3l1.3-1.3a2 2 0 0 1 2.1-.5c.8.4 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z" />
      </>
    ),
    location: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    print: (
      <>
        <path d="M6 9V3h12v6" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v7H6z" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="shipping-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

const getCategoryQuantitySummary = (items = []) => {
  const quantityByCategory = new Map();

  items.forEach((item) => {
    const category = String(item.category || "").trim() || "Uncategorized";
    const quantity = Number(item.quantity || 0);
    if (!quantity) return;
    quantityByCategory.set(
      category,
      (quantityByCategory.get(category) || 0) + quantity
    );
  });

  return Array.from(quantityByCategory.entries())
    .map(([category, quantity]) => `${quantity} ${category}`)
    .join(", ");
};

const getProductInitials = (articleNo, productName) =>
  String(articleNo || productName || "PR")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
const ShippingBarcodePreview = ({ value, height, scale = 1, heightScale = 1 }) => {
  const barcodeRef = useRef(null);

  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, String(value || "LABEL"), {
        format: "CODE128",
        width: Math.max(0.8, 1.2 * Number(scale || 1)),
        height: height * Number(scale || 1) * Number(heightScale || 1),
        margin: 0,
        displayValue: false,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      barcodeRef.current.innerHTML = "";
    }
  }, [height, heightScale, scale, value]);

  return <svg aria-label={`Barcode ${value || "label"}`} ref={barcodeRef} role="img" />;
};

const ShippingLabelPreview = ({ item, size }) => {
  const width = Number(size?.width || 50);
  const height = Number(size?.height || 25);
  const scale = Math.min(5.4, 360 / width, 300 / height);
  const previewWidth = Math.max(180, width * scale);
  const previewHeight = Math.max(90, height * scale);
  const compact = height <= 30;
  const textBaseSize = Math.max(9, Math.min(18, height * 0.42));
  const independentTextBaseSize = Math.max(9, Math.min(18, textBaseSize * 1.3));
  const barcodeHeight = Math.max(20, Math.min(54, previewHeight * (compact ? 0.21 : 0.19)));
  const barcodeScale = Math.max(0.55, Math.min(1.6, Number(item.barcodeScale || 1)));
  const barcodeHeightScale = getBarcodeHeightScale(item);
  const sku = item.sku || item.subtitle || item.barcode || "LABEL";

  const renderLayer = (layerId) => {
    if (layerId === "brand") {
      return item.showBrand && item.brand ? (
        <span className={`shipping-label-preview-brand is-align-${item.brandAlign || "left"}`}>{item.brand}</span>
      ) : null;
    }
    if (layerId === "title") {
      return (
        <strong className={`shipping-label-preview-title is-align-${item.titleAlign || "left"}`}>
          {item.title || "Untitled label"}
        </strong>
      );
    }
    if (layerId === "price") {
      return item.showPrice && item.price ? (
        <span className={`shipping-label-preview-price is-align-${item.priceAlign || "left"}`}>{item.price}</span>
      ) : null;
    }
    if (layerId === "image") {
      return item.showImage && item.imageUrl ? (
        <div className="shipping-label-preview-image"><img alt="" src={getStaticUrl(item.imageUrl)} /></div>
      ) : null;
    }
    if (layerId === "barcode") {
      return item.showBarcode ? (
        <div className="shipping-label-preview-barcode">
          <ShippingBarcodePreview height={barcodeHeight} heightScale={barcodeHeightScale} scale={barcodeScale} value={item.barcode} />
        </div>
      ) : null;
    }
    if (layerId === "sku") {
      return item.showBarcode ? (
        <small className={`shipping-label-preview-sku is-align-${item.skuAlign || "center"}`}>{sku}</small>
      ) : null;
    }
    return null;
  };

  return (
    <article
      className={`shipping-label-preview ${compact ? "is-compact" : ""} ${item.showImage ? "has-image" : ""}`}
      style={{
        "--label-preview-width": `${previewWidth}px`,
        "--label-preview-height": `${previewHeight}px`,
        "--label-brand-size": `${Math.max(7, independentTextBaseSize * 0.48 * Number(item.brandScale || 1))}px`,
        "--label-title-size": `${Math.max(9, Math.min(18, textBaseSize * Number(item.titleScale || 1)))}px`,
        "--label-sku-size": `${Math.max(9, independentTextBaseSize * 0.78 * Number(item.skuScale || 1))}px`,
        "--label-price-size": `${Math.max(7, independentTextBaseSize * 0.62 * Number(item.priceScale || 1))}px`,
        "--barcode-scale": barcodeScale,
        "--barcode-height-scale": barcodeHeightScale,
      }}
    >
      {getLayerOrder(item).map((layerId) => {
        const layer = renderLayer(layerId);
        if (!layer) return null;
        return (
          <div
            className={`shipping-label-preview-layer is-align-${getLayerAlignment(item, layerId)}`}
            key={layerId}
            style={{ "--layer-offset": `${getLayerOffset(item, layerId) * scale}px` }}
          >
            {layer}
          </div>
        );
      })}
    </article>
  );
};

const getOrderShippingPhone = (order) =>
  String(order?.shipping_phone || order?.order_contact_phone || order?.customer_phone || "")
    .trim();

const formatCompactAddress = (value) =>
  String(value || "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

const formatShippingWeight = (value) =>
  Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 3 });

const formatShippingRate = (value) =>
  `PKR ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function Shipping({ userRole }) {
  const confirmDialog = useConfirmDialog();
  const [pendingOrders, setPendingOrders] = useState([]);
  const [shippingRecords, setShippingRecords] = useState([]);
  const [formData, setFormData] = useState({});
  const [editData, setEditData] = useState({});
  const [processingOrderId, setProcessingOrderId] = useState(null);
  const [updatingShippingId, setUpdatingShippingId] = useState(null);
  const [editingShippingId, setEditingShippingId] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState(() => new Set());
  const [rateCard, setRateCard] = useState(null);
  const [uploadingRateSheet, setUploadingRateSheet] = useState(false);
  const [weightEdits, setWeightEdits] = useState({});
  const [savingWeightOrderId, setSavingWeightOrderId] = useState(null);
  const [labelPrintDraft, setLabelPrintDraft] = useState(null);
  const [labelPrinterOptions, setLabelPrinterOptions] = useState([]);
  const [labelPrinterStatus, setLabelPrinterStatus] = useState({ loading: false, error: "" });
  const [labelDirectPrinter, setLabelDirectPrinter] = useState("");
  const [labelPrinterConnectionMode, setLabelPrinterConnectionMode] = useState(getInitialPrinterConnectionMode);
  const [labelLocalPrintBridgeUrl, setLabelLocalPrintBridgeUrl] = useState(getInitialLocalPrintBridgeUrl);
  const [labelDirectPrinting, setLabelDirectPrinting] = useState(false);

  const loadShippingData = async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    setLoadError("");

    try {
      const [pendingResponse, historyResponse, rateCardResponse] = await Promise.all([
        apiFetch(`${API_BASE_URL}/shipping/pending`),
        apiFetch(`${API_BASE_URL}/shipping`),
        apiFetch(`${API_BASE_URL}/shipping/usa-rate-card`),
      ]);

      if (!pendingResponse.ok || !historyResponse.ok || !rateCardResponse.ok) {
        throw new Error("Shipping data could not be loaded.");
      }

      const [pendingData, historyData, rateCardData] = await Promise.all([
        pendingResponse.json(),
        historyResponse.json(),
        rateCardResponse.json(),
      ]);

      setPendingOrders(Array.isArray(pendingData) ? pendingData : []);
      setShippingRecords(Array.isArray(historyData) ? historyData : []);
      setRateCard(rateCardData);
    } catch (error) {
      console.error("Shipping data loading error:", error);
      setLoadError("Unable to load shipping data. Check the backend and try again.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;

    Promise.all([
      apiFetch(`${API_BASE_URL}/shipping/pending`),
      apiFetch(`${API_BASE_URL}/shipping`),
      apiFetch(`${API_BASE_URL}/shipping/usa-rate-card`),
    ])
      .then(async ([pendingResponse, historyResponse, rateCardResponse]) => {
        if (!pendingResponse.ok || !historyResponse.ok || !rateCardResponse.ok) {
          throw new Error("Shipping data could not be loaded.");
        }
        return Promise.all([
          pendingResponse.json(),
          historyResponse.json(),
          rateCardResponse.json(),
        ]);
      })
      .then(([pendingData, historyData, rateCardData]) => {
        if (!active) return;
        setPendingOrders(Array.isArray(pendingData) ? pendingData : []);
        setShippingRecords(Array.isArray(historyData) ? historyData : []);
        setRateCard(rateCardData);
        setLoadError("");
      })
      .catch((error) => {
        console.error("Shipping data loading error:", error);
        if (active) {
          setLoadError("Unable to load shipping data. Check the backend and try again.");
        }
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const generateWhatsAppMessage = (order) => {
    const itemSummary = getCategoryQuantitySummary(order.items) || "No items";
    const customerName = String(order.customer_name || "No name").trim();
    const shippingPhone = getOrderShippingPhone(order) || "No phone";
    const shippingAddress = String(order.customer_address || "No shipping address")
      .replace(/\r\n/g, "\n")
      .trim();

    return [
      "*\u{1F4E6} Package Details*",
      "",
      `*Items:* ${itemSummary}`,
      "",
      `*Name:* ${customerName}`,
      "",
      `*Phone:* ${shippingPhone}`,
      "",
      "*Shipping Address:*",
      shippingAddress,
      "---------------------------------------------------",
    ].join("\n");
  };

  const shareToWhatsApp = async (order) => {
    const message = generateWhatsAppMessage(order);

    try {
      await navigator.clipboard.writeText(message);

      try {
        await apiFetch(`${API_BASE_URL}/shared-data`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            order_id: order.order_id,
            customer_id: order.customer_id,
            shared_platform: "WhatsApp",
            shared_data: message,
          }),
        });
      } catch (logError) {
        console.error("Error logging shared data:", logError);
      }

      setNotice(`Order ${order.order_no} details copied for WhatsApp.`);
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      setNotice("Order details could not be copied.");
    }
  };

  const usesPrintAgentBridgeForMode = (mode) =>
    mode === "local" && shouldUseLocalPrinterBridgeByDefault();

  const getLabelPrinterStatus = (mode, bridgeUrl) => {
    if (usesPrintAgentBridgeForMode(mode)) return api.get("/print-agent/printers");
    return mode === "local"
      ? fetchLocalPrinterBridge(bridgeUrl, "/local-label-printers")
      : api.get("/label-printers");
  };

  const postLabelPrinterLabels = (mode, bridgeUrl, payload) => {
    if (usesPrintAgentBridgeForMode(mode)) return api.post("/print-agent/print", payload);
    return mode === "local"
      ? fetchLocalPrinterBridge(bridgeUrl, "/local-label-printers/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : api.post("/label-printers/print", payload);
  };

  const loadShippingLabelPrinters = async ({ showNotice = false } = {}) => {
    const nextMode = getInitialPrinterConnectionMode();
    const nextBridgeUrl = getInitialLocalPrintBridgeUrl();
    const nextModeLabel = nextMode === "local" ? usesPrintAgentBridgeForMode(nextMode) ? "This laptop Print Agent" : "This laptop" : "ERP server";

    setLabelPrinterConnectionMode(nextMode);
    setLabelLocalPrintBridgeUrl(nextBridgeUrl);
    setLabelPrinterStatus({ loading: true, error: "" });

    try {
      const response = await getLabelPrinterStatus(nextMode, nextBridgeUrl);
      const printers = Array.isArray(response.data?.printers) ? response.data.printers : [];
      setLabelPrinterOptions(printers);
      setLabelDirectPrinter((current) => {
        if (current && printers.some((printer) => printer.name === current)) return current;
        return response.data?.default_printer || printers.find((printer) => printer.is_default)?.name || printers[0]?.name || "";
      });
      setLabelPrinterStatus({ loading: false, error: "" });
      if (showNotice) {
        const connectedCount = printers.filter((printer) => printer.is_connected).length;
        setNotice(
          printers.length
            ? `${connectedCount} of ${printers.length} label printer${printers.length === 1 ? "" : "s"} connected on ${nextModeLabel}.`
            : `No label printers were found on ${nextModeLabel}.`
        );
      }
    } catch (error) {
      const detail = getPrinterApiError(error, "Printer status could not be checked.");
      setLabelPrinterOptions([]);
      setLabelDirectPrinter("");
      setLabelPrinterStatus({ loading: false, error: detail });
      if (showNotice || nextMode === "local") setNotice(detail);
    }
  };
  const openLabelPrintDialog = (order, item) => {
    const settings = readLabelPrinterSettings();
    const latestDesign = settings.latestSavedDesign?.values ? settings.latestSavedDesign : null;
    const latestDesignLayout = latestDesign ? pickLabelFields(latestDesign.values, COPY_STYLE_FIELDS) : null;
    const product = {
      id: item.product_id || null,
      article_no: item.article_no || "",
      category: item.category || "",
      image_url: item.product_image_url || "",
      name: item.product_name || "",
      selling_price: item.product_selling_price ?? item.unit_price ?? 0,
    };
    const productLabelItem = createLabelPrinterItemForProduct(product, {
      productDesigns: settings.productDesigns,
      quantity: item.quantity,
    });
    const baseLabelItem = latestDesignLayout
      ? { ...applyLabelDesignToItem(productLabelItem, latestDesignLayout), quantity: getLabelPrintCount(item.quantity) }
      : productLabelItem;
    const skuValue = String(item.article_no || baseLabelItem.sku || baseLabelItem.barcode || "").trim();
    const labelItem = {
      ...baseLabelItem,
      articleNo: skuValue || baseLabelItem.articleNo || "",
      sku: skuValue || baseLabelItem.sku || "",
      barcode: skuValue || baseLabelItem.barcode || "LABEL",
    };

    setNotice("");
    setLabelPrintDraft({
      activeSize: settings.activeSize,
      articleNo: item.article_no || "",
      designName: latestDesign?.name || "Saved product layout",
      labelItem,
      orderId: order.order_id,
      orderNo: order.order_no || "",
      printRotation: settings.printRotation,
      productImageUrl: item.product_image_url || "",
      productName: item.product_name || "",
      quantity: getLabelPrintCount(labelItem),
    });
    loadShippingLabelPrinters();
  };

  const updateLabelPrintQuantity = (value) => {
    const quantity = getLabelPrintCount(value);
    setLabelPrintDraft((current) =>
      current
        ? {
            ...current,
            labelItem: { ...current.labelItem, quantity },
            quantity,
          }
        : current
    );
  };

  const adjustLabelPrintQuantity = (delta) => {
    setLabelPrintDraft((current) => {
      if (!current) return current;
      const quantity = getLabelPrintCount(Number(current.quantity || 1) + delta);
      return {
        ...current,
        labelItem: { ...current.labelItem, quantity },
        quantity,
      };
    });
  };

  const printShippingItemLabels = async () => {
    if (!labelPrintDraft) return;
    const quantity = getLabelPrintCount(labelPrintDraft.quantity);
    const size = labelPrintDraft.activeSize || readLabelPrinterSettings().activeSize;

    if (!labelDirectPrinter || !selectedLabelPrinter) {
      setNotice("Choose a connected label printer before sending labels.");
      loadShippingLabelPrinters({ showNotice: true });
      return;
    }
    if (selectedLabelPrinterOffline) {
      setNotice(`${selectedLabelPrinter.name} is ${selectedLabelPrinter.status || "not connected"}. Check the cable, power, and Windows printer queue.`);
      loadShippingLabelPrinters();
      return;
    }
    if (selectedLabelPrinterUnsupported) {
      setNotice(`${selectedLabelPrinter.name} is connected, but direct printing needs a TSPL-compatible thermal label printer.`);
      return;
    }

    setLabelDirectPrinting(true);
    try {
      const response = await postLabelPrinterLabels(labelPrinterConnectionMode, resolvedLabelBridgeUrl, {
        labels: [{ ...labelPrintDraft.labelItem, quantity }],
        size: { width: size.width, height: size.height, gap: size.gap },
        printer_name: labelDirectPrinter,
      });
      setNotice(
        `Sent ${response.data.label_count} label${response.data.label_count === 1 ? "" : "s"} directly to ${response.data.printer} through ${labelPrinterConnectionModeLabel} (${labelPrinterTransportLabel}).`
      );
      loadShippingLabelPrinters();
    } catch (error) {
      setNotice(getPrinterApiError(error, "The direct label job could not be sent to the printer."));
      loadShippingLabelPrinters();
    } finally {
      setLabelDirectPrinting(false);
    }
  };

  const handleFormChange = (orderId, field, value) => {
    setFormData((previous) => ({
      ...previous,
      [orderId]: {
        ...previous[orderId],
        [field]: value,
      },
    }));
  };

  const handleRateSheetUpload = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file || uploadingRateSheet) return;

    const payload = new FormData();
    payload.append("file", file);
    setUploadingRateSheet(true);
    setNotice("");
    try {
      const response = await apiFetch(`${API_BASE_URL}/shipping/usa-rate-card/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: payload,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.detail || "The rate sheet could not be uploaded.");
      }
      setRateCard(result?.rate_card || null);
      setNotice(result?.message || "USA shipping rates updated.");
      await loadShippingData({ quiet: true });
    } catch (error) {
      console.error("Rate sheet upload error:", error);
      setNotice(error.message || "The rate sheet could not be uploaded.");
    } finally {
      setUploadingRateSheet(false);
      input.value = "";
    }
  };

  const startWeightEdit = (order, estimate) => {
    setWeightEdits((previous) => ({
      ...previous,
      [order.order_id]: String(
        order.shipping_weight_override_kg ??
          estimate.calculation_weight_kg ??
          estimate.product_weight_kg ??
          ""
      ),
    }));
  };

  const cancelWeightEdit = (orderId) => {
    setWeightEdits((previous) => {
      const next = { ...previous };
      delete next[orderId];
      return next;
    });
  };

  const saveWeightOverride = async (order, value) => {
    const orderId = order.order_id;
    const weight = value === null ? null : Number(value);
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
      setNotice("Rate weight must be greater than zero.");
      return;
    }

    setSavingWeightOrderId(orderId);
    setNotice("");
    try {
      const response = await apiFetch(
        `${API_BASE_URL}/shipping/orders/${orderId}/weight`,
        {
          method: "PATCH",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ weight_kg: weight }),
        }
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.detail || "The rate weight could not be saved.");
      }
      setPendingOrders((previous) =>
        previous.map((item) =>
          item.order_id === orderId ? { ...item, ...result } : item
        )
      );
      setFormData((previous) => ({
        ...previous,
        [orderId]: {
          ...previous[orderId],
          package_weight_kg: weight ?? undefined,
          shipping_cost: undefined,
        },
      }));
      cancelWeightEdit(orderId);
      setNotice(
        weight === null
          ? `Order ${order.order_no} now uses the product weight total.`
          : `Order ${order.order_no} rate weight saved and the estimate updated.`
      );
    } catch (error) {
      console.error("Rate weight save error:", error);
      setNotice(error.message || "The rate weight could not be saved.");
    } finally {
      setSavingWeightOrderId(null);
    }
  };

  const toggleOrderDetails = (orderId) => {
    setExpandedOrderIds((previous) => {
      const next = new Set(previous);

      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }

      return next;
    });
  };

  const handleEditChange = (shippingId, field, value) => {
    setEditData((previous) => ({
      ...previous,
      [shippingId]: {
        ...previous[shippingId],
        [field]: value,
      },
    }));
  };

  const markAsShipped = async (order) => {
    const orderId = order.order_id;
    const data = formData[orderId] || {};
    const shippingService = data.shipping_service || "duty_paid";
    const estimate =
      order.usa_shipping_estimates?.[shippingService] || order.usa_shipping || {};
    const resolvedWeight =
      data.package_weight_kg === undefined
        ? estimate.weight_complete
          ? estimate.calculation_weight_kg
          : ""
        : data.package_weight_kg;
    const resolvedCost =
      data.shipping_cost === undefined && estimate.status === "ready"
        ? estimate.estimated_shipping_cost
        : data.shipping_cost;
    const hasPackageWeight = String(resolvedWeight || "").trim() !== "";
    const packageWeight = hasPackageWeight
      ? Number(resolvedWeight)
      : null;

    if (
      hasPackageWeight &&
      (!Number.isFinite(packageWeight) || packageWeight <= 0)
    ) {
      setNotice("Package weight must be greater than zero.");
      return;
    }

    setProcessingOrderId(orderId);
    setNotice("");

    try {
      const response = await apiFetch(
        `${API_BASE_URL}/shipping/mark-shipped?order_id=${encodeURIComponent(orderId)}`,
        {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            order_id: orderId,
            courier_name: data.courier_name || "",
            tracking_number: data.tracking_number || "",
            package_weight_kg: packageWeight,
            shipping_cost:
              String(resolvedCost ?? "").trim() === "" ? null : Number(resolvedCost),
            shipping_note: data.shipping_note || "",
            shipping_service: shippingService,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || "Order could not be marked as shipped.");
      }

      setFormData((previous) => {
        const next = { ...previous };
        delete next[orderId];
        return next;
      });
      setNotice("Order marked as shipped successfully.");
      await loadShippingData({ quiet: true });
    } catch (error) {
      console.error("Error marking shipped:", error);
      setNotice(error.message || "Order could not be marked as shipped.");
    } finally {
      setProcessingOrderId(null);
    }
  };

  const startEditing = (record) => {
    setInlineEdit(null);
    setEditingShippingId(record.id);
    setEditData((previous) => ({
      ...previous,
      [record.id]: {
        courier_name: record.courier_name || "",
        tracking_number: record.tracking_number || "",
        package_weight_kg: record.package_weight_kg ?? "",
        shipping_cost: record.shipping_cost ?? "",
        shipping_note: record.shipping_note || "",
      },
    }));
  };

  const cancelEditing = (shippingId) => {
    setEditingShippingId(null);
    setEditData((previous) => {
      const next = { ...previous };
      delete next[shippingId];
      return next;
    });
  };

  const updateShipping = async (shippingId) => {
    const data = editData[shippingId] || {};
    const packageWeight =
      data.package_weight_kg === "" || data.package_weight_kg === undefined
        ? null
        : Number(data.package_weight_kg);

    if (
      packageWeight !== null &&
      (!Number.isFinite(packageWeight) || packageWeight <= 0)
    ) {
      setNotice("Package weight must be greater than zero.");
      return;
    }

    setUpdatingShippingId(shippingId);
    setNotice("");

    try {
      const response = await apiFetch(`${API_BASE_URL}/shipping/${shippingId}`, {
        method: "PATCH",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          courier_name: data.courier_name,
          tracking_number: data.tracking_number,
          package_weight_kg: packageWeight ?? undefined,
          shipping_cost:
            data.shipping_cost === "" || data.shipping_cost === undefined
              ? undefined
              : Number(data.shipping_cost),
          shipping_note: data.shipping_note,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || "Shipping record could not be updated.");
      }

      setEditingShippingId(null);
      setEditData((previous) => {
        const next = { ...previous };
        delete next[shippingId];
        return next;
      });
      setNotice("Shipping record updated.");
      await loadShippingData({ quiet: true });
    } catch (error) {
      console.error("Error updating shipping:", error);
      setNotice(error.message || "Shipping record could not be updated.");
    } finally {
      setUpdatingShippingId(null);
    }
  };

  const startInlineEdit = (record, field) => {
    setEditingShippingId(null);
    setInlineEdit({
      shippingId: record.id,
      field,
      value: "",
    });
    setNotice("");
  };

  const saveInlineEdit = async (record) => {
    if (!inlineEdit || inlineEdit.shippingId !== record.id) return;

    const { field, value } = inlineEdit;
    const trimmedValue = String(value).trim();
    let nextValue = trimmedValue;

    if (field === "tracking_number" && !trimmedValue) {
      setNotice("Enter a tracking number before saving.");
      return;
    }

    if (field === "shipping_cost" || field === "package_weight_kg") {
      nextValue = Number(trimmedValue);
      if (!trimmedValue || !Number.isFinite(nextValue) || nextValue <= 0) {
        setNotice(
          field === "shipping_cost"
            ? "Enter a shipping cost greater than zero."
            : "Enter a package weight greater than zero."
        );
        return;
      }
    }

    setUpdatingShippingId(record.id);
    setNotice("");

    try {
      const response = await apiFetch(`${API_BASE_URL}/shipping/${record.id}`, {
        method: "PATCH",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ [field]: nextValue }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || "Shipping record could not be updated.");
      }

      setInlineEdit(null);
      setNotice(
        field === "tracking_number"
          ? "Tracking number added."
          : field === "package_weight_kg"
            ? "Package weight added."
            : "Shipping cost added."
      );
      await loadShippingData({ quiet: true });
    } catch (error) {
      console.error("Error updating shipping field:", error);
      setNotice(error.message || "Shipping record could not be updated.");
    } finally {
      setUpdatingShippingId(null);
    }
  };

  const handleInlineKeyDown = (event, record) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveInlineEdit(record);
    }

    if (event.key === "Escape") {
      setInlineEdit(null);
    }
  };

  const handleDeleteShippedOrder = async (record) => {
    const confirmed = await confirmDialog({
      title: "Delete shipped order?",
      message: "This will also reverse related courier payments.",
      detail: "This action cannot be undone.",
      tone: "danger",
      confirmText: "Delete shipped order",
    });
    if (!confirmed) {
      return;
    }

    try {
      let response;

      if (record.order_id) {
        response = await apiFetch(`${API_BASE_URL}/orders/${record.order_id}`, {
          method: "DELETE",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
        });
      } else {
        response = await apiFetch(`${API_BASE_URL}/shipping/${record.id}`, {
          method: "DELETE",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
        });
      }

      if (!response.ok && record.order_id) {
        response = await apiFetch(`${API_BASE_URL}/shipping/${record.id}`, {
          method: "DELETE",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
        });
      }

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || "Shipping record could not be deleted.");
      }

      setNotice("Shipping record deleted.");
      await loadShippingData({ quiet: true });
    } catch (error) {
      console.error("Error deleting order:", error);
      setNotice(error.message || "Shipping record could not be deleted.");
    }
  };

  const formatDate = (value) => (value ? formatUtcLocal(value) : "-");
  const formatOrderDate = (value) => {
    const date = parseUtcLocal(value);
    return date
      ? date.toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "-";
  };
  const formatAmount = (value) =>
    Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });

  const labelUsesLocalPrinterBridge = labelPrinterConnectionMode === "local";
  const labelUsesPrintAgentBridge = labelUsesLocalPrinterBridge && shouldUseLocalPrinterBridgeByDefault();
  const resolvedLabelBridgeUrl = normalizeApiBaseUrl(labelLocalPrintBridgeUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL;
  const labelPrinterConnectionModeLabel = labelUsesLocalPrinterBridge ? "This laptop" : "ERP server";
  const labelPrinterTransportLabel = labelUsesPrintAgentBridge ? "Print Agent" : labelUsesLocalPrinterBridge ? "Local bridge" : "ERP server";
  const selectedLabelPrinter = labelPrinterOptions.find((printer) => printer.name === labelDirectPrinter) || null;
  const selectedLabelPrinterOffline = selectedLabelPrinter?.is_connected === false;
  const selectedLabelPrinterUnsupported = selectedLabelPrinter && !selectedLabelPrinter.supports_direct_labels;
  const labelDirectPrintDisabled =
    labelDirectPrinting ||
    labelPrinterStatus.loading ||
    !labelPrintDraft ||
    !selectedLabelPrinter ||
    selectedLabelPrinterOffline ||
    selectedLabelPrinterUnsupported;
  const labelPrinterStatusClass = labelPrinterStatus.loading
    ? "is-checking"
    : labelPrinterStatus.error || selectedLabelPrinterOffline
      ? "is-error"
      : selectedLabelPrinter?.is_connected
        ? "is-connected"
        : "is-offline";
  const labelPrinterStatusText = labelPrinterStatus.loading
    ? "Checking printers"
    : labelPrinterStatus.error
      ? labelUsesPrintAgentBridge ? "Print Agent offline" : labelUsesLocalPrinterBridge ? "Local bridge unavailable" : "Printer status unavailable"
      : !labelPrinterOptions.length
        ? "No printers found"
        : !labelDirectPrinter || !selectedLabelPrinter
          ? "Choose printer"
          : selectedLabelPrinterOffline
            ? selectedLabelPrinter.status || "Not connected"
            : selectedLabelPrinterUnsupported
              ? "Connected, direct unavailable"
              : selectedLabelPrinter.status || "Ready";
  const labelDirectPrintTitle = !labelDirectPrinter
    ? "Choose a connected TSPL label printer"
    : selectedLabelPrinterOffline
      ? "Selected printer is not connected"
      : selectedLabelPrinterUnsupported
        ? "Direct printing needs a TSPL-compatible thermal label printer"
        : "Send labels directly to the selected thermal printer";

  const missingCostCount = shippingRecords.filter(
    (record) => !Number(record.shipping_cost || 0)
  ).length;
  const totalShippingCost = shippingRecords.reduce(
    (sum, record) => sum + Number(record.shipping_cost || 0),
    0
  );

  const courierOptions = useMemo(
    () =>
      Array.from(
        new Set(
          shippingRecords
            .map((record) => record.courier_name?.trim())
            .filter(Boolean)
        )
      ).sort(),
    [shippingRecords]
  );

  const filteredPendingOrders = useMemo(() => {
    const query = pendingSearch.trim().toLowerCase();
    return pendingOrders.filter((order) =>
      [
        order.order_no,
        order.customer_name,
        order.platform,
        order.shipping_phone,
        order.order_contact_phone,
        order.customer_phone,
        ...(order.items || []).flatMap((item) => [
          item.article_no,
          item.product_name,
        ]),
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [pendingOrders, pendingSearch]);

  const filteredShippingRecords = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return shippingRecords.filter((record) =>
      [
        record.order_no,
        record.customer_name,
        record.courier_name,
        record.tracking_number,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [historySearch, shippingRecords]);

  return (
    <div className="shipping-page">
      <header className="shipping-page-header">
        <div className="shipping-page-header-main">
          <h1>Shipping</h1>

          <div className="shipping-header-actions">
            {["admin", "super_admin"].includes(userRole) && (
              <label className={`shipping-rate-upload ${uploadingRateSheet ? "is-busy" : ""}`}>
                <input
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={uploadingRateSheet}
                  onChange={handleRateSheetUpload}
                  type="file"
                />
                <Icon name="upload" size={17} />
                <span>{uploadingRateSheet ? "Uploading rates..." : "Upload rate sheet"}</span>
              </label>
            )}
            <button
              aria-controls="shipping-header-summary"
              aria-expanded={showSummary}
              aria-label={showSummary ? "Hide shipping summary" : "Show shipping summary"}
              className="shipping-summary-toggle"
              onClick={() => setShowSummary((current) => !current)}
              title={showSummary ? "Hide shipping summary" : "Show shipping summary"}
              type="button"
            >
              <span>Overview</span>
              <Icon name="chevron" size={17} />
            </button>
          </div>
        </div>

        {showSummary && (
          <section
            aria-label="Shipping summary"
            className="shipping-summary-grid"
            id="shipping-header-summary"
          >
            <article className="shipping-summary-card">
              <div>
                <span>Pending dispatch</span>
                <strong>{pendingOrders.length}</strong>
              </div>
            </article>

            <article className="shipping-summary-card">
              <div>
                <span>Shipped orders</span>
                <strong>{shippingRecords.length}</strong>
              </div>
            </article>

            <article className="shipping-summary-card">
              <div>
                <span>Missing cost</span>
                <strong>{missingCostCount}</strong>
              </div>
            </article>

            <article className="shipping-summary-card">
              <div>
                <span>Courier cost</span>
                <strong>PKR {formatAmount(totalShippingCost)}</strong>
              </div>
            </article>
          </section>
        )}
      </header>

      {loadError && (
        <div className="shipping-alert shipping-alert-error" role="alert">
          <span>{loadError}</span>
          <button onClick={() => loadShippingData()} type="button">
            Try again
          </button>
        </div>
      )}

      {notice && (
        <div className="shipping-alert shipping-alert-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} type="button">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      <datalist id="shipping-courier-list">
        {courierOptions.map((courier) => (
          <option key={courier} value={courier} />
        ))}
      </datalist>

      <section className="shipping-panel shipping-pending-panel">
        <div className="shipping-panel-header">
          <div className="shipping-panel-title">
            <h2>Pending dispatch</h2>
            {rateCard && (
              <small>
                Active USA rates: {rateCard.source_filename} · {rateCard.source_date}
              </small>
            )}
          </div>

          <label className="shipping-search-box">
            <Icon name="search" size={17} />
            <input
              aria-label="Search pending orders"
              onChange={(event) => setPendingSearch(event.target.value)}
              placeholder="Search order or customer"
              value={pendingSearch}
            />
          </label>
        </div>

        {refreshing && pendingOrders.length === 0 ? (
          <div className="shipping-loading-list">
            {[1, 2].map((item) => (
              <div className="shipping-loading-card" key={item} />
            ))}
          </div>
        ) : filteredPendingOrders.length === 0 ? (
          <div className="shipping-empty-state">
            <div>
              <Icon name="check" size={24} />
            </div>
            <h3>No pending orders</h3>
            <p>All current orders have been dispatched.</p>
          </div>
        ) : (
          <div className="shipping-order-list">
            {filteredPendingOrders.map((order) => {
              const orderForm = formData[order.order_id] || {};
              const isExpanded = expandedOrderIds.has(order.order_id);
              const itemCount = order.items?.length || 0;
              const unitCount = (order.items || []).reduce(
                (sum, item) => sum + Number(item.quantity || 0),
                0
              );
              const requiresManufacturing = order.items?.some(
                (item) => item.manufacturing_required
              );
              const shippingPhone = getOrderShippingPhone(order);
              const shippingPhoneSource =
                order.shipping_phone_source ||
                (order.order_contact_phone ? "Order sheet" : "Customer");
              const selectedService = orderForm.shipping_service || "duty_paid";
              const shippingEstimate =
                order.usa_shipping_estimates?.[selectedService] ||
                order.usa_shipping ||
                {};
              const isEditingRateWeight = Object.prototype.hasOwnProperty.call(
                weightEdits,
                order.order_id
              );
              const packageWeightValue =
                orderForm.package_weight_kg === undefined
                  ? shippingEstimate.weight_complete
                    ? shippingEstimate.calculation_weight_kg
                    : ""
                  : orderForm.package_weight_kg;
              const shippingCostValue =
                orderForm.shipping_cost === undefined &&
                shippingEstimate.status === "ready"
                  ? shippingEstimate.estimated_shipping_cost
                  : orderForm.shipping_cost ?? "";

              return (
                <article
                  className={`shipping-order-card ${
                    isExpanded ? "is-expanded" : ""
                  }`}
                  key={order.order_id}
                >
                  <button
                    aria-controls={`shipping-order-details-${order.order_id}`}
                    aria-expanded={isExpanded}
                    className="shipping-order-header"
                    onClick={() => toggleOrderDetails(order.order_id)}
                    type="button"
                  >
                    <div className="shipping-order-identity">
                      <div className="shipping-order-icon">
                        <Icon name="package" size={19} />
                      </div>
                      <div className="shipping-order-summary">
                        <strong className="shipping-customer-name">
                          {order.customer_name || "Unnamed customer"}
                        </strong>
                        <span className="shipping-order-date">
                          {formatOrderDate(order.order_date)}
                        </span>
                        <span className="shipping-order-badges">
                          <span className="shipping-order-number-chip">
                            #{order.order_no}
                          </span>
                          <span className="shipping-platform-badge">
                            {order.platform || "Manual"}
                          </span>
                          <span className="shipping-units-badge">
                            {unitCount} units
                          </span>
                        </span>
                      </div>
                    </div>

                    <span
                      aria-hidden="true"
                      className="shipping-order-chevron"
                    >
                      <Icon name="chevron" size={17} />
                    </span>
                  </button>

                  {isExpanded && (
                  <div
                    className="shipping-order-body"
                    id={`shipping-order-details-${order.order_id}`}
                  >
                    <div className="shipping-order-details">
                      <div className="shipping-detail-block">
                        <span className="shipping-detail-label">Ship to</span>
                        {shippingPhone && (
                          <p className="shipping-phone">
                            <Icon name="phone" size={15} />
                            <span>
                              <strong>{shippingPhone}</strong>
                              {shippingPhoneSource && (
                                <small>{shippingPhoneSource} phone</small>
                              )}
                            </span>
                          </p>
                        )}
                        {order.customer_address && (
                          <p className="shipping-address">
                            <Icon name="location" size={15} />
                            <span>{formatCompactAddress(order.customer_address)}</span>
                          </p>
                        )}
                      </div>

                      <div className="shipping-detail-block">
                        <div className="shipping-items-heading">
                          <span className="shipping-detail-label">
                            Order items · {itemCount} items · {unitCount} units
                          </span>
                          {requiresManufacturing && (
                            <span className="shipping-manufacturing-badge">
                              Manufacturing required
                            </span>
                          )}
                        </div>
                        <div className="shipping-item-list">
                          {order.items?.map((item) => (
                            <div
                              className={`shipping-item-row ${
                                item.manufacturing_required ? "needs-manufacturing" : ""
                              }`}
                              key={`${order.order_id}-${item.article_no}`}
                            >
                              {item.product_image_url ? (
                                <img loading="lazy" decoding="async"
                                  alt=""
                                  className="shipping-item-thumbnail"
                                  src={getStaticUrl(item.product_image_url)}
                                />
                              ) : (
                                <span className="shipping-item-thumbnail-placeholder">
                                  {getProductInitials(item.article_no, item.product_name)}
                                </span>
                              )}
                              <div className="shipping-item-identity">
                                <strong className="shipping-item-article">
                                  {item.article_no}
                                </strong>
                                <span className="shipping-item-quantity">
                                  {"\u00d7"} {item.quantity}
                                </span>
                                <span className="shipping-item-weight">
                                  {Number(item.unit_weight_kg || 0) > 0
                                    ? `${formatShippingWeight(item.line_weight_kg)} kg`
                                    : "Weight missing"}
                                </span>
                              </div>
                              <div className="shipping-item-actions">
                                <span className="shipping-item-source">
                                  {item.stock_source}
                                </span>
                                <button
                                  aria-label={`Print labels for ${
                                    item.article_no || item.product_name || "product"
                                  }`}
                                  className="shipping-item-label-button"
                                  onClick={() => openLabelPrintDialog(order, item)}
                                  title="Print product labels"
                                  type="button"
                                >
                                  <Icon name="print" size={14} />
                                  Label
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="shipping-dispatch-form">
                      <div
                        className={`shipping-rate-panel ${
                          shippingEstimate.status === "ready" ? "is-ready" : "has-warning"
                        }`}
                      >
                        <div className="shipping-rate-heading">
                          <div>
                            <strong>USA OnTrac rate</strong>
                          </div>
                          <label>
                            <span>Service</span>
                            <select
                              onChange={(event) =>
                                handleFormChange(
                                  order.order_id,
                                  "shipping_service",
                                  event.target.value
                                )
                              }
                              value={selectedService}
                            >
                              <option value="duty_paid">Duty paid</option>
                              <option value="non_duty_paid">Non-duty paid</option>
                            </select>
                          </label>
                        </div>

                        <div className="shipping-rate-metrics">
                          <div>
                            <span>Zone</span>
                            <strong>{shippingEstimate.zone_label || "Not found"}</strong>
                          </div>
                          <div className="shipping-rate-weight-metric">
                            <span>Total weight</span>
                            {isEditingRateWeight ? (
                              <div className="shipping-rate-weight-form">
                                <input
                                  autoFocus
                                  min="0.001"
                                  onChange={(event) =>
                                    setWeightEdits((previous) => ({
                                      ...previous,
                                      [order.order_id]: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      saveWeightOverride(
                                        order,
                                        weightEdits[order.order_id]
                                      );
                                    }
                                    if (event.key === "Escape") {
                                      cancelWeightEdit(order.order_id);
                                    }
                                  }}
                                  step="0.001"
                                  type="number"
                                  value={weightEdits[order.order_id]}
                                />
                                <div>
                                  <button
                                    disabled={savingWeightOrderId === order.order_id}
                                    onClick={() =>
                                      saveWeightOverride(
                                        order,
                                        weightEdits[order.order_id]
                                      )
                                    }
                                    type="button"
                                  >
                                    Save
                                  </button>
                                  <button
                                    disabled={savingWeightOrderId === order.order_id}
                                    onClick={() => cancelWeightEdit(order.order_id)}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="shipping-rate-weight-value">
                                <strong>
                                  {formatShippingWeight(
                                    shippingEstimate.calculation_weight_kg
                                  )} kg
                                </strong>
                                <button
                                  onClick={() => startWeightEdit(order, shippingEstimate)}
                                  type="button"
                                >
                                  <Icon name="edit" size={13} />
                                  Edit
                                </button>
                              </div>
                            )}
                            {shippingEstimate.billing_weight_kg && (
                              <small>
                                Billable: {formatShippingWeight(
                                  shippingEstimate.billing_weight_kg
                                )} kg
                              </small>
                            )}
                            {shippingEstimate.weight_source === "manual" && (
                              <button
                                className="shipping-use-product-weight"
                                disabled={savingWeightOrderId === order.order_id}
                                onClick={() => saveWeightOverride(order, null)}
                                type="button"
                              >
                                Use product-unit total
                              </button>
                            )}
                          </div>
                          <div className="shipping-rate-total">
                            <span>Estimated rate</span>
                            <strong>
                              {shippingEstimate.estimated_shipping_cost != null
                                ? formatShippingRate(
                                    shippingEstimate.estimated_shipping_cost
                                  )
                                : "—"}
                            </strong>
                          </div>
                        </div>

                        {shippingEstimate.status !== "ready" && (
                          <p className="shipping-rate-message">
                            {shippingEstimate.message || "Rate cannot be calculated yet."}
                            {shippingEstimate.missing_weight_items?.length > 0 && (
                              <span>
                                {" "}
                                Missing: {shippingEstimate.missing_weight_items
                                  .map((item) => item.article_no || item.product_name)
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            )}
                          </p>
                        )}
                        {shippingEstimate.weight_warning && (
                          <p className="shipping-rate-message">
                            {shippingEstimate.weight_warning}
                          </p>
                        )}
                      </div>

                      <div className="shipping-field-grid">
                        <label className="shipping-field">
                          <span>Courier</span>
                          <input
                            list="shipping-courier-list"
                            onChange={(event) =>
                              handleFormChange(
                                order.order_id,
                                "courier_name",
                                event.target.value
                              )
                            }
                            placeholder="Courier name"
                            value={orderForm.courier_name || ""}
                          />
                        </label>

                        <label className="shipping-field">
                          <span>Tracking number</span>
                          <input
                            onChange={(event) =>
                              handleFormChange(
                                order.order_id,
                                "tracking_number",
                                event.target.value
                              )
                            }
                            placeholder="Tracking number"
                            value={orderForm.tracking_number || ""}
                          />
                        </label>

                        <label className="shipping-field">
                          <span>Package weight (kg)</span>
                          <input
                            min="0.01"
                            onChange={(event) =>
                              handleFormChange(
                                order.order_id,
                                "package_weight_kg",
                                event.target.value
                              )
                            }
                            placeholder="e.g. 2.5"
                            step="0.01"
                            type="number"
                            value={packageWeightValue}
                          />
                        </label>

                        <label className="shipping-field">
                          <span>Shipping cost</span>
                          <input
                            min="0"
                            onChange={(event) =>
                              handleFormChange(
                                order.order_id,
                                "shipping_cost",
                                event.target.value
                              )
                            }
                            placeholder="PKR"
                            step="0.01"
                            type="number"
                            value={shippingCostValue}
                          />
                        </label>

                        <label className="shipping-field is-wide">
                          <span>Dispatch note</span>
                          <input
                            onChange={(event) =>
                              handleFormChange(
                                order.order_id,
                                "shipping_note",
                                event.target.value
                              )
                            }
                            placeholder="Optional note"
                            value={orderForm.shipping_note || ""}
                          />
                        </label>
                      </div>

                      <div className="shipping-card-actions">
                        <button
                          className="shipping-share-button"
                          onClick={() => shareToWhatsApp(order)}
                          type="button"
                        >
                          <Icon name="copy" size={16} />
                          Copy for WhatsApp
                        </button>
                        <button
                          className="shipping-ship-button"
                          disabled={processingOrderId === order.order_id}
                          onClick={() => markAsShipped(order)}
                          type="button"
                        >
                          <Icon name="truck" size={17} />
                          {processingOrderId === order.order_id
                            ? "Processing..."
                            : "Mark as Shipped"}
                        </button>
                      </div>
                    </div>
                  </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="shipping-panel shipping-history-panel">
        <div className="shipping-panel-header">
          <h2>Shipped orders</h2>

          <label className="shipping-search-box">
            <Icon name="search" size={17} />
            <input
              aria-label="Search shipment history"
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Search tracking or courier"
              value={historySearch}
            />
          </label>
        </div>

        {filteredShippingRecords.length === 0 ? (
          <div className="shipping-empty-state shipping-empty-history">
            <div>
              <Icon name="truck" size={24} />
            </div>
            <h3>No shipped orders found</h3>
            <p>Completed shipments will appear here.</p>
          </div>
        ) : (
          <div className="shipping-table-wrap">
            <table className="shipping-history-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Courier</th>
                  <th>Tracking</th>
                  <th className="shipping-align-right">Weight</th>
                  <th className="shipping-align-right">Cost</th>
                  <th>Shipped</th>
                  <th>Note</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredShippingRecords.map((record) => {
                  const isEditing = editingShippingId === record.id;
                  const values = editData[record.id] || {};
                  const isEditingTracking =
                    inlineEdit?.shippingId === record.id &&
                    inlineEdit.field === "tracking_number";
                  const isEditingCost =
                    inlineEdit?.shippingId === record.id &&
                    inlineEdit.field === "shipping_cost";
                  const isEditingWeight =
                    inlineEdit?.shippingId === record.id &&
                    inlineEdit.field === "package_weight_kg";

                  return (
                    <tr className={isEditing ? "is-editing" : ""} key={record.id}>
                      <td data-label="Order">
                        <strong className="shipping-order-number">
                          #{record.order_no}
                        </strong>
                      </td>
                      <td data-label="Customer">{record.customer_name || "-"}</td>
                      <td data-label="Courier">
                        {isEditing ? (
                          <input
                            list="shipping-courier-list"
                            onChange={(event) =>
                              handleEditChange(
                                record.id,
                                "courier_name",
                                event.target.value
                              )
                            }
                            value={values.courier_name || ""}
                          />
                        ) : (
                          <span className="shipping-courier-pill">
                            {record.courier_name || "Not set"}
                          </span>
                        )}
                      </td>
                      <td data-label="Tracking">
                        {isEditing ? (
                          <input
                            onChange={(event) =>
                              handleEditChange(
                                record.id,
                                "tracking_number",
                                event.target.value
                              )
                            }
                            value={values.tracking_number || ""}
                          />
                        ) : isEditingTracking ? (
                          <div className="shipping-inline-editor">
                            <input
                              aria-label={`Tracking number for order ${record.order_no}`}
                              autoFocus
                              onChange={(event) =>
                                setInlineEdit((previous) => ({
                                  ...previous,
                                  value: event.target.value,
                                }))
                              }
                              onKeyDown={(event) =>
                                handleInlineKeyDown(event, record)
                              }
                              placeholder="Tracking number"
                              value={inlineEdit.value}
                            />
                            <button
                              aria-label="Save tracking number"
                              className="shipping-inline-save"
                              disabled={updatingShippingId === record.id}
                              onClick={() => saveInlineEdit(record)}
                              title="Save tracking number"
                              type="button"
                            >
                              <Icon name="check" size={14} />
                            </button>
                            <button
                              aria-label="Cancel tracking edit"
                              className="shipping-inline-cancel"
                              disabled={updatingShippingId === record.id}
                              onClick={() => setInlineEdit(null)}
                              title="Cancel"
                              type="button"
                            >
                              <Icon name="close" size={13} />
                            </button>
                          </div>
                        ) : record.tracking_number ? (
                          <span className="shipping-tracking-value">
                            {record.tracking_number}
                          </span>
                        ) : (
                          <button
                            aria-label={`Add tracking number for order ${record.order_no}`}
                            className="shipping-tracking-missing shipping-missing-button"
                            onClick={() =>
                              startInlineEdit(record, "tracking_number")
                            }
                            title="Add tracking number"
                            type="button"
                          >
                            Missing
                          </button>
                        )}
                      </td>
                      <td className="shipping-weight-cell" data-label="Weight">
                        {isEditing ? (
                          <input
                            min="0.01"
                            onChange={(event) =>
                              handleEditChange(
                                record.id,
                                "package_weight_kg",
                                event.target.value
                              )
                            }
                            step="0.01"
                            type="number"
                            value={values.package_weight_kg ?? ""}
                          />
                        ) : isEditingWeight ? (
                          <div className="shipping-inline-editor">
                            <input
                              aria-label={`Package weight for order ${record.order_no}`}
                              autoFocus
                              min="0.01"
                              onChange={(event) =>
                                setInlineEdit((previous) => ({
                                  ...previous,
                                  value: event.target.value,
                                }))
                              }
                              onKeyDown={(event) =>
                                handleInlineKeyDown(event, record)
                              }
                              placeholder="Weight"
                              step="0.01"
                              type="number"
                              value={inlineEdit.value}
                            />
                            <button
                              aria-label="Save package weight"
                              className="shipping-inline-save"
                              disabled={updatingShippingId === record.id}
                              onClick={() => saveInlineEdit(record)}
                              title="Save package weight"
                              type="button"
                            >
                              <Icon name="check" size={14} />
                            </button>
                            <button
                              aria-label="Cancel weight edit"
                              className="shipping-inline-cancel"
                              disabled={updatingShippingId === record.id}
                              onClick={() => setInlineEdit(null)}
                              title="Cancel"
                              type="button"
                            >
                              <Icon name="close" size={13} />
                            </button>
                          </div>
                        ) : Number(record.package_weight_kg || 0) > 0 ? (
                          `${Number(record.package_weight_kg).toLocaleString(
                            "en-PK",
                            { maximumFractionDigits: 2 }
                          )} kg`
                        ) : (
                          <button
                            aria-label={`Add package weight for order ${record.order_no}`}
                            className="shipping-weight-missing shipping-missing-button"
                            onClick={() =>
                              startInlineEdit(record, "package_weight_kg")
                            }
                            title="Add package weight"
                            type="button"
                          >
                            Missing
                          </button>
                        )}
                      </td>
                      <td className="shipping-cost-cell" data-label="Cost">
                        {isEditing ? (
                          <input
                            min="0"
                            onChange={(event) =>
                              handleEditChange(
                                record.id,
                                "shipping_cost",
                                event.target.value
                              )
                            }
                            type="number"
                            value={values.shipping_cost ?? ""}
                          />
                        ) : isEditingCost ? (
                          <div className="shipping-inline-editor">
                            <input
                              aria-label={`Shipping cost for order ${record.order_no}`}
                              autoFocus
                              min="0"
                              onChange={(event) =>
                                setInlineEdit((previous) => ({
                                  ...previous,
                                  value: event.target.value,
                                }))
                              }
                              onKeyDown={(event) =>
                                handleInlineKeyDown(event, record)
                              }
                              placeholder="Cost"
                              step="any"
                              type="number"
                              value={inlineEdit.value}
                            />
                            <button
                              aria-label="Save shipping cost"
                              className="shipping-inline-save"
                              disabled={updatingShippingId === record.id}
                              onClick={() => saveInlineEdit(record)}
                              title="Save shipping cost"
                              type="button"
                            >
                              <Icon name="check" size={14} />
                            </button>
                            <button
                              aria-label="Cancel cost edit"
                              className="shipping-inline-cancel"
                              disabled={updatingShippingId === record.id}
                              onClick={() => setInlineEdit(null)}
                              title="Cancel"
                              type="button"
                            >
                              <Icon name="close" size={13} />
                            </button>
                          </div>
                        ) : Number(record.shipping_cost || 0) > 0 ? (
                          <>PKR {formatAmount(record.shipping_cost)}</>
                        ) : (
                          <button
                            aria-label={`Add shipping cost for order ${record.order_no}`}
                            className="shipping-cost-missing shipping-missing-button"
                            onClick={() => startInlineEdit(record, "shipping_cost")}
                            title="Add shipping cost"
                            type="button"
                          >
                            Missing
                          </button>
                        )}
                      </td>
                      <td data-label="Shipped">{formatDate(record.shipped_at)}</td>
                      <td className="shipping-note-cell" data-label="Note">
                        {isEditing ? (
                          <input
                            onChange={(event) =>
                              handleEditChange(
                                record.id,
                                "shipping_note",
                                event.target.value
                              )
                            }
                            value={values.shipping_note || ""}
                          />
                        ) : (
                          record.shipping_note || "-"
                        )}
                      </td>
                      <td data-label="Actions">
                        <div className="shipping-row-actions">
                          {isEditing ? (
                            <>
                              <button
                                className="shipping-save-button"
                                disabled={updatingShippingId === record.id}
                                onClick={() => updateShipping(record.id)}
                                title="Save changes"
                                type="button"
                              >
                                <Icon name="check" size={16} />
                              </button>
                              <button
                                className="shipping-cancel-button"
                                onClick={() => cancelEditing(record.id)}
                                title="Cancel editing"
                                type="button"
                              >
                                <Icon name="close" size={15} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="shipping-edit-button"
                                onClick={() => startEditing(record)}
                                title="Edit shipment"
                                type="button"
                              >
                                <Icon name="edit" size={15} />
                              </button>
                              <button
                                className="shipping-delete-button"
                                onClick={() => handleDeleteShippedOrder(record)}
                                title="Delete order and shipping record"
                                type="button"
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {labelPrintDraft && (
        <div
          className="shipping-label-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLabelPrintDraft(null);
          }}
        >
          <section
            aria-label="Print product label"
            aria-modal="true"
            className="shipping-label-modal"
            role="dialog"
          >
            <div className="shipping-label-modal-header shipping-label-modal-header-compact">
              <button
                aria-label="Close label print popup"
                className="shipping-label-modal-close"
                onClick={() => setLabelPrintDraft(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="shipping-label-preview-card">
              <div className="shipping-label-preview-heading">
                <span>Barcode preview</span>
                <strong>{labelPrintDraft.articleNo || labelPrintDraft.labelItem.sku || labelPrintDraft.labelItem.barcode || "SKU"}</strong>
              </div>
              <div className="shipping-label-preview-stage">
                <ShippingLabelPreview item={labelPrintDraft.labelItem} size={labelPrintDraft.activeSize} />
              </div>
            </div>

            <div className="shipping-label-printer-row">
              <label>
                <span>Printer</span>
                <select
                  disabled={labelPrinterStatus.loading || labelPrinterOptions.length === 0}
                  onChange={(event) => setLabelDirectPrinter(event.target.value)}
                  value={labelDirectPrinter}
                >
                  <option value="">Select printer</option>
                  {labelPrinterOptions.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {`${printer.name}${printer.is_default ? " (default)" : ""}${printer.is_connected ? "" : " - offline"}${printer.supports_direct_labels ? "" : " - direct unavailable"}`}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className={`shipping-label-printer-status ${labelPrinterStatusClass}`} title={selectedLabelPrinter?.status_detail || labelPrinterStatus.error || ""}>
                  {labelPrinterStatusText}
                </span>
                <small>{labelPrinterConnectionModeLabel} ({labelPrinterTransportLabel})</small>
              </div>
              <button
                className="shipping-label-refresh-button"
                disabled={labelPrinterStatus.loading}
                onClick={() => loadShippingLabelPrinters({ showNotice: true })}
                type="button"
              >
                {labelPrinterStatus.loading ? "Checking" : "Refresh"}
              </button>
            </div>

            <div className="shipping-label-quantity-row">
              <span>Quantity</span>
              <div className="shipping-label-stepper">
                <button
                  aria-label="Decrease label quantity"
                  onClick={() => adjustLabelPrintQuantity(-1)}
                  type="button"
                >
                  <Icon name="minus" size={15} />
                </button>
                <input
                  aria-label="Label print quantity"
                  max="999"
                  min="1"
                  onChange={(event) => updateLabelPrintQuantity(event.target.value)}
                  type="number"
                  value={labelPrintDraft.quantity}
                />
                <button
                  aria-label="Increase label quantity"
                  onClick={() => adjustLabelPrintQuantity(1)}
                  type="button"
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>
            </div>

            <div className="shipping-label-modal-actions">
              <button
                className="shipping-share-button"
                onClick={() => setLabelPrintDraft(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="shipping-ship-button shipping-label-print-button"
                disabled={labelDirectPrintDisabled}
                onClick={printShippingItemLabels}
                title={labelDirectPrintTitle}
                type="button"
              >
                <Icon name="print" size={16} />
                {labelDirectPrinting ? "Sending..." : "Print labels"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default Shipping;
