import { useEffect, useMemo, useRef, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import "./Suppliers.css";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const getImageUrl = getStaticUrl;

const getInitials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "S";

const getActiveFaultyQuantity = (movement = {}) => {
  if (!movement.faulty) return 0;

  const quantity = Math.max(Number(movement.quantity || 0), 0);
  const faultyQuantity = Math.max(Number(movement.faulty_quantity || 0), 0);
  return Math.min(faultyQuantity, quantity);
};

const getPayableStockQuantity = (movement = {}) => {
  const quantity = Math.max(Number(movement.quantity || 0), 0);
  return Math.max(quantity - getActiveFaultyQuantity(movement), 0);
};

const createEmptySupplierForm = () => ({
  name: "",
  contact_person: "",
  email: "",
  phone: "",
  address: "",
});

const SUPPLY_CATEGORIES = [
  "Office Supplies",
  "Factory Supplies",
  "Accessories",
  "Packaging",
  "Tools",
  "Maintenance",
  "Miscellaneous",
];

const SUPPLY_USAGE_AREAS = [
  "Office",
  "Factory",
  "Fulfillment",
  "Warehouse",
  "General",
];

const createSupplierPurchaseLine = (products = [], lineType = "product") => ({
  line_type: lineType,
  product_id: products.length ? products[0].id : "",
  supply_sku: "",
  supply_name: "",
  supply_category: lineType === "supply" ? "Miscellaneous" : "Factory Supplies",
  supply_usage_area: lineType === "supply" ? "General" : "Factory",
  stock_type: "factory_stock",
  quantity: 1,
  purchase_price: "",
  note: "",
});

const createEmptySupplierStockForm = (products = []) => ({
  fulfillment_mode: "receive_now",
  order_item_id: null,
  order_reference: "",
  order_pending_quantity: 0,
  order_received_quantity: 0,
  order_ordered_quantity: 0,
  receive_completion: "complete",
  lines: [createSupplierPurchaseLine(products)],
  product_id: products.length ? products[0].id : null,
  stock_type: "factory_stock",
  purchase_price: "",
  quantity: 0,
  note: "",
});

const getSupplierOrderStatusClass = (status = "") =>
  String(status || "Ordered")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const supplierIdFromPath = () => {
  const match = window.location.pathname.match(
    /^\/portal\/suppliers\/(\d+)\/?$/
  );
  return match ? Number(match[1]) : null;
};

const PlusIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M10 4v12M4 10h12" />
  </svg>
);

const SearchIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="m12.2 12.2 4 4" />
  </svg>
);

const ArrowIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M4 10h11M11 6l4 4-4 4" />
  </svg>
);

const TrashIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
  </svg>
);

const CollapseIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M8.5 9.5L12 13l3.5-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      transform={open ? "rotate(180 12 11)" : "rotate(0 12 11)"}
    />
  </svg>
);

