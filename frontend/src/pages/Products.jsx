import { useEffect, useMemo, useRef, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import AmazonFbaInventory from "./AmazonFbaInventory";
import "./Products.css";

const createEmptyForm = () => ({
  article_no: "",
  name: "",
  category: "",
  image_url: "",
  image_file: null,
  share_image_url: "",
  share_image_file: null,
  label_url: "",
  label_file: null,
  options: "",
  notes: "",
  factory_stock: 0,
  usa_stock: 0,
  reserved_stock: 0,
  cost_price: 0,
  selling_price: 0,
  unit_weight_kg: 0,
  low_stock_alert: 10,
  workflow_required: true,
});

const createEmptySupplyForm = (supplierId = "") => ({
  supplier_id: supplierId ? String(supplierId) : "",
  sku: "",
  item_name: "",
  category: "Factory Supplies",
  usage_area: "Factory",
  quantity: 1,
  unit_price: 0,
  note: "",
});

const formatNumber = (value) =>
  Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });

const formatCurrency = (value) =>
  `Rs. ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  })}`;

const formatUsdCurrency = (value) =>
  Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const getNoteLines = (notes) =>
  String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+)/, "").trim())
    .filter(Boolean);

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadCsv = (filename, headers, rows) => {
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const flattenSupplierSupplyItems = (suppliers) =>
  suppliers
    .flatMap((supplier) =>
      (supplier.supply_items || []).map((item) => ({
        ...item,
        supplier_name: supplier.name || `Supplier #${supplier.id}`,
      }))
    )
    .sort((first, second) => {
      const firstDate = new Date(first.updated_at || first.created_at || 0).getTime();
      const secondDate = new Date(second.updated_at || second.created_at || 0).getTime();
      return secondDate - firstDate;
    });

const formatShortDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

function Icon({ name, size = 18 }) {
  const paths = {
    package: (
      <>
        <path d="m3 7 9 5 9-5M12 12v9" />
        <path d="m5 5 7-3 7 3 2 2v10l-9 5-9-5V7l2-2Z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    boxes: (
      <>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </>
    ),
    stock: (
      <>
        <path d="M4 7h16v13H4zM7 4h10l3 3H4l3-3Z" />
        <path d="M9 12h6" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
    workflow: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 6h8M7.5 7.5l3.5 8M16.5 7.5l-3.5 8" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m4 17 5-5 4 4 2-2 5 5" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="18" cy="19" r="2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    upload: (
      <>
        <path d="M12 21V9M7 14l5-5 5 5" />
        <path d="M5 3h14" />
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
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m7 10 5 5 5-5" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="products-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function Products({ authenticatedUser, initialCatalogTab = "products", userRole }) {
  const effectiveRole = userRole || authenticatedUser?.role;
  const userAllowedPages = Array.isArray(authenticatedUser?.allowed_pages)
    ? authenticatedUser.allowed_pages
    : [];
  const hasAmazonCatalogAccess =
    ["admin", "super_admin"].includes(effectiveRole) &&
    (effectiveRole === "super_admin" ||
      userAllowedPages.some((page) => String(page || "").startsWith("Amazon")));
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [catalogTab, setCatalogTab] = useState(() =>
    initialCatalogTab === "amazon" && hasAmazonCatalogAccess
      ? "amazon"
      : "products"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailSupplyItem, setDetailSupplyItem] = useState(null);
  const [detailNoteText, setDetailNoteText] = useState("");
  const [showSupplyForm, setShowSupplyForm] = useState(false);
  const [editingSupplyItem, setEditingSupplyItem] = useState(null);
  const [supplyForm, setSupplyForm] = useState(createEmptySupplyForm);
  const [productImagePreview, setProductImagePreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDetailNote, setSavingDetailNote] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogDownloading, setCatalogDownloading] = useState(false);
  const [showCatalogSelector, setShowCatalogSelector] = useState(false);
  const [catalogIncludedIds, setCatalogIncludedIds] = useState(() => new Set());
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [notice, setNotice] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState(() => new Set());
  const faireFileInputRef = useRef(null);
  const isAdmin = ["admin", "super_admin"].includes(effectiveRole);
  const isWorkerView = effectiveRole === "worker";
  const confirmDialog = useConfirmDialog();

  useEffect(() => {
    let active = true;

    Promise.allSettled([api.get("/products"), api.get("/suppliers")])
      .then(([productsResult, suppliersResult]) => {
        if (!active) return;

        if (productsResult.status === "fulfilled") {
          setProducts(
            Array.isArray(productsResult.value.data)
              ? productsResult.value.data
              : []
          );
        } else {
          console.error("Products error:", productsResult.reason);
          setNotice({
            type: "error",
            text: "Products could not be loaded. Check the backend connection.",
          });
        }

        if (suppliersResult.status === "fulfilled") {
          setSuppliers(
            Array.isArray(suppliersResult.value.data)
              ? suppliersResult.value.data
              : []
          );
        } else {
          console.error("Factory supplies error:", suppliersResult.reason);
          setSuppliers([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !showForm &&
      !showSupplyForm &&
      !detailProduct &&
      !detailSupplyItem &&
      !productImagePreview &&
      !showCatalogSelector
    ) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (
        event.key === "Escape" &&
        !saving &&
        !savingDetailNote
      ) {
        if (productImagePreview) {
          setProductImagePreview(null);
          return;
        }
        if (showCatalogSelector) setShowCatalogSelector(false);
        if (showForm) {
          setShowForm(false);
          setEditingId(null);
          setForm(createEmptyForm());
        }
        if (showSupplyForm) {
          setShowSupplyForm(false);
          setEditingSupplyItem(null);
          setSupplyForm(createEmptySupplyForm());
        }
        setDetailProduct(null);
        setDetailSupplyItem(null);
        setDetailNoteText("");
        setProductImagePreview(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    detailProduct,
    detailSupplyItem,
    productImagePreview,
    saving,
    savingDetailNote,
    showForm,
    showCatalogSelector,
    showSupplyForm,
  ]);

  const imagePreviewUrl = useMemo(() => {
    if (form.image_file) return URL.createObjectURL(form.image_file);
    return getStaticUrl(form.image_url);
  }, [form.image_file, form.image_url]);

  const shareImagePreviewUrl = useMemo(() => {
    if (form.share_image_file) return URL.createObjectURL(form.share_image_file);
    return getStaticUrl(form.share_image_url);
  }, [form.share_image_file, form.share_image_url]);

  useEffect(
    () => () => {
      if (form.image_file && imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    },
    [form.image_file, imagePreviewUrl]
  );

  useEffect(
    () => () => {
      if (form.share_image_file && shareImagePreviewUrl) {
        URL.revokeObjectURL(shareImagePreviewUrl);
      }
    },
    [form.share_image_file, shareImagePreviewUrl]
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(products.map((product) => product.category).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const factorySupplies = useMemo(
    () => flattenSupplierSupplyItems(suppliers),
    [suppliers]
  );

  const supplyCategories = useMemo(
    () =>
      Array.from(
        new Set(factorySupplies.map((item) => item.category).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [factorySupplies]
  );

  const visibleCategories =
    catalogTab === "supplies" ? supplyCategories : categories;

  const summary = useMemo(() => {
    const lowStock = products.filter(
      (product) =>
        Number(product.available_stock || 0) <=
        Number(product.low_stock_alert || 0)
    ).length;

    return {
      total: products.length,
      available: products.reduce(
        (sum, product) => sum + Number(product.available_stock || 0),
        0
      ),
      lowStock,
      workflow: products.filter((product) => product.workflow_required).length,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return products.filter((product) => {
      const available = Number(product.available_stock || 0);
      const threshold = Number(product.low_stock_alert || 0);
      const matchesSearch = [
        product.article_no,
        product.name,
        product.category,
        product.notes,
      ]
        .some((value) => String(value || "").toLowerCase().includes(query));
      const matchesCategory =
        categoryFilter === "all" || product.category === categoryFilter;
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "healthy" && available > threshold) ||
        (stockFilter === "low" && available <= threshold && available > 0) ||
        (stockFilter === "out" && available <= 0);

      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [categoryFilter, products, searchQuery, stockFilter]);

  const filteredSupplies = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return factorySupplies.filter((item) => {
      const matchesSearch = [
        item.sku,
        item.item_name,
        item.category,
        item.usage_area,
        item.note,
        item.supplier_name,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesCategory =
        categoryFilter === "all" || item.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [categoryFilter, factorySupplies, searchQuery]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setSelectedProductIds((current) => {
        if (current.size === 0) return current;
        const visibleIds = new Set(filteredProducts.map((product) => product.id));
        const next = new Set([...current].filter((id) => visibleIds.has(id)));
        return next.size === current.size ? current : next;
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [filteredProducts]);

  const selectedProducts = filteredProducts.filter((product) =>
    selectedProductIds.has(product.id)
  );
  const allVisibleProductsSelected =
    filteredProducts.length > 0 && selectedProductIds.size === filteredProducts.length;

  const editingProduct = useMemo(
    () => products.find((product) => product.id === editingId) || null,
    [editingId, products]
  );

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditingId(null);
    setForm(createEmptyForm());
  };

  const reloadSuppliers = async () => {
    const response = await api.get("/suppliers");
    setSuppliers(Array.isArray(response.data) ? response.data : []);
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(createEmptyForm());
    setShowForm(true);
  };

  const openDetails = (product) => {
    setDetailProduct(product);
    setDetailNoteText("");
  };

  const openSupplyDetails = (item) => {
    setDetailSupplyItem(item);
  };

  const selectCatalogTab = (nextTab) => {
    const allowedNextTab = nextTab === "amazon" && !hasAmazonCatalogAccess ? "products" : nextTab;
    setCatalogTab(allowedNextTab);
    setCategoryFilter("all");
    setStockFilter("all");
    setSelectedProductIds(new Set());
    const nextPath =
      allowedNextTab === "products"
        ? "/portal/products"
        : `/portal/products?tab=${allowedNextTab}`;
    window.history.replaceState({}, "", nextPath);
    window.dispatchEvent(new Event("erp:navigation"));
  };

  useEffect(() => {
    const syncCatalogTabFromPath = () => {
      const legacyAmazonPath =
        window.location.pathname.replace(/\/+$/, "") ===
        "/portal/amazon/fba-inventory";
      const requestedTab = legacyAmazonPath
        ? "amazon"
        : new URLSearchParams(window.location.search).get("tab");
      const nextTab =
        requestedTab === "amazon" && hasAmazonCatalogAccess
          ? "amazon"
          : requestedTab === "supplies"
            ? "supplies"
            : "products";

      setCatalogTab(nextTab);
      if (legacyAmazonPath) {
        window.history.replaceState(
          {},
          "",
          hasAmazonCatalogAccess ? "/portal/products?tab=amazon" : "/portal/products"
        );
      }
    };

    syncCatalogTabFromPath();
    window.addEventListener("erp:navigation", syncCatalogTabFromPath);
    window.addEventListener("popstate", syncCatalogTabFromPath);
    return () => {
      window.removeEventListener("erp:navigation", syncCatalogTabFromPath);
      window.removeEventListener("popstate", syncCatalogTabFromPath);
    };
  }, [hasAmazonCatalogAccess]);

  const closeSupplyForm = () => {
    if (saving) return;
    setShowSupplyForm(false);
    setEditingSupplyItem(null);
    setSupplyForm(createEmptySupplyForm());
  };

  const openCreateSupplyForm = () => {
    setEditingSupplyItem(null);
    setSupplyForm(createEmptySupplyForm(suppliers[0]?.id || ""));
    setShowSupplyForm(true);
  };

  const openEditSupplyForm = (item) => {
    setEditingSupplyItem(item);
    setSupplyForm({
      supplier_id: String(item.supplier_id || ""),
      sku: item.sku || "",
      item_name: item.item_name || "",
      category: item.category || "Factory Supplies",
      usage_area: item.usage_area || "Factory",
      quantity: item.quantity ?? 1,
      unit_price: item.unit_price ?? 0,
      note: item.note || "",
    });
    setShowSupplyForm(true);
  };

  const closeDetails = () => {
    if (savingDetailNote) return;
    setDetailProduct(null);
    setDetailNoteText("");
    setProductImagePreview(null);
  };

  const closeSupplyDetails = () => {
    setDetailSupplyItem(null);
  };

  const handleChange = (event) => {
    const { name, value, type, checked, files } = event.target;

    setForm((current) => ({
      ...current,
      [name]:
        type === "file"
          ? files?.[0] || null
          : type === "checkbox"
            ? checked
            : value,
    }));
  };

  const handleSupplyChange = (event) => {
    const { name, value } = event.target;
    setSupplyForm((current) => ({ ...current, [name]: value }));
  };

  const buildProductPayload = (product, overrides = {}) => {
    const data = { ...product, ...overrides };
    const payload = new FormData();
    payload.append("article_no", String(data.article_no || "").trim());
    payload.append("name", String(data.name || "").trim());
    payload.append("category", String(data.category || "").trim());
    payload.append("options", String(data.options || "").trim());
    payload.append("notes", String(data.notes || "").trim());
    payload.append("cost_price", Number(data.cost_price || 0));
    payload.append("selling_price", Number(data.selling_price || 0));
    payload.append("unit_weight_kg", Number(data.unit_weight_kg || 0));
    payload.append("low_stock_alert", Number(data.low_stock_alert || 0));
    payload.append("workflow_required", Boolean(data.workflow_required));
    return payload;
  };

  const handleEdit = (product) => {
    setEditingId(product.id);
    setForm({
      article_no: product.article_no || "",
      name: product.name || "",
      category: product.category || "",
      image_url: product.image_url || "",
      image_file: null,
      share_image_url: product.share_image_url || "",
      share_image_file: null,
      label_url: product.label_url || "",
      label_file: null,
      options: product.options || "",
      notes: product.notes || "",
      factory_stock: product.factory_stock ?? 0,
      usa_stock: product.usa_stock ?? 0,
      reserved_stock: product.reserved_stock ?? 0,
      cost_price: product.cost_price ?? 0,
      selling_price: product.selling_price ?? 0,
      unit_weight_kg: product.unit_weight_kg ?? 0,
      low_stock_alert: product.low_stock_alert ?? 10,
      workflow_required: Boolean(product.workflow_required),
    });
    setShowForm(true);
  };

  const toggleProductSelection = (productId) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleAllVisibleProducts = () => {
    setSelectedProductIds((current) => {
      if (filteredProducts.length > 0 && current.size === filteredProducts.length) {
        return new Set();
      }
      return new Set(filteredProducts.map((product) => product.id));
    });
  };

  const exportProductsCsv = (items = filteredProducts) => {
    downloadCsv(
      `hisbenew-products-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Article No",
        "Name",
        "Category",
        "Factory Stock",
        "USA Stock",
        "Reserved Stock",
        "Available Stock",
        "Wholesale Price (USD)",
        "MSRP (USD)",
        "Low Stock Alert",
        "Workflow Required",
      ],
      items.map((product) => [
        product.article_no,
        product.name,
        product.category,
        product.factory_stock,
        product.usa_stock,
        product.reserved_stock,
        product.available_stock,
        product.cost_price,
        product.selling_price,
        product.low_stock_alert,
        product.workflow_required ? "Yes" : "No",
      ])
    );
  };

  const exportFactorySuppliesCsv = (items = filteredSupplies) => {
    downloadCsv(
      `hisbenew-factory-supplies-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "SKU",
        "Item",
        "Category",
        "Used For",
        "Supplier",
        "Quantity",
        "Unit Price",
        "Line Total",
        "Last Updated",
        "Note",
      ],
      items.map((item) => [
        item.sku,
        item.item_name,
        item.category,
        item.usage_area,
        item.supplier_name,
        item.quantity,
        item.unit_price,
        item.line_total,
        item.updated_at || item.created_at,
        item.note,
      ])
    );
  };

  const importFaireCatalog = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || catalogImporting) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setNotice({ type: "error", text: "Choose a Faire .xlsx export file." });
      return;
    }

    const payload = new FormData();
    payload.append("file", file);
    setCatalogImporting(true);
    setNotice({
      type: "success",
      text: "Importing the Faire catalog and saving product images...",
    });
    try {
      const result = await api.post("/products/import-faire", payload, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 300000,
      });
      const refreshed = await api.get("/products");
      setProducts(Array.isArray(refreshed.data) ? refreshed.data : []);
      setSelectedProductIds(new Set());
      const summary = result.data || {};
      const imageNote = summary.image_failures
        ? ` ${summary.image_failures} image${summary.image_failures === 1 ? "" : "s"} could not be cached.`
        : "";
      setNotice({
        type: "success",
        text: `Faire import complete: ${summary.created || 0} added, ${summary.updated || 0} updated, and ${summary.skipped || 0} skipped.${imageNote}`,
      });
    } catch (error) {
      console.error("Faire catalog import error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "The Faire catalog could not be imported.",
      });
    } finally {
      setCatalogImporting(false);
    }
  };

  const openCatalogSelector = () => {
    setCatalogIncludedIds(new Set(products.map((product) => product.id)));
    setCatalogSearch("");
    setShowCatalogSelector(true);
  };

  const downloadProductCatalog = async () => {
    if (catalogDownloading) return;
    const productIds = [...catalogIncludedIds];
    if (!productIds.length) {
      setNotice({ type: "error", text: "Select at least one product for the catalog." });
      return;
    }
    setCatalogDownloading(true);
    try {
      const response = await api.post("/products/catalog-download", { product_ids: productIds }, {
        timeout: 30000,
      });
      const downloadUrl = getStaticUrl(response.data?.download_url);
      if (!downloadUrl) throw new Error("The catalog download link is missing.");
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setShowCatalogSelector(false);
      setNotice({ type: "success", text: "Wholesale PDF catalog download started." });
    } catch (error) {
      console.error("Product catalog download error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "The PDF catalog could not be downloaded.",
      });
    } finally {
      setCatalogDownloading(false);
    }
  };

  const bulkEditProducts = async () => {
    if (selectedProducts.length === 0 || saving) return;
    const category = window.prompt(
      `Apply a category to ${selectedProducts.length} selected product${
        selectedProducts.length === 1 ? "" : "s"
      }. Enter category:`
    );
    if (category === null) return;
    const nextCategory = category.trim();
    if (!nextCategory) {
      setNotice({ type: "error", text: "Bulk edit canceled: category cannot be blank." });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        selectedProducts.map((product) =>
          api.put(
            `/products/${product.id}`,
            buildProductPayload(product, { category: nextCategory }),
            { headers: { "Content-Type": "multipart/form-data" } }
          )
        )
      );
      const response = await api.get("/products");
      setProducts(Array.isArray(response.data) ? response.data : []);
      setSelectedProductIds(new Set());
      setNotice({
        type: "success",
        text: `${selectedProducts.length} product${
          selectedProducts.length === 1 ? "" : "s"
        } updated.`,
      });
    } catch (error) {
      console.error("Bulk product edit error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Selected products could not be updated.",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    setSaving(true);

    const payload = new FormData();
    payload.append("article_no", form.article_no.trim());
    payload.append("name", form.name.trim());
    payload.append("category", form.category.trim());
    payload.append("options", form.options.trim());
    payload.append("notes", form.notes.trim());
    const editingProduct =
      editingId === null
        ? null
        : products.find((product) => product.id === editingId) || null;
    ["factory_stock", "usa_stock", "reserved_stock"].forEach((stockField) => {
      const nextValue = Number(form[stockField] || 0);
      const originalValue = Number(editingProduct?.[stockField] || 0);
      if (editingId === null || nextValue !== originalValue) {
        payload.append(stockField, nextValue);
      }
    });
    payload.append("cost_price", Number(form.cost_price || 0));
    payload.append("selling_price", Number(form.selling_price || 0));
    payload.append("unit_weight_kg", Number(form.unit_weight_kg || 0));
    payload.append("low_stock_alert", Number(form.low_stock_alert || 0));
    payload.append("workflow_required", form.workflow_required);
    if (form.image_file) payload.append("image", form.image_file);
    if (form.share_image_file) {
      payload.append("share_image_file", form.share_image_file);
    }
    if (form.label_file) payload.append("label_file", form.label_file);

    try {
      if (editingId !== null) {
        await api.put(`/products/${editingId}`, payload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await api.post("/products", payload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      const response = await api.get("/products");
      setProducts(Array.isArray(response.data) ? response.data : []);
      setNotice({
        type: "success",
        text:
          editingId !== null
            ? "Product updated successfully."
            : "Product added successfully.",
      });
      setShowForm(false);
      setEditingId(null);
      setForm(createEmptyForm());
    } catch (error) {
      console.error("Save product error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Product could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveSupplyItem = async (event) => {
    event.preventDefault();

    const supplierId = Number(supplyForm.supplier_id);
    const quantity = Number(supplyForm.quantity || 0);
    const unitPrice = Number(supplyForm.unit_price || 0);
    const itemName = supplyForm.item_name.trim();

    if (!supplierId) {
      setNotice({ type: "error", text: "Choose a supplier for this factory supply." });
      return;
    }
    if (!itemName) {
      setNotice({ type: "error", text: "Factory supply name is required." });
      return;
    }
    if (quantity <= 0) {
      setNotice({ type: "error", text: "Quantity must be greater than zero." });
      return;
    }
    if (unitPrice <= 0) {
      setNotice({ type: "error", text: "Unit price must be greater than zero." });
      return;
    }

    const payload = {
      sku: supplyForm.sku.trim() || null,
      item_name: itemName,
      category: supplyForm.category.trim() || "Factory Supplies",
      usage_area: supplyForm.usage_area.trim() || "Factory",
      quantity,
      unit_price: unitPrice,
      note: supplyForm.note.trim() || null,
    };

    setSaving(true);
    try {
      if (editingSupplyItem) {
        await api.patch(
          `/suppliers/${editingSupplyItem.supplier_id}/supply-items/${editingSupplyItem.id}`,
          payload
        );
      } else {
        await api.post(`/suppliers/${supplierId}/supply-items`, {
          items: [payload],
        });
      }

      await reloadSuppliers();
      setShowSupplyForm(false);
      setEditingSupplyItem(null);
      setSupplyForm(createEmptySupplyForm());
      setDetailSupplyItem(null);
      setNotice({
        type: "success",
        text: editingSupplyItem
          ? "Factory supply updated."
          : "Factory supply added.",
      });
    } catch (error) {
      console.error("Save factory supply error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Factory supply could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  };


  const deleteProducts = async (items) => {
    if (!items.length || saving) return;
    const confirmed = await confirmDialog({
      title: `Delete ${items.length === 1 ? "product" : "products"}?`,
      message: `This will permanently delete ${items.length} product${
        items.length === 1 ? "" : "s"
      }.`,
      detail: "This action cannot be undone.",
      tone: "danger",
      confirmText: items.length === 1 ? "Delete product" : "Delete products",
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await Promise.all(items.map((product) => api.delete(`/products/${product.id}`)));
      const deletedIds = new Set(items.map((product) => product.id));
      setProducts((current) => current.filter((item) => !deletedIds.has(item.id)));
      if (deletedIds.has(editingId)) {
        setShowForm(false);
        setEditingId(null);
        setForm(createEmptyForm());
      }
      setDetailProduct((current) => (current && deletedIds.has(current.id) ? null : current));
      setSelectedProductIds(new Set());
      setNotice({
        type: "success",
        text: `${items.length} product${items.length === 1 ? "" : "s"} deleted successfully.`,
      });
    } catch (error) {
      console.error("Delete product error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Selected products could not be deleted.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (product) => deleteProducts([product]);

  const addDetailNote = async (event) => {
    event.preventDefault();
    const note = detailNoteText.trim();
    if (!note || !detailProduct) return;

    const nextNotes = [
      ...getNoteLines(detailProduct.notes),
      ...getNoteLines(note),
    ].join("\n");

    setSavingDetailNote(true);

    try {
      const payload = buildProductPayload(detailProduct, { notes: nextNotes });
      const response = await api.put(`/products/${detailProduct.id}`, payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const updatedProduct = response.data;

      setProducts((current) =>
        current.map((product) =>
          product.id === updatedProduct.id ? updatedProduct : product
        )
      );
      setDetailProduct(updatedProduct);
      setDetailNoteText("");
      setNotice({ type: "success", text: "Product note added." });
    } catch (error) {
      console.error("Add product note error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Product note could not be added.",
      });
    } finally {
      setSavingDetailNote(false);
    }
  };

  const getStockStatus = (product) => {
    const available = Number(product.available_stock || 0);
    const threshold = Number(product.low_stock_alert || 0);

    if (available <= 0) return { label: "Out of stock", tone: "danger" };
    if (available <= threshold) return { label: "Low stock", tone: "warning" };
    return { label: "In stock", tone: "success" };
  };

  const openLabel = (labelUrl) => {
    window.open(getStaticUrl(labelUrl), "_blank", "noopener,noreferrer");
  };

  const getShareImageFilename = (product, imageUrl) => {
    const baseName = [product?.article_no, product?.name]
      .filter(Boolean)
      .join("-")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "share-image";
    const path = (() => {
      try {
        return new URL(imageUrl, window.location.href).pathname;
      } catch {
        return "";
      }
    })();
    const extension = path.match(/\.(png|jpe?g|webp|gif|svg)$/i)?.[0] || ".jpg";
    return `${baseName}${extension.toLowerCase()}`;
  };

  const shareProductImage = async (imageUrl, product) => {
    const title = product?.name || product?.article_no || "Product image";
    const text = [product?.article_no, product?.name].filter(Boolean).join(" - ");

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: imageUrl });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(imageUrl);
      setNotice({ type: "success", text: "Share image link copied." });
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  };

  const downloadShareImage = async (imageUrl, product) => {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Image download failed");
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getShareImageFilename(product, imageUrl);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("Share image download error:", error);
      window.open(imageUrl, "_blank", "noopener,noreferrer");
      setNotice({
        type: "error",
        text: "Download could not start, so the image was opened instead.",
      });
    }
  };

  return (
    <div className={`products-page ${isWorkerView ? "is-worker-view" : ""}`}>
      <header className="products-page-header">
        <div className="products-header-main">
          <div>
            <h1>Products</h1>
            {isWorkerView && (
              <p className="products-worker-subtitle">
                Product reference for factory work.
              </p>
            )}
          </div>

          {!isWorkerView && catalogTab !== "amazon" && (
            <div className="products-header-actions">
              <button
                className="products-primary-button"
                onClick={openCreateForm}
                type="button"
              >
                Add product
              </button>
              <button
                aria-controls="products-header-summary"
                aria-expanded={showSummary}
                aria-label={
                  showSummary ? "Hide product summary" : "Show product summary"
                }
                className="products-summary-toggle"
                onClick={() => setShowSummary((current) => !current)}
                title={showSummary ? "Hide product summary" : "Show product summary"}
                type="button"
              >
                <span>Overview</span>
                <Icon name="chevron" size={17} />
              </button>
            </div>
          )}
        </div>

        {!isWorkerView && catalogTab !== "amazon" && showSummary && (
          <section
            aria-label="Product summary"
            className="products-summary-grid"
            id="products-header-summary"
          >
            <article>
              <div className="products-summary-icon is-total">
                <Icon name="boxes" size={19} />
              </div>
              <div>
                <span>Total products</span>
                <strong>{formatNumber(summary.total)}</strong>
                <small>Articles in catalog</small>
              </div>
            </article>
            <article>
              <div className="products-summary-icon is-stock">
                <Icon name="stock" size={19} />
              </div>
              <div>
                <span>Available units</span>
                <strong>{formatNumber(summary.available)}</strong>
                <small>Factory and USA stock</small>
              </div>
            </article>
            <article>
              <div className="products-summary-icon is-warning">
                <Icon name="warning" size={19} />
              </div>
              <div>
                <span>Needs attention</span>
                <strong>{formatNumber(summary.lowStock)}</strong>
                <small>Low or out of stock</small>
              </div>
            </article>
            <article>
              <div className="products-summary-icon is-workflow">
                <Icon name="workflow" size={19} />
              </div>
              <div>
                <span>Manufactured</span>
                <strong>{formatNumber(summary.workflow)}</strong>
                <small>Workflow enabled</small>
              </div>
            </article>
          </section>
        )}
      </header>

      {notice && (
        <div className={`products-alert is-${notice.type}`} role="status">
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
            type="button"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      <section className="products-catalog-panel">
        <div className="products-panel-heading">
          <div
            aria-label="Product inventory type"
            className="products-tab-list"
            role="tablist"
          >
            <button
              aria-selected={catalogTab === "products"}
              className={`products-tab-button ${
                catalogTab === "products" ? "is-active" : ""
              }`}
              onClick={() => selectCatalogTab("products")}
              role="tab"
              type="button"
            >
              Products
              <span>{formatNumber(products.length)}</span>
            </button>
            <button
              aria-selected={catalogTab === "supplies"}
              className={`products-tab-button ${
                catalogTab === "supplies" ? "is-active" : ""
              }`}
              onClick={() => selectCatalogTab("supplies")}
              role="tab"
              type="button"
            >
              Factory supplies
              <span>{formatNumber(factorySupplies.length)}</span>
            </button>
            {hasAmazonCatalogAccess && (
              <button
                aria-selected={catalogTab === "amazon"}
                className={`products-tab-button ${
                  catalogTab === "amazon" ? "is-active" : ""
                }`}
                onClick={() => selectCatalogTab("amazon")}
                role="tab"
                type="button"
              >
                Amazon FBA
              </button>
            )}
          </div>
          {catalogTab !== "amazon" && (
            <div className="products-toolbar">
            <label className="products-search-box">
              <Icon name="search" size={17} />
              <input
                aria-label={
                  catalogTab === "supplies"
                    ? "Search factory supplies"
                    : "Search products"
                }
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={
                  catalogTab === "supplies"
                    ? "Search supply, SKU, supplier, or category"
                    : "Search article, name, or category"
                }
                value={searchQuery}
              />
            </label>

            <select
              aria-label="Filter by category"
              onChange={(event) => setCategoryFilter(event.target.value)}
              value={categoryFilter}
            >
              <option value="all">All categories</option>
              {visibleCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            {catalogTab === "products" && (
              <select
                aria-label="Filter by stock status"
                onChange={(event) => setStockFilter(event.target.value)}
                value={stockFilter}
              >
                <option value="all">All stock</option>
                <option value="healthy">In stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </select>
            )}

            {catalogTab === "supplies" && !isWorkerView && (
              <button
                className="products-primary-button products-supply-add-button"
                disabled={!suppliers.length}
                onClick={openCreateSupplyForm}
                title={
                  suppliers.length
                    ? "Add factory supply"
                    : "Add a supplier first to record factory supplies"
                }
                type="button"
              >
                <Icon name="plus" size={15} />
                Add factory supply
              </button>
            )}

            {catalogTab === "products" && !isWorkerView && (
              <>
                <input
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={importFaireCatalog}
                  ref={faireFileInputRef}
                  type="file"
                />
                <button
                  className="products-secondary-button products-catalog-action"
                  disabled={catalogImporting}
                  onClick={() => faireFileInputRef.current?.click()}
                  type="button"
                >
                  <Icon name="upload" size={15} />
                  {catalogImporting ? "Importing..." : "Upload Faire catalog"}
                </button>
                <button
                  className="products-primary-button products-catalog-action"
                  disabled={catalogDownloading || products.length === 0}
                  onClick={openCatalogSelector}
                  type="button"
                >
                  <Icon name="download" size={15} />
                  {catalogDownloading ? "Building PDF..." : "Download catalog"}
                </button>
              </>
            )}

            {!isWorkerView && (
              <button
                className="products-secondary-button products-export-button"
                onClick={() =>
                  catalogTab === "supplies"
                    ? exportFactorySuppliesCsv(filteredSupplies)
                    : exportProductsCsv(filteredProducts)
                }
                type="button"
              >
                <Icon name="download" size={15} />
                Export
              </button>
            )}

            <span className="products-result-count">
              {catalogTab === "supplies"
                ? `${filteredSupplies.length} of ${factorySupplies.length} supply lines shown`
                : `${filteredProducts.length} of ${products.length} products shown`}
            </span>
            </div>
          )}
        </div>

        {catalogTab === "products" && !isWorkerView && selectedProducts.length > 0 && (
          <div className="products-bulk-action-bar">
            <div>
              <strong>{selectedProducts.length} selected</strong>
              <button onClick={() => setSelectedProductIds(new Set())} type="button">
                Clear selection
              </button>
            </div>
            <div className="products-bulk-actions">
              <button onClick={bulkEditProducts} type="button">
                <Icon name="edit" size={15} />
                Bulk edit
              </button>
              <button onClick={() => exportProductsCsv(selectedProducts)} type="button">
                <Icon name="download" size={15} />
                Export
              </button>
              <button
                className="is-danger"
                disabled={saving}
                onClick={() => deleteProducts(selectedProducts)}
                type="button"
              >
                <Icon name="trash" size={15} />
                Delete
              </button>
            </div>
          </div>
        )}

        {catalogTab === "amazon" && hasAmazonCatalogAccess ? (
          <AmazonFbaInventory
            authenticatedUser={authenticatedUser}
            embedded
          />
        ) : loading ? (
          <div className="products-loading-list" aria-label="Loading products">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="products-loading-row" key={index} />
            ))}
          </div>
        ) : catalogTab === "supplies" ? (
          filteredSupplies.length === 0 ? (
            <div className="products-empty-state">
              <div>
                <Icon name="stock" size={25} />
              </div>
              <h3>
                {factorySupplies.length === 0
                  ? "No factory supplies yet"
                  : "No matches found"}
              </h3>
              <p>
                {factorySupplies.length === 0
                  ? "Factory supplies added from supplier purchases will appear here."
                  : "Try changing the search text or category filter."}
              </p>
              {!isWorkerView && (
                <button
                  className="products-primary-button"
                  disabled={!suppliers.length}
                  onClick={openCreateSupplyForm}
                  type="button"
                >
                  <Icon name="plus" size={17} />
                  Add factory supply
                </button>
              )}
            </div>
          ) : (
            <div className="products-table-wrap">
              <table className="products-table products-supplies-table">
                <thead>
                  <tr>
                    <th>Supply</th>
                    <th>Category</th>
                    <th>Used for</th>
                    <th>Supplier</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Total</th>
                    <th>Updated</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredSupplies.map((item) => (
                    <tr key={`${item.supplier_id}-${item.id}`}>
                      <td className="products-supply-name-cell" data-label="Supply">
                        <strong>{item.item_name || "Unnamed supply"}</strong>
                        <small>{item.sku || "No SKU"}</small>
                      </td>
                      <td data-label="Category">{item.category || "Miscellaneous"}</td>
                      <td data-label="Used for">{item.usage_area || "General"}</td>
                      <td data-label="Supplier">{item.supplier_name || "-"}</td>
                      <td data-label="Quantity">
                        <strong className="products-available-value">
                          {formatNumber(item.quantity)}
                        </strong>
                      </td>
                      <td data-label="Unit price">
                        <span className="products-price">
                          {formatCurrency(item.unit_price)}
                        </span>
                      </td>
                      <td data-label="Total">
                        <span className="products-price">
                          {formatCurrency(item.line_total)}
                        </span>
                      </td>
                      <td data-label="Updated">
                        {formatShortDate(item.updated_at || item.created_at)}
                      </td>
                      <td className="products-actions-cell" data-label="Actions">
                        <div className="products-row-actions">
                          <button
                            aria-label={`View details for ${item.item_name}`}
                            className="products-detail-button"
                            onClick={() => openSupplyDetails(item)}
                            title="View factory supply details"
                            type="button"
                          >
                            <Icon name="eye" size={15} />
                            <span>View details</span>
                          </button>
                          {!isWorkerView && (
                            <button
                              aria-label={`Edit ${item.item_name}`}
                              className="products-icon-button"
                              onClick={() => openEditSupplyForm(item)}
                              title="Edit factory supply"
                              type="button"
                            >
                              <Icon name="edit" size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredProducts.length === 0 ? (
          <div className="products-empty-state">
            <div>
              <Icon name="package" size={25} />
            </div>
            <h3>{products.length === 0 ? "No products yet" : "No matches found"}</h3>
            <p>
              {products.length === 0
                ? isWorkerView
                  ? "No product references are available yet."
                  : "Add the first product to start building the catalog."
                : "Try changing the search text or filters."}
            </p>
            {products.length === 0 && !isWorkerView && (
              <button
                className="products-primary-button"
                onClick={openCreateForm}
                type="button"
              >
                <Icon name="plus" size={17} />
                Add product
              </button>
            )}
          </div>
        ) : isWorkerView ? (
          <div className="products-worker-grid">
            {filteredProducts.map((product) => {
              const stockStatus = getStockStatus(product);
              const imageUrl = getStaticUrl(product.image_url);

              return (
                <article className="products-worker-card" key={product.id}>
                  <div className="products-worker-main">
                    <button
                      aria-label={`Open details for ${product.article_no}`}
                      className="products-worker-image-button"
                      onClick={() => openDetails(product)}
                      title="Open product details"
                      type="button"
                    >
                      {imageUrl ? (
                        <img loading="lazy" decoding="async"
                          alt={product.article_no || "Product"}
                          className="products-worker-image"
                          src={imageUrl}
                        />
                      ) : (
                        <span className="products-worker-image products-worker-placeholder">
                          <Icon name="image" size={18} />
                        </span>
                      )}
                    </button>

                    <span className="products-worker-sku">
                      SKU {product.article_no || "-"}
                    </span>
                    <span
                      className={`products-worker-status products-status-pill is-${stockStatus.tone}`}
                    >
                      {stockStatus.label}
                    </span>
                  </div>

                  <div className="products-worker-quantities">
                    <span>
                      <small>Factory</small>
                      <strong>{formatNumber(product.factory_stock)}</strong>
                    </span>
                    <span>
                      <small>USA</small>
                      <strong>{formatNumber(product.usa_stock)}</strong>
                    </span>
                    <span>
                      <small>Reserved</small>
                      <strong>{formatNumber(product.reserved_stock)}</strong>
                    </span>
                    <span>
                      <small>Available</small>
                      <strong>{formatNumber(product.available_stock)}</strong>
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="products-table-wrap">
            <table className="products-table">
              <thead>
                <tr>
                  <th className="products-select-column">
                    <input
                      aria-label="Select all visible products"
                      checked={allVisibleProductsSelected}
                      onChange={toggleAllVisibleProducts}
                      type="checkbox"
                    />
                  </th>
                  <th>Product</th>
                  <th>
                    <div className="products-stock-heading">
                      <div>
                        <small>Factory</small>
                        <small>USA</small>
                        <small>Reserved</small>
                      </div>
                    </div>
                  </th>
                  <th>Available</th>
                  <th>USD pricing</th>
                  <th>Label</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const stockStatus = getStockStatus(product);

                  return (
                    <tr key={product.id}>
                      <td className="products-select-cell" data-label="Select">
                        <input
                          aria-label={`Select ${product.article_no}`}
                          checked={selectedProductIds.has(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          type="checkbox"
                        />
                      </td>
                      <td className="products-product-cell">
                        <div className="products-product-content">
                          <button
                            aria-label={`Open details for ${product.article_no}`}
                            className="products-thumbnail-button"
                            onClick={() => openDetails(product)}
                            title="Open product details"
                            type="button"
                          >
                            {product.image_url ? (
                              <img loading="lazy" decoding="async"
                                alt={product.name}
                                className="products-thumbnail"
                                src={getStaticUrl(product.image_url)}
                              />
                            ) : (
                              <span className="products-thumbnail-placeholder">
                                <Icon name="image" size={20} />
                              </span>
                            )}
                          </button>
                          <div className="products-product-identity">
                            <strong>{product.article_no}</strong>
                            <span>{product.name || "Unnamed product"}</span>
                            <small>{product.category || "Uncategorized"}</small>
                          </div>
                        </div>
                      </td>
                      <td data-label="Stock">
                        <div className="products-stock-breakdown">
                          <span title="Factory stock">
                            <strong>{formatNumber(product.factory_stock)}</strong>
                          </span>
                          <span title="USA stock">
                            <strong>{formatNumber(product.usa_stock)}</strong>
                          </span>
                          <span title="Reserved stock">
                            <strong>{formatNumber(product.reserved_stock)}</strong>
                          </span>
                        </div>
                      </td>
                      <td data-label="Available">
                        <strong className="products-available-value">
                          {formatNumber(product.available_stock)}
                        </strong>
                      </td>
                      <td data-label="Price">
                        <div className="products-price-pair">
                          <span>
                            <small>Wholesale</small>
                            <strong>{formatUsdCurrency(product.cost_price)}</strong>
                          </span>
                          <span>
                            <small>MSRP</small>
                            <strong>{formatUsdCurrency(product.selling_price)}</strong>
                          </span>
                        </div>
                      </td>
                      <td className="products-label-cell" data-label="Label">
                        {product.label_url ? (
                          <button
                            className="products-label-button"
                            onClick={() => openLabel(product.label_url)}
                            type="button"
                          >
                            <Icon name="file" size={14} />
                            Open
                          </button>
                        ) : (
                          <span className="products-muted-value">Not added</span>
                        )}
                      </td>
                      <td data-label="Status">
                        <span
                          className={`products-status-pill is-${stockStatus.tone}`}
                        >
                          {stockStatus.label}
                        </span>
                      </td>
                      <td className="products-actions-cell">
                        <div className="products-row-actions">
                          <button
                            aria-label={`View details for ${product.article_no}`}
                            className="products-detail-button"
                            onClick={() => openDetails(product)}
                            title="View product details"
                            type="button"
                          >
                            <Icon name="eye" size={15} />
                            <span>View details</span>
                          </button>
                          <button
                            aria-label={`Edit ${product.article_no}`}
                            className="products-icon-button"
                            onClick={() => handleEdit(product)}
                            title="Edit product"
                            type="button"
                          >
                            <Icon name="edit" size={16} />
                          </button>
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

      {showCatalogSelector && (
        <div
          className="products-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !catalogDownloading) {
              setShowCatalogSelector(false);
            }
          }}
        >
          <div
            aria-labelledby="catalog-selector-title"
            aria-modal="true"
            className="products-modal products-catalog-selector"
            role="dialog"
          >
            <div className="products-modal-header">
              <div>
                <span className="products-section-label">PDF catalog</span>
                <h2 id="catalog-selector-title">Choose products to include</h2>
                <p>Uncheck any product you do not want in this download.</p>
              </div>
              <button
                className="products-modal-close"
                disabled={catalogDownloading}
                onClick={() => setShowCatalogSelector(false)}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="products-catalog-selector-tools">
              <input
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Search name, SKU, or category"
                type="search"
                value={catalogSearch}
              />
              <span>{catalogIncludedIds.size} of {products.length} included</span>
              <button
                onClick={() => setCatalogIncludedIds(new Set(products.map((product) => product.id)))}
                type="button"
              >
                Include all
              </button>
              <button onClick={() => setCatalogIncludedIds(new Set())} type="button">
                Clear all
              </button>
            </div>

            <div className="products-catalog-selector-list">
              {products
                .filter((product) => {
                  const query = catalogSearch.trim().toLowerCase();
                  return !query || [product.name, product.article_no, product.category]
                    .some((value) => String(value || "").toLowerCase().includes(query));
                })
                .map((product) => (
                  <label className="products-catalog-selector-item" key={product.id}>
                    <input
                      checked={catalogIncludedIds.has(product.id)}
                      onChange={() => setCatalogIncludedIds((current) => {
                        const next = new Set(current);
                        if (next.has(product.id)) next.delete(product.id);
                        else next.add(product.id);
                        return next;
                      })}
                      type="checkbox"
                    />
                    <img loading="lazy" decoding="async" alt="" src={getStaticUrl(product.image_url)} />
                    <span>
                      <strong>{product.name}</strong>
                      <small>SKU {product.article_no} | {product.category || "Uncategorized"}</small>
                    </span>
                  </label>
                ))}
            </div>

            <div className="products-catalog-selector-footer">
              <button
                className="products-secondary-button"
                disabled={catalogDownloading}
                onClick={() => setShowCatalogSelector(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="products-primary-button"
                disabled={catalogDownloading || catalogIncludedIds.size === 0}
                onClick={downloadProductCatalog}
                type="button"
              >
                <Icon name="download" size={15} />
                {catalogDownloading ? "Building PDF..." : `Download ${catalogIncludedIds.size} products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSupplyForm && (
        <div
          className="products-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSupplyForm();
          }}
        >
          <div
            aria-labelledby="products-supply-modal-title"
            aria-modal="true"
            className="products-modal products-supply-modal"
            role="dialog"
          >
            <div className="products-modal-header">
              <div>
                <span className="products-section-label">
                  {editingSupplyItem ? "Update factory supply" : "New factory supply"}
                </span>
                <h2 id="products-supply-modal-title">
                  {editingSupplyItem ? "Edit factory supply" : "Add factory supply"}
                </h2>
                <p>Track tools, packing materials, consumables, and factory accessories.</p>
              </div>
              <button
                aria-label="Close factory supply form"
                className="products-modal-close"
                disabled={saving}
                onClick={closeSupplyForm}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form className="products-form" onSubmit={saveSupplyItem}>
              <div className="products-form-content">
                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>1</span>
                    <div>
                      <h3>Supply details</h3>
                      <p>Choose the supplier and describe the factory supply.</p>
                    </div>
                  </div>
                  <div className="products-field-grid">
                    <label className="products-field">
                      <span>Supplier</span>
                      <select
                        disabled={Boolean(editingSupplyItem) || saving}
                        name="supplier_id"
                        onChange={handleSupplyChange}
                        required
                        value={supplyForm.supplier_id}
                      >
                        <option value="">Select supplier</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="products-field">
                      <span>SKU</span>
                      <input
                        name="sku"
                        onChange={handleSupplyChange}
                        placeholder="Optional supply SKU"
                        value={supplyForm.sku}
                      />
                    </label>
                    <label className="products-field is-wide">
                      <span>Item name</span>
                      <input
                        name="item_name"
                        onChange={handleSupplyChange}
                        placeholder="Packing box, grinding belt, handle pins..."
                        required
                        value={supplyForm.item_name}
                      />
                    </label>
                    <label className="products-field">
                      <span>Category</span>
                      <input
                        list="products-supply-category-options"
                        name="category"
                        onChange={handleSupplyChange}
                        value={supplyForm.category}
                      />
                    </label>
                    <label className="products-field">
                      <span>Used for</span>
                      <input
                        name="usage_area"
                        onChange={handleSupplyChange}
                        placeholder="Factory, Packing, Office"
                        value={supplyForm.usage_area}
                      />
                    </label>
                  </div>
                </section>

                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>2</span>
                    <div>
                      <h3>Quantity and cost</h3>
                      <p>Keep supplier purchase value visible in the factory supplies tab.</p>
                    </div>
                  </div>
                  <div className="products-field-grid">
                    <label className="products-field">
                      <span>Quantity</span>
                      <input
                        min="1"
                        name="quantity"
                        onChange={handleSupplyChange}
                        required
                        type="number"
                        value={supplyForm.quantity}
                      />
                    </label>
                    <label className="products-field">
                      <span>Unit price</span>
                      <div className="products-input-prefix">
                        <span>Rs.</span>
                        <input
                          min="0.01"
                          name="unit_price"
                          onChange={handleSupplyChange}
                          required
                          step="0.01"
                          type="number"
                          value={supplyForm.unit_price}
                        />
                      </div>
                    </label>
                    <div className="products-field products-calculated-field">
                      <span>Line total</span>
                      <strong>
                        {formatCurrency(
                          Number(supplyForm.quantity || 0) *
                            Number(supplyForm.unit_price || 0)
                        )}
                      </strong>
                    </div>
                    <label className="products-field is-full">
                      <span>Note</span>
                      <textarea
                        name="note"
                        onChange={handleSupplyChange}
                        placeholder="Add size, quality, usage, or purchase note"
                        value={supplyForm.note}
                      />
                    </label>
                  </div>
                </section>
              </div>

              <div className="products-form-footer">
                <button
                  className="products-secondary-button"
                  disabled={saving}
                  onClick={closeSupplyForm}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="products-primary-button"
                  disabled={saving}
                  type="submit"
                >
                  <Icon name="check" size={17} />
                  {saving
                    ? "Saving"
                    : editingSupplyItem
                      ? "Update supply"
                      : "Save supply"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailSupplyItem && (
        <div
          className="products-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSupplyDetails();
          }}
        >
          <div
            aria-labelledby="products-supply-details-title"
            aria-modal="true"
            className="products-modal products-details-modal products-supply-details-modal"
            role="dialog"
          >
            <div className="products-modal-header">
              <div className="products-details-header-main">
                <div>
                  <span className="products-section-label">Factory supply</span>
                  <h2 id="products-supply-details-title">
                    {detailSupplyItem.item_name || "Supply details"}
                  </h2>
                  <p>{detailSupplyItem.sku || "No SKU"}</p>
                </div>
                <span className="products-status-pill is-success">
                  {formatNumber(detailSupplyItem.quantity)} units
                </span>
              </div>
              <button
                aria-label="Close factory supply details"
                className="products-modal-close"
                onClick={closeSupplyDetails}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="products-details-content">
              <section className="products-details-grid products-supply-details-grid">
                <div>
                  <span>Supplier</span>
                  <strong>{detailSupplyItem.supplier_name || "-"}</strong>
                </div>
                <div>
                  <span>Category</span>
                  <strong>{detailSupplyItem.category || "Miscellaneous"}</strong>
                </div>
                <div>
                  <span>Used for</span>
                  <strong>{detailSupplyItem.usage_area || "General"}</strong>
                </div>
                <div>
                  <span>Quantity</span>
                  <strong>{formatNumber(detailSupplyItem.quantity)}</strong>
                </div>
                <div>
                  <span>Unit price</span>
                  <strong>{formatCurrency(detailSupplyItem.unit_price)}</strong>
                </div>
                <div>
                  <span>Line total</span>
                  <strong>{formatCurrency(detailSupplyItem.line_total)}</strong>
                </div>
                <div>
                  <span>Created</span>
                  <strong>{formatShortDate(detailSupplyItem.created_at)}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>
                    {formatShortDate(detailSupplyItem.updated_at || detailSupplyItem.created_at)}
                  </strong>
                </div>
              </section>

              <section className="products-details-section">
                <h3>Supply note</h3>
                {detailSupplyItem.note ? (
                  <p>{detailSupplyItem.note}</p>
                ) : (
                  <p>No note has been added.</p>
                )}
              </section>
            </div>

            <div className="products-form-footer">
              <button
                className="products-secondary-button"
                onClick={closeSupplyDetails}
                type="button"
              >
                Close
              </button>
              {!isWorkerView && (
                <button
                  className="products-primary-button"
                  onClick={() => {
                    const supplyToEdit = detailSupplyItem;
                    closeSupplyDetails();
                    openEditSupplyForm(supplyToEdit);
                  }}
                  type="button"
                >
                  <Icon name="edit" size={16} />
                  Edit supply
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div
          className="products-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <div
            aria-labelledby="products-modal-title"
            aria-modal="true"
            className="products-modal"
            role="dialog"
          >
            <div className="products-modal-header">
              <div>
                <span className="products-section-label">
                  {editingId !== null ? "Update catalog item" : "New catalog item"}
                </span>
                <h2 id="products-modal-title">
                  {editingId !== null ? "Edit product" : "Add product"}
                </h2>
                <p>Keep product identity, stock, pricing, and files in one place.</p>
              </div>
              <button
                aria-label="Close product form"
                className="products-modal-close"
                disabled={saving}
                onClick={closeForm}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form className="products-form" onSubmit={saveProduct}>
              <div className="products-form-content">
                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>1</span>
                    <div>
                      <h3>Product identity</h3>
                      <p>The article information used across orders and inventory.</p>
                    </div>
                  </div>
                  <div className="products-field-grid">
                    <label className="products-field">
                      <span>Article number</span>
                      <input
                        autoFocus
                        name="article_no"
                        onChange={handleChange}
                        placeholder="KLC-612"
                        required
                        value={form.article_no}
                      />
                    </label>
                    <label className="products-field is-wide">
                      <span>Product name</span>
                      <input
                        name="name"
                        onChange={handleChange}
                        placeholder="Damascus steel chef knife set"
                        required
                        value={form.name}
                      />
                    </label>
                    <label className="products-field">
                      <span>Category</span>
                      <input
                        list="products-category-options"
                        name="category"
                        onChange={handleChange}
                        placeholder="Chef Knife Set"
                        value={form.category}
                      />
                    </label>
                  </div>
                </section>

                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>2</span>
                    <div>
                      <h3>Opening stock</h3>
                      <p>Set starting balances. Use Inventory for later stock movements.</p>
                    </div>
                  </div>
                  <div className="products-field-grid is-four-column">
                    <label className="products-field">
                      <span>Factory stock</span>
                      <input
                        min="0"
                        name="factory_stock"
                        onChange={handleChange}
                        type="number"
                        value={form.factory_stock}
                      />
                    </label>
                    <label className="products-field">
                      <span>USA stock</span>
                      <input
                        min="0"
                        name="usa_stock"
                        onChange={handleChange}
                        type="number"
                        value={form.usa_stock}
                      />
                    </label>
                    <label className="products-field">
                      <span>Reserved stock</span>
                      <input
                        min="0"
                        name="reserved_stock"
                        onChange={handleChange}
                        type="number"
                        value={form.reserved_stock}
                      />
                    </label>
                    <label className="products-field">
                      <span>Low stock alert</span>
                      <input
                        min="0"
                        name="low_stock_alert"
                        onChange={handleChange}
                        type="number"
                        value={form.low_stock_alert}
                      />
                    </label>
                  </div>
                </section>

                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>3</span>
                    <div>
                      <h3>Pricing, weight and workflow</h3>
                      <p>Set USD wholesale and retail pricing, one-unit shipping weight, and production behavior.</p>
                    </div>
                  </div>
                  <div className="products-field-grid">
                    <label className="products-field">
                      <span>Wholesale price (USD)</span>
                      <div className="products-input-prefix">
                        <span>$</span>
                        <input
                          min="0"
                          name="cost_price"
                          onChange={handleChange}
                          step="0.01"
                          type="number"
                          value={form.cost_price}
                        />
                      </div>
                    </label>
                    <label className="products-field">
                      <span>MSRP / retail price (USD)</span>
                      <div className="products-input-prefix">
                        <span>$</span>
                        <input
                          min="0"
                          name="selling_price"
                          onChange={handleChange}
                          step="0.01"
                          type="number"
                          value={form.selling_price}
                        />
                      </div>
                    </label>
                    <label className="products-field">
                      <span>Unit shipping weight (kg)</span>
                      <input
                        min="0"
                        name="unit_weight_kg"
                        onChange={handleChange}
                        placeholder="e.g. 0.75"
                        step="0.001"
                        type="number"
                        value={form.unit_weight_kg}
                      />
                      <small>Weight of one product unit before order quantities are added.</small>
                    </label>
                    <label className="products-switch-card">
                      <input
                        checked={form.workflow_required}
                        name="workflow_required"
                        onChange={handleChange}
                        type="checkbox"
                      />
                      <span className="products-switch" aria-hidden="true">
                        <span />
                      </span>
                      <span>
                        <strong>Manufacturing workflow</strong>
                        <small>Require production steps for this article</small>
                      </span>
                    </label>
                  </div>
                </section>

                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>4</span>
                    <div>
                      <h3>Product notes</h3>
                      <p>Capture steel gauge, handle, finish, packing, and production details.</p>
                    </div>
                  </div>
                  <div className="products-field-grid">
                    <label className="products-field is-full">
                      <span>Product notes</span>
                      <textarea
                        name="notes"
                        onChange={handleChange}
                        placeholder="Add production notes, customer requests, packing details, or exceptions"
                        value={form.notes}
                      />
                    </label>
                  </div>
                </section>

                <section className="products-form-section">
                  <div className="products-form-section-heading">
                    <span>5</span>
                    <div>
                      <h3>Files</h3>
                      <p>Add a product image and the printable label file.</p>
                    </div>
                  </div>
                  <div className="products-upload-grid">
                    <label className="products-upload-card">
                      <input
                        accept="image/*"
                        name="image_file"
                        onChange={handleChange}
                        type="file"
                      />
                      {imagePreviewUrl ? (
                        <img loading="lazy" decoding="async" alt="Product preview" src={imagePreviewUrl} />
                      ) : (
                        <span className="products-upload-icon">
                          <Icon name="image" size={22} />
                        </span>
                      )}
                      <span>
                        <strong>Product image</strong>
                        <small>{form.image_file?.name || "Choose JPG, PNG, or WEBP"}</small>
                      </span>
                    </label>

                    <label className="products-upload-card">
                      <input
                        accept="image/*"
                        name="share_image_file"
                        onChange={handleChange}
                        type="file"
                      />
                      {shareImagePreviewUrl ? (
                        <img loading="lazy" decoding="async" alt="Share preview" src={shareImagePreviewUrl} />
                      ) : (
                        <span className="products-upload-icon">
                          <Icon name="image" size={22} />
                        </span>
                      )}
                      <span>
                        <strong>Share image</strong>
                        <small>
                          {form.share_image_file?.name ||
                            "Optional image for sharing only"}
                        </small>
                      </span>
                    </label>

                    <label className="products-upload-card">
                      <input
                        name="label_file"
                        onChange={handleChange}
                        type="file"
                      />
                      <span className="products-upload-icon">
                        <Icon name="file" size={22} />
                      </span>
                      <span>
                        <strong>Label file</strong>
                        <small>
                          {form.label_file?.name ||
                            (form.label_url
                              ? form.label_url.split("/").pop()
                              : "Choose a printable label file")}
                        </small>
                      </span>
                    </label>
                  </div>
                </section>
              </div>

              <div className="products-form-footer">
                {editingProduct && (
                  <button
                    className="products-danger-button"
                    disabled={saving}
                    onClick={() => handleDelete(editingProduct)}
                    type="button"
                  >
                    <Icon name="trash" size={16} />
                    Delete product
                  </button>
                )}
                <button
                  className="products-secondary-button"
                  disabled={saving}
                  onClick={closeForm}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="products-primary-button"
                  disabled={saving}
                  type="submit"
                >
                  <Icon name="check" size={17} />
                  {saving
                    ? "Saving"
                    : editingId !== null
                      ? "Update product"
                      : "Save product"}
                </button>
              </div>
            </form>
          </div>
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
                    disabled={savingDetailNote}
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
                          <img loading="lazy" decoding="async"
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
                        <strong>{formatNumber(detailProduct.factory_stock)}</strong>
                      </div>
                      <div>
                        <span>USA stock</span>
                        <strong>{formatNumber(detailProduct.usa_stock)}</strong>
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
                        <strong>{formatNumber(detailProduct.reserved_stock)}</strong>
                      </div>
                      <div>
                        <span>Available</span>
                        <strong>{formatNumber(detailProduct.available_stock)}</strong>
                      </div>
                      <div>
                        <span>Low stock alert</span>
                        <strong>{formatNumber(detailProduct.low_stock_alert)}</strong>
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

                  <section className="products-details-section products-share-image-section">
                    <h3>Share image</h3>
                    {detailShareImageUrl ? (
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
                          <img loading="lazy" decoding="async"
                            alt={detailProduct.name || detailProduct.article_no || "Share image"}
                            src={detailShareImageUrl}
                          />
                          <span>
                            <strong>Open share image</strong>
                            <small>{detailProduct.article_no || detailProduct.category || "Customer visual"}</small>
                          </span>
                        </button>
                        <div className="products-share-image-actions">
                          <button
                            className="products-label-button"
                            onClick={() =>
                              shareProductImage(detailShareImageUrl, detailProduct)
                            }
                            type="button"
                          >
                            <Icon name="share" size={15} />
                            Share
                          </button>
                          <button
                            className="products-label-button"
                            onClick={() =>
                              downloadShareImage(detailShareImageUrl, detailProduct)
                            }
                            type="button"
                          >
                            <Icon name="download" size={15} />
                            Download image
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>No share image has been added.</p>
                    )}
                  </section>

                  <section className="products-details-section">
                    <h3>Product notes</h3>
                    {detailNoteLines.length > 0 ? (
                      <ul className="products-details-note-list">
                        {detailNoteLines.map((note, index) => (
                          <li key={`${note}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No product notes have been added.</p>
                    )}
                    <form
                      className="products-details-note-form"
                      onSubmit={addDetailNote}
                    >
                      <textarea
                        aria-label="Add product note"
                        disabled={savingDetailNote}
                        onChange={(event) => setDetailNoteText(event.target.value)}
                        placeholder="Add steel gauge, handle detail, finish, packing, or production note"
                        value={detailNoteText}
                      />
                      <button
                        className="products-primary-button"
                        disabled={savingDetailNote || !detailNoteText.trim()}
                        type="submit"
                      >
                        <Icon name="check" size={16} />
                        {savingDetailNote ? "Adding" : "Add note"}
                      </button>
                    </form>
                  </section>
                </div>

                <div className="products-form-footer">
                  {(detailProduct.label_url || detailShareImageUrl) && (
                    <div className="products-details-file-actions">
                      {detailProduct.label_url && (
                        <button
                          className="products-label-button products-details-label-button"
                          onClick={() => openLabel(detailProduct.label_url)}
                          type="button"
                        >
                          <Icon name="file" size={15} />
                          Open label
                        </button>
                      )}
                      {detailShareImageUrl && (
                        <button
                          className="products-label-button"
                          onClick={() =>
                            window.open(
                              detailShareImageUrl,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                          type="button"
                        >
                          <Icon name="image" size={15} />
                          Open share image
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    className="products-secondary-button"
                    disabled={savingDetailNote}
                    onClick={closeDetails}
                    type="button"
                  >
                    Close
                  </button>
                  {!isWorkerView && (
                    <button
                      className="products-primary-button"
                      onClick={() => {
                        const productToEdit = detailProduct;
                        closeDetails();
                        handleEdit(productToEdit);
                      }}
                      disabled={savingDetailNote}
                      type="button"
                    >
                      <Icon name="edit" size={16} />
                      Edit product
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {productImagePreview && (
        <div
          className="products-image-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setProductImagePreview(null);
            }
          }}
        >
          <div
            aria-label="Product image preview"
            aria-modal="true"
            className="products-image-preview-modal"
            role="dialog"
          >
            <div className="products-image-preview-header">
              <div>
                <span className="products-section-label">
                  {productImagePreview.label || "Product image"}
                </span>
                <h2>{productImagePreview.title}</h2>
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
              <img loading="lazy" decoding="async"
                alt={productImagePreview.alt}
                src={productImagePreview.url}
              />
            </div>
          </div>
        </div>
      )}

      <datalist id="products-category-options">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <datalist id="products-supply-category-options">
        {["Factory Supplies", "Packing", "Consumables", "Tools", "Maintenance", ...supplyCategories]
          .filter((category, index, list) => category && list.indexOf(category) === index)
          .map((category) => (
            <option key={category} value={category} />
          ))}
      </datalist>
    </div>
  );
}

export default Products;
