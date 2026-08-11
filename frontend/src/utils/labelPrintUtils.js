import JsBarcode from "jsbarcode";
import { getStaticUrl } from "../api/api";

export const DEFAULT_PRESETS = [
  { id: "product-50x25", name: "Product 50 x 25 mm", width: 50, height: 25, gap: 2 },
  { id: "product-70x35", name: "Product 70 x 35 mm", width: 70, height: 35, gap: 2 },
  { id: "product-100x50", name: "Product 100 x 50 mm", width: 100, height: 50, gap: 3 },
  { id: "shipping-100x150", name: "Shipping 100 x 150 mm", width: 100, height: 150, gap: 3 },
];

export const CUSTOM_SIZE_STORAGE_KEY = "erpLabelPrinterCustomSizes";
export const DESIGN_STORAGE_KEY = "erpLabelPrinterSavedDesigns";
export const PRODUCT_DESIGN_STORAGE_KEY = "erpLabelPrinterProductDesigns";
export const PRINT_ROTATION_STORAGE_KEY = "erpLabelPrinterPrintRotation";
export const QUEUE_STORAGE_KEY = "erpLabelPrinterQueue";
export const DRAFT_ITEM_STORAGE_KEY = "erpLabelPrinterDraftItem";
export const SELECTED_SIZE_STORAGE_KEY = "erpLabelPrinterSelectedSize";
export const SELECTED_QUEUE_ITEM_STORAGE_KEY = "erpLabelPrinterSelectedQueueItem";
export const ACTIVE_LAYER_STORAGE_KEY = "erpLabelPrinterActiveLayer";
export const DESIGN_CLIPBOARD_STORAGE_KEY = "erpLabelPrinterDesignClipboard";
export const PRINTER_CONNECTION_MODE_STORAGE_KEY = "erpLabelPrinterConnectionMode";
export const LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY = "erpLabelPrinterLocalBridgeUrl";
export const DEFAULT_LOCAL_PRINT_BRIDGE_URL = "http://127.0.0.1:8000";

export const SAVED_DESIGN_FIELDS = [
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

export const COPY_STYLE_FIELDS = SAVED_DESIGN_FIELDS.filter(
  (field) => !["title", "price"].includes(field)
);

export const TEXT_LAYERS = [
  { id: "brand", label: "Brand", field: "brand", alignField: "brandAlign", scaleField: "brandScale", visibleField: "showBrand" },
  { id: "title", label: "Handmade category", field: "title", alignField: "titleAlign", scaleField: "titleScale" },
  { id: "sku", label: "SKU number", field: "sku", alignField: "skuAlign", scaleField: "skuScale" },
  { id: "price", label: "Price / note", field: "price", alignField: "priceAlign", scaleField: "priceScale", visibleField: "showPrice" },
];

export const DEFAULT_LAYER_ORDER = ["brand", "title", "price", "image", "barcode", "sku"];

export const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export const readStoredJson = (key, fallback) => {
  if (typeof window === "undefined") return fallback;
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue == null ? fallback : JSON.parse(rawValue);
  } catch {
    return fallback;
  }
};
export const readStoredText = (key, fallback = "") => {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

export const normalizeApiBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

export const isLoopbackHostname = (hostname) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(hostname || "").toLowerCase());

export const shouldUseLocalPrinterBridgeByDefault = () => {
  if (typeof window === "undefined") return false;
  return Boolean(window.location.hostname && !isLoopbackHostname(window.location.hostname));
};

export const getInitialPrinterConnectionMode = () => {
  const savedMode = readStoredText(PRINTER_CONNECTION_MODE_STORAGE_KEY);
  if (["local", "server"].includes(savedMode)) return savedMode;
  return shouldUseLocalPrinterBridgeByDefault() ? "local" : "server";
};

export const getInitialLocalPrintBridgeUrl = () =>
  normalizeApiBaseUrl(readStoredText(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, DEFAULT_LOCAL_PRINT_BRIDGE_URL)) ||
  DEFAULT_LOCAL_PRINT_BRIDGE_URL;

export const buildPrintBridgeUrl = (baseUrl, path) =>
  `${normalizeApiBaseUrl(baseUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL}${path.startsWith("/") ? path : `/${path}`}`;

export const getPrinterApiError = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

