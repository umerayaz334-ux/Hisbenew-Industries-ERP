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
export const DIRECT_PRINTER_STORAGE_KEY = "erpLabelPrinterDirectPrinter";
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

export const COPY_STYLE_FIELDS = SAVED_DESIGN_FIELDS.filter(
  (field) => !["title", "price"].includes(field)
);

export const TEXT_LAYERS = [
  { id: "brand", label: "Brand", field: "brand", alignField: "brandAlign", boldField: "brandBold", scaleField: "brandScale", visibleField: "showBrand" },
  { id: "title", label: "Handmade category", field: "title", alignField: "titleAlign", boldField: "titleBold", scaleField: "titleScale" },
  { id: "sku", label: "SKU number", field: "sku", alignField: "skuAlign", boldField: "skuBold", scaleField: "skuScale" },
  { id: "price", label: "Price / note", field: "price", alignField: "priceAlign", boldField: "priceBold", scaleField: "priceScale", visibleField: "showPrice" },
];

export const DEFAULT_LAYER_ORDER = ["brand", "title", "price", "image", "barcode", "sku"];

export const DEFAULT_LAYER_POSITIONS = {
  brand: { x: 7, y: 8, w: 42, h: 12 },
  title: { x: 9, y: 20, w: 82, h: 20 },
  price: { x: 7, y: 64, w: 34, h: 12 },
  image: { x: 68, y: 7, w: 24, h: 24 },
  barcode: { x: 20, y: 48, w: 60, h: 18 },
  sku: { x: 20, y: 70, w: 60, h: 16 },
};

const LAYER_STRETCH_FIELDS = {
  brand: { x: "brandStretchX", y: "brandStretchY" },
  title: { x: "titleStretchX", y: "titleStretchY" },
  price: { x: "priceStretchX", y: "priceStretchY" },
  sku: { x: "skuStretchX", y: "skuStretchY" },
};

const LAYER_BOLD_FIELDS = {
  brand: "brandBold",
  title: "titleBold",
  sku: "skuBold",
  price: "priceBold",
};

const LAYER_FONT_WEIGHTS = {
  brand: { bold: 800, regular: 500 },
  title: { bold: 900, regular: 600 },
  sku: { bold: 900, regular: 600 },
  price: { bold: 800, regular: 500 },
};

export const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export const clampNumber = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

export const normalizeLayerPosition = (position, fallback) => {
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

export const normalizeLayerPositions = (positions = {}) =>
  Object.fromEntries(
    DEFAULT_LAYER_ORDER.map((layerId) => [
      layerId,
      normalizeLayerPosition(positions?.[layerId], DEFAULT_LAYER_POSITIONS[layerId]),
    ])
  );

export const getLayerPosition = (item, layerId) =>
  normalizeLayerPosition(item?.positions?.[layerId], DEFAULT_LAYER_POSITIONS[layerId]);

export const getLayerStretch = (item, layerId) => {
  const fields = LAYER_STRETCH_FIELDS[layerId];
  return {
    x: fields?.x ? clampNumber(item?.[fields.x], 0.25, 4, 1) : 1,
    y: fields?.y ? clampNumber(item?.[fields.y], 0.25, 4, 1) : 1,
  };
};

export const getLayerBold = (item, layerId) => {
  const field = LAYER_BOLD_FIELDS[layerId];
  return field ? item?.[field] !== false : false;
};

export const getLayerFontWeight = (item, layerId) => {
  const weights = LAYER_FONT_WEIGHTS[layerId];
  if (!weights) return 700;
  return getLayerBold(item, layerId) ? weights.bold : weights.regular;
};

export const getLayerPositionStyle = (item, layerId) => {
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
  return isLoopbackHostname(window.location.hostname);
};

export const getInitialPrinterConnectionMode = () => {
  const savedMode = readStoredText(PRINTER_CONNECTION_MODE_STORAGE_KEY);
  if (["local", "server"].includes(savedMode)) return savedMode;
  return "server";
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
    svg.setAttribute("preserveAspectRatio", "none");
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
  brandBold: true,
  titleBold: true,
  skuBold: true,
  priceBold: true,
  brandScale: 1,
  titleScale: 1.3,
  skuScale: 1.55,
  priceScale: 1,
  brandStretchX: 1,
  brandStretchY: 1,
  titleStretchX: 1,
  titleStretchY: 1,
  skuStretchX: 1,
  skuStretchY: 1,
  priceStretchX: 1,
  priceStretchY: 1,
  barcodeScale: 1,
  barcodeHeightScale: 1,
  layerOrder: [...DEFAULT_LAYER_ORDER],
  layerOffsets: {},
  positions: normalizeLayerPositions(),
});

export const getLabelPrintCount = (item) =>
  Math.max(1, Math.min(1000, Number(item?.quantity ?? item) || 1));

export const getBarcodeHeightScale = (item) =>
  Math.max(0.55, Math.min(2, Number(item?.barcodeHeightScale || 1)));

export const getLabelRenderMetrics = (size, item = {}) => {
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
    brandBold: item.brandBold !== false,
    titleBold: item.titleBold !== false,
    skuBold: item.skuBold !== false,
    priceBold: item.priceBold !== false,
    layerOrder: getLayerOrder(item),
    layerOffsets: isPlainObject(item.layerOffsets) ? item.layerOffsets : {},
    positions: normalizeLayerPositions(item.positions),
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
    positions: normalizeLayerPositions(savedLayout.positions || baseItem.positions),
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
  const pageMetrics = getLabelRenderMetrics(size);
  const { width, height } = pageMetrics;
  const isRotated = printRotation === "clockwise" || printRotation === "counterclockwise";
  const pageWidth = isRotated ? height : width;
  const pageHeight = isRotated ? width : height;

  const labels = items.flatMap((item) =>
    Array.from({ length: getLabelPrintCount(item) }, () => {
      const metrics = getLabelRenderMetrics(size, item);
      const barcode = item.showBarcode
        ? createBarcodeSvg(item.barcode, metrics.barcodeHeight, metrics.barcodeScale, metrics.barcodeHeightScale)
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