function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailSupplier, setDetailSupplier] = useState(null);
  const [form, setForm] = useState(createEmptySupplierForm);
  const [editingSupplierId, setEditingSupplierId] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_method: "",
    payment_reference: "",
    note: "",
  });
  const [loading, setLoading] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [stockVisibleCount, setStockVisibleCount] = useState(5);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [showStockHistory, setShowStockHistory] = useState(false);
  const [paymentSortAsc, setPaymentSortAsc] = useState(false);
  const [stockSortAsc, setStockSortAsc] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierStatus, setSupplierStatus] = useState("All");
  const [confirmDialog, setConfirmDialog] = useState({
    visible: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    onConfirm: null,
  });
  const [faultyModal, setFaultyModal] = useState({
    visible: false,
    movement: null,
    faulty_quantity: "",
    faulty_note: "",
  });
  const [stockEditModal, setStockEditModal] = useState({
    visible: false,
    movement: null,
    quantity: "",
    purchase_price: "",
    source: "",
    reference: "",
    note: "",
  });
  const [products, setProducts] = useState([]);
  const [supplierAddStockOpen, setSupplierAddStockOpen] = useState(false);
  const [supplierStockForm, setSupplierStockForm] = useState(() =>
    createEmptySupplierStockForm()
  );
  const [supplierStockSearch, setSupplierStockSearch] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const paymentAmountInputRef = useRef(null);
  const PAGE_SIZE = 5;

  const totalPayableBalance = suppliers.reduce(
    (sum, supplier) => sum + Math.max(supplier.balance_due || 0, 0),
    0
  );

  const totalAdvanceBalance = suppliers.reduce(
    (sum, supplier) => sum + Math.min(Number(supplier.balance_due || 0), 0),
    0
  );

  const totalPaymentsRecorded = suppliers.reduce(
    (sum, supplier) =>
      sum +
      (supplier.payments?.reduce(
        (paymentSum, payment) => paymentSum + Number(payment.amount || 0),
        0
      ) || 0),
    0
  );

  const suppliersPending = suppliers.filter(
    (supplier) => supplier.balance_status === "Pending"
  ).length;
  const filteredSuppliers = useMemo(() => {
    const query = supplierSearch.trim().toLowerCase();

    return suppliers.filter((supplier) => {
      const matchesSearch =
        !query ||
        [
          supplier.name,
          supplier.contact_person,
          supplier.email,
          supplier.phone,
          supplier.address,
        ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus =
        supplierStatus === "All" ||
        (supplier.balance_status || "Settled") === supplierStatus;

      return matchesSearch && matchesStatus;
    });
  }, [supplierSearch, supplierStatus, suppliers]);

  const selectedSupplierStockProduct = useMemo(
    () =>
      products.find(
        (product) => product.id === Number(supplierStockForm.product_id)
      ) || null,
    [products, supplierStockForm.product_id]
  );

  const filteredSupplierStockProducts = useMemo(() => {
    const query = supplierStockSearch.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) =>
      [product.article_no, product.name, product.category]
        .some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [products, supplierStockSearch]);

  const supplierPurchaseLines = useMemo(() => {
    const lines = Array.isArray(supplierStockForm.lines)
      ? supplierStockForm.lines
      : [];
    return lines.length ? lines : [createSupplierPurchaseLine(products)];
  }, [products, supplierStockForm.lines]);

  const supplierStockLineTotal =
    supplierStockForm.fulfillment_mode === "receive_order"
      ? Number(supplierStockForm.quantity || 0) *
        Number(supplierStockForm.purchase_price || 0)
      : supplierPurchaseLines.reduce(
          (total, line) =>
            total +
            Number(line.quantity || 0) * Number(line.purchase_price || 0),
          0
        );

  const sortByDate = (items = [], asc) => {
    return [...items].sort((a, b) => {
      const left = parseUtcLocal(a.payment_date || a.created_at)?.getTime() || 0;
      const right = parseUtcLocal(b.payment_date || b.created_at)?.getTime() || 0;
      return asc ? left - right : right - left;
    });
  };

  const markAsPaid = async () => {
    if (!detailSupplier) return;
    const amount = Number(detailSupplier.balance_due || 0);
    if (amount <= 0) {
      alert("No pending balance to mark as paid.");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/suppliers/${detailSupplier.id}/payments`, {
        amount,
        payment_method: "Balance Clearance",
        payment_reference: "AUTO_MARK_PAID",
        note: "Balance marked paid from supplier account view.",
      });

      setDetailSupplier(response.data);
      fetchSuppliers();
      alert("Account balance marked as paid.");
    } catch (error) {
      console.error("Mark as paid error:", error);
      alert(error.response?.data?.detail || "Could not mark account balance as paid.");
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const response = await api.get("/suppliers");
      setSuppliers(response.data);
      if (detailSupplier) {
        const updatedSupplier = response.data.find((supplier) => supplier.id === detailSupplier.id);
        if (updatedSupplier) {
          setDetailSupplier(updatedSupplier);
        }
      }
    } catch (error) {
      console.error("Suppliers error:", error);
      alert("Backend not connected or suppliers endpoint missing.");
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await api.get("/products");
      setProducts(response.data);
    } catch (error) {
      console.error("Products error:", error);
      setProducts([]);
    }
  };

  useEffect(() => {
    let active = true;

    Promise.all([api.get("/suppliers"), api.get("/products")])
      .then(([suppliersResponse, productsResponse]) => {
        if (!active) return;
        setSuppliers(
          Array.isArray(suppliersResponse.data) ? suppliersResponse.data : []
        );
        setProducts(
          Array.isArray(productsResponse.data) ? productsResponse.data : []
        );
      })
      .catch((error) => {
        console.error("Supplier dashboard loading error:", error);
        if (active) {
          alert("Supplier data could not be loaded. Check the backend connection.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncSupplierRoute = () => {
      const supplierId = supplierIdFromPath();

      if (!supplierId) {
        setShowDetails(false);
        setDetailSupplier(null);
        return;
      }

      const supplier = suppliers.find((item) => item.id === supplierId);
      if (!supplier) return;

      setDetailSupplier(supplier);
      setPaymentsPage(1);
      setStockVisibleCount(PAGE_SIZE);
      setShowPaymentHistory(false);
      setShowStockHistory(false);
      setShowPaymentForm(false);
      setEditingPaymentId(null);
      setShowDetails(true);
    };

    const frameId = window.requestAnimationFrame(syncSupplierRoute);
    window.addEventListener("popstate", syncSupplierRoute);
    window.addEventListener("erp:navigation", syncSupplierRoute);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("popstate", syncSupplierRoute);
      window.removeEventListener("erp:navigation", syncSupplierRoute);
    };
  }, [suppliers]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm({
      ...form,
      [name]: value,
    });
  };

  const openCreateSupplierForm = () => {
    setEditingSupplierId(null);
    setForm(createEmptySupplierForm());
    setShowForm(true);
  };

  const startEditSupplier = (supplier) => {
    setEditingSupplierId(supplier.id);
    setForm({
      name: supplier.name || "",
      contact_person: supplier.contact_person || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
    });
    setShowForm(true);
  };

  const handlePaymentChange = (event) => {
    const { name, value } = event.target;
    setPaymentForm({
      ...paymentForm,
      [name]: value,
    });
  };

  const saveSupplier = async (event) => {
    event.preventDefault();

    try {
      const payload = {
        name: form.name.trim(),
        contact_person: form.contact_person || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
      };
      const response = editingSupplierId
        ? await api.put(`/suppliers/${editingSupplierId}`, payload)
        : await api.post("/suppliers", payload);

      alert(
        editingSupplierId
          ? "Account updated successfully."
          : "Account added successfully."
      );
      setDetailSupplier((current) =>
        current?.id === response.data.id || !editingSupplierId
          ? response.data
          : current
      );
      if (!editingSupplierId) {
        setShowDetails(true);
        window.history.pushState(
          {},
          "",
          `/portal/suppliers/${response.data.id}`
        );
        window.dispatchEvent(new Event("erp:navigation"));
      }
      setShowForm(false);
      setEditingSupplierId(null);
      setForm(createEmptySupplierForm());
      fetchSuppliers();
    } catch (error) {
      console.error("Save supplier error:", error);
      alert(error.response?.data?.detail || "Account could not be saved.");
    }
  };

  const handleView = (supplier) => {
    setDetailSupplier(supplier);
    setPaymentsPage(1);
    setStockVisibleCount(PAGE_SIZE);
    setShowPaymentHistory(false);
    setShowStockHistory(false);
    setShowPaymentForm(false);
    setEditingPaymentId(null);
    setPaymentForm({
      amount: "",
      payment_method: "",
      payment_reference: "",
      note: "",
    });
    setShowDetails(true);
    window.history.pushState({}, "", `/portal/suppliers/${supplier.id}`);
    window.dispatchEvent(new Event("erp:navigation"));
  };

  const handleSupplierRowKeyDown = (event, supplier) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleView(supplier);
    }
  };

  const handleCancel = () => {
    setForm(createEmptySupplierForm());
    setEditingSupplierId(null);
    setShowForm(false);
  };

  const savePayment = async (event) => {
    event.preventDefault();
    if (!detailSupplier) return;

    try {
      let response;
      const payload = {
        amount: parseFloat(paymentForm.amount) || 0,
        payment_method: paymentForm.payment_method || null,
        payment_reference: paymentForm.payment_reference || null,
        note: paymentForm.note || null,
      };

      if (editingPaymentId) {
        response = await api.patch(`/suppliers/${detailSupplier.id}/payments/${editingPaymentId}`, payload);
      } else {
        response = await api.post(`/suppliers/${detailSupplier.id}/payments`, payload);
      }

      setDetailSupplier(response.data);
      setPaymentForm({
        amount: "",
        payment_method: "",
        payment_reference: "",
        note: "",
      });
      setEditingPaymentId(null);
      setShowPaymentForm(false);
      fetchSuppliers();
      alert(editingPaymentId ? "Payment updated successfully." : "Payment recorded successfully.");
    } catch (error) {
      console.error("Save payment error:", error);
      alert(error.response?.data?.detail || "Payment could not be recorded.");
    }
  };

  const startEditPayment = (payment) => {
    setPaymentForm({
      amount: payment.amount,
      payment_method: payment.payment_method || "",
      payment_reference: payment.payment_reference || "",
      note: payment.note || "",
    });
    setEditingPaymentId(payment.id);
    setShowPaymentForm(true);
  };

  const cancelEditPayment = () => {
    setPaymentForm({ amount: "", payment_method: "", payment_reference: "", note: "" });
    setEditingPaymentId(null);
    setShowPaymentForm(false);
  };

  const openPaymentForm = () => {
    setPaymentForm({
      amount: "",
      payment_method: "",
      payment_reference: "",
      note: "",
    });
    setEditingPaymentId(null);
    setShowPaymentForm(true);
  };

  const closePaymentForm = () => {
    setPaymentForm({
      amount: "",
      payment_method: "",
      payment_reference: "",
      note: "",
    });
    setEditingPaymentId(null);
    setShowPaymentForm(false);
  };

  const openSupplierLedgerPage = () => {
    if (!detailSupplier?.id) return;

    window.open(
      `${window.location.origin}/portal/suppliers/${detailSupplier.id}/ledger`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const openConfirmDialog = ({ title, message, confirmText = "Confirm", cancelText = "Cancel", onConfirm }) => {
    setConfirmDialog({
      visible: true,
      title,
      message,
      confirmText,
      cancelText,
      onConfirm,
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog({
      visible: false,
      title: "",
      message: "",
      confirmText: "Confirm",
      cancelText: "Cancel",
      onConfirm: null,
    });
  };

  const runConfirmAction = async () => {
    if (confirmDialog.onConfirm) {
      await confirmDialog.onConfirm();
    }
    closeConfirmDialog();
  };

  const deletePayment = (payment) => {
    if (!detailSupplier) return;
    openConfirmDialog({
      title: "Delete Payment",
      message: `Delete payment of ${payment.amount}? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          const response = await api.delete(`/suppliers/${detailSupplier.id}/payments/${payment.id}`);
          setDetailSupplier(response.data);
          fetchSuppliers();
          alert("Payment deleted.");
        } catch (error) {
          console.error("Delete payment error:", error);
          alert(error.response?.data?.detail || "Could not delete payment.");
        }
      },
    });
  };

  const deleteSupplier = (supplierId) => {
    openConfirmDialog({
      title: "Delete Account",
      message: "Delete this account and all related records?",
      confirmText: "Delete Account",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          await api.delete(`/suppliers/${supplierId}`);
          fetchSuppliers();
          if (detailSupplier?.id === supplierId) {
            closeDetails();
          }
          alert("Account deleted successfully.");
        } catch (error) {
          console.error("Delete supplier error:", error);
          alert(error.response?.data?.detail || "Could not delete account.");
        }
      },
    });
  };

  const updateStockMovement = async (movementId, payload) => {
    try {
      const response = await api.patch(`/stock-movements/${movementId}`, payload);
      await Promise.all([fetchSuppliers(), fetchProducts()]);
      alert("Stock movement and inventory balance updated.");
      return response.data;
    } catch (error) {
      console.error("Update stock movement error:", error);
      alert(error.response?.data?.detail || "Could not update stock movement.");
      return null;
    }
  };

  const openFaultyModal = (movement) => {
    setFaultyModal({
      visible: true,
      movement,
      faulty_quantity: movement.faulty_quantity ? String(movement.faulty_quantity) : String(movement.quantity),
      faulty_note: movement.faulty_note || "",
    });
  };

  const closeFaultyModal = () => {
    setFaultyModal({
      visible: false,
      movement: null,
      faulty_quantity: "",
      faulty_note: "",
    });
  };

  const openStockEditModal = (movement) => {
    setStockEditModal({
      visible: true,
      movement,
      quantity: String(movement.quantity || ""),
      purchase_price: movement.purchase_price != null ? String(movement.purchase_price) : "",
      source: movement.source || "",
      reference: movement.reference || "",
      note: movement.note || "",
    });
  };

  const closeStockEditModal = () => {
    setStockEditModal({
      visible: false,
      movement: null,
      quantity: "",
      purchase_price: "",
      source: "",
      reference: "",
      note: "",
    });
  };

  const handleStockEditChange = (event) => {
    const { name, value } = event.target;
    setStockEditModal((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const openSupplierStockModal = () => {
    setSupplierStockForm({
      ...createEmptySupplierStockForm(products),
      fulfillment_mode: "receive_now",
    });
    setSupplierStockSearch("");
    setSupplierAddStockOpen(true);
  };

  const openSupplierOrderModal = () => {
    setSupplierStockForm({
      ...createEmptySupplierStockForm(products),
      fulfillment_mode: "order",
    });
    setSupplierStockSearch("");
    setSupplierAddStockOpen(true);
  };

  const openReceiveOrderModal = (orderItem) => {
    if (!orderItem) return;
    const quantity = Math.max(
      Number(orderItem.pending_quantity || 0),
      Number(orderItem.pending_quantity || 0) > 0 ? 1 : 0
    );

    setSupplierStockForm({
      ...createEmptySupplierStockForm(products),
      fulfillment_mode: "receive_order",
      order_item_id: orderItem.id,
      order_reference: orderItem.reference || "",
      order_pending_quantity: Number(orderItem.pending_quantity || 0),
      order_received_quantity: Number(orderItem.received_quantity || 0),
      order_ordered_quantity: Number(orderItem.ordered_quantity || 0),
      receive_completion: "complete",
      product_id: orderItem.product_id,
      stock_type: orderItem.stock_type || "factory_stock",
      purchase_price:
        orderItem.purchase_price != null ? String(orderItem.purchase_price) : "",
      quantity: quantity || 1,
      note: "",
    });
    setSupplierStockSearch("");
    setSupplierAddStockOpen(true);
  };

  const removeSupplierOrderItem = (orderItem) => {
    if (!detailSupplier || !orderItem) return;

    openConfirmDialog({
      title: "Remove Ordered Item",
      message: `Remove ${orderItem.article_no || "this item"} from the active order queue? Stock already received will stay recorded.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          const response = await api.delete(
            `/suppliers/${detailSupplier.id}/ordered-items/${orderItem.id}`
          );
          setDetailSupplier(response.data);
          fetchSuppliers();
          alert("Ordered item removed from queue.");
        } catch (error) {
          console.error("Remove supplier order item error:", error);
          alert(error.response?.data?.detail || "Could not remove ordered item.");
        }
      },
    });
  };

  const closeSupplierStockModal = () => {
    setSupplierAddStockOpen(false);
    setSupplierStockForm(createEmptySupplierStockForm());
    setSupplierStockSearch("");
  };

  const handleSupplierStockChange = (event) => {
    const { name, value, files, type } = event.target;
    setSupplierStockForm((prev) => {
      return {
        ...prev,
        [name]:
          type === "file"
            ? files?.[0] || null
            : name === "quantity"
              ? Number(value)
              : name === "product_id"
                ? value === ""
                  ? ""
                  : Number(value)
                : value,
      };
    });
  };

  const addSupplierPurchaseLine = () => {
    setSupplierStockForm((prev) => ({
      ...prev,
      lines: [
        ...(Array.isArray(prev.lines) ? prev.lines : []),
        createSupplierPurchaseLine(products, "product"),
      ],
    }));
  };

  const removeSupplierPurchaseLine = (lineIndex) => {
    setSupplierStockForm((prev) => {
      const lines = Array.isArray(prev.lines) ? prev.lines : [];
      return {
        ...prev,
        lines:
          lines.length <= 1
            ? lines
            : lines.filter((_, index) => index !== lineIndex),
      };
    });
  };

  const updateSupplierPurchaseLine = (lineIndex, field, value) => {
    setSupplierStockForm((prev) => ({
      ...prev,
      lines: (Array.isArray(prev.lines) ? prev.lines : []).map((line, index) => {
        if (index !== lineIndex) return line;

        if (field === "line_type") {
          return {
            ...createSupplierPurchaseLine(products, value),
            quantity: line.quantity || 1,
            purchase_price: line.purchase_price || "",
            note: line.note || "",
          };
        }

        return {
          ...line,
          [field]:
            field === "quantity"
              ? Number(value)
              : field === "product_id"
                ? value === ""
                  ? ""
                  : Number(value)
                : value,
        };
      }),
    }));
  };

  const getSupplierLineProduct = (line) =>
    products.find((product) => product.id === Number(line.product_id)) || null;

  const getSupplierLineProductHistory = (productId) => {
    if (!detailSupplier || !productId) return [];

    return (detailSupplier.stock_movements || [])
      .filter(
        (movement) =>
          Number(movement.product_id) === Number(productId) &&
          movement.movement_type === "Supplier Purchase" &&
          Number(movement.purchase_price || 0) > 0
      )
      .sort(
        (left, right) =>
          (parseUtcLocal(right.created_at)?.getTime() || 0) -
          (parseUtcLocal(left.created_at)?.getTime() || 0)
      );
  };

  const applyLatestLinePurchasePrice = (lineIndex, productId) => {
    const latest = getSupplierLineProductHistory(productId)[0];
    if (!latest) return;
    updateSupplierPurchaseLine(
      lineIndex,
      "purchase_price",
      String(latest.purchase_price || "")
    );
  };

  const saveSupplierStock = async () => {
    const mode = supplierStockForm.fulfillment_mode || "receive_now";

    setLoading(true);
    try {
      if (mode === "receive_order" && supplierStockForm.order_item_id) {
        const quantity = Number(supplierStockForm.quantity);
        const purchasePrice = Number(supplierStockForm.purchase_price);
        if (quantity <= 0) {
          alert("Enter a valid received quantity.");
          return;
        }
        if (Number.isNaN(purchasePrice) || purchasePrice <= 0) {
          alert("Enter a valid purchase price.");
          return;
        }

        const response = await api.post(
          `/suppliers/${detailSupplier.id}/ordered-items/${supplierStockForm.order_item_id}/receive`,
          {
            received_quantity: quantity,
            purchase_price: purchasePrice,
            stock_type: supplierStockForm.stock_type,
            complete_order: supplierStockForm.receive_completion === "complete",
            note: supplierStockForm.note || null,
          }
        );

        setDetailSupplier(response.data);
        alert("Ordered stock received and added to inventory.");
        closeSupplierStockModal();
        fetchProducts();
        fetchSuppliers();
        return;
      }

      const lines = supplierPurchaseLines.map((line) => ({
        ...line,
        quantity: Number(line.quantity || 0),
        purchase_price: Number(line.purchase_price || 0),
      }));

      if (!lines.length) {
        alert("Add at least one purchase line.");
        return;
      }

      const productLines = lines.filter((line) => line.line_type === "product");
      const supplyLines = lines.filter((line) => line.line_type === "supply");

      if (mode === "order" && supplyLines.length) {
        alert("Supplier order mode is for catalog products. Use Add purchase for supplies and accessories.");
        return;
      }

      for (const line of productLines) {
        if (!line.product_id) {
          alert("Select a catalog product for every product line.");
          return;
        }
        if (line.quantity <= 0) {
          alert("Enter a valid quantity for every product line.");
          return;
        }
        if (Number.isNaN(line.purchase_price) || line.purchase_price <= 0) {
          alert("Enter a valid purchase price for every product line.");
          return;
        }
        const product = products.find((item) => item.id === Number(line.product_id));
        if (!product) {
          alert("One selected product was not found. Refresh and try again.");
          return;
        }
      }

      for (const line of supplyLines) {
        if (!String(line.supply_name || "").trim()) {
          alert("Enter an item name for every supplies/accessories line.");
          return;
        }
        if (line.quantity <= 0) {
          alert("Enter a valid quantity for every supplies/accessories line.");
          return;
        }
        if (Number.isNaN(line.purchase_price) || line.purchase_price <= 0) {
          alert("Enter a valid unit price for every supplies/accessories line.");
          return;
        }
      }

      if (mode === "order") {
        let response = null;
        for (const line of productLines) {
          const product = products.find((item) => item.id === Number(line.product_id));
          response = await api.post(
            `/suppliers/${detailSupplier.id}/ordered-items`,
            {
              product_id: Number(line.product_id),
              ordered_quantity: line.quantity,
              purchase_price: line.purchase_price,
              stock_type: line.stock_type,
              reference: product?.article_no || null,
              note: line.note || null,
            }
          );
        }

        if (response?.data) setDetailSupplier(response.data);
        alert(`${productLines.length} supplier order line${productLines.length === 1 ? "" : "s"} saved. Stock was not added yet.`);
        closeSupplierStockModal();
        fetchProducts();
        fetchSuppliers();
        return;
      }

      for (const line of productLines) {
        const formData = new FormData();
        const deltaField = {
          factory_stock: "factory_delta",
          usa_stock: "usa_delta",
          reserved_stock: "reserved_delta",
        }[line.stock_type];
        formData.append(deltaField, line.quantity);
        formData.append("source_type", "supplier");
        formData.append("supplier_id", detailSupplier.id);
        formData.append("purchase_price", line.purchase_price);
        formData.append(
          "update_note",
          `Added ${line.quantity} units from account ${detailSupplier.name} to ${String(line.stock_type).replace("_", " ")}. ${line.note || ""}`
        );

        await api.patch(`/products/${line.product_id}/update-stock`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      if (supplyLines.length) {
        const response = await api.post(
          `/suppliers/${detailSupplier.id}/supply-items`,
          {
            items: supplyLines.map((line) => ({
              sku: String(line.supply_sku || "").trim() || null,
              item_name: String(line.supply_name || "").trim(),
              category: String(line.supply_category || "Miscellaneous").trim(),
              usage_area: String(line.supply_usage_area || "General").trim(),
              quantity: line.quantity,
              unit_price: line.purchase_price,
              note: line.note || null,
            })),
          }
        );
        setDetailSupplier(response.data);
      }

      alert(`${lines.length} purchase line${lines.length === 1 ? "" : "s"} saved successfully.`);
      closeSupplierStockModal();
      fetchProducts();
      fetchSuppliers();
    } catch (error) {
      console.error("Supplier add stock error:", error);
      alert(error.response?.data?.detail || "Failed to save account purchase.");
    } finally {
      setLoading(false);
    }
  };

  const submitStockEditModal = async () => {
    if (!stockEditModal.movement) return;
    const quantity = Number(stockEditModal.quantity);
    const purchase_price = Number(stockEditModal.purchase_price);
    if (Number.isNaN(quantity) || quantity < 1) {
      alert("Enter a valid quantity.");
      return;
    }
    if (Number.isNaN(purchase_price) || purchase_price < 0) {
      alert("Enter a valid unit price.");
      return;
    }

    await updateStockMovement(stockEditModal.movement.id, {
      quantity,
      purchase_price,
      source: stockEditModal.source || null,
      reference: stockEditModal.reference || null,
      note: stockEditModal.note || null,
    });
    closeStockEditModal();
  };

  const handleFaultyModalChange = (event) => {
    const { name, value } = event.target;
    setFaultyModal((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const submitFaultyModal = async () => {
    if (!faultyModal.movement) return;
    const totalQty = faultyModal.movement.quantity;
    const faultyQty = Number(faultyModal.faulty_quantity);
    if (Number.isNaN(faultyQty) || faultyQty < 1) {
      alert("Enter a valid faulty quantity.");
      return;
    }
    if (faultyQty > totalQty) {
      alert(`Faulty quantity cannot exceed total quantity (${totalQty}).`);
      return;
    }

    await updateStockMovement(faultyModal.movement.id, {
      faulty: true,
      faulty_quantity: faultyQty,
      faulty_note: faultyModal.faulty_note || null,
    });
    closeFaultyModal();
  };

  const markStockMovementFaulty = (movement) => {
    openFaultyModal(movement);
  };

  const clearStockMovementFaulty = (movement) => {
    openConfirmDialog({
      title: "Clear Faulty Status",
      message: "Remove faulty status from this stock movement?",
      confirmText: "Clear Faulty",
      cancelText: "Cancel",
      onConfirm: async () => {
        await updateStockMovement(movement.id, {
          faulty: false,
          faulty_quantity: 0,
          faulty_note: null,
        });
      },
    });
  };

  const deleteStockMovement = (movement) => {
    openConfirmDialog({
      title: "Delete Stock Movement",
      message: "Delete this purchase record and reverse its usable quantity from inventory? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          await api.delete(`/stock-movements/${movement.id}`);
          await Promise.all([fetchSuppliers(), fetchProducts()]);
          alert("Stock movement deleted and inventory balance reversed.");
        } catch (error) {
          console.error("Delete stock movement error:", error);
          alert(error.response?.data?.detail || "Could not delete stock movement.");
        }
      },
    });
  };

  const deleteSupplyItem = (item) => {
    if (!detailSupplier || !item) return;

    openConfirmDialog({
      title: "Delete Supply Item",
      message: `Delete ${item.item_name || "this supply item"} from this account?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          const response = await api.delete(
            `/suppliers/${detailSupplier.id}/supply-items/${item.id}`
          );
          setDetailSupplier(response.data);
          fetchSuppliers();
          alert("Supply item deleted.");
        } catch (error) {
          console.error("Delete supply item error:", error);
          alert(error.response?.data?.detail || "Could not delete supply item.");
        }
      },
    });
  };

  const closeDetails = () => {
    if (window.location.pathname !== "/portal/suppliers") {
      window.history.pushState({}, "", "/portal/suppliers");
      window.dispatchEvent(new Event("erp:navigation"));
    }
    setShowDetails(false);
    setDetailSupplier(null);
    setShowPaymentForm(false);
    setEditingPaymentId(null);
    setPaymentForm({
      amount: "",
      payment_method: "",
      payment_reference: "",
      note: "",
    });
  };

  useEffect(() => {
    if (showPaymentForm) {
      paymentAmountInputRef.current?.focus();
    }
  }, [showPaymentForm]);

  const detailPaymentsTotal =
    detailSupplier?.payments?.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0
    ) || 0;
  const detailStockPurchasesTotal =
    detailSupplier?.stock_movements?.reduce(
      (sum, movement) =>
        movement.movement_type === "Supplier Purchase"
          ? sum +
            Number(movement.purchase_price || 0) *
              getPayableStockQuantity(movement)
          : sum,
      0
    ) || 0;
  const detailSupplyItems = useMemo(
    () =>
      [...(detailSupplier?.supply_items || [])].sort(
        (left, right) =>
          (parseUtcLocal(right.created_at)?.getTime() || 0) -
          (parseUtcLocal(left.created_at)?.getTime() || 0)
      ),
    [detailSupplier]
  );
  const detailSuppliesTotal =
    Number(detailSupplier?.supply_total || 0) ||
    detailSupplyItems.reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0
    );
  const detailSupplyUnits =
    Number(detailSupplier?.supply_units || 0) ||
    detailSupplyItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const detailPurchasesTotal = detailStockPurchasesTotal + detailSuppliesTotal;
  const detailBalance = Number(detailSupplier?.balance_due || 0);
  const detailOrderedItems = useMemo(
    () =>
      [...(detailSupplier?.ordered_items || [])].sort(
        (left, right) =>
          (parseUtcLocal(right.created_at)?.getTime() || 0) -
          (parseUtcLocal(left.created_at)?.getTime() || 0)
      ).filter((item) => {
        const status = String(item.status || "").toLowerCase();
        return (
          !item.is_closed &&
          Number(item.pending_quantity || 0) > 0 &&
          !["received", "over received", "closed short"].includes(status)
        );
      }),
    [detailSupplier]
  );
  const detailOrderedUnits = detailOrderedItems.reduce(
    (sum, item) => sum + Number(item.ordered_quantity || 0),
    0
  );
  const detailPendingOrderedUnits = detailOrderedItems.reduce(
    (sum, item) => sum + Number(item.pending_quantity || 0),
    0
  );
  const detailPendingOrderedTotal =
    Number(detailSupplier?.pending_ordered_total || 0) ||
    detailOrderedItems.reduce(
      (sum, item) => sum + Number(item.pending_total || 0),
      0
    );
  const detailReceivedOrderedUnits = detailOrderedItems.reduce(
    (sum, item) => sum + Number(item.received_quantity || 0),
    0
  );
  const detailFaultyMovements = useMemo(
    () =>
      (detailSupplier?.stock_movements || [])
        .map((movement) => ({
          ...movement,
          active_faulty_quantity: getActiveFaultyQuantity(movement),
        }))
        .filter((movement) => movement.active_faulty_quantity > 0)
        .sort(
          (left, right) =>
            (parseUtcLocal(right.created_at)?.getTime() || 0) -
            (parseUtcLocal(left.created_at)?.getTime() || 0)
        ),
    [detailSupplier]
  );
  const detailFaultyItemsTotal = detailFaultyMovements.reduce(
    (sum, movement) => sum + movement.active_faulty_quantity,
    0
  );
  const detailInitials = getInitials(detailSupplier?.name);
  const isSupplierOrderMode = supplierStockForm.fulfillment_mode === "order";
  const isReceiveOrderMode =
    supplierStockForm.fulfillment_mode === "receive_order";
  const supplierStockModalTitle = isSupplierOrderMode
    ? "Order products"
    : isReceiveOrderMode
      ? "Receive order"
      : "Add purchase";
  const supplierQuantityLabel = isSupplierOrderMode
    ? "Ordered Quantity"
    : isReceiveOrderMode
      ? "Received Quantity"
      : "Quantity";
  const supplierStockSubmitText = isSupplierOrderMode
    ? "Save Order"
    : isReceiveOrderMode
      ? "Add to Stock"
      : "Add Purchase";

  return (
    <div className="suppliers-page">
      {!showDetails && (
        <>
          <header className="suppliers-command-header">
        <div className="suppliers-command-main">
          <div>
            <h1>Accounts</h1>
          </div>

          <div className="suppliers-command-actions">
            <button
              className="primary-btn"
              onClick={openCreateSupplierForm}
              type="button"
            >
              Add account
            </button>
            <button
              aria-controls="suppliers-header-summary"
              aria-expanded={showSummary}
              className="overview-header-toggle"
              onClick={() => setShowSummary((current) => !current)}
              type="button"
            >
              Overview
              <span aria-hidden="true" className="overview-toggle-chevron" />
            </button>
          </div>
        </div>

        {showSummary && (
          <div
            className="suppliers-metric-strip"
            aria-label="Supplier summary"
            id="suppliers-header-summary"
          >
            <article>
              <span>Accounts</span>
              <strong>{suppliers.length}</strong>
              <small>{suppliersPending} need payment</small>
            </article>
            <article className="is-payable">
              <span>Payable</span>
              <strong>PKR {formatMoney(totalPayableBalance)}</strong>
              <small>Outstanding balance</small>
            </article>
            <article className="is-advance">
              <span>Advance</span>
              <strong>PKR {formatMoney(totalAdvanceBalance)}</strong>
              <small>Account credit held</small>
            </article>
            <article>
              <span>Payments</span>
              <strong>PKR {formatMoney(totalPaymentsRecorded)}</strong>
              <small>Recorded to date</small>
            </article>
          </div>
        )}
      </header>

      {showForm && (
        <div className="drawer-overlay" onClick={handleCancel}>
          <div className="drawer-panel" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3>{editingSupplierId ? "Edit Account" : "Add Account"}</h3>
              </div>
              <button
                className="drawer-close-btn"
                onClick={handleCancel}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="product-form drawer-form" onSubmit={saveSupplier}>
              <div className="form-group">
                <label>Account Name</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Account or vendor name"
                  required
                />
              </div>

              <div className="form-group">
                <label>Contact Person</label>
                <input
                  name="contact_person"
                  value={form.contact_person}
                  onChange={handleChange}
                  placeholder="Contact person"
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="supplier@email.com"
                />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+92 300 0000000"
                />
              </div>

              <div className="form-group form-full">
                <label>Address</label>
                <textarea
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  placeholder="Account address"
                  rows="4"
                />
              </div>

              <button className="primary-btn form-submit" type="submit">
                {editingSupplierId ? "Save Changes" : "Save Account"}
              </button>
            </form>
          </div>
        </div>
      )}

      <main className="supplier-directory">
        <div className="supplier-directory-header">
          <div>
            <h2>Account directory</h2>
            <p className="panel-description">
              {filteredSuppliers.length} of {suppliers.length} accounts shown
            </p>
          </div>
          <div className="supplier-toolbar">
            <div className="supplier-search">
              <SearchIcon />
              <input
                aria-label="Search accounts"
                onChange={(event) => setSupplierSearch(event.target.value)}
                placeholder="Search account, contact, phone, or email"
                value={supplierSearch}
              />
              {supplierSearch && (
                <button
                  aria-label="Clear supplier search"
                  className="supplier-search-clear"
                  onClick={() => setSupplierSearch("")}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div
          aria-label="Filter suppliers by account status"
          className="supplier-status-tabs"
          role="group"
        >
          {["All", "Pending", "Advance", "Settled"].map((status) => (
            <button
              aria-pressed={supplierStatus === status}
              className={supplierStatus === status ? "is-active" : ""}
              key={status}
              onClick={() => setSupplierStatus(status)}
              type="button"
            >
              {status}
              <span>
                {status === "All"
                  ? suppliers.length
                  : suppliers.filter(
                      (supplier) =>
                        (supplier.balance_status || "Settled") === status
                    ).length}
              </span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table className="supplier-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Account</th>
                <th>Purchases</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td className="supplier-empty-cell" colSpan="5">
                    <strong>No accounts found</strong>
                    <span>
                      {suppliers.length === 0
                        ? "Add your first account to start tracking purchases and balances."
                        : "Try changing the search or account-status filter."}
                    </span>
                    {suppliers.length > 0 && (
                      <button
                        className="secondary-btn supplier-filter-reset"
                        onClick={() => {
                          setSupplierSearch("");
                          setSupplierStatus("All");
                        }}
                        type="button"
                      >
                        Reset filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <tr
                    aria-label={`Open account for ${supplier.name}`}
                    className="supplier-clickable-row"
                    key={supplier.id}
                    onClick={() => handleView(supplier)}
                    onKeyDown={(event) =>
                      handleSupplierRowKeyDown(event, supplier)
                    }
                    role="link"
                    tabIndex="0"
                  >
                    <td data-label="Account">
                      <div className="supplier-identity">
                        <span className="supplier-list-avatar" aria-hidden="true">
                          {getInitials(supplier.name)}
                        </span>
                        <span className="supplier-identity-copy">
                          <strong>{supplier.name}</strong>
                          <span>{supplier.phone || "No phone recorded"}</span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Contact">
                      <div className="supplier-contact">
                        <strong>
                          {supplier.contact_person || "Not recorded"}
                        </strong>
                        <span>{supplier.email || "No email recorded"}</span>
                      </div>
                    </td>
                    <td data-label="Account">
                      <div className="supplier-account-cell">
                        <strong
                          className={`supplier-balance is-${String(
                            supplier.balance_status || "Settled"
                          ).toLowerCase()}`}
                        >
                          PKR {formatMoney(Number(supplier.balance_due || 0))}
                        </strong>
                        <span
                          className={`status-chip ${
                            supplier.balance_status?.toLowerCase() || "settled"
                          }`}
                        >
                          {supplier.balance_status || "Settled"}
                        </span>
                      </div>
                    </td>
                    <td data-label="Purchases">
                      <div className="supplier-purchase-cell">
                        <strong>{supplier.stock_movements?.length || 0}</strong>
                        <span>purchase records</span>
                      </div>
                    </td>
                    <td className="supplier-actions-cell" data-label="Actions">
                      <div
                        className="supplier-row-actions"
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <button
                          className="edit-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEditSupplier(supplier);
                          }}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="supplier-open-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleView(supplier);
                          }}
                          type="button"
                        >
                          Open account
                          <ArrowIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
        </>
      )}

      {showDetails && detailSupplier && (
        <main
          aria-labelledby="supplier-account-title"
          className="supplier-account-page supplier-account-modal"
        >
            <div className="modal-header supplier-account-header">
              <div className="supplier-account-identity">
                <div className="supplier-avatar" aria-hidden="true">
                  {detailInitials}
                </div>
                <div>
                  <span className="page-tag">Account profile</span>
                  <h3 id="supplier-account-title">{detailSupplier.name}</h3>
                  <div className="supplier-account-meta">
                    <span>
                      {detailSupplier.contact_person || "Contact not added"}
                    </span>
                    <span>{detailSupplier.phone || "Phone not added"}</span>
                    <span>{detailSupplier.email || "Email not added"}</span>
                  </div>
                </div>
              </div>
              <div className="modal-action-group">
                <button
                  className="primary-btn"
                  onClick={openSupplierStockModal}
                  type="button"
                >
                  <PlusIcon />
                  Add purchase
                </button>
                <button
                  className="secondary-btn supplier-order-top-btn"
                  onClick={openSupplierOrderModal}
                  type="button"
                >
                  Order products
                </button>
                <button
                  aria-label="Back to accounts"
                  className="secondary-btn"
                  onClick={closeDetails}
                  type="button"
                >
                  Back to accounts
                </button>
              </div>
            </div>

            <div className="detail-grid supplier-account-overview">
              <div className="detail-card account-summary-card">
                <div className="account-summary-header">
                  <div>
                    <span className="section-kicker">Financial position</span>
                    <h4>
                      {detailBalance > 0
                        ? "Balance payable"
                        : detailBalance < 0
                          ? "Advance available"
                          : "Account settled"}
                    </h4>
                    <p>
                      {detailBalance > 0
                        ? "This amount is currently payable to the account."
                        : detailBalance < 0
                          ? "This credit can be applied to future purchases."
                          : "Purchases and payments are fully balanced."}
                    </p>
                  </div>
                  <span className={`status-chip ${detailSupplier.balance_status?.toLowerCase() || "settled"}`}>
                    {detailSupplier.balance_status || "Settled"}
                  </span>
                </div>

                <div className="account-summary-grid">
                  <div className="summary-metric highlight balance-metric">
                    <p>Current balance</p>
                    <strong>PKR {formatMoney(detailBalance)}</strong>
                  </div>
                  <div className="summary-metric">
                    <p>Total purchases</p>
                    <strong>PKR {formatMoney(detailPurchasesTotal)}</strong>
                  </div>
                  <div className="summary-metric">
                    <p>Supplies</p>
                    <strong>PKR {formatMoney(detailSuppliesTotal)}</strong>
                    <span>{detailSupplyUnits} units/items</span>
                  </div>
                  <div className="summary-metric ordered-summary-metric">
                    <p>Ordered not received</p>
                    <strong>PKR {formatMoney(detailPendingOrderedTotal)}</strong>
                    <span>{detailPendingOrderedUnits} units pending</span>
                  </div>
                  <div className="summary-metric">
                    <p>Payments recorded</p>
                    <strong>PKR {formatMoney(detailPaymentsTotal)}</strong>
                  </div>
                  <div className="summary-metric">
                    <p>Faulty items</p>
                    <strong>{detailFaultyItemsTotal}</strong>
                  </div>
                </div>

                {detailFaultyMovements.length > 0 && (
                  <div
                    aria-label="Faulty stock not recovered"
                    className="supplier-faulty-summary"
                  >
                    <div className="supplier-faulty-summary-head">
                      <div>
                        <span className="section-kicker">Faulty not recovered</span>
                        <strong>
                          {detailFaultyItemsTotal}{" "}
                          {detailFaultyItemsTotal === 1 ? "piece" : "pieces"}
                        </strong>
                      </div>
                      <span>Deducted from payable</span>
                    </div>

                    <ul className="supplier-faulty-summary-list">
                      {detailFaultyMovements.map((movement) => (
                        <li key={movement.id}>
                          <div className="supplier-faulty-thumb">
                            {movement.product_image_url ? (
                              <img
                                alt={
                                  movement.product_name ||
                                  movement.article_no ||
                                  "Faulty stock"
                                }
                                src={getImageUrl(movement.product_image_url)}
                              />
                            ) : (
                              <span>No image</span>
                            )}
                          </div>
                          <div className="supplier-faulty-copy">
                            <strong>
                              {movement.product_name ||
                                movement.article_no ||
                                "Stock item"}
                            </strong>
                            <span>{movement.article_no || "No SKU"}</span>
                          </div>
                          <span className="supplier-faulty-tag">Faulty</span>
                          <span className="supplier-faulty-count">
                            {movement.active_faulty_quantity}/{movement.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="account-summary-actions">
                  <button
                    className="financial-action-btn"
                    onClick={
                      showPaymentForm ? closePaymentForm : openPaymentForm
                    }
                    type="button"
                  >
                    {showPaymentForm ? <CollapseIcon open /> : <PlusIcon />}
                    {showPaymentForm ? "Close payment form" : "Record payment"}
                  </button>
                  <button
                    className="financial-action-btn ledger-action-btn"
                    onClick={openSupplierLedgerPage}
                    type="button"
                  >
                    View ledger
                  </button>
                  {detailSupplier.balance_status === "Pending" && (
                  <button
                    className="primary-btn mark-paid-btn"
                    onClick={markAsPaid}
                    disabled={loading}
                    type="button"
                  >
                    {loading ? "Processing..." : "Mark balance paid"}
                  </button>
                  )}
                </div>
              </div>
            </div>

            <section className="panel small-panel account-panel account-work-card supplier-orders-card">
              <div className="account-section-heading supplier-orders-heading">
                <div>
                  <span className="section-kicker">Ordered inventory</span>
                  <h4>Ordered products</h4>
                  <p>
                    {detailOrderedUnits} ordered units, {detailReceivedOrderedUnits} received,
                    {detailPendingOrderedUnits} still pending.
                  </p>
                </div>
                <button
                  className="secondary-btn"
                  onClick={openSupplierOrderModal}
                  type="button"
                >
                  Order products
                </button>
              </div>

              {detailOrderedItems.length ? (
                <div className="supplier-order-lines">
                  {detailOrderedItems.map((item) => (
                    <article className="supplier-order-line" key={item.id}>
                      <div className="supplier-order-product">
                        <div className="supplier-order-thumb">
                          {item.product_image_url ? (
                            <img
                              alt={item.article_no || "Ordered product"}
                              src={getImageUrl(item.product_image_url)}
                            />
                          ) : (
                            <span>No image</span>
                          )}
                        </div>
                        <div>
                          <strong>{item.article_no || "No SKU"}</strong>
                          <small>{formatUtcLocal(item.created_at)}</small>
                        </div>
                      </div>
                      <div className="supplier-order-stats">
                        <span>
                          Ordered
                          <strong>{item.ordered_quantity || 0}</strong>
                        </span>
                        <span>
                          Received
                          <strong>{item.received_quantity || 0}</strong>
                        </span>
                        <span>
                          Pending
                          <strong>{item.pending_quantity || 0}</strong>
                        </span>
                        <span>
                          Unit
                          <strong>PKR {formatMoney(item.purchase_price)}</strong>
                        </span>
                        <span>
                          Pending total
                          <strong>PKR {formatMoney(item.pending_total)}</strong>
                        </span>
                      </div>
                      <div className="supplier-order-actions">
                        <span
                          className={`supplier-order-status ${getSupplierOrderStatusClass(
                            item.status
                          )}`}
                        >
                          {item.status || "Ordered"}
                        </span>
                        <div className="supplier-order-buttons">
                          <button
                            className="primary-btn"
                            onClick={() => openReceiveOrderModal(item)}
                            type="button"
                          >
                            Add to stock
                          </button>
                          <button
                            aria-label={`Remove ${item.article_no || "ordered item"} from queue`}
                            className="secondary-btn supplier-order-remove-btn"
                            onClick={() => removeSupplierOrderItem(item)}
                            title="Remove from queue"
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="account-empty-state supplier-orders-empty">
                  <strong>No ordered products yet</strong>
                  <span>Use Order products to record units before they arrive.</span>
                </div>
              )}
            </section>

            <section className="panel small-panel account-panel account-work-card supplier-supplies-card">
              <div className="account-section-heading supplier-orders-heading">
                <div>
                  <span className="section-kicker">Non-catalog purchasing</span>
                  <h4>Supplies & accessories</h4>
                  <p>
                    {detailSupplyItems.length} line{detailSupplyItems.length === 1 ? "" : "s"} for
                    office, factory, accessories, packaging, tools, and miscellaneous items.
                  </p>
                </div>
                <button
                  className="secondary-btn"
                  onClick={openSupplierStockModal}
                  type="button"
                >
                  Add purchase
                </button>
              </div>

              {detailSupplyItems.length ? (
                <div className="supplier-supply-table-wrap">
                  <table className="supplier-supply-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Category</th>
                        <th>Used For</th>
                        <th>Qty</th>
                        <th>Unit</th>
                        <th>Total</th>
                        <th>Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailSupplyItems.map((item) => (
                        <tr key={item.id}>
                          <td data-label="Item">
                            <div className="supplier-supply-item">
                              <strong>{item.item_name}</strong>
                              <span>{item.sku || item.note || "No reference"}</span>
                            </div>
                          </td>
                          <td data-label="Category">{item.category || "Miscellaneous"}</td>
                          <td data-label="Used For">{item.usage_area || "General"}</td>
                          <td data-label="Qty">{item.quantity}</td>
                          <td data-label="Unit">PKR {formatMoney(item.unit_price)}</td>
                          <td data-label="Total">
                            <strong>PKR {formatMoney(item.line_total)}</strong>
                          </td>
                          <td data-label="Date">{formatUtcLocal(item.created_at)}</td>
                          <td data-label="Actions">
                            <button
                              className="danger-btn"
                              onClick={() => deleteSupplyItem(item)}
                              type="button"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="account-empty-state supplier-orders-empty">
                  <strong>No supplies or accessories yet</strong>
                  <span>
                    Add purchase lines for office supplies, factory supplies,
                    accessories, tools, packaging, or miscellaneous expenses.
                  </span>
                </div>
              )}
            </section>

            <section className="panel small-panel account-panel account-work-card supplier-payments-card">
              <div className="supplier-payment-area">
              {showPaymentForm && (
                <div className="payment-form-panel" id="supplier-payment-form">
              <div className="panel-title-row">
                <div>
                  <span className="section-kicker">
                    {editingPaymentId ? "Editing record" : "Quick action"}
                  </span>
                  <h4>
                    {editingPaymentId ? "Update payment" : "Record a payment"}
                  </h4>
                  <p>
                    Keep the balance accurate with a payment, reference, and
                    optional note.
                  </p>
                </div>
                <button
                  aria-label="Close payment form"
                  className="payment-form-close"
                  onClick={closePaymentForm}
                  type="button"
                >
                  Close
                </button>
              </div>
              <form className="product-form payment-entry-form" onSubmit={savePayment}>
                <div className="form-group">
                  <label htmlFor="supplier-payment-amount">Amount</label>
                  <input
                    id="supplier-payment-amount"
                    min="0.01"
                    name="amount"
                    onChange={handlePaymentChange}
                    placeholder="0.00"
                    ref={paymentAmountInputRef}
                    required
                    step="0.01"
                    type="number"
                    value={paymentForm.amount}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="supplier-payment-method">Method</label>
                  <input
                    id="supplier-payment-method"
                    name="payment_method"
                    onChange={handlePaymentChange}
                    placeholder="Bank transfer"
                    value={paymentForm.payment_method}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="supplier-payment-reference">Reference</label>
                  <input
                    id="supplier-payment-reference"
                    name="payment_reference"
                    onChange={handlePaymentChange}
                    placeholder="Transaction ID"
                    value={paymentForm.payment_reference}
                  />
                </div>
                <div className="form-group form-full payment-note-field">
                  <label htmlFor="supplier-payment-note">Note</label>
                  <textarea
                    id="supplier-payment-note"
                    name="note"
                    onChange={handlePaymentChange}
                    placeholder="Add context for this payment"
                    rows="2"
                    value={paymentForm.note}
                  />
                </div>
                <div className="form-actions">
                  <button className="primary-btn form-submit" type="submit">
                    {editingPaymentId ? "Save changes" : "Record payment"}
                  </button>
                  {editingPaymentId && (
                    <button type="button" className="secondary-btn" onClick={cancelEditPayment}>
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
                </div>
              )}

              <button
                aria-expanded={showPaymentHistory}
                className={`collapsible-header account-section-toggle ${
                  showPaymentForm ? "" : "is-first"
                }`}
                onClick={() => setShowPaymentHistory((prev) => !prev)}
                type="button"
              >
                <div>
                  <span className="section-kicker">Money activity</span>
                  <h4>Payment history</h4>
                  <p>{detailSupplier.payments?.length || 0} recorded payments</p>
                </div>
                <span
                  className={`collapse-toggle ${showPaymentHistory ? "open" : ""}`}
                >
                  <CollapseIcon open={showPaymentHistory} />
                </span>
              </button>
              {showPaymentHistory && (
                detailSupplier.payments?.length ? (
                  <>
                    <div className="table-controls">
                      <button
                        type="button"
                        className="sort-toggle"
                        onClick={() => setPaymentSortAsc((prev) => !prev)}
                      >
                        {paymentSortAsc ? "Oldest first" : "Latest first"}
                      </button>
                    </div>
                    <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Amount</th>
                          <th>Method</th>
                          <th>Reference</th>
                          <th>Note</th>
                          <th>Date</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortByDate(detailSupplier.payments || [], paymentSortAsc)
                          .slice((paymentsPage - 1) * PAGE_SIZE, paymentsPage * PAGE_SIZE)
                          .map((payment) => (
                            <tr key={payment.id}>
                              <td><strong>{formatMoney(payment.amount)}</strong></td>
                              <td>{payment.payment_method || "-"}</td>
                              <td>{payment.payment_reference || "-"}</td>
                              <td>{payment.note || "-"}</td>
                              <td>{formatUtcLocal(payment.payment_date)}</td>
                              <td>
                                <div className="row-action-group">
                                  <button className="edit-btn" onClick={() => startEditPayment(payment)} type="button">Edit</button>
                                  <button className="secondary-btn" onClick={() => deletePayment(payment)} type="button">Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {detailSupplier.payments.length > PAGE_SIZE && (
                      <div className="pagination-row">
                        <button className="secondary-btn" onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))} disabled={paymentsPage === 1}>
                          Prev
                        </button>
                        <span>Page {paymentsPage}</span>
                        <button className="secondary-btn" onClick={() => setPaymentsPage((p) => p + 1)} disabled={paymentsPage * PAGE_SIZE >= detailSupplier.payments.length}>
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </> 
                ) : (
                  <div className="account-empty-state">
                    <strong>No payments yet</strong>
                    <span>Use the form above to record the first payment.</span>
                  </div>
                )
              )}
              </div>
            </section>

            <div className="supplier-danger-zone">
              <div>
                  <strong>Delete account</strong>
                <p>
                  Permanently removes this account and related records.
                </p>
              </div>
              <button
                className="danger-btn"
                onClick={() => deleteSupplier(detailSupplier.id)}
                type="button"
              >
                Delete account
              </button>
            </div>

            <div className="detail-card recent-purchases-card">
              <div className="account-section-heading">
                <div>
                  <span className="section-kicker">Latest activity</span>
                  <h4>Recent purchases</h4>
                  <p>The three latest product stock entries from this account.</p>
                </div>
                <span className="activity-count">
                  {detailSupplier.stock_movements?.length || 0}
                </span>
              </div>
              {detailSupplier.stock_movements && detailSupplier.stock_movements.length ? (
                <ul className="recent-list">
                  {detailSupplier.stock_movements
                    .slice()
                    .sort((a,b)=> (parseUtcLocal(b.created_at)?.getTime() || 0) - (parseUtcLocal(a.created_at)?.getTime() || 0))
                    .slice(0,3)
                    .map((movement) => (
                      <li className="recent-item" key={movement.id}>
                        <div className="recent-thumb">
                          {movement.product_image_url ? (
                            <img
                              alt={movement.product_name}
                              src={getImageUrl(movement.product_image_url)}
                            />
                          ) : (
                            <div className="recent-noimg">No image</div>
                          )}
                        </div>
                        <div className="recent-purchase-copy">
                          <strong>
                            {movement.product_name ||
                              movement.article_no ||
                              "Stock item"}
                          </strong>
                          <span>
                            {movement.quantity} x{" "}
                            {movement.purchase_price
                              ? formatMoney(movement.purchase_price)
                              : "-"}
                          </span>
                          <small>{formatUtcLocal(movement.created_at)}</small>
                        </div>
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="account-empty-state compact">
                  No purchases have been recorded.
                </div>
              )}
            </div>

            <section className="panel small-panel account-work-card stock-history-card">
              <button
                aria-expanded={showStockHistory}
                className="collapsible-header account-section-toggle"
                onClick={() => {
                  if (!showStockHistory) setStockVisibleCount(PAGE_SIZE);
                  setShowStockHistory((prev) => !prev);
                }}
                type="button"
              >
                <div>
                  <span className="section-kicker">Purchase activity</span>
                  <h4>Stock history</h4>
                  <p className="section-subtitle">
                    {detailSupplier.stock_movements?.length || 0} product stock
                    records
                  </p>
                </div>
                <span
                  className={`collapse-toggle ${showStockHistory ? "open" : ""}`}
                >
                  <CollapseIcon open={showStockHistory} />
                </span>
              </button>
              {showStockHistory && (
                detailSupplier.stock_movements?.length ? (
                  <>
                    <div className="table-controls">
                      <button
                        type="button"
                        className="sort-toggle"
                        onClick={() => {
                          setStockSortAsc((prev) => !prev);
                          setStockVisibleCount(PAGE_SIZE);
                        }}
                      >
                        {stockSortAsc ? "Oldest first" : "Latest first"}
                      </button>
                    </div>
                    <div className="table-wrap">
                    <table className="stock-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Article SKU</th>
                          <th>Type</th>
                          <th>Qty</th>
                          <th>Unit Price</th>
                          <th>Total</th>
                          <th>Source</th>
                          <th>Reference</th>
                          <th>Date</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortByDate(detailSupplier.stock_movements || [], stockSortAsc)
                          .slice(0, stockVisibleCount)
                          .map((movement) => (
                          <tr key={movement.id}>
                            <td className="product-cell">
                              {movement.product_image_url ? (
                                <img src={getImageUrl(movement.product_image_url)} alt={movement.article_no} className="stock-image" />
                              ) : (
                                <div className="stock-image stock-image-placeholder">No Image</div>
                              )}
                            </td>
                            <td>
                              <div>
                                <span>{movement.article_no}</span>
                                {movement.faulty && (
                                  <div className="badge stock-fault-badge">
                                    Faulty {movement.faulty_quantity}/{movement.quantity}
                                  </div>
                                )}
                                {movement.faulty_note && (
                                  <div className="muted stock-fault-note">
                                    {movement.faulty_note}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td>{movement.movement_type}</td>
                            <td>{movement.quantity}</td>
                            <td>{movement.purchase_price ? formatMoney(movement.purchase_price) : "-"}</td>
                            <td>{movement.purchase_price ? formatMoney(movement.purchase_price * movement.quantity) : "-"}</td>
                            <td>{movement.source || "-"}</td>
                            <td>{movement.reference || "-"}</td>
                            <td>{formatUtcLocal(movement.created_at)}</td>
                            <td>
                              <div className="row-action-group stock-actions">
                                <button type="button" className="secondary-btn" onClick={() => markStockMovementFaulty(movement)}>
                                  {movement.faulty ? "Edit faulty" : "Mark faulty"}
                                </button>
                                {movement.faulty && (
                                  <button type="button" className="secondary-btn" onClick={() => clearStockMovementFaulty(movement)}>
                                    Clear
                                  </button>
                                )}
                                <button type="button" className="edit-btn" onClick={() => openStockEditModal(movement)}>
                                  Edit
                                </button>
                                <button type="button" className="danger-btn" onClick={() => deleteStockMovement(movement)}>
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detailSupplier.stock_movements.length > stockVisibleCount && (
                      <div className="supplier-see-more-row">
                        <span>
                          Showing {Math.min(stockVisibleCount, detailSupplier.stock_movements.length)} of{" "}
                          {detailSupplier.stock_movements.length} purchases
                        </span>
                        <button
                          className="secondary-btn"
                          onClick={() =>
                            setStockVisibleCount((count) =>
                              Math.min(
                                count + PAGE_SIZE,
                                detailSupplier.stock_movements.length
                              )
                            )
                          }
                          type="button"
                        >
                          See more
                        </button>
                      </div>
                    )}
                  </div>
                </> 
                ) : (
                  <div className="account-empty-state">
                    <strong>No stock activity yet</strong>
                    <span>Add a product stock purchase to create the first record.</span>
                  </div>
                )
              )}
            </section>

        </main>
      )}

      {supplierAddStockOpen && (
        <div className="confirm-overlay" onClick={closeSupplierStockModal}>
          <div className="confirm-modal supplier-stock-modal" onClick={(event) => event.stopPropagation()}>
            <div className="supplier-stock-header">
              <div>
                <strong className="supplier-stock-title">{supplierStockModalTitle}</strong>
              </div>
              <button
                className="drawer-close-btn supplier-stock-close"
                onClick={closeSupplierStockModal}
                type="button"
              >
                Close
              </button>
            </div>

            {isReceiveOrderMode ? (
              <>
                <div className="supplier-receive-order-panel">
                  <div className="supplier-selected-product">
                    {selectedSupplierStockProduct?.image_url ? (
                      <img
                        alt={selectedSupplierStockProduct.article_no}
                        src={getImageUrl(selectedSupplierStockProduct.image_url)}
                      />
                    ) : (
                      <span>No image</span>
                    )}
                    <div>
                      <strong>
                        {selectedSupplierStockProduct?.article_no || "No SKU"}
                        {selectedSupplierStockProduct?.name
                          ? ` - ${selectedSupplierStockProduct.name}`
                          : ""}
                      </strong>
                      <small>
                        Ordered {supplierStockForm.order_ordered_quantity || 0},
                        received {supplierStockForm.order_received_quantity || 0},
                        pending {supplierStockForm.order_pending_quantity || 0}
                      </small>
                    </div>
                  </div>
                </div>

                <div className="supplier-stock-entry-grid">
                  <div className="form-group">
                    <label>Stock Type</label>
                    <select
                      name="stock_type"
                      value={supplierStockForm.stock_type}
                      onChange={handleSupplierStockChange}
                    >
                      <option value="factory_stock">Factory Stock</option>
                      <option value="usa_stock">USA Stock</option>
                      <option value="reserved_stock">Reserved Stock</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>{supplierQuantityLabel}</label>
                    <input
                      type="number"
                      name="quantity"
                      min="1"
                      value={supplierStockForm.quantity}
                      onChange={handleSupplierStockChange}
                    />
                  </div>

                  <div className="form-group">
                    <label>Purchase Price</label>
                    <input
                      type="number"
                      name="purchase_price"
                      min="0"
                      step="0.01"
                      value={supplierStockForm.purchase_price}
                      onChange={handleSupplierStockChange}
                    />
                  </div>

                  <div className="supplier-stock-total-card">
                    <span>Line total</span>
                    <strong>PKR {formatMoney(supplierStockLineTotal)}</strong>
                  </div>

                <div className="supplier-receive-mode-card">
                  <div>
                    <span>Receive status</span>
                    <strong>
                      {supplierStockForm.receive_completion === "complete"
                        ? "Complete order"
                        : "Partial receive"}
                    </strong>
                  </div>
                  <div className="supplier-receive-mode-toggle" role="group" aria-label="Receive status">
                    <button
                      aria-pressed={supplierStockForm.receive_completion === "partial"}
                      className={
                        supplierStockForm.receive_completion === "partial"
                          ? "is-active"
                          : ""
                      }
                      name="receive_completion"
                      onClick={handleSupplierStockChange}
                      type="button"
                      value="partial"
                    >
                      Partial
                    </button>
                    <button
                      aria-pressed={supplierStockForm.receive_completion === "complete"}
                      className={
                        supplierStockForm.receive_completion === "complete"
                          ? "is-active"
                          : ""
                      }
                      name="receive_completion"
                      onClick={handleSupplierStockChange}
                      type="button"
                      value="complete"
                    >
                      Complete
                    </button>
                  </div>
                </div>

                  <div className="form-group supplier-stock-note">
                    <label>Note</label>
                    <textarea
                      name="note"
                      value={supplierStockForm.note}
                      onChange={handleSupplierStockChange}
                      rows="3"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="supplier-purchase-toolbar">
                  <div className="supplier-purchase-toolbar-title">
                    <strong>{isSupplierOrderMode ? "Products" : "Purchase lines"}</strong>
                    <span>
                      {supplierPurchaseLines.length} line{supplierPurchaseLines.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="supplier-product-search supplier-line-product-search">
                    <SearchIcon />
                    <input
                      aria-label="Filter products for purchase lines"
                      onChange={(event) => setSupplierStockSearch(event.target.value)}
                      placeholder="Filter product dropdowns"
                      value={supplierStockSearch}
                    />
                    {supplierStockSearch && (
                      <button
                        aria-label="Clear product filter"
                        onClick={() => setSupplierStockSearch("")}
                        type="button"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <button
                    className="secondary-btn supplier-add-line-btn"
                    onClick={addSupplierPurchaseLine}
                    type="button"
                  >
                    <PlusIcon />
                    Add line
                  </button>
                </div>

                <div className="supplier-purchase-lines">
                  {supplierPurchaseLines.map((line, lineIndex) => {
                    const lineProduct = getSupplierLineProduct(line);
                    const lineHistory = getSupplierLineProductHistory(line.product_id);
                    const latestLinePurchase = lineHistory[0];
                    const lineTotal =
                      Number(line.quantity || 0) * Number(line.purchase_price || 0);

                    return (
                      <article className="supplier-purchase-line" key={lineIndex}>
                        <div className="supplier-purchase-line-head">
                          <div className="supplier-line-title">
                            <strong>Line {lineIndex + 1}</strong>
                            <span className="supplier-line-kind">
                              {line.line_type === "supply"
                                ? "Supplies"
                                : "Product"}
                            </span>
                          </div>
                          <div className="supplier-line-actions">
                            {!isSupplierOrderMode && (
                              <select
                                aria-label={`Line ${lineIndex + 1} type`}
                                value={line.line_type}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "line_type",
                                    event.target.value
                                  )
                                }
                              >
                                <option value="product">Catalog product</option>
                                <option value="supply">Supplies / accessories</option>
                              </select>
                            )}
                            <button
                              aria-label={`Remove purchase line ${lineIndex + 1}`}
                              className="secondary-btn supplier-line-remove"
                              disabled={supplierPurchaseLines.length === 1}
                              onClick={() => removeSupplierPurchaseLine(lineIndex)}
                              type="button"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>

                        {line.line_type === "product" ? (
                          <div className="supplier-line-product-area">
                            <div className="form-group">
                              <label>Product</label>
                              <select
                                value={line.product_id}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "product_id",
                                    event.target.value
                                  )
                                }
                              >
                                <option value="">Select product</option>
                                {filteredSupplierStockProducts.map((product) => (
                                  <option key={product.id} value={product.id}>
                                    {product.article_no || "No SKU"} - {product.name || "Unnamed"}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {lineProduct ? (
                              <div className="supplier-selected-product supplier-line-selected-product">
                                {lineProduct.image_url ? (
                                  <img
                                    alt={lineProduct.article_no || lineProduct.name}
                                    src={getImageUrl(lineProduct.image_url)}
                                  />
                                ) : (
                                  <span>No image</span>
                                )}
                                <div>
                                  <strong>
                                    {lineProduct.article_no || "No SKU"} - {lineProduct.name}
                                  </strong>
                                  <small>
                                    Stock: {lineProduct.factory_stock || 0} factory,{" "}
                                    {lineProduct.usa_stock || 0} USA,{" "}
                                    {lineProduct.reserved_stock || 0} reserved
                                  </small>
                                  <div className="supplier-price-history">
                                    <div className="supplier-price-history-main">
                                      <span>Previous price from this account</span>
                                      {latestLinePurchase ? (
                                        <>
                                          <strong>
                                            PKR {formatMoney(latestLinePurchase.purchase_price)}
                                          </strong>
                                          <small>
                                            {latestLinePurchase.quantity} units on{" "}
                                            {formatUtcLocal(latestLinePurchase.created_at)}
                                          </small>
                                        </>
                                      ) : (
                                        <strong>Not recorded yet</strong>
                                      )}
                                    </div>
                                    {latestLinePurchase && (
                                      <button
                                        className="supplier-use-price"
                                        onClick={() =>
                                          applyLatestLinePurchasePrice(
                                            lineIndex,
                                            line.product_id
                                          )
                                        }
                                        type="button"
                                      >
                                        Use price
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="supplier-product-empty">
                                {products.length
                                  ? "Choose a product."
                                  : "No products found yet."}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="supplier-supply-grid">
                            <div className="form-group">
                              <label>Item Name</label>
                              <input
                                placeholder="Office paper, belts, packing tape..."
                                value={line.supply_name}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "supply_name",
                                    event.target.value
                                  )
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label>SKU / Reference</label>
                              <input
                                placeholder="Optional"
                                value={line.supply_sku}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "supply_sku",
                                    event.target.value
                                  )
                                }
                              />
                            </div>
                            <div className="form-group">
                              <label>Category</label>
                              <select
                                value={line.supply_category}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "supply_category",
                                    event.target.value
                                  )
                                }
                              >
                                {SUPPLY_CATEGORIES.map((category) => (
                                  <option key={category} value={category}>
                                    {category}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="form-group">
                              <label>Used For</label>
                              <select
                                value={line.supply_usage_area}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "supply_usage_area",
                                    event.target.value
                                  )
                                }
                              >
                                {SUPPLY_USAGE_AREAS.map((area) => (
                                  <option key={area} value={area}>
                                    {area}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}

                        <div className="supplier-line-entry-grid">
                          {line.line_type === "product" && (
                            <div className="form-group">
                              <label>Stock Type</label>
                              <select
                                value={line.stock_type}
                                onChange={(event) =>
                                  updateSupplierPurchaseLine(
                                    lineIndex,
                                    "stock_type",
                                    event.target.value
                                  )
                                }
                              >
                                <option value="factory_stock">Factory Stock</option>
                                <option value="usa_stock">USA Stock</option>
                                <option value="reserved_stock">Reserved Stock</option>
                              </select>
                            </div>
                          )}
                          <div className="form-group">
                            <label>{isSupplierOrderMode ? "Ordered Quantity" : "Quantity"}</label>
                            <input
                              type="number"
                              min="1"
                              value={line.quantity}
                              onChange={(event) =>
                                updateSupplierPurchaseLine(
                                  lineIndex,
                                  "quantity",
                                  event.target.value
                                )
                              }
                            />
                          </div>
                          <div className="form-group">
                            <label>Unit Price</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.purchase_price}
                              onChange={(event) =>
                                updateSupplierPurchaseLine(
                                  lineIndex,
                                  "purchase_price",
                                  event.target.value
                                )
                              }
                            />
                          </div>
                          <div className="supplier-stock-total-card supplier-line-total">
                            <span>Line total</span>
                            <strong>PKR {formatMoney(lineTotal)}</strong>
                          </div>
                          <div className="form-group supplier-stock-note">
                            <label>Note</label>
                            <textarea
                              rows="2"
                              value={line.note}
                              onChange={(event) =>
                                updateSupplierPurchaseLine(
                                  lineIndex,
                                  "note",
                                  event.target.value
                                )
                              }
                            />
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="supplier-stock-total-card supplier-purchase-total">
                  <span>{isSupplierOrderMode ? "Ordered total" : "Purchase total"}</span>
                  <strong>PKR {formatMoney(supplierStockLineTotal)}</strong>
                </div>
              </>
            )}

            <div className="confirm-actions supplier-stock-actions">
              <button className="secondary-btn" onClick={closeSupplierStockModal}>Cancel</button>
              <button className="primary-btn" disabled={loading} type="button" onClick={saveSupplierStock}>
                {loading ? "Saving..." : supplierStockSubmitText}
              </button>
            </div>
          </div>
        </div>
      )}

      {stockEditModal.visible && stockEditModal.movement && (
        <div className="confirm-overlay" onClick={closeStockEditModal}>
          <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Edit Stock Movement</h3>
            <p>
              SKU: {stockEditModal.movement.article_no} / Type:{" "}
              {stockEditModal.movement.movement_type}
            </p>

            <div className="form-group">
              <label>Quantity</label>
              <input
                type="number"
                name="quantity"
                min="1"
                value={stockEditModal.quantity}
                onChange={handleStockEditChange}
              />
            </div>

            <div className="form-group">
              <label>Unit price</label>
              <input
                type="number"
                name="purchase_price"
                min="0"
                step="0.01"
                value={stockEditModal.purchase_price}
                onChange={handleStockEditChange}
              />
            </div>

            <div className="form-group">
              <label>Source</label>
              <input
                type="text"
                name="source"
                value={stockEditModal.source}
                onChange={handleStockEditChange}
              />
            </div>

            <div className="form-group">
              <label>Reference</label>
              <input
                type="text"
                name="reference"
                value={stockEditModal.reference}
                onChange={handleStockEditChange}
              />
            </div>

            <div className="form-group">
              <label>Note</label>
              <textarea
                name="note"
                value={stockEditModal.note}
                onChange={handleStockEditChange}
              />
            </div>

            <div className="confirm-actions">
              <button className="secondary-btn" onClick={closeStockEditModal}>Cancel</button>
              <button className="primary-btn" type="button" onClick={submitStockEditModal}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {faultyModal.visible && faultyModal.movement && (
        <div className="confirm-overlay" onClick={closeFaultyModal}>
          <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{faultyModal.movement.faulty ? "Edit Faulty Stock" : "Mark Faulty Stock"}</h3>
            <p>Total quantity: {faultyModal.movement.quantity}</p>

            <div className="form-group">
              <label>Faulty quantity</label>
              <input
                type="number"
                name="faulty_quantity"
                min="1"
                max={faultyModal.movement.quantity}
                value={faultyModal.faulty_quantity}
                onChange={handleFaultyModalChange}
              />
            </div>

            <div className="form-group">
              <label>Faulty note</label>
              <textarea
                name="faulty_note"
                value={faultyModal.faulty_note}
                onChange={handleFaultyModalChange}
              />
            </div>

            <div className="confirm-actions">
              <button className="secondary-btn" onClick={closeFaultyModal}>Cancel</button>
              <button className="primary-btn" type="button" onClick={submitFaultyModal}>Save Faulty</button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog.visible && (
        <div className="confirm-overlay" onClick={closeConfirmDialog}>
          <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="confirm-actions">
              <button className="secondary-btn" onClick={closeConfirmDialog}>{confirmDialog.cancelText}</button>
              <button className="danger-btn" onClick={runConfirmAction}>{confirmDialog.confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Suppliers;