export const fetchLocalPrinterBridge = async (baseUrl, path, options = {}, unavailableMessage = "") => {
  let response;
  try {
    response = await fetch(buildPrintBridgeUrl(baseUrl, path), {
      ...options,
      targetAddressSpace: "loopback",
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    const detail =
      unavailableMessage ||
      `Local printer bridge is not reachable at ${
        normalizeApiBaseUrl(baseUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL
      }. Start the local printer bridge on this laptop, then refresh printers.`;
    const bridgeError = new Error(detail);
    bridgeError.response = { data: { detail } };
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

const getDesignTimestamp = (design, fallback = 0) => {
  const explicit = Number(design?.updatedAt || design?.savedAt || design?.createdAt || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const idTimestamp = Number(String(design?.id || "").match(/^design-(\d+)/)?.[1] || 0);
  return Number.isFinite(idTimestamp) && idTimestamp > 0 ? idTimestamp : fallback;
};

export const getLatestSavedDesign = (designs = []) =>
  Array.isArray(designs)
    ? designs.reduce((latest, design, index) => {
        if (!isPlainObject(design)) return latest;
        const timestamp = getDesignTimestamp(design, index + 1);
        if (!latest || timestamp >= latest.timestamp) {
          return { design, timestamp };
        }
        return latest;
      }, null)?.design || null
    : null;

export const pickLabelFields = (item, fields) =>
  Object.fromEntries(fields.map((field) => [field, item[field]]));

export const getLayerOrder = (item) => {
  const knownLayers = new Set(DEFAULT_LAYER_ORDER);
  const savedOrder = Array.isArray(item?.layerOrder)
    ? item.layerOrder.filter((layerId) => knownLayers.has(layerId))
    : [];
  return [...new Set([...savedOrder, ...DEFAULT_LAYER_ORDER])];
};

export const getLayerOffset = (item, layerId) => {
  const value = Number(item?.layerOffsets?.[layerId] || 0);
  return Number.isFinite(value) ? Math.max(-8, Math.min(8, value)) : 0;
};

export const getLayerAlignment = (item, layerId) => {
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

export const formatDefaultLabelTitle = (product = null) => {
  const rawCategory = String(product?.category || product?.name || "PRODUCT")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^handmade\s+/i, "");
  const words = (rawCategory || "PRODUCT").split(" ");
  const lastWord = words.pop() || "PRODUCT";
  const normalizedCategory = [...words, singularizeCategoryWord(lastWord)].join(" ");
  return `HANDMADE ${normalizedCategory.toUpperCase()}`;
};

export const escapeHtml = (value) =>
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

export const createBarcodeSvg = (value, height = 48, scale = 1, heightScale = 1) => {
  if (typeof document === "undefined") return "";
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

export const createQueueItem = (product = null) => ({
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

export const getLabelPrintCount = (item) =>
  Math.max(1, Math.min(1000, Number(item?.quantity ?? item) || 1));

export const getBarcodeHeightScale = (item) =>
  Math.max(0.55, Math.min(2, Number(item?.barcodeHeightScale || 1)));

export const normalizeStoredLabelItem = (item) => {
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

export const getLabelPrinterSizes = (customSizes = []) => [
  ...DEFAULT_PRESETS,
  ...(Array.isArray(customSizes) ? customSizes : []),
];

export const readLabelPrinterSettings = () => {
  const customSizes = readStoredJson(CUSTOM_SIZE_STORAGE_KEY, []);
  const savedDesigns = readStoredJson(DESIGN_STORAGE_KEY, []);
  const productDesigns = readStoredJson(PRODUCT_DESIGN_STORAGE_KEY, {});
  const selectedSizeId =
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem(SELECTED_SIZE_STORAGE_KEY) || "";
  const savedPrintRotation =
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem(PRINT_ROTATION_STORAGE_KEY) || "";
  const sizes = getLabelPrinterSizes(customSizes);
  const activeSize = sizes.find((size) => size.id === selectedSizeId) || DEFAULT_PRESETS[0];
  const printRotation = ["normal", "clockwise", "counterclockwise"].includes(savedPrintRotation)
    ? savedPrintRotation
    : "clockwise";

  return {
    activeSize,
    customSizes: Array.isArray(customSizes) ? customSizes : [],
    latestSavedDesign: getLatestSavedDesign(savedDesigns),
    printRotation,
    productDesigns: isPlainObject(productDesigns) ? productDesigns : {},
    savedDesigns: Array.isArray(savedDesigns) ? savedDesigns : [],
    selectedSizeId,
    sizes,
  };
};

export const applyLabelDesignToItem = (baseItem, savedLayout) => {
  if (!isPlainObject(baseItem) || !isPlainObject(savedLayout)) return baseItem;
  return {
    ...baseItem,
    ...savedLayout,
    productId: baseItem.productId,
    productName: baseItem.productName,
    articleNo: baseItem.articleNo,
    imageUrl: baseItem.imageUrl,
    sku: baseItem.sku,
    barcode: baseItem.barcode,
    showImage: baseItem.imageUrl ? Boolean(savedLayout.showImage) : false,
    layerOrder: Array.isArray(savedLayout.layerOrder)
      ? [...savedLayout.layerOrder]
      : baseItem.layerOrder,
    layerOffsets: isPlainObject(savedLayout.layerOffsets)
      ? { ...savedLayout.layerOffsets }
      : baseItem.layerOffsets,
  };
};

export const createLabelPrinterItemForProduct = (
  product = null,
  { quantity = 1, productDesigns = null } = {}
) => {
  const baseItem = createQueueItem(product);
  const savedLayout = product?.id != null && productDesigns ? productDesigns[product.id] : null;
  const item = savedLayout ? applyLabelDesignToItem(baseItem, savedLayout) : baseItem;

  return { ...item, quantity: getLabelPrintCount(quantity) };
};

export const buildPrintDocument = (items, size, printRotation = "clockwise") => {
  const width = Number(size.width);
  const height = Number(size.height);
  const isRotated = printRotation === "clockwise" || printRotation === "counterclockwise";
  const pageWidth = isRotated ? height : width;
  const pageHeight = isRotated ? width : height;
  const compact = height <= 30;
  const labels = items.flatMap((item) =>
    Array.from({ length: getLabelPrintCount(item) }, () => {
      const barcodeHeightScale = getBarcodeHeightScale(item);
      const barcode = item.showBarcode
        ? createBarcodeSvg(item.barcode, compact ? 36 : 58, item.barcodeScale || 1, barcodeHeightScale)
        : "";
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