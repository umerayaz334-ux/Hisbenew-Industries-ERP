import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import JsBarcode from "jsbarcode";
import api, { getStaticUrl } from "../api/api";
import "./LabelPrinter.css";

const DEFAULT_PRESETS = [
  { id: "product-50x25", name: "Product 50 x 25 mm", width: 50, height: 25, gap: 2 },
  { id: "product-70x35", name: "Product 70 x 35 mm", width: 70, height: 35, gap: 2 },
  { id: "product-100x50", name: "Product 100 x 50 mm", width: 100, height: 50, gap: 3 },
  { id: "shipping-100x150", name: "Shipping 100 x 150 mm", width: 100, height: 150, gap: 3 },
];

const CUSTOM_SIZE_STORAGE_KEY = "erpLabelPrinterCustomSizes";
const DESIGN_STORAGE_KEY = "erpLabelPrinterSavedDesigns";
const PRODUCT_DESIGN_STORAGE_KEY = "erpLabelPrinterProductDesigns";
const PRINT_ROTATION_STORAGE_KEY = "erpLabelPrinterPrintRotation";
const QUEUE_STORAGE_KEY = "erpLabelPrinterQueue";
const DRAFT_ITEM_STORAGE_KEY = "erpLabelPrinterDraftItem";
const SELECTED_SIZE_STORAGE_KEY = "erpLabelPrinterSelectedSize";
const SELECTED_QUEUE_ITEM_STORAGE_KEY = "erpLabelPrinterSelectedQueueItem";
const ACTIVE_LAYER_STORAGE_KEY = "erpLabelPrinterActiveLayer";
const DESIGN_CLIPBOARD_STORAGE_KEY = "erpLabelPrinterDesignClipboard";
const PRINTER_CONNECTION_MODE_STORAGE_KEY = "erpLabelPrinterConnectionMode";
const LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY = "erpLabelPrinterLocalBridgeUrl";
const DEFAULT_LOCAL_PRINT_BRIDGE_URL = "http://127.0.0.1:8000";

const normalizeApiBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const isLoopbackHostname = (hostname) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(hostname || "").toLowerCase());

const shouldUseLocalPrinterBridgeByDefault = () => {
  if (typeof window === "undefined") return false;
  return isLoopbackHostname(window.location.hostname);
};

const readStoredText = (key, fallback = "") => {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const getInitialPrinterConnectionMode = () => {
  if (typeof window !== "undefined" && !isLoopbackHostname(window.location.hostname)) {
    return "server";
  }
  const savedMode = readStoredText(PRINTER_CONNECTION_MODE_STORAGE_KEY);
  if (["local", "server"].includes(savedMode)) return savedMode;
  return "server";
};

const getInitialLocalPrintBridgeUrl = () =>
  normalizeApiBaseUrl(readStoredText(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, DEFAULT_LOCAL_PRINT_BRIDGE_URL)) ||
  DEFAULT_LOCAL_PRINT_BRIDGE_URL;

const buildPrintBridgeUrl = (baseUrl, path) =>
  `${normalizeApiBaseUrl(baseUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL}${path.startsWith("/") ? path : `/${path}`}`;

const getPrinterApiError = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

const SAVED_DESIGN_FIELDS = [
  "brand",
  "title",
  "price",
  "showBrand",
  "showPrice",
  "showBarcode",
  "showImage",
  "brandAlign",
  "titleAlign",
  "skuAlign",
  "priceAlign",
  "brandScale",
  "titleScale",
  "skuScale",
  "priceScale",
  "barcodeScale",
  "barcodeHeightScale",
  "layerOrder",
  "layerOffsets",
];

const COPY_STYLE_FIELDS = SAVED_DESIGN_FIELDS.filter((field) => !["title", "price"].includes(field));

const pickLabelFields = (item, fields) =>
  Object.fromEntries(fields.map((field) => [field, item[field]]));

const TEXT_LAYERS = [
  { id: "brand", label: "Brand", field: "brand", alignField: "brandAlign", scaleField: "brandScale", visibleField: "showBrand" },
  { id: "title", label: "Handmade category", field: "title", alignField: "titleAlign", scaleField: "titleScale" },
  { id: "sku", label: "SKU number", field: "sku", alignField: "skuAlign", scaleField: "skuScale" },
  { id: "price", label: "Price / note", field: "price", alignField: "priceAlign", scaleField: "priceScale", visibleField: "showPrice" },
];

const DEFAULT_LAYER_ORDER = ["brand", "title", "price", "image", "barcode", "sku"];

const getLayerOrder = (item) => {
  const knownLayers = new Set(DEFAULT_LAYER_ORDER);
  const savedOrder = Array.isArray(item?.layerOrder)
    ? item.layerOrder.filter((layerId) => knownLayers.has(layerId))
    : [];
  return [...new Set([...savedOrder, ...DEFAULT_LAYER_ORDER])];
};

const getLayerOffset = (item, layerId) => {
  const value = Number(item?.layerOffsets?.[layerId] || 0);
  return Number.isFinite(value) ? Math.max(-8, Math.min(8, value)) : 0;
};

const getLayerAlignment = (item, layerId) => {
  const textLayer = TEXT_LAYERS.find((layer) => layer.id === layerId);
  return textLayer ? item[textLayer.alignField] || "left" : "center";
};

const formatPrice = (value) => {
  const amount = Number(value || 0);
  return amount > 0
    ? `PKR ${amount.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`
    : "";
};

const singularizeCategoryWord = (word) => {
  if (/knives$/i.test(word)) return word.replace(/knives$/i, "knife");
  if (/ies$/i.test(word) && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/i.test(word)) return word.replace(/es$/i, "");
  if (/ves$/i.test(word) && word.length > 3) return `${word.slice(0, -3)}f`;
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
};

const formatDefaultLabelTitle = (product = null) => {
  const rawCategory = String(product?.category || product?.name || "PRODUCT")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^handmade\s+/i, "");
  const words = (rawCategory || "PRODUCT").split(" ");
  const lastWord = words.pop() || "PRODUCT";
  const normalizedCategory = [...words, singularizeCategoryWord(lastWord)].join(" ");
  return `HANDMADE ${normalizedCategory.toUpperCase()}`;
};

const escapeHtml = (value) =>
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

const createBarcodeSvg = (value, height = 48, scale = 1, heightScale = 1) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, String(value || "LABEL"), {
      format: "CODE128",
      width: Math.max(0.8, 1.2 * Number(scale || 1)),
      height: height * Number(scale || 1) * Number(heightScale || 1),
      margin: 0,
      displayValue: false,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return svg.outerHTML;
  } catch {
    return "";
  }
};

