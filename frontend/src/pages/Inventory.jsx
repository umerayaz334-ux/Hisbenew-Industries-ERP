import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./Inventory.css";

const createEditForm = () => ({
  factory_stock: 0,
  update_note: "",
});

const createAddForm = () => ({
  item_mode: "existing",
  product_id: "",
  custom_article_no: "",
  custom_name: "",
  custom_category: "",
  custom_image_file: null,
  stock_type: "factory_stock",
  source_type: "factory",
  supplier_id: "",
  purchase_price: "",
  quantity: 0,
  note: "",
});

const createMoveForm = () => ({
  source_stock: "factory_stock",
  destination_stock: "usa_stock",
  quantity: 1,
  note: "",
});

const INVENTORY_LOCATIONS = [
  { key: "factory_stock", label: "PK" },
  { key: "usa_stock", label: "USA" },
  { key: "front_room_stock", label: "Front Room" },
];

const getImageUrl = getStaticUrl;

const formatNumber = (value) =>
  Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });

const formatCurrency = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const STOCK_DRAFT_FIELDS = [{ key: "factory_stock", label: "PK" }];

const toStockNumber = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const calculateAvailableStock = (stock) =>
  toStockNumber(stock.factory_stock) +
  toStockNumber(stock.usa_stock) +
  toStockNumber(stock.front_room_stock) -
  toStockNumber(stock.reserved_stock);

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
    inventory: (
      <>
        <path d="M4 7h16v13H4zM7 4h10l3 3H4l3-3Z" />
        <path d="M9 12h6" />
      </>
    ),
    factory: (
      <>
        <path d="M3 21V9l6 3V8l6 4V5h6v16H3Z" />
        <path d="M7 17h2M12 17h2M17 17h2" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
    reserved: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M8 11h8M8 15h5" />
      </>
    ),
    available: (
      <>
        <path d="m3 7 9 5 9-5M12 12v9" />
        <path d="m5 5 7-3 7 3 2 2v10l-9 5-9-5V7l2-2Z" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
    movement: (
      <>
        <path d="M7 7h12l-3-3M17 17H5l3 3" />
        <path d="m19 7-3 3M5 17l3-3" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m4 17 5-5 4 4 2-2 5 5" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    check: <path d="m5 12 4 4L19 6" />,
    truck: (
      <>
        <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="19" r="2" />
        <circle cx="18" cy="19" r="2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="inventory-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function Inventory() {
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [editStockForm, setEditStockForm] = useState(createEditForm);
  const [moveStockForm, setMoveStockForm] = useState(createMoveForm);
  const [addStockForm, setAddStockForm] = useState(createAddForm);
  const [stockDrafts, setStockDrafts] = useState({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBulkStock, setSavingBulkStock] = useState(false);
  const [notice, setNotice] = useState(null);
  const [inventoryTab, setInventoryTab] = useState("products");
  const [stockSearch, setStockSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [stockSort, setStockSort] = useState("none");
  const [movementSearch, setMovementSearch] = useState("");
  const [movementFilter, setMovementFilter] = useState("all");
  const [addProductSearch, setAddProductSearch] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [showMovements, setShowMovements] = useState(false);
  const [showBulkChanges, setShowBulkChanges] = useState(false);

  useEffect(() => {
    let active = true;

    Promise.all([
      api.get("/products"),
      api.get("/stock-movements"),
      api.get("/suppliers"),
    ])
      .then(([productsResponse, movementsResponse, suppliersResponse]) => {
        if (!active) return;
        setProducts(
          Array.isArray(productsResponse.data) ? productsResponse.data : []
        );
        setMovements(
          Array.isArray(movementsResponse.data) ? movementsResponse.data : []
        );
        setSuppliers(
          Array.isArray(suppliersResponse.data) ? suppliersResponse.data : []
        );
      })
      .catch((error) => {
        console.error("Inventory loading error:", error);
        if (active) {
          setNotice({
            type: "error",
            text: "Inventory could not be loaded. Check the backend connection.",
          });
        }
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const modalOpen = editingId !== null || movingId !== null || addStockOpen;
    if (!modalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || saving) return;
      setEditingId(null);
      setMovingId(null);
      setAddStockOpen(false);
      setEditStockForm(createEditForm());
      setMoveStockForm(createMoveForm());
      setAddStockForm(createAddForm());
      setAddProductSearch("");
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [addStockOpen, editingId, movingId, saving]);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const editingProduct = useMemo(
    () => productsById.get(editingId) || null,
    [editingId, productsById]
  );

  const movingProduct = useMemo(
    () => productsById.get(movingId) || null,
    [movingId, productsById]
  );

  const moveSourceBalance = movingProduct
    ? toStockNumber(movingProduct[moveStockForm.source_stock])
    : 0;
  const moveDestinationBalance = movingProduct
    ? toStockNumber(movingProduct[moveStockForm.destination_stock])
    : 0;

  const addingProduct = useMemo(
    () => productsById.get(Number(addStockForm.product_id)) || null,
    [addStockForm.product_id, productsById]
  );

  const selectedSupplier = useMemo(
    () =>
      suppliers.find(
        (supplier) => Number(supplier.id) === Number(addStockForm.supplier_id)
      ) || null,
    [addStockForm.supplier_id, suppliers]
  );

  const bulkStockChanges = useMemo(
    () =>
      Object.entries(stockDrafts).flatMap(([productId, draft]) => {
        const product =
          productsById.get(Number(productId)) || productsById.get(productId);
        if (!product) return [];

        const before = {
          ...STOCK_DRAFT_FIELDS.reduce(
            (values, { key }) => ({
              ...values,
              [key]: toStockNumber(product[key]),
            }),
            {}
          ),
          usa_stock: toStockNumber(product.usa_stock),
          front_room_stock: toStockNumber(product.front_room_stock),
          reserved_stock: toStockNumber(product.reserved_stock),
        };
        const after = {
          ...STOCK_DRAFT_FIELDS.reduce(
            (values, { key }) => ({
              ...values,
              [key]: toStockNumber(draft[key] ?? product[key]),
            }),
            {}
          ),
          usa_stock: toStockNumber(product.usa_stock),
          front_room_stock: toStockNumber(product.front_room_stock),
          reserved_stock: toStockNumber(product.reserved_stock),
        };
        const fields = STOCK_DRAFT_FIELDS.filter(
          ({ key }) => before[key] !== after[key]
        );

        if (fields.length === 0) return [];

        return [
          {
            product,
            before,
            after,
            fields,
            beforeAvailable: calculateAvailableStock(before),
            afterAvailable: calculateAvailableStock(after),
          },
        ];
      }),
    [productsById, stockDrafts]
  );

  const pendingBulkStockCount = bulkStockChanges.length;

  const factorySupplies = useMemo(
    () => flattenSupplierSupplyItems(suppliers),
    [suppliers]
  );

  const selectInventoryTab = (nextTab) => {
    setInventoryTab(nextTab);
    setStockFilter("all");
    if (nextTab !== "products") setShowBulkChanges(false);
  };

  const summary = useMemo(
    () => ({
      factory: products.reduce(
        (total, product) => total + Number(product.factory_stock || 0),
        0
      ),
      usa: products.reduce(
        (total, product) => total + Number(product.usa_stock || 0),
        0
      ),
      frontRoom: products.reduce(
        (total, product) => total + Number(product.front_room_stock || 0),
        0
      ),
      available: products.reduce(
        (total, product) => total + Number(product.available_stock || 0),
        0
      ),
      lowStock: products.filter(
        (product) =>
          Number(product.available_stock || 0) <=
          Number(product.low_stock_alert || 0)
      ).length,
      movements: movements.length,
    }),
    [movements.length, products]
  );

  const movementTypes = useMemo(
    () =>
      Array.from(
        new Set(movements.map((movement) => movement.movement_type).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [movements]
  );

  const filteredProducts = useMemo(() => {
    const query = stockSearch.trim().toLowerCase();

    const matchingProducts = products.filter((product) => {
      const available = Number(product.available_stock || 0);

      const threshold = Number(product.low_stock_alert || 0);
      const matchesSearch = [product.article_no, product.category]
        .some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "healthy" && available > threshold) ||
        (stockFilter === "low" && available <= threshold && available > 0) ||
        (stockFilter === "out" && available <= 0);

      return matchesSearch && matchesStock;
    });

    if (stockSort === "none") return matchingProducts;

    return matchingProducts.sort((first, second) => {
      const stockField = "available_stock";
      const stockDifference =
        Number(first[stockField] || 0) - Number(second[stockField] || 0);
      const direction = stockSort === "desc" ? -1 : 1;

      return (
        stockDifference * direction ||
        String(first.article_no || "").localeCompare(
          String(second.article_no || "")
        )
      );
    });
  }, [products, stockFilter, stockSearch, stockSort]);

  const filteredSupplies = useMemo(() => {
    const query = stockSearch.trim().toLowerCase();

    const matchingSupplies = factorySupplies.filter((item) =>
      [
        item.sku,
        item.item_name,
        item.category,
        item.usage_area,
        item.note,
        item.supplier_name,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );

    if (stockSort === "none") return matchingSupplies;

    return matchingSupplies.sort((first, second) => {
      const quantityDifference =
        Number(first.quantity || 0) - Number(second.quantity || 0);
      const direction = stockSort === "desc" ? -1 : 1;

      return (
        quantityDifference * direction ||
        String(first.item_name || "").localeCompare(String(second.item_name || ""))
      );
    });
  }, [factorySupplies, stockSearch, stockSort]);

  const filteredAddProducts = useMemo(() => {
    const query = addProductSearch.trim().toLowerCase();
    if (!query) return products.slice(0, 18);

    return products
      .filter((product) =>
        [product.article_no, product.category].some((value) =>
          String(value || "").toLowerCase().includes(query)
        )
      )
      .slice(0, 18);
  }, [addProductSearch, products]);

  const filteredMovements = useMemo(() => {
    const query = movementSearch.trim().toLowerCase();

    return movements.filter((movement) => {
      const matchesSearch = [
        movement.article_no,
        movement.product_name,
        movement.movement_type,
        movement.source,
        movement.supplier_name,
        movement.reference,
        movement.note,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesFilter =
        movementFilter === "all" ||
        movement.movement_type === movementFilter;

      return matchesSearch && matchesFilter;
    });
  }, [movementFilter, movementSearch, movements]);

  const projectedStock = useMemo(() => {
    if (addStockForm.item_mode === "custom") {
      return Number(addStockForm.quantity || 0);
    }
    if (!addingProduct) return 0;
    const currentValue = Number(
      addingProduct[addStockForm.stock_type] || 0
    );
    return currentValue + Number(addStockForm.quantity || 0);
  }, [
    addStockForm.item_mode,
    addStockForm.quantity,
    addStockForm.stock_type,
    addingProduct,
  ]);

  const addStockPurchaseHistory = useMemo(() => {
    const productId = Number(addStockForm.product_id);
    const supplierId = Number(addStockForm.supplier_id);
    if (!productId || addStockForm.item_mode !== "existing") return [];

    return movements
      .filter(
        (movement) =>
          Number(movement.product_id) === productId &&
          (!supplierId || Number(movement.supplier_id) === supplierId) &&
          movement.movement_type === "Supplier Purchase" &&
          Number(movement.purchase_price || 0) > 0
      )
      .sort(
        (left, right) =>
          (new Date(right.created_at).getTime() || 0) -
          (new Date(left.created_at).getTime() || 0)
      );
  }, [
    addStockForm.item_mode,
    addStockForm.product_id,
    addStockForm.supplier_id,
    movements,
  ]);

  const latestAddStockPurchase = addStockPurchaseHistory[0] || null;

  const addStockLineTotal =
    Number(addStockForm.quantity || 0) *
    Number(addStockForm.purchase_price || 0);

  const refreshInventory = async () => {
    try {
      const [productsResponse, movementsResponse] = await Promise.all([
        api.get("/products"),
        api.get("/stock-movements"),
      ]);
      setProducts(
        Array.isArray(productsResponse.data) ? productsResponse.data : []
      );
      setMovements(
        Array.isArray(movementsResponse.data) ? movementsResponse.data : []
      );
    } catch (error) {
      console.error("Inventory loading error:", error);
      setNotice({ type: "error", text: "Inventory could not be refreshed." });
    }
  };

  const getDraftStockValue = (product, field) =>
    toStockNumber(stockDrafts[product.id]?.[field] ?? product[field]);

  const getDraftAvailableStock = (product) =>
    calculateAvailableStock({
      factory_stock: getDraftStockValue(product, "factory_stock"),
      usa_stock: getDraftStockValue(product, "usa_stock"),
      front_room_stock: getDraftStockValue(product, "front_room_stock"),
      reserved_stock: toStockNumber(product.reserved_stock),
    });

  const isDraftStockChanged = (product, field) =>
    getDraftStockValue(product, field) !== toStockNumber(product[field]);

  const handleStockDraftChange = (product, field, value) => {
    const nextValue = toStockNumber(value);

    setStockDrafts((current) => {
      const baseline = STOCK_DRAFT_FIELDS.reduce(
        (values, { key }) => ({
          ...values,
          [key]: toStockNumber(product[key]),
        }),
        {}
      );
      const nextDraft = {
        ...baseline,
        ...(current[product.id] || {}),
        [field]: nextValue,
      };
      const hasChanges = STOCK_DRAFT_FIELDS.some(
        ({ key }) => toStockNumber(nextDraft[key]) !== baseline[key]
      );
      const nextDrafts = { ...current };

      if (hasChanges) {
        nextDrafts[product.id] = nextDraft;
      } else {
        delete nextDrafts[product.id];
      }

      return nextDrafts;
    });
  };

  const resetStockDraft = (productId) => {
    setStockDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[productId];
      return nextDrafts;
    });
  };

  const clearStockDrafts = () => {
    setStockDrafts({});
    setShowBulkChanges(false);
  };

  const saveBulkStockChanges = async () => {
    if (pendingBulkStockCount === 0 || savingBulkStock) return;

    setSavingBulkStock(true);
    try {
      await Promise.all(
        bulkStockChanges.map(({ after, product }) => {
          const formData = new FormData();
          formData.append("factory_stock", after.factory_stock);
          formData.append("update_note", "Bulk PK inventory edit");

          return api.patch(`/products/${product.id}/update-stock`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        })
      );

      await refreshInventory();
      setNotice({
        type: "success",
        text: `${formatNumber(pendingBulkStockCount)} stock ${
          pendingBulkStockCount === 1 ? "change" : "changes"
        } saved.`,
      });
      clearStockDrafts();
    } catch (error) {
      console.error("Bulk stock update error:", error);
      setNotice({
        type: "error",
        text:
          error.response?.data?.detail ||
          "Bulk stock changes could not be saved.",
      });
    } finally {
      setSavingBulkStock(false);
    }
  };

  const openEditStock = (product) => {
    setEditingId(product.id);
    setMovingId(null);
    setAddStockOpen(false);
    setEditStockForm({
      factory_stock: product.factory_stock ?? 0,
      update_note: "",
    });
  };

  const closeEditStock = () => {
    if (saving) return;
    setEditingId(null);
    setEditStockForm(createEditForm());
  };

  const openMoveStock = (product) => {
    const sourceLocation =
      INVENTORY_LOCATIONS.find(
        (location) => toStockNumber(product[location.key]) > 0
      ) || INVENTORY_LOCATIONS[0];
    const destinationLocation = INVENTORY_LOCATIONS.find(
      (location) => location.key !== sourceLocation.key
    );

    setMovingId(product.id);
    setEditingId(null);
    setAddStockOpen(false);
    setMoveStockForm({
      ...createMoveForm(),
      source_stock: sourceLocation.key,
      destination_stock: destinationLocation.key,
    });
  };

  const closeMoveStock = () => {
    if (saving) return;
    setMovingId(null);
    setMoveStockForm(createMoveForm());
  };

  const openAddStock = (product = null) => {
    setAddStockOpen(true);
    setEditingId(null);
    setMovingId(null);
    setAddProductSearch("");
    setAddStockForm({
      ...createAddForm(),
      product_id: product ? String(product.id) : "",
    });
  };

  const closeAddStock = () => {
    if (saving) return;
    setAddStockOpen(false);
    setAddStockForm(createAddForm());
    setAddProductSearch("");
  };

  const selectAddStockProduct = (product) => {
    setAddStockForm((current) => ({
      ...current,
      item_mode: "existing",
      product_id: String(product.id),
    }));
  };

  const useLatestAddStockPurchasePrice = () => {
    if (!latestAddStockPurchase) return;

    setAddStockForm((current) => ({
      ...current,
      purchase_price: String(latestAddStockPurchase.purchase_price || ""),
    }));
  };

  const handleStockChange = (event) => {
    const { name, value } = event.target;
    setEditStockForm((current) => ({
      ...current,
      [name]: name === "update_note" ? value : Number(value),
    }));
  };

  const handleMoveStockChange = (event) => {
    const { name, value } = event.target;
    setMoveStockForm((current) => {
      const nextForm = {
        ...current,
        [name]: name === "quantity" ? Number(value) : value,
      };
      if (name === "source_stock" && value === current.destination_stock) {
        nextForm.destination_stock = INVENTORY_LOCATIONS.find(
          (location) => location.key !== value
        ).key;
      }
      return nextForm;
    });
  };

  const handleAddStockChange = (event) => {
    const { files, name, value } = event.target;
    setAddStockForm((current) => {
      const nextForm = {
        ...current,
        [name]:
          name === "quantity"
            ? Number(value)
            : name === "custom_image_file"
              ? files?.[0] || null
              : value,
      };

      if (name === "source_type" && value !== "supplier") {
        nextForm.supplier_id = "";
        nextForm.purchase_price = "";
      }

      if (name === "item_mode") {
        nextForm.product_id = value === "existing" ? current.product_id : "";
        nextForm.custom_image_file = value === "custom" ? current.custom_image_file : null;
      }

      return nextForm;
    });
  };

  const saveStockMove = async (event) => {
    event.preventDefault();
    if (!movingProduct) return;

    const quantity = Number(moveStockForm.quantity || 0);
    if (quantity <= 0) {
      setNotice({ type: "error", text: "Enter a valid quantity to move." });
      return;
    }
    if (quantity > moveSourceBalance) {
      const sourceLabel = INVENTORY_LOCATIONS.find(
        (location) => location.key === moveStockForm.source_stock
      )?.label;
      setNotice({
        type: "error",
        text: `Only ${formatNumber(moveSourceBalance)} units are available in ${sourceLabel}.`,
      });
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("source_stock", moveStockForm.source_stock);
      formData.append("destination_stock", moveStockForm.destination_stock);
      formData.append("quantity", quantity);
      formData.append("note", moveStockForm.note.trim());

      await api.post(`/products/${movingProduct.id}/move-stock`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await refreshInventory();

      const sourceLabel = INVENTORY_LOCATIONS.find(
        (location) => location.key === moveStockForm.source_stock
      )?.label;
      const destinationLabel = INVENTORY_LOCATIONS.find(
        (location) => location.key === moveStockForm.destination_stock
      )?.label;
      setNotice({
        type: "success",
        text: `${formatNumber(quantity)} ${quantity === 1 ? "unit" : "units"} moved from ${sourceLabel} to ${destinationLabel}.`,
      });
      setMovingId(null);
      setMoveStockForm(createMoveForm());
    } catch (error) {
      console.error("Stock move error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Stock could not be moved.",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveStockUpdate = async (event) => {
    event.preventDefault();
    if (!editingProduct) return;

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("factory_stock", editStockForm.factory_stock);
      formData.append("update_note", editStockForm.update_note.trim());

      await api.patch(`/products/${editingProduct.id}/update-stock`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      await refreshInventory();
      setNotice({
        type: "success",
        text: `${editingProduct.article_no} stock levels updated.`,
      });
      setEditingId(null);
      setEditStockForm(createEditForm());
    } catch (error) {
      console.error("Stock update error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Stock could not be updated.",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveAddStock = async (event) => {
    event.preventDefault();
    const quantity = Number(addStockForm.quantity);
    const purchasePrice = Number(addStockForm.purchase_price);

    if (quantity <= 0) {
      setNotice({ type: "error", text: "Enter a valid quantity to add." });
      return;
    }

    if (addStockForm.item_mode === "existing" && !addingProduct) {
      setNotice({ type: "error", text: "Select a product to receive stock." });
      return;
    }

    if (
      addStockForm.item_mode === "custom" &&
      (!addStockForm.custom_article_no.trim() ||
        !addStockForm.custom_name.trim())
    ) {
      setNotice({
        type: "error",
        text: "Enter a custom SKU and item name.",
      });
      return;
    }

    if (
      addStockForm.source_type === "supplier" &&
      (!addStockForm.supplier_id || purchasePrice <= 0)
    ) {
      setNotice({
        type: "error",
        text: "Select a supplier and enter a valid purchase price.",
      });
      return;
    }

    setSaving(true);
    try {
      let stockProduct = addingProduct;

      if (addStockForm.item_mode === "custom") {
        const productPayload = new FormData();
        productPayload.append("article_no", addStockForm.custom_article_no.trim());
        productPayload.append("name", addStockForm.custom_name.trim());
        productPayload.append("category", addStockForm.custom_category.trim());
        productPayload.append("factory_stock", 0);
        productPayload.append("usa_stock", 0);
        productPayload.append("front_room_stock", 0);
        productPayload.append("reserved_stock", 0);
        productPayload.append(
          "cost_price",
          addStockForm.source_type === "supplier" ? purchasePrice : 0
        );
        productPayload.append("selling_price", 0);
        productPayload.append("low_stock_alert", 0);
        productPayload.append("workflow_required", false);

        if (addStockForm.custom_image_file) {
          productPayload.append("image", addStockForm.custom_image_file);
        }

        const productResponse = await api.post("/products", productPayload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        stockProduct = productResponse.data;
      }

      const formData = new FormData();
      const deltaField = {
        factory_stock: "factory_delta",
        usa_stock: "usa_delta",
        front_room_stock: "front_room_delta",
      }[addStockForm.stock_type];
      formData.append(deltaField, quantity);
      formData.append("source_type", addStockForm.source_type);

      if (addStockForm.source_type === "supplier") {
        formData.append("supplier_id", addStockForm.supplier_id);
        formData.append("purchase_price", addStockForm.purchase_price);
      }

      const stockLabel = addStockForm.stock_type
        .replace("_stock", "")
        .toUpperCase();
      const sourceLabel =
        addStockForm.source_type === "supplier"
          ? "supplier"
          : "factory manufacturing";
      formData.append(
        "update_note",
        `Added ${quantity} units to ${stockLabel} stock from ${sourceLabel}. ${addStockForm.note.trim()}`
      );

      await api.patch(`/products/${stockProduct.id}/update-stock`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      await refreshInventory();
      setNotice({
        type: "success",
        text: `${formatNumber(quantity)} units added to ${stockProduct.article_no}.`,
      });
      setAddStockOpen(false);
      setAddStockForm(createAddForm());
      setAddProductSearch("");
    } catch (error) {
      console.error("Add stock error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Stock could not be added.",
      });
    } finally {
      setSaving(false);
    }
  };

  const getStockStatus = (product, availableOverride = null) => {
    const available =
      availableOverride === null
        ? Number(product.available_stock || 0)
        : Number(availableOverride || 0);
    const threshold = Number(product.low_stock_alert || 0);
    if (available <= 0) return { label: "Out of stock", tone: "danger" };
    if (available <= threshold) return { label: "Low stock", tone: "warning" };
    return { label: "Healthy", tone: "success" };
  };

  const getMovementTone = (movementType) => {
    const type = String(movementType || "").toLowerCase();
    if (
      type.includes("deduction") ||
      type.includes("reservation") ||
      type.includes("fault")
    ) {
      return "danger";
    }
    if (type.includes("manufacturing") || type.includes("purchase")) {
      return "info";
    }
    return "success";
  };

  return (
    <div className="inventory-page">
      <header
        className={`inventory-page-header ${showSummary ? "is-expanded" : ""}`}
      >
        <div className="inventory-page-header-main">
          <div>
            <h1>Inventory</h1>
          </div>

          <div className="inventory-header-actions">
            {inventoryTab === "products" && pendingBulkStockCount > 0 && (
              <div className="inventory-pending-actions">
                <span className="inventory-pending-label">
                  {formatNumber(pendingBulkStockCount)} unsaved
                </span>
                <button
                  className="inventory-view-changes-button"
                  onClick={() => setShowBulkChanges((current) => !current)}
                  type="button"
                >
                  {showBulkChanges ? "Hide details" : "Review"}
                </button>
                <button
                  className="inventory-save-changes-button"
                  disabled={savingBulkStock}
                  onClick={saveBulkStockChanges}
                  type="button"
                >
                  <Icon name="check" size={15} />
                  {savingBulkStock ? "Saving..." : "Save"}
                </button>
              </div>
            )}
            <button
              className="inventory-secondary-button"
              onClick={() => openAddStock()}
              type="button"
            >
              <Icon name="plus" size={16} />
              Receive stock
            </button>
            <button
              aria-controls="inventory-header-summary"
              aria-expanded={showSummary}
              className="inventory-summary-toggle"
              onClick={() => setShowSummary((current) => !current)}
              type="button"
            >
              Overview
              <Icon name="chevron" size={16} />
            </button>

          </div>
        </div>

        {showSummary && (
          <section
            aria-label="Inventory summary"
            className="inventory-summary-grid"
            id="inventory-header-summary"
          >
            <article>
              <div className="inventory-summary-icon is-factory">
                <Icon name="factory" size={18} />
              </div>
              <div>
                <span>Pakistan (PK)</span>
                <strong>{formatNumber(summary.factory)}</strong>
                <small>Units on hand</small>
              </div>
            </article>
            <article>
              <div className="inventory-summary-icon is-usa">
                <Icon name="globe" size={18} />
              </div>
              <div>
                <span>USA</span>
                <strong>{formatNumber(summary.usa)}</strong>
                <small>Units on hand</small>
              </div>
            </article>
            <article>
              <div className="inventory-summary-icon is-reserved">
                <Icon name="inventory" size={18} />
              </div>
              <div>
                <span>Front Room</span>
                <strong>{formatNumber(summary.frontRoom)}</strong>
                <small>USA fulfillment</small>
              </div>
            </article>
            <article>
              <div className="inventory-summary-icon is-available">
                <Icon name="available" size={18} />
              </div>
              <div>
                <span>Available</span>
                <strong>{formatNumber(summary.available)}</strong>
                <small>Ready to allocate</small>
              </div>
            </article>
            <article>
              <div className="inventory-summary-icon is-warning">
                <Icon name="warning" size={18} />
              </div>
              <div>
                <span>Attention</span>
                <strong>{formatNumber(summary.lowStock)}</strong>
                <small>Low or out</small>
              </div>
            </article>
            <article>
              <div className="inventory-summary-icon is-movement">
                <Icon name="movement" size={18} />
              </div>
              <div>
                <span>Movements</span>
                <strong>{formatNumber(summary.movements)}</strong>
                <small>Audit records</small>
              </div>
            </article>
        </section>
        )}
      </header>

      {notice && (
        <div className={`inventory-alert is-${notice.type}`} role="status">
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

      {showBulkChanges && inventoryTab === "products" && (
        <section className="inventory-bulk-changes-panel" aria-live="polite">
          <div className="inventory-bulk-changes-header">
            <strong>
              {formatNumber(pendingBulkStockCount)} pending{" "}
              {pendingBulkStockCount === 1 ? "edit" : "edits"}
            </strong>
            <button
              className="inventory-discard-button"
              disabled={pendingBulkStockCount === 0 || savingBulkStock}
              onClick={clearStockDrafts}
              type="button"
            >
              Discard
            </button>
          </div>
          {pendingBulkStockCount === 0 ? (
            <p className="inventory-bulk-changes-empty">No stock edits yet.</p>
          ) : (
            <div className="inventory-bulk-change-list">
              {bulkStockChanges.map(
                ({ after, afterAvailable, before, beforeAvailable, fields, product }) => (
                  <article className="inventory-bulk-change-row" key={product.id}>
                    <div className="inventory-bulk-change-product">
                      {product.image_url ? (
                        <img loading="lazy" decoding="async"
                          alt={product.article_no || "Product"}
                          src={getImageUrl(product.image_url)}
                        />
                      ) : (
                        <span>
                          <Icon name="image" size={15} />
                        </span>
                      )}
                      <div>
                        <strong>{product.article_no || "No SKU"}</strong>
                        <small>{product.category || "Uncategorized"}</small>
                      </div>
                    </div>
                    <div className="inventory-bulk-change-values">
                      {fields.map(({ key, label }) => (
                        <span key={key}>
                          <em>{label}</em>
                          <s>{formatNumber(before[key])}</s>
                          <strong aria-hidden="true">→</strong>
                          {formatNumber(after[key])}
                        </span>
                      ))}
                      {beforeAvailable !== afterAvailable && (
                        <span>
                          <em>Available</em>
                          <s>{formatNumber(beforeAvailable)}</s>
                          <strong aria-hidden="true">→</strong>{" "}
                          {formatNumber(afterAvailable)}
                        </span>
                      )}
                    </div>
                  </article>
                )
              )}
            </div>
          )}
        </section>
      )}

      <section className="inventory-panel">
        <div className="inventory-panel-header">
          <div className="inventory-panel-heading-main">
            <div>
              <h2>
                {inventoryTab === "supplies"
                  ? "Factory supplies"
                  : "Stock by product"}
              </h2>
              <p>
                {inventoryTab === "supplies"
                  ? `${filteredSupplies.length} of ${factorySupplies.length} supply lines shown`
                  : `${filteredProducts.length} of ${products.length} products shown`}
              </p>
            </div>
            <div
              aria-label="Inventory type"
              className="inventory-tab-list"
              role="tablist"
            >
              <button
                aria-selected={inventoryTab === "products"}
                className={`inventory-tab-button ${
                  inventoryTab === "products" ? "is-active" : ""
                }`}
                onClick={() => selectInventoryTab("products")}
                role="tab"
                type="button"
              >
                Products
                <span>{formatNumber(products.length)}</span>
              </button>
              <button
                aria-selected={inventoryTab === "supplies"}
                className={`inventory-tab-button ${
                  inventoryTab === "supplies" ? "is-active" : ""
                }`}
                onClick={() => selectInventoryTab("supplies")}
                role="tab"
                type="button"
              >
                Factory supplies
                <span>{formatNumber(factorySupplies.length)}</span>
              </button>
            </div>
          </div>
          <div className="inventory-toolbar inventory-stock-toolbar">
            <label className="inventory-search-box">
              <Icon name="search" size={17} />
              <input
                aria-label={
                  inventoryTab === "supplies"
                    ? "Search factory supplies"
                    : "Search inventory"
                }
                onChange={(event) => setStockSearch(event.target.value)}
                placeholder={
                  inventoryTab === "supplies"
                    ? "Search supply, SKU, supplier, or category"
                    : "Search SKU or category"
                }
                value={stockSearch}
              />
            </label>
            {inventoryTab === "products" && (
              <select
                aria-label="Filter inventory by status"
                onChange={(event) => setStockFilter(event.target.value)}
                value={stockFilter}
              >
                <option value="all">All stock</option>
                <option value="healthy">Healthy</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>

              </select>
            )}
            <select
              aria-label="Sort stock quantity"
              onChange={(event) => setStockSort(event.target.value)}
              value={stockSort}
            >
              <option value="none">Default order</option>
              <option value="asc">Low to high</option>
              <option value="desc">High to low</option>
            </select>
          </div>
        </div>

        {initialLoading ? (
          <div className="inventory-loading-list" aria-label="Loading inventory">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="inventory-loading-row" key={index} />
            ))}
          </div>
        ) : inventoryTab === "supplies" ? (
          filteredSupplies.length === 0 ? (
            <div className="inventory-empty-state">
              <div>
                <Icon name="factory" size={25} />
              </div>
              <h3>
                {factorySupplies.length === 0
                  ? "No factory supplies yet"
                  : "No matches found"}
              </h3>
              <p>
                {factorySupplies.length === 0
                  ? "Factory supplies added from supplier purchases will appear here."
                  : "Try changing the search text."}
              </p>
            </div>
          ) : (
            <div className="inventory-table-wrap">
              <table className="inventory-stock-table inventory-supplies-table">
                <thead>
                  <tr>
                    <th>Supply</th>
                    <th>Category</th>
                    <th>Used for</th>
                    <th>Supplier</th>
                    <th>Quantity</th>
                    <th>Unit cost</th>
                    <th>Total</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSupplies.map((item) => (
                    <tr key={`${item.supplier_id}-${item.id}`}>
                      <td className="inventory-supply-name-cell" data-label="Supply">
                        <strong>{item.item_name || "Unnamed supply"}</strong>
                        <small>{item.sku || "No SKU"}</small>
                      </td>
                      <td data-label="Category">{item.category || "Miscellaneous"}</td>
                      <td data-label="Used for">{item.usage_area || "General"}</td>
                      <td data-label="Supplier">{item.supplier_name || "-"}</td>
                      <td data-label="Quantity">
                        <strong className="inventory-stock-value">
                          {formatNumber(item.quantity)}
                        </strong>
                      </td>
                      <td data-label="Unit cost">
                        {formatCurrency(item.unit_price)}
                      </td>
                      <td data-label="Total">
                        {formatCurrency(item.line_total)}
                      </td>
                      <td data-label="Updated">
                        {formatShortDate(item.updated_at || item.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredProducts.length === 0 ? (
          <div className="inventory-empty-state">
            <div>
              <Icon name="inventory" size={25} />
            </div>
            <h3>{products.length === 0 ? "No inventory yet" : "No matches found"}</h3>
            <p>
              {products.length === 0
                ? "Add products first to begin tracking stock."
                : "Try changing the search text or stock filter."}
            </p>
          </div>
        ) : (
          <div className="inventory-table-wrap">
            <table className="inventory-stock-table inventory-bulk-edit-table">
              <thead>
                <tr>
                  <th>SKU / Category</th>
                  <th>PK</th>
                  <th>USA</th>
                  <th>Front Room</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const draftAvailable = getDraftAvailableStock(product);
                  const stockStatus = getStockStatus(product, draftAvailable);
                  const rowEdited = Boolean(stockDrafts[product.id]);
                  const productLabel = product.article_no || "Product";

                  return (
                    <tr key={product.id}>
                      <td className="inventory-product-cell">
                        {product.image_url ? (
                          <img loading="lazy" decoding="async"
                            alt={product.article_no || "Product"}
                            className="inventory-thumbnail"
                            src={getImageUrl(product.image_url)}
                          />
                        ) : (
                          <span className="inventory-thumbnail-placeholder">
                            <Icon name="image" size={20} />
                          </span>
                        )}
                        <div className="inventory-product-identity">
                          <strong>{product.article_no || "No SKU"}</strong>
                          <small>{product.category || "Uncategorized"}</small>
                        </div>
                      </td>
                      <td className="inventory-inline-stock-cell" data-label="PK">
                        <label
                          className={`inventory-inline-stock-input ${
                            isDraftStockChanged(product, "factory_stock")
                              ? "is-changed"
                              : ""
                          }`}
                        >
                          <input
                            aria-label={`${productLabel} PK stock`}
                            disabled={savingBulkStock}
                            min="0"
                            onChange={(event) =>
                              handleStockDraftChange(
                                product,
                                "factory_stock",
                                event.target.value
                              )
                            }
                            type="number"
                            value={getDraftStockValue(product, "factory_stock")}
                          />
                        </label>
                      </td>
                      <td className="inventory-inline-stock-cell" data-label="USA">
                        <strong className="inventory-stock-value">
                          {formatNumber(product.usa_stock)}
                        </strong>
                      </td>
                      <td
                        className="inventory-inline-stock-cell"
                        data-label="Front Room"
                      >
                        <strong className="inventory-stock-value">
                          {formatNumber(product.front_room_stock)}
                        </strong>
                      </td>
                      <td data-label="Available">
                        <strong className="inventory-stock-value is-available">
                          {formatNumber(draftAvailable)}
                        </strong>
                      </td>
                      <td data-label="Status">
                        <span
                          className={`inventory-status-pill is-${stockStatus.tone}`}
                        >
                          {stockStatus.label}
                        </span>
                      </td>
                      <td className="inventory-actions-cell">
                        <div className="inventory-row-actions">
                          {rowEdited && (
                            <button
                              className="inventory-revert-button"
                              disabled={savingBulkStock}
                              onClick={() => resetStockDraft(product.id)}
                              type="button"
                            >
                              Reset
                            </button>
                          )}
                          <button
                            className="inventory-adjust-button inventory-move-button"
                            disabled={savingBulkStock}
                            onClick={() => openMoveStock(product)}
                            type="button"
                          >
                            <Icon name="movement" size={14} />
                            Move
                          </button>
                          <button
                            className="inventory-adjust-button"
                            disabled={savingBulkStock}
                            onClick={() => openEditStock(product)}
                            type="button"
                          >
                            <Icon name="edit" size={14} />
                            Adjust
                          </button>
                          <button
                            className="inventory-add-button"
                            disabled={savingBulkStock}
                            onClick={() => openAddStock(product)}
                            type="button"
                          >
                            <Icon name="plus" size={14} />
                            Add stock
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

      <section
        className={`inventory-panel inventory-movements-panel ${
          showMovements ? "is-open" : ""
        }`}
      >
        <div className="inventory-panel-header inventory-collapsible-header">
          <div>
            <h2>Stock movement history</h2>
            <p>
              {filteredMovements.length} of {movements.length} records shown
            </p>
          </div>
          <button
            aria-controls="inventory-movement-history"
            aria-expanded={showMovements}
            className="inventory-collapse-button"
            onClick={() => setShowMovements((current) => !current)}
            type="button"
          >
            {showMovements ? "Hide" : "Show"}
            <Icon name="chevron" size={16} />
          </button>
          {showMovements && (
            <div className="inventory-toolbar">
            <label className="inventory-search-box">
              <Icon name="search" size={17} />
              <input
                aria-label="Search stock movements"
                onChange={(event) => setMovementSearch(event.target.value)}
                placeholder="Search article, source, or reference"
                value={movementSearch}
              />
            </label>
            <select
              aria-label="Filter by movement type"
              onChange={(event) => setMovementFilter(event.target.value)}
              value={movementFilter}
            >
              <option value="all">All movements</option>
              {movementTypes.map((movementType) => (
                <option key={movementType} value={movementType}>
                  {movementType}
                </option>
              ))}
            </select>
          </div>
          )}
        </div>

        {showMovements && (
          <div id="inventory-movement-history">
            {initialLoading ? (
              <div className="inventory-loading-list" aria-label="Loading movements">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="inventory-loading-row" key={index} />
            ))}
          </div>
            ) : filteredMovements.length === 0 ? (
              <div className="inventory-empty-state is-compact">
            <div>
              <Icon name="movement" size={24} />
            </div>
            <h3>No movement records found</h3>
            <p>New stock updates will appear here automatically.</p>
          </div>
            ) : (
              <div className="inventory-table-wrap">
            <table className="inventory-movements-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Movement</th>
                  <th>Quantity</th>
                  <th>Source</th>
                  <th>Supplier</th>
                  <th>Unit cost</th>
                  <th>Reference</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((movement) => {
                  const product =
                    productsById.get(movement.product_id) || null;
                  const imageUrl =
                    movement.product_image_url || product?.image_url;

                  return (
                    <tr key={movement.id}>
                      <td data-label="Date">
                        <span className="inventory-movement-date">
                          {formatUtcLocal(movement.created_at)}
                        </span>
                      </td>
                      <td
                        className="inventory-movement-product"
                        data-label="Product"
                      >
                        {imageUrl ? (
                          <img loading="lazy" decoding="async"
                            alt={movement.product_name || movement.article_no}
                            src={getImageUrl(imageUrl)}
                          />
                        ) : (
                          <span>
                            <Icon name="image" size={15} />
                          </span>
                        )}
                        <strong>{movement.article_no || "-"}</strong>
                      </td>
                      <td data-label="Movement">
                        <span
                          className={`inventory-movement-pill is-${getMovementTone(
                            movement.movement_type
                          )}`}
                        >
                          {movement.movement_type || "Movement"}
                        </span>
                      </td>
                      <td data-label="Quantity">
                        <strong className="inventory-movement-quantity">
                          {formatNumber(movement.quantity)}
                        </strong>
                      </td>
                      <td data-label="Source">{movement.source || "-"}</td>
                      <td data-label="Supplier">
                        {movement.supplier_name || "-"}
                      </td>
                      <td data-label="Unit cost">
                        {Number(movement.purchase_price || 0) > 0
                          ? formatCurrency(movement.purchase_price)
                          : "-"}
                      </td>
                      <td data-label="Reference">
                        <span className="inventory-reference">
                          {movement.reference || "-"}
                        </span>
                      </td>
                      <td className="inventory-note-cell" data-label="Note">
                        <span title={movement.note || ""}>
                          {movement.note || "-"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            )}
          </div>
        )}
      </section>

      {movingProduct && (
        <div
          className="inventory-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMoveStock();
          }}
        >
          <div
            aria-labelledby="inventory-move-title"
            aria-modal="true"
            className="inventory-modal"
            role="dialog"
          >
            <div className="inventory-modal-header">
              <div>
                <span className="inventory-section-label">Location transfer</span>
                <h2 id="inventory-move-title">Move inventory</h2>
                <p>
                  {movingProduct.article_no} - {movingProduct.category || "Uncategorized"}
                </p>
              </div>
              <button
                aria-label="Close inventory move"
                className="inventory-modal-close"
                disabled={saving}
                onClick={closeMoveStock}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form className="inventory-modal-form" onSubmit={saveStockMove}>
              <div className="inventory-modal-content">
                <div className="inventory-modal-intro">
                  <div className="inventory-modal-product">
                    {movingProduct.image_url ? (
                      <img loading="lazy" decoding="async"
                        alt={movingProduct.article_no || "Product"}
                        src={getImageUrl(movingProduct.image_url)}
                      />
                    ) : (
                      <span>
                        <Icon name="image" size={22} />
                      </span>
                    )}
                    <div>
                      <strong>{movingProduct.article_no}</strong>
                      <small>
                        PK {formatNumber(movingProduct.factory_stock)} / USA{" "}
                        {formatNumber(movingProduct.usa_stock)} / Front Room{" "}
                        {formatNumber(movingProduct.front_room_stock)}
                      </small>
                    </div>
                  </div>
                  <div className="inventory-projected-balance">
                    <span>Source after move</span>
                    <strong>
                      {formatNumber(
                        Math.max(
                          moveSourceBalance - Number(moveStockForm.quantity || 0),
                          0
                        )
                      )}
                    </strong>
                  </div>
                </div>

                <div className="inventory-field-grid is-three-column">
                  <label className="inventory-field">
                    <span>Move from</span>
                    <select
                      name="source_stock"
                      onChange={handleMoveStockChange}
                      value={moveStockForm.source_stock}
                    >
                      {INVENTORY_LOCATIONS.map((location) => (
                        <option key={location.key} value={location.key}>
                          {location.label} ({formatNumber(movingProduct[location.key])})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inventory-field">
                    <span>Move to</span>
                    <select
                      name="destination_stock"
                      onChange={handleMoveStockChange}
                      value={moveStockForm.destination_stock}
                    >
                      {INVENTORY_LOCATIONS.filter(
                        (location) => location.key !== moveStockForm.source_stock
                      ).map((location) => (
                        <option key={location.key} value={location.key}>
                          {location.label} ({formatNumber(movingProduct[location.key])})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inventory-field">
                    <span>Quantity</span>
                    <input
                      max={moveSourceBalance}
                      min="1"
                      name="quantity"
                      onChange={handleMoveStockChange}
                      required
                      type="number"
                      value={moveStockForm.quantity}
                    />
                    <small>{formatNumber(moveSourceBalance)} available to move</small>
                  </label>
                </div>

                <div className="inventory-modal-intro">
                  <div className="inventory-projected-balance">
                    <span>Destination after move</span>
                    <strong>
                      {formatNumber(
                        moveDestinationBalance + Number(moveStockForm.quantity || 0)
                      )}
                    </strong>
                  </div>
                  <span className="inventory-adjustment-hint">
                    Total inventory stays unchanged
                  </span>
                </div>

                <label className="inventory-field">
                  <span>Note</span>
                  <textarea
                    name="note"
                    onChange={handleMoveStockChange}
                    placeholder="Optional transfer or shipment detail"
                    rows="3"
                    value={moveStockForm.note}
                  />
                </label>
              </div>

              <div className="inventory-modal-footer">
                <button
                  className="inventory-secondary-button"
                  disabled={saving}
                  onClick={closeMoveStock}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inventory-primary-button"
                  disabled={saving || moveSourceBalance <= 0}
                  type="submit"
                >
                  <Icon name="movement" size={17} />
                  {saving ? "Moving" : "Move inventory"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingProduct && (
        <div
          className="inventory-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditStock();
          }}
        >
          <div
            aria-labelledby="inventory-adjust-title"
            aria-modal="true"
            className="inventory-modal"
            role="dialog"
          >
            <div className="inventory-modal-header">
              <div>
                <span className="inventory-section-label">Manual correction</span>
                <h2 id="inventory-adjust-title">Adjust stock levels</h2>
                <p>
                  {editingProduct.article_no} ·{" "}
                  {editingProduct.category || "Uncategorized"}
                </p>
              </div>
              <button
                aria-label="Close stock adjustment"
                className="inventory-modal-close"
                disabled={saving}
                onClick={closeEditStock}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form className="inventory-modal-form" onSubmit={saveStockUpdate}>
              <div className="inventory-modal-content">
                <div className="inventory-modal-intro">
                  <div className="inventory-modal-product">
                    {editingProduct.image_url ? (
                      <img loading="lazy" decoding="async"
                        alt={editingProduct.article_no || "Product"}
                        src={getImageUrl(editingProduct.image_url)}
                      />
                    ) : (
                      <span>
                        <Icon name="image" size={22} />
                      </span>
                    )}
                    <div>
                      <strong>{editingProduct.article_no}</strong>
                      <small>Enter the corrected balances below.</small>
                    </div>
                  </div>
                  <span className="inventory-adjustment-hint">
                    Changes create movement records
                  </span>
                </div>

                <div className="inventory-field-grid inventory-pk-adjust-grid">
                  <label className="inventory-field">
                    <span>PK stock</span>
                    <input
                      min="0"
                      name="factory_stock"
                      onChange={handleStockChange}
                      type="number"
                      value={editStockForm.factory_stock}
                    />
                  </label>
                </div>

                <label className="inventory-field">
                  <span>Reason or note</span>
                  <textarea
                    name="update_note"
                    onChange={handleStockChange}
                    placeholder="Explain why these balances are changing"
                    rows="3"
                    value={editStockForm.update_note}
                  />
                </label>
              </div>

              <div className="inventory-modal-footer">
                <button
                  className="inventory-secondary-button"
                  disabled={saving}
                  onClick={closeEditStock}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inventory-primary-button"
                  disabled={saving}
                  type="submit"
                >
                  <Icon name="check" size={17} />
                  {saving ? "Saving" : "Save adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addStockOpen && (
        <div
          className="inventory-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddStock();
          }}
        >
          <div
            aria-labelledby="inventory-add-title"
            aria-modal="true"
            className="inventory-modal"
            role="dialog"
          >
            <div className="inventory-modal-header">
              <div>
                <span className="inventory-section-label">Receive inventory</span>
                <h2 id="inventory-add-title">Add stock</h2>
                <p>
                  {addingProduct
                    ? `${addingProduct.article_no} - ${
                        addingProduct.category || "Uncategorized"
                      }`
                    : addStockForm.item_mode === "custom"
                      ? "Create a custom item and receive stock."
                      : "Choose a catalog item to receive stock."}
                </p>
              </div>
              <button
                aria-label="Close add stock form"
                className="inventory-modal-close"
                disabled={saving}
                onClick={closeAddStock}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form className="inventory-modal-form" onSubmit={saveAddStock}>
              <div className="inventory-modal-content">
                <div
                  aria-label="Stock item type"
                  className="inventory-item-mode"
                  role="group"
                >
                  <button
                    className={`inventory-mode-button ${
                      addStockForm.item_mode === "existing" ? "is-active" : ""
                    }`}
                    onClick={() =>
                      setAddStockForm((current) => ({
                        ...current,
                        item_mode: "existing",
                      }))
                    }
                    type="button"
                  >
                    Catalog item
                  </button>
                  <button
                    className={`inventory-mode-button ${
                      addStockForm.item_mode === "custom" ? "is-active" : ""
                    }`}
                    onClick={() =>
                      setAddStockForm((current) => ({
                        ...current,
                        item_mode: "custom",
                        product_id: "",
                      }))
                    }
                    type="button"
                  >
                    Custom item
                  </button>
                </div>

                {addStockForm.item_mode === "existing" ? (
                  <div className="inventory-product-picker">
                    <label className="inventory-search-box inventory-product-search">
                      <Icon name="search" size={16} />
                      <input
                        aria-label="Search products to receive stock"
                        onChange={(event) => setAddProductSearch(event.target.value)}
                        placeholder="Search SKU or category"
                        value={addProductSearch}
                      />
                    </label>
                    {filteredAddProducts.length > 0 ? (
                      <div className="inventory-product-options">
                        {filteredAddProducts.map((product) => (
                          <button
                            aria-pressed={Number(addStockForm.product_id) === product.id}
                            className={`inventory-product-option ${
                              Number(addStockForm.product_id) === product.id
                                ? "is-selected"
                                : ""
                            }`}
                            key={product.id}
                            onClick={() => selectAddStockProduct(product)}
                            type="button"
                          >
                            {product.image_url ? (
                              <img loading="lazy" decoding="async"
                                alt={product.article_no || "Product"}
                                src={getImageUrl(product.image_url)}
                              />
                            ) : (
                              <span>
                                <Icon name="image" size={18} />
                              </span>
                            )}
                            <span className="inventory-product-option-copy">
                              <strong>{product.article_no || "No SKU"}</strong>
                              <small>{product.category || "Uncategorized"}</small>
                              <em>
                                PK {formatNumber(product.factory_stock)} · USA{" "}
                                {formatNumber(product.usa_stock)} · Front Room{" "}
                                {formatNumber(product.front_room_stock)}
                              </em>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="inventory-product-empty">
                        {products.length
                          ? "No products match this search."
                          : "No products found. Use Custom item to create one here."}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="inventory-custom-item-panel">
                    <div className="inventory-field-grid">
                      <label className="inventory-field">
                        <span>Custom SKU</span>
                        <input
                          name="custom_article_no"
                          onChange={handleAddStockChange}
                          placeholder="Article or SKU"
                          value={addStockForm.custom_article_no}
                        />
                      </label>
                      <label className="inventory-field">
                        <span>Item name</span>
                        <input
                          name="custom_name"
                          onChange={handleAddStockChange}
                          placeholder="Product, part, or thing"
                          value={addStockForm.custom_name}
                        />
                      </label>
                      <label className="inventory-field">
                        <span>Category</span>
                        <input
                          name="custom_category"
                          onChange={handleAddStockChange}
                          placeholder="Optional"
                          value={addStockForm.custom_category}
                        />
                      </label>
                      <label className="inventory-field">
                        <span>Product image</span>
                        <input
                          accept="image/*"
                          name="custom_image_file"
                          onChange={handleAddStockChange}
                          type="file"
                        />
                      </label>
                    </div>
                  </div>
                )}

                <div className="inventory-modal-intro">
                  <div className="inventory-modal-product">
                    {addingProduct?.image_url ? (
                      <img loading="lazy" decoding="async"
                        alt={addingProduct.article_no || "Product"}
                        src={getImageUrl(addingProduct.image_url)}
                      />
                    ) : (
                      <span>
                        <Icon name="image" size={22} />
                      </span>
                    )}
                    <div>
                      <strong>
                        {addingProduct?.article_no ||
                          addStockForm.custom_article_no ||
                          "Select item"}
                      </strong>
                      <small>
                        {addingProduct
                          ? `${addingProduct.category || "Uncategorized"} · Available ${formatNumber(
                              addingProduct.available_stock
                            )}`
                          : addStockForm.item_mode === "custom"
                            ? addStockForm.custom_name || "New custom item"
                            : "Choose a catalog item above"}
                      </small>
                    </div>
                  </div>
                  <div className="inventory-projected-balance">
                    <span>New location balance</span>
                    <strong>{formatNumber(projectedStock)}</strong>
                  </div>
                </div>

                <div className="inventory-field-grid">
                  <label className="inventory-field">
                    <span>Add to</span>
                    <select
                      name="stock_type"
                      onChange={handleAddStockChange}
                      value={addStockForm.stock_type}
                    >
                      <option value="factory_stock">PK stock</option>
                      <option value="usa_stock">USA stock</option>
                      <option value="front_room_stock">Front Room stock</option>
                    </select>
                  </label>
                  <label className="inventory-field">
                    <span>Quantity</span>
                    <input
                      min="1"
                      name="quantity"
                      onChange={handleAddStockChange}
                      placeholder="0"
                      required
                      type="number"
                      value={addStockForm.quantity}
                    />
                  </label>
                  <label className="inventory-field">
                    <span>Source</span>
                    <select
                      name="source_type"
                      onChange={handleAddStockChange}
                      value={addStockForm.source_type}
                    >
                      <option value="factory">Manufactured in Pakistan</option>
                      <option value="supplier">Purchased from supplier</option>
                    </select>
                  </label>
                </div>

                {addStockForm.source_type === "supplier" && (
                  <div className="inventory-supplier-fields">
                    <div className="inventory-supplier-heading">
                      <Icon name="truck" size={17} />
                      <div>
                        <strong>Supplier purchase</strong>
                        <small>Supplier and unit cost are required.</small>
                      </div>
                    </div>
                    <div className="inventory-field-grid">
                      <label className="inventory-field">
                        <span>Supplier</span>
                        <select
                          name="supplier_id"
                          onChange={handleAddStockChange}
                          required
                          value={addStockForm.supplier_id}
                        >
                          <option value="">Choose supplier</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="inventory-field">
                        <span>Purchase price per unit</span>
                        <div className="inventory-input-prefix">
                          <span>Rs.</span>
                          <input
                            min="0.01"
                            name="purchase_price"
                            onChange={handleAddStockChange}
                            required
                            step="0.01"
                            type="number"
                            value={addStockForm.purchase_price}
                          />
                        </div>
                      </label>
                    </div>
                    <div className="inventory-price-history">
                      <div className="inventory-price-history-main">
                        <span>
                          Previous purchase price
                          {selectedSupplier ? ` from ${selectedSupplier.name}` : ""}
                        </span>
                        {latestAddStockPurchase ? (
                          <>
                            <strong>
                              PKR {formatCurrency(latestAddStockPurchase.purchase_price)}
                            </strong>
                            <small>
                              {formatNumber(latestAddStockPurchase.quantity)} units on{" "}
                              {formatUtcLocal(latestAddStockPurchase.created_at)}
                            </small>
                          </>
                        ) : (
                          <strong>Not recorded yet</strong>
                        )}
                      </div>
                      {latestAddStockPurchase && (
                        <button
                          className="inventory-use-price-button"
                          onClick={useLatestAddStockPurchasePrice}
                          type="button"
                        >
                          Use price
                        </button>
                      )}
                      <div className="inventory-line-total">
                        <span>Line total</span>
                        <strong>PKR {formatCurrency(addStockLineTotal)}</strong>
                      </div>
                    </div>
                  </div>
                )}

                <label className="inventory-field">
                  <span>Note</span>
                  <textarea
                    name="note"
                    onChange={handleAddStockChange}
                    placeholder="Shipment, batch, or receiving details"
                    rows="3"
                    value={addStockForm.note}
                  />
                </label>
              </div>

              <div className="inventory-modal-footer">
                <button
                  className="inventory-secondary-button"
                  disabled={saving}
                  onClick={closeAddStock}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inventory-primary-button"
                  disabled={saving}
                  type="submit"
                >
                  <Icon name="plus" size={17} />
                  {saving ? "Adding" : "Add stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inventory;
