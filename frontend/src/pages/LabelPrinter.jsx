import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import api, { getStaticUrl } from "../api/api";
import "./LabelPrinter.css";
import "./LabelPrinterTheme.css";
import { LABEL_PRINTER_LANGUAGE_KEY, translateLabelPrinter } from "../utils/labelPrinterTranslations";
import { removePrintedCopies, waitForLabelPrintJob } from "../utils/labelPrintQueue";
import { useWorkspaceData } from "../utils/workspaceData";

const LABEL_PRINTER_WORKSPACE_KEY = "label-printer";

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
  // On this laptop, prefer the local print bridge / agent so Label Printer can wake it.
  if (typeof window !== "undefined" && isLoopbackHostname(window.location.hostname)) {
    const savedMode = readStoredText(PRINTER_CONNECTION_MODE_STORAGE_KEY);
    if (["local", "server"].includes(savedMode)) return savedMode;
    return "local";
  }
  const savedMode = readStoredText(PRINTER_CONNECTION_MODE_STORAGE_KEY);
  if (["local", "server"].includes(savedMode)) return savedMode;
  return "server";
};

const resolveErpApiForLocalAgent = () => {
  if (typeof window === "undefined") return "https://api.hisbenew.com";
  try {
    const { protocol, hostname } = window.location;
    if (isLoopbackHostname(hostname)) {
      return normalizeApiBaseUrl(readStoredText(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, DEFAULT_LOCAL_PRINT_BRIDGE_URL))
        || DEFAULT_LOCAL_PRINT_BRIDGE_URL;
    }
    if (hostname.toLowerCase().includes("hisbenew.com")) {
      return "https://api.hisbenew.com";
    }
    return `${protocol}//${hostname}${hostname.includes(":") ? "" : ""}`.replace(/\/$/, "") || "https://api.hisbenew.com";
  } catch {
    return "https://api.hisbenew.com";
  }
};

const ensureLocalPrintAgent = async (bridgeUrl, erpApi) => {
  const candidates = [
    buildPrintBridgeUrl(bridgeUrl || DEFAULT_LOCAL_PRINT_BRIDGE_URL, "/local-print-agent/ensure"),
    "http://127.0.0.1:8000/local-print-agent/ensure",
    "http://localhost:8000/local-print-agent/ensure",
  ];
  const tried = new Set();
  let lastError = "";
  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const response = await fetch(url, {
        method: "POST",
        targetAddressSpace: "loopback",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ erp_api: erpApi || resolveErpApiForLocalAgent() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = body?.detail || `HTTP ${response.status}`;
        continue;
      }
      return { ok: true, data: body, url };
    } catch (error) {
      lastError = error?.message || "Local print agent could not be reached.";
    }
  }
  return { ok: false, error: lastError || "Local print agent could not be started." };
};

const getInitialLocalPrintBridgeUrl = () =>
  normalizeApiBaseUrl(readStoredText(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, DEFAULT_LOCAL_PRINT_BRIDGE_URL)) ||
  DEFAULT_LOCAL_PRINT_BRIDGE_URL;

const buildPrintBridgeUrl = (baseUrl, path) =>
  `${normalizeApiBaseUrl(baseUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL}${path.startsWith("/") ? path : `/${path}`}`;

const getPrinterApiError = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

const printerListFingerprint = (printers = []) =>
  printers
    .map(
      (printer) =>
        `${printer.name}|${printer.is_connected === false ? 0 : 1}|${printer.supports_direct_labels ? 1 : 0}|${printer.status || ""}`
    )
    .sort()
    .join(";");

const pickPreferredLabelPrinter = (printers = [], currentName = "") => {
  if (
    currentName &&
    printers.some(
      (printer) =>
        printer.name === currentName &&
        printer.supports_direct_labels &&
        printer.is_connected !== false
    )
  ) {
    return currentName;
  }
  const thermalConnected =
    printers.find((printer) => printer.supports_direct_labels && printer.is_connected !== false) ||
    printers.find((printer) => printer.supports_direct_labels);
  const fallback = thermalConnected || printers.find((printer) => printer.is_default) || printers[0];
  return fallback?.name || "";
};

const PRODUCT_DESIGN_FIELDS = [
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
  "brandBold",
  "titleBold",
  "skuBold",
  "priceBold",
  "brandScale",
  "titleScale",
  "skuScale",
  "priceScale",
  "brandStretchX",
  "brandStretchY",
  "titleStretchX",
  "titleStretchY",
  "skuStretchX",
  "skuStretchY",
  "priceStretchX",
  "priceStretchY",
  "barcodeScale",
  "barcodeHeightScale",
  "layerOrder",
  "layerOffsets",
  "positions",
];

const pickLabelFields = (item, fields) =>
  Object.fromEntries(fields.map((field) => [field, item[field]]));

const TEXT_LAYERS = [
  { id: "brand", label: "Brand", field: "brand", alignField: "brandAlign", boldField: "brandBold", scaleField: "brandScale", visibleField: "showBrand" },
  { id: "title", label: "Handmade category", field: "title", alignField: "titleAlign", boldField: "titleBold", scaleField: "titleScale" },
  { id: "sku", label: "SKU number", field: "sku", alignField: "skuAlign", boldField: "skuBold", scaleField: "skuScale" },
  { id: "price", label: "Price / note", field: "price", alignField: "priceAlign", boldField: "priceBold", scaleField: "priceScale", visibleField: "showPrice" },
];

const DEFAULT_LAYER_ORDER = ["brand", "title", "price", "image", "barcode", "sku"];
const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const LABEL_LAYERS = [
  { id: "brand", label: "Brand", field: "brand", alignField: "brandAlign", boldField: "brandBold", scaleField: "brandScale", stretchXField: "brandStretchX", stretchYField: "brandStretchY", visibleField: "showBrand", type: "text" },
  { id: "title", label: "Title", field: "title", alignField: "titleAlign", boldField: "titleBold", scaleField: "titleScale", stretchXField: "titleStretchX", stretchYField: "titleStretchY", type: "text" },
  { id: "price", label: "Price / note", field: "price", alignField: "priceAlign", boldField: "priceBold", scaleField: "priceScale", stretchXField: "priceStretchX", stretchYField: "priceStretchY", visibleField: "showPrice", type: "text" },
  { id: "image", label: "Product image", visibleField: "showImage", type: "image" },
  { id: "barcode", label: "Barcode", field: "barcode", scaleField: "barcodeScale", heightScaleField: "barcodeHeightScale", visibleField: "showBarcode", type: "barcode" },
  { id: "sku", label: "SKU number", field: "sku", alignField: "skuAlign", boldField: "skuBold", scaleField: "skuScale", stretchXField: "skuStretchX", stretchYField: "skuStretchY", visibleField: "showBarcode", type: "text" },
];

const DEFAULT_LAYER_POSITIONS = {
  brand: { x: 7, y: 8, w: 42, h: 12 },
  title: { x: 9, y: 20, w: 82, h: 20 },
  price: { x: 7, y: 64, w: 34, h: 12 },
  image: { x: 68, y: 7, w: 24, h: 24 },
  barcode: { x: 20, y: 48, w: 60, h: 18 },
  sku: { x: 20, y: 70, w: 60, h: 16 },
};

const getLayerConfig = (layerId) => LABEL_LAYERS.find((layer) => layer.id === layerId) || null;

const clampNumber = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

const normalizeLayerPosition = (position, fallback) => {
  const base = isPlainObject(position) ? position : {};
  const width = clampNumber(base.w, 8, 100, fallback.w);
  const height = clampNumber(base.h, 6, 100, fallback.h);
  return {
    x: clampNumber(base.x, 0, 100 - width, fallback.x),
    y: clampNumber(base.y, 0, 100 - height, fallback.y),
    w: width,
    h: height,
  };
};

const normalizeLayerPositions = (positions = {}) =>
  Object.fromEntries(
    DEFAULT_LAYER_ORDER.map((layerId) => [
      layerId,
      normalizeLayerPosition(positions?.[layerId], DEFAULT_LAYER_POSITIONS[layerId]),
    ])
  );

const getLayerPosition = (item, layerId) =>
  normalizeLayerPosition(item?.positions?.[layerId], DEFAULT_LAYER_POSITIONS[layerId]);

const getLayerStretch = (item, layerId) => {
  const layer = getLayerConfig(layerId);
  return {
    x: layer?.stretchXField ? clampNumber(item?.[layer.stretchXField], 0.25, 4, 1) : 1,
    y: layer?.stretchYField ? clampNumber(item?.[layer.stretchYField], 0.25, 4, 1) : 1,
  };
};

const LAYER_FONT_WEIGHTS = {
  brand: { bold: 800, regular: 500 },
  title: { bold: 900, regular: 600 },
  sku: { bold: 900, regular: 600 },
  price: { bold: 800, regular: 500 },
};

const getLayerBold = (item, layerId) => {
  const layer = getLayerConfig(layerId);
  return layer?.boldField ? item?.[layer.boldField] !== false : false;
};

const getLayerFontWeight = (item, layerId) => {
  const weights = LAYER_FONT_WEIGHTS[layerId];
  if (!weights) return 700;
  return getLayerBold(item, layerId) ? weights.bold : weights.regular;
};

