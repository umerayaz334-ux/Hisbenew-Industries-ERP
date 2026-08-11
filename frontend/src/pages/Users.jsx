import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import { formatUtcLocal } from "../utils/dateUtils";
import "./Users.css";

const ACCESS_GROUPS = [
  {
    name: "Core workspace",
    description: "Home dashboard and daily personal work.",
    pages: ["Dashboard", "My Tasks"],
  },
  {
    name: "Sales and orders",
    description: "Customer records, orders, payouts, billings, and accounting.",
    pages: ["Customers", "Orders", "Payouts", "Billings", "Accounting"],
  },
  {
    name: "Shipping",
    description: "Shipment processing and courier balances.",
    pages: [
      "Shipping",
      "Warehouse / Fulfillment",
      "Warehouse Dispatch",
      "Warehouse Shipments",
      "Warehouse Stock",
      "Shipping Balance",
    ],
  },
  {
    name: "Products and stock",
    description: "Catalog, ideas, stock tools, and vendor/account records.",
    pages: ["Products", "Inventory", "Label Printer", "Inspiration", "Suppliers"],
  },
  {
    name: "Factory operations",
    description: "Manufacturing workflows, production, workers, and worker accounts.",
    pages: ["Manufacturing", "Production", "Workers", "Worker Payouts"],
  },
  {
    name: "Administration",
    description: "Reporting, system data, communication, and configuration.",
    pages: [
      "Reports",
      "Messages",
      "Copy Clipboard",
      "Website",
      "Deployment",
      "TempData",
      "Settings",
      "Quotes",
      "Companies",
      "Users",
    ],
  },
];

const PAGE_LABELS = {
  Suppliers: "Accounts",
  "Worker Payouts": "Worker Accounts",
};

const normalizePageName = (page) => (page === "Payments" ? "Billings" : page);
const normalizePageList = (pages = []) =>
  pages
    .map(normalizePageName)
    .filter((page, index, list) => page && list.indexOf(page) === index);

const pageLabel = (page) => PAGE_LABELS[page] || page;

const buildAccessGroups = (pages = []) => {
  const availablePages = normalizePageList(pages);
  const seenPages = new Set();
  const groups = ACCESS_GROUPS.map((group) => {
    const groupPages = group.pages.filter((page) => {
      if (!availablePages.includes(page) || seenPages.has(page)) return false;
      seenPages.add(page);
      return true;
    });

    return { ...group, pages: groupPages };
  }).filter((group) => group.pages.length > 0);
  const otherPages = availablePages.filter((page) => !seenPages.has(page));

  if (otherPages.length > 0) {
    groups.push({
      name: "Other pages",
      description: "New ERP areas that are not assigned to a group yet.",
      pages: otherPages,
    });
  }

  return groups;
};

const ROLE_LABELS = {
  super_admin: "Super admin",
  admin: "Administrator",
  manager: "Manager",
  warehouse: "Warehouse / Fulfillment",
  worker: "Worker",
  service_taker: "Service taker",
  unassigned: "Assign role later",
};

const roleLabel = (role) => ROLE_LABELS[role] || role;

const DEFAULT_PRIVACY_SETTINGS = {
  hide_customer_business_for_non_admin: true,
  hide_worker_customer_names_except_shipping: true,
  hide_customer_phone_for_non_admin: true,
};

const PRIVACY_ROLE_DEFAULTS = {
  super_admin: {
    hide_customer_business_for_non_admin: false,
    hide_worker_customer_names_except_shipping: false,
    hide_customer_phone_for_non_admin: false,
  },
  admin: {
    hide_customer_business_for_non_admin: false,
    hide_worker_customer_names_except_shipping: false,
    hide_customer_phone_for_non_admin: false,
  },
  manager: {
    hide_customer_business_for_non_admin: true,
    hide_worker_customer_names_except_shipping: false,
    hide_customer_phone_for_non_admin: true,
  },
  warehouse: {
    hide_customer_business_for_non_admin: true,
    hide_worker_customer_names_except_shipping: false,
    hide_customer_phone_for_non_admin: true,
  },
  worker: DEFAULT_PRIVACY_SETTINGS,
  service_taker: DEFAULT_PRIVACY_SETTINGS,
  unassigned: DEFAULT_PRIVACY_SETTINGS,
};

const PRIVACY_CONTROLS = [
  {
    key: "hide_customer_business_for_non_admin",
    label: "Hide business/shop names",
    description:
      "This user sees the customer personal name instead of the store or company name.",
  },
  {
    key: "hide_worker_customer_names_except_shipping",
    label: "Hide customer names except shipping",
    description:
      "This user sees no customer name on normal order tasks; shipping tasks can show the personal name.",
  },
  {
    key: "hide_customer_phone_for_non_admin",
    label: "Hide customer phone numbers",
    description: "This user cannot see customer phone numbers in order workflows.",
  },
];

const privacyDefaultsForRole = (role, roleDefaults = PRIVACY_ROLE_DEFAULTS) =>
  roleDefaults?.[role] ||
  PRIVACY_ROLE_DEFAULTS[role] ||
  DEFAULT_PRIVACY_SETTINGS;

const normalizePrivacySettings = (
  settings = {},
  role = "unassigned",
  roleDefaults = PRIVACY_ROLE_DEFAULTS
) => {
  const source = settings && typeof settings === "object" ? settings : {};
  return Object.fromEntries(
    Object.entries(privacyDefaultsForRole(role, roleDefaults)).map(([key, defaultValue]) => [
      key,
      typeof source[key] === "boolean" ? source[key] : defaultValue,
    ])
  );
};

