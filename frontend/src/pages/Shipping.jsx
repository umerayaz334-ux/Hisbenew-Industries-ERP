import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import api, { API_BASE_URL, apiFetch, getApiBaseUrl, getAuthHeaders, getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import {
  COPY_STYLE_FIELDS,
  DEFAULT_LOCAL_PRINT_BRIDGE_URL,
  DIRECT_PRINTER_STORAGE_KEY,
  applyLabelDesignToItem,
  createLabelPrinterItemForProduct,
  fetchLocalPrinterBridge,
  getBarcodeHeightScale,
  getLabelRenderMetrics,
  getInitialLocalPrintBridgeUrl,
  getInitialPrinterConnectionMode,
  getLabelPrintCount,
  getLayerAlignment,
  getLayerPositionStyle,
  getLayerOrder,
  getPrinterApiError,
  normalizeApiBaseUrl,
  pickLabelFields,
  readLabelPrinterSettings,
  readStoredText,
} from "../utils/labelPrintUtils";import "./Shipping.css";

import "./Products.css";



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

    eye: (

      <>

        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />

        <circle cx="12" cy="12" r="3" />

      </>

    ),

    image: (

      <>

        <rect x="3" y="4" width="18" height="16" rx="2" />

        <circle cx="8.5" cy="9" r="1.5" />

        <path d="m4 17 5-5 4 4 2-2 5 5" />

      </>

    ),

    share: (

      <>

        <circle cx="18" cy="5" r="3" />

        <circle cx="6" cy="12" r="3" />

        <circle cx="18" cy="19" r="3" />

        <path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4" />

      </>

    ),

    download: (

      <>

        <path d="M12 3v12M7 10l5 5 5-5" />

        <path d="M5 21h14" />

      </>

    ),

    whatsapp: (

      <>

        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />

        <path d="M9.5 9.5c.3-.6.6-.6.9-.6h.7c.2 0 .5.1.6.4.3.7.8 2 .9 2.1.1.2.1.4 0 .6s-.3.4-.5.6c-.2.2-.4.4-.2.7.4.7 1.2 1.5 2 1.9.3.2.6.1.8-.1.2-.2.6-.7.8-.9.2-.2.4-.2.6-.1.2.1 1.4.7 1.7.8.2.1.4.2.5.3 0 .3 0 1.2-.8 1.8-.8.6-1.6.6-2.2.5-1.5-.2-3.1-1.2-4.4-2.5-1.3-1.3-2.3-2.9-2.5-4.4-.1-.6-.1-1.4.5-2.2z" />

      </>

    ),

    external: (

      <>

        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />

        <polyline points="15 3 21 3 21 9" />

        <line x1="10" y1="14" x2="21" y2="3" />

      </>

    ),

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

      barcodeRef.current.setAttribute("preserveAspectRatio", "none");

    } catch {

      barcodeRef.current.innerHTML = "";

    }

  }, [height, heightScale, scale, value]);



  return <svg aria-label={`Barcode ${value || "label"}`} ref={barcodeRef} role="img" />;

};