const getLayerPositionStyle = (item, layerId) => {
  const position = getLayerPosition(item, layerId);
  const stretch = getLayerStretch(item, layerId);
  return {
    left: `${position.x}%`,
    top: `${position.y}%`,
    width: `${position.w}%`,
    height: `${position.h}%`,
    "--layer-stretch-x": stretch.x,
    "--layer-stretch-y": stretch.y,
    "--layer-font-weight": getLayerFontWeight(item, layerId),
  };
};

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
    svg.setAttribute("preserveAspectRatio", "none");
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
  brandBold: true,
  titleBold: true,
  skuBold: true,
  priceBold: true,
  brandScale: 1,
  titleScale: 1.3,
  skuScale: 1.55,
  priceScale: 1,
  barcodeScale: 1,
  barcodeHeightScale: 1,
  layerOrder: [...DEFAULT_LAYER_ORDER],
  layerOffsets: {},
  positions: normalizeLayerPositions(),
});

const getLabelPrintCount = (item) => Math.max(1, Math.min(1000, Number(item?.quantity) || 1));

const getBarcodeHeightScale = (item) => Math.max(0.55, Math.min(2, Number(item?.barcodeHeightScale) || 1));

const getLabelRenderMetrics = (size, item = {}) => {
  const width = Math.max(1, Number(size?.width || 50));
  const height = Math.max(1, Number(size?.height || 25));
  const scale = Math.min(5.4, 360 / width, 300 / height);
  const previewWidth = Math.max(180, width * scale);
  const previewHeight = Math.max(90, height * scale);
  const pxPerMmX = previewWidth / width;
  const pxPerMmY = previewHeight / height;
  const compact = height <= 30;
  const textBaseSize = Math.max(9, Math.min(18, height * 0.42));
  const independentTextBaseSize = Math.max(9, Math.min(18, textBaseSize * 1.3));
  const titleSize = Math.max(7, textBaseSize * Number(item?.titleScale || 1));
  const brandSize = Math.max(6, independentTextBaseSize * 0.48 * Number(item?.brandScale || 1));
  const skuSize = Math.max(7, independentTextBaseSize * 0.78 * Number(item?.skuScale || 1));
  const priceSize = Math.max(6, independentTextBaseSize * 0.62 * Number(item?.priceScale || 1));
  const barcodeHeight = Math.max(20, Math.min(54, previewHeight * (compact ? 0.21 : 0.19)));
  const barcodeScale = Math.max(0.45, Math.min(1.8, Number(item?.barcodeScale || 1)));
  const barcodeHeightScale = getBarcodeHeightScale(item);

  return {
    width,
    height,
    scale,
    previewWidth,
    previewHeight,
    pxPerMmX,
    pxPerMmY,
    compact,
    titleSize,
    brandSize,
    skuSize,
    priceSize,
    barcodeHeight,
    barcodeScale,
    barcodeHeightScale,
    toMmX: (valuePx) => Number(valuePx || 0) / pxPerMmX,
    toMmY: (valuePx) => Number(valuePx || 0) / pxPerMmY,
  };
};

const getLayerScaleRange = (layer) => (layer?.id === "barcode" ? { min: 0.45, max: 1.8 } : { min: 0.35, max: 3.5 });

const getResizeAxes = (handle = "") => ({
  x: handle.includes("e") || handle.includes("w"),
  y: handle.includes("n") || handle.includes("s"),
});

const getLayerResizeScaleChanges = (item, layerId, startPosition, nextPosition, axes = {}) => {
  const layer = getLayerConfig(layerId);
  if (!layer || !startPosition || !nextPosition) return {};

  const widthRatio = axes.x ? nextPosition.w / Math.max(1, startPosition.w) : 1;
  const heightRatio = axes.y ? nextPosition.h / Math.max(1, startPosition.h) : 1;
  const changes = {};

  if (layer.id === "barcode") {
    if (layer.scaleField && axes.x) {
      const startScale = Number(item?.[layer.scaleField] || 1);
      const range = getLayerScaleRange(layer);
      changes[layer.scaleField] = clampNumber(startScale * widthRatio, range.min, range.max, startScale);
    }
    if (layer.heightScaleField && axes.y) {
      const startHeightScale = getBarcodeHeightScale(item);
      changes[layer.heightScaleField] = clampNumber(startHeightScale * heightRatio, 0.55, 2, startHeightScale);
    }
    return changes;
  }

  if (layer.type === "text" && (axes.x || axes.y)) {
    if (axes.x && !axes.y && layer.stretchXField) {
      const startStretchX = getLayerStretch(item, layerId).x;
      changes[layer.stretchXField] = clampNumber(startStretchX * widthRatio, 0.25, 4, startStretchX);
      return changes;
    }
    if (axes.y && !axes.x && layer.stretchYField) {
      const startStretchY = getLayerStretch(item, layerId).y;
      changes[layer.stretchYField] = clampNumber(startStretchY * heightRatio, 0.25, 4, startStretchY);
      return changes;
    }
  }

  if (layer.scaleField && (axes.x || axes.y)) {
    const ratios = [axes.x ? widthRatio : null, axes.y ? heightRatio : null].filter((ratio) => Number.isFinite(ratio));
    const sizeRatio = ratios.length > 1 ? Math.sqrt(ratios[0] * ratios[1]) : ratios[0] || 1;
    const startScale = Number(item?.[layer.scaleField] || 1);
    const range = getLayerScaleRange(layer);
    changes[layer.scaleField] = clampNumber(startScale * sizeRatio, range.min, range.max, startScale);
  }

  return changes;
};

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
    brandBold: item.brandBold !== false,
    titleBold: item.titleBold !== false,
    skuBold: item.skuBold !== false,
    priceBold: item.priceBold !== false,
    layerOrder: getLayerOrder(item),
    layerOffsets: isPlainObject(item.layerOffsets) ? item.layerOffsets : {},
    positions: normalizeLayerPositions(item.positions),
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

const normalizeLabelPrinterWorkspace = (data) => {
  const source = isPlainObject(data) ? data : {};
  return {
    customSizes: Array.isArray(source.customSizes) ? source.customSizes : [],
    productDesigns: isPlainObject(source.productDesigns) ? source.productDesigns : {},
    printRotation: ["normal", "clockwise", "counterclockwise"].includes(source.printRotation)
      ? source.printRotation
      : "clockwise",
    selectedSizeId:
      typeof source.selectedSizeId === "string" && source.selectedSizeId
        ? source.selectedSizeId
        : DEFAULT_PRESETS[0].id,
  };
};

const loadLabelPrinterWorkspaceLocal = () => {
  if (typeof window === "undefined") {
    return { data: normalizeLabelPrinterWorkspace(null), exists: false };
  }
  const sizesRaw = window.localStorage.getItem(CUSTOM_SIZE_STORAGE_KEY);
  const designsRaw = window.localStorage.getItem(PRODUCT_DESIGN_STORAGE_KEY);
  const rotationRaw = window.localStorage.getItem(PRINT_ROTATION_STORAGE_KEY);
  const sizeIdRaw = window.localStorage.getItem(SELECTED_SIZE_STORAGE_KEY);
  return {
    data: normalizeLabelPrinterWorkspace({
      customSizes: sizesRaw ? readStoredJson(CUSTOM_SIZE_STORAGE_KEY, []) : [],
      productDesigns: designsRaw ? readStoredJson(PRODUCT_DESIGN_STORAGE_KEY, {}) : {},
      printRotation: rotationRaw || "clockwise",
      selectedSizeId: sizeIdRaw || DEFAULT_PRESETS[0].id,
    }),
    exists: sizesRaw !== null || designsRaw !== null || rotationRaw !== null || sizeIdRaw !== null,
  };
};

const saveLabelPrinterWorkspaceLocal = (data) => {
  const normalized = normalizeLabelPrinterWorkspace(data);
  window.localStorage.setItem(CUSTOM_SIZE_STORAGE_KEY, JSON.stringify(normalized.customSizes));
  window.localStorage.setItem(PRODUCT_DESIGN_STORAGE_KEY, JSON.stringify(normalized.productDesigns));
  window.localStorage.setItem(PRINT_ROTATION_STORAGE_KEY, normalized.printRotation);
  window.localStorage.setItem(SELECTED_SIZE_STORAGE_KEY, normalized.selectedSizeId);
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
      barcodeRef.current.setAttribute("preserveAspectRatio", "none");
    } catch {
      barcodeRef.current.innerHTML = "";
    }
  }, [height, heightScale, scale, value]);

  return <svg aria-label={`Barcode ${value || "label"}`} ref={barcodeRef} role="img" />;
};

