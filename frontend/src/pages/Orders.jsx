import { useEffect, useMemo, useRef, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./Orders.css";

const getProductInitials = (articleNo, productName) =>
  String(articleNo || productName || "PR")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();

const createEmptyItem = () => ({
  product_id: "",
  quantity: 1,
  unit_price: 0,
  stock_source: "Factory",
});

const createEmptyForm = () => ({
  order_no: "",
  customer_id: "",
  platform: "Manual",
  payment_status: "Pending",
  shipping_status: "Pending",
  notes: "",
  payout_amount_usd: 0,
  payout_received_date: "",
  items: [createEmptyItem()],
});

const createEmptyShippingDraft = () => ({
  courier_name: "",
  tracking_number: "",
  package_weight_kg: "",
  shipping_cost: "",
  shipping_note: "",
});

const EXCEL_ROW_HEADER_WIDTH = 46;

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

const UploadIcon = ({ size = 17 }) => (
  <svg
    aria-hidden="true"
    className="orders-button-icon"
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 15v4h14v-4" />
  </svg>
);

const ExcelIcon = ({ size = 17 }) => (
  <svg
    aria-hidden="true"
    className="orders-button-icon"
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
    <path d="M9.5 12.5 14.5 18" />
    <path d="M14.5 12.5 9.5 18" />
  </svg>
);

const ORDER_PROGRESS_STEPS = [
  { key: "received", label: "Order received", shortLabel: "Received" },
  { key: "preparing", label: "Preparing", shortLabel: "Preparing" },
  { key: "shipping", label: "Shipping", shortLabel: "Shipping" },
  { key: "delivered", label: "Delivered", shortLabel: "Delivered" },
  { key: "review", label: "Review follow-up", shortLabel: "Review" },
  { key: "confirmation", label: "Confirmation", shortLabel: "Confirmed" },
];

const SHIPPING_IN_PROGRESS_STATUSES = new Set([
  "shipped",
  "dispatched",
  "in transit",
]);
const FULFILLED_SHIPPING_STATUSES = new Set([
  ...SHIPPING_IN_PROGRESS_STATUSES,
  "delivered",
]);
const CANCELED_STATUSES = new Set(["canceled", "cancelled"]);
const CONFIRMED_PAYMENT_STATUSES = new Set([
  "paid",
  "received",
  "complete",
  "completed",
]);

const normalizeStatusValue = (value) =>
  String(value || "").trim().toLowerCase();

const FAIRE_COMMISSION_RATE = 0.15;
const FAIRE_PAYOUT_FEE_RATE = 0.029;

const calculateFairePayoutBreakdown = (grossValue) => {
  const gross = Math.max(Number(grossValue || 0), 0);
  const commission = Number((gross * FAIRE_COMMISSION_RATE).toFixed(2));
  const payoutFee = Number((gross * FAIRE_PAYOUT_FEE_RATE).toFixed(2));
  const final = Number(Math.max(gross - commission - payoutFee, 0).toFixed(2));

  return { commission, final, gross, payoutFee };
};

const getOrderPayoutBreakdown = (order = {}) => {
  const gross = Math.max(Number(order.order_total_usd || 0), 0);
  const isFaire = normalizeStatusValue(order.platform) === "faire";
  const storedCommission = Math.max(Number(order.platform_fee_usd || 0), 0);
  const storedPayoutFee = Math.max(Number(order.deduction_usd || 0), 0);
  const hasStoredDeductions = storedCommission > 0 || storedPayoutFee > 0;
  const calculated =
    isFaire && gross > 0 && !hasStoredDeductions
      ? calculateFairePayoutBreakdown(gross)
      : null;
  const commission = calculated ? calculated.commission : storedCommission;
  const payoutFee = calculated ? calculated.payoutFee : storedPayoutFee;
  const final =
    calculated?.final ??
    Math.max(
      Number(order.expected_payout_usd || order.payout_amount_usd || 0) ||
        (gross > 0 ? gross - commission - payoutFee : 0),
      0
    );
  const received = Math.max(Number(order.received_payout_usd || 0), 0);
  const remainingValue = order.remaining_payout_usd ?? final - received;
  const remaining = Math.max(Number(remainingValue || 0), 0);

  return {
    commission,
    deductions: commission + payoutFee,
    final,
    gross,
    hasUsd: gross > 0 || final > 0 || received > 0 || commission > 0 || payoutFee > 0,
    isFaire,
    payoutFee,
    received,
    remaining,
  };
};

const countOrderUnits = (order) =>
  (order.items || []).reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );

const orderNeedsPreparation = (order) =>
  (order?.items || []).some((item) => item.manufacturing_required);

const latestTaskOfType = (tasks, taskType) =>
  [...(tasks || [])]
    .filter((task) => task.task_type === taskType)
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || null;

const formatWeight = (value) => {
  const weight = Number(value || 0);
  if (!weight) return "Weight pending";
  return `${weight.toLocaleString("en-PK", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })} kg`;
};

const isOrderCanceled = (order) =>
  CANCELED_STATUSES.has(normalizeStatusValue(order.status)) ||
  CANCELED_STATUSES.has(normalizeStatusValue(order.shipping_status));

const isOrderDelivered = (order) =>
  normalizeStatusValue(order.shipping_status) === "delivered";

const isOrderConfirmed = (order) => {
  if (!isOrderDelivered(order)) return false;
  return (
    CONFIRMED_PAYMENT_STATUSES.has(normalizeStatusValue(order.payment_status)) ||
    normalizeStatusValue(order.payout_status) === "received"
  );
};

const isReviewFollowUpComplete = (followUp) => {
  const status = normalizeStatusValue(followUp?.status);
  return (
    Boolean(followUp?.review_provided) ||
    status === "review provided" ||
    status === "no review" ||
    status === "closed"
  );
};

const hasReviewProvided = (followUp) =>
  Boolean(followUp?.review_provided) ||
  normalizeStatusValue(followUp?.status) === "review provided";

const getOrderProgressInfo = (
  order,
  shippingRecord = null,
  workflowTasks = [],
  followUp = null
) => {
  if (!order) {
    return {
      activeIndex: 0,
      completedSteps: 0,
      isCanceled: false,
      isConfirmed: false,
      label: "Received",
      percent: 0,
    };
  }

  const shippingStatus = normalizeStatusValue(order.shipping_status);
  const isCanceled = isOrderCanceled(order);
  const isConfirmed = isOrderConfirmed(order);
  const preparationTask = latestTaskOfType(workflowTasks, "Preparation");
  const shippingTask = latestTaskOfType(workflowTasks, "Shipping");
  const reviewComplete = isReviewFollowUpComplete(followUp);
  const hasShipment =
    Boolean(shippingRecord) || FULFILLED_SHIPPING_STATUSES.has(shippingStatus);

  let activeIndex = 1;
  if (isCanceled) {
    activeIndex = 0;
  } else if (isConfirmed) {
    activeIndex = ORDER_PROGRESS_STEPS.length - 1;
  } else if (isOrderDelivered(order)) {
    activeIndex = reviewComplete ? 5 : 4;
  } else if (
    hasShipment ||
    SHIPPING_IN_PROGRESS_STATUSES.has(shippingStatus) ||
    (shippingTask && shippingTask.status !== "Completed") ||
    preparationTask?.status === "Completed"
  ) {
    activeIndex = 2;
  } else if (preparationTask && preparationTask.status !== "Completed") {
    activeIndex = 1;
  }

  const completedSteps = isCanceled
    ? 0
    : isConfirmed
      ? ORDER_PROGRESS_STEPS.length
      : Math.max(activeIndex, 1);

  return {
    activeIndex,
    completedSteps,
    isCanceled,
    isConfirmed,
    label: isCanceled
      ? "Canceled"
      : ORDER_PROGRESS_STEPS[activeIndex]?.shortLabel || "Preparing",
    percent: isConfirmed
      ? 100
      : Math.round((activeIndex / (ORDER_PROGRESS_STEPS.length - 1)) * 100),
  };
};

const getOrderStepState = (progress, index) => {
  if (progress.isCanceled) return index === 0 ? "active" : "pending";
  if (progress.isConfirmed || index < progress.activeIndex) return "complete";
  if (index === progress.activeIndex) return "active";
  return "pending";
};

const getOrderWorkflowSteps = (
  order,
  shippingRecord,
  workflowTasks,
  progress,
  formatDate,
  followUp = null
) => {
  const unitCount = countOrderUnits(order);
  const preparationTask = latestTaskOfType(workflowTasks, "Preparation");
  const shippingTask = latestTaskOfType(workflowTasks, "Shipping");
  const shippingStarted = progress.activeIndex >= 2 && !progress.isCanceled;
  const delivered = isOrderDelivered(order);
  const confirmed = isOrderConfirmed(order);
  const reviewComplete = isReviewFollowUpComplete(followUp);
  const reviewProvided = hasReviewProvided(followUp);
  const reviewStatus = followUp?.status || (delivered ? "Pending" : "Queued");
  const shippedDate = shippingRecord?.shipped_at
    ? `Shipped ${formatDate(shippingRecord.shipped_at)}`
    : "Ship date pending";

  const details = [
    {
      detail: `Placed ${formatDate(order.order_date)}`,
      key: "received",
      meta: order.customer_name || "Unknown customer",
      title: `#${order.order_no || "-"}`,
    },
    {
      key: "preparing",
      meta:
        preparationTask?.assigned_worker_name ||
        `${unitCount} ${unitCount === 1 ? "unit" : "units"} reserved`,
      title:
        preparationTask
          ? `Preparation ${preparationTask.status}`
          : orderNeedsPreparation(order)
            ? "Preparation handoff needed"
            : progress.activeIndex > 1
              ? "Preparation complete"
              : "Preparing order",
      detail: preparationTask
        ? `${preparationTask.title} - due ${formatDate(preparationTask.due_at)}`
        : `${order.shipping_status || "Pending"} warehouse status`,
    },
    {
      detail: shippingTask
        ? `${shippingTask.title} - due ${formatDate(shippingTask.due_at)}`
        : `${formatWeight(shippingRecord?.package_weight_kg)} - ${shippedDate}`,
      key: "shipping",
      meta:
        shippingTask?.assigned_worker_name ||
        shippingRecord?.courier_name ||
        "Courier not set",
      title: shippingTask
        ? `Shipping ${shippingTask.status}`
        : shippingRecord?.tracking_number
          ? shippingRecord.tracking_number
          : shippingStarted
            ? "Tracking needed"
            : "Shipping not started",
    },
    {
      detail: delivered
        ? "Customer delivery recorded"
        : "Waiting for delivery confirmation",
      key: "delivered",
      meta: delivered ? "Completed" : "Pending",
      title: delivered ? "Delivered" : "Delivery pending",
    },
    {
      detail: delivered
        ? followUp
          ? `${reviewStatus} via ${followUp.channel || "Manual"}${
              followUp.followed_up_at
                ? ` - ${formatDate(followUp.followed_up_at)}`
                : ""
            }`
          : "Create the follow-up request from the Follow Ups page"
        : "Starts after delivery",
      key: "review",
      meta: delivered
        ? reviewProvided
          ? "Review received"
          : reviewComplete
            ? reviewStatus
            : "Follow-up open"
        : "Queued",
      title: delivered
        ? reviewProvided
          ? "Review provided"
          : reviewComplete
            ? "Follow-up completed"
            : followUp?.status === "Followed Up"
              ? "Waiting for review"
              : "Review follow-up due"
        : "Review follow-up",
    },
    {
      detail: reviewComplete
        ? `Payment ${order.payment_status || "Pending"} - payout ${
            order.payout_status || "Not Received"
          }`
        : "Complete review follow-up before final confirmation",
      key: "confirmation",
      meta: confirmed ? "Complete" : "Pending",
      title: confirmed ? "Confirmed" : "Final confirmation",
    },
  ];

  return details.map((step, index) => ({
    ...step,
    label: ORDER_PROGRESS_STEPS[index].label,
    state: getOrderStepState(progress, index),
  }));
};