const ShippingLabelPreview = ({ item, size }) => {
  const {
    previewWidth,
    previewHeight,
    compact,
    titleSize,
    brandSize,
    skuSize,
    priceSize,
    barcodeHeight,
    barcodeScale,
    barcodeHeightScale,
  } = getLabelRenderMetrics(size, item);
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
      className={`shipping-label-preview is-positioned ${compact ? "is-compact" : ""} ${item.showImage ? "has-image" : ""}`}
      style={{
        "--label-preview-width": `${previewWidth}px`,
        "--label-preview-height": `${previewHeight}px`,
        "--label-brand-size": `${brandSize}px`,
        "--label-title-size": `${titleSize}px`,
        "--label-sku-size": `${skuSize}px`,
        "--label-price-size": `${priceSize}px`,
        "--barcode-scale": barcodeScale,
        "--barcode-height-scale": barcodeHeightScale,
      }}
    >
      {getLayerOrder(item).map((layerId) => {
        const layer = renderLayer(layerId);
        if (!layer) return null;
        return (
          <div
            className={`shipping-label-preview-layer is-positioned-layer is-layer-${layerId} is-align-${getLayerAlignment(item, layerId)}`}
            key={layerId}
            style={getLayerPositionStyle(item, layerId)}
          >
            <span className="shipping-label-layer-object">{layer}</span>
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



const getCarrierTrackingUrl = (courierName, trackingNumber) => {

  const c = String(courierName || "").trim().toLowerCase();

  const t = encodeURIComponent(String(trackingNumber || "").trim().replace(/\s+/g, ""));

  if (!t) return null;

  if (c.includes("fedex") || !c || c === "courier") return `https://www.fedex.com/fedextrack/?trknbr=${t}`;

  if (c.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${t}&brand=DHL`;

  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${t}`;

  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;

  if (c.includes("tcs")) return `https://www.tcsexpress.com/track/${t}`;

  if (c.includes("leopard")) return `https://leopardscourier.com/tracking?track=${t}`;

  if (c.includes("m&p") || c.includes("mnp")) return `https://www.mulphilog.com/track?consignment=${t}`;

  return `https://www.fedex.com/fedextrack/?trknbr=${t}`;

};



const getStockStatus = (product) => {

  const stock = Number(product?.available_stock ?? product?.factory_stock ?? 0);

  const lowAlert = Number(product?.low_stock_alert ?? 10);

  if (stock <= 0) return { label: "Out of Stock", tone: "danger" };

  if (stock <= lowAlert) return { label: "Low Stock", tone: "warning" };

  return { label: "In Stock", tone: "success" };

};



const formatUsdCurrency = (value) => {

  const num = Number(value || 0);

  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

};



const getNoteLines = (notes) => {

  if (!notes) return [];

  if (Array.isArray(notes)) return notes.filter(Boolean);

  return String(notes)

    .split(/\r?\n/)

    .map((line) => line.trim())

    .filter(Boolean);

};



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

  const [labelDirectPrinter, setLabelDirectPrinter] = useState(() => readStoredText(DIRECT_PRINTER_STORAGE_KEY, ""));

  const [labelPrinterConnectionMode, setLabelPrinterConnectionMode] = useState(getInitialPrinterConnectionMode);

  const [labelLocalPrintBridgeUrl, setLabelLocalPrintBridgeUrl] = useState(getInitialLocalPrintBridgeUrl);

  const [labelDirectPrinting, setLabelDirectPrinting] = useState(false);

  const [statusMenuRecordId, setStatusMenuRecordId] = useState(null);

  const [updatingStatusRecordId, setUpdatingStatusRecordId] = useState(null);

  const [copiedOrderId, setCopiedOrderId] = useState(null);

  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);

  const [detailProduct, setDetailProduct] = useState(null);

  const [loadingDetailProduct, setLoadingDetailProduct] = useState(false);

  const [productImagePreview, setProductImagePreview] = useState(null);

  const [editingItemWeightKey, setEditingItemWeightKey] = useState(null);

  const [itemWeightInput, setItemWeightInput] = useState("");

  const [savingItemWeight, setSavingItemWeight] = useState(false);


  useEffect(() => {
    try {
      if (labelDirectPrinter) window.localStorage.setItem(DIRECT_PRINTER_STORAGE_KEY, labelDirectPrinter);
    } catch {}
  }, [labelDirectPrinter]);


  const describeShippingLoadError = (error) => {
    const status = error?.response?.status || 0;
    if (error?.__authExpired || status === 401 || status === 403) {
      return "Your session expired or this login cannot open Shipping. Sign in again.";
    }
    if ([502, 503, 504].includes(status)) {
      return "The live API is restarting. Retry in a moment.";
    }
    if (!status || error?.code === "ERR_NETWORK" || error?.message?.includes("Network Error")) {
      return `Cannot reach the live API at ${getApiBaseUrl()}. Check your internet connection, then refresh.`;
    }
    const detail = error?.response?.data?.detail;
    const detailText = Array.isArray(detail)
      ? detail.map((item) => item?.msg || item?.detail || String(item)).join(", ")
      : detail;
    return detailText
      ? `Unable to load shipping data: ${detailText}`
      : `Unable to load shipping data (HTTP ${status}). Check the backend and try again.`;
  };

  const loadShippingData = async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    setLoadError("");

    try {
      // Use the shared axios client (same as Orders/Dashboard) — more reliable on live than raw fetch.
      const [pendingResponse, historyResponse] = await Promise.all([
        api.get("/shipping/pending"),
        api.get("/shipping"),
      ]);

      setPendingOrders(Array.isArray(pendingResponse.data) ? pendingResponse.data : []);
      setShippingRecords(Array.isArray(historyResponse.data) ? historyResponse.data : []);
      setLoadError("");

      // Rate card is helpful but must not block the shipping page.
      try {
        const rateCardResponse = await api.get("/shipping/usa-rate-card");
        setRateCard(rateCardResponse.data || null);
      } catch (rateError) {
        console.warn("USA rate card could not be loaded.", rateError);
      }
    } catch (error) {
      console.error("Shipping data loading error:", error);
      setLoadError(describeShippingLoadError(error));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    loadShippingData().finally(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      setCopiedOrderId(order.order_id);

      setTimeout(() => {

        setCopiedOrderId((current) => (current === order.order_id ? null : current));

      }, 2200);



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



      setNotice(`Order #${order.order_no} details copied for WhatsApp.`);

    } catch (error) {

      console.error("Error copying to clipboard:", error);

      setNotice("Order details could not be copied.");

    }

  };


  const getLabelPrinterStatus = (mode, bridgeUrl) =>
    mode === "local"
      ? fetchLocalPrinterBridge(bridgeUrl, "/local-label-printers")
      : api.get("/label-printers");

  const postLabelPrinterLabels = (mode, bridgeUrl, payload) =>
    mode === "local"
      ? fetchLocalPrinterBridge(bridgeUrl, "/local-label-printers/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : api.post("/label-printers/print", payload);

  const loadShippingLabelPrinters = async ({ showNotice = false } = {}) => {

    const nextMode = getInitialPrinterConnectionMode();

    const nextBridgeUrl = getInitialLocalPrintBridgeUrl();

    const nextModeLabel = nextMode === "local" ? "This laptop" : "ERP server";



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



  const handleManualStatusChange = async (record, newStage) => {
    setStatusMenuRecordId(null);
    setUpdatingStatusRecordId(record.id);
    setNotice("");
    try {
      const res = await apiFetch(`${API_BASE_URL}/shipping/${record.id}/status`, {
        method: "PATCH",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          status_stage: newStage,
          carrier_name: record.courier_name || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Failed to update shipment status.");
      }
      const payload = await res.json().catch(() => null);
      const savedShipping = payload?.shipping;
      if (savedShipping?.id) {
        setShippingRecords((prev) =>
          (Array.isArray(prev) ? prev : []).map((item) =>
            item.id === savedShipping.id ? { ...item, ...savedShipping } : item
          )
        );
      }
      await loadShippingData({ quiet: true });
      const stageLabels = {
        delivered: "Delivered",
        in_transit: "In Transit",
        waiting: "Waiting",
        exception: "Needs Attention",
      };
      setNotice(
        `Order ${record.order_no} status saved as ${
          stageLabels[newStage] || savedShipping?.shipping_status || newStage
        }.`
      );
    } catch (err) {
      console.error("Manual status update error:", err);
      setNotice(err.message || "Failed to update shipment status.");
    } finally {
      setUpdatingStatusRecordId(null);
    }
  };



  const toggleOrderDetails = (orderId) => {

    setExpandedOrderIds((previous) => {

      if (previous.has(orderId)) {

        return new Set();

      }

      return new Set([orderId]);

    });

  };



  const openProductDetail = async (item) => {

    if (!item) return;

    setLoadingDetailProduct(true);

    try {

      if (item.product_id) {

        const response = await api.get(`/products/${item.product_id}`);

        setDetailProduct(response.data);

      } else if (item.article_no) {

        const response = await api.get(`/products?search=${encodeURIComponent(item.article_no)}`);

        const list = Array.isArray(response.data) ? response.data : [];

        const match = list.find((p) => String(p.article_no || "").trim().toLowerCase() === String(item.article_no || "").trim().toLowerCase()) || list[0];

        if (match) {

          setDetailProduct(match);

        } else {

          setDetailProduct({

            id: null,

            article_no: item.article_no,

            name: item.product_name,

            image_url: item.product_image_url,

            category: item.category,

            selling_price: item.product_selling_price || item.unit_price,

            unit_weight_kg: item.unit_weight_kg,

          });

        }

      }

    } catch (err) {

      console.error("Failed to load product details:", err);

      setDetailProduct({

        id: item.product_id || null,

        article_no: item.article_no,

        name: item.product_name,

        image_url: item.product_image_url,

        category: item.category,

        selling_price: item.product_selling_price || item.unit_price,

        unit_weight_kg: item.unit_weight_kg,

      });

    } finally {

      setLoadingDetailProduct(false);

    }

  };



  const closeDetails = () => {

    setDetailProduct(null);

    setProductImagePreview(null);

  };



  const startEditItemWeight = (orderId, item) => {

    setEditingItemWeightKey(`${orderId}-${item.article_no}`);

    setItemWeightInput(Number(item.unit_weight_kg || 0) > 0 ? String(item.unit_weight_kg) : "");

  };



  const cancelEditItemWeight = () => {

    setEditingItemWeightKey(null);

    setItemWeightInput("");

  };



  const saveItemWeight = async (orderId, item) => {

    const weight = Number(itemWeightInput);

    if (!Number.isFinite(weight) || weight <= 0) {

      setNotice("Weight must be greater than zero.");

      return;

    }



    setSavingItemWeight(true);

    try {

      let targetProductId = item.product_id;

      if (!targetProductId && item.article_no) {

        const searchRes = await api.get(`/products?search=${encodeURIComponent(item.article_no)}`);

        const list = Array.isArray(searchRes.data) ? searchRes.data : [];

        const match = list.find((p) => String(p.article_no || "").trim().toLowerCase() === String(item.article_no || "").trim().toLowerCase()) || list[0];

        if (match) targetProductId = match.id;

      }



      if (!targetProductId) {

        throw new Error(`Could not find product for ${item.article_no}.`);

      }



      const res = await apiFetch(`${API_BASE_URL}/products/${targetProductId}/weight`, {

        method: "PATCH",

        headers: getAuthHeaders({ "Content-Type": "application/json" }),

        body: JSON.stringify({ unit_weight_kg: weight }),

      });



      if (!res.ok) {

        const err = await res.json().catch(() => null);

        throw new Error(err?.detail || "Failed to update product weight.");

      }



      setNotice(`Updated weight for ${item.article_no} to ${weight} kg.`);

      setEditingItemWeightKey(null);

      setItemWeightInput("");

      await loadShippingData({ quiet: true });

    } catch (err) {

      console.error("Save item weight error:", err);

      setNotice(err.message || "Failed to update product weight.");

    } finally {

      setSavingItemWeight(false);

    }

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
            dispatch_agent: data.dispatch_agent || "",
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
      window.dispatchEvent(new CustomEvent("erp:shipping-updated"));
    } catch (error) {
      console.error("Error marking shipped:", error);
      setNotice(error.message || "Order could not be marked as shipped.");
    } finally {
      setProcessingOrderId(null);
    }
  };

  const printWorkerPackingSheet = (order) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocked! Please allow popups to print packing sheets.");
      return;
    }

    const orderNo = order.order_no || "N/A";
    const customerName = order.customer_name || "Unnamed Customer";
    const orderDate = order.order_date ? formatOrderDate(order.order_date) : new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
    const items = order.items || [];
    const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalItems = items.length;

    const itemsHtml = items.map((item, idx) => {
      const imgUrl = item.product_image_url ? getStaticUrl(item.product_image_url) : "";
      const initials = getProductInitials(item.article_no, item.product_name);
      const articleNo = item.article_no || "&mdash;";
      const name = item.product_name || "&mdash;";
      const qty = Number(item.quantity || 0);

      return `
        <tr>
          <td style="text-align: center; width: 40px; color: #000000; font-weight: 800; font-size: 14px; border: 1.5px solid #000000;">${idx + 1}</td>
          <td style="width: 76px; text-align: center; border: 1.5px solid #000000;">
            ${imgUrl ? `<img src="${imgUrl}" alt="${articleNo}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 2px solid #000000; display: block; margin: auto;" />` : `<div style="width: 60px; height: 60px; border-radius: 4px; background: #ffffff; border: 2px solid #000000; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #000000; margin: auto; font-size: 18px;">${initials}</div>`}
          </td>
          <td style="border: 1.5px solid #000000;">
            <div style="font-weight: 900; font-size: 16.5px; color: #000000; letter-spacing: -0.01em;">${articleNo}</div>
            <div style="font-size: 13.5px; font-weight: 700; color: #000000; margin-top: 3px;">${name}</div>
          </td>
          <td style="text-align: center; width: 90px; border: 1.5px solid #000000;">
            <span style="font-weight: 900; font-size: 20px; color: #000000; border: 2px solid #000000; padding: 4px 14px; border-radius: 4px; display: inline-block;">
              ${qty}
            </span>
          </td>
          <td style="width: 60px; text-align: center; border: 1.5px solid #000000;">
            <div style="width: 24px; height: 24px; border: 2px solid #000000; border-radius: 3px; margin: auto;"></div>
          </td>
        </tr>
      `;
    }).join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Item List - Order #${orderNo}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm;
          }
          * {
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          body {
            margin: 0;
            padding: 16px;
            color: #000000;
            background: #ffffff;
            font-size: 14px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .sheet-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 3px solid #000000;
            padding-bottom: 10px;
            margin-bottom: 16px;
          }
          .customer-heading {
            font-size: 22px;
            font-weight: 900;
            color: #000000;
            letter-spacing: -0.02em;
          }
          .sheet-subtitle {
            font-size: 13px;
            color: #000000;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 3px;
          }
          .order-meta-box {
            text-align: right;
          }
          .order-main-number {
            font-size: 24px;
            font-weight: 900;
            color: #000000;
          }
          .order-date-text {
            font-size: 13.5px;
            color: #000000;
            font-weight: 800;
            margin-top: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
            border: 2px solid #000000;
          }
          th {
            background: #000000;
            color: #ffffff;
            font-size: 12.5px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 9px 10px;
            text-align: left;
            border: 1.5px solid #000000;
          }
          td {
            padding: 9px 10px;
            vertical-align: middle;
            color: #000000;
          }
          .sheet-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 16px;
            padding: 12px 16px;
            border: 2.5px solid #000000;
            border-radius: 6px;
            background: #ffffff;
          }
          .summary-metric {
            font-size: 16px;
            font-weight: 800;
            color: #000000;
          }
          .summary-metric strong {
            font-size: 22px;
            color: #000000;
            margin-left: 6px;
          }
          .worker-fill-section {
            margin-top: 18px;
            border: 2.5px solid #000000;
            border-radius: 6px;
            padding: 14px 18px;
            background: #ffffff;
          }
          .worker-fill-title {
            font-size: 14px;
            font-weight: 900;
            color: #000000;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 14px;
            border-bottom: 1.5px solid #000000;
            padding-bottom: 6px;
          }
          .worker-fill-grid {
            display: grid;
            grid-template-columns: 1.6fr 1fr 1fr;
            gap: 22px;
          }
          .worker-field-box {
            border-bottom: 2px solid #000000;
            padding-bottom: 8px;
          }
          .worker-field-label {
            font-size: 13px;
            font-weight: 900;
            color: #000000;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .worker-urdu-tag {
            font-family: "Segoe UI", Tahoma, "Noto Nastaliq Urdu", sans-serif;
            font-size: 15px;
            font-weight: 900;
            color: #000000;
            border: 1.5px solid #000000;
            padding: 0 8px;
            border-radius: 4px;
          }
          .worker-field-hint {
            font-size: 14px;
            color: #000000;
            font-weight: 800;
            letter-spacing: 2px;
          }
          @media print {
            body {
              padding: 0;
            }
            .no-print {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 16px; text-align: right;">
          <button onclick="window.print()" style="background: #000000; color: #ffffff; font-weight: 800; font-size: 14px; padding: 9px 20px; border: none; border-radius: 6px; cursor: pointer;">
            Print Sheet
          </button>
        </div>

        <div class="sheet-header">
          <div>
            <div class="customer-heading">${customerName}</div>
            <div class="sheet-subtitle">Item Picking & Packing Sheet</div>
          </div>
          <div class="order-meta-box">
            <div class="order-main-number">#${orderNo}</div>
            <div class="order-date-text">Date: ${orderDate}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="text-align: center; width: 40px;">#</th>
              <th style="width: 76px; text-align: center;">Thumbnail</th>
              <th>SKU / Item Description</th>
              <th style="text-align: center; width: 90px;">Quantity</th>
              <th style="text-align: center; width: 60px;">Check</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="sheet-summary">
          <div class="summary-metric">
            Total Items: <strong>${totalItems}</strong>
          </div>
          <div class="summary-metric">
            Total Units: <strong>${totalUnits} units</strong>
          </div>
        </div>

        <div class="worker-fill-section">
          <div class="worker-fill-title">Final Packing Details</div>
          <div class="worker-fill-grid">
            <div class="worker-field-box">
              <span class="worker-field-label">
                <span>Box Size (L &times; W &times; H)</span>
                <span class="worker-urdu-tag">&#x0688;&#x0628;&#x06CC; &#x06A9;&#x0627; &#x0633;&#x0627;&#x0626;&#x0632;</span>
              </span>
              <span class="worker-field-hint">_______ &times; _______ &times; _______</span>
            </div>
            <div class="worker-field-box">
              <span class="worker-field-label">
                <span>Gross Weight</span>
                <span class="worker-urdu-tag">&#x0648;&#x0632;&#x0646;</span>
              </span>
              <span class="worker-field-hint">_______ kg / lbs</span>
            </div>
            <div class="worker-field-box">
              <span class="worker-field-label">
                <span>Packed By</span>
              </span>
              <span class="worker-field-hint" style="font-size: 12px; font-weight: 700; letter-spacing: 0;">Worker Sign & Date</span>
            </div>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const startEditing = (record) => {

    setInlineEdit(null);

    setEditingShippingId(record.id);

    setEditData((previous) => ({

      ...previous,

      [record.id]: {

        courier_name: record.courier_name || "",

        dispatch_agent: record.dispatch_agent || "",

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

          dispatch_agent: data.dispatch_agent,

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

  const resolvedLabelBridgeUrl = normalizeApiBaseUrl(labelLocalPrintBridgeUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL;

  const labelPrinterConnectionModeLabel = labelUsesLocalPrinterBridge ? "This laptop" : "ERP server";

  const labelPrinterTransportLabel = labelUsesLocalPrinterBridge ? "Local bridge" : "ERP server";

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

      ? labelUsesLocalPrinterBridge ? "Local bridge unavailable" : "Printer status unavailable"

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

        new Set([

          "FedEx",

          "DHL",

          "UPS",

          "USPS",

          "TCS",

          "Leopards",

          "M&P",

          ...shippingRecords

            .map((record) => record.courier_name?.trim())

            .filter((c) => c && c.toLowerCase() !== "ontrac"),

        ])

      ).sort(),

    [shippingRecords]

  );



  const agentOptions = useMemo(

    () =>

      Array.from(

        new Set([

          "OnTrac",

          "SkyNet",

          "Direct",

          "Aramex",

          "Leopards",

          "TCS",

          ...shippingRecords

            .map((record) => record.dispatch_agent?.trim())

            .filter(Boolean),

        ])

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

        record.dispatch_agent,

        record.tracking_number,

      ].some((value) => String(value || "").toLowerCase().includes(query))

    );

  }, [historySearch, shippingRecords]);



  const visibleShippingRecords = useMemo(() => {

    return filteredShippingRecords.slice(0, visibleHistoryCount);

  }, [filteredShippingRecords, visibleHistoryCount]);



  useEffect(() => {

    setVisibleHistoryCount(10);

  }, [historySearch]);



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



      <datalist id="shipping-agent-list">

        {agentOptions.map((agent) => (

          <option key={agent} value={agent} />

        ))}

      </datalist>



      <section className="shipping-panel shipping-pending-panel">

        <div className="shipping-panel-header">

          <div className="shipping-panel-title">

            <h2>Pending dispatch</h2>

            {rateCard && (

              <small>

                Active USA rates: {rateCard.source_filename} Â· {rateCard.source_date}

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

                        <div className="shipping-detail-header-row">

                          <span className="shipping-detail-label">Ship to</span>

                          <button

                            className="shipping-print-sheet-btn"

                            onClick={(e) => {

                              e.stopPropagation();

                              printWorkerPackingSheet(order);

                            }}

                            title="Print Worker Order Packing Sheet with thumbnails, SKUs, quantities, and customer info"

                            type="button"

                          >

                            <Icon name="print" size={13} />

                            <span>Print Packing Sheet</span>

                          </button>

                        </div>

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

                            Order items Â· {itemCount} items Â· {unitCount} units

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

                                <img

                                  loading="lazy"

                                  decoding="async"

                                  alt={item.article_no || "Product"}

                                  className="shipping-item-thumbnail is-clickable"

                                  onClick={() => openProductDetail(item)}

                                  src={getStaticUrl(item.product_image_url)}

                                  title="Click to view product details"

                                />

                              ) : (

                                <span

                                  className="shipping-item-thumbnail-placeholder is-clickable"

                                  onClick={() => openProductDetail(item)}

                                  title="Click to view product details"

                                >

                                  {getProductInitials(item.article_no, item.product_name)}

                                </span>

                              )}

                              <div className="shipping-item-identity">

                                <strong

                                  className="shipping-item-article is-clickable"

                                  onClick={() => openProductDetail(item)}

                                  title="Click to view product details"

                                >

                                  {item.article_no}

                                </strong>

                                <span className="shipping-item-quantity">

                                  {"\u00d7"} {item.quantity}

                                </span>

                                {editingItemWeightKey === `${order.order_id}-${item.article_no}` ? (

                                  <div className="shipping-item-weight-edit-row">

                                    <input

                                      autoFocus

                                      disabled={savingItemWeight}

                                      min="0.001"

                                      onChange={(e) => setItemWeightInput(e.target.value)}

                                      onKeyDown={(e) => {

                                        if (e.key === "Enter") {

                                          e.preventDefault();

                                          saveItemWeight(order.order_id, item);

                                        }

                                        if (e.key === "Escape") cancelEditItemWeight();

                                      }}

                                      placeholder="kg/unit"

                                      step="0.001"

                                      type="number"

                                      value={itemWeightInput}

                                      className="shipping-item-weight-input"

                                    />

                                    <button

                                      className="shipping-item-weight-save-btn"

                                      disabled={savingItemWeight}

                                      onClick={() => saveItemWeight(order.order_id, item)}

                                      title="Save unit weight"

                                      type="button"

                                    >

                                      <Icon name="check" size={13} />

                                    </button>

                                    <button

                                      className="shipping-item-weight-cancel-btn"

                                      disabled={savingItemWeight}

                                      onClick={cancelEditItemWeight}

                                      title="Cancel"

                                      type="button"

                                    >

                                      <Icon name="close" size={12} />

                                    </button>

                                  </div>

                                ) : (

                                  <span

                                    className={`shipping-item-weight is-clickable ${

                                      Number(item.unit_weight_kg || 0) <= 0

                                        ? "is-missing-clickable"

                                        : ""

                                    }`}

                                    onClick={() => startEditItemWeight(order.order_id, item)}

                                    title={

                                      Number(item.unit_weight_kg || 0) <= 0

                                        ? "Click to enter product unit weight"

                                        : `Unit weight: ${item.unit_weight_kg} kg (click to edit)`

                                    }

                                  >

                                    {Number(item.unit_weight_kg || 0) > 0 ? (

                                      `${formatShippingWeight(item.line_weight_kg)} kg`

                                    ) : (

                                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>

                                        <span>Weight missing</span>

                                        <Icon name="edit" size={11} />

                                      </span>

                                    )}

                                  </span>

                                )}

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

                      {/* Integrated Rate Summary Card */}

                      <div className={`shipping-rate-card ${shippingEstimate.status === "ready" ? "is-ready" : "has-warning"}`}>

                        <div className="shipping-rate-card-header">

                          <div className="shipping-rate-card-title">

                            <Icon name="truck" size={14} />

                            <strong>USA OnTrac Rate</strong>

                          </div>

                          <div className="shipping-rate-service-wrap">

                            <span>Service:</span>

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

                              {(Array.isArray(rateCard?.services) && rateCard.services.length

                                ? rateCard.services

                                : [

                                    { value: "duty_paid", label: "Duty Paid Premium" },

                                    { value: "non_duty_paid", label: "Non-Duty Paid Premium" },

                                  ]

                              ).map((service) => (

                                <option key={service.value} value={service.value}>

                                  {service.label}

                                </option>

                              ))}

                            </select>

                          </div>

                        </div>



                        <div className="shipping-rate-grid-3">

                          <div className="shipping-rate-cell">

                            <span className="cell-label">Zone</span>

                            <strong className="cell-value">{shippingEstimate.zone_label || "Zone 1"}</strong>

                          </div>



                          <div className="shipping-rate-cell cell-weight">

                            <div className="cell-weight-header">

                              <span className="cell-label">Weight</span>

                              {!isEditingRateWeight && (

                                <button

                                  className="cell-edit-btn"

                                  onClick={() => startWeightEdit(order, shippingEstimate)}

                                  title="Edit calculation weight"

                                  type="button"

                                >

                                  <Icon name="edit" size={10} />

                                  Edit

                                </button>

                              )}

                            </div>

                            {isEditingRateWeight ? (

                              <div className="shipping-weight-inline-form">

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

                                      saveWeightOverride(order, weightEdits[order.order_id]);

                                    }

                                    if (event.key === "Escape") cancelWeightEdit(order.order_id);

                                  }}

                                  step="0.001"

                                  type="number"

                                  value={weightEdits[order.order_id]}

                                />

                                <button onClick={() => saveWeightOverride(order, weightEdits[order.order_id])} type="button"><Icon name="check" size={12} /></button>

                                <button onClick={() => cancelWeightEdit(order.order_id)} type="button"><Icon name="close" size={11} /></button>

                              </div>

                            ) : (

                              <div className="cell-weight-value-wrap">

                                <strong className="cell-value">

                                  {formatShippingWeight(shippingEstimate.calculation_weight_kg)} kg

                                </strong>

                                {shippingEstimate.billing_weight_kg && (

                                  <span className="cell-sub-tag">

                                    {formatShippingWeight(shippingEstimate.billing_weight_kg)} kg bill.

                                  </span>

                                )}

                              </div>

                            )}

                          </div>



                          <div className="shipping-rate-cell cell-rate">

                            <span className="cell-label">Est. Rate</span>

                            <strong className="cell-value cell-price">

                              {shippingEstimate.estimated_shipping_cost != null

                                ? formatShippingRate(shippingEstimate.estimated_shipping_cost)

                                : "—"}

                            </strong>

                          </div>

                        </div>



                        {shippingEstimate.weight_source === "manual" && (

                          <div className="shipping-rate-footnote">

                            <span>Manual weight active</span>

                            <button

                              disabled={savingWeightOrderId === order.order_id}

                              onClick={() => saveWeightOverride(order, null)}

                              type="button"

                            >

                              Reset

                            </button>

                          </div>

                        )}

                        {shippingEstimate.status !== "ready" && shippingEstimate.message && (

                          <div className="shipping-rate-footnote is-warning">

                            <Icon name="clock" size={11} />

                            <span>{shippingEstimate.message}</span>

                          </div>

                        )}

                      </div>



                      {/* Clean 2-Column Form Fields */}

                      <div className="shipping-form-sections">

                        {/* Row 1: Carrier & Agent */}

                        <div className="shipping-form-row">

                          <div className="shipping-form-group">

                            <label>Courier (Carrier)</label>

                            <div className="shipping-courier-btn-row">

                              {["FedEx", "DHL", "UPS", "USPS"].map((c) => {

                                const isSelected = (orderForm.courier_name || "").toLowerCase() === c.toLowerCase();

                                return (

                                  <button

                                    key={c}

                                    className={`shipping-courier-btn-item is-${c.toLowerCase()} ${isSelected ? "is-selected" : ""}`}

                                    onClick={() => handleFormChange(order.order_id, "courier_name", isSelected ? "" : c)}

                                    type="button"

                                  >

                                    {c}

                                  </button>

                                );

                              })}

                            </div>

                          </div>



                          <div className="shipping-form-group">

                            <label>Dispatch Agent / Broker</label>

                            <input

                              list="shipping-agent-list"

                              onChange={(event) =>

                                handleFormChange(

                                  order.order_id,

                                  "dispatch_agent",

                                  event.target.value

                                )

                              }

                              placeholder="e.g. On Track, SkyNet"

                              value={orderForm.dispatch_agent || ""}

                            />

                          </div>

                        </div>



                        {/* Row 2: Tracking Number */}

                        <div className="shipping-form-group is-fullwidth">

                          <label>Tracking Number</label>

                          <input

                            onChange={(event) =>

                              handleFormChange(

                                order.order_id,

                                "tracking_number",

                                event.target.value

                              )

                            }

                            placeholder="Enter or paste tracking number"

                            value={orderForm.tracking_number || ""}

                          />

                        </div>



                        {/* Row 3: Weight & Cost */}

                        <div className="shipping-form-row">

                          <div className="shipping-form-group">

                            <label>Package Weight (kg)</label>

                            <input

                              min="0.01"

                              onChange={(event) =>

                                handleFormChange(

                                  order.order_id,

                                  "package_weight_kg",

                                  event.target.value

                                )

                              }

                              placeholder="Weight"

                              step="0.01"

                              type="number"

                              value={packageWeightValue}

                            />

                          </div>



                          <div className="shipping-form-group">

                            <label>Shipping Cost (PKR)</label>

                            <input

                              min="0"

                              onChange={(event) =>

                                handleFormChange(

                                  order.order_id,

                                  "shipping_cost",

                                  event.target.value

                                )

                              }

                              placeholder="Shipping cost"

                              step="0.01"

                              type="number"

                              value={shippingCostValue}

                            />

                          </div>

                        </div>



                        {/* Row 4: Note */}

                        <div className="shipping-form-group is-fullwidth">

                          <label>Dispatch Note (Optional)</label>

                          <input

                            onChange={(event) =>

                              handleFormChange(

                                order.order_id,

                                "shipping_note",

                                event.target.value

                              )

                            }

                            placeholder="Optional dispatch or package notes..."

                            value={orderForm.shipping_note || ""}

                          />

                        </div>

                      </div>



                      <div className="shipping-card-actions">

                        <button

                          className={`shipping-share-button ${

                            copiedOrderId === order.order_id ? "is-copied" : ""

                          }`}

                          onClick={() => shareToWhatsApp(order)}

                          type="button"

                          title="Copy package details formatted for WhatsApp"

                        >

                          <Icon

                            name={copiedOrderId === order.order_id ? "check" : "whatsapp"}

                            size={15}

                          />

                          <span>

                            {copiedOrderId === order.order_id

                              ? "Copied to Clipboard!"

                              : "Copy for WhatsApp"}

                          </span>

                        </button>

                        <button

                          className="shipping-ship-button"

                          disabled={processingOrderId === order.order_id}

                          onClick={() => markAsShipped(order)}

                          type="button"

                        >

                          <Icon name="truck" size={16} />

                          <span>

                            {processingOrderId === order.order_id

                              ? "Processing..."

                              : "Mark as Shipped"}

                          </span>

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

                  <th>Company Name</th>

                  <th>Courier</th>

                  <th>Agent</th>

                  <th>Tracking</th>

                  <th>Status</th>

                  <th className="shipping-align-right">Weight</th>

                  <th className="shipping-align-right">Cost</th>

                  <th>Shipped</th>

                  <th>Note</th>

                  <th aria-label="Actions" />

                </tr>

              </thead>

              <tbody>

                {visibleShippingRecords.map((record) => {

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

                        <a
                          className="shipping-order-number shipping-order-link"
                          href={`/portal/orders/${record.order_id}`}
                          target="_blank"
                          // Keep this same-origin link in an auxiliary browser tab
                          // so installed-PWA navigation capture does not take it.
                          rel="opener"
                          aria-label={`Open order #${record.order_no} details in a new tab`}
                        >

                          #{record.order_no}

                        </a>

                      </td>

                      <td data-label="Customer">{record.customer_name || "-"}</td>

                      <td data-label="Company Name">{record.customer_company_name || "-"}</td>

                      <td data-label="Courier">

                        {isEditing ? (

                          <div className="shipping-edit-courier-wrap">

                            <div className="shipping-carrier-quick-picks">

                              {["FedEx", "DHL", "UPS", "USPS"].map((c) => (

                                <button

                                  key={c}

                                  className={`shipping-carrier-btn is-${c.toLowerCase()} ${(values.courier_name || record.courier_name || "").toLowerCase() === c.toLowerCase() ? "is-selected" : ""}`}

                                  onClick={() => handleEditChange(record.id, "courier_name", c)}

                                  type="button"

                                >

                                  {c}

                                </button>

                              ))}

                            </div>

                            <input

                              list="shipping-courier-list"

                              onChange={(event) =>

                                handleEditChange(

                                  record.id,

                                  "courier_name",

                                  event.target.value

                                )

                              }

                              placeholder="Courier name"

                              value={values.courier_name || ""}

                            />

                          </div>

                        ) : (

                          <span className={`shipping-courier-pill is-${(record.courier_name || "default").toLowerCase()}`}>

                            {record.courier_name || "Not set"}

                          </span>

                        )}

                      </td>

                      <td data-label="Agent">

                        {isEditing ? (

                          <input

                            list="shipping-agent-list"

                            onChange={(event) =>

                              handleEditChange(

                                record.id,

                                "dispatch_agent",

                                event.target.value

                              )

                            }

                            placeholder="Dispatch agent"

                            value={values.dispatch_agent || ""}

                          />

                        ) : (

                          <span className="shipping-agent-text">

                            {record.dispatch_agent || "-"}

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

                          <div className="shipping-tracking-cell-flex">

                            <span className="shipping-tracking-value">

                              {record.tracking_number}

                            </span>

                            <a

                              aria-label={`Track ${record.tracking_number} on ${record.courier_name || "FedEx"}`}

                              className="shipping-tracking-direct-link"

                              href={getCarrierTrackingUrl(record.courier_name, record.tracking_number)}

                              rel="noopener noreferrer"

                              target="_blank"

                              title={`Open direct tracking page on ${record.courier_name || "FedEx"}`}

                            >

                              <Icon name="external" size={13} />

                            </a>

                          </div>

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

                      <td data-label="Status">

                        {(() => {

                          const currentStatus = String(record.shipping_status || "Shipped").trim().toLowerCase();
                          const isDelivered = currentStatus === "delivered";
                          const isInTransit =
                            currentStatus === "in_transit" ||
                            currentStatus === "in transit";
                          const isWaiting = currentStatus === "waiting";
                          const isShipped = currentStatus === "shipped";
                          const isMenuOpen = statusMenuRecordId === record.id;
                          const isUpdating = updatingStatusRecordId === record.id;

                          let badgeClass = "is-in-transit";
                          let badgeText = "In Transit";
                          if (isDelivered) {
                            badgeClass = "is-delivered";
                            badgeText = "Delivered";
                          } else if (isWaiting) {
                            badgeClass = "is-waiting";
                            badgeText = "Waiting";
                          } else if (isInTransit) {
                            badgeClass = "is-in-transit";
                            badgeText = "In Transit";
                          } else if (isShipped) {
                            badgeClass = "is-shipped";
                            badgeText = "Shipped";
                          }



                          return (

                            <div className="shipping-status-cell">

                              <div className="shipping-status-badge-container">

                                <span className={`shipping-tracking-status-badge ${badgeClass}`}>

                                  <span className="shipping-status-dot" />

                                  <span>{badgeText}</span>

                                </span>

                                <div className="shipping-status-menu-anchor">

                                  <button

                                    aria-expanded={isMenuOpen}

                                    aria-haspopup="menu"

                                    aria-label={`Change status for order ${record.order_no}`}

                                    className={`shipping-status-menu-btn ${isMenuOpen ? "is-open" : ""}`}

                                    disabled={isUpdating}

                                    onClick={() => setStatusMenuRecordId((prev) => (prev === record.id ? null : record.id))}

                                    title="Click to manually change status (Delivered, In Transit, Shipped, etc.)"

                                    type="button"

                                  >

                                    <Icon name={isUpdating ? "refresh" : "chevron"} size={11} />

                                  </button>

                                  {isMenuOpen && (

                                    <>

                                      <div

                                        className="shipping-status-menu-backdrop"

                                        onClick={() => setStatusMenuRecordId(null)}

                                      />

                                      <div className="shipping-status-dropdown-menu" role="menu">

                                        <button

                                          className={`shipping-status-menu-item ${isDelivered ? "is-active" : ""}`}

                                          onClick={() => handleManualStatusChange(record, "delivered")}

                                          role="menuitem"

                                          type="button"

                                        >

                                          <span className="shipping-status-menu-dot is-delivered" />

                                          <span>Mark Delivered</span>

                                        </button>

                                        <button

                                          className={`shipping-status-menu-item ${isInTransit ? "is-active" : ""}`}

                                          onClick={() => handleManualStatusChange(record, "in_transit")}

                                          role="menuitem"

                                          type="button"

                                        >

                                          <span className="shipping-status-menu-dot is-in-transit" />

                                          <span>Mark In Transit</span>

                                        </button>

                                        <button
                                          className={`shipping-status-menu-item ${isWaiting ? "is-active" : ""}`}
                                          onClick={() => handleManualStatusChange(record, "waiting")}
                                          role="menuitem"
                                          type="button"
                                        >
                                          <span className="shipping-status-menu-dot is-waiting" />
                                          <span>Mark Waiting</span>
                                        </button>

                                      </div>

                                    </>

                                  )}

                                </div>

                              </div>

                            </div>

                          );

                        })()}

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



        {filteredShippingRecords.length > 10 && (

          <div className="shipping-history-footer">

            <span className="shipping-history-counter">

              Showing <strong>{Math.min(visibleHistoryCount, filteredShippingRecords.length)}</strong> of <strong>{filteredShippingRecords.length}</strong> shipped orders

            </span>

            <div className="shipping-history-actions">

              {filteredShippingRecords.length > visibleHistoryCount && (

                <>

                  <button

                    className="shipping-see-more-btn"

                    onClick={() => setVisibleHistoryCount((prev) => prev + 10)}

                    type="button"

                  >

                    <span>See more (+10)</span>

                  </button>

                  <button

                    className="shipping-see-all-btn"

                    onClick={() => setVisibleHistoryCount(filteredShippingRecords.length)}

                    type="button"

                  >

                    <span>Show all ({filteredShippingRecords.length})</span>

                  </button>

                </>

              )}

              {visibleHistoryCount > 10 && (

                <button

                  className="shipping-see-less-btn"

                  onClick={() => setVisibleHistoryCount(10)}

                  type="button"

                >

                  <span>Show less</span>

                </button>

              )}

            </div>

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

      {detailProduct &&

        (() => {

          const stockStatus = getStockStatus(detailProduct);

          const detailImageUrl = getStaticUrl(detailProduct.image_url);

          const detailShareImageUrl = getStaticUrl(detailProduct.share_image_url);

          const detailNoteLines = getNoteLines(detailProduct.notes);



          return (

            <div

              className="products-modal-overlay"

              onMouseDown={(event) => {

                if (event.target === event.currentTarget) closeDetails();

              }}

            >

              <div

                aria-labelledby="products-details-title"

                aria-modal="true"

                className="products-modal products-details-modal"

                role="dialog"

              >

                <div className="products-modal-header">

                  <div className="products-details-header-main">

                    <div>

                      <span className="products-section-label">Catalog details</span>

                      <h2 id="products-details-title">

                        {detailProduct.article_no || "Product details"}

                      </h2>

                      <p>{detailProduct.name || "Unnamed product"}</p>

                    </div>

                    <span className={`products-status-pill is-${stockStatus.tone}`}>

                      {stockStatus.label}

                    </span>

                  </div>

                  <button

                    aria-label="Close product details"

                    className="products-modal-close"

                    onClick={closeDetails}

                    type="button"

                  >

                    <Icon name="close" size={18} />

                  </button>

                </div>



                <div className="products-details-content">

                  <section className="products-details-main">

                    <div className="products-details-media">

                      {detailImageUrl ? (

                        <div className="products-details-image-frame">

                          <img

                            loading="lazy"

                            decoding="async"

                            alt={detailProduct.name || detailProduct.article_no}

                            src={detailImageUrl}

                          />

                          <button

                            aria-label="View product image larger"

                            className="products-details-image-view"

                            onClick={() =>

                              setProductImagePreview({

                                alt:

                                  detailProduct.name ||

                                  detailProduct.article_no ||

                                  "Product image",

                                subtitle:

                                  detailProduct.article_no ||

                                  detailProduct.category ||

                                  "Product image",

                                title: detailProduct.name || "Product image",

                                url: detailImageUrl,

                                label: "Product image",

                              })

                            }

                            type="button"

                          >

                            <Icon name="eye" size={15} />

                          </button>

                        </div>

                      ) : (

                        <span className="products-details-placeholder">

                          <Icon name="image" size={34} />

                        </span>

                      )}

                    </div>



                    <section className="products-details-grid">

                      <div>

                        <span>Factory stock</span>

                        <strong>{Number(detailProduct.factory_stock || 0).toLocaleString()}</strong>

                      </div>

                      <div>

                        <span>USA stock</span>

                        <strong>{Number(detailProduct.usa_stock || 0).toLocaleString()}</strong>

                      </div>

                      <div>

                        <span>Wholesale</span>

                        <strong>{formatUsdCurrency(detailProduct.cost_price)}</strong>

                      </div>

                      <div>

                        <span>MSRP / retail</span>

                        <strong>{formatUsdCurrency(detailProduct.selling_price)}</strong>

                      </div>

                      <div>

                        <span>Reserved</span>

                        <strong>{Number(detailProduct.reserved_stock || 0).toLocaleString()}</strong>

                      </div>

                      <div>

                        <span>Available</span>

                        <strong>{Number(detailProduct.available_stock || 0).toLocaleString()}</strong>

                      </div>

                      <div>

                        <span>Unit Weight</span>

                        <strong>{detailProduct.unit_weight_kg ? `${detailProduct.unit_weight_kg} kg` : "Not set"}</strong>

                      </div>

                      <div>

                        <span>Workflow</span>

                        <strong>

                          {detailProduct.workflow_required

                            ? "Required"

                            : "Not required"}

                        </strong>

                      </div>

                    </section>

                  </section>



                  {detailShareImageUrl && (

                    <section className="products-details-section products-share-image-section">

                      <h3>Share image</h3>

                      <div className="products-share-image-row">

                        <button

                          className="products-share-image-card"

                          onClick={() =>

                            setProductImagePreview({

                              alt:

                                detailProduct.name ||

                                detailProduct.article_no ||

                                "Share image",

                              subtitle:

                                detailProduct.article_no ||

                                detailProduct.category ||

                                "Share image",

                              title: detailProduct.name || "Share image",

                              url: detailShareImageUrl,

                              label: "Share image",

                            })

                          }

                          type="button"

                        >

                          <img

                            loading="lazy"

                            decoding="async"

                            alt={detailProduct.name || detailProduct.article_no || "Share image"}

                            src={detailShareImageUrl}

                          />

                          <span>

                            <strong>Open share image</strong>

                            <small>{detailProduct.article_no || detailProduct.category || "Customer visual"}</small>

                          </span>

                        </button>

                      </div>

                    </section>

                  )}



                  {detailNoteLines.length > 0 && (

                    <section className="products-details-section">

                      <h3>Product notes</h3>

                      <ul className="products-details-note-list">

                        {detailNoteLines.map((note, index) => (

                          <li key={`${note}-${index}`}>{note}</li>

                        ))}

                      </ul>

                    </section>

                  )}

                </div>



                <div className="products-form-footer">

                  <button

                    className="products-secondary-button"

                    onClick={closeDetails}

                    type="button"

                  >

                    Close

                  </button>

                </div>

              </div>

            </div>

          );

        })()}



      {productImagePreview && (

        <div

          className="products-image-preview-overlay"

          onMouseDown={(event) => {

            if (event.target === event.currentTarget) setProductImagePreview(null);

          }}

        >

          <div className="products-image-preview-dialog" role="dialog">

            <div className="products-image-preview-header">

              <div>

                <span className="products-image-preview-badge">

                  {productImagePreview.label}

                </span>

                <h3>{productImagePreview.title}</h3>

                <p>{productImagePreview.subtitle}</p>

              </div>

              <button

                aria-label="Close image preview"

                className="products-modal-close"

                onClick={() => setProductImagePreview(null)}

                type="button"

              >

                <Icon name="close" size={18} />

              </button>

            </div>

            <div className="products-image-preview-body">

              <img

                loading="lazy"

                decoding="async"

                alt={productImagePreview.alt}

                src={productImagePreview.url}

              />

            </div>

          </div>

        </div>

      )}

    </div>

  );

}



export default Shipping;