const EMPTY_ACCESS_OPTIONS = {
  pages: ACCESS_GROUPS.flatMap((group) => group.pages),
  role_defaults: {
    super_admin: ["Dashboard", "Add Company", "Companies", "Users", "Settings"],
    admin: ACCESS_GROUPS.flatMap((group) => group.pages).filter(
      (page) => page !== "My Tasks"
    ),
    manager: [
      "Dashboard",
      "Customers",
      "Orders",
      "Payouts",
      "Billings",
      "Accounting",
      "Shipping",
      "Warehouse / Fulfillment",
      "Shipping Balance",
      "Products",
      "Inventory",
      "Label Printer",
      "Inspiration",
      "Suppliers",
      "Manufacturing",
      "Production",
      "Worker Payouts",
      "Reports",
      "Messages",
      "Copy Clipboard",
      "Website",
      "TempData",
      "Settings",
      "Quotes",
    ],
    warehouse: [
      "Dashboard",
      "Warehouse Dispatch",
      "Warehouse Shipments",
      "Warehouse Stock",
      "Label Printer",
      "Messages",
      "Settings",
    ],
    worker: ["Dashboard", "My Tasks", "Worker Payouts", "Manufacturing", "Production", "Messages", "Settings"],
    service_taker: [
      "Service Dashboard",
      "Service Products",
      "Service Inbound",
      "Service Shipments",
      "Service Charges",
    ],
    unassigned: ["Dashboard"],
  },
  parent_map: {
    Payouts: "Orders",
    Billings: "Orders",
    Accounting: "Orders",
    "Shipping Balance": "Shipping",
    "Warehouse / Fulfillment": "Shipping",
    "Warehouse Dispatch": "Warehouse / Fulfillment",
    "Warehouse Shipments": "Warehouse / Fulfillment",
    "Warehouse Stock": "Warehouse / Fulfillment",
    Inventory: "Products",
    "Label Printer": "Products",
    Suppliers: "Products",
    Production: "Manufacturing",
    Workers: "Manufacturing",
    "Worker Payouts": "Manufacturing",
    Quotes: "Settings",
    Users: "Settings",
    Companies: "Settings",
    Website: "Settings",
    Deployment: "Settings",
    Inspiration: "Products",
    "Copy Clipboard": "Settings",
  },
  privacy_settings: DEFAULT_PRIVACY_SETTINGS,
  privacy_role_defaults: PRIVACY_ROLE_DEFAULTS,
};

const SESSION_EXPIRY_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 60, label: "1 hour" },
  { value: 480, label: "8 hours" },
  { value: 1440, label: "1 day" },
  { value: 10080, label: "7 days" },
  { value: 43200, label: "30 days" },
];

const getInitials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

const arraysMatch = (left = [], right = []) => {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
};

const normalizeSessionExpiryMinutes = (value) => {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes);
};

const formatSessionExpiry = (value) => {
  const minutes = normalizeSessionExpiryMinutes(value);
  if (minutes === 0) return "Never expires";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} min`;
};

const REQUEST_WORKSPACE_ROLES = {
  "factory operations": "manager",
  "warehouse and fulfillment": "warehouse",
  "finance and accounting": "manager",
  "school erp": "unassigned",
  "service taker portal": "unassigned",
};

const suggestedRoleForAccessRequest = (request = {}) => {
  const suggestedRole = request.suggested_role;
  if (suggestedRole && ROLE_LABELS[suggestedRole]) return suggestedRole;
  const workspace = String(request.requested_workspace || "").trim().toLowerCase();
  return REQUEST_WORKSPACE_ROLES[workspace] || "unassigned";
};

const usernameFromAccessRequest = (request = {}) => {
  const preferred = String(request.preferred_username || "").trim();
  if (preferred) return preferred;
  const generated = String(request.full_name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
  return generated || "new.user";
};

const requestStatusClass = (status = "Pending") =>
  String(status || "Pending").toLowerCase().replace(/\s+/g, "-");
const activityContextText = (activity) => {
  const summary = String(activity.summary || "");
  const parts = [];

  if (activity.detail) {
    parts.push(activity.detail);
  } else if (activity.page) {
    parts.push(activity.page);
  } else if (activity.entity_type) {
    parts.push(activity.entity_type);
  }

  if (
    activity.entity_id &&
    activity.entity_id !== activity.page &&
    !summary.includes(String(activity.entity_id))
  ) {
    parts.push(`#${activity.entity_id}`);
  }

  return [...new Set(parts.filter(Boolean))].join(" / ");
};