const LabelPreview = ({ item, size, isPrint = false, activeLayer = "", interactive = false, onLayerSelect = null, onLayerPointerDown = null, onLayerResizePointerDown = null, editingLayer = "", onLayerDoubleClick = null, onLayerValueChange = null, onLayerEditEnd = null }) => {
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

  const renderInlineInput = (layerId, field, value, align = "left") => {
    if (!interactive || editingLayer !== layerId || !field) return null;
    return (
      <input
        autoFocus
        className={`label-printer-inline-layer-input is-align-${align}`}
        onBlur={() => onLayerEditEnd?.()}
        onChange={(event) => onLayerValueChange?.(layerId, event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") onLayerEditEnd?.();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        value={value}
      />
    );
  };
  const renderLayer = (layerId) => {
    if (layerId === "brand") {
      return renderInlineInput("brand", "brand", item.brand || "", item.brandAlign || "left") || (item.showBrand && item.brand ? <span className={`label-printer-preview-brand is-align-${item.brandAlign || "left"}`}>{item.brand}</span> : null);
    }
    if (layerId === "title") {
      return renderInlineInput("title", "title", item.title || "", item.titleAlign || "left") || <strong className={`label-printer-preview-title is-align-${item.titleAlign || "left"}`}>{item.title || "Untitled label"}</strong>;
    }
    if (layerId === "price") {
      return renderInlineInput("price", "price", item.price || "", item.priceAlign || "left") || (item.showPrice && item.price ? <span className={`label-printer-preview-price is-align-${item.priceAlign || "left"}`}>{item.price}</span> : null);
    }
    if (layerId === "image") {
      return item.showImage && item.imageUrl ? <div className="label-printer-preview-image"><img alt="" src={getStaticUrl(item.imageUrl)} /></div> : null;
    }
    if (layerId === "barcode") {
      return item.showBarcode ? <div className="label-printer-preview-barcode"><BarcodePreview height={barcodeHeight} heightScale={barcodeHeightScale} scale={barcodeScale} value={item.barcode} /></div> : null;
    }
    if (layerId === "sku") {
      return renderInlineInput("sku", "sku", sku, item.skuAlign || "center") || (item.showBarcode ? <small className={`label-printer-preview-sku is-align-${item.skuAlign || "center"}`}>{sku}</small> : null);
    }
    return null;
  };

  return (
    <article
      dir="ltr"
      className={`label-printer-preview is-positioned ${compact ? "is-compact" : ""} ${item.showImage ? "has-image" : ""} ${isPrint ? "is-print" : ""}`}
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
        const isSelectedLayer = activeLayer === layerId;
        const layerClassName = `label-printer-preview-layer is-positioned-layer is-layer-${layerId} is-align-${getLayerAlignment(item, layerId)} ${interactive ? "is-editable-layer" : ""} ${isSelectedLayer ? "is-selected-layer" : ""}`.trim();
        const layerStyle = getLayerPositionStyle(item, layerId);
        const layerObject = (
          <span className="label-printer-layer-object">
            {layer}
            {interactive && isSelectedLayer && editingLayer !== layerId ? (
              <span className="label-printer-resize-handles" aria-hidden="true">
                {RESIZE_HANDLES.map((handle) => (
                  <span
                    className={`label-printer-resize-handle is-${handle}`}
                    key={handle}
                    onPointerDown={(event) => onLayerResizePointerDown?.(layerId, handle, event)}
                  />
                ))}
              </span>
            ) : null}
          </span>
        );
        if (interactive) {
          return (
            <div
              aria-label={`Edit ${layerId} layer`}
              className={layerClassName}
              key={layerId}
              onClick={(event) => {
                event.stopPropagation();
                onLayerSelect?.(layerId);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onLayerDoubleClick?.(layerId);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onLayerDoubleClick?.(layerId);
              }}
              onPointerDown={(event) => onLayerPointerDown?.(layerId, event)}
              role="button"
              style={layerStyle}
              tabIndex={0}
            >
              {layerObject}
            </div>
          );
        }
        return (
          <div className={layerClassName} key={layerId} style={layerStyle}>
            {layerObject}
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
  const pageMetrics = getLabelRenderMetrics(size);
  const { width, height } = pageMetrics;
  const isRotated = printRotation === "clockwise" || printRotation === "counterclockwise";
  const pageWidth = isRotated ? height : width;
  const pageHeight = isRotated ? width : height;

  const labels = items.flatMap((item) =>
    Array.from({ length: Math.max(1, Math.min(1000, Number(item.quantity) || 1)) }, () => {
      const metrics = getLabelRenderMetrics(size, item);
      const barcode = item.showBarcode ? createBarcodeSvg(item.barcode, metrics.barcodeHeight, metrics.barcodeScale, metrics.barcodeHeightScale) : "";
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
        const position = getLayerPosition(item, layerId);
        const stretch = getLayerStretch(item, layerId);
        const style = `left:${position.x}%;top:${position.y}%;width:${position.w}%;height:${position.h}%;--layer-stretch-x:${stretch.x};--layer-stretch-y:${stretch.y};--layer-font-weight:${getLayerFontWeight(item, layerId)};`;
        return `<div class="layer layer-${layerId} align-${getLayerAlignment(item, layerId)}" style="${style}"><span class="label-object">${content}</span></div>`;
      }).join("");
      const labelStyle = [
        `--label-brand-size:${metrics.toMmY(metrics.brandSize)}mm`,
        `--label-title-size:${metrics.toMmY(metrics.titleSize)}mm`,
        `--label-sku-size:${metrics.toMmY(metrics.skuSize)}mm`,
        `--label-price-size:${metrics.toMmY(metrics.priceSize)}mm`,
        `--label-price-pad-y:${metrics.toMmY(3)}mm`,
        `--label-price-pad-x:${metrics.toMmX(6)}mm`,
        `--barcode-scale:${metrics.barcodeScale}`,
        `--barcode-height-scale:${metrics.barcodeHeightScale}`,
      ].join(";");
      return `<section class="print-sheet ${isRotated ? `rotate-${printRotation}` : ""}"><article class="label ${metrics.compact ? "compact" : ""}" style="${labelStyle};">${layerMarkup}</article></section>`;
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
          html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
          .print-sheet { width: ${pageWidth}mm; height: ${pageHeight}mm; overflow: hidden; break-after: page; page-break-after: always; }
          .print-sheet:last-child { break-after: auto; page-break-after: auto; }
          .label { position: relative; width: ${width}mm; height: ${height}mm; overflow: hidden; display: block; background: #fff; color: #000; }
          .rotate-clockwise .label { transform: translateX(${height}mm) rotate(90deg); transform-origin: top left; }
          .rotate-counterclockwise .label { transform: translateY(${width}mm) rotate(-90deg); transform-origin: top left; }
          .layer { position: absolute; min-width: 0; display: grid; align-items: center; overflow: hidden; line-height: 1; }
          .layer-brand, .layer-title, .layer-price, .layer-sku { overflow: visible; }
          .layer.align-left { justify-items: start; text-align: left; }
          .layer.align-center { justify-items: center; text-align: center; }
          .layer.align-right { justify-items: end; text-align: right; }
          .label-object { position: relative; display: inline-grid; width: max-content; max-width: none; min-width: 0; min-height: 0; place-items: center; overflow: visible; line-height: 1; }
          .layer-barcode .label-object, .layer-image .label-object { width: 100%; height: 100%; }
          .label-image, .barcode { width: 100%; height: 100%; display: grid; overflow: hidden; place-items: center; }
          .label-image img, .barcode svg { width: 100%; height: 100%; max-height: 100%; object-fit: contain; }
          .brand, .title, .sku { display: block; width: auto; max-width: none; overflow: visible; color: #000; line-height: 1.18; white-space: nowrap; }
          .brand { color: #566965; font-size: var(--label-brand-size); font-weight: var(--layer-font-weight, 800); letter-spacing: .05em; }
          .title { font-size: var(--label-title-size); font-weight: var(--layer-font-weight, 900); }
          .sku { font-size: var(--label-sku-size); font-weight: var(--layer-font-weight, 900); letter-spacing: .04em; }
          .price { display: inline-block; width: auto; max-width: none; border-radius: .6mm; background: #e6f0ea; color: #17473e; padding: var(--label-price-pad-y) var(--label-price-pad-x); font-size: var(--label-price-size); font-weight: var(--layer-font-weight, 800); line-height: 1.18; overflow: visible; text-overflow: clip; white-space: nowrap; }
          .brand, .title, .price, .sku { transform: scale(var(--layer-stretch-x, 1), var(--layer-stretch-y, 1)); transform-origin: center center; }
          .layer.align-left .brand, .layer.align-left .title, .layer.align-left .price, .layer.align-left .sku { transform-origin: left center; }
          .layer.align-right .brand, .layer.align-right .title, .layer.align-right .price, .layer.align-right .sku { transform-origin: right center; }
          .align-left { text-align: left; }
          .align-center { text-align: center; }
          .align-right { text-align: right; }
          @media screen { body { display: grid; justify-content: center; gap: 14px; padding: 14px; background: #e8edeb; } .label { box-shadow: 0 5px 18px rgba(16,43,41,.14); } }
          @media print { body { display: block; } .label { box-shadow: none; } }
        </style>
      </head>
      <body>${labels.join("")}</body>
    </html>`;
};
function LabelPrinter() {
  const editorDialogRef = useRef(null);
  const sizeDialogRef = useRef(null);
  const noticeRef = useRef(null);
  const directPrintingRef = useRef(false);
  const [language, setLanguage] = useState(() => readStoredText(LABEL_PRINTER_LANGUAGE_KEY) === "ur" ? "ur" : "en");
  const isUrdu = language === "ur";
  const t = (message, values) => translateLabelPrinter(message, language, values);

  useEffect(() => {
    try {
      window.localStorage.setItem(LABEL_PRINTER_LANGUAGE_KEY, language);
    } catch {
      // Keep the language usable when browser storage is unavailable.
    }
  }, [language]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productSearch, setProductSearch] = useState("");
  const [queue, setQueue] = useState([]);
  const [draftItem, setDraftItem] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [sharedDesign, setSharedDesign] = useWorkspaceData({
    dataKey: LABEL_PRINTER_WORKSPACE_KEY,
    loadLocal: loadLabelPrinterWorkspaceLocal,
    normalize: normalizeLabelPrinterWorkspace,
    saveLocal: saveLabelPrinterWorkspaceLocal,
  });
  const customSizes = sharedDesign.customSizes;
  const productDesigns = sharedDesign.productDesigns;
  const printRotation = sharedDesign.printRotation;
  const selectedSizeId = sharedDesign.selectedSizeId;
  const setCustomSizes = useCallback(
    (next) =>
      setSharedDesign((current) => ({
        ...current,
        customSizes: typeof next === "function" ? next(current.customSizes) : next,
      })),
    [setSharedDesign]
  );
  const setProductDesigns = useCallback(
    (next) =>
      setSharedDesign((current) => ({
        ...current,
        productDesigns: typeof next === "function" ? next(current.productDesigns) : next,
      })),
    [setSharedDesign]
  );
  const setPrintRotation = useCallback(
    (next) =>
      setSharedDesign((current) => ({
        ...current,
        printRotation: typeof next === "function" ? next(current.printRotation) : next,
      })),
    [setSharedDesign]
  );
  const setSelectedSizeId = useCallback(
    (next) =>
      setSharedDesign((current) => ({
        ...current,
        selectedSizeId: typeof next === "function" ? next(current.selectedSizeId) : next,
      })),
    [setSharedDesign]
  );
  const [showNewSize, setShowNewSize] = useState(false);
  const [newSize, setNewSize] = useState({ name: "", width: "50", height: "25", gap: "2" });
  const [noticeState, setNoticeState] = useState({ message: "" });
  const notice = t(noticeState.message, Object.fromEntries(
    Object.entries(noticeState.values || {}).map(([key, value]) => [
      key, ["source", "status", "detail"].includes(key) ? t(value) : value,
    ])
  ));
  const setNotice = (message, values = {}) => setNoticeState({ message, values });
  const [activeLayer, setActiveLayer] = useState("title");
  const [designClipboard, setDesignClipboard] = useState(null);
  const [storageReady, setStorageReady] = useState(false);
  const [inlineEditingLayer, setInlineEditingLayer] = useState("");
  const [directPrinter, setDirectPrinter] = useState("");
  const [directPrinting, setDirectPrinting] = useState(false);
  const [printerOptions, setPrinterOptions] = useState([]);
  const [printerStatus, setPrinterStatus] = useState({ loading: true, error: "" });
  const [printerConnectionMode, setPrinterConnectionMode] = useState(getInitialPrinterConnectionMode);
  const [localPrintBridgeUrl, setLocalPrintBridgeUrl] = useState(getInitialLocalPrintBridgeUrl);
  const liveEditorRef = useRef(null);
  const printerSnapshotRef = useRef("");
  const directPrinterRef = useRef("");
  const printerHotplugBusyRef = useRef(false);

  useEffect(() => {
    if (!noticeState.message) return;
    noticeRef.current?.showPopover?.();
    const timeoutId = window.setTimeout(() => setNoticeState({ message: "" }), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [noticeState]);

  const useLocalPrinterBridge = printerConnectionMode === "local";
  const resolvedLocalPrintBridgeUrl = normalizeApiBaseUrl(localPrintBridgeUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL;
  const printerConnectionModeLabel = useLocalPrinterBridge ? "This laptop" : "ERP server";
  const localPrintBridgeUnavailable = t("Local printer bridge is unavailable at {url}. Start the local printer bridge on this laptop.", { url: resolvedLocalPrintBridgeUrl });

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
    useLocalPrinterBridge ? fetchLocalPrinterBridge("/local-label-printers") : api.get("/label-printers");

  const postPrinterLabels = (payload) =>
    useLocalPrinterBridge
      ? fetchLocalPrinterBridge("/local-label-printers/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : api.post("/label-printers/print", payload);

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

  const loadLabelPrinters = async ({ showNotice = false, silent = false, detectHotplug = false } = {}) => {
    if (!silent) setPrinterStatus({ loading: true, error: "" });
    try {
      const response = await getPrinterStatus();
      const printers = Array.isArray(response.data?.printers) ? response.data.printers : [];
      const previousFingerprint = printerSnapshotRef.current;
      const nextFingerprint = printerListFingerprint(printers);
      const previousNames = new Set(
        previousFingerprint
          ? previousFingerprint.split(";").map((entry) => entry.split("|")[0]).filter(Boolean)
          : []
      );
      const newlyConnected = printers.filter(
        (printer) =>
          printer.is_connected !== false &&
          printer.supports_direct_labels &&
          (!previousFingerprint || !previousNames.has(printer.name) || previousFingerprint.includes(`${printer.name}|0|`))
      );
      const newlyDisconnected = printers.filter(
        (printer) =>
          printer.supports_direct_labels &&
          printer.is_connected === false &&
          previousFingerprint &&
          previousFingerprint.includes(`${printer.name}|1|`)
      );
      const removedThermalNames = previousFingerprint
        ? previousFingerprint
            .split(";")
            .map((entry) => {
              const [name, connected, supports] = entry.split("|");
              return supports === "1" && connected === "1" ? name : "";
            })
            .filter((name) => name && !printers.some((printer) => printer.name === name))
        : [];

      setPrinterOptions(printers);
      setDirectPrinter((current) => {
        const currentOffline =
          current &&
          printers.some(
            (printer) => printer.name === current && printer.is_connected === false
          );
        const currentMissing = current && !printers.some((printer) => printer.name === current);
        // Prefer a newly plugged USB thermal when the current selection is empty or offline.
        if (detectHotplug && newlyConnected.length) {
          // Always reselect the thermal that just came back online after USB plug-in.
          directPrinterRef.current = newlyConnected[0].name;
          return newlyConnected[0].name;
        }
        if (detectHotplug && (currentOffline || currentMissing)) {
          const preferred = pickPreferredLabelPrinter(printers, "");
          directPrinterRef.current = preferred;
          return preferred;
        }
        const preferred = pickPreferredLabelPrinter(printers, current);
        directPrinterRef.current = preferred;
        return preferred;
      });
      setPrinterStatus({ loading: false, error: "" });
      printerSnapshotRef.current = nextFingerprint;

      if (detectHotplug && previousFingerprint && (newlyDisconnected.length || removedThermalNames.length)) {
        const name = newlyDisconnected[0]?.name || removedThermalNames[0];
        setNotice("USB label printer disconnected: {name}. Not connected.", { name });
      } else if (detectHotplug && previousFingerprint && newlyConnected.length) {
        setNotice("USB label printer detected and connected: {name}.", {
          name: newlyConnected[0].name,
        });
      } else if (showNotice) {
        const connectedCount = printers.filter((printer) => printer.is_connected).length;
        setNotice(printers.length
          ? "{connected} of {count} printers connected on {source}."
          : "No printers were found on {source}.",
          { connected: connectedCount, count: printers.length, source: printerConnectionModeLabel }
        );
      }
      return printers;
    } catch (error) {
      const detail = getPrinterApiError(error, "Printer status could not be checked.");
      if (!silent) {
        setPrinterOptions([]);
        setDirectPrinter("");
        directPrinterRef.current = "";
        setPrinterStatus({ loading: false, error: detail });
      }
      if (showNotice) setNotice("Printer status could not be checked: {detail}", { detail });
      return [];
    }
  };

  useEffect(() => {
    let active = true;
    const applyPrinterList = (printers, sourceLabel) => {
      setPrinterOptions(printers);
      setDirectPrinter((current) => {
        const preferred = pickPreferredLabelPrinter(printers, current);
        directPrinterRef.current = preferred;
        return preferred;
      });
      printerSnapshotRef.current = printerListFingerprint(printers);
      setPrinterStatus({ loading: false, error: "" });
      setNotice("{count} printer(s) ready on {source}.", {
        count: printers.length,
        source: sourceLabel,
      });
    };

    const wakeAndConnect = async () => {
      setPrinterStatus({ loading: true, error: "" });
      setNotice("Starting local print agent and connecting printers...");

      const ensureResult = await ensureLocalPrintAgent(
        resolvedLocalPrintBridgeUrl,
        resolveErpApiForLocalAgent()
      );
      if (!active) return;

      const ensuredPrinters = Array.isArray(ensureResult.data?.local_printers?.printers)
        ? ensureResult.data.local_printers.printers
        : [];

      if (ensureResult.ok) {
        setNotice(
          ensureResult.data?.status === "already_running"
            ? "Local print agent is online."
            : "Local print agent started. Connecting printers..."
        );
        if (ensuredPrinters.length > 0) {
          if (printerConnectionMode !== "local") {
            setPrinterConnectionMode("local");
          }
          applyPrinterList(ensuredPrinters, "This laptop");
          return;
        }
      }

      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!active) return;
        try {
          const response = await getPrinterStatus();
          const printers = Array.isArray(response.data?.printers) ? response.data.printers : [];
          if (printers.length > 0) {
            applyPrinterList(printers, printerConnectionModeLabel);
            return;
          }
          setPrinterOptions([]);
          setPrinterStatus({ loading: false, error: "" });
        } catch (error) {
          const detail = getPrinterApiError(error, "Printer status could not be checked.");
          setPrinterOptions([]);
          setDirectPrinter("");
          setPrinterStatus({ loading: false, error: detail });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }

      if (!active) return;
      if (!ensureResult.ok) {
        setNotice(
          "Could not auto-start the local print agent. Keep the local ERP backend running on port 8000, then reopen Label Printer."
        );
      } else {
        await loadLabelPrinters({ showNotice: true });
      }
    };

    wakeAndConnect();
    return () => {
      active = false;
    };
    // Only re-run when the chosen bridge target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedLocalPrintBridgeUrl]);

  useEffect(() => {
    // Refresh printer list when the user switches Local vs ERP server.
    loadLabelPrinters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerConnectionMode]);

  useEffect(() => {
    // Auto-detect USB plug/unplug while Label Printer stays open.
    let active = true;
    let ensureCooldownUntil = 0;
    const refreshForUsb = async ({ announce = true, wakeAgent = false } = {}) => {
      if (!active || printerHotplugBusyRef.current) return;
      printerHotplugBusyRef.current = true;
      try {
        const shouldWake =
          useLocalPrinterBridge &&
          (wakeAgent || Date.now() >= ensureCooldownUntil);
        if (shouldWake) {
          ensureCooldownUntil = Date.now() + 20000;
          await ensureLocalPrintAgent(resolvedLocalPrintBridgeUrl, resolveErpApiForLocalAgent());
        }
        if (!active) return;
        const printers = await loadLabelPrinters({ silent: true, detectHotplug: announce });
        if (useLocalPrinterBridge && (!printers || printers.length === 0)) {
          ensureCooldownUntil = 0;
        }
      } finally {
        printerHotplugBusyRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      refreshForUsb({ announce: true, wakeAgent: false });
    }, 1500);

    const onFocus = () => refreshForUsb({ announce: true, wakeAgent: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshForUsb({ announce: true, wakeAgent: true });
    };
    const onUsbChange = () => {
      // Windows often needs a beat before the USB printer appears in EnumPrinters.
      window.setTimeout(() => refreshForUsb({ announce: true, wakeAgent: true }), 400);
      window.setTimeout(() => refreshForUsb({ announce: true, wakeAgent: false }), 1600);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const usb = typeof navigator !== "undefined" ? navigator.usb : null;
    if (usb?.addEventListener) {
      usb.addEventListener("connect", onUsbChange);
      usb.addEventListener("disconnect", onUsbChange);
    }

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (usb?.removeEventListener) {
        usb.removeEventListener("connect", onUsbChange);
        usb.removeEventListener("disconnect", onUsbChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerConnectionMode, resolvedLocalPrintBridgeUrl, useLocalPrinterBridge]);

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
      const savedDesignClipboard = readStoredJson(DESIGN_CLIPBOARD_STORAGE_KEY, null);
      const savedQueue = readStoredJson(QUEUE_STORAGE_KEY, []);
      const savedSelectedQueueItemId = window.localStorage.getItem(SELECTED_QUEUE_ITEM_STORAGE_KEY);
      const savedActiveLayer = window.localStorage.getItem(ACTIVE_LAYER_STORAGE_KEY);

      if (isPlainObject(savedDesignClipboard)) setDesignClipboard(savedDesignClipboard);
      if (DEFAULT_LAYER_ORDER.includes(savedActiveLayer)) setActiveLayer(savedActiveLayer);
      window.localStorage.removeItem(DESIGN_STORAGE_KEY);
      window.localStorage.removeItem(DRAFT_ITEM_STORAGE_KEY);

      const restoredQueue = Array.isArray(savedQueue)
        ? savedQueue.map(normalizeStoredLabelItem).filter(Boolean)
        : [];
      setQueue(restoredQueue);

      setDraftItem(null);
      if (savedSelectedQueueItemId && restoredQueue.some((item) => item.id === savedSelectedQueueItemId)) {
        setSelectedId(savedSelectedQueueItemId);
      } else {
        setSelectedId(restoredQueue[0]?.id || "");
      }
    } catch {
      setQueue([]);
      setDraftItem(null);
      setSelectedId("");
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (designClipboard) {
      window.localStorage.setItem(DESIGN_CLIPBOARD_STORAGE_KEY, JSON.stringify(designClipboard));
    } else {
      window.localStorage.removeItem(DESIGN_CLIPBOARD_STORAGE_KEY);
    }
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    window.localStorage.setItem(SELECTED_QUEUE_ITEM_STORAGE_KEY, selectedId);
    window.localStorage.setItem(ACTIVE_LAYER_STORAGE_KEY, activeLayer);
  }, [activeLayer, designClipboard, queue, selectedId, storageReady]);

  const sizes = useMemo(() => [...DEFAULT_PRESETS, ...customSizes], [customSizes]);
  const activeSize = sizes.find((size) => size.id === selectedSizeId) || DEFAULT_PRESETS[0];
  const selectedItem = queue.find((item) => item.id === selectedId) || null;
  const editingItem = draftItem || selectedItem;
  const activeLayerConfig = getLayerConfig(activeLayer) || LABEL_LAYERS[1];
  const activeLayerLabel = activeLayerConfig?.label || "Layer";
  const activeLayerPosition = editingItem ? getLayerPosition(editingItem, activeLayer) : DEFAULT_LAYER_POSITIONS[activeLayer] || DEFAULT_LAYER_POSITIONS.title;
  const activeLayerValue = editingItem && activeLayerConfig?.field ? String(editingItem[activeLayerConfig.field] || "") : "";
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

  const applyDesignToLabelItem = (item, design) => {
    if (!isPlainObject(item)) return null;
    if (!isPlainObject(design)) return normalizeStoredLabelItem(item);
    const designValues = Object.fromEntries(
      PRODUCT_DESIGN_FIELDS.filter((field) => design[field] !== undefined).map((field) => [field, design[field]])
    );
    return normalizeStoredLabelItem({
      ...item,
      ...designValues,
      productId: item.productId,
      productName: item.productName,
      articleNo: item.articleNo,
      imageUrl: item.imageUrl,
      quantity: getLabelPrintCount(item),
      sku: item.sku,
      barcode: item.barcode,
      showImage: item.imageUrl ? Boolean(design.showImage) : false,
      layerOrder: Array.isArray(design.layerOrder) ? [...design.layerOrder] : getLayerOrder(item),
      layerOffsets: isPlainObject(design.layerOffsets) ? { ...design.layerOffsets } : item.layerOffsets,
      positions: normalizeLayerPositions(design.positions || item.positions),
    });
  };

  const createProductQueueItem = (product, quantity = 1) => {
    const baseItem = createQueueItem(product);
    const savedLayout = product?.id ? productDesigns[product.id] : null;
    const item = savedLayout ? applyDesignToLabelItem(baseItem, savedLayout) : normalizeStoredLabelItem(baseItem);
    return normalizeStoredLabelItem({ ...item, quantity: getLabelPrintCount({ quantity }) });
  };

  const selectProductForEditor = (product) => {
    const item = createProductQueueItem(product);
    if (!item) return;
    setDraftItem(item);
    setSelectedId("");
    setInlineEditingLayer("");
    setNotice("");
  };

  const addEditingItemToQueue = () => {
    if (!editingItem) return;
    const queueItem = normalizeStoredLabelItem({
      ...editingItem,
      id: draftItem ? editingItem.id : `label-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    });
    if (!queueItem) return;
    setDraftItem(null);
    setQueue((current) => [...current, queueItem]);
    setSelectedId(queueItem.id);
    setInlineEditingLayer("");
    saveProductDesign(queueItem);
    setNotice("{name} added to the print queue.", { name: queueItem.sku || queueItem.barcode || queueItem.productName || "Label" });
  };

  const buildProductDesignValues = (item) => ({
    ...pickLabelFields(item, PRODUCT_DESIGN_FIELDS),
    layerOrder: getLayerOrder(item),
    layerOffsets: isPlainObject(item.layerOffsets) ? { ...item.layerOffsets } : {},
    positions: normalizeLayerPositions(item.positions),
  });

  const saveProductDesign = (item) => {
    if (item?.productId == null) return;
    const values = buildProductDesignValues(item);
    setProductDesigns((current) => ({ ...current, [item.productId]: values }));
  };

  const copyDesignFromItem = (item) => {
    if (!item) return;
    setDesignClipboard({
      ...buildProductDesignValues(item),
      copiedFromProductId: item.productId ?? null,
      copiedFromProductName: item.productName || item.title || "Label",
      copiedAt: Date.now(),
    });
    setNotice("Copied design from {name}.", { name: item.sku || item.barcode || item.productName || "Label" });
  };
  const copySelectedDesign = () => {
    if (!editingItem) return;
    copyDesignFromItem(editingItem);
  };

  const pasteDesignToItem = (item) => applyDesignToLabelItem(item, designClipboard);
  const pasteDesignToSelected = () => {
    if (!editingItem || !designClipboard) return;
    const updated = pasteDesignToItem(editingItem);
    if (!updated) return;
    if (draftItem) {
      setDraftItem(updated);
    } else {
      setQueue((current) => current.map((item) => (item.id === editingItem.id ? updated : item)));
    }
    saveProductDesign(updated);
    setNotice("Pasted design to {name}.", { name: updated.sku || updated.barcode || updated.productName || "Label" });
  };

  const setQueueItemQuantity = (id, value) => {
    const quantity = getLabelPrintCount({ quantity: value });
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, quantity } : item)));
  };

  const adjustQueueItemQuantity = (id, delta) => {
    setQueue((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, quantity: getLabelPrintCount({ quantity: getLabelPrintCount(item) + delta }) }
          : item
      )
    );
  };
  const updateEditingItem = (updater) => {
    if (!editingItem) return;
    const updated = normalizeStoredLabelItem(updater(editingItem));
    if (!updated) return;
    if (draftItem) {
      setDraftItem(updated);
    } else {
      setQueue((current) => current.map((item) => (item.id === editingItem.id ? updated : item)));
    }
    saveProductDesign(updated);
  };

  const updateSelected = (field, value) => {
    updateEditingItem((item) => {
      const next = { ...item, [field]: value };
      if (field === "sku" && (!item.barcode || item.barcode === item.sku)) {
        next.barcode = value;
      }
      return next;
    });
  };

  const updateLayerText = (layerId, value) => {
    const layer = getLayerConfig(layerId);
    if (!layer?.field) return;
    updateEditingItem((item) => {
      const next = { ...item, [layer.field]: value };
      if (layer.field === "sku" && (!item.barcode || item.barcode === item.sku)) {
        next.barcode = value;
      }
      return next;
    });
  };

  const updateLayerPosition = (layerId, changes) => {
    if (!DEFAULT_LAYER_ORDER.includes(layerId)) return;
    updateEditingItem((item) => {
      const positions = normalizeLayerPositions(item.positions);
      const current = positions[layerId] || DEFAULT_LAYER_POSITIONS[layerId];
      const nextPosition = normalizeLayerPosition({ ...current, ...changes }, DEFAULT_LAYER_POSITIONS[layerId]);
      return { ...item, positions: { ...positions, [layerId]: nextPosition } };
    });
  };

  const nudgeActiveLayer = (dx, dy) => {
    if (!activeLayer || !editingItem) return;
    const current = getLayerPosition(editingItem, activeLayer);
    updateLayerPosition(activeLayer, { x: current.x + dx, y: current.y + dy });
  };

  const resetActiveLayerPosition = () => {
    if (!activeLayer) return;
    updateLayerPosition(activeLayer, DEFAULT_LAYER_POSITIONS[activeLayer] || DEFAULT_LAYER_POSITIONS.title);
  };

  const startLayerDrag = (layerId, event) => {
    if (!editingItem || !liveEditorRef.current || event.target?.closest?.("input, textarea, select")) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveLayer(layerId);
    setInlineEditingLayer("");

    const rect = liveEditorRef.current.getBoundingClientRect();
    const start = getLayerPosition(editingItem, layerId);
    const startClientX = event.clientX;
    const startClientY = event.clientY;

    const handlePointerMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startClientX) / Math.max(1, rect.width)) * 100;
      const dy = ((moveEvent.clientY - startClientY) / Math.max(1, rect.height)) * 100;
      updateLayerPosition(layerId, { x: start.x + dx, y: start.y + dy });
    };

    const stopDragging = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging, { once: true });
    window.addEventListener("pointercancel", stopDragging, { once: true });
  };

  const startLayerResize = (layerId, handle, event) => {
    if (!editingItem || !liveEditorRef.current) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveLayer(layerId);
    setInlineEditingLayer("");

    const rect = liveEditorRef.current.getBoundingClientRect();
    const startItem = editingItem;
    const start = getLayerPosition(startItem, layerId);
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startRight = start.x + start.w;
    const startBottom = start.y + start.h;
    const resizeAxes = getResizeAxes(handle);

    const handlePointerMove = (moveEvent) => {
      const dx = ((moveEvent.clientX - startClientX) / Math.max(1, rect.width)) * 100;
      const dy = ((moveEvent.clientY - startClientY) / Math.max(1, rect.height)) * 100;
      const rawNext = { ...start };
      if (handle.includes("e")) rawNext.w = start.w + dx;
      if (handle.includes("s")) rawNext.h = start.h + dy;
      if (handle.includes("w")) {
        rawNext.x = Math.min(startRight - 8, start.x + dx);
        rawNext.w = startRight - rawNext.x;
      }
      if (handle.includes("n")) {
        rawNext.y = Math.min(startBottom - 6, start.y + dy);
        rawNext.h = startBottom - rawNext.y;
      }

      const nextPosition = normalizeLayerPosition(rawNext, DEFAULT_LAYER_POSITIONS[layerId]);
      const scaleChanges = getLayerResizeScaleChanges(startItem, layerId, start, nextPosition, resizeAxes);
      updateEditingItem((item) => {
        const positions = normalizeLayerPositions(item.positions);
        return { ...item, ...scaleChanges, positions: { ...positions, [layerId]: nextPosition } };
      });
    };

    const stopResizing = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing, { once: true });
    window.addEventListener("pointercancel", stopResizing, { once: true });
  };

  const stepLayerMetric = (field, delta) => {
    if (!activeLayer || !editingItem) return;
    const start = getLayerPosition(editingItem, activeLayer);
    const rawNext = { ...start, [field]: Number(start[field] || 0) + delta };
    const nextPosition = normalizeLayerPosition(rawNext, DEFAULT_LAYER_POSITIONS[activeLayer]);
    const scaleChanges = getLayerResizeScaleChanges(editingItem, activeLayer, start, nextPosition, {
      x: field === "w",
      y: field === "h",
    });
    updateEditingItem((item) => {
      const positions = normalizeLayerPositions(item.positions);
      return { ...item, ...scaleChanges, positions: { ...positions, [activeLayer]: nextPosition } };
    });
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!editorDialogRef.current?.open || !editingItem || !activeLayer) return;
      const tagName = document.activeElement?.tagName;
      const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(tagName) || document.activeElement?.isContentEditable;
      if (isTyping) return;
      const step = event.shiftKey ? 2 : 0.5;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgeActiveLayer(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgeActiveLayer(0, step);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeActiveLayer(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeActiveLayer(step, 0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLayer, editingItem]);

  const removeQueueItem = (id) => {
    setQueue((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === selectedId) {
        setSelectedId(next[0]?.id || "");
        setInlineEditingLayer("");
      }
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
    if (directPrintingRef.current) return;
    if (!items.length) {
      setNotice("Add at least one product or custom label to print.");
      return;
    }
    if (!directPrinter || !selectedPrinter) {
      setNotice("Choose a connected label printer before sending a direct print job.");
      return;
    }
    if (selectedPrinterOffline) {
      setNotice("{name} is {status}. Check the cable, power, and Windows printer queue.", { name: selectedPrinter.name, status: selectedPrinter.status || "Not connected" });
      loadLabelPrinters();
      return;
    }
    if (selectedPrinterUnsupported) {
      setNotice("{name} needs Print with dialog. Direct printing requires a TSPL-compatible thermal printer.", { name: selectedPrinter.name });
      return;
    }
    const printedItems = items.map((item) => ({ ...item }));
    const labelCount = printedItems.reduce((total, item) => total + getLabelPrintCount(item), 0);
    const printingSource = printerConnectionModeLabel;
    const printingPrinter = directPrinter;
    directPrintingRef.current = true;
    setDirectPrinting(true);
    try {
      const response = await postPrinterLabels({
        labels: printedItems,
        size: { width: activeSize.width, height: activeSize.height, gap: activeSize.gap },
        printer_name: directPrinter,
      });
      if (response.data.status === "enqueued") {
        if (!response.data.job_id) throw new Error("The Print Agent did not return a job ID.");
        await waitForLabelPrintJob(response.data.job_id, async (jobId) => {
          const result = await api.get("/print-jobs", { params: { job_id: jobId, limit: 1 } });
          return result.data.jobs?.find((job) => job.job_id === jobId);
        });
      }
      setQueue((current) => {
        const remaining = removePrintedCopies(current, printedItems);
        setSelectedId((currentId) => currentId && !remaining.some((item) => item.id === currentId)
          ? remaining[0]?.id || ""
          : currentId);
        return remaining;
      });
      setInlineEditingLayer("");
      setNotice("Sent {count} labels to {printer} through {source}.", { count: labelCount, printer: response.data.printer || printingPrinter, source: printingSource });
      loadLabelPrinters();
    } catch (error) {
      setNotice("The direct label job could not be sent to the printer: {detail}", { detail: getPrinterApiError(error, "The direct label job could not be sent to the printer.") });
      loadLabelPrinters();
    } finally {
      directPrintingRef.current = false;
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
    <main className="label-printer-page" lang={language} dir={isUrdu ? "rtl" : "ltr"}>
      <header className="label-printer-header">
        <div>
          <h1>{t("Label Printer")}</h1>
        </div>
        <div className="label-printer-header-actions">
          <div className="label-printer-print-actions">
            <button className="label-printer-secondary label-printer-language-toggle" type="button" dir="ltr"
              aria-pressed={isUrdu} aria-label={isUrdu ? "Switch to English" : "اردو میں دکھائیں"}
              onClick={() => setLanguage(isUrdu ? "en" : "ur")}>
              <span lang="en" className={!isUrdu ? "is-active" : ""}>English</span>
              <span aria-hidden="true">/</span>
              <span lang="ur" className={isUrdu ? "is-active" : ""}>اردو</span>
            </button>
            <a
              className="label-printer-secondary"
              href="/portal/printer-settings"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, "", "/portal/printer-settings");
                window.dispatchEvent(new CustomEvent("erp:navigation", { detail: { page: "Printer Settings" } }));
              }}
              title={t("Configure direct print agent source and default printer")}
            >
              {t("Printer settings")}
            </a>
            <button className="label-printer-secondary" disabled={!queue.length} onClick={() => printLabels()} type="button">
              {t("Print with dialog")}
            </button>
            <button className="label-printer-primary" disabled={directPrintDisabled} onClick={() => printDirectLabels()} title={t(directPrintTitle)} type="button">
              {t(directPrinting ? "Printing..." : "Print all labels")}
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <div className="label-printer-notice" role="status" aria-atomic="true" popover="manual" ref={noticeRef}>
          <span>{notice}</span>
          <button type="button" aria-label={t("Dismiss notice")} onClick={() => setNotice("")}>
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      ) : null}

      <section className="label-printer-status-strip" aria-label={t("Printer connection status")}>
        <div>
          <span className={`label-printer-printer-status ${printerStatusClass}`} title={selectedPrinter?.status_detail || printerStatus.error || ""}>
            <span aria-hidden="true" />
            {t(printerConnectionText)}
          </span>
          <strong>{selectedPrinter?.name || t("No printer selected")}</strong>
          {selectedPrinter?.jobs ? <small>{t(selectedPrinter.jobs === 1 ? "{count} job in queue" : "{count} jobs in queue", { count: selectedPrinter.jobs })}</small> : null}
        </div>
        <div>
          <button className="label-printer-secondary" disabled={printerStatus.loading} onClick={() => loadLabelPrinters({ showNotice: true })} type="button">
            {t(printerStatus.loading ? "Checking..." : "Refresh")}
          </button>
        </div>
      </section>

      <section className="label-printer-layout">
        <aside className="label-printer-products">
          <div className="label-printer-section-head">
            <div>
              <h2>{t("Products")}</h2>
            </div>
          </div>
          <label className="label-printer-search">
            <input
              onChange={(event) => setProductSearch(event.target.value)}
              aria-label={t("Search products")}
              placeholder={t("Search products or SKU")}
              value={productSearch}
            />
          </label>
          <div className="label-printer-product-list">
            {loading ? <p className="label-printer-empty">{t("Loading products...")}</p> : null}
            {!loading && visibleProducts.length === 0 ? (
              <p className="label-printer-empty">{t("No product matches this search.")}</p>
            ) : null}
            {visibleProducts.map((product) => {
              const hasSavedDesign = Boolean(productDesigns[product.id]);
              return (
                <div className={`label-printer-product-row ${hasSavedDesign ? "has-design" : ""} ${editingItem?.productId === product.id ? "is-selected" : ""}`} key={product.id}>
                  <button className="label-printer-product-select" aria-pressed={editingItem?.productId === product.id} onClick={() => selectProductForEditor(product)} type="button">
                    {product.image_url ? <img alt="" src={getStaticUrl(product.image_url)} /> : <span className="label-printer-product-mark">SKU</span>}
                    <span>
                      <strong dir="auto">{product.name}</strong>
                      <small dir="ltr">{product.article_no}</small>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="label-printer-workspace">
          <div className="label-printer-preview-head">
            <h2>{t("Preview")}</h2>
            <button className="label-printer-secondary" type="button" aria-haspopup="dialog"
              onClick={() => sizeDialogRef.current.showModal()}>
              <span aria-hidden="true">+</span> {t("Label sizes")}
            </button>
          </div>

          <section className="label-printer-compact-preview" aria-label={t("Label preview")}>
            {editingItem ? (
              <>
                <strong dir="auto">{editingItem.productName || editingItem.title}</strong>
                <small><bdi>{editingItem.sku || editingItem.barcode}</bdi> &middot; <bdi>{activeSize.width} x {activeSize.height}</bdi> {t("mm")}</small>
                <div className="label-printer-compact-stage">
                  <LabelPreview item={editingItem} size={activeSize} />
                </div>
                <div className="label-printer-preview-footer">
                <label className="label-printer-compact-copies">
                  <span>{t("Copies")}</span>
                  <input dir="ltr" type="number" min="1" max="1000" value={editingItem.quantity}
                    onChange={(event) => updateSelected("quantity", Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} />
                </label>
                <div className="label-printer-compact-actions">
                  <button className="label-printer-primary" onClick={addEditingItemToQueue} type="button">{t("Add to queue")}</button>
                  <button className="label-printer-secondary" aria-haspopup="dialog" onClick={() => editorDialogRef.current.showModal()} type="button">{t("Editor")}</button>
                </div>
                </div>
              </>
            ) : <p className="label-printer-empty">{t("Select a product to start.")}</p>}
          </section>


        </section>
          <div className="label-printer-queue label-printer-queue-column">
            <div className="label-printer-queue-head">
              <h2>{t("Print queue")}</h2>
              <strong>{t(totalLabels === 1 ? "{count} label" : "{count} labels", { count: totalLabels })}</strong>
            </div>
            {queue.length === 0 ? <p className="label-printer-empty">{t("No labels queued.")}</p> : null}
            {queue.map((item) => {
              const printCount = getLabelPrintCount(item);
              const sku = item.sku || item.subtitle || item.barcode || t("Custom");
              return (
                <div className={`label-printer-queue-row ${!draftItem && item.id === selectedId ? "is-selected" : ""}`} key={item.id}>
                  <button className="label-printer-queue-select" aria-pressed={!draftItem && item.id === selectedId} onClick={() => { setDraftItem(null); setSelectedId(item.id); }} type="button">
                    {item.imageUrl ? <img className="label-printer-queue-thumbnail" alt="" src={getStaticUrl(item.imageUrl)} /> : <span className="label-printer-queue-thumbnail" aria-hidden="true">SKU</span>}
                    <strong className="label-printer-queue-sku" dir="ltr">{sku}</strong>
                  </button>
                  <div className="label-printer-queue-qty" aria-label={t("Copies for {sku}", { sku })}>
                    <button className="label-printer-qty-button" aria-label={t("Decrease copies")} disabled={printCount <= 1} onClick={() => adjustQueueItemQuantity(item.id, -1)} type="button">-</button>
                    <input
                      aria-label={t("Copies for {sku}", { sku })}
                      max="1000"
                      min="1"
                      onChange={(event) => setQueueItemQuantity(item.id, event.target.value)}
                      dir="ltr" type="number"
                      value={printCount}
                    />
                    <button className="label-printer-qty-button" aria-label={t("Increase copies")} onClick={() => adjustQueueItemQuantity(item.id, 1)} type="button">+</button>
                  </div>
                  <button className="label-printer-row-print" disabled={directPrintDisabled} onClick={() => printDirectLabels([item])} type="button">{t("Print")}</button>
                  <button aria-label={t("Remove {sku}", { sku })} className="label-printer-row-remove" onClick={() => removeQueueItem(item.id)} title={t("Remove")} type="button">x</button>
                </div>
              );
            })}
          </div>
      </section>
      <dialog className="label-printer-editor-dialog label-printer-size-dialog" ref={sizeDialogRef}
        aria-labelledby="label-size-title" onClose={() => setShowNewSize(false)}>
        <div className="label-printer-size-dialog-head">
          <h2 id="label-size-title">{t("Label sizes")}</h2>
          <button className="label-printer-secondary" type="button" onClick={() => sizeDialogRef.current.close()}>{t("Done")}</button>
        </div>
          <div className="label-printer-size-bar">
            <label>
              <span>{t("Label size")}</span>
              <select onChange={(event) => setSelectedSizeId(event.target.value)} value={selectedSizeId}>
                {sizes.map((size) => (
                  <option key={size.id} value={size.id}>{size.custom ? `${size.name} - ${size.width} x ${size.height} ${t("mm")}` : t(size.name)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("Print rotation")}</span>
              <select onChange={(event) => setPrintRotation(event.target.value)} value={printRotation}>
                <option value="clockwise">{t("Clockwise")}</option>
                <option value="counterclockwise">{t("Counter-clockwise")}</option>
                <option value="normal">{t("Normal")}</option>
              </select>
            </label>
            <div className="label-printer-size-actions">
              <button className="label-printer-secondary" onClick={() => setShowNewSize((current) => !current)} type="button">
                {t(showNewSize ? "Close size" : "New size")}
              </button>
              <button className="label-printer-delete-size" disabled={!activeSize.custom} onClick={removeCustomSize} type="button">
                {t("Remove")}
              </button>
            </div>
          </div>

          {showNewSize ? (
            <form className="label-printer-new-size" onSubmit={(event) => { event.preventDefault(); addCustomSize(); }}>
              <label>
                <span>{t("Name")}</span>
                <input onChange={(event) => setNewSize((current) => ({ ...current, name: event.target.value }))} value={newSize.name} />
              </label>
              <label>
                <span>{t("Width mm")}</span>
                <input min="15" max="200" onChange={(event) => setNewSize((current) => ({ ...current, width: event.target.value }))} dir="ltr" type="number" value={newSize.width} />
              </label>
              <label>
                <span>{t("Height mm")}</span>
                <input min="10" max="300" onChange={(event) => setNewSize((current) => ({ ...current, height: event.target.value }))} dir="ltr" type="number" value={newSize.height} />
              </label>
              <label>
                <span>{t("Gap mm")}</span>
                <input min="0" max="20" onChange={(event) => setNewSize((current) => ({ ...current, gap: event.target.value }))} dir="ltr" type="number" value={newSize.gap} />
              </label>
              <button className="label-printer-primary" type="submit">{t("Add")}</button>
              <button aria-label={t("Cancel custom size")} className="label-printer-icon-button" onClick={() => setShowNewSize(false)} type="button">x</button>
            </form>
          ) : null}

      </dialog>
      <dialog className="label-printer-editor-dialog" ref={editorDialogRef} aria-labelledby="label-editor-title"
        onClose={() => setInlineEditingLayer("")}>
          <section className="label-printer-editor label-printer-live-editor">
            {editingItem ? (
              <>
                <div className="label-printer-editor-head">
                  <div className="label-printer-editor-product">
                    {editingItem.imageUrl ? <img alt="" src={getStaticUrl(editingItem.imageUrl)} /> : <span className="label-printer-editor-product-mark">SKU</span>}
                    <span id="label-editor-title">{t("Label editor")}</span>

                    <small>{editingItem.sku || editingItem.barcode || t("Custom label")}</small>
                  </div>
                  <div className="label-printer-editor-queue-actions">
                    <button className="label-printer-secondary" onClick={() => { setInlineEditingLayer(""); editorDialogRef.current.close(); }} type="button">{t("Done")}</button>
                    <button className="label-printer-secondary label-printer-editor-design-button" onClick={copySelectedDesign} type="button">{t("Copy design")}</button>
                    <button className="label-printer-secondary label-printer-editor-design-button" disabled={!designClipboard} onClick={pasteDesignToSelected} type="button">{t("Paste design")}</button>
                    <button className="label-printer-primary label-printer-editor-add-button" onClick={addEditingItemToQueue} type="button">{t("Add to queue")}</button>
                    <label>
                      <span>{t("Copies")}</span>
                      <input
                        min="1"
                        max="1000"
                        onChange={(event) => updateSelected("quantity", Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
                        dir="ltr" type="number"
                        value={editingItem.quantity}
                      />
                    </label>
                  </div>
                </div>

                <div className="label-printer-live-grid">
                  <aside className="label-printer-layer-list" aria-label={t("Label layers")}>
                    {LABEL_LAYERS.map((layer) => {
                      const layerVisible = layer.visibleField ? Boolean(editingItem[layer.visibleField]) : true;
                      const layerValue = layer.field ? String(editingItem[layer.field] || "") : layer.id === "image" ? (editingItem.imageUrl ? t("Available") : t("No image")) : "";
                      return (
                        <button
                          className={`label-printer-layer-button ${activeLayer === layer.id ? "is-active" : ""} ${layerVisible ? "" : "is-muted"}`}
                          key={layer.id}
                          onClick={() => { setActiveLayer(layer.id); setInlineEditingLayer(""); }}
                          type="button"
                        >
                          <span aria-hidden="true" />
                          <strong>{t(layer.label)}</strong>
                          <small>{layerValue || t(layerVisible ? "On" : "Off")}</small>
                        </button>
                      );
                    })}
                  </aside>

                  <div className="label-printer-live-stage">
                    <div className="label-printer-live-canvas-wrap" ref={liveEditorRef}>
                      <LabelPreview
                        activeLayer={activeLayer}
                        editingLayer={inlineEditingLayer}
                        interactive
                        item={editingItem}
                        onLayerDoubleClick={(layerId) => {
                          const layer = getLayerConfig(layerId);
                          setActiveLayer(layerId);
                          if (layer?.field && layer.type === "text") setInlineEditingLayer(layerId);
                        }}
                        onLayerEditEnd={() => setInlineEditingLayer("")}
                        onLayerPointerDown={startLayerDrag}
                        onLayerResizePointerDown={startLayerResize}
                        onLayerSelect={(layerId) => { setActiveLayer(layerId); setInlineEditingLayer(""); }}
                        onLayerValueChange={updateLayerText}
                        size={activeSize}
                      />
                    </div>
                  </div>

                  <aside className="label-printer-layer-inspector">
                    <div className="label-printer-inspector-head">
                      <span>{t("Selected layer")}</span>
                      <strong>{t(activeLayerLabel)}</strong>
                    </div>

                    {activeLayerConfig?.visibleField ? (
                      <label className="label-printer-check-row">
                        <input
                          checked={Boolean(editingItem[activeLayerConfig.visibleField])}
                          disabled={activeLayerConfig.id === "image" && !editingItem.imageUrl}
                          onChange={(event) => updateSelected(activeLayerConfig.visibleField, event.target.checked)}
                          type="checkbox"
                        />
                        <span>{t("Show layer")}</span>
                      </label>
                    ) : null}

                    {activeLayerConfig?.field ? (
                      <label className="label-printer-field-wide">
                        <span>{t("Content")}</span>
                        <input
                          onChange={(event) => updateLayerText(activeLayer, event.target.value)}
                          dir="auto" value={activeLayerValue}
                        />
                      </label>
                    ) : null}

                    {activeLayerConfig?.boldField ? (
                      <div className="label-printer-control-group">
                        <span>{t("Boldness")}</span>
                        <button
                          className={`label-printer-bold-toggle ${editingItem[activeLayerConfig.boldField] !== false ? "is-active" : ""}`}
                          onClick={() => updateSelected(activeLayerConfig.boldField, editingItem[activeLayerConfig.boldField] === false)}
                          title={t("Toggle bold text")}
                          type="button"
                        >
                          B
                        </button>
                      </div>
                    ) : null}

                    {activeLayerConfig?.alignField ? (
                      <div className="label-printer-control-group">
                        <span>{t("Alignment")}</span>
                        <div className="label-printer-segmented" role="group">
                          {[["left", "L"], ["center", "C"], ["right", "R"]].map(([value, label]) => (
                            <button
                              className={editingItem[activeLayerConfig.alignField] === value ? "is-active" : ""}
                              key={value}
                              aria-label={t({ left: "Left", center: "Center", right: "Right" }[value])}
                              onClick={() => updateSelected(activeLayerConfig.alignField, value)}
                              type="button"
                            >
                              {isUrdu ? t({ left: "Left", center: "Center", right: "Right" }[value]) : label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {activeLayerConfig?.scaleField ? (
                      <label>
                        <span>{t("Size")} {Number(editingItem[activeLayerConfig.scaleField] || 1).toFixed(2)}x</span>
                        <input
                          max={activeLayerConfig.id === "barcode" ? "1.8" : "2.8"}
                          min="0.45"
                          onChange={(event) => updateSelected(activeLayerConfig.scaleField, Number(event.target.value))}
                          step="0.05"
                          type="range"
                          value={editingItem[activeLayerConfig.scaleField] || 1}
                        />
                      </label>
                    ) : null}

                    {activeLayerConfig?.heightScaleField ? (
                      <label>
                        <span>{t("Height")} {getBarcodeHeightScale(editingItem).toFixed(2)}x</span>
                        <input
                          max="2"
                          min="0.55"
                          onChange={(event) => updateSelected(activeLayerConfig.heightScaleField, Number(event.target.value))}
                          step="0.05"
                          type="range"
                          value={getBarcodeHeightScale(editingItem)}
                        />
                      </label>
                    ) : null}

                    <div className="label-printer-transform-panel">
                      <div className="label-printer-transform-head">
                        <span>{t("Transform")}</span>
                        <button onClick={resetActiveLayerPosition} type="button">{t("Reset")}</button>
                      </div>
                      <div className="label-printer-transform-grid">
                        {[["x", "X"], ["y", "Y"], ["w", "W"], ["h", "H"]].map(([field, label]) => (
                          <div className="label-printer-transform-stepper" key={field}>
                            <span>{label}</span>
                            <button aria-label={t(`${label} decrease`)} onClick={() => stepLayerMetric(field, -0.5)} type="button">-</button>
                            <strong>{Number(activeLayerPosition[field].toFixed(1))}</strong>
                            <button aria-label={t(`${label} increase`)} onClick={() => stepLayerMetric(field, 0.5)} type="button">+</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </aside>
                </div>
              </>
            ) : (
              <p className="label-printer-editor-empty">{t("No label selected.")}</p>
            )}
          </section>
      </dialog>
    </main>
  );
}

export default LabelPrinter;