const createQueueItem = (product = null) => ({
  id: `label-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  productId: product?.id || null,
  productName: product?.name || "Custom label",
  articleNo: product?.article_no || "",
  imageUrl: product?.image_url || "",
  quantity: 1,
  brand: "HISBENEW INDUSTRIES",
  title: formatDefaultLabelTitle(product),
  sku: product?.article_no || "",
  price: formatPrice(product?.selling_price),
  barcode: product?.article_no || "LABEL",
  showBrand: false,
  showPrice: false,
  showBarcode: true,
  showImage: false,
  brandAlign: "left",
  titleAlign: "center",
  skuAlign: "center",
  priceAlign: "left",
  brandScale: 1,
  titleScale: 1.3,
  skuScale: 1.55,
  priceScale: 1,
  barcodeScale: 1,
  barcodeHeightScale: 1,
  layerOrder: [...DEFAULT_LAYER_ORDER],
  layerOffsets: {},
});

const getLabelPrintCount = (item) => Math.max(1, Math.min(1000, Number(item?.quantity) || 1));

const getBarcodeHeightScale = (item) => Math.max(0.55, Math.min(2, Number(item?.barcodeHeightScale) || 1));

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const normalizeStoredLabelItem = (item) => {
  if (!isPlainObject(item)) return null;
  const fallback = createQueueItem();
  return {
    ...fallback,
    ...item,
    id: String(item.id || fallback.id),
    productId: item.productId ?? null,
    productName: String(item.productName || item.productName === "" ? item.productName : fallback.productName),
    articleNo: String(item.articleNo || ""),
    imageUrl: String(item.imageUrl || ""),
    quantity: getLabelPrintCount(item),
    brand: String(item.brand || ""),
    title: String(item.title || fallback.title),
    sku: String(item.sku || ""),
    price: String(item.price || ""),
    barcode: String(item.barcode || item.sku || "LABEL"),
    showBrand: Boolean(item.showBrand),
    showPrice: Boolean(item.showPrice),
    showBarcode: item.showBarcode !== false,
    showImage: Boolean(item.showImage),
    layerOrder: getLayerOrder(item),
    layerOffsets: isPlainObject(item.layerOffsets) ? item.layerOffsets : {},
  };
};

const readStoredJson = (key, fallback) => {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue == null ? fallback : JSON.parse(rawValue);
  } catch {
    return fallback;
  }
};

const BarcodePreview = ({ value, height, scale = 1, heightScale = 1 }) => {
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
  }, [height, scale, value]);

  return <svg aria-label={`Barcode ${value || "label"}`} ref={barcodeRef} role="img" />;
};

const LabelPreview = ({ item, size, isPrint = false }) => {
  const width = Number(size?.width || 50);
  const height = Number(size?.height || 25);
  const scale = Math.min(5.4, 360 / width, 300 / height);
  const previewWidth = Math.max(180, width * scale);
  const previewHeight = Math.max(90, height * scale);
  const compact = height <= 30;
  const textBaseSize = Math.max(9, Math.min(18, height * 0.42));
  const independentTextBaseSize = Math.max(9, Math.min(18, textBaseSize * 1.3));
  const titleSize = Math.max(9, Math.min(18, textBaseSize * Number(item.titleScale || 1)));
  const brandSize = Math.max(7, independentTextBaseSize * 0.48 * Number(item.brandScale || 1));
  const skuSize = Math.max(9, independentTextBaseSize * 0.78 * Number(item.skuScale || 1));
  const priceSize = Math.max(7, independentTextBaseSize * 0.62 * Number(item.priceScale || 1));
  const barcodeHeight = Math.max(20, Math.min(54, previewHeight * (compact ? 0.21 : 0.19)));
  const barcodeScale = Math.max(0.55, Math.min(1.6, Number(item.barcodeScale || 1)));
  const barcodeHeightScale = getBarcodeHeightScale(item);
  const sku = item.sku || item.subtitle || item.barcode || "LABEL";

  const renderLayer = (layerId) => {
    if (layerId === "brand") {
      return item.showBrand && item.brand ? <span className={`label-printer-preview-brand is-align-${item.brandAlign || "left"}`}>{item.brand}</span> : null;
    }
    if (layerId === "title") {
      return <strong className={`label-printer-preview-title is-align-${item.titleAlign || "left"}`}>{item.title || "Untitled label"}</strong>;
    }
    if (layerId === "price") {
      return item.showPrice && item.price ? <span className={`label-printer-preview-price is-align-${item.priceAlign || "left"}`}>{item.price}</span> : null;
    }
    if (layerId === "image") {
      return item.showImage && item.imageUrl ? <div className="label-printer-preview-image"><img alt="" src={getStaticUrl(item.imageUrl)} /></div> : null;
    }
    if (layerId === "barcode") {
      return item.showBarcode ? <div className="label-printer-preview-barcode"><BarcodePreview height={barcodeHeight} heightScale={barcodeHeightScale} scale={barcodeScale} value={item.barcode} /></div> : null;
    }
    if (layerId === "sku") {
      return item.showBarcode ? <small className={`label-printer-preview-sku is-align-${item.skuAlign || "center"}`}>{sku}</small> : null;
    }
    return null;
  };

  return (
    <article
      className={`label-printer-preview ${compact ? "is-compact" : ""} ${item.showImage ? "has-image" : ""} ${isPrint ? "is-print" : ""}`}
      style={{
        "--label-preview-width": `${previewWidth}px`,
        "--label-preview-height": `${previewHeight}px`,
        "--label-title-size": `${titleSize}px`,
        "--label-brand-size": `${brandSize}px`,
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
            className={`label-printer-preview-layer is-align-${getLayerAlignment(item, layerId)}`}
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

const LayerPlacementControl = ({ item, layerId, onAdjust }) => {
  const offset = getLayerOffset(item, layerId);
  return (
    <div className="label-printer-layer-placement">
      <span>Vertical placement <strong>{offset.toFixed(1)} mm</strong></span>
      <div aria-label="Vertical placement" className="label-printer-vertical-position" role="group">
        <button aria-label="Move up" onClick={() => onAdjust(layerId, -0.5)} title="Move up" type="button">&#8593;</button>
        <button aria-label="Reset vertical placement" className={offset === 0 ? "is-active" : ""} onClick={() => onAdjust(layerId, null)} title="Reset position" type="button">0</button>
        <button aria-label="Move down" onClick={() => onAdjust(layerId, 0.5)} title="Move down" type="button">&#8595;</button>
      </div>
    </div>
  );
};

const buildPrintDocument = (items, size, printRotation = "clockwise") => {
  const width = Number(size.width);
  const height = Number(size.height);
  const isRotated = printRotation === "clockwise" || printRotation === "counterclockwise";
  const pageWidth = isRotated ? height : width;
  const pageHeight = isRotated ? width : height;
  const compact = height <= 30;
  const labels = items.flatMap((item) =>
    Array.from({ length: Math.max(1, Math.min(1000, Number(item.quantity) || 1)) }, () => {
      const barcodeHeightScale = getBarcodeHeightScale(item);
      const barcode = item.showBarcode ? createBarcodeSvg(item.barcode, compact ? 36 : 58, item.barcodeScale || 1, barcodeHeightScale) : "";
      const imageUrl = item.showImage && item.imageUrl ? getStaticUrl(item.imageUrl) : "";
      const sku = item.sku || item.subtitle || item.barcode || "LABEL";
      const layerMarkup = getLayerOrder(item).map((layerId) => {
        let content = "";
        if (layerId === "brand") content = item.showBrand && item.brand ? `<span class="brand align-${item.brandAlign || "left"}">${escapeHtml(item.brand)}</span>` : "";
        if (layerId === "title") content = `<strong class="title align-${item.titleAlign || "left"}">${escapeHtml(item.title || "Untitled label")}</strong>`;
        if (layerId === "price") content = item.showPrice && item.price ? `<span class="price align-${item.priceAlign || "left"}">${escapeHtml(item.price)}</span>` : "";
        if (layerId === "image") content = imageUrl ? `<div class="label-image"><img alt="" src="${escapeHtml(imageUrl)}" /></div>` : "";
        if (layerId === "barcode") content = item.showBarcode ? `<div class="barcode">${barcode}</div>` : "";
        if (layerId === "sku") content = item.showBarcode ? `<small class="sku align-${item.skuAlign || "center"}">${escapeHtml(sku)}</small>` : "";
        if (!content) return "";
        return `<div class="layer align-${getLayerAlignment(item, layerId)}" style="margin-top:${getLayerOffset(item, layerId)}mm">${content}</div>`;
      }).join("");
      return `<section class="print-sheet ${isRotated ? `rotate-${printRotation}` : ""}"><article class="label ${compact ? "compact" : ""}" style="--brand-scale:${Number(item.brandScale || 1)};--title-scale:${Number(item.titleScale || 1)};--sku-scale:${Number(item.skuScale || 1)};--price-scale:${Number(item.priceScale || 1)};--barcode-scale:${Number(item.barcodeScale || 1)};--barcode-height-scale:${barcodeHeightScale}">${layerMarkup}</article></section>`;
    })
  );

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>ERP label print</title>
        <style>
          * { box-sizing: border-box; }
          @page { size: ${pageWidth}mm ${pageHeight}mm; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; color: #102b29; font-family: Arial, Helvetica, sans-serif; }
          .print-sheet { width: ${pageWidth}mm; height: ${pageHeight}mm; overflow: hidden; break-after: page; page-break-after: always; }
          .print-sheet:last-child { break-after: auto; page-break-after: auto; }
          .label { width: ${width}mm; height: ${height}mm; padding: 1.45mm; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: .45mm; }
          .rotate-clockwise .label { transform: translateX(${height}mm) rotate(90deg); transform-origin: top left; }
          .rotate-counterclockwise .label { transform: translateY(${width}mm) rotate(-90deg); transform-origin: top left; }
          .layer { min-width: 0; }
          .label-image { height: 9mm; display: grid; overflow: hidden; place-items: center; }
          .label-image img { width: 100%; height: 100%; object-fit: contain; }
          .brand, .title, .sku { width: 100%; }
          .brand { color: #5f716d; font-size: calc(5px * var(--brand-scale)); font-weight: 700; letter-spacing: .06em; line-height: 1; }
          .title { font-size: calc(9px * var(--title-scale)); line-height: 1.08; overflow: hidden; }
          .price { align-self: flex-start; border-radius: .7mm; background: #e6f0ea; color: #17473e; padding: .45mm .9mm; font-size: calc(6px * var(--price-scale)); font-weight: 700; line-height: 1; }
          .barcode { min-width: 0; display: grid; justify-items: center; }
          .barcode svg { width: min(100%, calc(78% * var(--barcode-scale, 1))); max-height: calc(16mm * var(--barcode-scale, 1) * var(--barcode-height-scale, 1)); }
          .sku { color: #000; font-size: calc(7px * var(--sku-scale)); font-weight: 900; letter-spacing: .05em; line-height: 1; }
          .compact { padding: 1.15mm; gap: .3mm; }
          .compact .label-image { height: 6mm; }
          .compact .brand { font-size: calc(4px * var(--brand-scale)); }
          .compact .title { font-size: calc(7px * var(--title-scale)); }
          .compact .sku { font-size: calc(6px * var(--sku-scale)); }
          .compact .price { font-size: calc(5px * var(--price-scale)); }
          .compact .barcode svg { max-height: calc(9mm * var(--barcode-scale, 1) * var(--barcode-height-scale, 1)); }
          .align-left { text-align: left; }
          .align-center { text-align: center; }
          .align-right { text-align: right; }
          @media screen { body { display: grid; justify-content: center; gap: 14px; padding: 14px; background: #e8edeb; } .label { background: #fff; box-shadow: 0 5px 18px rgba(16,43,41,.14); } }
          @media print { body { display: block; } .label { box-shadow: none; } }
        </style>
      </head>
      <body>${labels.join("")}</body>
    </html>`;
};

function LabelPrinter() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productSearch, setProductSearch] = useState("");
  const [queue, setQueue] = useState([]);
  const [draftItem, setDraftItem] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [customSizes, setCustomSizes] = useState([]);
  const [selectedSizeId, setSelectedSizeId] = useState(DEFAULT_PRESETS[0].id);
  const [showNewSize, setShowNewSize] = useState(false);
  const [newSize, setNewSize] = useState({ name: "", width: "50", height: "25", gap: "2" });
  const [notice, setNotice] = useState("");
  const [activeLayer, setActiveLayer] = useState("title");
  const [savedDesigns, setSavedDesigns] = useState([]);
  const [productDesigns, setProductDesigns] = useState({});
  const [printRotation, setPrintRotation] = useState("clockwise");
  const [storageReady, setStorageReady] = useState(false);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [designName, setDesignName] = useState("");
  const [designClipboard, setDesignClipboard] = useState(null);
  const [directPrinter, setDirectPrinter] = useState("");
  const [directPrinting, setDirectPrinting] = useState(false);
  const [printerOptions, setPrinterOptions] = useState([]);
  const [printerStatus, setPrinterStatus] = useState({ loading: true, error: "" });
  const [printerConnectionMode, setPrinterConnectionMode] = useState(getInitialPrinterConnectionMode);
  const [localPrintBridgeUrl, setLocalPrintBridgeUrl] = useState(getInitialLocalPrintBridgeUrl);

  const useLocalPrinterBridge = printerConnectionMode === "local";
  const resolvedLocalPrintBridgeUrl = normalizeApiBaseUrl(localPrintBridgeUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL;
  const printerConnectionModeLabel = useLocalPrinterBridge ? "This laptop" : "ERP server";
  const localPrintBridgeUnavailable = `Local printer bridge is not reachable at ${resolvedLocalPrintBridgeUrl}. Start the local printer bridge on this laptop, or click "ERP server" to print via Print Agent.`;

  const fetchLocalPrinterBridge = async (path, options = {}) => {
    let response;
    try {
      response = await fetch(buildPrintBridgeUrl(resolvedLocalPrintBridgeUrl, path), {
        ...options,
        targetAddressSpace: "loopback",
        headers: {
          Accept: "application/json",
          ...(options.headers || {}),
        },
      });
    } catch {
      const bridgeError = new Error(localPrintBridgeUnavailable);
      bridgeError.response = { data: { detail: localPrintBridgeUnavailable } };
      throw bridgeError;
    }

    const rawText = await response.text();
    let data = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { detail: rawText };
      }
    }

    if (!response.ok) {
      const detail = data?.detail || `Local printer bridge returned ${response.status}.`;
      const requestError = new Error(detail);
      requestError.response = { data: { detail } };
      throw requestError;
    }

    return { data };
  };

  const getPrinterStatus = () =>
    useLocalPrinterBridge ? fetchLocalPrinterBridge("/local-label-printers") : api.get("/print-agent/printers");

  const postPrinterLabels = (payload) =>
    useLocalPrinterBridge
      ? fetchLocalPrinterBridge("/local-label-printers/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : api.post("/print-agent/print", payload);

  useEffect(() => {
    let active = true;
    api
      .get("/products")
      .then((response) => {
        if (active) setProducts(Array.isArray(response.data) ? response.data : []);
      })
      .catch(() => {
        if (active) setNotice("Products could not be loaded. You can still create custom labels.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadLabelPrinters = async ({ showNotice = false } = {}) => {
    setPrinterStatus({ loading: true, error: "" });
    try {
      const response = await getPrinterStatus();
      const printers = Array.isArray(response.data?.printers) ? response.data.printers : [];
      setPrinterOptions(printers);
      setDirectPrinter((current) => {
        if (current && printers.some((printer) => printer.name === current)) return current;
        return response.data?.default_printer || printers.find((printer) => printer.is_default)?.name || printers[0]?.name || "";
      });
      setPrinterStatus({ loading: false, error: "" });
      if (showNotice) {
        const connectedCount = printers.filter((printer) => printer.is_connected).length;
        setNotice(
          printers.length
            ? `${connectedCount} of ${printers.length} printer${printers.length === 1 ? "" : "s"} connected on ${printerConnectionModeLabel}.`
            : `No printers were found on ${printerConnectionModeLabel}.`
        );
      }
    } catch (error) {
      const detail = getPrinterApiError(error, "Printer status could not be checked.");
      setPrinterOptions([]);
      setDirectPrinter("");
      setPrinterStatus({ loading: false, error: detail });
      if (showNotice) setNotice(detail);
    }
  };

  useEffect(() => {
    loadLabelPrinters();
  }, [printerConnectionMode, resolvedLocalPrintBridgeUrl]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PRINTER_CONNECTION_MODE_STORAGE_KEY, printerConnectionMode);
      window.localStorage.setItem(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, resolvedLocalPrintBridgeUrl);
    } catch {
      // Printer connection settings are best-effort browser preferences.
    }
  }, [printerConnectionMode, resolvedLocalPrintBridgeUrl]);

  useEffect(() => {
    try {
      const savedSizes = readStoredJson(CUSTOM_SIZE_STORAGE_KEY, []);
      const savedDesignList = readStoredJson(DESIGN_STORAGE_KEY, []);
      const savedProductLayouts = readStoredJson(PRODUCT_DESIGN_STORAGE_KEY, {});
      const savedQueue = readStoredJson(QUEUE_STORAGE_KEY, []);
      const savedDraftItem = readStoredJson(DRAFT_ITEM_STORAGE_KEY, null);
      const savedDesignClipboard = readStoredJson(DESIGN_CLIPBOARD_STORAGE_KEY, null);
      const savedPrintRotation = window.localStorage.getItem(PRINT_ROTATION_STORAGE_KEY);
      const savedSelectedSizeId = window.localStorage.getItem(SELECTED_SIZE_STORAGE_KEY);
      const savedSelectedQueueItemId = window.localStorage.getItem(SELECTED_QUEUE_ITEM_STORAGE_KEY);
      const savedActiveLayer = window.localStorage.getItem(ACTIVE_LAYER_STORAGE_KEY);

      if (Array.isArray(savedSizes)) setCustomSizes(savedSizes);
      if (Array.isArray(savedDesignList)) setSavedDesigns(savedDesignList);
      if (isPlainObject(savedProductLayouts)) setProductDesigns(savedProductLayouts);
      if (["normal", "clockwise", "counterclockwise"].includes(savedPrintRotation)) {
        setPrintRotation(savedPrintRotation);
      }
      if (savedSelectedSizeId) setSelectedSizeId(savedSelectedSizeId);
      if (DEFAULT_LAYER_ORDER.includes(savedActiveLayer)) setActiveLayer(savedActiveLayer);
      if (isPlainObject(savedDesignClipboard)) setDesignClipboard(savedDesignClipboard);

      const restoredQueue = Array.isArray(savedQueue)
        ? savedQueue.map(normalizeStoredLabelItem).filter(Boolean)
        : [];
      setQueue(restoredQueue);

      const restoredDraftItem = normalizeStoredLabelItem(savedDraftItem);
      if (restoredDraftItem) {
        setDraftItem(restoredDraftItem);
        setSelectedId("");
      } else if (savedSelectedQueueItemId && restoredQueue.some((item) => item.id === savedSelectedQueueItemId)) {
        setSelectedId(savedSelectedQueueItemId);
      } else {
        setSelectedId(restoredQueue[0]?.id || "");
      }
    } catch {
      setCustomSizes([]);
      setSavedDesigns([]);
      setProductDesigns({});
      setQueue([]);
      setDraftItem(null);
      setSelectedId("");
      setDesignClipboard(null);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(CUSTOM_SIZE_STORAGE_KEY, JSON.stringify(customSizes));
    window.localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(savedDesigns));
    window.localStorage.setItem(PRODUCT_DESIGN_STORAGE_KEY, JSON.stringify(productDesigns));
    window.localStorage.setItem(PRINT_ROTATION_STORAGE_KEY, printRotation);
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    window.localStorage.setItem(DRAFT_ITEM_STORAGE_KEY, JSON.stringify(draftItem));
    window.localStorage.setItem(SELECTED_SIZE_STORAGE_KEY, selectedSizeId);
    window.localStorage.setItem(SELECTED_QUEUE_ITEM_STORAGE_KEY, selectedId);
    window.localStorage.setItem(ACTIVE_LAYER_STORAGE_KEY, activeLayer);
    window.localStorage.setItem(DESIGN_CLIPBOARD_STORAGE_KEY, JSON.stringify(designClipboard));
  }, [activeLayer, customSizes, designClipboard, draftItem, printRotation, productDesigns, queue, savedDesigns, selectedId, selectedSizeId, storageReady]);

  const sizes = useMemo(() => [...DEFAULT_PRESETS, ...customSizes], [customSizes]);
  const activeSize = sizes.find((size) => size.id === selectedSizeId) || DEFAULT_PRESETS[0];
  const selectedItem = draftItem || queue.find((item) => item.id === selectedId) || null;
  const isDraft = Boolean(draftItem);
  const selectedDesign = savedDesigns.find((design) => design.id === selectedDesignId) || null;
  const activeTextLayer = TEXT_LAYERS.find((layer) => layer.id === activeLayer) || null;
  const visibleProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();
    if (!search) return products.slice(0, 80);
    return products
      .filter((product) =>
        [product.name, product.article_no, product.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search))
      )
      .slice(0, 80);
  }, [productSearch, products]);

  const totalLabels = queue.reduce((total, item) => total + getLabelPrintCount(item), 0);
  const selectedPrinter = printerOptions.find((printer) => printer.name === directPrinter) || null;
  const connectedPrinterCount = printerOptions.filter((printer) => printer.is_connected).length;
  const selectedPrinterOffline = selectedPrinter?.is_connected === false;
  const selectedPrinterUnsupported = selectedPrinter && !selectedPrinter.supports_direct_labels;
  const directPrintDisabled = directPrinting || !directPrinter || !selectedPrinter || selectedPrinterOffline || selectedPrinterUnsupported;
  const printerStatusClass = printerStatus.loading
    ? "is-checking"
    : printerStatus.error || selectedPrinterOffline
      ? "is-error"
      : selectedPrinter?.is_connected
        ? "is-connected"
        : "is-offline";
  const printerConnectionText = printerStatus.loading
    ? "Checking printers"
    : printerStatus.error
      ? useLocalPrinterBridge ? "Local bridge unavailable" : "Printer status unavailable"
      : !printerOptions.length
        ? "No printers found"
        : !directPrinter || !selectedPrinter
          ? "Choose printer"
          : selectedPrinterOffline
            ? selectedPrinter.status || "Not connected"
            : selectedPrinterUnsupported
              ? "Connected, dialog only"
              : selectedPrinter.status || "Connected";
  const directPrintTitle = !directPrinter
    ? "Choose a connected TSPL label printer"
    : selectedPrinterOffline
      ? "Selected printer is not connected"
      : selectedPrinterUnsupported
        ? "Use Print with dialog for non-TSPL printers"
        : "Send labels directly to the selected thermal printer";

  const openInEditor = (product = null) => {
    const baseItem = createQueueItem(product);
    const savedLayout = product?.id ? productDesigns[product.id] : null;
    const item = savedLayout
      ? {
          ...baseItem,
          ...savedLayout,
          productId: baseItem.productId,
          productName: baseItem.productName,
          articleNo: baseItem.articleNo,
          imageUrl: baseItem.imageUrl,
          sku: baseItem.sku,
          barcode: baseItem.barcode,
          showImage: baseItem.imageUrl ? savedLayout.showImage : false,
          layerOrder: Array.isArray(savedLayout.layerOrder) ? [...savedLayout.layerOrder] : baseItem.layerOrder,
          layerOffsets: savedLayout.layerOffsets && typeof savedLayout.layerOffsets === "object"
            ? { ...savedLayout.layerOffsets }
            : baseItem.layerOffsets,
        }
      : baseItem;
    setDraftItem(item);
    setSelectedId("");
    setNotice(savedLayout ? "Loaded the saved layout for this product." : "");
  };

  const updateEditingItem = (updater) => {
    if (draftItem) {
      setDraftItem((current) => (current ? updater(current) : current));
      return;
    }
    if (!selectedId) return;
    setQueue((current) => current.map((item) => (item.id === selectedId ? updater(item) : item)));
  };

  const addDraftToQueue = () => {
    if (!draftItem) return;
    setQueue((current) => [...current, draftItem]);
    setSelectedId(draftItem.id);
    setDraftItem(null);
    setNotice("Added to the print queue.");
  };

  const saveCurrentDesign = () => {
    if (!selectedItem) {
      setNotice("Choose a label before saving a design.");
      return;
    }
    const name = designName.trim() || selectedDesign?.name || `Label design ${savedDesigns.length + 1}`;
    const values = pickLabelFields(selectedItem, SAVED_DESIGN_FIELDS);
    const design = {
      id: selectedDesign?.id || `design-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      values,
    };
    setSavedDesigns((current) =>
      selectedDesign ? current.map((entry) => (entry.id === design.id ? design : entry)) : [...current, design]
    );
    if (selectedItem.productId != null) {
      setProductDesigns((current) => ({ ...current, [selectedItem.productId]: values }));
    }
    setSelectedDesignId(design.id);
    setDesignName(name);
    setNotice(selectedItem.productId != null ? `Saved "${name}" for this product.` : `Saved "${name}".`);
  };

  const applySavedDesign = () => {
    if (!selectedItem || !selectedDesign) {
      setNotice("Choose both a saved design and a label to apply it.");
      return;
    }
    updateEditingItem((item) => ({ ...item, ...selectedDesign.values }));
    setNotice(`Applied "${selectedDesign.name}".`);
  };

  const removeSavedDesign = () => {
    if (!selectedDesign) return;
    const name = selectedDesign.name;
    setSavedDesigns((current) => current.filter((design) => design.id !== selectedDesign.id));
    setSelectedDesignId("");
    setDesignName("");
    setNotice(`Removed "${name}".`);
  };

  const copyCurrentLayout = () => {
    const sourceValues = selectedItem
      ? pickLabelFields(selectedItem, COPY_STYLE_FIELDS)
      : selectedDesign?.values ? pickLabelFields(selectedDesign.values, COPY_STYLE_FIELDS) : null;
    if (!sourceValues) {
      setNotice("Choose a label or saved design to copy.");
      return;
    }
    setDesignClipboard({
      ...sourceValues,
      layerOrder: Array.isArray(sourceValues.layerOrder) ? [...sourceValues.layerOrder] : undefined,
    });
    setNotice("Layout copied. Paste it into any product.");
  };

  const pasteLayoutToProduct = (product) => {
    if (!designClipboard) {
      setNotice("Copy a layout before pasting it to another product.");
      return;
    }
    const target = createQueueItem(product);
    const item = {
      ...target,
      ...designClipboard,
      title: target.title,
      price: target.price,
      sku: target.sku,
      barcode: target.barcode,
      showImage: target.imageUrl ? designClipboard.showImage : false,
      layerOrder: Array.isArray(designClipboard.layerOrder)
        ? [...designClipboard.layerOrder]
        : target.layerOrder,
    };
    setDraftItem(item);
    setSelectedId("");
    setNotice(`Pasted the layout onto ${product.name}. Add it to the queue when ready.`);
  };

  const adjustLayerOffset = (layerId, adjustment) => {
    updateEditingItem((item) => {
      const offset = adjustment === null
        ? 0
        : Math.max(-8, Math.min(8, getLayerOffset(item, layerId) + adjustment));
      return { ...item, layerOffsets: { ...item.layerOffsets, [layerId]: offset } };
    });
  };

  const moveLayer = (layerId, direction) => {
    updateEditingItem((item) => {
      const order = getLayerOrder(item);
      const index = order.indexOf(layerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return item;
      const nextOrder = [...order];
      [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
      return { ...item, layerOrder: nextOrder };
    });
  };

  const updateSelected = (field, value) => {
    updateEditingItem((item) => ({ ...item, [field]: value }));
  };

  const removeQueueItem = (id) => {
    setQueue((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === selectedId) setSelectedId(next[0]?.id || "");
      return next;
    });
  };

  const addCustomSize = () => {
    const width = Number(newSize.width);
    const height = Number(newSize.height);
    const gap = Math.max(0, Number(newSize.gap) || 0);
    const name = newSize.name.trim();
    if (!name || width < 15 || width > 200 || height < 10 || height > 300) {
      setNotice("Enter a size name and dimensions between 15-200 mm wide and 10-300 mm high.");
      return;
    }
    const size = {
      id: `custom-${Date.now()}`,
      name,
      width,
      height,
      gap,
      custom: true,
    };
    setCustomSizes((current) => [...current, size]);
    setSelectedSizeId(size.id);
    setNewSize({ name: "", width: "50", height: "25", gap: "2" });
    setShowNewSize(false);
    setNotice("");
  };

  const removeCustomSize = () => {
    if (!activeSize.custom) return;
    setCustomSizes((current) => current.filter((size) => size.id !== activeSize.id));
    setSelectedSizeId(DEFAULT_PRESETS[0].id);
  };

  const printDirectLabels = async (items = queue) => {
    if (!items.length) {
      setNotice("Add at least one product or custom label to print.");
      return;
    }
    if (!directPrinter || !selectedPrinter) {
      setNotice("Choose a connected label printer before sending a direct print job.");
      return;
    }
    if (selectedPrinterOffline) {
      setNotice(`${selectedPrinter.name} is ${selectedPrinter.status || "not connected"}. Check the cable, power, and Windows printer queue.`);
      loadLabelPrinters();
      return;
    }
    if (selectedPrinterUnsupported) {
      setNotice(`${selectedPrinter.name} is connected, but direct printing needs a TSPL-compatible thermal printer. Use Print with dialog for this printer.`);
      return;
    }
    setDirectPrinting(true);
    try {
      const response = await postPrinterLabels({
        labels: items,
        size: { width: activeSize.width, height: activeSize.height, gap: activeSize.gap },
        printer_name: directPrinter,
      });
      setNotice(`Sent ${response.data.label_count} label${response.data.label_count === 1 ? "" : "s"} directly to ${response.data.printer} through ${printerConnectionModeLabel}.`);
      loadLabelPrinters();
    } catch (error) {
      setNotice(getPrinterApiError(error, "The direct label job could not be sent to the printer."));
      loadLabelPrinters();
    } finally {
      setDirectPrinting(false);
    }
  };
  const printLabels = (items = queue) => {
    if (!items.length) {
      setNotice("Add at least one product or custom label to print.");
      return;
    }
    const printWindow = window.open(
      "",
      "erp-label-printer",
      "width=900,height=720,resizable=yes,scrollbars=yes"
    );
    if (!printWindow) {
      setNotice("Allow pop-ups for the ERP, then print the labels again.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildPrintDocument(items, activeSize, printRotation));
    printWindow.document.close();
    printWindow.opener = null;
    window.setTimeout(() => {
      if (!printWindow.closed) {
        printWindow.focus();
        printWindow.print();
      }
    }, 250);
  };

  return (
    <main className="label-printer-page">
      <header className="label-printer-header">
        <div>
          <span className="label-printer-kicker">Operations</span>
          <h1>Label Printer</h1>
          <p>Build product labels, set the exact media size, and print straight to your label printer.</p>
        </div>
        <div className="label-printer-header-actions">
          <div className="label-printer-print-actions">
            <Link className="label-printer-secondary" to="/portal/printer-settings" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }} title="Configure direct print agent source and default printer">
              ⚙️ Printer Settings
            </Link>
            <span className="label-printer-count">{totalLabels} labels queued</span>
            <button className="label-printer-secondary" disabled={!queue.length} onClick={() => printLabels()} type="button">
              Print with dialog
            </button>
            <button className="label-printer-primary" disabled={directPrintDisabled} onClick={() => printDirectLabels()} title={directPrintTitle} type="button">
              {directPrinting ? "Sending labels..." : "Send direct"}
            </button>
          </div>
        </div>
      </header>

      {notice ? <div className="label-printer-notice" role="status">{notice}</div> : null}

      <section className="label-printer-status-strip" aria-label="Printer connection status">
        <div>
          <span className={`label-printer-printer-status ${printerStatusClass}`} title={selectedPrinter?.status_detail || printerStatus.error || ""}>
            <span aria-hidden="true" />
            {printerConnectionText}
          </span>
          <strong>{selectedPrinter?.name || "No printer selected"}</strong>
          {selectedPrinter?.jobs ? <small>{selectedPrinter.jobs} job{selectedPrinter.jobs === 1 ? "" : "s"} in queue</small> : null}
        </div>
        <div>
          <span className="label-printer-printer-scope">{printerConnectionModeLabel}</span>
          <span>{connectedPrinterCount}/{printerOptions.length || 0} connected</span>
          <button className="label-printer-secondary" disabled={printerStatus.loading} onClick={() => loadLabelPrinters({ showNotice: true })} type="button">
            {printerStatus.loading ? "Checking" : "Refresh printers"}
          </button>
        </div>
      </section>

      <section className="label-printer-layout">
        <aside className="label-printer-products">
          <div className="label-printer-section-head">
            <div>
              <span>1</span>
              <h2>Add labels</h2>
            </div>
            <button className="label-printer-text-button" onClick={() => openInEditor()} type="button">
              New custom
            </button>
          </div>
          <label className="label-printer-search">
            <span>Search products</span>
            <input
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Name, SKU, category"
              value={productSearch}
            />
          </label>
          <div className="label-printer-product-list">
            {loading ? <p className="label-printer-empty">Loading products...</p> : null}
            {!loading && visibleProducts.length === 0 ? (
              <p className="label-printer-empty">No product matches this search.</p>
            ) : null}
            {visibleProducts.map((product) => (
              <div className="label-printer-product-row" key={product.id}>
                <button
                  className="label-printer-product-select"
                  onClick={() => openInEditor(product)}
                  type="button"
                >
                  {product.image_url ? <img alt="" src={getStaticUrl(product.image_url)} /> : <span className="label-printer-product-mark">SKU</span>}
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.article_no}{product.category ? `  |  ${product.category}` : ""}</small>
                  </span>
                </button>
                <button
                  className="label-printer-product-paste"
                  disabled={!designClipboard}
                  onClick={() => pasteLayoutToProduct(product)}
                  title={designClipboard ? "Paste the copied layout onto this product" : "Copy a layout first"}
                  type="button"
                >
                  Paste
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="label-printer-workspace">
          <div className="label-printer-section-head">
            <div>
              <span>2</span>
              <h2>Label setup</h2>
            </div>
          </div>
          <div className="label-printer-size-bar">
            <label>
              <span>Label size</span>
              <select onChange={(event) => setSelectedSizeId(event.target.value)} value={activeSize.id}>
                {sizes.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.name} ({size.width} x {size.height} mm)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Print correction</span>
              <select onChange={(event) => setPrintRotation(event.target.value)} value={printRotation}>
                <option value="clockwise">Correct 90 degrees right</option>
                <option value="counterclockwise">Correct 90 degrees left</option>
                <option value="normal">No rotation correction</option>
              </select>
            </label>
            <div className="label-printer-size-actions">
              <button className="label-printer-secondary" onClick={() => setShowNewSize(true)} type="button">
                Add size
              </button>
              {activeSize.custom ? (
                <button className="label-printer-delete-size" onClick={removeCustomSize} type="button">
                  Remove size
                </button>
              ) : null}
            </div>
          </div>

          <div className="label-printer-design-bar">
            <label>
              <span>Saved design</span>
              <select
                onChange={(event) => {
                  const nextId = event.target.value;
                  const design = savedDesigns.find((entry) => entry.id === nextId);
                  setSelectedDesignId(nextId);
                  setDesignName(design?.name || "");
                }}
                value={selectedDesignId}
              >
                <option value="">New design</option>
                {savedDesigns.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}
              </select>
            </label>
            <label className="label-printer-design-name">
              <span>Design name</span>
              <input onChange={(event) => setDesignName(event.target.value)} placeholder="e.g. Handmade black" value={designName} />
            </label>
            <div className="label-printer-design-actions">
              <button className="label-printer-secondary" disabled={!selectedItem || !selectedDesign} onClick={applySavedDesign} type="button">Apply</button>
              <button className="label-printer-secondary" disabled={!selectedItem && !selectedDesign} onClick={copyCurrentLayout} type="button">Copy layout</button>
              <button className="label-printer-primary" disabled={!selectedItem} onClick={saveCurrentDesign} type="button">Save design</button>
              {selectedDesign ? <button className="label-printer-delete-design" onClick={removeSavedDesign} title="Remove saved design" type="button">Remove</button> : null}
            </div>
          </div>

          {showNewSize ? (
            <div className="label-printer-new-size">
              <label>
                <span>Saved size name</span>
                <input
                  onChange={(event) => setNewSize((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Shelf 60 x 30"
                  value={newSize.name}
                />
              </label>
              <label>
                <span>Width mm</span>
                <input min="15" onChange={(event) => setNewSize((current) => ({ ...current, width: event.target.value }))} type="number" value={newSize.width} />
              </label>
              <label>
                <span>Height mm</span>
                <input min="10" onChange={(event) => setNewSize((current) => ({ ...current, height: event.target.value }))} type="number" value={newSize.height} />
              </label>
              <label>
                <span>Gap mm</span>
                <input min="0" onChange={(event) => setNewSize((current) => ({ ...current, gap: event.target.value }))} type="number" value={newSize.gap} />
              </label>
              <button className="label-printer-primary" onClick={addCustomSize} type="button">Save size</button>
              <button className="label-printer-icon-button" aria-label="Close size editor" onClick={() => setShowNewSize(false)} title="Close" type="button">x</button>
            </div>
          ) : null}

          {selectedItem ? (
            <section className="label-printer-editor label-printer-studio">
              <div className="label-printer-editor-head">
                <div className="label-printer-editor-product">
                  {selectedItem.imageUrl ? <img alt="" src={getStaticUrl(selectedItem.imageUrl)} /> : <span className="label-printer-editor-product-mark">SKU</span>}
                  <strong>{selectedItem.sku || selectedItem.articleNo || "Custom"}</strong>
                </div>
                <div className="label-printer-editor-queue-actions">
                  {isDraft ? <button className="label-printer-primary" onClick={addDraftToQueue} type="button">Add to print queue</button> : null}
                  <label>
                    <span>Copies</span>
                    <input
                      max="1000"
                      min="1"
                      onChange={(event) => updateSelected("quantity", Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
                      type="number"
                      value={selectedItem.quantity}
                    />
                  </label>
                </div>
              </div>

              <div className="label-printer-studio-body">
                <nav aria-label="Label layers" className="label-printer-layers">
                  <span className="label-printer-studio-label">Layers</span>
                  {getLayerOrder(selectedItem).map((layerId, index, layers) => {
                    const textLayer = TEXT_LAYERS.find((layer) => layer.id === layerId);
                    const label = textLayer?.label || (layerId === "barcode" ? "Barcode" : "Product image");
                    const isVisible = textLayer
                      ? textLayer.visibleField ? selectedItem[textLayer.visibleField] : true
                      : layerId === "barcode" ? selectedItem.showBarcode : selectedItem.showImage;
                    const preview = textLayer
                      ? selectedItem[textLayer.field]
                      : layerId === "barcode" ? selectedItem.barcode : selectedItem.imageUrl ? "Available" : "No image";
                    const disabled = layerId === "image" && !selectedItem.imageUrl;
                    return (
                      <div className="label-printer-layer-row" key={layerId}>
                        <button
                          className={`label-printer-layer-select ${activeLayer === layerId ? "is-active" : ""} ${isVisible ? "is-visible" : "is-hidden"}`.trim()}
                          disabled={disabled}
                          onClick={() => setActiveLayer(layerId)}
                          type="button"
                        >
                          <span className="label-printer-layer-state" />
                          <span><strong>{label}</strong><small>{preview || "Empty"}</small></span>
                        </button>
                        <span className="label-printer-layer-actions">
                          <button aria-label={`Move ${label} up`} className="label-printer-layer-move" disabled={index === 0} onClick={() => moveLayer(layerId, -1)} title="Move up" type="button">&#8593;</button>
                          <button aria-label={`Move ${label} down`} className="label-printer-layer-move" disabled={index === layers.length - 1} onClick={() => moveLayer(layerId, 1)} title="Move down" type="button">&#8595;</button>
                        </span>
                      </div>
                    );
                  })}
                </nav>

                <div className="label-printer-inspector">
                  {activeTextLayer ? (
                    <>
                      <div className="label-printer-inspector-head">
                        <div>
                          <span className="label-printer-studio-label">Text properties</span>
                          <h3>{activeTextLayer.label}</h3>
                        </div>
                        {activeTextLayer.visibleField ? (
                          <label className="label-printer-visibility-toggle">
                            <input
                              checked={selectedItem[activeTextLayer.visibleField]}
                              onChange={(event) => updateSelected(activeTextLayer.visibleField, event.target.checked)}
                              type="checkbox"
                            />
                            Visible
                          </label>
                        ) : null}
                      </div>
                      <label className="label-printer-content-field">
                        <span>Content</span>
                        <input
                          onChange={(event) => updateSelected(activeTextLayer.field, event.target.value)}
                          value={selectedItem[activeTextLayer.field] ?? (activeTextLayer.id === "sku" ? selectedItem.subtitle ?? "" : "")}
                        />
                      </label>
                      <div className="label-printer-property-grid">
                        <div>
                          <span>Alignment</span>
                          <div aria-label={`${activeTextLayer.label} alignment`} className="label-printer-alignment" role="group">
                            {["left", "center", "right"].map((alignment) => (
                              <button
                                aria-label={`${alignment} align`}
                                className={selectedItem[activeTextLayer.alignField] === alignment ? "is-active" : ""}
                                key={alignment}
                                onClick={() => updateSelected(activeTextLayer.alignField, alignment)}
                                title={`${alignment[0].toUpperCase()}${alignment.slice(1)} align`}
                                type="button"
                              >
                                {alignment[0].toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="label-printer-size-control">
                          <span>Font size <strong>{Math.round(Number(selectedItem[activeTextLayer.scaleField] || 1) * 100)}%</strong></span>
                          <input
                            max="1.7"
                            min="0.7"
                            onChange={(event) => updateSelected(activeTextLayer.scaleField, Number(event.target.value))}
                            step="0.05"
                            type="range"
                            value={selectedItem[activeTextLayer.scaleField] || 1}
                          />
                        </label>
                        <LayerPlacementControl item={selectedItem} layerId={activeTextLayer.id} onAdjust={adjustLayerOffset} />
                      </div>
                    </>
                  ) : activeLayer === "barcode" ? (
                    <>
                      <div className="label-printer-inspector-head">
                        <div><span className="label-printer-studio-label">Code properties</span><h3>Barcode</h3></div>
                        <label className="label-printer-visibility-toggle"><input checked={selectedItem.showBarcode} onChange={(event) => updateSelected("showBarcode", event.target.checked)} type="checkbox" /> Visible</label>
                      </div>
                      <label className="label-printer-content-field"><span>Barcode value</span><input onChange={(event) => updateSelected("barcode", event.target.value)} value={selectedItem.barcode} /></label>
                      <label className="label-printer-size-control label-printer-barcode-size-control">
                        <span>Barcode size <strong>{Math.round(Number(selectedItem.barcodeScale || 1) * 100)}%</strong></span>
                        <input max="1.6" min="0.55" onChange={(event) => updateSelected("barcodeScale", Number(event.target.value))} step="0.05" type="range" value={selectedItem.barcodeScale || 1} />
                      </label>
                      <label className="label-printer-size-control label-printer-barcode-size-control">
                        <span>Barcode height <strong>{Math.round(Number(selectedItem.barcodeHeightScale || 1) * 100)}%</strong></span>
                        <input max="2" min="0.55" onChange={(event) => updateSelected("barcodeHeightScale", Number(event.target.value))} step="0.05" type="range" value={selectedItem.barcodeHeightScale || 1} />
                      </label>
                      <LayerPlacementControl item={selectedItem} layerId="barcode" onAdjust={adjustLayerOffset} />
                    </>
                  ) : (
                    <>
                      <div className="label-printer-inspector-head">
                        <div><span className="label-printer-studio-label">Image properties</span><h3>Product image</h3></div>
                        <label className="label-printer-visibility-toggle"><input checked={selectedItem.showImage} disabled={!selectedItem.imageUrl} onChange={(event) => updateSelected("showImage", event.target.checked)} type="checkbox" /> Visible</label>
                      </div>
                      <p className="label-printer-image-note">{selectedItem.imageUrl ? "Use the product image stored in the ERP." : "This product does not have an image yet."}</p>
                      <LayerPlacementControl item={selectedItem} layerId="image" onAdjust={adjustLayerOffset} />
                    </>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <div className="label-printer-editor-empty">Choose a product or create a custom label to begin.</div>
          )}

          <div className="label-printer-queue">
            <div className="label-printer-queue-head">
              <span>3</span>
              <h2>Print queue</h2>
              <strong>{totalLabels} labels</strong>
            </div>
            {queue.length === 0 ? <p className="label-printer-empty">Your print queue is empty.</p> : null}
            {queue.map((item) => {
              const printCount = getLabelPrintCount(item);
              const sku = item.sku || item.subtitle || item.barcode || "Custom";
              return (
                <div className={`label-printer-queue-row ${item.id === selectedId ? "is-selected" : ""}`} key={item.id}>
                  <button className="label-printer-queue-select" onClick={() => { setDraftItem(null); setSelectedId(item.id); }} type="button">
                    <span>{printCount}x</span>
                    <strong>{item.title || "Untitled label"}</strong>
                    <small className="label-printer-queue-details">
                      <span className="label-printer-queue-sku">{sku}</span>
                      <span className="label-printer-queue-print-count">Print count: {printCount} label{printCount === 1 ? "" : "s"}</span>
                    </small>
                  </button>
                  <button className="label-printer-row-print" disabled={directPrintDisabled} onClick={() => printDirectLabels([item])} type="button">Print</button>
                  <button aria-label={`Remove ${item.title || "label"}`} className="label-printer-row-remove" onClick={() => removeQueueItem(item.id)} title="Remove" type="button">x</button>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="label-printer-preview-panel">
          <div className="label-printer-section-head">
            <div><h2>Print preview</h2></div>
            <small>{activeSize.width} x {activeSize.height} mm</small>
          </div>
          <div className="label-printer-preview-stage">
            {selectedItem ? <LabelPreview item={selectedItem} size={activeSize} /> : <span>Select a label to preview it.</span>}
          </div>
          <div className="label-printer-preview-meta"><span>Gap {activeSize.gap || 0} mm</span></div>
        </aside>
      </section>
    </main>
  );
}

export default LabelPrinter;
