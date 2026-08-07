import { useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import { buildPdfDocument } from "../utils/reportPdf";
import "./Reports.css";

const REPORT_GROUPS = [
  { label: "Sales and finance", keys: ["orders", "sales", "profitability", "payouts"] },
  { label: "Customers and supply", keys: ["customers", "suppliers", "supplierPayments"] },
  { label: "Stock and delivery", keys: ["inventory", "lowStock", "movements", "shipping"] },
  { label: "Factory performance", keys: ["batches", "tasks", "workers"] },
];

const DEFAULT_FILTERS = {
  datePreset: "all",
  startDate: "",
  endDate: "",
  search: "",
  customer: "",
  product: "",
  category: "",
  platform: "",
  paymentStatus: "",
  shippingStatus: "",
  payoutStatus: "",
  stockState: "",
  courier: "",
  supplier: "",
  movementType: "",
  batchStatus: "",
  taskStatus: "",
  worker: "",
  priority: "",
  paymentMethod: "",
  country: "",
  department: "",
};

const datePresets = [
  ["all", "All time"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last7", "Last 7 days"],
  ["last30", "Last 30 days"],
  ["thisWeek", "This week"],
  ["thisMonth", "This month"],
  ["lastMonth", "Last month"],
  ["thisYear", "This year"],
  ["custom", "Custom dates"],
];

const formatNumber = (value, digits = 0) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const formatCurrency = (value, currency = "PKR") =>
  `${currency} ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  const date = parseUtcLocal(value);
  if (!date) return "-";
  return date.toLocaleDateString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const formatted = formatUtcLocal(value);
  return formatted === "â€”" ? "-" : formatted;
};

const orderValue = (order) => {
  const recorded = Number(order.total_amount || 0);
  if (recorded) return recorded;
  return (order.items || []).reduce(
    (sum, item) => sum + Number(item.line_total || Number(item.quantity || 0) * Number(item.unit_price || 0)),
    0
  );
};

const orderQuantity = (order) =>
  (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);

const uniqueOptions = (values) =>
  Array.from(new Set(values.filter((value) => value !== null && value !== undefined && value !== "")))
    .map(String)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const toDateInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getPresetDates = (preset) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  const end = new Date(today);

  if (preset === "all") return { startDate: "", endDate: "" };
  if (preset === "today") return { startDate: toDateInput(today), endDate: toDateInput(today) };
  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    return { startDate: toDateInput(start), endDate: toDateInput(start) };
  }
  if (preset === "last7") {
    start.setDate(start.getDate() - 6);
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }
  if (preset === "last30") {
    start.setDate(start.getDate() - 29);
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }
  if (preset === "thisWeek") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }
  if (preset === "thisMonth") {
    start.setDate(1);
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }
  if (preset === "lastMonth") {
    start.setMonth(start.getMonth() - 1, 1);
    end.setDate(0);
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }
  if (preset === "thisYear") {
    start.setMonth(0, 1);
    return { startDate: toDateInput(start), endDate: toDateInput(end) };
  }
  return null;
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function Icon({ name, size = 18 }) {
  const paths = {
    report: (
      <>
        <path d="M5 3h14v18H5z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    filter: (
      <>
        <path d="M4 5h16M7 12h10M10 19h4" />
      </>
    ),
    csv: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M8 13h8M8 17h5" />
      </>
    ),
    pdf: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M8 13h8M8 17h8" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </>
    ),
    generate: (
      <>
        <path d="M4 4h16v16H4z" />
        <path d="M8 15V9M12 15V6M16 15v-3" />
      </>
    ),
    sort: <path d="m8 9 4-4 4 4M16 15l-4 4-4-4" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    alert: (
      <>
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function Reports() {
  const [data, setData] = useState({
    products: [],
    orders: [],
    customers: [],
    workers: [],
    shipping: [],
    movements: [],
    suppliers: [],
    batches: [],
    productionSummary: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reportType, setReportType] = useState("orders");
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [generatedAt, setGeneratedAt] = useState(new Date());
  const [sortConfig, setSortConfig] = useState({ key: "order_date", direction: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      const endpoints = [
        ["products", "/products"],
        ["orders", "/orders"],
        ["customers", "/customers"],
        ["workers", "/workers"],
        ["shipping", "/shipping"],
        ["movements", "/stock-movements"],
        ["suppliers", "/suppliers"],
        ["batches", "/production/batches"],
        ["productionSummary", "/production/summary"],
      ];

      const results = await Promise.all(
        endpoints.map(async ([key, endpoint]) => {
          try {
            const response = await api.get(endpoint);
            return [key, response.data, null];
          } catch (error) {
            console.error(`Report fetch ${endpoint} failed:`, error);
            return [key, key === "productionSummary" ? null : [], endpoint];
          }
        })
      );

      if (!active) return;
      const nextData = {};
      const failed = [];
      results.forEach(([key, value, failedEndpoint]) => {
        nextData[key] = value;
        if (failedEndpoint) failed.push(failedEndpoint);
      });
      setData(nextData);
      setLoadError(
        failed.length
          ? `Some report sources could not be loaded: ${failed.join(", ")}`
          : ""
      );
      setLoading(false);
    };

    fetchData();
    return () => {
      active = false;
    };
  }, []);

  const reportDefinitions = useMemo(() => {
    const productMap = new Map(data.products.map((product) => [Number(product.id), product]));
    const customerMap = new Map(data.customers.map((customer) => [Number(customer.id), customer]));

    const orderRows = data.orders.map((order) => {
      const total = orderValue(order);
      const quantity = orderQuantity(order);
      return {
        order_no: order.order_no || order.id,
        order_date: order.order_date,
        customer: order.customer_name || customerMap.get(Number(order.customer_id))?.name || "Unknown",
        platform: order.platform || "Manual",
        item_lines: (order.items || []).length,
        quantity,
        shipping_status: order.shipping_status || "Pending",
        payment_status: order.payment_status || "Pending",
        payout_status: order.payout_status || "Not Received",
        total,
        _date: order.order_date,
        _customer: String(order.customer_id || ""),
        _platform: order.platform || "Manual",
        _paymentStatus: order.payment_status || "Pending",
        _shippingStatus: order.shipping_status || "Pending",
        _payoutStatus: order.payout_status || "Not Received",
        _search: [
          order.order_no,
          order.customer_name,
          order.platform,
          ...(order.items || []).flatMap((item) => [item.article_no, item.product_name]),
        ].join(" "),
      };
    });

    const salesRows = data.orders.flatMap((order) =>
      (order.items || []).map((item) => {
        const product = productMap.get(Number(item.product_id));
        return {
          order_date: order.order_date,
          order_no: order.order_no || order.id,
          article: item.article_no || product?.article_no || "-",
          product: item.product_name || product?.name || "Unknown",
          customer: order.customer_name || "Unknown",
          platform: order.platform || "Manual",
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          revenue: Number(item.line_total || Number(item.quantity || 0) * Number(item.unit_price || 0)),
          stock_source: item.stock_source || "-",
          _date: order.order_date,
          _customer: String(order.customer_id || ""),
          _product: String(item.product_id || ""),
          _category: product?.category || "Uncategorized",
          _platform: order.platform || "Manual",
          _search: [
            order.order_no,
            order.customer_name,
            item.article_no,
            item.product_name,
            product?.category,
          ].join(" "),
        };
      })
    );

    const profitabilityRows = data.orders.map((order) => {
      const revenue = orderValue(order);
      const cost = (order.items || []).reduce((sum, item) => {
        const productCost =
          Number(item.product_cost_price || 0) ||
          Number(productMap.get(Number(item.product_id))?.cost_price || 0);
        return sum + Number(item.quantity || 0) * productCost;
      }, 0);
      const profit = revenue - cost;
      return {
        order_date: order.order_date,
        order_no: order.order_no || order.id,
        customer: order.customer_name || "Unknown",
        platform: order.platform || "Manual",
        revenue,
        product_cost: cost,
        gross_profit: profit,
        margin: revenue ? (profit / revenue) * 100 : 0,
        _date: order.order_date,
        _customer: String(order.customer_id || ""),
        _platform: order.platform || "Manual",
        _search: [order.order_no, order.customer_name, order.platform].join(" "),
      };
    });

    const payoutRows = data.orders.map((order) => {
      const expected = Number(order.expected_payout_usd || order.payout_amount_usd || 0);
      const received = Number(order.received_payout_usd || 0);
      const remaining =
        Number(order.remaining_payout_usd || 0) || Math.max(0, expected - received);
      return {
        order_date: order.order_date,
        order_no: order.order_no || order.id,
        customer: order.customer_name || "Unknown",
        platform: order.platform || "Manual",
        expected,
        received,
        remaining,
        payout_status: order.payout_status || "Not Received",
        payment_source: order.payment_source || "-",
        received_date: order.payout_received_date,
        _date: order.order_date,
        _customer: String(order.customer_id || ""),
        _platform: order.platform || "Manual",
        _paymentStatus: order.payment_status || "Pending",
        _payoutStatus: order.payout_status || "Not Received",
        _search: [order.order_no, order.customer_name, order.payment_source, order.payout_status].join(" "),
      };
    });

    const customerRows = data.customers.map((customer) => {
      const customerOrders = data.orders.filter(
        (order) => Number(order.customer_id) === Number(customer.id)
      );
      return {
        customer: customer.name || "Unknown",
        company: customer.company_name || "-",
        country: customer.country || "-",
        platform: customer.platform || "Manual",
        phone: customer.phone || "-",
        orders: customerOrders.length,
        revenue: customerOrders.reduce((sum, order) => sum + orderValue(order), 0),
        last_order: customerOrders
          .map((order) => order.order_date)
          .filter(Boolean)
          .sort()
          .at(-1),
        _customer: String(customer.id),
        _platform: customer.platform || "Manual",
        _country: customer.country || "-",
        _search: [
          customer.name,
          customer.company_name,
          customer.email,
          customer.phone,
          customer.country,
        ].join(" "),
      };
    });

    const inventoryRows = data.products.map((product) => {
      const available = Number(product.available_stock || 0);
      const alert = Number(product.low_stock_alert || 0);
      const state = available <= 0 ? "Out of stock" : available <= alert ? "Low stock" : "Healthy";
      return {
        article: product.article_no,
        product: product.name,
        category: product.category || "Uncategorized",
        factory: Number(product.factory_stock || 0),
        usa: Number(product.usa_stock || 0),
        reserved: Number(product.reserved_stock || 0),
        available,
        alert_level: alert,
        stock_value: available * Number(product.cost_price || 0),
        stock_state: state,
        _product: String(product.id),
        _category: product.category || "Uncategorized",
        _stockState: state,
        _search: [product.article_no, product.name, product.category].join(" "),
      };
    });

    const movementRows = data.movements.map((movement) => ({
      movement_date: movement.created_at,
      article: movement.article_no || "-",
      product: movement.product_name || "Unknown",
      movement_type: movement.movement_type || "-",
      quantity: Number(movement.quantity || 0),
      source: movement.source || "-",
      supplier: movement.supplier_name || "-",
      reference: movement.reference || "-",
      faulty_quantity: Number(movement.faulty_quantity || 0),
      _date: movement.created_at,
      _product: String(movement.product_id || ""),
      _supplier: String(movement.supplier_id || ""),
      _movementType: movement.movement_type || "-",
      _search: [
        movement.article_no,
        movement.product_name,
        movement.movement_type,
        movement.source,
        movement.supplier_name,
        movement.reference,
      ].join(" "),
    }));

    const shippingRows = data.shipping.map((shipment) => ({
      shipped_at: shipment.shipped_at || shipment.created_at,
      order_no: shipment.order_no || shipment.order_id,
      customer: shipment.customer_name || "Unknown",
      courier: shipment.courier_name || "Not assigned",
      tracking: shipment.tracking_number || "-",
      weight: Number(shipment.package_weight_kg || 0),
      shipping_cost: Number(shipment.shipping_cost || 0),
      cost_status: Number(shipment.shipping_cost || 0) > 0 ? "Recorded" : "Missing",
      note: shipment.shipping_note || "-",
      _date: shipment.shipped_at || shipment.created_at,
      _courier: shipment.courier_name || "Not assigned",
      _search: [
        shipment.order_no,
        shipment.customer_name,
        shipment.courier_name,
        shipment.tracking_number,
      ].join(" "),
    }));

    const supplierRows = data.suppliers.map((supplier) => {
      const purchases = supplier.stock_movements || [];
      const supplyPurchases = supplier.supply_items || [];
      const payments = supplier.payments || [];
      const stockPurchaseValue = purchases.reduce(
        (sum, movement) =>
          sum + Number(movement.quantity || 0) * Number(movement.purchase_price || 0),
        0
      );
      const supplyPurchaseValue = supplyPurchases.reduce(
        (sum, item) => sum + Number(item.line_total || 0),
        0
      );
      return {
        supplier: supplier.name,
        contact: supplier.contact_person || "-",
        phone: supplier.phone || "-",
        purchase_entries: purchases.length + supplyPurchases.length,
        purchased_value: stockPurchaseValue + supplyPurchaseValue,
        payments: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
        balance: Number(supplier.balance_due || 0),
        balance_status: supplier.balance_status || "Settled",
        _date: supplier.created_at,
        _supplier: String(supplier.id),
        _search: [
          supplier.name,
          supplier.contact_person,
          supplier.email,
          supplier.phone,
          supplier.balance_status,
          ...supplyPurchases.map((item) => item.item_name),
          ...supplyPurchases.map((item) => item.category),
        ].join(" "),
      };
    });

    const supplierPaymentRows = data.suppliers.flatMap((supplier) =>
      (supplier.payments || []).map((payment) => ({
        payment_date: payment.payment_date || payment.created_at,
        supplier: supplier.name,
        amount: Number(payment.amount || 0),
        payment_method: payment.payment_method || "-",
        reference: payment.payment_reference || "-",
        note: payment.note || "-",
        _date: payment.payment_date || payment.created_at,
        _supplier: String(supplier.id),
        _paymentMethod: payment.payment_method || "-",
        _search: [
          supplier.name,
          payment.payment_method,
          payment.payment_reference,
          payment.note,
        ].join(" "),
      }))
    );

    const batchRows = data.batches.map((batch) => ({
      created_at: batch.created_at,
      batch_no: batch.batch_no,
      article: batch.article_no,
      product: batch.product_name,
      quantity: Number(batch.batch_quantity || 0),
      priority: batch.priority || "Normal",
      status: batch.status || "Pending",
      progress: Number(batch.progress_percent || 0),
      tasks: Number(batch.total_tasks || 0),
      due_date: batch.due_date,
      due_status: batch.due_status || "-",
      labor_cost: Number(batch.actual_labor_cost || batch.estimated_labor_cost || 0),
      _date: batch.created_at,
      _product: String(batch.product_id || ""),
      _batchStatus: batch.status || "Pending",
      _priority: batch.priority || "Normal",
      _search: [batch.batch_no, batch.article_no, batch.product_name, batch.status].join(" "),
    }));

    const taskRows = data.batches.flatMap((batch) =>
      (batch.tasks || []).map((task) => ({
        created_at: task.created_at,
        batch_no: batch.batch_no,
        article: task.article_no || batch.article_no,
        operation: task.step_name,
        worker: task.worker_name || "Unassigned",
        status: task.status || "Ready",
        timing: task.timing_status || "-",
        assigned: Number(task.assigned_quantity || 0),
        completed: Number(task.completed_quantity || 0),
        progress: Number(task.progress_percent || 0),
        labor_cost: Number(task.labor_cost || 0),
        _date: task.created_at,
        _product: String(task.product_id || batch.product_id || ""),
        _batchStatus: batch.status || "Pending",
        _taskStatus: task.status || "Ready",
        _worker: String(task.worker_id || ""),
        _priority: batch.priority || "Normal",
        _search: [
          batch.batch_no,
          task.article_no,
          task.product_name,
          task.step_name,
          task.worker_name,
          task.status,
        ].join(" "),
      }))
    );

    const allTasks = data.batches.flatMap((batch) => batch.tasks || []);
    const workerRows = data.workers.map((worker) => {
      const tasks = allTasks.filter((task) => Number(task.worker_id) === Number(worker.id));
      const completed = tasks.filter(
        (task) => String(task.status || "").toLowerCase() === "completed"
      );
      const assigned = tasks.reduce((sum, task) => sum + Number(task.assigned_quantity || 0), 0);
      const completedUnits = tasks.reduce(
        (sum, task) => sum + Number(task.completed_quantity || 0),
        0
      );
      return {
        worker: worker.name,
        role: worker.role || "Worker",
        department: worker.department || "-",
        active: worker.is_active ? "Active" : "Inactive",
        tasks: tasks.length,
        completed_tasks: completed.length,
        assigned_units: assigned,
        completed_units: completedUnits,
        completion_rate: tasks.length ? (completed.length / tasks.length) * 100 : 0,
        labor_cost: tasks.reduce((sum, task) => sum + Number(task.labor_cost || 0), 0),
        _worker: String(worker.id),
        _department: worker.department || "-",
        _search: [worker.name, worker.role, worker.department].join(" "),
      };
    });

    const columns = {
      orders: [
        ["order_no", "Order", "text", 0.8],
        ["order_date", "Date", "date", 1.05],
        ["customer", "Customer", "text", 1.35],
        ["platform", "Platform", "text", 0.85],
        ["item_lines", "Lines", "number", 0.55],
        ["quantity", "Units", "number", 0.55],
        ["shipping_status", "Shipping", "status", 0.9],
        ["payment_status", "Payment", "status", 0.9],
        ["payout_status", "Payout", "status", 1],
        ["total", "Total", "currencyPkr", 1.05],
      ],
      sales: [
        ["order_date", "Date", "date", 1],
        ["order_no", "Order", "text", 0.7],
        ["article", "Article", "text", 0.85],
        ["product", "Product", "text", 1.5],
        ["customer", "Customer", "text", 1.25],
        ["platform", "Platform", "text", 0.75],
        ["quantity", "Qty", "number", 0.5],
        ["unit_price", "Unit price", "currencyPkr", 0.95],
        ["revenue", "Revenue", "currencyPkr", 1],
        ["stock_source", "Stock", "text", 0.75],
      ],
      profitability: [
        ["order_date", "Date", "date", 1],
        ["order_no", "Order", "text", 0.8],
        ["customer", "Customer", "text", 1.4],
        ["platform", "Platform", "text", 0.9],
        ["revenue", "Revenue", "currencyPkr", 1.1],
        ["product_cost", "Product cost", "currencyPkr", 1.1],
        ["gross_profit", "Gross profit", "currencyPkr", 1.1],
        ["margin", "Margin", "percent", 0.8],
      ],
      payouts: [
        ["order_date", "Order date", "date", 1],
        ["order_no", "Order", "text", 0.75],
        ["customer", "Customer", "text", 1.35],
        ["platform", "Platform", "text", 0.8],
        ["expected", "Expected", "currencyUsd", 1],
        ["received", "Received", "currencyUsd", 1],
        ["remaining", "Remaining", "currencyUsd", 1],
        ["payout_status", "Status", "status", 1],
        ["payment_source", "Source", "text", 0.9],
        ["received_date", "Received date", "date", 1],
      ],
      customers: [
        ["customer", "Customer", "text", 1.35],
        ["company", "Company", "text", 1.2],
        ["country", "Country", "text", 0.9],
        ["platform", "Platform", "text", 0.8],
        ["phone", "Phone", "text", 1],
        ["orders", "Orders", "number", 0.65],
        ["revenue", "Revenue", "currencyPkr", 1],
        ["last_order", "Last order", "date", 1],
      ],
      inventory: [
        ["article", "Article", "text", 0.85],
        ["product", "Product", "text", 1.55],
        ["category", "Category", "text", 1.1],
        ["factory", "Factory", "number", 0.65],
        ["usa", "USA", "number", 0.55],
        ["reserved", "Reserved", "number", 0.7],
        ["available", "Available", "number", 0.75],
        ["alert_level", "Alert at", "number", 0.65],
        ["stock_value", "Stock value", "currencyPkr", 1],
        ["stock_state", "Status", "status", 0.9],
      ],
      movements: [
        ["movement_date", "Date", "dateTime", 1.1],
        ["article", "Article", "text", 0.8],
        ["product", "Product", "text", 1.4],
        ["movement_type", "Movement", "text", 1.1],
        ["quantity", "Qty", "number", 0.55],
        ["source", "Source", "text", 0.9],
        ["supplier", "Supplier", "text", 0.9],
        ["reference", "Reference", "text", 0.85],
        ["faulty_quantity", "Faulty", "number", 0.6],
      ],
      shipping: [
        ["shipped_at", "Shipped", "date", 0.95],
        ["order_no", "Order", "text", 0.7],
        ["customer", "Customer", "text", 1.3],
        ["courier", "Courier", "text", 1],
        ["tracking", "Tracking", "text", 1.1],
        ["weight", "Weight kg", "decimal", 0.75],
        ["shipping_cost", "Cost", "currencyPkr", 0.95],
        ["cost_status", "Cost status", "status", 0.9],
        ["note", "Note", "text", 1.25],
      ],
      suppliers: [
        ["supplier", "Supplier", "text", 1.35],
        ["contact", "Contact", "text", 1.1],
        ["phone", "Phone", "text", 1],
        ["purchase_entries", "Purchases", "number", 0.7],
        ["purchased_value", "Purchased value", "currencyPkr", 1.1],
        ["payments", "Paid", "currencyPkr", 1],
        ["balance", "Balance", "currencyPkr", 1],
        ["balance_status", "Position", "status", 0.9],
      ],
      supplierPayments: [
        ["payment_date", "Date", "date", 1],
        ["supplier", "Supplier", "text", 1.4],
        ["amount", "Amount", "currencyPkr", 1],
        ["payment_method", "Method", "text", 1],
        ["reference", "Reference", "text", 1.1],
        ["note", "Note", "text", 2],
      ],
      batches: [
        ["created_at", "Created", "date", 0.95],
        ["batch_no", "Batch", "text", 1.1],
        ["article", "Article", "text", 0.8],
        ["product", "Product", "text", 1.45],
        ["quantity", "Qty", "number", 0.55],
        ["priority", "Priority", "status", 0.75],
        ["status", "Status", "status", 0.85],
        ["progress", "Progress", "percent", 0.75],
        ["tasks", "Tasks", "number", 0.55],
        ["due_date", "Due date", "date", 0.95],
        ["labor_cost", "Labor cost", "currencyPkr", 0.95],
      ],
      tasks: [
        ["created_at", "Created", "date", 0.9],
        ["batch_no", "Batch", "text", 1.05],
        ["article", "Article", "text", 0.8],
        ["operation", "Operation", "text", 1.2],
        ["worker", "Worker", "text", 0.9],
        ["status", "Status", "status", 0.85],
        ["timing", "Timing", "status", 0.85],
        ["assigned", "Assigned", "number", 0.65],
        ["completed", "Done", "number", 0.6],
        ["progress", "Progress", "percent", 0.75],
        ["labor_cost", "Labor", "currencyPkr", 0.85],
      ],
      workers: [
        ["worker", "Worker", "text", 1.25],
        ["role", "Role", "text", 1.05],
        ["department", "Department", "text", 1],
        ["active", "Account", "status", 0.75],
        ["tasks", "Tasks", "number", 0.6],
        ["completed_tasks", "Completed", "number", 0.7],
        ["assigned_units", "Assigned units", "number", 0.8],
        ["completed_units", "Completed units", "number", 0.85],
        ["completion_rate", "Task rate", "percent", 0.75],
        ["labor_cost", "Labor cost", "currencyPkr", 0.9],
      ],
    };

    const makeColumns = (items) =>
      items.map(([key, label, type, pdfWidth]) => ({ key, label, type, pdfWidth }));

    return {
      orders: {
        label: "Order ledger",
        description: "Every order with customer, fulfillment, payment, and total value.",
        dateLabel: "Order date",
        filters: ["date", "customer", "platform", "shippingStatus", "paymentStatus", "payoutStatus"],
        columns: makeColumns(columns.orders),
        rows: orderRows,
        distributionKey: "shipping_status",
      },
      sales: {
        label: "Item sales",
        description: "Product-level sales lines with quantity, selling price, and revenue.",
        dateLabel: "Order date",
        filters: ["date", "customer", "product", "category", "platform"],
        columns: makeColumns(columns.sales),
        rows: salesRows,
        distributionKey: "platform",
      },
      profitability: {
        label: "Order profitability",
        description: "Revenue, product cost, gross profit, and margin by order.",
        dateLabel: "Order date",
        filters: ["date", "customer", "platform"],
        columns: makeColumns(columns.profitability),
        rows: profitabilityRows,
        distributionKey: "platform",
      },
      payouts: {
        label: "Payout reconciliation",
        description: "Expected, received, and outstanding payout amounts for every order.",
        dateLabel: "Order date",
        filters: ["date", "customer", "platform", "paymentStatus", "payoutStatus"],
        columns: makeColumns(columns.payouts),
        rows: payoutRows,
        distributionKey: "payout_status",
      },
      customers: {
        label: "Customer performance",
        description: "Customer activity, order volume, revenue, and most recent order.",
        filters: ["customer", "country", "platform"],
        columns: makeColumns(columns.customers),
        rows: customerRows,
        distributionKey: "platform",
      },
      inventory: {
        label: "Inventory position",
        description: "Current stock by product, location, availability, value, and health.",
        filters: ["product", "category", "stockState"],
        columns: makeColumns(columns.inventory),
        rows: inventoryRows,
        distributionKey: "stock_state",
      },
      lowStock: {
        label: "Low stock and outages",
        description: "Products at or below their reorder threshold.",
        filters: ["product", "category", "stockState"],
        columns: makeColumns(columns.inventory),
        rows: inventoryRows.filter((row) => row.stock_state !== "Healthy"),
        distributionKey: "stock_state",
      },
      movements: {
        label: "Stock movement audit",
        description: "Every inventory adjustment, purchase, reservation, and release.",
        dateLabel: "Movement date",
        filters: ["date", "product", "supplier", "movementType"],
        columns: makeColumns(columns.movements),
        rows: movementRows,
        distributionKey: "movement_type",
      },
      shipping: {
        label: "Shipping and courier costs",
        description: "Shipment weight, courier, tracking, and cost completeness.",
        dateLabel: "Shipped date",
        filters: ["date", "courier"],
        columns: makeColumns(columns.shipping),
        rows: shippingRows,
        distributionKey: "courier",
      },
      suppliers: {
        label: "Account position",
        description: "Purchasing, payments, and outstanding or advance balances by supplier.",
        filters: ["supplier"],
        columns: makeColumns(columns.suppliers),
        rows: supplierRows,
        distributionKey: "balance_status",
      },
      supplierPayments: {
        label: "Account payments",
        description: "Supplier payment history with methods, references, and notes.",
        dateLabel: "Payment date",
        filters: ["date", "supplier", "paymentMethod"],
        columns: makeColumns(columns.supplierPayments),
        rows: supplierPaymentRows,
        distributionKey: "payment_method",
      },
      batches: {
        label: "Production batches",
        description: "Batch progress, priority, due dates, tasks, and labor cost.",
        dateLabel: "Batch created",
        filters: ["date", "product", "batchStatus", "priority"],
        columns: makeColumns(columns.batches),
        rows: batchRows,
        distributionKey: "status",
      },
      tasks: {
        label: "Production tasks",
        description: "Operation-level assignment, completion, timing, and worker output.",
        dateLabel: "Task created",
        filters: ["date", "product", "batchStatus", "taskStatus", "worker", "priority"],
        columns: makeColumns(columns.tasks),
        rows: taskRows,
        distributionKey: "status",
      },
      workers: {
        label: "Worker performance",
        description: "Assigned work, completed work, output, and task completion rate.",
        filters: ["worker", "department"],
        columns: makeColumns(columns.workers),
        rows: workerRows,
        distributionKey: "active",
      },
    };
  }, [data]);

  const activeReport = reportDefinitions[reportType] || reportDefinitions.orders;

  const filterOptions = useMemo(
    () => ({
      customer: data.customers.map((customer) => ({
        value: String(customer.id),
        label: customer.name || `Customer ${customer.id}`,
      })),
      product: data.products.map((product) => ({
        value: String(product.id),
        label: `${product.article_no} - ${product.name}`,
      })),
      category: uniqueOptions(data.products.map((product) => product.category)),
      platform: uniqueOptions([
        ...data.orders.map((order) => order.platform),
        ...data.customers.map((customer) => customer.platform),
      ]),
      paymentStatus: uniqueOptions(data.orders.map((order) => order.payment_status)),
      shippingStatus: uniqueOptions(data.orders.map((order) => order.shipping_status)),
      payoutStatus: uniqueOptions(data.orders.map((order) => order.payout_status)),
      stockState: ["Healthy", "Low stock", "Out of stock"],
      courier: uniqueOptions(data.shipping.map((shipment) => shipment.courier_name || "Not assigned")),
      supplier: data.suppliers.map((supplier) => ({
        value: String(supplier.id),
        label: supplier.name,
      })),
      movementType: uniqueOptions(data.movements.map((movement) => movement.movement_type)),
      batchStatus: uniqueOptions(data.batches.map((batch) => batch.status)),
      taskStatus: uniqueOptions(
        data.batches.flatMap((batch) => (batch.tasks || []).map((task) => task.status))
      ),
      worker: data.workers.map((worker) => ({
        value: String(worker.id),
        label: worker.name,
      })),
      priority: uniqueOptions(data.batches.map((batch) => batch.priority)),
      paymentMethod: uniqueOptions(
        data.suppliers.flatMap((supplier) =>
          (supplier.payments || []).map((payment) => payment.payment_method)
        )
      ),
      country: uniqueOptions(data.customers.map((customer) => customer.country)),
      department: uniqueOptions(data.workers.map((worker) => worker.department)),
    }),
    [data]
  );

  const filteredRows = useMemo(() => {
    const filters = appliedFilters;
    const query = filters.search.trim().toLowerCase();
    const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
    const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`) : null;

    return activeReport.rows.filter((row) => {
      if (query && !String(row._search || "").toLowerCase().includes(query)) return false;
      if (activeReport.filters.includes("date") && (startDate || endDate)) {
        const rowDate = parseUtcLocal(row._date);
        if (!rowDate) return false;
        if (startDate && rowDate < startDate) return false;
        if (endDate && rowDate > endDate) return false;
      }

      const checks = [
        ["customer", "_customer"],
        ["product", "_product"],
        ["category", "_category"],
        ["platform", "_platform"],
        ["paymentStatus", "_paymentStatus"],
        ["shippingStatus", "_shippingStatus"],
        ["payoutStatus", "_payoutStatus"],
        ["stockState", "_stockState"],
        ["courier", "_courier"],
        ["supplier", "_supplier"],
        ["movementType", "_movementType"],
        ["batchStatus", "_batchStatus"],
        ["taskStatus", "_taskStatus"],
        ["worker", "_worker"],
        ["priority", "_priority"],
        ["paymentMethod", "_paymentMethod"],
        ["country", "_country"],
        ["department", "_department"],
      ];

      return checks.every(
        ([filterKey, rowKey]) =>
          !filters[filterKey] || String(row[rowKey] ?? "") === String(filters[filterKey])
      );
    });
  }, [activeReport, appliedFilters]);

  const sortedRows = useMemo(() => {
    if (!sortConfig.key) return filteredRows;
    const columnType = activeReport.columns.find(
      (column) => column.key === sortConfig.key
    )?.type;
    return [...filteredRows].sort((first, second) => {
      const firstValue = first[sortConfig.key];
      const secondValue = second[sortConfig.key];
      let comparison;

      if (
        ["number", "decimal", "currencyPkr", "currencyUsd", "percent"].includes(
          columnType
        )
      ) {
        comparison = Number(firstValue || 0) - Number(secondValue || 0);
      } else if (["date", "dateTime"].includes(columnType)) {
        const firstDate = parseUtcLocal(firstValue);
        const secondDate = parseUtcLocal(secondValue);
        comparison =
          (firstDate?.getTime() || 0) - (secondDate?.getTime() || 0);
      } else {
        comparison = String(firstValue ?? "").localeCompare(
          String(secondValue ?? ""),
          undefined,
          { numeric: true }
        );
      }
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [activeReport.columns, filteredRows, sortConfig]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const visibleRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  const metrics = useMemo(() => {
    const rows = filteredRows;
    const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    const average = (key) => (rows.length ? sum(key) / rows.length : 0);

    if (reportType === "orders") {
      return [
        ["Orders", formatNumber(rows.length), "Matching records"],
        ["Units", formatNumber(sum("quantity")), "Items ordered"],
        ["Order value", formatCurrency(sum("total")), "Recorded value"],
        [
          "Awaiting shipping",
          formatNumber(rows.filter((row) => !["Shipped", "Delivered"].includes(row.shipping_status)).length),
          "Open fulfillment",
        ],
      ];
    }
    if (reportType === "sales") {
      return [
        ["Sales lines", formatNumber(rows.length), "Matching items"],
        ["Units sold", formatNumber(sum("quantity")), "Product quantity"],
        ["Revenue", formatCurrency(sum("revenue")), "Gross sales"],
        ["Average line", formatCurrency(average("revenue")), "Per sales line"],
      ];
    }
    if (reportType === "profitability") {
      const revenue = sum("revenue");
      const profit = sum("gross_profit");
      return [
        ["Orders", formatNumber(rows.length), "Matching records"],
        ["Revenue", formatCurrency(revenue), "Order value"],
        ["Product cost", formatCurrency(sum("product_cost")), "Recorded cost"],
        ["Gross margin", `${revenue ? ((profit / revenue) * 100).toFixed(1) : "0.0"}%`, formatCurrency(profit)],
      ];
    }
    if (reportType === "payouts") {
      return [
        ["Payouts", formatNumber(rows.length), "Matching orders"],
        ["Expected", formatCurrency(sum("expected"), "USD"), "Expected payout"],
        ["Received", formatCurrency(sum("received"), "USD"), "Money received"],
        ["Outstanding", formatCurrency(sum("remaining"), "USD"), "Still pending"],
      ];
    }
    if (reportType === "customers") {
      return [
        ["Customers", formatNumber(rows.length), "Matching buyers"],
        ["Orders", formatNumber(sum("orders")), "Customer orders"],
        ["Revenue", formatCurrency(sum("revenue")), "Customer value"],
        ["Countries", formatNumber(new Set(rows.map((row) => row.country)).size), "Markets served"],
      ];
    }
    if (reportType === "inventory" || reportType === "lowStock") {
      return [
        ["Products", formatNumber(rows.length), "Matching articles"],
        ["Available", formatNumber(sum("available")), "Ready units"],
        ["Reserved", formatNumber(sum("reserved")), "Committed units"],
        ["Stock value", formatCurrency(sum("stock_value")), "At product cost"],
      ];
    }
    if (reportType === "movements") {
      return [
        ["Movements", formatNumber(rows.length), "Audit entries"],
        ["Units moved", formatNumber(sum("quantity")), "Recorded quantity"],
        ["Faulty units", formatNumber(sum("faulty_quantity")), "Current faults"],
        ["Movement types", formatNumber(new Set(rows.map((row) => row.movement_type)).size), "Activity groups"],
      ];
    }
    if (reportType === "shipping") {
      return [
        ["Shipments", formatNumber(rows.length), "Matching records"],
        ["Total weight", `${formatNumber(sum("weight"), 2)} kg`, "Recorded packages"],
        ["Shipping cost", formatCurrency(sum("shipping_cost")), "Recorded courier cost"],
        ["Missing cost", formatNumber(rows.filter((row) => row.cost_status === "Missing").length), "Needs completion"],
      ];
    }
    if (reportType === "suppliers") {
      return [
        ["Accounts", formatNumber(rows.length), "Matching accounts"],
        ["Purchased", formatCurrency(sum("purchased_value")), "Stock purchase value"],
        ["Payments", formatCurrency(sum("payments")), "Payments recorded"],
        ["Net balance", formatCurrency(sum("balance")), "Positive due, negative advance"],
      ];
    }
    if (reportType === "supplierPayments") {
      return [
        ["Payments", formatNumber(rows.length), "Matching entries"],
        ["Paid", formatCurrency(sum("amount")), "Total amount"],
        ["Accounts", formatNumber(new Set(rows.map((row) => row.supplier)).size), "Paid accounts"],
        ["Methods", formatNumber(new Set(rows.map((row) => row.payment_method)).size), "Payment methods"],
      ];
    }
    if (reportType === "batches") {
      return [
        ["Batches", formatNumber(rows.length), "Matching batches"],
        ["Batch quantity", formatNumber(sum("quantity")), "Production units"],
        ["Average progress", `${average("progress").toFixed(1)}%`, "Across batches"],
        ["Labor cost", formatCurrency(sum("labor_cost")), "Recorded labor"],
      ];
    }
    if (reportType === "tasks") {
      return [
        ["Tasks", formatNumber(rows.length), "Matching operations"],
        ["Assigned units", formatNumber(sum("assigned")), "Production quantity"],
        ["Completed units", formatNumber(sum("completed")), "Output recorded"],
        ["Average progress", `${average("progress").toFixed(1)}%`, "Across tasks"],
      ];
    }
    return [
      ["Workers", formatNumber(rows.length), "Matching workers"],
      ["Tasks", formatNumber(sum("tasks")), "Assigned tasks"],
      ["Completed", formatNumber(sum("completed_tasks")), "Finished tasks"],
      ["Average rate", `${average("completion_rate").toFixed(1)}%`, "Task completion"],
    ];
  }, [filteredRows, reportType]);

  const distribution = useMemo(() => {
    const key = activeReport.distributionKey;
    if (!key) return [];
    const counts = filteredRows.reduce((result, row) => {
      const label = String(row[key] || "Not specified");
      result[label] = (result[label] || 0) + 1;
      return result;
    }, {});
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [activeReport, filteredRows]);

  const formatCell = (value, type) => {
    if (type === "date") return formatDate(value);
    if (type === "dateTime") return formatDateTime(value);
    if (type === "currencyPkr") return formatCurrency(value);
    if (type === "currencyUsd") return formatCurrency(value, "USD");
    if (type === "number") return formatNumber(value);
    if (type === "decimal") return formatNumber(value, 2);
    if (type === "percent") return `${Number(value || 0).toFixed(1)}%`;
    return value ?? "-";
  };

  const filtersDirty = JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters);

  const updateFilter = (key, value) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const handlePresetChange = (preset) => {
    const dates = getPresetDates(preset);
    setDraftFilters((current) => ({
      ...current,
      datePreset: preset,
      ...(dates || {}),
    }));
  };

  const handleReportChange = (nextReportType) => {
    const nextReport = reportDefinitions[nextReportType];
    setReportType(nextReportType);
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setSortConfig({
      key: nextReport?.columns.find((column) => ["date", "dateTime"].includes(column.type))?.key || "",
      direction: "desc",
    });
    setPage(1);
    setGeneratedAt(new Date());
    setNotice("");
  };

  const generateReport = () => {
    if (
      draftFilters.startDate &&
      draftFilters.endDate &&
      draftFilters.startDate > draftFilters.endDate
    ) {
      setNotice("Start date cannot be after end date.");
      return;
    }
    setAppliedFilters({ ...draftFilters });
    setGeneratedAt(new Date());
    setPage(1);
    setNotice("");
  };

  const clearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setGeneratedAt(new Date());
    setPage(1);
    setNotice("");
  };

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  };

  const exportRows = useMemo(
    () =>
      sortedRows.map((row) =>
        activeReport.columns.reduce((result, column) => {
          result[column.key] = formatCell(row[column.key], column.type);
          return result;
        }, {})
      ),
    [activeReport.columns, sortedRows]
  );

  const getExportContext = () => {
    const dateRange =
      appliedFilters.startDate || appliedFilters.endDate
        ? `${appliedFilters.startDate || "Beginning"} to ${appliedFilters.endDate || "Today"}`
        : "All time";
    return `${dateRange} | Generated ${new Date().toLocaleString("en-PK")}`;
  };

  const exportCsv = () => {
    const header = activeReport.columns.map((column) => csvEscape(column.label)).join(",");
    const lines = exportRows.map((row) =>
      activeReport.columns.map((column) => csvEscape(row[column.key])).join(",")
    );
    const csv = `\uFEFF${header}\n${lines.join("\n")}`;
    downloadBlob(
      `${reportType}-report-${toDateInput(new Date())}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
  };

  const exportPdf = () => {
    const pdf = buildPdfDocument({
      title: activeReport.label,
      subtitle: `${getExportContext()} | ${sortedRows.length} records`,
      columns: activeReport.columns,
      rows: exportRows,
    });
    downloadBlob(
      `${reportType}-report-${toDateInput(new Date())}.pdf`,
      new Blob([pdf], { type: "application/pdf" })
    );
  };

  const renderSelect = (key, label, options) => (
    <label className="reports-field" key={key}>
      <span>{label}</span>
      <select value={draftFilters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return (
            <option key={value} value={value}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );

  const filterLabels = {
    customer: "Customers",
    product: "Products",
    category: "Categories",
    platform: "Platforms",
    paymentStatus: "Payment status",
    shippingStatus: "Shipping status",
    payoutStatus: "Payout status",
    stockState: "Stock status",
    courier: "Couriers",
    supplier: "Accounts",
    movementType: "Movement types",
    batchStatus: "Batch status",
    taskStatus: "Task status",
    worker: "Workers",
    priority: "Priorities",
    paymentMethod: "Payment methods",
    country: "Countries",
    department: "Departments",
  };

  const maxDistribution = Math.max(1, ...distribution.map((item) => item.count));

  return (
    <div className="reports-page">
      <header className="reports-hero">
        <div>
          <span className="reports-eyebrow">Business intelligence</span>
          <h1>Reports</h1>
          <p>Build precise operational reports, review the result, and export it in the format you need.</p>
        </div>
        <div className="reports-export-actions">
          <button disabled={loading || sortedRows.length === 0} onClick={exportCsv} type="button">
            <Icon name="csv" size={17} />
            Export CSV
          </button>
          <button
            className="is-primary"
            disabled={loading || sortedRows.length === 0}
            onClick={exportPdf}
            type="button"
          >
            <Icon name="pdf" size={17} />
            Export PDF
          </button>
        </div>
      </header>

      {loadError && (
        <div className="reports-alert" role="alert">
          <Icon name="alert" size={18} />
          <span>{loadError}</span>
          <button aria-label="Dismiss warning" onClick={() => setLoadError("")} type="button">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      <section className="reports-builder">
        <div className="reports-builder-heading">
          <div className="reports-builder-icon">
            <Icon name="filter" size={20} />
          </div>
          <div>
            <span>Report builder</span>
            <h2>Choose the data and period</h2>
          </div>
          {filtersDirty && <span className="reports-dirty-badge">Generate to apply changes</span>}
        </div>

        <div className="reports-builder-grid">
          <label className="reports-field reports-report-type">
            <span>Report type</span>
            <select value={reportType} onChange={(event) => handleReportChange(event.target.value)}>
              {REPORT_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.keys.map((key) => (
                    <option key={key} value={key}>
                      {reportDefinitions[key]?.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <small>{activeReport.description}</small>
          </label>

          <label className="reports-field reports-search-field">
            <span>Search this report</span>
            <div className="reports-input-with-icon">
              <Icon name="search" size={17} />
              <input
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Order, article, customer, worker..."
                value={draftFilters.search}
              />
            </div>
          </label>

          {activeReport.filters.includes("date") && (
            <>
              <label className="reports-field">
                <span>Date range</span>
                <select
                  value={draftFilters.datePreset}
                  onChange={(event) => handlePresetChange(event.target.value)}
                >
                  {datePresets.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="reports-field">
                <span>From</span>
                <div className="reports-input-with-icon">
                  <Icon name="calendar" size={16} />
                  <input
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        datePreset: "custom",
                        startDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={draftFilters.startDate}
                  />
                </div>
              </label>
              <label className="reports-field">
                <span>To</span>
                <div className="reports-input-with-icon">
                  <Icon name="calendar" size={16} />
                  <input
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        datePreset: "custom",
                        endDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={draftFilters.endDate}
                  />
                </div>
              </label>
            </>
          )}

          {activeReport.filters
            .filter((filter) => filter !== "date")
            .map((filter) => renderSelect(filter, filterLabels[filter], filterOptions[filter] || []))}
        </div>

        {notice && <div className="reports-form-error">{notice}</div>}

        <div className="reports-builder-footer">
          <button className="reports-clear-button" onClick={clearFilters} type="button">
            Clear filters
          </button>
          <button className="reports-generate-button" onClick={generateReport} type="button">
            <Icon name="generate" size={17} />
            Generate report
          </button>
        </div>
      </section>

      <section className="reports-metrics" aria-label={`${activeReport.label} summary`}>
        {metrics.map(([label, value, detail], index) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{loading ? "..." : value}</strong>
            <small>{detail}</small>
            <i className={`is-tone-${index + 1}`} />
          </article>
        ))}
      </section>

      <section className="reports-preview">
        <div className="reports-preview-heading">
          <div>
            <span className="reports-section-label">Generated report</span>
            <h2>{activeReport.label}</h2>
            <p>
              {sortedRows.length} record{sortedRows.length === 1 ? "" : "s"} · Generated{" "}
              {generatedAt.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <label className="reports-page-size">
            <span>Rows</span>
            <select
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              value={pageSize}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="reports-loading">
            {[1, 2, 3, 4, 5].map((item) => (
              <span key={item} />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="reports-empty-state">
            <div>
              <Icon name="report" size={26} />
            </div>
            <h3>No records match these filters</h3>
            <p>Clear one or more filters and generate the report again.</p>
          </div>
        ) : (
          <>
            <div className="reports-table-wrap">
              <table className="reports-table">
                <thead>
                  <tr>
                    {activeReport.columns.map((column) => (
                      <th
                        className={["number", "decimal", "currencyPkr", "currencyUsd", "percent"].includes(column.type) ? "is-number" : ""}
                        key={column.key}
                      >
                        <button onClick={() => handleSort(column.key)} type="button">
                          {column.label}
                          <Icon name="sort" size={13} />
                          {sortConfig.key === column.key && (
                            <span>{sortConfig.direction === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => (
                    <tr key={`${reportType}-${page}-${rowIndex}`}>
                      {activeReport.columns.map((column) => {
                        const displayValue = formatCell(row[column.key], column.type);
                        const isNumber = [
                          "number",
                          "decimal",
                          "currencyPkr",
                          "currencyUsd",
                          "percent",
                        ].includes(column.type);
                        return (
                          <td className={isNumber ? "is-number" : ""} key={column.key}>
                            {column.type === "status" ? (
                              <span className="reports-status-pill">{displayValue}</span>
                            ) : (
                              displayValue
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="reports-pagination">
              <span>
                Showing {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, sortedRows.length)} of {sortedRows.length}
              </span>
              <div>
                <button disabled={page === 1} onClick={() => setPage((current) => current - 1)} type="button">
                  Previous
                </button>
                <span>
                  Page {page} of {pageCount}
                </span>
                <button
                  disabled={page === pageCount}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {!loading && distribution.length > 0 && (
        <section className="reports-insights">
          <div>
            <span className="reports-section-label">Report insights</span>
            <h2>Distribution</h2>
            <p>A quick breakdown of the strongest grouping in this report.</p>
          </div>
          <div className="reports-distribution">
            {distribution.map((item) => (
              <div className="reports-distribution-row" key={item.label}>
                <span>{item.label}</span>
                <div>
                  <i style={{ width: `${(item.count / maxDistribution) * 100}%` }} />
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default Reports;