export default function Users({ authenticatedUser }) {
  const confirmDialog = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [roleRequests, setRoleRequests] = useState([]);
  const [accessRequests, setAccessRequests] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [accessOptions, setAccessOptions] = useState(EMPTY_ACCESS_OPTIONS);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("unassigned");
  const [pin, setPin] = useState("0000");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [tenantId, setTenantId] = useState("");
  const [workerId, setWorkerId] = useState(null);
  const [sessionExpiryMinutes, setSessionExpiryMinutes] = useState(0);
  const [customerPrivacySettings, setCustomerPrivacySettings] = useState(
    privacyDefaultsForRole("unassigned")
  );
  const [customerPrivacySavingKey, setCustomerPrivacySavingKey] = useState("");
  const [customerPrivacyError, setCustomerPrivacyError] = useState("");
  const [allowedPages, setAllowedPages] = useState(
    EMPTY_ACCESS_OPTIONS.role_defaults.unassigned
  );
  const [editingUserId, setEditingUserId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [activityUser, setActivityUser] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityClearing, setActivityClearing] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityFilter, setActivityFilter] = useState("all");
  const [roleRequestUpdatingId, setRoleRequestUpdatingId] = useState(null);
  const [accessRequestUpdatingId, setAccessRequestUpdatingId] = useState(null);
  const [approvingAccessRequest, setApprovingAccessRequest] = useState(null);
  const [approvalNote, setApprovalNote] = useState("");
  const isSuperAdmin = authenticatedUser?.role === "super_admin";

  const loadUsers = async () => {
    const response = await api.get("/users");
    const rolePrivacyDefaults =
      accessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS;
    setUsers(
      Array.isArray(response.data)
        ? response.data.map((user) => ({
            ...user,
            allowed_pages: normalizePageList(user.allowed_pages || []),
            customer_privacy_settings: normalizePrivacySettings(
              user.customer_privacy_settings,
              user.role,
              rolePrivacyDefaults
            ),
          }))
        : []
    );
  };

  const loadRoleRequests = async () => {
    const response = await api.get("/role-requests");
    setRoleRequests(Array.isArray(response.data) ? response.data : []);
  };

  const loadAccessRequests = async () => {
    const response = await api.get("/access-requests");
    setAccessRequests(Array.isArray(response.data) ? response.data : []);
  };

  const loadTenants = async () => {
    if (!isSuperAdmin) {
      setTenants([]);
      return;
    }
    const response = await api.get("/tenants");
    setTenants(Array.isArray(response.data) ? response.data : []);
  };

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      api.get("/users"),
      api.get("/workers"),
      api.get("/role-requests"),
      api.get("/access-requests"),
      api.get("/user-access-options"),
      isSuperAdmin ? api.get("/tenants") : Promise.resolve({ data: [] }),
    ])
      .then(([usersResult, workersResult, requestsResult, accessRequestsResult, accessResult, tenantsResult]) => {
        if (!active) return;

        const nextAccessOptions =
          accessResult.status === "fulfilled"
            ? accessResult.value.data || EMPTY_ACCESS_OPTIONS
            : EMPTY_ACCESS_OPTIONS;
        const nextPrivacyRoleDefaults = Object.fromEntries(
          Object.entries(
            nextAccessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS
          ).map(([key, settings]) => [
            key,
            normalizePrivacySettings(settings, key),
          ])
        );

        if (usersResult.status === "fulfilled") {
          setUsers(
            Array.isArray(usersResult.value.data)
              ? usersResult.value.data.map((user) => ({
                  ...user,
                  allowed_pages: normalizePageList(user.allowed_pages || []),
                  customer_privacy_settings: normalizePrivacySettings(
                    user.customer_privacy_settings,
                    user.role,
                    nextPrivacyRoleDefaults
                  ),
                }))
              : []
          );
          setError("");
        } else {
          console.error("Unable to load users.", usersResult.reason);
          setError("Unable to load users. Sign out and sign in again, then reopen Users.");
        }

        setWorkers(
          workersResult.status === "fulfilled" && Array.isArray(workersResult.value.data)
            ? workersResult.value.data
            : []
        );
        setRoleRequests(
          requestsResult.status === "fulfilled" && Array.isArray(requestsResult.value.data)
            ? requestsResult.value.data
            : []
        );
        setAccessRequests(
          accessRequestsResult.status === "fulfilled" && Array.isArray(accessRequestsResult.value.data)
            ? accessRequestsResult.value.data
            : []
        );
        setTenants(
          tenantsResult.status === "fulfilled" && Array.isArray(tenantsResult.value.data)
            ? tenantsResult.value.data
            : []
        );
        setAccessOptions({
          ...nextAccessOptions,
          pages: normalizePageList(nextAccessOptions.pages || []),
          role_defaults: Object.fromEntries(
            Object.entries(nextAccessOptions.role_defaults || {}).map(
              ([key, pages]) => [key, normalizePageList(pages)]
            )
          ),
          parent_map: Object.fromEntries(
            Object.entries(nextAccessOptions.parent_map || {}).map(
              ([key, value]) => [normalizePageName(key), normalizePageName(value)]
            )
          ),
          privacy_settings: normalizePrivacySettings(
            nextAccessOptions.privacy_settings
          ),
          privacy_role_defaults: nextPrivacyRoleDefaults,
        });
      })
      .catch((loadError) => {
        console.error("Unable to load user administration data.", loadError);
        if (active) setError("Unable to load user administration data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSuperAdmin]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery =
        !query ||
        [user.name, user.username, user.phone, user.email, user.role, user.tenant_name, user.tenant_slug].some((value) =>
          String(value || "").toLowerCase().includes(query)
        );
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? user.is_active : !user.is_active);
      const matchesCompany =
        !isSuperAdmin || tenantFilter === "all" || Number(user.tenant_id) === Number(tenantFilter);
      return matchesQuery && matchesRole && matchesStatus && matchesCompany;
    });
  }, [isSuperAdmin, roleFilter, search, statusFilter, tenantFilter, users]);

  const activeUsers = users.filter((user) => user.is_active).length;
  const openRoleRequests = roleRequests.filter(
    (request) => String(request.status || "").toLowerCase() === "open"
  );
  const openAccessRequests = accessRequests.filter((request) =>
    ["pending", "contacted"].includes(String(request.status || "").toLowerCase())
  );
  const customAccessUsers = users.filter(
    (user) =>
      !arraysMatch(
        user.allowed_pages,
        accessOptions.role_defaults?.[user.role] ||
          EMPTY_ACCESS_OPTIONS.role_defaults[user.role] ||
          []
      )
  ).length;
  const tenantOptions = useMemo(
    () => tenants.filter((tenant) => tenant.status !== "inactive"),
    [tenants]
  );
  const defaultTenantId = String(tenantOptions[0]?.id || tenants[0]?.id || "");

  useEffect(() => {
    if (isSuperAdmin && !tenantId && defaultTenantId) {
      setTenantId(defaultTenantId);
    }
  }, [defaultTenantId, isSuperAdmin, tenantId]);
  const getRoleDefaults = useCallback((nextRole) =>
    accessOptions.role_defaults?.[nextRole] ||
    EMPTY_ACCESS_OPTIONS.role_defaults[nextRole] ||
    EMPTY_ACCESS_OPTIONS.role_defaults.unassigned, [accessOptions.role_defaults]);

  const pageChoicesForRole = useMemo(
    () =>
      role === "unassigned"
        ? getRoleDefaults(role)
        : accessOptions.pages,
    [accessOptions.pages, getRoleDefaults, role]
  );
  const permissionGroups = useMemo(
    () => buildAccessGroups(accessOptions.pages),
    [accessOptions.pages]
  );

  const applyRoleDefaults = (nextRole = role) => {
    setAllowedPages([...getRoleDefaults(nextRole)]);
  };

  const resetForm = (nextRole = "unassigned") => {
    setName("");
    setUsername("");
    setRole(nextRole);
    setPin("0000");
    setPhone("");
    setEmail("");
    setIsActive(true);
    setWorkerId(null);
    setTenantId(defaultTenantId);
    setSessionExpiryMinutes(0);
    setCustomerPrivacySettings(
      privacyDefaultsForRole(
        nextRole,
        accessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS
      )
    );
    setAllowedPages([
      ...getRoleDefaults(nextRole),
    ]);
    setEditingUserId(null);
    setError("");
    setCustomerPrivacyError("");
    setCustomerPrivacySavingKey("");
  };

  const openForm = () => {
    resetForm();
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingUserId(null);
    setApprovingAccessRequest(null);
    setApprovalNote("");
    setError("");
    setCustomerPrivacyError("");
    setCustomerPrivacySavingKey("");
  };

  const startApproveAccessRequest = (requestItem) => {
    const nextRole = suggestedRoleForAccessRequest(requestItem);
    setApprovingAccessRequest(requestItem);
    setEditingUserId(null);
    setName(requestItem.full_name || "");
    setUsername(usernameFromAccessRequest(requestItem));
    setRole(nextRole);
    setPin("0000");
    setPhone(requestItem.phone || "");
    setEmail(requestItem.work_email || "");
    setIsActive(true);
    setWorkerId(null);
    setTenantId(requestItem.tenant_id ? String(requestItem.tenant_id) : defaultTenantId);
    setSessionExpiryMinutes(0);
    setApprovalNote("");
    setCustomerPrivacySettings(
      privacyDefaultsForRole(
        nextRole,
        accessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS
      )
    );
    setAllowedPages([...getRoleDefaults(nextRole)]);
    setCustomerPrivacyError("");
    setCustomerPrivacySavingKey("");
    setError("");
    setShowForm(true);
  };

  const startEdit = (user) => {
    setEditingUserId(user.id);
    setName(user.name || "");
    setUsername(user.username || "");
    setRole(user.role);
    setPin("");
    setPhone(user.phone || "");
    setEmail(user.email || "");
    setIsActive(Boolean(user.is_active));
    setWorkerId(user.worker_id || null);
    setTenantId(user.tenant_id ? String(user.tenant_id) : defaultTenantId);
    setSessionExpiryMinutes(
      normalizeSessionExpiryMinutes(user.session_expiry_minutes)
    );
    setCustomerPrivacySettings(
      normalizePrivacySettings(
        user.customer_privacy_settings,
        user.role,
        accessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS
      )
    );
    setAllowedPages(
      Array.isArray(user.allowed_pages)
        ? normalizePageList(user.allowed_pages)
        : [...getRoleDefaults(user.role)]
    );
    setError("");
    setCustomerPrivacyError("");
    setCustomerPrivacySavingKey("");
    setShowForm(true);
  };

  const changeRole = (nextRole) => {
    setRole(nextRole);
    setAllowedPages([...getRoleDefaults(nextRole)]);
    setCustomerPrivacySettings(
      privacyDefaultsForRole(
        nextRole,
        accessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS
      )
    );
    setCustomerPrivacyError("");
    setCustomerPrivacySavingKey("");
    if (nextRole !== "worker") setWorkerId(null);
  };

  const togglePage = (page) => {
    setAllowedPages((current) => {
      const next = new Set(current);

      if (next.has(page)) {
        next.delete(page);
      } else {
        next.add(page);
      }

      next.add("Dashboard");
      return pageChoicesForRole.filter((option) => next.has(option));
    });
  };

  const toggleCustomerPrivacySetting = async (key) => {
    const previousSettings = customerPrivacySettings;
    const nextSettings = {
      ...previousSettings,
      [key]: !previousSettings[key],
    };

    setCustomerPrivacySettings(nextSettings);
    setCustomerPrivacyError("");

    if (!editingUserId) return;

    setCustomerPrivacySavingKey(key);
    try {
      const privacyUrl = `/users/${editingUserId}/customer-privacy-settings`;
      let response;
      try {
        response = await api.patch(privacyUrl, nextSettings);
      } catch (patchError) {
        if (patchError.response?.status !== 405) throw patchError;
        response = await api.put(privacyUrl, nextSettings);
      }
      const savedUser = response.data || {};
      const savedSettings = normalizePrivacySettings(
        savedUser.customer_privacy_settings,
        savedUser.role || role,
        accessOptions.privacy_role_defaults || PRIVACY_ROLE_DEFAULTS
      );
      setCustomerPrivacySettings(savedSettings);
      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.id === editingUserId
            ? { ...user, customer_privacy_settings: savedSettings }
            : user
        )
      );
    } catch (saveError) {
      console.error("Save customer privacy settings error:", saveError);
      setCustomerPrivacySettings(previousSettings);
      setCustomerPrivacyError(
        saveError.response?.data?.detail ||
          "Unable to save these privacy settings."
      );
    } finally {
      setCustomerPrivacySavingKey("");
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Enter the user's name.");
      return;
    }
    if ((!editingUserId || pin) && !/^\d{4}$/.test(pin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }

    const allowedChoiceSet = new Set(pageChoicesForRole);
    const selectedAllowedPages = normalizePageList(["Dashboard", ...allowedPages]).filter(
      (page) => allowedChoiceSet.has(page)
    );

    const payload = {
      name: name.trim(),
      username: username.trim() || null,
      role,
      phone: phone.trim() || null,
      email: email.trim() || null,
      allowed_pages: selectedAllowedPages,
      customer_privacy_settings: customerPrivacySettings,
      session_expiry_minutes: sessionExpiryMinutes,
      is_active: isActive,
      worker_id: role === "worker" ? workerId : null,
    };
    if (isSuperAdmin && tenantId) payload.tenant_id = Number(tenantId);
    if (!editingUserId || pin) payload.pin = pin;
    if (approvingAccessRequest && !editingUserId) {
      payload.admin_note = approvalNote.trim() || null;
    }

    setSaving(true);
    try {
      if (approvingAccessRequest && !editingUserId) {
        await api.post(`/access-requests/${approvingAccessRequest.id}/approve`, payload);
        await Promise.all([loadUsers(), loadAccessRequests(), loadTenants()]);
      } else {
        if (editingUserId) {
          await api.put(`/users/${editingUserId}`, payload);
        } else {
          await api.post("/users", payload);
        }
        await Promise.all([loadUsers(), loadTenants()]);
      }
      closeForm();
    } catch (saveError) {
      console.error("Save user error:", saveError);
      setError(
        saveError.response?.data?.detail ||
          (approvingAccessRequest
            ? "Unable to approve this access request."
            : editingUserId
              ? "Unable to update this user."
              : "Unable to create this user.")
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setError("");
    try {
      await api.delete(`/users/${deleteCandidate.id}`);
      setDeleteCandidate(null);
      await loadUsers();
    } catch (deleteError) {
      console.error("Delete user error:", deleteError);
      setError(deleteError.response?.data?.detail || "Unable to delete user.");
    }
  };

  const loadActivity = async (userId, action = "all") => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const response = await api.get(`/users/${userId}/activity-logs`, {
        params: { limit: 150, action },
      });
      setActivityLogs(Array.isArray(response.data) ? response.data : []);
    } catch (loadError) {
      console.error("User activity load error:", loadError);
      setActivityError("Unable to load activity history.");
    } finally {
      setActivityLoading(false);
    }
  };

  const openActivity = (user) => {
    setActivityUser(user);
    setActivityFilter("all");
    setActivityLogs([]);
    loadActivity(user.id);
  };

  const changeActivityFilter = (nextFilter) => {
    setActivityFilter(nextFilter);
    if (activityUser) loadActivity(activityUser.id, nextFilter);
  };

  const clearActivityHistory = async () => {
    if (!activityUser || activityClearing) return;
    const confirmed = await confirmDialog({
      title: "Clear activity history?",
      message: `Clear all activity history for ${activityUser.name}?`,
      tone: "warning",
      confirmText: "Clear history",
    });
    if (!confirmed) {
      return;
    }

    setActivityClearing(true);
    setActivityError("");
    try {
      await api.delete(`/users/${activityUser.id}/activity-logs`);
      setActivityLogs([]);
      setActivityFilter("all");
    } catch (clearError) {
      console.error("Activity clear error:", clearError);
      setActivityError(
        clearError.response?.data?.detail || "Unable to clear activity history."
      );
    } finally {
      setActivityClearing(false);
    }
  };

  const closeActivity = () => {
    setActivityUser(null);
    setActivityLogs([]);
    setActivityClearing(false);
    setActivityError("");
  };

  const updateRoleRequestStatus = async (requestId, status) => {
    setRoleRequestUpdatingId(requestId);
    setError("");
    try {
      await api.patch(`/role-requests/${requestId}`, { status });
      await loadRoleRequests();
    } catch (requestError) {
      console.error("Role request update error:", requestError);
      setError(
        requestError.response?.data?.detail || "Unable to update role request."
      );
    } finally {
      setRoleRequestUpdatingId(null);
    }
  };

  const deleteRoleRequest = async (requestItem) => {
    const confirmed = await confirmDialog({
      title: "Remove access request?",
      message: `Remove the request from ${requestItem.user_name}? This only clears the admin message, not the user account.`,
      tone: "danger",
      confirmText: "Remove request",
    });
    if (!confirmed) return;

    setRoleRequestUpdatingId(requestItem.id);
    setError("");
    try {
      await api.delete(`/role-requests/${requestItem.id}`);
      await loadRoleRequests();
    } catch (requestError) {
      console.error("Role request delete error:", requestError);
      setError(
        requestError.response?.data?.detail || "Unable to remove role request."
      );
    } finally {
      setRoleRequestUpdatingId(null);
    }
  };

  const updateAccessRequestStatus = async (requestItem, status) => {
    setAccessRequestUpdatingId(requestItem.id);
    setError("");
    try {
      await api.patch(`/access-requests/${requestItem.id}`, { status });
      await loadAccessRequests();
    } catch (requestError) {
      console.error("Signup access request update error:", requestError);
      setError(
        requestError.response?.data?.detail || "Unable to update signup request."
      );
    } finally {
      setAccessRequestUpdatingId(null);
    }
  };

  const deleteAccessRequest = async (requestItem) => {
    const confirmed = await confirmDialog({
      title: "Remove signup request?",
      message: `Remove the signup request from ${requestItem.full_name}? This only clears the request, not any user account already created.`,
      tone: "danger",
      confirmText: "Remove request",
    });
    if (!confirmed) return;

    setAccessRequestUpdatingId(requestItem.id);
    setError("");
    try {
      await api.delete(`/access-requests/${requestItem.id}`);
      await loadAccessRequests();
    } catch (requestError) {
      console.error("Signup access request delete error:", requestError);
      setError(
        requestError.response?.data?.detail || "Unable to remove signup request."
      );
    } finally {
      setAccessRequestUpdatingId(null);
    }
  };

  return (
    <div className="users-page">
      <header className="users-command-header">
        <div>
          <h1>Users & Access Control</h1>
        </div>
        <button className="users-add-button" onClick={openForm} type="button">
          + Add user
        </button>
      </header>

      <main className="users-directory">
        <div className="users-directory-header">
          <div>
            <h2>User directory</h2>
            <p>
              {filteredUsers.length} of {users.length} accounts shown
            </p>
          </div>
          <div className={`users-filters ${isSuperAdmin ? "has-company-filter" : ""}`.trim()}>
            <input
              aria-label="Search users"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, username, phone, email..."
              value={search}
            />
            {isSuperAdmin && (
              <select
                aria-label="Filter users by company"
                onChange={(event) => setTenantFilter(event.target.value)}
                value={tenantFilter}
              >
                <option value="all">All companies</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.company_name}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Filter users by role"
              onChange={(event) => setRoleFilter(event.target.value)}
              value={roleFilter}
            >
              <option value="all">All roles</option>
              <option value="super_admin">Super admin</option>
              <option value="admin">Administrator</option>
              <option value="manager">Manager</option>
              <option value="warehouse">Warehouse</option>
              <option value="worker">Worker</option>
              <option value="service_taker">Service taker</option>
              <option value="unassigned">Assign role later</option>
            </select>
            <select
              aria-label="Filter users by status"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {error && !showForm && <div className="users-error-banner">{error}</div>}

        {loading ? (
          <div className="users-empty-state">Loading user accounts...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="users-empty-state">
            <strong>No matching users</strong>
            <span>Change the filters or create a new user account.</span>
          </div>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  {isSuperAdmin && <th>Company</th>}
                  <th>Page access</th>
                  <th>Session</th>
                  <th>Status</th>
                  <th>Last sign in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const isCustom = !arraysMatch(
                    user.allowed_pages,
                    getRoleDefaults(user.role)
                  );
                  return (
                    <tr key={user.id}>
                      <td data-label="User">
                        <div className="users-identity">
                          <span className="users-avatar">
                            {getInitials(user.name)}
                          </span>
                          <span>
                            <strong>{user.name}</strong>
                            <small>@{user.username || user.name}</small>
                            {user.phone && <small>{user.phone}</small>}
                            {user.email && <small>{user.email}</small>}
                          </span>
                        </div>
                      </td>
                      <td data-label="Role">
                        <span className={`users-role-chip is-${user.role}`}>
                          {roleLabel(user.role)}
                        </span>
                      </td>
                      {isSuperAdmin && (
                        <td data-label="Company">
                          <div className="users-access-summary">
                            <strong>{user.tenant_name || "No company"}</strong>
                            <span>{user.tenant_slug || "default"}</span>
                          </div>
                        </td>
                      )}
                      <td data-label="Page access">
                        <div className="users-access-summary">
                          <strong>{user.allowed_pages?.length || 0} pages</strong>
                          <span>{isCustom ? "Custom access" : "Role default"}</span>
                        </div>
                      </td>
                      <td data-label="Session">
                        <span className="users-date">
                          {formatSessionExpiry(user.session_expiry_minutes)}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span
                          className={`users-status ${
                            user.is_active ? "is-active" : "is-inactive"
                          }`}
                        >
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td data-label="Last sign in">
                        <span className="users-date">
                          {user.last_login
                            ? formatUtcLocal(user.last_login)
                            : "Never"}
                        </span>
                      </td>
                      <td className="users-actions-cell">
                        <div className="users-action-group">
                          <button
                            className="users-action"
                            onClick={() => openActivity(user)}
                            type="button"
                          >
                            Activity
                          </button>
                          <button
                            className="users-action"
                            onClick={() => startEdit(user)}
                            type="button"
                          >
                            Manage
                          </button>
                          <button
                            className="users-action delete"
                            onClick={() => setDeleteCandidate(user)}
                            type="button"
                          >
                            Delete
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
      </main>

      {showForm && (
        <div className="users-modal-overlay" onClick={closeForm}>
          <div
            aria-labelledby="user-form-title"
            aria-modal="true"
            className="users-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="users-modal-header">
              <div>
                <span className="users-eyebrow">
                  {approvingAccessRequest ? "Signup approval" : editingUserId ? "Account settings" : "New ERP account"}
                </span>
                <h3 id="user-form-title">
                  {approvingAccessRequest ? "Approve access request" : editingUserId ? "Manage user" : "Add user"}
                </h3>
                <p>{approvingAccessRequest ? "Create the account after choosing role, PIN, privacy, and page access." : "Identity, account status, and page access in one place."}</p>
              </div>
              <button
                aria-label="Close user form"
                className="users-modal-close"
                onClick={closeForm}
                type="button"
              >
                x
              </button>
            </div>

            <form className="users-form" onSubmit={handleSave}>
              <section className="users-form-section">
                <div className="users-section-heading">
                  <div>
                    <span>1</span>
                    <div>
                      <h4>Identity and login</h4>
                      <p>How this person appears and signs in.</p>
                    </div>
                  </div>
                </div>
                <div className="users-form-grid">
                  <label>
                    Full name
                    <input
                      autoFocus
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Sara Ahmed"
                      required
                      value={name}
                    />
                  </label>
                  <label>
                    Username
                    <input
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder={name.trim() || "Uses full name if blank"}
                      value={username}
                    />
                    <small>
                      Optional. If blank, the full name becomes the username.
                    </small>
                  </label>
                  <label>
                    4-digit PIN
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      onChange={(event) =>
                        setPin(event.target.value.replace(/\D/g, ""))
                      }
                      placeholder={
                        editingUserId ? "Leave blank to keep current PIN" : "0000"
                      }
                      type="password"
                      value={pin}
                    />
                    <small>
                      {editingUserId
                        ? "Current PIN is protected. Enter a new 4-digit PIN to change it."
                        : "Set a 4-digit login PIN for this user."}
                    </small>
                  </label>
                  <label>
                    Phone
                    <input
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="Optional phone number"
                      value={phone}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="Optional email address"
                      type="email"
                      value={email}
                    />
                  </label>
                </div>
                {approvingAccessRequest && (
                  <label className="users-full-field users-approval-note">
                    Admin approval note
                    <textarea
                      onChange={(event) => setApprovalNote(event.target.value)}
                      placeholder="Optional note for this signup approval"
                      rows="3"
                      value={approvalNote}
                    />
                    <small>
                      Submitted {formatUtcLocal(approvingAccessRequest.created_at)} from {approvingAccessRequest.requested_workspace || "website signup"}.
                    </small>
                  </label>
                )}
              </section>

              <section className="users-form-section">
                <div className="users-section-heading">
                  <div>
                    <span>2</span>
                    <div>
                      <h4>Account type</h4>
                      <p>Choose a role template and account status.</p>
                    </div>
                  </div>
                </div>
                <div className="users-form-grid">
                  <label>
                    Role
                    <select
                      onChange={(event) => changeRole(event.target.value)}
                      value={role}
                    >
                      <option value="unassigned">Assign role later</option>
                      <option value="super_admin">Super admin</option>
                      <option value="admin">Administrator</option>
                      <option value="manager">Manager</option>
                      <option value="warehouse">Warehouse / Fulfillment</option>
                      <option value="worker">Worker</option>
                      <option disabled value="service_taker">Service taker (manage in Service Takers)</option>
                    </select>
                  </label>
                  {isSuperAdmin && (
                    <label>
                      Company
                      <select
                        onChange={(event) => setTenantId(event.target.value)}
                        required
                        value={tenantId}
                      >
                        <option value="">Choose company</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.company_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Account status
                    <select
                      onChange={(event) =>
                        setIsActive(event.target.value === "active")
                      }
                      value={isActive ? "active" : "inactive"}
                    >
                      <option value="active">Active - can sign in</option>
                      <option value="inactive">Inactive - access suspended</option>
                    </select>
                  </label>
                  <label>
                    Session expire time
                    <select
                      onChange={(event) =>
                        setSessionExpiryMinutes(
                          normalizeSessionExpiryMinutes(event.target.value)
                        )
                      }
                      value={sessionExpiryMinutes}
                    >
                      {SESSION_EXPIRY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <small>Choose Never to keep this user signed in.</small>
                  </label>
                  {role === "worker" && (
                    <label className="users-full-field">
                      Worker record
                      <select
                        onChange={(event) =>
                          setWorkerId(
                            event.target.value
                              ? Number(event.target.value)
                              : null
                          )
                        }
                        value={workerId ?? ""}
                      >
                        <option value="">Create worker record automatically</option>
                        {workers
                          .filter(
                            (worker) =>
                              !users.some(
                                (user) =>
                                  user.worker_id === worker.id &&
                                  user.id !== editingUserId
                              ) || worker.id === workerId
                          )
                          .map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.name} ({worker.role})
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
              </section>

              <section className="users-form-section users-form-privacy-section">
                <div className="users-section-heading">
                  <div>
                    <span>3</span>
                    <div>
                      <h4>Customer privacy</h4>
                      <p>Choose what this user can see in orders and tasks.</p>
                    </div>
                  </div>
                </div>

                <div className="users-privacy-options users-privacy-options-form">
                  {PRIVACY_CONTROLS.map((control) => {
                    const checked = Boolean(customerPrivacySettings[control.key]);
                    const isSaving = customerPrivacySavingKey === control.key;
                    return (
                      <label
                        className={checked ? "is-selected" : ""}
                        key={control.key}
                      >
                        <input
                          checked={checked}
                          disabled={Boolean(customerPrivacySavingKey)}
                          onChange={() => toggleCustomerPrivacySetting(control.key)}
                          type="checkbox"
                        />
                        <span aria-hidden="true" />
                        <div>
                          <strong>{control.label}</strong>
                          <small>
                            {isSaving ? "Saving..." : control.description}
                          </small>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {customerPrivacyError && (
                  <div className="users-privacy-error">{customerPrivacyError}</div>
                )}
              </section>

              <section className="users-form-section access-section">
                <div className="users-section-heading users-access-heading">
                  <div>
                    <span>4</span>
                    <div>
                      <h4>Page access</h4>
                      <p>Select exactly which ERP areas this user can open.</p>
                    </div>
                  </div>
                  <div className="users-access-tools">
                    <button
                      onClick={() => applyRoleDefaults()}
                      type="button"
                    >
                      Use {roleLabel(role)} default
                    </button>
                    <button
                      onClick={() => setAllowedPages(normalizePageList(pageChoicesForRole))}
                      type="button"
                    >
                      Select all
                    </button>
                  </div>
                </div>

                <div className="users-access-count">
                  <strong>{allowedPages.length}</strong>
                  <span>pages selected</span>
                </div>

                <div className="users-permission-groups">
                  {permissionGroups.map((group) => {
                    const visiblePages = group.pages.filter((page) =>
                      pageChoicesForRole.includes(page)
                    );
                    if (visiblePages.length === 0) return null;

                    return (
                      <fieldset key={group.name}>
                        <legend>{group.name}</legend>
                        <p>{group.description}</p>
                        <div className="users-page-options">
                          {visiblePages.map((page) => (
                              <label
                                className={
                                  allowedPages.includes(page) ? "is-selected" : ""
                                }
                                key={page}
                              >
                                <input
                                  checked={allowedPages.includes(page)}
                                  disabled={page === "Dashboard"}
                                  onChange={() => togglePage(page)}
                                  type="checkbox"
                                />
                                <span>
                                  <strong>{pageLabel(page)}</strong>
                                  {accessOptions.parent_map?.[page] && (
                                    <small>
                                      Related to {pageLabel(accessOptions.parent_map[page])}
                                    </small>
                                  )}
                                </span>
                              </label>
                            ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              </section>

              {error && <div className="users-error-banner">{error}</div>}

              <div className="users-form-actions">
                <button
                  className="users-submit-button"
                  disabled={saving}
                  type="submit"
                >
                  {saving
                    ? "Saving..."
                    : approvingAccessRequest
                      ? "Approve and create user"
                      : editingUserId
                        ? "Save user changes"
                        : "Create user"}
                </button>
                <button
                  className="users-cancel"
                  onClick={closeForm}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activityUser && (
        <div className="users-modal-overlay" onClick={closeActivity}>
          <div
            aria-labelledby="user-activity-title"
            aria-modal="true"
            className="users-modal users-activity-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="users-modal-header">
              <div>
                <span className="users-eyebrow">Activity history</span>
                <h3 id="user-activity-title">{activityUser.name}</h3>
                <p>Page opens, new records, updates, and removals by this user.</p>
              </div>
              <button
                aria-label="Close activity history"
                className="users-modal-close"
                onClick={closeActivity}
                type="button"
              >
                x
              </button>
            </div>

            <div className="users-activity-body">
              <div className="users-activity-toolbar">
                <div>
                  <strong>{activityLogs.length}</strong>
                  <span>recent actions</span>
                </div>
                <div className="users-activity-tools">
                  <select
                    aria-label="Filter activity history"
                    onChange={(event) => changeActivityFilter(event.target.value)}
                    value={activityFilter}
                  >
                    <option value="all">All activity</option>
                    <option value="opened page">Opened pages</option>
                    <option value="added">Added things</option>
                    <option value="updated">Updated things</option>
                    <option value="removed">Removed things</option>
                    <option value="signed in">Sign-ins</option>
                  </select>
                  <button
                    className="users-activity-clear"
                    disabled={activityClearing}
                    onClick={clearActivityHistory}
                    type="button"
                  >
                    {activityClearing ? "Clearing..." : "Clear history"}
                  </button>
                </div>
              </div>

              {activityError && (
                <div className="users-error-banner">{activityError}</div>
              )}

              {activityLoading ? (
                <div className="users-empty-state">Loading activity...</div>
              ) : activityLogs.length === 0 ? (
                <div className="users-empty-state">
                  <strong>No activity found</strong>
                  <span>This user has no records for the selected filter.</span>
                </div>
              ) : (
                <div className="users-activity-list">
                  {activityLogs.map((activity) => {
                    const context = activityContextText(activity);
                    return (
                      <article className="users-activity-item" key={activity.id}>
                        <span className={`users-activity-icon is-${activity.action.replace(/\s+/g, "-")}`}>
                          {activity.action === "opened page"
                            ? "OP"
                            : activity.action === "signed in"
                              ? "IN"
                              : activity.action.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="users-activity-line">
                          <strong>{activity.summary}</strong>
                          <span className="users-activity-action">{activity.action}</span>
                          {context && (
                            <span className="users-activity-context">{context}</span>
                          )}
                          <time>{formatUtcLocal(activity.created_at)}</time>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div
          className="users-modal-overlay"
          onClick={() => setDeleteCandidate(null)}
        >
          <div
            className="users-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="users-eyebrow">Permanent action</span>
            <h3>Delete user?</h3>
            <p>
              <strong>{deleteCandidate.name}</strong> will no longer be able to
              access the ERP.
              {deleteCandidate.worker_id
                ? " The linked worker record will also be removed from Workers."
                : ""}{" "}
              This cannot be undone.
            </p>
            <div className="users-form-actions">
              <button
                className="users-delete-confirm"
                onClick={confirmDelete}
                type="button"
              >
                Delete user
              </button>
              <button
                className="users-cancel"
                onClick={() => setDeleteCandidate(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
