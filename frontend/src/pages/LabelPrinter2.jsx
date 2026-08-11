import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import api, { getStaticUrl } from "../api/api";
import "./LabelPrinter2.css";

const PRESET_LABEL_SIZES = [
  { id: "50x25", name: "2.06\" x 1\" (50x25mm)", width: 50, height: 25, unit: "mm" },
  { id: "50x30", name: "Standard SKU (50x30mm)", width: 50, height: 30, unit: "mm" },
  { id: "75x50", name: "Medium Box Tag (75x50mm)", width: 75, height: 50, unit: "mm" },
  { id: "100x50", name: "Large Inventory Tag (100x50mm)", width: 100, height: 50, unit: "mm" },
  { id: "100x150", name: "Shipping Label (4\"x6\")", width: 100, height: 150, unit: "mm" },
];

const FONT_FAMILIES = [
  { id: "arial", name: "Arial / Standard Sans (Default)", family: 'Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: "impact", name: "Impact / Heavy Condensed", family: '"Impact", "Arial Black", sans-serif' },
  { id: "aldhabi", name: "Aldhabi (BarTender Classic)", family: '"Aldhabi", "Impact", fantasy, sans-serif' },
  { id: "bebas", name: "Bebas Neue / Oswald", family: '"Bebas Neue", "Oswald", "Arial Narrow", sans-serif' },
  { id: "arial_black", name: "Arial Black", family: '"Arial Black", "Gadget", sans-serif' },
  { id: "inter", name: "Inter (Modern Sans)", family: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif' },
  { id: "trebuchet", name: "Trebuchet MS", family: '"Trebuchet MS", "Lucida Sans", sans-serif' },
  { id: "verdana", name: "Verdana", family: 'Verdana, Geneva, sans-serif' },
  { id: "comic", name: "Comic Sans MS", family: '"Comic Sans MS", cursive, sans-serif' },
  { id: "mono", name: "Monospace (Courier New)", family: '"Courier New", Courier, "JetBrains Mono", monospace' },
  { id: "serif", name: "Georgia (Serif)", family: 'Georgia, "Times New Roman", serif' },
];

const FONT_WEIGHTS = [
  { value: "400", label: "Normal (400)" },
  { value: "600", label: "Semi Bold (600)" },
  { value: "700", label: "Bold (700)" },
  { value: "800", label: "Extra Bold (800)" },
  { value: "900", label: "Black (900)" },
];

const BARCODE_FORMATS = [
  { id: "CODE128", name: "CODE 128 (Standard)" },
  { id: "EAN13", name: "EAN 13" },
  { id: "EAN8", name: "EAN 8" },
  { id: "UPC", name: "UPC A" },
  { id: "QR", name: "QR Code (Matrix)" },
];

const BarcodeCanvas = ({ value, format = "CODE128", height = 54, scale = 1.4, showText = false }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current) return;
    if (format === "QR") return;
    try {
      JsBarcode(svgRef.current, String(value || "KLF-414"), {
        format: format === "CODE128" ? "CODE128" : format,
        width: Math.max(1, 1.4 * Number(scale || 1)),
        height: Math.max(20, Number(height || 54)),
        margin: 0,
        displayValue: Boolean(showText),
        fontSize: 12,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      if (svgRef.current) svgRef.current.innerHTML = "";
    }
  }, [value, format, height, scale, showText]);

  if (format === "QR") {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(value || "KLF-414")}`;
    return (
      <div className="lp2-qr-box">
        <img alt="QR Code" src={qrUrl} style={{ width: `${height * 1.6}px`, height: `${height * 1.6}px` }} />
        {showText && <span className="lp2-qr-subtext">{value}</span>}
      </div>
    );
  }

  return <svg aria-label={`Barcode ${value || ""}`} ref={svgRef} role="img" />;
};

export default function LabelPrinter2() {
  const [selectedSize, setSelectedSize] = useState(PRESET_LABEL_SIZES[0]);
  const [customSizes, setCustomSizes] = useState(() => {
    try {
      const stored = localStorage.getItem("lp2_custom_sizes");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [labelDesign, setLabelDesign] = useState({
    title: "HANDMADE FOLDING KNIFE",
    sku: "KLF-414",
    barcode: "KLF-414",
    brand: "HISBENEW",
    price: "$49.99",
    barcodeFormat: "CODE128",
    showTitle: true,
    showBarcode: true,
    showSku: true,
    showBrand: false,
    showPrice: false,
    
    fontFamily: "arial",
    fontWeight: "900",
    titleFontSize: 18,
    skuFontSize: 32,
    brandFontSize: 12,
    priceFontSize: 16,
    textAlign: "center",
    titleLetterSpacing: 1.5,
    skuLetterSpacing: 2.0,
    brandLetterSpacing: 0,
    priceLetterSpacing: 0,
    barcodeHeight: 58,
    barcodeScale: 1.5,

    positions: {
      title: { x: 0, y: 0 },
      barcode: { x: 0, y: 0 },
      sku: { x: 0, y: 0 },
      brand: { x: 0, y: 0 },
      price: { x: 0, y: 0 },
    },
  });

  const [activeLayer, setActiveLayer] = useState("title");
  const [editingLayer, setEditingLayer] = useState(null); // Layer currently in live inline text editing
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [printQuantity, setPrintQuantity] = useState(1);
  const [savedTemplates, setSavedTemplates] = useState(() => {
    try {
      const stored = localStorage.getItem("lp2_templates");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [templateName, setTemplateName] = useState("");
  const [showCustomSizeModal, setShowCustomSizeModal] = useState(false);
  const [newWidth, setNewWidth] = useState(50);
  const [newHeight, setNewHeight] = useState(25);
  const [newSizeName, setNewSizeName] = useState("Custom Label");

  // Dragging State
  const canvasRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const layerStartPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    api.get("/products")
      .then((res) => setProducts(Array.isArray(res.data) ? res.data : []))
      .catch(() => setProducts([]));
  }, []);

  const allSizes = useMemo(() => [...PRESET_LABEL_SIZES, ...customSizes], [customSizes]);

  const handleSelectProduct = (productId) => {
    setSelectedProductId(productId);
    if (!productId) return;
    const prod = products.find((p) => String(p.id) === String(productId));
    if (!prod) return;

    setLabelDesign((prev) => ({
      ...prev,
      title: (prod.name || prod.title || prev.title).toUpperCase(),
      sku: prod.sku || prod.code || prev.sku,
      barcode: prod.barcode || prod.sku || prev.barcode,
      brand: prod.brand || prev.brand,
      price: prod.price ? `$${Number(prod.price).toFixed(2)}` : prev.price,
    }));
  };

  // Drag Handlers for Repositioning Layer
  const handleMouseDownLayer = (layerId, e) => {
    e.stopPropagation();
    if (editingLayer === layerId) return; // Allow inline typing without drag
    setActiveLayer(layerId);
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    const currentPos = labelDesign.positions[layerId] || { x: 0, y: 0 };
    layerStartPosRef.current = { ...currentPos };

    const handleMouseMove = (moveEvt) => {
      if (!isDraggingRef.current) return;
      const dx = moveEvt.clientX - dragStartRef.current.x;
      const dy = moveEvt.clientY - dragStartRef.current.y;
      setLabelDesign((prev) => ({
        ...prev,
        positions: {
          ...prev.positions,
          [layerId]: {
            x: layerStartPosRef.current.x + dx,
            y: layerStartPosRef.current.y + dy,
          },
        },
      }));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Drag Resizing Engine via Bounding Box Handles
  const handleResizeMouseDown = (handleDir, layerId, e) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveLayer(layerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startTitleSize = labelDesign.titleFontSize;
    const startSkuSize = labelDesign.skuFontSize;
    const startBarcodeHeight = labelDesign.barcodeHeight;
    const startBarcodeScale = labelDesign.barcodeScale;

    const handleMouseMove = (moveEvt) => {
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;
      const isVerticalDrag = handleDir.includes("n") || handleDir.includes("s");

      setLabelDesign((prev) => {
        if (layerId === "title") {
          const delta = isVerticalDrag ? dy : dx;
          const factor = handleDir.includes("n") || handleDir.includes("w") ? -0.3 : 0.3;
          const nextSize = Math.max(10, Math.min(64, Math.round(startTitleSize + delta * factor)));
          return { ...prev, titleFontSize: nextSize };
        }
        if (layerId === "sku") {
          const delta = isVerticalDrag ? dy : dx;
          const factor = handleDir.includes("n") || handleDir.includes("w") ? -0.3 : 0.3;
          const nextSize = Math.max(12, Math.min(72, Math.round(startSkuSize + delta * factor)));
          return { ...prev, skuFontSize: nextSize };
        }
        if (layerId === "barcode") {
          const deltaY = handleDir.includes("n") ? -dy : dy;
          const deltaX = handleDir.includes("w") ? -dx : dx;
          const nextHeight = Math.max(20, Math.min(140, Math.round(startBarcodeHeight + deltaY * 0.5)));
          const nextScale = Math.max(0.6, Math.min(3.0, Number((startBarcodeScale + deltaX * 0.01).toFixed(2))));
          return { ...prev, barcodeHeight: nextHeight, barcodeScale: nextScale };
        }
        return prev;
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const nudgeActiveLayer = (dx, dy) => {
    if (!activeLayer) return;
    setLabelDesign((prev) => {
      const current = prev.positions[activeLayer] || { x: 0, y: 0 };
      return {
        ...prev,
        positions: {
          ...prev.positions,
          [activeLayer]: { x: current.x + dx, y: current.y + dy },
        },
      };
    });
  };

  // Keyboard Arrow Key Listener for Moving Selected Layer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!activeLayer) return;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (isInput) return;

      const step = e.shiftKey ? 10 : 2;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeActiveLayer(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeActiveLayer(0, step);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeActiveLayer(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeActiveLayer(step, 0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLayer]);

  const handleDeselectAll = () => {
    setActiveLayer(null);
    setEditingLayer(null);
  };

  const adjustFontSize = (delta) => {
    setLabelDesign((prev) => {
      if (activeLayer === "title") {
        return { ...prev, titleFontSize: Math.max(8, Math.min(72, prev.titleFontSize + delta)) };
      }
      if (activeLayer === "sku") {
        return { ...prev, skuFontSize: Math.max(8, Math.min(72, prev.skuFontSize + delta)) };
      }
      if (activeLayer === "barcode") {
        return { ...prev, barcodeHeight: Math.max(20, Math.min(140, prev.barcodeHeight + delta * 2)) };
      }
      return { ...prev, titleFontSize: Math.max(8, Math.min(72, prev.titleFontSize + delta)) };
    });
  };

  const toggleBold = () => {
    setLabelDesign((prev) => ({
      ...prev,
      fontWeight: ["700", "800", "900"].includes(prev.fontWeight) ? "400" : "900",
    }));
  };

  const adjustLetterSpacing = (delta) => {
    setLabelDesign((prev) => {
      const target = activeLayer || "title";
      const key = target === "sku" ? "skuLetterSpacing" : target === "brand" ? "brandLetterSpacing" : target === "price" ? "priceLetterSpacing" : "titleLetterSpacing";
      const current = prev[key] || 0;
      const next = Number((Math.max(-2, Math.min(16, current + delta))).toFixed(1));
      return { ...prev, [key]: next };
    });
  };

  const handleAddCustomSize = (e) => {
    e.preventDefault();
    const width = Number(newWidth) || 50;
    const height = Number(newHeight) || 25;
    const newPreset = {
      id: `custom_${Date.now()}`,
      name: newSizeName || `Custom ${width}x${height}mm`,
      width,
      height,
      unit: "mm",
    };
    const nextCustoms = [...customSizes, newPreset];
    setCustomSizes(nextCustoms);
    localStorage.setItem("lp2_custom_sizes", JSON.stringify(nextCustoms));
    setSelectedSize(newPreset);
    setShowCustomSizeModal(false);
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    const tpl = {
      id: `tpl_${Date.now()}`,
      name: templateName.trim(),
      design: { ...labelDesign },
      size: { ...selectedSize },
      createdAt: new Date().toISOString(),
    };
    const nextTpls = [...savedTemplates, tpl];
    setSavedTemplates(nextTpls);
    localStorage.setItem("lp2_templates", JSON.stringify(nextTpls));
    setTemplateName("");
  };

  const handleLoadTemplate = (tpl) => {
    if (!tpl) return;
    if (tpl.design) setLabelDesign(tpl.design);
    if (tpl.size) setSelectedSize(tpl.size);
  };

  const handleDeleteTemplate = (id) => {
    const nextTpls = savedTemplates.filter((t) => t.id !== id);
    setSavedTemplates(nextTpls);
    localStorage.setItem("lp2_templates", JSON.stringify(nextTpls));
  };

  const handlePrint = () => {
    // 50ms delay guarantees pre-rendered off-screen SVGs are 100% ready before opening browser print modal
    setTimeout(() => {
      window.print();
    }, 50);
  };

  const activeFontFamilyObj = FONT_FAMILIES.find((f) => f.id === labelDesign.fontFamily) || FONT_FAMILIES[0];

  return (
    <div className="lp2-studio-page">
      {/* Gaincha Thermal Print Engine Setup */}
      <style>{`
        @media print {
          /* HIDE ALL APPLICATION UI PANELS FROM PRINT LAYOUT ENGINE */
          .bt-main-appbar,
          .bt-studio-toolbar,
          .lp2-main-grid,
          .lp2-modal-backdrop,
          .sidebar-container,
          .header-container,
          header, nav, aside, footer {
            display: none !important;
          }

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: ${selectedSize.width}mm !important;
            height: ${selectedSize.height}mm !important;
            background: #ffffff !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .lp2-print-area {
            display: block !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: ${selectedSize.width}mm !important;
            height: ${selectedSize.height}mm !important;
            margin: 0 !important;
            padding: 0 !important;
            opacity: 1 !important;
            visibility: visible !important;
            z-index: 999999 !important;
          }

          .lp2-print-area * {
            visibility: visible !important;
          }

          .lp2-print-label-item {
            width: ${selectedSize.width}mm !important;
            height: ${selectedSize.height}mm !important;
            page-break-after: always !important;
            break-after: page !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            display: block !important;
          }

          @page {
            size: ${selectedSize.width}mm ${selectedSize.height}mm !important;
            margin: 0 !important;
          }
        }
      `}</style>

      {/* BarTender UltraLite Appbar */}
      <header className="bt-main-appbar">
        <div className="bt-brand-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>
          <span>BarTender UltraLite Studio Edition</span>
          <span className="bt-doc-tag">{selectedSize.name}</span>
        </div>
        <div className="bt-appbar-actions">
          <div className="lp2-qty-box">
            <span>Copies:</span>
            <input
              type="number"
              min="1"
              max="999"
              value={printQuantity}
              onChange={(e) => setPrintQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
          <button className="lp2-btn-print" onClick={handlePrint} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print Thermal Labels ({printQuantity})
          </button>
        </div>
      </header>

      {/* BarTender Studio Top Toolbar */}
      <div className="bt-studio-toolbar">
        {/* Expanded Fonts Picker */}
        <div className="bt-tb-group">
          <span className="bt-tb-label">Font:</span>
          <select
            title="Font Family"
            value={labelDesign.fontFamily}
            onChange={(e) => setLabelDesign((prev) => ({ ...prev, fontFamily: e.target.value }))}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        <div className="bt-tb-divider" />

        {/* Dynamic Font Size (+ / -) Incrementor */}
        <div className="bt-tb-group">
          <span className="bt-tb-label">Size:</span>
          <button className="bt-tb-btn" onClick={() => adjustFontSize(-2)} title="Decrease Size" type="button">-</button>
          <span className="bt-tb-val">
            {activeLayer === "sku" ? `${labelDesign.skuFontSize}px` : activeLayer === "barcode" ? `${labelDesign.barcodeHeight}px` : `${labelDesign.titleFontSize}px`}
          </span>
          <button className="bt-tb-btn" onClick={() => adjustFontSize(2)} title="Increase Size" type="button">+</button>
        </div>

        <div className="bt-tb-divider" />

        {/* Style (Bold B Toggle) */}
        <div className="bt-tb-group">
          <button
            className={`bt-tb-btn bt-bold-btn ${["700", "800", "900"].includes(labelDesign.fontWeight) ? "is-active" : ""}`}
            onClick={toggleBold}
            title="Toggle Bold (B)"
            type="button"
          >
            <strong>B</strong>
          </button>
        </div>

        <div className="bt-tb-divider" />

        {/* Letter Spacing (+ / -) Tracking */}
        <div className="bt-tb-group">
          <span className="bt-tb-label">Spacing:</span>
          <button className="bt-tb-btn" onClick={() => adjustLetterSpacing(-0.5)} title="Decrease Letter Spacing" type="button">-</button>
          <span className="bt-tb-val">
            {activeLayer === "sku"
              ? `${labelDesign.skuLetterSpacing || 0}px`
              : activeLayer === "brand"
              ? `${labelDesign.brandLetterSpacing || 0}px`
              : activeLayer === "price"
              ? `${labelDesign.priceLetterSpacing || 0}px`
              : `${labelDesign.titleLetterSpacing || 0}px`}
          </span>
          <button className="bt-tb-btn" onClick={() => adjustLetterSpacing(0.5)} title="Increase Letter Spacing" type="button">+</button>
        </div>

        <div className="bt-tb-divider" />

        {/* Text Alignment */}
        <div className="bt-tb-group">
          <button
            className={`bt-tb-btn ${labelDesign.textAlign === "left" ? "is-active" : ""}`}
            onClick={() => setLabelDesign((prev) => ({ ...prev, textAlign: "left" }))}
            title="Align Left"
            type="button"
          >Left</button>
          <button
            className={`bt-tb-btn ${labelDesign.textAlign === "center" ? "is-active" : ""}`}
            onClick={() => setLabelDesign((prev) => ({ ...prev, textAlign: "center" }))}
            title="Align Center"
            type="button"
          >Center</button>
          <button
            className={`bt-tb-btn ${labelDesign.textAlign === "right" ? "is-active" : ""}`}
            onClick={() => setLabelDesign((prev) => ({ ...prev, textAlign: "right" }))}
            title="Align Right"
            type="button"
          >Right</button>
        </div>

        <div className="bt-tb-divider" />

        {/* Toggles */}
        <div className="bt-tb-group">
          <button
            className={`bt-tb-btn ${labelDesign.showTitle ? "is-active" : ""}`}
            onClick={() => setLabelDesign((prev) => ({ ...prev, showTitle: !prev.showTitle }))}
            type="button"
          >+ Category Name</button>
          <button
            className={`bt-tb-btn ${labelDesign.showBarcode ? "is-active" : ""}`}
            onClick={() => setLabelDesign((prev) => ({ ...prev, showBarcode: !prev.showBarcode }))}
            type="button"
          >+ Barcode</button>
          <button
            className={`bt-tb-btn ${labelDesign.showSku ? "is-active" : ""}`}
            onClick={() => setLabelDesign((prev) => ({ ...prev, showSku: !prev.showSku }))}
            type="button"
          >+ SKU Code</button>
        </div>
      </div>

      {/* Studio Workspace */}
      <div className="lp2-main-grid">
        {/* Left Column: Interactive Label Stage */}
        <div className="lp2-canvas-container">
          <div className="bt-canvas-card">
            <div className="bt-canvas-stage" onClick={handleDeselectAll}>
              <div
                className="bt-sticker-label"
                onClick={handleDeselectAll}
                ref={canvasRef}
                style={{
                  width: `${selectedSize.width * 8}px`,
                  height: `${selectedSize.height * 8}px`,
                  fontFamily: activeFontFamilyObj.family,
                  textAlign: labelDesign.textAlign,
                }}
              >
                {/* 1. TOP TITLE / CATEGORY LAYER */}
                {labelDesign.showTitle && (
                  <div
                    className={`bt-layer-box ${activeLayer === "title" ? "is-selected" : ""}`}
                    onClick={(e) => { e.stopPropagation(); setActiveLayer("title"); }}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingLayer("title"); }}
                    onMouseDown={(e) => handleMouseDownLayer("title", e)}
                    style={{
                      transform: `translate(${labelDesign.positions.title.x}px, ${labelDesign.positions.title.y}px)`,
                    }}
                  >
                    {editingLayer === "title" ? (
                      <input
                        autoFocus
                        className="bt-inline-editor"
                        onBlur={() => setEditingLayer(null)}
                        onChange={(e) => setLabelDesign((prev) => ({ ...prev, title: e.target.value.toUpperCase() }))}
                        onKeyDown={(e) => { if (e.key === "Enter") setEditingLayer(null); }}
                        style={{
                          fontSize: `${labelDesign.titleFontSize}px`,
                          fontWeight: labelDesign.fontWeight,
                          fontFamily: activeFontFamilyObj.family,
                          textAlign: labelDesign.textAlign,
                          letterSpacing: `${labelDesign.titleLetterSpacing || 0}px`,
                        }}
                        value={labelDesign.title}
                      />
                    ) : (
                      <div
                        className="bt-layer-content bt-layer-title"
                        style={{
                          fontSize: `${labelDesign.titleFontSize}px`,
                          fontWeight: labelDesign.fontWeight,
                          letterSpacing: `${labelDesign.titleLetterSpacing || 0}px`,
                        }}
                      >
                        {labelDesign.title}
                      </div>
                    )}

                    {/* Resizable Handles */}
                    {activeLayer === "title" && (
                      <div className="bt-selection-handles">
                        {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((dir) => (
                          <span
                            className={`bt-handle handle-${dir}`}
                            key={dir}
                            onMouseDown={(e) => handleResizeMouseDown(dir, "title", e)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. CENTER BARCODE LAYER */}
                {labelDesign.showBarcode && (
                  <div
                    className={`bt-layer-box ${activeLayer === "barcode" ? "is-selected" : ""}`}
                    onClick={(e) => { e.stopPropagation(); setActiveLayer("barcode"); }}
                    onMouseDown={(e) => handleMouseDownLayer("barcode", e)}
                    style={{
                      transform: `translate(${labelDesign.positions.barcode.x}px, ${labelDesign.positions.barcode.y}px)`,
                    }}
                  >
                    <div className="bt-layer-content bt-layer-barcode">
                      <BarcodeCanvas
                        format={labelDesign.barcodeFormat}
                        height={labelDesign.barcodeHeight}
                        scale={labelDesign.barcodeScale}
                        showText={false}
                        value={labelDesign.barcode}
                      />
                    </div>

                    {activeLayer === "barcode" && (
                      <div className="bt-selection-handles">
                        {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((dir) => (
                          <span
                            className={`bt-handle handle-${dir}`}
                            key={dir}
                            onMouseDown={(e) => handleResizeMouseDown(dir, "barcode", e)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. BOTTOM SKU CODE LAYER */}
                {labelDesign.showSku && (
                  <div
                    className={`bt-layer-box ${activeLayer === "sku" ? "is-selected" : ""}`}
                    onClick={(e) => { e.stopPropagation(); setActiveLayer("sku"); }}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingLayer("sku"); }}
                    onMouseDown={(e) => handleMouseDownLayer("sku", e)}
                    style={{
                      transform: `translate(${labelDesign.positions.sku.x}px, ${labelDesign.positions.sku.y}px)`,
                    }}
                  >
                    {editingLayer === "sku" ? (
                      <input
                        autoFocus
                        className="bt-inline-editor"
                        onBlur={() => setEditingLayer(null)}
                        onChange={(e) => setLabelDesign((prev) => ({ ...prev, sku: e.target.value.toUpperCase(), barcode: e.target.value.toUpperCase() }))}
                        onKeyDown={(e) => { if (e.key === "Enter") setEditingLayer(null); }}
                        style={{
                          fontSize: `${labelDesign.skuFontSize}px`,
                          fontWeight: "900",
                          fontFamily: activeFontFamilyObj.family,
                          textAlign: labelDesign.textAlign,
                          letterSpacing: `${labelDesign.skuLetterSpacing || 0}px`,
                        }}
                        value={labelDesign.sku}
                      />
                    ) : (
                      <div
                        className="bt-layer-content bt-layer-sku"
                        style={{
                          fontSize: `${labelDesign.skuFontSize}px`,
                          fontWeight: "900",
                          letterSpacing: `${labelDesign.skuLetterSpacing || 0}px`,
                        }}
                      >
                        {labelDesign.sku}
                      </div>
                    )}

                    {activeLayer === "sku" && (
                      <div className="bt-selection-handles">
                        {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((dir) => (
                          <span
                            className={`bt-handle handle-${dir}`}
                            key={dir}
                            onMouseDown={(e) => handleResizeMouseDown(dir, "sku", e)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="bt-canvas-hint">
              <span>💡 Double-click any text to edit directly on the label. Drag green handles to resize font & barcode scale.</span>
            </div>
          </div>

          {/* Saved Templates Panel */}
          <div className="lp2-card lp2-template-card">
            <h3>Saved BarTender Templates</h3>
            <div className="lp2-template-save-bar">
              <input
                type="text"
                placeholder="Template name (e.g. Knife Barcode 50x25)..."
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <button className="lp2-btn-secondary" onClick={handleSaveTemplate} type="button">
                Save Template
              </button>
            </div>

            <div className="lp2-template-list">
              {savedTemplates.length === 0 ? (
                <span className="lp2-empty-text">No custom templates saved yet.</span>
              ) : (
                savedTemplates.map((tpl) => (
                  <div className="lp2-template-item" key={tpl.id}>
                    <div className="lp2-tpl-info" onClick={() => handleLoadTemplate(tpl)}>
                      <strong>{tpl.name}</strong>
                      <small>{tpl.size?.name || "Custom"}</small>
                    </div>
                    <button className="lp2-btn-del" onClick={() => handleDeleteTemplate(tpl.id)} type="button">×</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Layer Inspector & Sizes */}
        <div className="lp2-inspector-sidebar">
          {/* Size Preset Selector */}
          <div className="lp2-card">
            <h3>1. Label Dimension</h3>
            <div className="lp2-size-grid">
              {allSizes.map((size) => (
                <button
                  className={`lp2-size-btn ${selectedSize.id === size.id ? "is-selected" : ""}`}
                  key={size.id}
                  onClick={() => setSelectedSize(size)}
                  type="button"
                >
                  <strong>{size.name}</strong>
                  <span>{size.width} x {size.height} mm</span>
                </button>
              ))}
              <button className="lp2-size-btn lp2-btn-add-custom" onClick={() => setShowCustomSizeModal(true)} type="button">
                + Add Custom Size
              </button>
            </div>
          </div>

          {/* Inventory Product Auto-Fill */}
          <div className="lp2-card">
            <h3>2. Product Inventory Auto-Fill</h3>
            <div className="lp2-field-group">
              <select value={selectedProductId} onChange={(e) => handleSelectProduct(e.target.value)}>
                <option value="">-- Choose Product from Inventory --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.title} ({p.sku || "No SKU"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Layer Inspector */}
          <div className="lp2-card">
            <h3>3. Selected Layer Inspector ({activeLayer ? activeLayer.toUpperCase() : "NONE"})</h3>
            <div className="lp2-field-grid">
              <div className="lp2-field-group">
                <label>Top Category / Title</label>
                <input
                  type="text"
                  value={labelDesign.title}
                  onChange={(e) => setLabelDesign((prev) => ({ ...prev, title: e.target.value.toUpperCase() }))}
                />
              </div>

              <div className="lp2-field-group">
                <label>SKU Item Code</label>
                <input
                  type="text"
                  value={labelDesign.sku}
                  onChange={(e) => setLabelDesign((prev) => ({ ...prev, sku: e.target.value.toUpperCase(), barcode: e.target.value.toUpperCase() }))}
                />
              </div>

              <div className="lp2-field-group">
                <label>Title Size ({labelDesign.titleFontSize}px)</label>
                <input
                  type="range"
                  min="10"
                  max="64"
                  value={labelDesign.titleFontSize}
                  onChange={(e) => setLabelDesign((prev) => ({ ...prev, titleFontSize: parseInt(e.target.value) }))}
                />
              </div>

              <div className="lp2-field-group">
                <label>SKU Size ({labelDesign.skuFontSize}px)</label>
                <input
                  type="range"
                  min="12"
                  max="72"
                  value={labelDesign.skuFontSize}
                  onChange={(e) => setLabelDesign((prev) => ({ ...prev, skuFontSize: parseInt(e.target.value) }))}
                />
              </div>

              <div className="lp2-field-group">
                <label>Barcode Height ({labelDesign.barcodeHeight}px)</label>
                <input
                  type="range"
                  min="20"
                  max="140"
                  value={labelDesign.barcodeHeight}
                  onChange={(e) => setLabelDesign((prev) => ({ ...prev, barcodeHeight: parseInt(e.target.value) }))}
                />
              </div>

              <div className="lp2-field-group">
                <label>Barcode Format</label>
                <select
                  value={labelDesign.barcodeFormat}
                  onChange={(e) => setLabelDesign((prev) => ({ ...prev, barcodeFormat: e.target.value }))}
                >
                  {BARCODE_FORMATS.map((fmt) => (
                    <option key={fmt.id} value={fmt.id}>{fmt.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden Thermal Print Area (100% WYSIWYG Clone of Canvas) */}
      <div className="lp2-print-area">
        {Array.from({ length: printQuantity }).map((_, index) => (
          <div
            className="lp2-print-label-item"
            key={index}
            style={{
              width: `${selectedSize.width}mm`,
              height: `${selectedSize.height}mm`,
              overflow: "hidden",
              position: "relative",
              pageBreakAfter: "always",
              breakAfter: "page",
              background: "#ffffff",
            }}
          >
            <div
              style={{
                width: `${selectedSize.width * 8}px`,
                height: `${selectedSize.height * 8}px`,
                transform: `scale(${selectedSize.width / (selectedSize.width * 8)})`,
                transformOrigin: "top left",
                fontFamily: activeFontFamilyObj.family,
                textAlign: labelDesign.textAlign,
                background: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                boxSizing: "border-box",
              }}
            >
              {/* 1. TOP TITLE / CATEGORY LAYER */}
              {labelDesign.showTitle && (
                <div
                  className="bt-layer-title"
                  style={{
                    fontSize: `${labelDesign.titleFontSize}px`,
                    fontWeight: labelDesign.fontWeight,
                    letterSpacing: `${labelDesign.titleLetterSpacing || 0}px`,
                    transform: `translate(${labelDesign.positions.title.x}px, ${labelDesign.positions.title.y}px)`,
                  }}
                >
                  {labelDesign.title}
                </div>
              )}

              {/* 2. CENTER BARCODE LAYER */}
              {labelDesign.showBarcode && (
                <div
                  className="bt-layer-barcode"
                  style={{
                    transform: `translate(${labelDesign.positions.barcode.x}px, ${labelDesign.positions.barcode.y}px)`,
                  }}
                >
                  <BarcodeCanvas
                    format={labelDesign.barcodeFormat}
                    height={labelDesign.barcodeHeight}
                    scale={labelDesign.barcodeScale}
                    showText={false}
                    value={labelDesign.barcode}
                  />
                </div>
              )}

              {/* 3. BOTTOM SKU CODE LAYER */}
              {labelDesign.showSku && (
                <div
                  className="bt-layer-sku"
                  style={{
                    fontSize: `${labelDesign.skuFontSize}px`,
                    fontWeight: "900",
                    letterSpacing: `${labelDesign.skuLetterSpacing || 0}px`,
                    transform: `translate(${labelDesign.positions.sku.x}px, ${labelDesign.positions.sku.y}px)`,
                  }}
                >
                  {labelDesign.sku}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Custom Size Modal */}
      {showCustomSizeModal && (
        <div className="lp2-modal-backdrop" onClick={() => setShowCustomSizeModal(false)}>
          <div className="lp2-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="lp2-modal-header">
              <h2>Add Custom Label Dimension</h2>
              <button className="lp2-close-btn" onClick={() => setShowCustomSizeModal(false)} type="button">×</button>
            </div>
            <form onSubmit={handleAddCustomSize}>
              <div className="lp2-modal-body">
                <div className="lp2-field-group">
                  <label>Label Preset Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 2.06 x 1 in Knife Sticker"
                    value={newSizeName}
                    onChange={(e) => setNewSizeName(e.target.value)}
                  />
                </div>
                <div className="lp2-field-grid">
                  <div className="lp2-field-group">
                    <label>Width (mm)</label>
                    <input
                      type="number"
                      required
                      min="10"
                      max="300"
                      value={newWidth}
                      onChange={(e) => setNewWidth(e.target.value)}
                    />
                  </div>
                  <div className="lp2-field-group">
                    <label>Height (mm)</label>
                    <input
                      type="number"
                      required
                      min="10"
                      max="300"
                      value={newHeight}
                      onChange={(e) => setNewHeight(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="lp2-modal-footer">
                <button className="lp2-btn-secondary" onClick={() => setShowCustomSizeModal(false)} type="button">
                  Cancel
                </button>
                <button className="lp2-btn-primary" type="submit">
                  Save Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