const orderIdFromPath = () => {
  const match = window.location.pathname.match(/^\/portal\/orders\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
};

const orderNeedsCustomerAssignment = (order) =>
  Boolean(order?.needs_customer_assignment) ||
  normalizeStatusValue(order?.customer_name) === "unassigned customer";

const orderCustomerDisplay = (order) => {
  const name =
    order?.customer_name || order?.import_customer_name || "Unknown customer";
  const company =
    order?.customer_company_name || order?.import_customer_company_name || "";
  return {
    name,
    company: company && company !== name ? company : "",
  };
};

const orderSortTime = (order) => {
  const date = new Date(order?.order_date || "");
  if (!Number.isNaN(date.getTime())) return date.getTime();
  return 0;
};

function Orders({ initialCustomerId = null, onInitialCustomerHandled = null }) {
  const confirmDialog = useConfirmDialog();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [shippingRecords, setShippingRecords] = useState([]);
  const [workflowTasks, setWorkflowTasks] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [shippingDraft, setShippingDraft] = useState(createEmptyShippingDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingShipping, setSavingShipping] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [exportingOrders, setExportingOrders] = useState(false);
  const [excelView, setExcelView] = useState(false);
  const [excelViewData, setExcelViewData] = useState(null);
  const [excelViewLoading, setExcelViewLoading] = useState(false);
  const [excelViewError, setExcelViewError] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState(() => new Set());
  const [addingImportProducts, setAddingImportProducts] = useState(false);
  const [addingImportCustomers, setAddingImportCustomers] = useState(false);
  const [missingCustomerAction, setMissingCustomerAction] = useState("skip");
  const [orderImportFile, setOrderImportFile] = useState(null);
  const [orderImportReview, setOrderImportReview] = useState(null);
  const [updatingStage, setUpdatingStage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [shippingFormError, setShippingFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(orderIdFromPath);
  const handledInitialCustomerRef = useRef(null);
  const csvInputRef = useRef(null);
  const exportOptionsRef = useRef(null);
  const excelViewRequestRef = useRef(0);

  const fetchData = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setLoadError("");

    try {
      const shippingRequest = api.get("/shipping").catch((error) => {
        console.warn("Shipping data could not be loaded for orders.", error);
        return { data: [] };
      });
      const workflowTasksRequest = api.get("/order-workflow/tasks").catch((error) => {
        console.warn("Order workflow tasks could not be loaded.", error);
        return { data: [] };
      });
      const followUpsRequest = api.get("/order-follow-ups").catch((error) => {
        console.warn("Order follow-ups could not be loaded.", error);
        return { data: [] };
      });
      const [
        ordersResponse,
        customersResponse,
        productsResponse,
        shippingResponse,
        workflowTasksResponse,
        followUpsResponse,
      ] =
        await Promise.all([
          api.get("/orders"),
          api.get("/customers"),
          api.get("/products"),
          shippingRequest,
          workflowTasksRequest,
          followUpsRequest,
        ]);

      setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
      setCustomers(
        Array.isArray(customersResponse.data) ? customersResponse.data : []
      );
      setProducts(
        Array.isArray(productsResponse.data) ? productsResponse.data : []
      );
      setShippingRecords(
        Array.isArray(shippingResponse.data) ? shippingResponse.data : []
      );
      setWorkflowTasks(
        Array.isArray(workflowTasksResponse.data) ? workflowTasksResponse.data : []
      );
      setFollowUps(
        Array.isArray(followUpsResponse.data) ? followUpsResponse.data : []
      );
    } catch (error) {
      console.error("Orders loading error:", error);
      setLoadError("Unable to load orders. Check the backend and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const shippingRequest = api.get("/shipping").catch((error) => {
      console.warn("Shipping data could not be loaded for orders.", error);
      return { data: [] };
    });
    const workflowTasksRequest = api.get("/order-workflow/tasks").catch((error) => {
      console.warn("Order workflow tasks could not be loaded.", error);
      return { data: [] };
    });
    const followUpsRequest = api.get("/order-follow-ups").catch((error) => {
      console.warn("Order follow-ups could not be loaded.", error);
      return { data: [] };
    });

    Promise.all([
      api.get("/orders"),
      api.get("/customers"),
      api.get("/products"),
      shippingRequest,
      workflowTasksRequest,
      followUpsRequest,
    ])
      .then(
        ([
          ordersResponse,
          customersResponse,
          productsResponse,
          shippingResponse,
          workflowTasksResponse,
          followUpsResponse,
        ]) => {
        if (!active) return;
        setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
        setCustomers(
          Array.isArray(customersResponse.data) ? customersResponse.data : []
        );
        setProducts(
          Array.isArray(productsResponse.data) ? productsResponse.data : []
        );
        setShippingRecords(
          Array.isArray(shippingResponse.data) ? shippingResponse.data : []
        );
        setWorkflowTasks(
          Array.isArray(workflowTasksResponse.data) ? workflowTasksResponse.data : []
        );
        setFollowUps(
          Array.isArray(followUpsResponse.data) ? followUpsResponse.data : []
        );
        setLoadError("");
      })
      .catch((error) => {
        console.error("Orders loading error:", error);
        if (active) {
          setLoadError("Unable to load orders. Check the backend and try again.");
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
    document.body.style.overflow = showForm ? "hidden" : "";

    const handleEscape = (event) => {
      if (event.key === "Escape" && showForm) {
        setShowForm(false);
        setEditingId(null);
        setEditingOrder(null);
        setForm(createEmptyForm());
        setFormError("");
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showForm]);

  useEffect(() => {
    if (!showExportOptions) return undefined;

    const handlePointerDown = (event) => {
      if (!exportOptionsRef.current?.contains(event.target)) {
        setShowExportOptions(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setShowExportOptions(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showExportOptions]);

  useEffect(() => {
    if (!excelView || loading) return undefined;

    let active = true;
    const requestId = excelViewRequestRef.current + 1;
    excelViewRequestRef.current = requestId;
    const timeoutId = window.setTimeout(async () => {
      setExcelViewLoading(true);
      setExcelViewError("");

      try {
        const response = await api.get("/orders/export-view", {
          params: {
            include_thumbnails: true,
            search: searchQuery.trim() || undefined,
            status: statusFilter,
          },
          timeout: 30000,
        });
        if (active && excelViewRequestRef.current === requestId) {
          setExcelViewData(response.data || null);
        }
      } catch (error) {
        console.error("Order Excel view error:", error);
        if (active && excelViewRequestRef.current === requestId) {
          setExcelViewError(
            error.response?.data?.detail || "Excel view could not be loaded."
          );
        }
      } finally {
        if (active && excelViewRequestRef.current === requestId) {
          setExcelViewLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    excelView,
    loading,
    orders,
    products,
    searchQuery,
    shippingRecords,
    statusFilter,
  ]);

  useEffect(() => {
    const handleLocationChange = () => {
      setSelectedOrderId(orderIdFromPath());
    };

    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("erp:navigation", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("erp:navigation", handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (
      !initialCustomerId ||
      loading ||
      handledInitialCustomerRef.current === initialCustomerId
    ) {
      return;
    }

    const customer = customers.find(
      (item) => item.id === Number(initialCustomerId)
    );
    if (!customer) return;

    handledInitialCustomerRef.current = initialCustomerId;
    const frameId = window.requestAnimationFrame(() => {
      setEditingId(null);
      setEditingOrder(null);
      setForm({
        ...createEmptyForm(),
        customer_id: String(customer.id),
        platform: customer.platform || "Manual",
      });
      setFormError("");
      setShowForm(true);
      onInitialCustomerHandled?.();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [customers, initialCustomerId, loading, onInitialCustomerHandled]);

  const openNewOrder = () => {
    setEditingId(null);
    setEditingOrder(null);
    setForm(createEmptyForm());
    setFormError("");
    setShowForm(true);
  };

  const openCsvImport = () => {
    if (importingCsv) return;
    csvInputRef.current?.click();
  };

  const downloadOrdersExcel = async (includeThumbnails = true) => {
    if (exportingOrders) return;

    setShowExportOptions(false);
    setExportingOrders(true);
    setLoadError("");
    setNotice("");

    try {
      const response = await api.get("/orders/export.xlsx", {
        params: {
          include_thumbnails: includeThumbnails,
          search: searchQuery.trim() || undefined,
          status: statusFilter,
        },
        responseType: "blob",
        timeout: 30000,
      });
      const disposition = response.headers?.["content-disposition"] || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename =
        filenameMatch?.[1] ||
        `hisbenew-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotice(
        includeThumbnails
          ? "Excel export downloaded with thumbnails."
          : "Excel export downloaded without thumbnails."
      );
    } catch (error) {
      console.error("Order Excel export error:", error);
      setLoadError(error.response?.data?.detail || "Orders could not be exported.");
    } finally {
      setExportingOrders(false);
    }
  };

  const reviewOrdersCsvFile = async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post("/orders/import-csv/review", formData, {
      timeout: 120000,
    });
    const review = {
      ...response.data,
      fileName: file.name,
    };
    setOrderImportReview(review);
    return review;
  };

  const importOrdersCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingCsv(true);
    setLoadError("");
    setNotice("");
    setOrderImportFile(file);
    setMissingCustomerAction("skip");

    try {
      const review = await reviewOrdersCsvFile(file);
      const missingCount = Number(review.missing_products_count || 0);
      const readyCount = Number(review.importable_orders || 0);
      setNotice(
        missingCount > 0
          ? `Review ready: ${readyCount} orders can import, ${missingCount} SKUs need products.`
          : `Review ready: ${readyCount} orders can import.`
      );
    } catch (error) {
      console.error("Order CSV import error:", error);
      setLoadError(
        error.code === "ECONNABORTED"
          ? "Order CSV review is taking longer than expected. Try again after checking the backend is running."
          : error.response?.data?.detail || "Order CSV could not be reviewed."
      );
    } finally {
      setImportingCsv(false);
      event.target.value = "";
    }
  };

  const closeOrderImportReview = () => {
    if (importingCsv || addingImportProducts || addingImportCustomers) return;
    setOrderImportReview(null);
    setOrderImportFile(null);
    setMissingCustomerAction("skip");
  };

  const addMissingImportProducts = async () => {
    const missingProducts = Array.isArray(orderImportReview?.missing_products)
      ? orderImportReview.missing_products
      : [];
    if (!missingProducts.length || addingImportProducts) return;

    setAddingImportProducts(true);
    setLoadError("");
    setNotice("");

    try {
      const response = await api.post("/orders/import-missing-products", {
        products: missingProducts.map((product) => ({
          sku: product.sku,
          name: product.name,
          wholesale_price: Number(product.wholesale_price || 0),
          retail_price: Number(product.retail_price || 0),
        })),
      }, {
        timeout: 120000,
      });
      const created = Number(response.data?.created || 0);
      const skipped = Number(response.data?.skipped || 0);
      await fetchData({ quiet: true });
      if (orderImportFile) {
        await reviewOrdersCsvFile(orderImportFile);
      }
      setNotice(`Added ${created} missing products.${skipped ? ` ${skipped} already existed.` : ""}`);
    } catch (error) {
      console.error("Missing product import error:", error);
      setLoadError(error.response?.data?.detail || "Missing products could not be added.");
    } finally {
      setAddingImportProducts(false);
    }
  };

  const addMissingImportCustomers = async () => {
    const missingCustomers = Array.isArray(orderImportReview?.missing_customers)
      ? orderImportReview.missing_customers
      : [];
    if (!missingCustomers.length || addingImportCustomers) return;

    setAddingImportCustomers(true);
    setLoadError("");
    setNotice("");

    try {
      const response = await api.post("/orders/import-missing-customers", {
        customers: missingCustomers.map((customer) => ({
          name: customer.name,
          company_name: customer.company_name,
          email: customer.email,
          phone: customer.phone,
          country: customer.country,
          address: customer.address,
          shipping_address: customer.shipping_address,
          platform: customer.platform || "Manual",
        })),
      }, {
        timeout: 120000,
      });
      const created = Number(response.data?.created || 0);
      const skipped = Number(response.data?.skipped || 0);
      await fetchData({ quiet: true });
      if (orderImportFile) {
        await reviewOrdersCsvFile(orderImportFile);
      }
      setMissingCustomerAction("skip");
      setNotice(
        `Added ${created} missing customers.${skipped ? ` ${skipped} already existed.` : ""}`
      );
    } catch (error) {
      console.error("Missing customer import error:", error);
      setLoadError(error.response?.data?.detail || "Missing customers could not be added.");
    } finally {
      setAddingImportCustomers(false);
    }
  };

  const confirmOrdersCsvImport = async () => {
    if (!orderImportFile || importingCsv) return;

    const formData = new FormData();
    formData.append("file", orderImportFile);
    formData.append(
      "missing_customer_action",
      missingCustomerAction === "add_later" ? "add_later" : "skip"
    );
    setImportingCsv(true);
    setLoadError("");
    setNotice("");

    try {
      const response = await api.post("/orders/import-csv", formData, {
        timeout: 240000,
      });
      const created = Number(response.data?.created || 0);
      const items = Number(response.data?.items || 0);
      const failed = Number(response.data?.failed || 0);
      const needsCustomerAssignment = Number(response.data?.needs_customer_assignment || 0);
      const firstError = response.data?.errors?.[0]?.detail;
      const importBatchKey = response.data?.import_batch_key;

      await fetchData({ quiet: true });
      setOrderImportReview(null);
      setOrderImportFile(null);
      setNotice(
        failed > 0
          ? `Imported ${created} orders (${items} SKU lines). ${failed} orders need review.${needsCustomerAssignment ? ` ${needsCustomerAssignment} imported orders need customer assignment.` : ""}${importBatchKey ? " Reverse this upload from Settings > Data." : ""}${firstError ? ` ${firstError}` : ""}`
          : `Imported ${created} orders (${items} SKU lines) from CSV.${needsCustomerAssignment ? ` ${needsCustomerAssignment} need customer assignment.` : ""}${importBatchKey ? " Reverse this upload from Settings > Data." : ""}`
      );
    } catch (error) {
      console.error("Order CSV import error:", error);
      setLoadError(error.response?.data?.detail || "Order CSV could not be imported.");
    } finally {
      setImportingCsv(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingOrder(null);
    setForm(createEmptyForm());
    setFormError("");
  };

  const handleMainChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleItemChange = (index, event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        const updatedItem = { ...item, [name]: value };
        if (name === "product_id") {
          const product = products.find(
            (entry) => entry.id === Number(value)
          );
          updatedItem.unit_price = Number(product?.selling_price || 0);
        }
        return updatedItem;
      }),
    }));
  };

  const addOrderItem = () => {
    setForm((current) => ({
      ...current,
      items: [...current.items, createEmptyItem()],
    }));
  };

  const removeOrderItem = (index) => {
    if (form.items.length === 1) {
      setFormError("An order must contain at least one product.");
      return;
    }

    setForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
    setFormError("");
  };

  const calculateTotal = () =>
    form.items.reduce(
      (total, item) =>
        total + Number(item.quantity || 0) * Number(item.unit_price || 0),
      0
    );

  const buildPayoutPayload = () => {
    const payoutAmount = Number(form.payout_amount_usd || 0);
    const existingStatus = editingOrder?.payout_status || "Not Received";
    const isReceived =
      Boolean(form.payout_received_date) ||
      ["Received", "Partially Received"].includes(existingStatus);

    return {
      order_total_usd: Number(editingOrder?.order_total_usd || 0),
      platform_fee_usd: Number(editingOrder?.platform_fee_usd || 0),
      deduction_usd: Number(editingOrder?.deduction_usd || 0),
      expected_payout_usd: payoutAmount,
      expected_payout_date: editingOrder?.expected_payout_date || null,
      payment_source: editingOrder?.payment_source || null,
      payout_status:
        payoutAmount > 0 && isReceived ? "Received" : "Not Received",
      received_payout_usd:
        payoutAmount > 0 && isReceived ? payoutAmount : 0,
      remaining_payout_usd:
        payoutAmount > 0 && !isReceived ? payoutAmount : 0,
      exchange_rate: Number(editingOrder?.exchange_rate || 0),
      received_pkr: Number(editingOrder?.received_pkr || 0),
      bank_charges_pkr: Number(editingOrder?.bank_charges_pkr || 0),
      final_received_pkr: Number(editingOrder?.final_received_pkr || 0),
      payout_notes: editingOrder?.payout_notes || null,
    };
  };

  const saveOrder = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!form.customer_id) {
      setFormError("Please select a customer.");
      return;
    }

    const invalidItem = form.items.find(
      (item) => !item.product_id || Number(item.quantity) <= 0
    );
    if (invalidItem) {
      setFormError(
        invalidItem.product_id
          ? "Quantity must be greater than zero."
          : "Please select a product in every row."
      );
      return;
    }

    const payload = {
      ...buildPayoutPayload(),
      order_no: form.order_no.trim(),
      customer_id: Number(form.customer_id),
      import_customer_name: editingOrder?.import_customer_name || null,
      import_customer_company_name:
        editingOrder?.import_customer_company_name || null,
      import_contact_name: editingOrder?.import_contact_name || null,
      import_contact_phone: editingOrder?.import_contact_phone || null,
      import_shipping_name: editingOrder?.import_shipping_name || null,
      import_shipping_address: editingOrder?.import_shipping_address || null,
      import_ship_date: editingOrder?.import_ship_date || null,
      platform: form.platform,
      payment_status: form.payment_status,
      shipping_status: form.shipping_status,
      notes: form.notes.trim(),
      payout_received_date: form.payout_received_date || null,
      items: form.items.map((item) => ({
        product_id: Number(item.product_id),
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        stock_source: item.stock_source,
      })),
    };

    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/orders/${editingId}`, payload);
        setNotice("Order updated successfully.");
      } else {
        await api.post("/orders", payload);
        setNotice("Order added successfully.");
      }

      closeForm();
      await fetchData({ quiet: true });
    } catch (error) {
      console.error("Save order error:", error);
      setFormError(error.response?.data?.detail || "Order could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (order) => {
    setEditingId(order.id);
    setEditingOrder(order);
    setForm({
      order_no: order.order_no || "",
      customer_id: String(order.customer_id || ""),
      platform: order.platform || "Manual",
      payment_status: order.payment_status || "Pending",
      shipping_status: order.shipping_status || "Pending",
      notes: order.notes || "",
      payout_amount_usd:
        order.payout_amount_usd ||
        order.expected_payout_usd ||
        order.received_payout_usd ||
        0,
      payout_received_date: order.payout_received_date
        ? order.payout_received_date.slice(0, 10)
        : "",
      items:
        order.items?.length > 0
          ? order.items.map((item) => ({
              product_id: String(item.product_id),
              quantity: item.quantity,
              unit_price: item.unit_price,
              stock_source: item.stock_source,
            }))
          : [createEmptyItem()],
    });
    setFormError("");
    setShowForm(true);
  };

  const toggleOrderSelection = (orderId) => {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleAllVisibleOrders = () => {
    setSelectedOrderIds((current) => {
      if (filteredOrders.length > 0 && current.size === filteredOrders.length) {
        return new Set();
      }
      return new Set(filteredOrders.map((order) => order.id));
    });
  };

  const exportOrdersCsv = (items = filteredOrders) => {
    downloadCsv(
      `hisbenew-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Order No",
        "Customer",
        "Company",
        "Platform",
        "Shipping Status",
        "Payment Status",
        "Total PKR",
        "Order Date",
        "Items",
      ],
      items.map((order) => {
        const customerDisplay = orderCustomerDisplay(order);
        return [
          order.order_no,
          customerDisplay.name,
          customerDisplay.company,
          order.platform,
          order.shipping_status,
          order.payment_status,
          order.total_amount,
          order.order_date,
          (order.items || [])
            .map((item) => `${item.quantity || 0} x ${item.article_no || item.product_name || "Item"}`)
            .join("; "),
        ];
      })
    );
  };

  const deleteOrders = async (items) => {
    if (!items.length || saving) return;
    const confirmed = await confirmDialog({
      title: `Delete ${items.length === 1 ? "order" : "orders"}?`,
      message: `This will permanently delete ${items.length} order${
        items.length === 1 ? "" : "s"
      } and reverse related stock reservations or deductions.`,
      detail: "This action cannot be undone.",
      tone: "danger",
      confirmText: items.length === 1 ? "Delete order" : "Delete orders",
    });
    if (!confirmed) return;

    try {
      await Promise.all(items.map((order) => api.delete(`/orders/${order.id}`)));
      const deletedIds = new Set(items.map((order) => order.id));
      setNotice(`${items.length} order${items.length === 1 ? "" : "s"} deleted and stock reversed successfully.`);
      if (deletedIds.has(selectedOrderId)) {
        window.history.pushState({}, "", "/portal/orders");
        setSelectedOrderId(null);
      }
      setSelectedOrderIds(new Set());
      await fetchData({ quiet: true });
    } catch (error) {
      console.error("Delete order error:", error);
      setNotice(error.response?.data?.detail || "Selected orders could not be deleted.");
    }
  };

  const handleDelete = (orderId) => {
    const order = orders.find((item) => item.id === orderId);
    if (order) deleteOrders([order]);
  };

  const buildOrderUpdatePayload = (order, overrides = {}) => ({
    order_no: order.order_no || "",
    customer_id: Number(order.customer_id),
    import_customer_name: order.import_customer_name || null,
    import_customer_company_name: order.import_customer_company_name || null,
    import_contact_name: order.import_contact_name || null,
    import_contact_phone: order.import_contact_phone || null,
    import_shipping_name: order.import_shipping_name || null,
    import_shipping_address: order.import_shipping_address || null,
    import_ship_date: order.import_ship_date || null,
    platform: order.platform || "Manual",
    payment_status: order.payment_status || "Pending",
    shipping_status: order.shipping_status || "Pending",
    notes: order.notes || "",
    order_total_usd: Number(order.order_total_usd || 0),
    platform_fee_usd: Number(order.platform_fee_usd || 0),
    deduction_usd: Number(order.deduction_usd || 0),
    expected_payout_usd: Number(order.expected_payout_usd || 0),
    expected_payout_date: order.expected_payout_date || null,
    payment_source: order.payment_source || null,
    payout_status: order.payout_status || "Not Received",
    received_payout_usd: Number(order.received_payout_usd || 0),
    remaining_payout_usd: Number(order.remaining_payout_usd || 0),
    exchange_rate: Number(order.exchange_rate || 0),
    received_pkr: Number(order.received_pkr || 0),
    bank_charges_pkr: Number(order.bank_charges_pkr || 0),
    final_received_pkr: Number(order.final_received_pkr || 0),
    payout_notes: order.payout_notes || null,
    payout_received_date: order.payout_received_date || null,
    items: (order.items || []).map((item) => ({
      product_id: Number(item.product_id),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      stock_source: item.stock_source || "Factory",
    })),
    ...overrides,
  });

  const bulkEditOrders = async () => {
    if (selectedOrders.length === 0 || saving) return;
    const status = window.prompt(
      `Apply a shipping status to ${selectedOrders.length} selected order${
        selectedOrders.length === 1 ? "" : "s"
      }. Enter status:`,
      "Pending"
    );
    if (status === null) return;
    const nextStatus = status.trim();
    if (!nextStatus) {
      setNotice("Bulk edit canceled: status cannot be blank.");
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        selectedOrders.map((order) =>
          api.put(
            `/orders/${order.id}`,
            buildOrderUpdatePayload(order, { shipping_status: nextStatus })
          )
        )
      );
      setSelectedOrderIds(new Set());
      setNotice(`${selectedOrders.length} order${selectedOrders.length === 1 ? "" : "s"} updated.`);
      await fetchData({ quiet: true });
    } catch (error) {
      console.error("Bulk order edit error:", error);
      setNotice(error.response?.data?.detail || "Selected orders could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const handleShippingDraftChange = (event) => {
    const { name, value } = event.target;
    setShippingDraft((current) => ({ ...current, [name]: value }));
  };

  const formatAmount = (value) =>
    Number(value || 0).toLocaleString("en-PK", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });

  const formatUsdAmount = (value) =>
    Number(value || 0).toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });

  const formatDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getOrderGroup = (order) => {
    const status = normalizeStatusValue(order.shipping_status);
    if (CANCELED_STATUSES.has(status)) return "Canceled";
    if (FULFILLED_SHIPPING_STATUSES.has(status)) return "Fulfilled";
    return "Unfulfilled";
  };

  const shippingByOrderId = useMemo(
    () =>
      new Map(
        shippingRecords
          .filter((record) => record.order_id)
          .map((record) => [Number(record.order_id), record])
      ),
    [shippingRecords]
  );
  const workflowTasksByOrderId = useMemo(() => {
    const grouped = new Map();
    workflowTasks.forEach((task) => {
      const orderId = Number(task.order_id);
      if (!orderId) return;
      grouped.set(orderId, [...(grouped.get(orderId) || []), task]);
    });
    return grouped;
  }, [workflowTasks]);
  const followUpsByOrderId = useMemo(
    () =>
      new Map(
        followUps
          .filter((followUp) => followUp.order_id)
          .map((followUp) => [Number(followUp.order_id), followUp])
      ),
    [followUps]
  );

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return orders
      .filter((order) => {
        const shippingRecord = shippingByOrderId.get(order.id);
        const customerDisplay = orderCustomerDisplay(order);
        const matchesStatus =
          statusFilter === "All" || getOrderGroup(order) === statusFilter;
        const matchesSearch =
          !query ||
          [
            order.order_no,
            customerDisplay.name,
            customerDisplay.company,
            order.import_customer_name,
            order.import_customer_company_name,
            order.import_contact_name,
            order.import_contact_phone,
            order.import_shipping_name,
            order.import_shipping_address,
            order.import_ship_date,
            order.platform,
            order.shipping_status,
            shippingRecord?.courier_name,
            shippingRecord?.tracking_number,
            ...(order.items || []).flatMap((item) => [
              item.article_no,
              item.product_name,
            ]),
          ].some((value) => String(value || "").toLowerCase().includes(query));

        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => orderSortTime(b) - orderSortTime(a) || Number(b.id || 0) - Number(a.id || 0));
  }, [orders, searchQuery, shippingByOrderId, statusFilter]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setSelectedOrderIds((current) => {
        if (current.size === 0) return current;
        const visibleIds = new Set(filteredOrders.map((order) => order.id));
        const next = new Set([...current].filter((id) => visibleIds.has(id)));
        return next.size === current.size ? current : next;
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [filteredOrders]);

  const selectedOrders = filteredOrders.filter((order) =>
    selectedOrderIds.has(order.id)
  );
  const allVisibleOrdersSelected =
    filteredOrders.length > 0 && selectedOrderIds.size === filteredOrders.length;

  const orderSummary = useMemo(() => {
    const groupCounts = orders.reduce(
      (counts, order) => {
        const group = getOrderGroup(order);
        counts[group] = (counts[group] || 0) + 1;
        return counts;
      },
      { All: orders.length, Unfulfilled: 0, Fulfilled: 0, Canceled: 0 }
    );
    const totalRevenue = orders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0
    );
    const itemsReserved = orders.reduce(
      (sum, order) =>
        sum +
        (order.items || []).reduce(
          (itemTotal, item) => itemTotal + Number(item.quantity || 0),
          0
        ),
      0
    );

    return {
      groupCounts,
      itemsReserved,
      totalRevenue,
    };
  }, [orders]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );
  const selectedShipping = selectedOrder
    ? shippingByOrderId.get(selectedOrder.id) || null
    : null;
  const selectedWorkflowTasks = selectedOrder
    ? workflowTasksByOrderId.get(selectedOrder.id) || []
    : [];
  const selectedFollowUp = selectedOrder
    ? followUpsByOrderId.get(selectedOrder.id) || null
    : null;
  const selectedProgress = selectedOrder
    ? getOrderProgressInfo(
        selectedOrder,
        selectedShipping,
        selectedWorkflowTasks,
        selectedFollowUp
      )
    : null;
  const selectedProgressSteps =
    selectedOrder && selectedProgress
      ? getOrderWorkflowSteps(
          selectedOrder,
          selectedShipping,
          selectedWorkflowTasks,
          selectedProgress,
          formatDate,
          selectedFollowUp
        )
      : [];
  const selectedCurrentStep =
    selectedProgressSteps.find((step) => step.state === "active") ||
    [...selectedProgressSteps].reverse().find((step) => step.state === "complete") ||
    selectedProgressSteps[0] ||
    null;
  const selectedTotalQuantity = (selectedOrder?.items || []).reduce(
    (total, item) => total + Number(item.quantity || 0),
    0
  );
  const selectedPayoutBreakdown = selectedOrder
    ? getOrderPayoutBreakdown(selectedOrder)
    : null;
  const importReviewOrders = Array.isArray(orderImportReview?.orders)
    ? orderImportReview.orders
    : [];
  const importMissingProducts = Array.isArray(orderImportReview?.missing_products)
    ? orderImportReview.missing_products
    : [];
  const importMissingCustomers = Array.isArray(orderImportReview?.missing_customers)
    ? orderImportReview.missing_customers
    : [];
  const importReadyOrders = Number(orderImportReview?.importable_orders || 0);
  const importBlockedOrders = Number(orderImportReview?.blocked_orders || 0);
  const importCustomerLaterOrders = importReviewOrders.filter(
    (order) => order.can_import_with_customer_later
  );
  const importCustomerLaterCount = Number(
    orderImportReview?.customer_later_orders_count ?? importCustomerLaterOrders.length
  );
  const importImportableWithAction =
    importReadyOrders +
    (missingCustomerAction === "add_later" ? importCustomerLaterCount : 0);
  const importReviewIssueCount = Number(
    orderImportReview?.issue_count ??
      importReviewOrders.reduce(
        (total, order) => total + (Array.isArray(order.issues) ? order.issues.length : 0),
        0
      )
  );
  useEffect(() => {
    const nextDraft = selectedOrder
      ? {
          courier_name: selectedShipping?.courier_name || "",
          tracking_number: selectedShipping?.tracking_number || "",
          package_weight_kg: selectedShipping?.package_weight_kg || "",
          shipping_cost: selectedShipping?.shipping_cost || "",
          shipping_note: selectedShipping?.shipping_note || "",
        }
      : createEmptyShippingDraft();

    const frameId = window.requestAnimationFrame(() => {
      setShippingDraft(nextDraft);
      setShippingFormError("");
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    selectedOrder,
    selectedShipping?.courier_name,
    selectedShipping?.package_weight_kg,
    selectedShipping?.shipping_cost,
    selectedShipping?.shipping_note,
    selectedShipping?.tracking_number,
  ]);

  const saveShippingDetails = async (event) => {
    event.preventDefault();
    if (!selectedOrder) return;

    const packageWeight =
      String(shippingDraft.package_weight_kg).trim() === ""
        ? null
        : Number(shippingDraft.package_weight_kg);
    const shippingCost =
      String(shippingDraft.shipping_cost).trim() === ""
        ? null
        : Number(shippingDraft.shipping_cost);

    if (
      packageWeight !== null &&
      (!Number.isFinite(packageWeight) || packageWeight <= 0)
    ) {
      setShippingFormError("Package weight must be greater than zero.");
      return;
    }

    if (
      shippingCost !== null &&
      (!Number.isFinite(shippingCost) || shippingCost < 0)
    ) {
      setShippingFormError("Shipping cost cannot be negative.");
      return;
    }

    const payload = {
      courier_name: shippingDraft.courier_name.trim(),
      tracking_number: shippingDraft.tracking_number.trim(),
      package_weight_kg: packageWeight,
      shipping_cost: shippingCost,
      shipping_note: shippingDraft.shipping_note.trim(),
    };

    setSavingShipping(true);
    setShippingFormError("");
    try {
      if (selectedShipping?.id) {
        await api.patch(`/shipping/${selectedShipping.id}`, payload);
        setNotice("Shipping details updated.");
      } else {
        await api.post("/shipping/mark-shipped", {
          order_id: selectedOrder.id,
          ...payload,
        });
        setNotice("Tracking saved and order moved to shipping.");
      }

      await fetchData({ quiet: true });
    } catch (error) {
      console.error("Save shipping details error:", error);
      setShippingFormError(
        error.response?.data?.detail || "Shipping details could not be saved."
      );
    } finally {
      setSavingShipping(false);
    }
  };

  const markSelectedDelivered = async () => {
    if (!selectedOrder || isOrderDelivered(selectedOrder)) return;

    setUpdatingStage("delivered");
    setShippingFormError("");
    try {
      await api.put(
        `/orders/${selectedOrder.id}`,
        buildOrderUpdatePayload(selectedOrder, {
          shipping_status: "Delivered",
        })
      );
      setNotice("Order marked delivered.");
      await fetchData({ quiet: true });
    } catch (error) {
      console.error("Mark delivered error:", error);
      setShippingFormError(
        error.response?.data?.detail || "Order could not be marked delivered."
      );
    } finally {
      setUpdatingStage("");
    }
  };

  const renderOrderProgressMini = (order) => {
    const shippingRecord = shippingByOrderId.get(order.id) || null;
    const orderTasks = workflowTasksByOrderId.get(order.id) || [];
    const followUp = followUpsByOrderId.get(order.id) || null;
    const progress = getOrderProgressInfo(
      order,
      shippingRecord,
      orderTasks,
      followUp
    );

    return (
      <div
        aria-label={`Order progress: ${progress.label}`}
        className="orders-progress-mini"
      >
        <div className="orders-progress-mini-track" aria-hidden="true">
          {ORDER_PROGRESS_STEPS.map((step, index) => (
            <span
              className={`orders-progress-mini-segment is-${getOrderStepState(
                progress,
                index
              )}`}
              key={step.key}
            />
          ))}
        </div>
        <span>{progress.label}</span>
      </div>
    );
  };

  const openOrderPage = (order) => {
    window.history.pushState({}, "", `/portal/orders/${order.id}`);
    setSelectedOrderId(order.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeOrderPage = () => {
    window.history.pushState({}, "", "/portal/orders");
    setSelectedOrderId(null);
  };

  const handleOrderRowKeyDown = (event, order) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOrderPage(order);
    }
  };

  const excelColumns = Array.isArray(excelViewData?.columns)
    ? excelViewData.columns
    : [];
  const excelRows = Array.isArray(excelViewData?.rows) ? excelViewData.rows : [];
  const excelFrozenColumns = Number(excelViewData?.frozen_columns || 0);
  const excelColumnWidth = (column) =>
    Math.max(64, Math.min(280, Number(column?.width || 12) * 8));
  const excelFrozenLeft = (columnIndex) =>
    EXCEL_ROW_HEADER_WIDTH +
    excelColumns
      .slice(0, Math.max(0, Number(columnIndex || 1) - 1))
      .reduce((sum, column) => sum + excelColumnWidth(column), 0);
  const excelFrozenStyle = (columnIndex) =>
    Number(columnIndex || 0) <= excelFrozenColumns
      ? { left: `${excelFrozenLeft(columnIndex)}px` }
      : undefined;

  const renderExcelCellContent = (cell, row) => {
    const showProductImage =
      excelViewData?.include_thumbnails &&
      row.kind === "product" &&
      Number(cell.column) === 1;
    if (showProductImage) {
      const imageUrl = getStaticUrl(row.product?.image_url);
      return imageUrl ? (
        <img
          alt={row.product?.sku || row.product?.name || "Product"}
          className="orders-excel-product-image"
          src={imageUrl}
        />
      ) : (
        <span className="orders-excel-product-placeholder">Image</span>
      );
    }

    if (cell.value) return cell.value;
    if (cell.formula) {
      return <span className="orders-excel-formula">{cell.formula}</span>;
    }
    return "";
  };

  const renderExcelView = () => {
    if (excelViewLoading && !excelViewData) {
      return (
        <div className="orders-excel-state">
          Preparing live Excel view...
        </div>
      );
    }

    if (excelViewError && !excelViewData) {
      return <div className="orders-excel-state error">{excelViewError}</div>;
    }

    if (!excelViewData || excelColumns.length === 0) {
      return <div className="orders-excel-state">Turn on Excel view to load the sheet.</div>;
    }

    return (
      <div className="orders-excel-shell">
        <div className="orders-excel-meta">
          <span>
            {excelViewLoading
              ? "Refreshing live Excel view..."
              : `${excelViewData.product_count || 0} products x ${
                  excelViewData.order_count || 0
                } orders`}
          </span>
          {excelViewError && <strong>{excelViewError}</strong>}
        </div>
        <div className="orders-excel-scroll">
          <table className="orders-excel-table">
            <colgroup>
              <col style={{ width: `${EXCEL_ROW_HEADER_WIDTH}px` }} />
              {excelColumns.map((column) => (
                <col
                  key={column.index}
                  style={{ width: `${excelColumnWidth(column)}px` }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  className="orders-excel-corner"
                  style={{ width: `${EXCEL_ROW_HEADER_WIDTH}px` }}
                />
                {excelColumns.map((column) => (
                  <th
                    className={`orders-excel-column-letter ${
                      column.frozen ? "is-frozen" : ""
                    }`}
                    key={column.index}
                    style={excelFrozenStyle(column.index)}
                  >
                    {column.letter}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {excelRows.map((row) => (
                <tr
                  className={`orders-excel-row is-${row.kind || "body"}`}
                  key={row.index}
                  style={
                    row.height
                      ? { height: `${Math.max(Number(row.height), 24)}px` }
                      : undefined
                  }
                >
                  <th className="orders-excel-row-number">{row.index}</th>
                  {(row.cells || []).map((cell) => (
                    <td
                      className={[
                        "orders-excel-cell",
                        `style-${cell.style || 6}`,
                        Number(cell.column) <= excelFrozenColumns
                          ? "is-frozen"
                          : "",
                        cell.formula ? "has-formula" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={cell.ref}
                      style={excelFrozenStyle(cell.column)}
                      title={cell.formula || cell.value || cell.ref}
                    >
                      {renderExcelCellContent(cell, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="orders-page">
      <header className={`orders-faire-header ${showSummary ? "is-expanded" : ""}`}>
        <div className="orders-header-title">
          <span>Sales</span>
          <h1>Orders</h1>
        </div>
        <div className="orders-header-actions">
          <input
            accept=".csv,text/csv"
            className="orders-file-input"
            onChange={importOrdersCsv}
            ref={csvInputRef}
            type="file"
          />
          <button
            className="orders-create-button"
            onClick={openNewOrder}
            type="button"
          >
            Create order
          </button>
          <div className="orders-export-menu" ref={exportOptionsRef}>
            <button
              aria-expanded={showExportOptions}
              aria-haspopup="menu"
              className="orders-export-button"
              disabled={exportingOrders || loading}
              onClick={() => setShowExportOptions((current) => !current)}
              title="Download orders as Excel"
              type="button"
            >
              <ExcelIcon />
              {exportingOrders ? "Exporting" : "Excel"}
            </button>
            {showExportOptions && (
              <div
                aria-label="Excel export options"
                className="orders-export-options"
                role="menu"
              >
                <button
                  onClick={() => downloadOrdersExcel(true)}
                  role="menuitem"
                  type="button"
                >
                  Include thumbnails
                </button>
                <button
                  onClick={() => downloadOrdersExcel(false)}
                  role="menuitem"
                  type="button"
                >
                  Without thumbnails
                </button>
              </div>
            )}
          </div>
          <button
            className="orders-import-button"
            disabled={importingCsv}
            onClick={openCsvImport}
            type="button"
          >
            <UploadIcon />
            {importingCsv ? "Reviewing" : "Upload CSV"}
          </button>
          <button
            aria-controls="orders-header-summary"
            aria-expanded={showSummary}
            className="overview-header-toggle"
            onClick={() => setShowSummary((current) => !current)}
            type="button"
          >
            Overview
            <span aria-hidden="true" className="overview-toggle-chevron" />
          </button>
        </div>

        {showSummary && (
        <section
          aria-label="Order summary"
          className="orders-summary-strip"
          id="orders-header-summary"
        >
          <article>
            <span>Total orders</span>
            <strong>{orders.length}</strong>
          </article>
          <article>
            <span>Need action</span>
            <strong>{orderSummary.groupCounts.Unfulfilled}</strong>
          </article>
          <article>
            <span>Items reserved</span>
            <strong>{orderSummary.itemsReserved}</strong>
          </article>
          <article>
            <span>Order value</span>
            <strong>PKR {formatAmount(orderSummary.totalRevenue)}</strong>
          </article>
        </section>
        )}
      </header>

      {loadError && <div className="orders-message error">{loadError}</div>}
      {notice && (
        <div className="orders-message success">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} type="button">
            Close
          </button>
        </div>
      )}

      {orderImportReview && (
        <div
          className="orders-import-review-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeOrderImportReview();
          }}
        >
          <section
            aria-labelledby="orders-import-review-title"
            aria-modal="true"
            className="orders-import-review-modal"
            role="dialog"
          >
            <div className="orders-import-review-header">
              <div>
                <span>{orderImportReview.source_format || "CSV"}</span>
                <h3 id="orders-import-review-title">Order import review</h3>
                <p>{orderImportReview.fileName}</p>
              </div>
              <button
                aria-label="Close order import review"
                className="close-btn"
                disabled={importingCsv || addingImportProducts || addingImportCustomers}
                onClick={closeOrderImportReview}
                type="button"
              >
                &times;
              </button>
            </div>

            <div className="orders-import-review-summary">
              <article>
                <span>CSV rows</span>
                <strong>{orderImportReview.total_rows || 0}</strong>
              </article>
              <article>
                <span>Orders</span>
                <strong>{orderImportReview.orders_count || 0}</strong>
              </article>
              <article>
                <span>Ready</span>
                <strong>{importReadyOrders}</strong>
              </article>
              <article>
                <span>Blocked</span>
                <strong>{importBlockedOrders}</strong>
              </article>
              <article>
                <span>Missing SKUs</span>
                <strong>{importMissingProducts.length}</strong>
              </article>
              <article>
                <span>Unmatched customers</span>
                <strong>{importMissingCustomers.length}</strong>
              </article>
            </div>

            {orderImportReview.orders_truncated && (
              <div className="orders-import-info">
                Showing first {orderImportReview.preview_count || importReviewOrders.length} of{" "}
                {orderImportReview.orders_count || importReviewOrders.length} orders. Import will still process the full CSV.
              </div>
            )}

            {importMissingProducts.length > 0 && (
              <div className="orders-import-missing-panel">
                <div>
                  <strong>{importMissingProducts.length} SKUs are not in ERP</strong>
                  <ul>
                    {importMissingProducts.slice(0, 8).map((product) => (
                      <li key={product.sku}>
                        <span>{product.sku}</span>
                        <em>{product.name || "Unnamed product"}</em>
                        <strong>Qty {product.quantity || 0}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  className="orders-import-action-button"
                  disabled={addingImportProducts}
                  onClick={addMissingImportProducts}
                  type="button"
                >
                  {addingImportProducts ? "Adding" : "Add missing products"}
                </button>
              </div>
            )}

            {importMissingCustomers.length > 0 && (
              <div className="orders-import-missing-panel orders-import-customer-panel">
                <div>
                  <strong>{importMissingCustomers.length} customers are not matched</strong>
                  <ul>
                    {importMissingCustomers.slice(0, 8).map((customer) => (
                      <li key={customer.key}>
                        <span>{customer.name || customer.company_name || "No name"}</span>
                        <em>
                          {customer.email ||
                            customer.phone ||
                            customer.shipping_address ||
                            customer.address ||
                            "Details from order sheet"}
                        </em>
                        <strong>{customer.orders_count || 0} orders</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="orders-import-customer-actions">
                  <button
                    className="orders-import-action-button"
                    disabled={addingImportCustomers}
                    onClick={addMissingImportCustomers}
                    type="button"
                  >
                    {addingImportCustomers ? "Adding" : "Add customers now"}
                  </button>
                  <button
                    className={`orders-import-secondary-button ${
                      missingCustomerAction === "add_later" ? "is-selected" : ""
                    }`}
                    disabled={addingImportCustomers || importCustomerLaterCount === 0}
                    onClick={() => setMissingCustomerAction("add_later")}
                    type="button"
                  >
                    Add later
                  </button>
                  <button
                    className={`orders-import-secondary-button ${
                      missingCustomerAction === "skip" ? "is-selected" : ""
                    }`}
                    disabled={addingImportCustomers}
                    onClick={() => setMissingCustomerAction("skip")}
                    type="button"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}

            {missingCustomerAction === "add_later" && importCustomerLaterCount > 0 && (
              <div className="orders-import-warning">
                {importCustomerLaterCount} unmatched customer orders will import now and be highlighted for customer assignment.
              </div>
            )}

            {importReviewIssueCount > 0 && (
              <div className="orders-import-warning">
                {importReviewIssueCount} import issues found. Ready orders can still be imported.
              </div>
            )}

            <div className="orders-import-review-list">
              {importReviewOrders.map((order) => {
                const payoutBreakdown = getOrderPayoutBreakdown(order);

                return (
                <article
                  className={`orders-import-order-card ${order.can_import ? "" : "has-issues"}`}
                  key={order.key}
                >
                  <div className="orders-import-order-head">
                    <div>
                      <span>{order.order_no || "Auto order number"}</span>
                      <h4>
                        {order.import_customer_company_name ||
                          order.retailer_name ||
                          order.customer_name ||
                          "Unknown retailer"}
                      </h4>
                      <p>
                        {order.customer_name
                          ? `Matched: ${order.customer_name}${
                              order.customer_match_reason
                                ? ` (${order.customer_match_reason})`
                                : ""
                            }`
                          : "Customer not matched"}{" "}
                        - {order.status || "Pending"} - {formatDate(order.order_date)}
                      </p>
                      {(order.import_contact_name ||
                        order.import_contact_phone ||
                        order.import_shipping_address) && (
                        <p>
                          {order.import_contact_name
                            ? `Contact: ${order.import_contact_name}`
                            : ""}
                          {order.import_contact_phone
                            ? `${order.import_contact_name ? " - " : ""}Phone: ${
                                order.import_contact_phone
                              }`
                            : ""}
                          {(order.import_contact_name ||
                            order.import_contact_phone) &&
                          order.import_shipping_address
                            ? " - "
                            : ""}
                          {order.import_shipping_address
                            ? `Ship to: ${order.import_shipping_address}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <div className="orders-import-order-total">
                      <span>{order.line_count || 0} SKU lines</span>
                      <strong>{order.total_quantity || 0} units</strong>
                      <em>Gross USD {formatAmount(payoutBreakdown.gross)}</em>
                      {payoutBreakdown.hasUsd && (
                        <>
                          <em className="orders-import-final-payout">
                            Final USD {formatAmount(payoutBreakdown.final)}
                          </em>
                          {payoutBreakdown.isFaire && (
                            <small>
                              -USD {formatAmount(payoutBreakdown.commission)} commission
                              {" / "}
                              -USD {formatAmount(payoutBreakdown.payoutFee)} fee
                            </small>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {Array.isArray(order.issues) && order.issues.length > 0 && (
                    <ul className="orders-import-issues">
                      {order.issues.map((issue, index) => (
                        <li key={`${order.key}-issue-${index}`}>{issue.detail}</li>
                      ))}
                    </ul>
                  )}

                  <div className="orders-import-items">
                    {(order.items || []).map((item) => {
                      const product = item.product;
                      const thumbnail = product?.image_url;
                      return (
                        <div
                          className={`orders-import-item ${item.missing_product ? "is-missing" : ""}`}
                          key={`${order.key}-${item.sku || item.product_name}`}
                        >
                          {thumbnail ? (
                            <img
                              alt={product.name || item.product_name || "Product"}
                              src={getStaticUrl(thumbnail)}
                            />
                          ) : (
                            <span>
                              {getProductInitials(
                                item.sku || product?.article_no,
                                item.product_name || product?.name
                              )}
                            </span>
                          )}
                          <div>
                            <strong>{item.sku || product?.article_no || "No SKU"}</strong>
                            <p>{item.product_name || product?.name || "Missing product"}</p>
                            <em>
                              Qty {item.quantity || 0} - USD {formatAmount(item.unit_price || 0)}
                            </em>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
                );
              })}
            </div>

            <div className="orders-import-review-footer">
              <button
                className="orders-import-secondary-button"
                disabled={importingCsv || addingImportProducts || addingImportCustomers}
                onClick={closeOrderImportReview}
                type="button"
              >
                Close
              </button>
              <button
                className="orders-import-action-button"
                disabled={importingCsv || addingImportCustomers || importImportableWithAction === 0}
                onClick={confirmOrdersCsvImport}
                type="button"
              >
                {importingCsv
                  ? "Importing"
                  : missingCustomerAction === "add_later"
                    ? `Import ${importImportableWithAction} orders`
                    : "Import ready orders"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onMouseDown={closeForm}>
          <div
            aria-modal="true"
            className="modal-panel"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-panel-header">
              <h3>{editingId ? "Edit order" : "Create order"}</h3>
              <button
                aria-label="Close order form"
                className="close-btn"
                onClick={closeForm}
                type="button"
              >
                &times;
              </button>
            </div>

            <form onSubmit={saveOrder}>
              {formError && (
                <div className="orders-message error">{formError}</div>
              )}

              <section className="orders-form-section">
                <div className="orders-form-section-heading">
                  <h4>Order information</h4>
                </div>
                <div className="product-form">
                  <div className="form-group">
                    <label>Order number</label>
                    <input
                      name="order_no"
                      onChange={handleMainChange}
                      placeholder="Auto-generated if blank"
                      value={form.order_no}
                    />
                  </div>

                  <div className="form-group">
                    <label>Customer</label>
                    <select
                      name="customer_id"
                      onChange={handleMainChange}
                      required
                      value={form.customer_id}
                    >
                      <option value="">Select customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name} -{" "}
                          {customer.company_name ||
                            customer.platform ||
                            "Manual"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Platform</label>
                    <select
                      name="platform"
                      onChange={handleMainChange}
                      value={form.platform}
                    >
                      <option value="Manual">Manual</option>
                      <option value="Faire">Faire</option>
                      <option value="Shopify">Shopify</option>
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="Amazon">Amazon</option>
                      <option value="Website">Website</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Shipping status</label>
                    <select
                      name="shipping_status"
                      onChange={handleMainChange}
                      value={form.shipping_status}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Packed">Packed</option>
                      <option value="Dispatched">Dispatched</option>
                      <option value="Delivered">Delivered</option>
                    </select>
                  </div>

                  <div className="form-group orders-notes-field">
                    <label>Notes</label>
                    <input
                      name="notes"
                      onChange={handleMainChange}
                      placeholder="Optional order notes"
                      value={form.notes}
                    />
                  </div>
                </div>
              </section>

              <section className="payout-box">
                <div className="panel-header">
                  <h3>Payout</h3>
                </div>
                <div className="product-form">
                  <div className="form-group">
                    <label>Payout amount (USD)</label>
                    <input
                      min="0"
                      name="payout_amount_usd"
                      onChange={handleMainChange}
                      step="0.01"
                      type="number"
                      value={form.payout_amount_usd}
                    />
                  </div>
                  <div className="form-group">
                    <label>Released date</label>
                    <input
                      name="payout_received_date"
                      onChange={handleMainChange}
                      type="date"
                      value={form.payout_received_date}
                    />
                  </div>
                </div>
              </section>

              <div className="order-items-box">
                <div className="panel-header">
                  <h3>Products</h3>
                  <button onClick={addOrderItem} type="button">
                    Add product
                  </button>
                </div>

                {form.items.map((item, index) => {
                  const selectedProduct = products.find(
                    (product) => product.id === Number(item.product_id)
                  );

                  return (
                    <div className="order-item-row" key={index}>
                      <div
                        className={`orders-form-product ${
                          selectedProduct ? "has-thumbnail" : ""
                        }`}
                      >
                        {selectedProduct?.image_url ? (
                          <img
                            alt={selectedProduct.name || "Selected product"}
                            className="orders-product-thumbnail"
                            src={getStaticUrl(selectedProduct.image_url)}
                          />
                        ) : selectedProduct ? (
                          <span className="orders-product-thumbnail-placeholder">
                            {getProductInitials(
                              selectedProduct.article_no,
                              selectedProduct.name
                            )}
                          </span>
                        ) : null}
                        <div className="form-group">
                          <label>Product</label>
                          <select
                            name="product_id"
                            onChange={(event) => handleItemChange(index, event)}
                            required
                            value={item.product_id}
                          >
                            <option value="">Select product</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.article_no} - {product.name} |
                                Available: {product.available_stock}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Quantity</label>
                        <input
                          min="1"
                          name="quantity"
                          onChange={(event) => handleItemChange(index, event)}
                          required
                          type="number"
                          value={item.quantity}
                        />
                      </div>

                      <div className="form-group">
                        <label>Stock source</label>
                        <select
                          name="stock_source"
                          onChange={(event) => handleItemChange(index, event)}
                          value={item.stock_source}
                        >
                          <option value="Factory">Factory</option>
                          <option value="USA">USA</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Line total</label>
                        <input
                          readOnly
                          value={
                            Number(item.quantity) * Number(item.unit_price)
                          }
                        />
                      </div>

                      <button
                        className="delete-btn"
                        onClick={() => removeOrderItem(index)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}

                <div className="order-total-box">
                  <span>Order total</span>
                  <strong>PKR {formatAmount(calculateTotal())}</strong>
                </div>
              </div>

              <div className="orders-form-actions">
                <button
                  className="orders-form-cancel"
                  onClick={closeForm}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-btn form-submit"
                  disabled={saving}
                  type="submit"
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Update order"
                      : "Create order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedOrderId ? (
        <section className="orders-detail-page">
          {loading ? (
            <div className="orders-detail-state">Loading order...</div>
          ) : !selectedOrder ? (
            <div className="orders-detail-state">
              <h2>Order not found</h2>
              <button onClick={closeOrderPage} type="button">
                Back to orders
              </button>
            </div>
          ) : (
            <>
              <div className="orders-detail-hero">
                <div className="orders-detail-hero-main">
                  <button
                    className="orders-back-button"
                    onClick={closeOrderPage}
                    type="button"
                  >
                    Back to orders
                  </button>
                  <div className="orders-detail-kicker">
                    <span>Order detail</span>
                    <span>Placed {formatDate(selectedOrder.order_date)}</span>
                  </div>
                  <div className="orders-detail-title">
                    <h2>#{selectedOrder.order_no}</h2>
                    <span
                      className={`orders-status ${getOrderGroup(selectedOrder).toLowerCase()}`}
                    >
                      {getOrderGroup(selectedOrder)}
                    </span>
                  </div>
                  <p>
                    {orderCustomerDisplay(selectedOrder).name}
                    {orderCustomerDisplay(selectedOrder).company
                      ? ` / ${orderCustomerDisplay(selectedOrder).company}`
                      : ""}
                  </p>
                </div>
                <div className="orders-detail-actions">
                  <button
                    className="orders-detail-edit"
                    onClick={() => handleEdit(selectedOrder)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="orders-detail-delete"
                    onClick={() => handleDelete(selectedOrder.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="orders-detail-content">
                <main className="orders-detail-main">
                  <section className="orders-detail-overview-card">
                    <div className="orders-detail-summary">
                      <div>
                        <span>Platform</span>
                        <strong>{selectedOrder.platform || "Manual"}</strong>
                      </div>
                      <div>
                        <span>Payment</span>
                        <strong>{selectedOrder.payment_status || "Pending"}</strong>
                      </div>
                      <div>
                        <span>Articles</span>
                        <strong>{selectedTotalQuantity} pcs</strong>
                      </div>
                      <div>
                        <span>Total</span>
                        <strong>
                          PKR {formatAmount(selectedOrder.total_amount)}
                        </strong>
                      </div>
                    </div>
                  </section>

                  {selectedPayoutBreakdown?.hasUsd && (
                    <section className="orders-detail-section orders-payout-breakdown-section">
                      <div className="orders-detail-section-heading">
                        <div>
                          <span>Payout</span>
                          <h3>
                            {selectedPayoutBreakdown.isFaire
                              ? "Faire payout breakdown"
                              : "USD payout breakdown"}
                          </h3>
                        </div>
                        <strong>
                          Final USD {formatAmount(selectedPayoutBreakdown.final)}
                        </strong>
                      </div>

                      <div className="orders-payout-breakdown-grid">
                        <div>
                          <span>Gross order</span>
                          <strong>
                            USD {formatAmount(selectedPayoutBreakdown.gross)}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {selectedPayoutBreakdown.isFaire
                              ? "Faire commission (15%)"
                              : "Platform fee"}
                          </span>
                          <strong>
                            -USD {formatAmount(selectedPayoutBreakdown.commission)}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {selectedPayoutBreakdown.isFaire
                              ? "Payout fee (2.9%)"
                              : "Deductions"}
                          </span>
                          <strong>
                            -USD {formatAmount(selectedPayoutBreakdown.payoutFee)}
                          </strong>
                        </div>
                        <div className="is-final">
                          <span>Final payout</span>
                          <strong>
                            USD {formatAmount(selectedPayoutBreakdown.final)}
                          </strong>
                        </div>
                      </div>

                      <div className="orders-payout-breakdown-meta">
                        <span>
                          Received USD {formatAmount(selectedPayoutBreakdown.received)}
                        </span>
                        <span>
                          Remaining USD {formatAmount(selectedPayoutBreakdown.remaining)}
                        </span>
                        <span>{selectedOrder.payout_status || "Not Received"}</span>
                      </div>
                    </section>
                  )}

                  {selectedProgress && (
                    <section
                      aria-label="Order progress"
                      className="orders-detail-progress"
                    >
                      <div className="orders-progress-heading">
                        <div>
                          <span>Current step</span>
                          <h3>{selectedCurrentStep?.title || "Order workflow"}</h3>
                          {selectedCurrentStep?.detail && (
                            <p>{selectedCurrentStep.detail}</p>
                          )}
                        </div>
                        <strong>
                          {selectedProgress.completedSteps} of{" "}
                          {ORDER_PROGRESS_STEPS.length}
                        </strong>
                      </div>

                      <ol
                        className="orders-progress-track"
                        style={{
                          "--orders-progress-percent": `${selectedProgress.percent}%`,
                        }}
                      >
                        {selectedProgressSteps.map((step) => (
                          <li
                            className={`orders-progress-step is-${step.state}`}
                            key={step.key}
                          >
                            <span className="orders-progress-node" />
                            <div className="orders-progress-copy">
                              <span>{step.label}</span>
                              <strong>{step.title}</strong>
                              <small>{step.meta}</small>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}

                  <section className="orders-detail-section orders-items-section">
                    <div className="orders-detail-section-heading">
                      <div>
                        <span>Articles</span>
                        <h3>Order items</h3>
                      </div>
                      <strong>
                        {selectedOrder.items?.length || 0} lines /{" "}
                        {selectedTotalQuantity} pcs
                      </strong>
                    </div>
                    <div className="orders-detail-items-grid">
                      {(selectedOrder.items || []).map((item) => (
                        <article
                          className="orders-detail-item-card"
                          key={item.id || `${item.product_id}-${item.article_no}`}
                        >
                          {item.product_image_url ? (
                            <img
                              alt={item.article_no || item.product_name || "Product"}
                              className="orders-product-thumbnail"
                              src={getStaticUrl(item.product_image_url)}
                            />
                          ) : (
                            <span className="orders-product-thumbnail-placeholder">
                              {getProductInitials(
                                item.article_no,
                                item.product_name
                              )}
                            </span>
                          )}
                          <div>
                            <strong>{item.article_no || "Product"}</strong>
                            <span>{item.product_name || "No product name"}</span>
                            <div className="orders-detail-item-meta">
                              <em>{item.stock_source || "Factory"}</em>
                              <em>PKR {formatAmount(Number(item.unit_price || 0))}</em>
                            </div>
                          </div>
                          <b>x {item.quantity}</b>
                        </article>
                      ))}
                    </div>
                  </section>

                  {selectedOrder.notes && (
                    <section className="orders-detail-section orders-detail-notes">
                      <div className="orders-detail-section-heading">
                        <div>
                          <span>Internal</span>
                          <h3>Notes</h3>
                        </div>
                      </div>
                      <p>{selectedOrder.notes}</p>
                    </section>
                  )}
                </main>

                <aside className="orders-detail-side">
                  {(selectedOrder.import_contact_name ||
                    selectedOrder.import_contact_phone ||
                    selectedOrder.import_shipping_name ||
                    selectedOrder.import_shipping_address) && (
                    <section className="orders-detail-panel orders-imported-panel">
                      <div className="orders-shipping-form-heading">
                        <h4>Imported order info</h4>
                        <span>From upload</span>
                      </div>
                      <div className="orders-imported-info">
                        {selectedOrder.import_contact_name && (
                          <div>
                            <span>Order contact</span>
                            <strong>{selectedOrder.import_contact_name}</strong>
                          </div>
                        )}
                        {selectedOrder.import_contact_phone && (
                          <div>
                            <span>Order phone</span>
                            <strong>{selectedOrder.import_contact_phone}</strong>
                          </div>
                        )}
                        {selectedOrder.import_shipping_name && (
                          <div>
                            <span>Ship-to name</span>
                            <strong>{selectedOrder.import_shipping_name}</strong>
                          </div>
                        )}
                        {selectedOrder.import_shipping_address && (
                          <div>
                            <span>Ship-to address</span>
                            <strong>{selectedOrder.import_shipping_address}</strong>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  <section className="orders-detail-panel orders-next-panel">
                    <div className="orders-shipping-form-heading">
                      <h4>Fulfillment</h4>
                      <span>{selectedOrder.shipping_status || "Pending"}</span>
                    </div>
                    <div className="orders-progress-snapshot">
                      <div>
                        <span>Courier</span>
                        <strong>
                          {selectedShipping?.courier_name || "Not set"}
                        </strong>
                      </div>
                      <div>
                        <span>Tracking</span>
                        <strong>
                          {selectedShipping?.tracking_number || "Not added"}
                        </strong>
                      </div>
                      <div>
                        <span>Weight</span>
                        <strong>
                          {formatWeight(selectedShipping?.package_weight_kg)}
                        </strong>
                      </div>
                      <div>
                        <span>Delivered</span>
                        <strong>
                          {isOrderDelivered(selectedOrder) ? "Yes" : "Pending"}
                        </strong>
                      </div>
                    </div>
                  </section>

                  <section className="orders-detail-panel orders-review-panel">
                    <div className="orders-shipping-form-heading">
                      <h4>Review follow-up</h4>
                      <span>{selectedFollowUp?.status || "Not created"}</span>
                    </div>
                    <div className="orders-review-summary">
                      <div>
                        <span>Review</span>
                        <strong>
                          {hasReviewProvided(selectedFollowUp)
                            ? "Provided"
                            : selectedFollowUp?.status === "No Review"
                              ? "No review"
                              : "Pending"}
                        </strong>
                      </div>
                      <div>
                        <span>Channel</span>
                        <strong>{selectedFollowUp?.channel || "-"}</strong>
                      </div>
                      <div>
                        <span>Followed up</span>
                        <strong>{formatDate(selectedFollowUp?.followed_up_at)}</strong>
                      </div>
                    </div>
                    {selectedFollowUp?.review_note && (
                      <p className="orders-review-note">
                        {selectedFollowUp.review_note}
                      </p>
                    )}
                    <a className="orders-review-link" href="/portal/follow-ups">
                      Open follow-ups
                    </a>
                  </section>

                  <form
                    className="orders-shipping-quick-form orders-detail-panel"
                    onSubmit={saveShippingDetails}
                  >
                    <div className="orders-shipping-form-heading">
                      <h4>Shipping details</h4>
                      <span>
                        {selectedShipping ? "Update tracking" : "Add tracking"}
                      </span>
                    </div>

                    <div className="orders-shipping-fields">
                      <label>
                        <span>Courier</span>
                        <input
                          name="courier_name"
                          onChange={handleShippingDraftChange}
                          placeholder="Courier name"
                          value={shippingDraft.courier_name}
                        />
                      </label>
                      <label>
                        <span>Tracking number</span>
                        <input
                          name="tracking_number"
                          onChange={handleShippingDraftChange}
                          placeholder="Tracking number"
                          value={shippingDraft.tracking_number}
                        />
                      </label>
                      <label>
                        <span>Weight (kg)</span>
                        <input
                          min="0"
                          name="package_weight_kg"
                          onChange={handleShippingDraftChange}
                          placeholder="0.00"
                          step="0.01"
                          type="number"
                          value={shippingDraft.package_weight_kg}
                        />
                      </label>
                      <label>
                        <span>Cost (PKR)</span>
                        <input
                          min="0"
                          name="shipping_cost"
                          onChange={handleShippingDraftChange}
                          placeholder="0"
                          step="0.01"
                          type="number"
                          value={shippingDraft.shipping_cost}
                        />
                      </label>
                      <label className="orders-shipping-note-field">
                        <span>Shipping note</span>
                        <input
                          name="shipping_note"
                          onChange={handleShippingDraftChange}
                          placeholder="Optional note"
                          value={shippingDraft.shipping_note}
                        />
                      </label>
                    </div>

                    {shippingFormError && (
                      <div className="orders-inline-error">
                        {shippingFormError}
                      </div>
                    )}

                    <div className="orders-progress-actions">
                      <button disabled={savingShipping} type="submit">
                        {savingShipping
                          ? "Saving..."
                          : selectedShipping
                            ? "Update shipping"
                            : "Save tracking"}
                      </button>
                      <button
                        disabled={
                          updatingStage === "delivered" ||
                          isOrderDelivered(selectedOrder)
                        }
                        onClick={markSelectedDelivered}
                        type="button"
                      >
                        {isOrderDelivered(selectedOrder)
                          ? "Delivered"
                          : updatingStage === "delivered"
                            ? "Updating..."
                            : "Mark delivered"}
                      </button>
                    </div>
                  </form>

                </aside>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="orders-workspace">
          <nav aria-label="Order status" className="orders-tabs">
            {["All", "Unfulfilled", "Fulfilled", "Canceled"].map((status) => (
              <button
                aria-current={statusFilter === status ? "page" : undefined}
                className={statusFilter === status ? "is-active" : ""}
                key={status}
                onClick={() => setStatusFilter(status)}
                type="button"
              >
                <span>{status}</span>
                <strong>{orderSummary.groupCounts[status] || 0}</strong>
              </button>
            ))}
          </nav>

          <div className="orders-filter-bar">
            <label className="orders-search">
              <svg
                aria-hidden="true"
                fill="none"
                height="18"
                viewBox="0 0 24 24"
                width="18"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search customer, order number, or product"
                type="search"
                value={searchQuery}
              />
            </label>
            <div className="orders-filter-actions">
              <span className="orders-result-count">
                {excelView && excelViewData
                  ? `${excelViewData.order_count || 0} ${
                      Number(excelViewData.order_count || 0) === 1
                        ? "order"
                        : "orders"
                    } in Excel view`
                  : `${filteredOrders.length} ${
                      filteredOrders.length === 1 ? "order" : "orders"
                    }`}
              </span>
              <button
                aria-pressed={excelView}
                className={`orders-excel-view-toggle ${
                  excelView ? "is-active" : ""
                }`}
                onClick={() => setExcelView((current) => !current)}
                type="button"
              >
                <ExcelIcon size={16} />
                <span>Excel view</span>
                <span aria-hidden="true" className="orders-toggle-switch">
                  <span />
                </span>
              </button>
            </div>
          </div>

          {!excelView && selectedOrders.length > 0 && (
            <div className="orders-bulk-action-bar">
              <div>
                <strong>{selectedOrders.length} selected</strong>
                <button onClick={() => setSelectedOrderIds(new Set())} type="button">
                  Clear selection
                </button>
              </div>
              <div className="orders-bulk-actions">
                <button onClick={bulkEditOrders} type="button">
                  Bulk edit
                </button>
                <button onClick={() => exportOrdersCsv(selectedOrders)} type="button">
                  <ExcelIcon size={15} />
                  Export
                </button>
                <button
                  className="is-danger"
                  onClick={() => deleteOrders(selectedOrders)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {excelView ? (
            renderExcelView()
          ) : (
          <div className="table-wrap">
            <table className="orders-table">
              <colgroup>
                <col className="orders-col-select" />
                <col className="orders-col-order" />
                <col className="orders-col-status" />
                <col className="orders-col-customer" />
                <col className="orders-col-total" />
                <col className="orders-col-date" />
                <col className="orders-col-platform" />
                <col className="orders-col-progress" />
                <col className="orders-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th className="orders-select-column">
                    <input
                      aria-label="Select all visible orders"
                      checked={allVisibleOrdersSelected}
                      onChange={toggleAllVisibleOrders}
                      type="checkbox"
                    />
                  </th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Order date</th>
                  <th>Platform</th>
                  <th>Progress</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="orders-table-state" colSpan="9">
                      Loading orders...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td className="orders-table-state" colSpan="9">
                      No orders found.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const needsCustomerAssignment = orderNeedsCustomerAssignment(order);
                    const customerDisplay = orderCustomerDisplay(order);
                    const payoutBreakdown = getOrderPayoutBreakdown(order);
                    return (
                    <tr
                      aria-label={`Open order ${order.order_no}`}
                      className={`orders-clickable-row ${
                        needsCustomerAssignment ? "needs-customer-assignment" : ""
                      }`}
                      key={order.id}
                      onClick={() => openOrderPage(order)}
                      onKeyDown={(event) =>
                        handleOrderRowKeyDown(event, order)
                      }
                      role="link"
                      tabIndex="0"
                    >
                      <td className="orders-select-cell" data-label="Select">
                        <input
                          aria-label={`Select order ${order.order_no}`}
                          checked={selectedOrderIds.has(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                          onClick={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                      </td>
                      <td className="orders-order-number" data-label="Order">#{order.order_no}</td>
                      <td data-label="Status">
                        <span
                          className={`orders-status ${getOrderGroup(order).toLowerCase()}`}
                        >
                          {getOrderGroup(order)}
                        </span>
                      </td>
                      <td className="orders-customer-cell" data-label="Customer">
                        <div
                          className={`orders-customer-stack ${
                            needsCustomerAssignment ? "needs-assignment" : ""
                          }`}
                        >
                          <strong>{customerDisplay.name}</strong>
                          {customerDisplay.company && (
                            <span>{customerDisplay.company}</span>
                          )}
                          {needsCustomerAssignment && (
                            <>
                              <em>Needs customer assignment</em>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEdit(order);
                              }}
                              type="button"
                            >
                              Add / assign
                            </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="orders-total-cell" data-label="Total">
                        <strong>
                          {payoutBreakdown.hasUsd
                            ? `$${formatUsdAmount(payoutBreakdown.final)}`
                            : `PKR ${formatAmount(order.total_amount)}`}
                        </strong>
                      </td>
                      <td data-label="Date">{formatDate(order.order_date)}</td>
                      <td data-label="Platform">{order.platform || "Manual"}</td>
                      <td className="orders-progress-cell" data-label="Progress">
                        {renderOrderProgressMini(order)}
                      </td>
                      <td className="orders-actions-cell" data-label="Actions">
                        <button
                          className="orders-text-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEdit(order);
                          }}
                          title="Edit order"
                          type="button"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}
        </section>
      )}
    </div>
  );
}

export default Orders;
