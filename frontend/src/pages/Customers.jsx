import { useEffect, useMemo, useRef, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./Customers.css";

const createEmptyForm = () => ({
  name: "",
  company_name: "",
  email: "",
  phone: "",
  country: "",
  address: "",
  shipping_address: "",
  platform: "Manual",
});

const standardPlatforms = [
  "Manual",
  "Faire",
  "Shopify",
  "WhatsApp",
  "Amazon",
  "Website",
];

const importConflictActions = [
  ["skip", "Skip"],
  ["add", "Add as new"],
  ["merge", "Merge missing"],
  ["update", "Use CSV"],
];

const importConflictFields = [
  ["name", "Name"],
  ["company_name", "Store / company"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["country", "Country"],
  ["address", "Residential address"],
  ["shipping_address", "Shipping address"],
  ["platform", "Platform"],
];

const getImportConflictKey = (conflict, index) =>
  `${conflict?.row || "row"}-${conflict?.existing?.id || "customer"}-${index}`;

const getCustomerInitials = (customer) =>
  String(customer.company_name || customer.name || "C")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const normalizePhoneKey = (value) => String(value || "").replace(/\D/g, "");

const closedOrderStatuses = new Set([
  "shipped",
  "delivered",
  "completed",
  "fulfilled",
  "cancelled",
  "canceled",
]);

const parseCustomerDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatCustomerDate = (value) => {
  const date = parseCustomerDate(value);
  return date
    ? date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Not set";
};

const formatCustomerMoney = (value) =>
  `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;

const getOrderTotalUsd = (order) =>
  Number(order?.order_total_usd || order?.total_amount || order?.payout_amount_usd || 0);

const getOrderUnitCount = (order) =>
  (order?.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);

const isOpenCustomerOrder = (order) => {
  const status = String(order?.shipping_status || order?.status || "").trim().toLowerCase();
  return !closedOrderStatuses.has(status);
};

const getOrderPrimaryItemsText = (order) => {
  const items = order?.items || [];
  if (!items.length) return "No products";
  const [firstItem] = items;
  const firstLabel = firstItem.product_name || firstItem.article_no || "Product";
  return items.length > 1 ? `${firstLabel} +${items.length - 1} more` : firstLabel;
};

const getOrderImageItems = (order, limit = 4) =>
  (order?.items || []).filter((item) => item.product_image_url).slice(0, limit);

const getCustomerShippingPhoneText = (customer, orders = []) => {
  if (!customer) return "";
  const customerOrders = orders.filter(
    (order) => Number(order.customer_id) === Number(customer.id)
  );
  const seenPhones = new Set();
  const phoneRows = [];

  customerOrders.forEach((order) => {
    const phone = String(order.import_contact_phone || "").trim();
    if (!phone) return;
    const phoneKey = normalizePhoneKey(phone) || phone.toLowerCase();
    if (seenPhones.has(phoneKey)) return;
    seenPhones.add(phoneKey);
    phoneRows.push(
      order.order_no ? `${phone} (${order.order_no})` : phone
    );
  });

  return phoneRows.join("\n");
};

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

function Icon({ name, size = 18 }) {
  const paths = {
    users: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21a7 7 0 0 1 14 0M17 11a4 4 0 0 0 0-7M17 14a6 6 0 0 1 5 7" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
    platform: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    orders: (
      <>
        <path d="M7 3h10l2 4H5l2-4Z" />
        <path d="M5 7h14v14H5z" />
        <path d="M9 11h6M9 15h6" />
      </>
    ),
    contact: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="9" r="3" />
        <path d="M7 18a5 5 0 0 1 10 0" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    phone: (
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.6a2 2 0 0 1-.5 2.1L9 10.7a16 16 0 0 0 4.3 4.3l1.3-1.3a2 2 0 0 1 2.1-.5c.8.4 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z" />
    ),
    location: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 16V6a2 2 0 0 1 2-2h10" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </>
    ),
    upload: (
      <>
        <path d="M12 3v12M7 8l5-5 5 5" />
        <path d="M5 15v4h14v-4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="customers-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function Customers({ onCreateOrder = null }) {
  const confirmDialog = useConfirmDialog();
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [detailCustomer, setDetailCustomer] = useState(null);
  const [copiedField, setCopiedField] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [customerView, setCustomerView] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [resolvingImportConflicts, setResolvingImportConflicts] = useState(false);
  const [notice, setNotice] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [selectedImportActions, setSelectedImportActions] = useState({});
  const [selectedCustomerIds, setSelectedCustomerIds] = useState(() => new Set());
  const [showSummary, setShowSummary] = useState(false);
  const csvInputRef = useRef(null);

  useEffect(() => {
    let active = true;

    Promise.all([api.get("/customers"), api.get("/orders")])
      .then(([customersResponse, ordersResponse]) => {
        if (!active) return;
        setCustomers(
          Array.isArray(customersResponse.data) ? customersResponse.data : []
        );
        setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
      })
      .catch((error) => {
        console.error("Customers error:", error);
        if (active) {
          setNotice({
            type: "error",
            text: "Customers could not be loaded. Check the backend connection.",
          });
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
    if (!showForm) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !saving) {
        setShowForm(false);
        setEditingId(null);
        setForm(createEmptyForm());
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [saving, showForm]);

  useEffect(() => {
    if (!detailCustomer) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setDetailCustomer(null);
        setCopiedField("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailCustomer]);

  const orderCountByCustomer = useMemo(() => {
    const counts = new Map();
    orders.forEach((order) => {
      counts.set(
        order.customer_id,
        (counts.get(order.customer_id) || 0) + 1
      );
    });
    return counts;
  }, [orders]);

  const countries = useMemo(
    () =>
      Array.from(
        new Set(customers.map((customer) => customer.country).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [customers]
  );

  const platforms = useMemo(
    () =>
      Array.from(
        new Set([
          ...standardPlatforms,
          ...customers.map((customer) => customer.platform).filter(Boolean),
        ])
      ).sort((a, b) => a.localeCompare(b)),
    [customers]
  );

  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return customers.filter((customer) => {
      const orderCount = orderCountByCustomer.get(customer.id) || 0;
      const matchesSearch = [
        customer.name,
        customer.company_name,
        customer.email,
        customer.phone,
        customer.country,
        customer.address,
        customer.shipping_address,
        customer.platform,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesPlatform =
        platformFilter === "all" || customer.platform === platformFilter;
      const matchesCountry =
        countryFilter === "all" || customer.country === countryFilter;
      const matchesView =
        customerView === "all" ||
        (customerView === "with-orders" && orderCount > 0) ||
        (customerView === "without-orders" && orderCount === 0);

      return matchesSearch && matchesPlatform && matchesCountry && matchesView;
    });
  }, [
    countryFilter,
    customerView,
    customers,
    orderCountByCustomer,
    platformFilter,
    searchQuery,
  ]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setSelectedCustomerIds((current) => {
        if (current.size === 0) return current;
        const visibleIds = new Set(filteredCustomers.map((customer) => customer.id));
        const next = new Set([...current].filter((id) => visibleIds.has(id)));
        return next.size === current.size ? current : next;
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [filteredCustomers]);

  const selectedCustomers = filteredCustomers.filter((customer) =>
    selectedCustomerIds.has(customer.id)
  );
  const allVisibleCustomersSelected =
    filteredCustomers.length > 0 && selectedCustomerIds.size === filteredCustomers.length;

  const customerSummary = useMemo(() => {
    const withOrders = customers.filter(
      (customer) => (orderCountByCustomer.get(customer.id) || 0) > 0
    ).length;
    const totalOrders = orders.length;

    return {
      countries: countries.length,
      total: customers.length,
      totalOrders,
      withOrders,
    };
  }, [countries.length, customers, orderCountByCustomer, orders.length]);

  const refreshCustomers = async () => {
    try {
      const [customersResponse, ordersResponse] = await Promise.all([
        api.get("/customers"),
        api.get("/orders"),
      ]);
      setCustomers(
        Array.isArray(customersResponse.data) ? customersResponse.data : []
      );
      setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
    } catch (error) {
      console.error("Customers error:", error);
      setNotice({
        type: "error",
        text: "Customer directory could not be refreshed.",
      });
    }
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditingId(null);
    setForm(createEmptyForm());
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(createEmptyForm());
    setShowForm(true);
  };

  const openCsvImport = () => {
    if (importingCsv) return;
    csvInputRef.current?.click();
  };

  const importCustomersCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    setImportingCsv(true);
    setNotice(null);

    try {
      const response = await api.post("/customers/import-csv", formData);
      const created = Number(response.data?.created || 0);
      const merged = Number(response.data?.merged || 0);
      const failed = Number(response.data?.failed || 0);
      const skipped = Number(response.data?.skipped || 0);
      const conflicts = Array.isArray(response.data?.conflicts)
        ? response.data.conflicts
        : [];
      const issueCount = failed + skipped;
      const firstError = response.data?.errors?.[0]?.detail;
      const summary = {
        ...response.data,
        fileName: file.name,
      };
      const defaultActions = conflicts.reduce((actions, conflict, index) => {
        actions[getImportConflictKey(conflict, index)] = "skip";
        return actions;
      }, {});

      await refreshCustomers();
      setSelectedImportActions(defaultActions);
      setImportSummary(summary);
      setNotice({
        type: issueCount > 0 ? "error" : "success",
        text:
          conflicts.length > 0
            ? `Imported ${created} customers${merged ? ` and merged ${merged}` : ""}. ${conflicts.length} existing contacts need your choice.`
            : issueCount > 0
            ? `Imported ${created} customers${merged ? ` and merged ${merged}` : ""}. ${issueCount} rows need review.${firstError ? ` ${firstError}` : ""}`
            : `Imported ${created} customers${merged ? ` and merged ${merged}` : ""} from CSV.`,
      });
    } catch (error) {
      console.error("Customer CSV import error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Customer CSV could not be imported.",
      });
    } finally {
      setImportingCsv(false);
      event.target.value = "";
    }
  };

  const resolveImportConflicts = async () => {
    const conflicts = Array.isArray(importSummary?.conflicts)
      ? importSummary.conflicts
      : [];
    if (!conflicts.length || resolvingImportConflicts) return;

    setResolvingImportConflicts(true);
    setNotice(null);

    try {
      const resolutions = conflicts.map((conflict, index) => ({
        action: selectedImportActions[getImportConflictKey(conflict, index)] || "skip",
        existing_id: conflict.existing?.id || null,
        incoming: conflict.incoming || {},
      }));
      const response = await api.post("/customers/import-conflicts/resolve", {
        resolutions,
      });
      const resolution = response.data || {};
      const added = Number(resolution.added || 0);
      const merged = Number(resolution.merged || 0);
      const updated = Number(resolution.updated || 0);
      const skipped = Number(resolution.skipped || 0);
      const unchanged = Number(resolution.unchanged || 0);
      const remainingErrors = Array.isArray(resolution.errors)
        ? resolution.errors
        : [];

      await refreshCustomers();
      setImportSummary((current) => {
        if (!current) return current;
        const currentConflictCount = Array.isArray(current.conflicts)
          ? current.conflicts.length
          : Number(current.conflict_count || 0);
        return {
          ...current,
          conflicts: [],
          conflict_count: 0,
          skipped: Math.max(Number(current.skipped || 0) - currentConflictCount, 0),
          resolution,
        };
      });
      setSelectedImportActions({});
      setNotice({
        type: remainingErrors.length > 0 ? "error" : "success",
        text:
          remainingErrors.length > 0
            ? `${remainingErrors.length} duplicate choices could not be applied.`
            : `Duplicate review applied: ${added} added, ${merged + updated} adjusted, ${skipped + unchanged} skipped.`,
      });
    } catch (error) {
      console.error("Customer import resolution error:", error);
      setNotice({
        type: "error",
        text:
          error.response?.data?.detail ||
          "Customer import choices could not be applied.",
      });
    } finally {
      setResolvingImportConflicts(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleEdit = (customer) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name || "",
      company_name: customer.company_name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      country: customer.country || "",
      address: customer.address || "",
      shipping_address: customer.shipping_address || "",
      platform: customer.platform || "Manual",
    });
    setShowForm(true);
  };

  const toggleCustomerSelection = (customerId) => {
    setSelectedCustomerIds((current) => {
      const next = new Set(current);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  };

  const toggleAllVisibleCustomers = () => {
    setSelectedCustomerIds((current) => {
      if (filteredCustomers.length > 0 && current.size === filteredCustomers.length) {
        return new Set();
      }
      return new Set(filteredCustomers.map((customer) => customer.id));
    });
  };

  const exportCustomersCsv = (items = filteredCustomers) => {
    downloadCsv(
      `hisbenew-customers-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Name",
        "Company",
        "Email",
        "Phone",
        "Country",
        "Residential Address",
        "Shipping Address",
        "Platform",
        "Orders",
      ],
      items.map((customer) => [
        customer.name,
        customer.company_name,
        customer.email,
        customer.phone,
        customer.country,
        formatAddress(customer.address),
        formatAddress(customer.shipping_address),
        customer.platform,
        orderCountByCustomer.get(customer.id) || 0,
      ])
    );
  };

  const bulkEditCustomers = async () => {
    if (selectedCustomers.length === 0 || saving) return;
    const platform = window.prompt(
      `Apply a platform to ${selectedCustomers.length} selected customer${
        selectedCustomers.length === 1 ? "" : "s"
      }. Enter platform:`
    );
    if (platform === null) return;
    const nextPlatform = platform.trim();
    if (!nextPlatform) {
      setNotice({ type: "error", text: "Bulk edit canceled: platform cannot be blank." });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        selectedCustomers.map((customer) =>
          api.put(`/customers/${customer.id}`, {
            name: customer.name || "",
            company_name: customer.company_name || null,
            email: customer.email || null,
            phone: customer.phone || null,
            country: customer.country || null,
            address: customer.address || null,
            shipping_address: customer.shipping_address || null,
            platform: nextPlatform,
          })
        )
      );
      await refreshCustomers();
      setSelectedCustomerIds(new Set());
      setNotice({
        type: "success",
        text: `${selectedCustomers.length} customer${
          selectedCustomers.length === 1 ? "" : "s"
        } updated.`,
      });
    } catch (error) {
      console.error("Bulk customer edit error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Selected customers could not be updated.",
      });
    } finally {
      setSaving(false);
    }
  };

  const openCustomerDetails = (customer) => {
    setDetailCustomer(customer);
    setCopiedField("");
  };

  const isInteractiveRowTarget = (target) =>
    target instanceof Element &&
    Boolean(target.closest("button, input, a, select, textarea, label"));

  const handleCustomerRowClick = (event, customer) => {
    if (isInteractiveRowTarget(event.target)) return;
    openCustomerDetails(customer);
  };

  const handleCustomerRowKeyDown = (event, customer) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openCustomerDetails(customer);
  };

  const copyToClipboard = async (label, value) => {
    const text = String(value || "").trim();
    if (!text) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedField(label);
      window.setTimeout(() => setCopiedField(""), 1400);
    } catch (error) {
      console.error("Copy customer detail error:", error);
      setNotice({
        type: "error",
        text: "Could not copy this detail to clipboard.",
      });
    }
  };

  const saveCustomer = async (event) => {
    event.preventDefault();
    const saveAndAddOrder =
      event.nativeEvent.submitter?.value === "save-and-add-order";
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      company_name: form.company_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      country: form.country.trim() || null,
      address: form.address.trim() || null,
      shipping_address: form.shipping_address.trim() || null,
      platform: form.platform || "Manual",
    };

    try {
      let savedCustomer = null;

      if (editingId !== null) {
        const response = await api.put(`/customers/${editingId}`, payload);
        savedCustomer = response.data;
      } else {
        const response = await api.post("/customers", payload);
        savedCustomer = response.data;
      }

      if (saveAndAddOrder && savedCustomer?.id && onCreateOrder) {
        setShowForm(false);
        setEditingId(null);
        setForm(createEmptyForm());
        onCreateOrder(savedCustomer.id);
        return;
      }

      await refreshCustomers();
      setNotice({
        type: "success",
        text:
          editingId !== null
            ? "Customer updated successfully."
            : "Customer added successfully.",
      });
      setShowForm(false);
      setEditingId(null);
      setForm(createEmptyForm());
    } catch (error) {
      console.error("Save customer error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Customer could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteCustomers = async (items) => {
    if (!items.length || saving) return;
    const totalOrders = items.reduce(
      (sum, customer) => sum + (orderCountByCustomer.get(customer.id) || 0),
      0
    );
    const confirmed = await confirmDialog({
      title: `Delete ${items.length === 1 ? "customer" : "customers"}?`,
      message: `This will permanently delete ${items.length} customer${
        items.length === 1 ? "" : "s"
      }${totalOrders ? ` and ${totalOrders} related order${totalOrders === 1 ? "" : "s"}` : ""}.`,
      detail: "This action cannot be undone.",
      tone: "danger",
      confirmText: items.length === 1 ? "Delete customer" : "Delete customers",
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await Promise.all(items.map((customer) => api.delete(`/customers/${customer.id}`)));
      const deletedIds = new Set(items.map((customer) => customer.id));
      setCustomers((current) => current.filter((item) => !deletedIds.has(item.id)));
      setOrders((current) => current.filter((order) => !deletedIds.has(order.customer_id)));
      setDetailCustomer((current) => (current && deletedIds.has(current.id) ? null : current));
      setSelectedCustomerIds(new Set());
      setNotice({
        type: "success",
        text: `${items.length} customer${items.length === 1 ? "" : "s"} deleted successfully.`,
      });
    } catch (error) {
      console.error("Delete customer error:", error);
      setNotice({
        type: "error",
        text: error.response?.data?.detail || "Selected customers could not be deleted.",
      });
    } finally {
      setSaving(false);
    }
  };

  const formatAddress = (address) =>
    String(address || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(", ");

  const importConflicts = Array.isArray(importSummary?.conflicts)
    ? importSummary.conflicts
    : [];
  const importConflictCount = importConflicts.length;
  const importNonConflictSkipped = importSummary
    ? Math.max(
        Number(importSummary.skipped || 0) -
          Number(importSummary.conflict_count || importConflictCount),
        0
      )
    : 0;
  const importIssueCount = importSummary
    ? Number(importSummary.failed || 0) + importNonConflictSkipped + importConflictCount
    : 0;
  const importErrors = Array.isArray(importSummary?.errors)
    ? importSummary.errors
    : [];
  const detailOrders = detailCustomer
    ? orders
        .filter((order) => Number(order.customer_id) === Number(detailCustomer.id))
        .sort((firstOrder, secondOrder) => {
          const secondDate = parseCustomerDate(secondOrder.order_date)?.getTime() || 0;
          const firstDate = parseCustomerDate(firstOrder.order_date)?.getTime() || 0;
          return secondDate - firstDate;
        })
    : [];
  const detailOpenOrders = detailOrders.filter(isOpenCustomerOrder);
  const detailOrderHistory = detailOrders.slice(0, 8);
  const detailTotalRevenue = detailOrders.reduce(
    (sum, order) => sum + getOrderTotalUsd(order),
    0
  );
  const detailTotalUnits = detailOrders.reduce(
    (sum, order) => sum + getOrderUnitCount(order),
    0
  );
  const detailRecentOrder = detailOrders[0] || null;
  const detailOrderContactName =
    detailOrders.find((order) => order.import_contact_name)?.import_contact_name ||
    detailCustomer?.name ||
    "";
  const detailTopProducts = detailOrders
    .flatMap((order) => order.items || [])
    .reduce((summary, item) => {
      const key = item.article_no || item.product_name || `item-${summary.size}`;
      const existing = summary.get(key) || {
        key,
        article_no: item.article_no || "",
        product_name: item.product_name || item.article_no || "Product",
        product_image_url: item.product_image_url || "",
        quantity: 0,
        amount: 0,
      };
      existing.quantity += Number(item.quantity || 0);
      existing.amount += Number(item.line_total || 0);
      if (!existing.product_image_url && item.product_image_url) {
        existing.product_image_url = item.product_image_url;
      }
      summary.set(key, existing);
      return summary;
    }, new Map());
  const detailTopProductList = Array.from(detailTopProducts.values())
    .sort((firstItem, secondItem) => secondItem.quantity - firstItem.quantity)
    .slice(0, 4);
  const detailOrderCount = detailCustomer
    ? orderCountByCustomer.get(detailCustomer.id) || 0
    : 0;
  const detailShippingPhone = detailCustomer
    ? getCustomerShippingPhoneText(detailCustomer, orders)
    : "";
  const detailRows = detailCustomer
    ? [
        ["name", "Customer / owner", detailCustomer.name],
        ["company", "Store / company", detailCustomer.company_name],
        ["buyer", "Order placed by", detailOrderContactName],
        ["email", "Email", detailCustomer.email],
        ["phone", "Phone", detailCustomer.phone],
        ["shipping_phone", "Order / shipping phone", detailShippingPhone],
        ["platform", "Platform", detailCustomer.platform || "Manual"],
        ["country", "Country", detailCustomer.country],
        ["address", "Residential address", formatAddress(detailCustomer.address)],
        ["shipping_address", "Shipping address", formatAddress(detailCustomer.shipping_address)],
      ]
    : [];
  const detailCopyText = detailCustomer
    ? detailRows
        .map(([, label, value]) => `${label}: ${value || "Not provided"}`)
        .join("\n")
    : "";

  return (
    <div className="customers-page">
      <header className={`customers-page-header ${showSummary ? "is-expanded" : ""}`}>
        <div className="customers-header-title">
          <span>Directory</span>
          <h1>Customers</h1>
        </div>

        <div className="customers-header-actions">
          <input
            accept=".csv,text/csv"
            className="customers-file-input"
            onChange={importCustomersCsv}
            ref={csvInputRef}
            type="file"
          />
          <button
            className="customers-primary-button"
            onClick={openCreateForm}
            type="button"
          >
            Create customer
          </button>
          <button
            className="customers-secondary-button customers-import-button"
            disabled={importingCsv}
            onClick={openCsvImport}
            type="button"
          >
            <Icon name="upload" size={17} />
            {importingCsv ? "Uploading" : "Upload CSV"}
          </button>
          <button
            aria-controls="customers-header-summary"
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
          aria-label="Customer summary"
          className="customers-summary-strip"
          id="customers-header-summary"
        >
          <article>
            <span>Total customers</span>
            <strong>{customerSummary.total}</strong>
          </article>
          <article>
            <span>With orders</span>
            <strong>{customerSummary.withOrders}</strong>
          </article>
          <article>
            <span>Orders linked</span>
            <strong>{customerSummary.totalOrders}</strong>
          </article>
          <article>
            <span>Countries</span>
            <strong>{customerSummary.countries}</strong>
          </article>
        </section>
        )}
      </header>

      {notice && (
        <div className={`customers-alert is-${notice.type}`} role="status">
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

      {importSummary && (
        <div
          className="customers-import-summary-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !resolvingImportConflicts) {
              setImportSummary(null);
            }
          }}
        >
          <section
            aria-labelledby="customers-import-summary-title"
            aria-modal="true"
            className="customers-import-summary-modal"
            role="dialog"
          >
            <div className="customers-import-summary-header">
              <div>
                <span>{importSummary.source_format || "CSV"}</span>
                <h2 id="customers-import-summary-title">Import summary</h2>
              </div>
              <button
                aria-label="Close import summary"
                className="customers-modal-close"
                disabled={resolvingImportConflicts}
                onClick={() => setImportSummary(null)}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="customers-import-summary-grid">
              <article>
                <span>Total rows</span>
                <strong>{importSummary.total || 0}</strong>
              </article>
              <article>
                <span>Contacts added</span>
                <strong>{importSummary.created || 0}</strong>
              </article>
              <article>
                <span>Contacts merged</span>
                <strong>{importSummary.merged || 0}</strong>
              </article>
              <article>
                <span>Need review</span>
                <strong>{importIssueCount}</strong>
              </article>
              <article>
                <span>Existing matches</span>
                <strong>{importConflictCount}</strong>
              </article>
            </div>

            <div className="customers-import-field-grid">
              <span>
                Emails found <strong>{importSummary.with_email || 0}</strong>
              </span>
              <span>
                Phones found <strong>{importSummary.with_phone || 0}</strong>
              </span>
              <span>
                Residential addresses <strong>{importSummary.with_address || 0}</strong>
              </span>
              <span>
                Shipping addresses <strong>{importSummary.with_shipping_address || 0}</strong>
              </span>
            </div>

            {importConflictCount > 0 && (
              <div className="customers-import-conflicts">
                <div className="customers-import-conflicts-heading">
                  <div>
                    <h3>Existing contact matches</h3>
                    <p>Choose what should happen with each matched CSV contact.</p>
                  </div>
                  <span>{importConflictCount} to decide</span>
                </div>

                <div className="customers-import-conflict-list">
                  {importConflicts.map((conflict, index) => {
                    const conflictKey = getImportConflictKey(conflict, index);
                    const selectedAction =
                      selectedImportActions[conflictKey] || "skip";

                    return (
                      <article
                        className="customers-import-conflict-card"
                        key={conflictKey}
                      >
                        <div className="customers-import-conflict-title">
                          <div>
                            <span>Row {conflict.row || index + 2}</span>
                            <strong>{conflict.name || "Matched contact"}</strong>
                          </div>
                          <em>{conflict.reason || "Possible duplicate"}</em>
                        </div>

                        <div className="customers-import-compare">
                          {[
                            ["CSV file", conflict.incoming],
                            ["Saved customer", conflict.existing],
                          ].map(([title, contact]) => (
                            <section key={title}>
                              <h4>{title}</h4>
                              <dl>
                                {importConflictFields.map(([field, label]) => {
                                  const value =
                                    field === "address" || field === "shipping_address"
                                      ? formatAddress(contact?.[field])
                                      : contact?.[field];

                                  return (
                                    <div key={`${title}-${field}`}>
                                      <dt>{label}</dt>
                                      <dd>{value || "Not provided"}</dd>
                                    </div>
                                  );
                                })}
                              </dl>
                            </section>
                          ))}
                        </div>

                        <div
                          aria-label={`Choose import action for ${conflict.name || "matched contact"}`}
                          className="customers-import-conflict-actions"
                          role="radiogroup"
                        >
                          {importConflictActions.map(([value, label]) => (
                            <button
                              aria-checked={selectedAction === value}
                              className={selectedAction === value ? "is-selected" : ""}
                              disabled={resolvingImportConflicts}
                              key={value}
                              onClick={() =>
                                setSelectedImportActions((current) => ({
                                  ...current,
                                  [conflictKey]: value,
                                }))
                              }
                              role="radio"
                              type="button"
                            >
                              {selectedAction === value && (
                                <Icon name="check" size={14} />
                              )}
                              {label}
                            </button>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {importSummary.resolution && (
              <div className="customers-import-resolution">
                <strong>Duplicate review applied</strong>
                <span>
                  {Number(importSummary.resolution.added || 0)} added as new,{" "}
                  {Number(importSummary.resolution.merged || 0) +
                    Number(importSummary.resolution.updated || 0)} adjusted,{" "}
                  {Number(importSummary.resolution.skipped || 0) +
                    Number(importSummary.resolution.unchanged || 0)} skipped.
                </span>
              </div>
            )}

            {importErrors.length > 0 ? (
              <div className="customers-import-errors">
                <h3>Rows to review</h3>
                <ul>
                  {importErrors.map((error, index) => (
                    <li key={`${error.row || index}-${error.detail}`}>
                      <strong>
                        Row {error.row}
                        {error.name ? ` - ${error.name}` : ""}
                      </strong>
                      <span>{error.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : importConflictCount === 0 && !importSummary.resolution ? (
              <div className="customers-import-clean">
                All contacts in this file were imported cleanly.
              </div>
            ) : null}

            {Array.isArray(importSummary.resolution?.errors) &&
              importSummary.resolution.errors.length > 0 && (
                <div className="customers-import-errors">
                  <h3>Choices not applied</h3>
                  <ul>
                    {importSummary.resolution.errors.map((error, index) => (
                      <li key={`resolution-${error.row || index}-${error.detail}`}>
                        <strong>
                          Choice {error.row || index + 1}
                          {error.name ? ` - ${error.name}` : ""}
                        </strong>
                        <span>{error.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            <div className="customers-import-summary-footer">
              {importConflictCount > 0 ? (
                <>
                  <button
                    className="customers-secondary-button"
                    disabled={resolvingImportConflicts}
                    onClick={() => setImportSummary(null)}
                    type="button"
                  >
                    Close
                  </button>
                  <button
                    className="customers-primary-button"
                    disabled={resolvingImportConflicts}
                    onClick={resolveImportConflicts}
                    type="button"
                  >
                    {resolvingImportConflicts ? "Applying" : "Apply selected"}
                  </button>
                </>
              ) : (
                <button
                  className="customers-primary-button"
                  onClick={() => setImportSummary(null)}
                  type="button"
                >
                  Done
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="customers-directory-panel">
        <nav aria-label="Customer status" className="customers-tabs">
          {[
            ["all", "All"],
            ["with-orders", "With orders"],
            ["without-orders", "No orders"],
          ].map(([value, label]) => (
            <button
              aria-current={customerView === value ? "page" : undefined}
              className={customerView === value ? "is-active" : ""}
              key={value}
              onClick={() => setCustomerView(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="customers-toolbar">
          <label className="customers-search-box">
            <Icon name="search" size={17} />
            <input
              aria-label="Search customers"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search customer, company, email, or phone"
              value={searchQuery}
            />
          </label>
          <div className="customers-filter-controls">
            <select
              aria-label="Filter customers by platform"
              onChange={(event) => setPlatformFilter(event.target.value)}
              value={platformFilter}
            >
              <option value="all">All platforms</option>
              {platforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter customers by country"
              onChange={(event) => setCountryFilter(event.target.value)}
              value={countryFilter}
            >
              <option value="all">All countries</option>
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
            <button
              className="customers-secondary-button customers-export-button"
              onClick={() => exportCustomersCsv(filteredCustomers)}
              type="button"
            >
              <Icon name="download" size={15} />
              Export
            </button>
          </div>
        </div>

        {selectedCustomers.length > 0 && (
          <div className="customers-bulk-action-bar">
            <div>
              <strong>{selectedCustomers.length} selected</strong>
              <button onClick={() => setSelectedCustomerIds(new Set())} type="button">
                Clear selection
              </button>
            </div>
            <div className="customers-bulk-actions">
              <button onClick={bulkEditCustomers} type="button">
                <Icon name="edit" size={15} />
                Bulk edit
              </button>
              <button onClick={() => exportCustomersCsv(selectedCustomers)} type="button">
                <Icon name="download" size={15} />
                Export
              </button>
              <button
                className="is-danger"
                disabled={saving}
                onClick={() => deleteCustomers(selectedCustomers)}
                type="button"
              >
                <Icon name="trash" size={15} />
                Delete
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="customers-loading-list" aria-label="Loading customers">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="customers-loading-row" key={index} />
            ))}
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="customers-empty-state">
            <div>
              <Icon name="users" size={25} />
            </div>
            <h3>
              {customers.length === 0 ? "No customers yet" : "No matches found"}
            </h3>
            <p>
              {customers.length === 0
                ? "Add the first customer to start building the buyer directory."
                : "Try changing the search text or filters."}
            </p>
            {customers.length === 0 && (
              <button
                className="customers-primary-button"
                onClick={openCreateForm}
                type="button"
              >
                <Icon name="plus" size={17} />
                Add customer
              </button>
            )}
          </div>
        ) : (
          <div className="customers-table-wrap">
            <table className="customers-table">
              <thead>
                <tr>
                  <th className="customers-select-column">
                    <input
                      aria-label="Select all visible customers"
                      checked={allVisibleCustomersSelected}
                      onChange={toggleAllVisibleCustomers}
                      type="checkbox"
                    />
                  </th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Platform</th>
                  <th>Orders</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => {
                  const orderCount = orderCountByCustomer.get(customer.id) || 0;

                  return (
                    <tr
                      aria-label={`View ${customer.name} details`}
                      className="customers-clickable-row"
                      key={customer.id}
                      onClick={(event) => handleCustomerRowClick(event, customer)}
                      onKeyDown={(event) => handleCustomerRowKeyDown(event, customer)}
                      tabIndex={0}
                    >
                      <td className="customers-select-cell" data-label="Select">
                        <input
                          aria-label={`Select ${customer.name}`}
                          checked={selectedCustomerIds.has(customer.id)}
                          onChange={() => toggleCustomerSelection(customer.id)}
                          type="checkbox"
                        />
                      </td>
                      <td className="customers-identity-cell">
                        <div className="customers-identity">
                          <span className="customers-avatar">
                            {getCustomerInitials(customer)}
                          </span>
                          <div>
                            <strong>{customer.name}</strong>
                            {customer.company_name && (
                              <small>{customer.company_name}</small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td data-label="Contact">
                        <div className="customers-contact-list">
                          <span title={customer.email || "No email"}>
                            {customer.email || "No email"}
                          </span>
                          <span title={customer.phone || "No phone"}>
                            {customer.phone || "No phone"}
                          </span>
                        </div>
                      </td>
                      <td data-label="Location">
                        <div className="customers-location">
                          <strong>{customer.country || "Not specified"}</strong>
                          <span title={formatAddress(customer.address) || "No address"}>
                            {formatAddress(customer.address) || "No residential address"}
                          </span>
                          {customer.shipping_address && (
                            <span title={formatAddress(customer.shipping_address)}>
                              Ship: {formatAddress(customer.shipping_address)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-label="Platform">
                        <span className="customers-platform-pill">
                          {customer.platform || "Manual"}
                        </span>
                      </td>
                      <td data-label="Orders">
                        <span className="customers-order-count">
                          {orderCount}
                        </span>
                      </td>
                      <td className="customers-actions-cell">
                        <div className="customers-row-actions">
                          {onCreateOrder && (
                            <button
                              aria-label={`Create order for ${customer.name}`}
                              className="customers-text-action"
                              onClick={() => onCreateOrder(customer.id)}
                              title="Create order"
                              type="button"
                            >
                              Order
                            </button>
                          )}
                          <button
                            aria-label={`Edit ${customer.name}`}
                            className="customers-text-action"
                            onClick={() => handleEdit(customer)}
                            title="Edit customer"
                            type="button"
                          >
                            Edit
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

      {detailCustomer && (
        <div
          className="customers-detail-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDetailCustomer(null);
              setCopiedField("");
            }
          }}
        >
          <section
            aria-labelledby="customers-detail-title"
            aria-modal="true"
            className="customers-detail-modal"
            role="dialog"
          >
            <div className="customers-detail-header">
              <div className="customers-detail-identity">
                <span className="customers-avatar">
                  {getCustomerInitials(detailCustomer)}
                </span>
                <div>
                  <h2 id="customers-detail-title">{detailCustomer.name}</h2>
                  <span>{detailCustomer.company_name || "No company name"}</span>
                </div>
              </div>
              <button
                aria-label="Close customer details"
                className="customers-modal-close"
                onClick={() => {
                  setDetailCustomer(null);
                  setCopiedField("");
                }}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="customers-profile-layout">
              <main className="customers-profile-main">
                <section className="customers-profile-card customers-profile-summary-card">
                  <div className="customers-profile-card-heading">
                    <div>
                      <span>Summary</span>
                      <h3>{detailCustomer.company_name || detailCustomer.name}</h3>
                    </div>
                    <em>Last order {formatCustomerDate(detailRecentOrder?.order_date)}</em>
                  </div>

                  <div className="customers-profile-metrics">
                    <article>
                      <span>Total revenue</span>
                      <strong>{formatCustomerMoney(detailTotalRevenue)}</strong>
                    </article>
                    <article>
                      <span>Total orders</span>
                      <strong>{detailOrderCount}</strong>
                    </article>
                    <article>
                      <span>Total items</span>
                      <strong>{detailTotalUnits}</strong>
                    </article>
                  </div>

                  <div className="customers-profile-products">
                    <span>Products ordered</span>
                    {detailTopProductList.length > 0 ? (
                      <div className="customers-profile-product-strip">
                        {detailTopProductList.map((item) => (
                          <div className="customers-profile-product" key={item.key}>
                            {item.product_image_url ? (
                              <img
                                alt={item.product_name}
                                src={getStaticUrl(item.product_image_url)}
                              />
                            ) : (
                              <span>{getCustomerInitials({ name: item.article_no || item.product_name })}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>No products ordered yet.</p>
                    )}
                  </div>
                </section>

                <section className="customers-profile-card customers-open-orders-card">
                  <div className="customers-profile-card-heading">
                    <div>
                      <span>Open orders</span>
                      <h3>{formatCustomerMoney(detailOpenOrders.reduce((sum, order) => sum + getOrderTotalUsd(order), 0))}</h3>
                    </div>
                    <em>{detailOpenOrders.length} open</em>
                  </div>

                  {detailOpenOrders.length > 0 ? (
                    <div className="customers-order-mini-table">
                      <div className="customers-order-mini-head">
                        <span>Product</span>
                        <span>Qty</span>
                        <span>Amount</span>
                      </div>
                      {detailOpenOrders.slice(0, 5).map((order) => (
                        <article className="customers-order-mini-row" key={order.id}>
                          <div className="customers-order-product-cell">
                            <div className="customers-order-thumbnails">
                              {getOrderImageItems(order, 3).map((item) => (
                                <img
                                  alt={item.product_name || item.article_no || "Product"}
                                  key={`${order.id}-${item.id || item.article_no}`}
                                  src={getStaticUrl(item.product_image_url)}
                                />
                              ))}
                            </div>
                            <div>
                              <strong>#{order.order_no}</strong>
                              <span>{getOrderPrimaryItemsText(order)}</span>
                              <small>{formatCustomerDate(order.order_date)}</small>
                            </div>
                          </div>
                          <span>{getOrderUnitCount(order)}</span>
                          <strong>{formatCustomerMoney(getOrderTotalUsd(order))}</strong>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="customers-profile-empty">No open orders for this customer.</p>
                  )}
                </section>

                <section className="customers-profile-card customers-order-history-card">
                  <div className="customers-profile-card-heading">
                    <div>
                      <span>Order history</span>
                      <h3>{detailOrderCount} orders</h3>
                    </div>
                  </div>

                  {detailOrderHistory.length > 0 ? (
                    <div className="customers-history-table">
                      <div className="customers-history-head">
                        <span>Status</span>
                        <span>Date</span>
                        <span>Products</span>
                        <span>Items</span>
                        <span>Amount</span>
                      </div>
                      {detailOrderHistory.map((order) => (
                        <article className="customers-history-row" key={order.id}>
                          <span className="customers-status-chip">
                            {order.shipping_status || order.status || "Pending"}
                          </span>
                          <span>{formatCustomerDate(order.order_date)}</span>
                          <div className="customers-order-thumbnails">
                            {getOrderImageItems(order, 4).map((item) => (
                              <img
                                alt={item.product_name || item.article_no || "Product"}
                                key={`${order.id}-history-${item.id || item.article_no}`}
                                src={getStaticUrl(item.product_image_url)}
                              />
                            ))}
                          </div>
                          <span>{getOrderUnitCount(order)}</span>
                          <strong>{formatCustomerMoney(getOrderTotalUsd(order))}</strong>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="customers-profile-empty">No order history yet.</p>
                  )}
                </section>

              </main>

              <aside className="customers-profile-sidebar">
                <section className="customers-profile-card customers-info-card">
                  <h3>Information</h3>
                  <div className="customers-profile-info-list">
                    {detailRows.map(([key, label, value]) => {
                      const displayValue = value || "Not provided";
                      const canCopy = Boolean(value);
                      return (
                        <div
                          className={`customers-profile-info-row ${
                            key.includes("address") || key === "shipping_phone"
                              ? "is-address"
                              : ""
                          }`}
                          key={key}
                        >
                          <div>
                            <span>{label}</span>
                            <strong>{displayValue}</strong>
                          </div>
                          <button
                            aria-label={`Copy ${label}`}
                            className="customers-copy-button"
                            disabled={!canCopy}
                            onClick={() => copyToClipboard(label, value)}
                            title={`Copy ${label}`}
                            type="button"
                          >
                            <Icon
                              name={copiedField === label ? "check" : "copy"}
                              size={15}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="customers-profile-card customers-management-card">
                  <h3>Customer management</h3>
                  <div className="customers-management-list">
                    <div>
                      <span>Status</span>
                      <strong>{detailOpenOrders.length > 0 ? "Active buyer" : "No open orders"}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>{detailCustomer.platform || "Manual"}</strong>
                    </div>
                    <div>
                      <span>Tags</span>
                      <strong>
                        {[
                          detailCustomer.country,
                          detailOpenOrders.length ? "Open order" : "",
                          detailCustomer.platform,
                        ]
                          .filter(Boolean)
                          .join(", ") || "No tags"}
                      </strong>
                    </div>
                  </div>
                </section>
              </aside>
            </div>

            <div className="customers-detail-footer">
              <button
                className="customers-secondary-button"
                onClick={() => copyToClipboard("All details", detailCopyText)}
                type="button"
              >
                <Icon name={copiedField === "All details" ? "check" : "copy"} size={16} />
                Copy all
              </button>
              <button
                className="customers-primary-button"
                onClick={() => {
                  setDetailCustomer(null);
                  setCopiedField("");
                  handleEdit(detailCustomer);
                }}
                type="button"
              >
                <Icon name="edit" size={16} />
                Edit customer
              </button>
            </div>
          </section>
        </div>
      )}

      {showForm && (
        <div
          className="customers-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <div
            aria-labelledby="customers-modal-title"
            aria-modal="true"
            className="customers-modal"
            role="dialog"
          >
            <div className="customers-modal-header">
              <h2 id="customers-modal-title">
                {editingId !== null ? "Edit customer" : "Add customer"}
              </h2>
              <button
                aria-label="Close customer form"
                className="customers-modal-close"
                disabled={saving}
                onClick={closeForm}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <form className="customers-form" onSubmit={saveCustomer}>
              <div className="customers-form-content">
                <div className="customers-field-grid">
                  <label className="customers-field">
                    <span>Customer name</span>
                    <input
                      autoFocus
                      name="name"
                      onChange={handleChange}
                      placeholder="John Smith"
                      required
                      value={form.name}
                    />
                  </label>
                  <label className="customers-field">
                    <span>Company name</span>
                    <input
                      name="company_name"
                      onChange={handleChange}
                      placeholder="ABC Imports LLC"
                      value={form.company_name}
                    />
                  </label>
                  <label className="customers-field">
                    <span>Email</span>
                    <div className="customers-input-icon">
                      <Icon name="mail" size={15} />
                      <input
                        name="email"
                        onChange={handleChange}
                        placeholder="customer@email.com"
                        type="email"
                        value={form.email}
                      />
                    </div>
                  </label>
                  <label className="customers-field">
                    <span>Phone</span>
                    <div className="customers-input-icon">
                      <Icon name="phone" size={15} />
                      <input
                        name="phone"
                        onChange={handleChange}
                        placeholder="+1 000 000 0000"
                        value={form.phone}
                      />
                    </div>
                  </label>
                  <label className="customers-field">
                    <span>Country</span>
                    <div className="customers-input-icon">
                      <Icon name="globe" size={15} />
                      <input
                        list="customers-country-options"
                        name="country"
                        onChange={handleChange}
                        placeholder="United States"
                        value={form.country}
                      />
                    </div>
                  </label>
                  <label className="customers-field">
                    <span>Platform</span>
                    <select
                      name="platform"
                      onChange={handleChange}
                      value={form.platform}
                    >
                      {platforms.map((platform) => (
                        <option key={platform} value={platform}>
                          {platform}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="customers-field is-wide">
                    <span>Residential address</span>
                    <textarea
                      name="address"
                      onChange={handleChange}
                      placeholder="Home, billing, or profile address"
                      rows="3"
                      value={form.address}
                    />
                  </label>
                  <label className="customers-field is-wide">
                    <span>Shipping address</span>
                    <textarea
                      name="shipping_address"
                      onChange={handleChange}
                      placeholder="Shop, warehouse, or commercial ship-to address"
                      rows="3"
                      value={form.shipping_address}
                    />
                  </label>
                </div>
              </div>

              <div className="customers-form-footer">
                <button
                  className="customers-secondary-button"
                  disabled={saving}
                  onClick={closeForm}
                  type="button"
                >
                  Cancel
                </button>
                {onCreateOrder && (
                  <button
                    className="customers-secondary-button customers-save-order-button"
                    disabled={saving}
                    type="submit"
                    value="save-and-add-order"
                  >
                    <Icon name="orders" size={17} />
                    {saving
                      ? "Saving"
                      : editingId !== null
                        ? "Update & add order"
                        : "Save & add order"}
                  </button>
                )}
                <button
                  className="customers-primary-button"
                  disabled={saving}
                  type="submit"
                >
                  <Icon name="check" size={17} />
                  {saving
                    ? "Saving"
                    : editingId !== null
                      ? "Update customer"
                      : "Save customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <datalist id="customers-country-options">
        {countries.map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>
    </div>
  );
}

export default Customers;
