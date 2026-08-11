import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/api";
import "./Companies.css";

const ROLE_LABELS = {
  admin: "Company admin",
  manager: "Manager",
  warehouse: "Warehouse / Fulfillment",
  worker: "Worker",
  unassigned: "Assign later",
};

const ROLE_OPTIONS = ["admin", "manager", "warehouse", "worker", "unassigned"];
const ALWAYS_ALLOWED_PAGES = ["Dashboard", "Settings", "Users"];
const EXCLUDED_COMPANY_USER_PAGES = new Set([
  "Companies",
  "Add Company",
  "Service Dashboard",
  "Service Products",
  "Service Inbound",
  "Service Shipments",
  "Service Charges",
  "My Tasks",
]);

const emptyCompanyForm = {
  company_name: "",
  slug: "",
  email: "",
  phone: "",
  status: "active",
  admin_name: "",
  admin_username: "",
  admin_pin: "0000",
  admin_email: "",
  admin_phone: "",
  module_slugs: [],
};

const emptyUserForm = {
  name: "",
  username: "",
  pin: "0000",
  role: "manager",
  allowed_pages: [],
  is_active: true,
};

const toSlug = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const usernameFromName = (value) => toSlug(value).replace(/-/g, ".");
const moduleLabel = (module) => module?.page_name || module?.name || module?.slug || "Module";
const roleLabel = (role) => ROLE_LABELS[role] || role || "User";
const formatActivityTime = (value) => {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getInitials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CO";

const getModuleIconSvg = (name = "") => {
  const lower = name.toLowerCase();
  if (lower.includes("label")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>
    );
  }
  if (lower.includes("amazon")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 17c3.5 2.3 8.2 2.5 12 .2"/><path d="M16.5 19.5 19 17l-3-.5"/><path d="M8 8.5c.5-2.2 2-3.5 4.4-3.5 2.7 0 4.1 1.3 4.1 3.7V15"/></svg>
    );
  }
  if (lower.includes("school")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 6 2 6 2s6 0 6-2v-5"/></svg>
    );
  }
  if (lower.includes("account") || lower.includes("pay") || lower.includes("bill") || lower.includes("finance")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
    );
  }
  if (lower.includes("ship") || lower.includes("fulfill") || lower.includes("deliver")) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
  );
};

const normalizePageList = (pages = []) => {
  const next = [];
  pages.forEach((page) => {
    if (!page || next.includes(page)) return;
    next.push(page);
  });
  return next;
};

export default function Companies({ authenticatedUser, focusCreate = false, onSwitchToCompanyPortal }) {
  const isSuperAdmin = authenticatedUser?.role === "super_admin";
  const [tenants, setTenants] = useState([]);
  const [modules, setModules] = useState([]);
  const [users, setUsers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [accessOptions, setAccessOptions] = useState({ pages: [], role_defaults: {} });
  const [modulesByTenant, setModulesByTenant] = useState({});
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  
  // UI Controls
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "table"
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive"
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailTab, setDetailTab] = useState("details"); // "details" | "modules" | "users" | "activity"

  // Modules Tab Filtering & Search
  const [moduleSearch, setModuleSearch] = useState("");
  const [moduleCategoryFilter, setModuleCategoryFilter] = useState("all");

  // User PIN View & Update State
  const [revealedPins, setRevealedPins] = useState({}); // { [userId]: boolean }
  const [pinModalUser, setPinModalUser] = useState(null);
  const [newPinValue, setNewPinValue] = useState("");
  const [updatingPin, setUpdatingPin] = useState(false);

  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [editForm, setEditForm] = useState({ company_name: "", slug: "", email: "", phone: "", status: "active" });
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [moduleSavingSlug, setModuleSavingSlug] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const createPanelRef = useRef(null);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => Number(tenant.id) === Number(selectedTenantId)) || null,
    [selectedTenantId, tenants]
  );

  const selectedModules = selectedTenantId ? modulesByTenant[selectedTenantId] || [] : [];

  const filteredModules = useMemo(() => {
    let result = selectedModules;
    if (moduleCategoryFilter === "core") {
      result = result.filter((m) => {
        const name = (m.page_name || m.name || m.slug || "").toLowerCase();
        return !name.includes("school") && !name.includes("amazon") && !name.includes("website") && !name.includes("service");
      });
    } else if (moduleCategoryFilter === "integrations") {
      result = result.filter((m) => {
        const name = (m.page_name || m.name || m.slug || "").toLowerCase();
        return name.includes("amazon") || name.includes("website") || name.includes("service");
      });
    } else if (moduleCategoryFilter === "school") {
      result = result.filter((m) => {
        const name = (m.page_name || m.name || m.slug || "").toLowerCase();
        return name.includes("school");
      });
    }
    if (moduleSearch.trim()) {
      const q = moduleSearch.trim().toLowerCase();
      result = result.filter(
        (m) =>
          (m.page_name || "").toLowerCase().includes(q) ||
          (m.name || "").toLowerCase().includes(q) ||
          (m.slug || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [moduleCategoryFilter, moduleSearch, selectedModules]);
  const selectedCompanyUsers = useMemo(
    () => users.filter((user) => Number(user.tenant_id) === Number(selectedTenantId)),
    [selectedTenantId, users]
  );
  const selectedCompanyActivity = useMemo(
    () =>
      activityLogs
        .filter((activity) => Number(activity.tenant_id) === Number(selectedTenantId))
        .slice(0, 12),
    [activityLogs, selectedTenantId]
  );
  const activeTenants = tenants.filter((tenant) => tenant.status === "active").length;
  const enabledModules = selectedModules.filter((module) => module.enabled).length;

  const enabledCompanyPages = useMemo(() => {
    const enabled = new Set(ALWAYS_ALLOWED_PAGES);
    selectedModules.forEach((module) => {
      if (module.enabled && module.page_name && !EXCLUDED_COMPANY_USER_PAGES.has(module.page_name)) {
        enabled.add(module.page_name);
      }
    });
    return enabled;
  }, [selectedModules]);

  const pageChoices = useMemo(() => {
    const sourcePages = accessOptions.pages?.length
      ? accessOptions.pages
      : [...enabledCompanyPages];
    return normalizePageList(sourcePages).filter(
      (page) => enabledCompanyPages.has(page) && !EXCLUDED_COMPANY_USER_PAGES.has(page)
    );
  }, [accessOptions.pages, enabledCompanyPages]);

  const pagesForRole = useCallback(
    (role = userForm.role) => {
      const defaults = accessOptions.role_defaults?.[role] || [];
      const basePages = defaults.length ? defaults : ALWAYS_ALLOWED_PAGES;
      const selected = normalizePageList(["Dashboard", ...basePages]).filter((page) => pageChoices.includes(page));
      return selected.length ? selected : pageChoices.filter((page) => ALWAYS_ALLOWED_PAGES.includes(page));
    },
    [accessOptions.role_defaults, pageChoices, userForm.role]
  );

  const loadTenantModules = useCallback(async (tenantId) => {
    if (!tenantId) return [];
    const response = await api.get(`/tenants/${tenantId}/modules`);
    const nextModules = Array.isArray(response.data) ? response.data : [];
    setModulesByTenant((current) => ({ ...current, [tenantId]: nextModules }));
    return nextModules;
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isSuperAdmin) return [];
    const response = await api.get("/users");
    const nextUsers = Array.isArray(response.data) ? response.data : [];
    setUsers(nextUsers);
    return nextUsers;
  }, [isSuperAdmin]);

  const loadCompanies = useCallback(async () => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [tenantsResponse, modulesResponse, usersResponse, accessResponse, activityResponse] = await Promise.all([
        api.get("/tenants"),
        api.get("/modules"),
        api.get("/users"),
        api.get("/user-access-options"),
        api.get("/activity-logs?limit=200"),
      ]);
      const nextTenants = Array.isArray(tenantsResponse.data) ? tenantsResponse.data : [];
      const nextModules = Array.isArray(modulesResponse.data) ? modulesResponse.data : [];
      setTenants(nextTenants);
      setModules(nextModules);
      setUsers(Array.isArray(usersResponse.data) ? usersResponse.data : []);
      setActivityLogs(Array.isArray(activityResponse.data) ? activityResponse.data : []);
      setAccessOptions(accessResponse.data || { pages: [], role_defaults: {} });
      setCompanyForm((current) => ({
        ...current,
        module_slugs: current.module_slugs.length
          ? current.module_slugs
          : nextModules.filter((module) => module.enabled !== false).map((module) => module.slug),
      }));
      const nextSelectedId = selectedTenantId || nextTenants[0]?.id || null;
      setSelectedTenantId(nextSelectedId);
      if (nextSelectedId) await loadTenantModules(nextSelectedId);
    } catch (loadError) {
      console.error("Company tenant load error:", loadError);
      setError(loadError.response?.data?.detail || "Unable to load companies.");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, loadTenantModules, selectedTenantId]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    if (focusCreate && isSuperAdmin) {
      setShowCreateModal(true);
    }
  }, [focusCreate, isSuperAdmin]);

  useEffect(() => {
    if (!selectedTenant) return;
    setEditForm({
      company_name: selectedTenant.company_name || "",
      slug: selectedTenant.slug || "",
      email: selectedTenant.email || "",
      phone: selectedTenant.phone || "",
      status: selectedTenant.status || "active",
    });
  }, [selectedTenant]);

  useEffect(() => {
    setUserForm((current) => {
      const selected = current.allowed_pages.filter((page) => pageChoices.includes(page));
      return {
        ...current,
        allowed_pages: selected.length ? selected : pagesForRole(current.role),
      };
    });
  }, [pageChoices, pagesForRole, selectedTenantId]);

  const selectTenant = async (tenantId) => {
    setSelectedTenantId(tenantId);
    setError("");
    setSuccess("");
    setUserForm(emptyUserForm);
    if (!modulesByTenant[tenantId]) {
      try {
        await loadTenantModules(tenantId);
      } catch (loadError) {
        console.error("Company module load error:", loadError);
        setError(loadError.response?.data?.detail || "Unable to load company modules.");
      }
    }
  };

  const updateCompanyForm = (field, value) => {
    setCompanyForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "company_name" && !current.slug.trim()) {
        next.slug = toSlug(value);
      }
      if (field === "admin_name" && !current.admin_username.trim()) {
        next.admin_username = usernameFromName(value);
      }
      return next;
    });
  };

  const updateUserForm = (field, value) => {
    setUserForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "name" && !current.username.trim()) {
        next.username = usernameFromName(value);
      }
      if (field === "role") {
        next.allowed_pages = pagesForRole(value);
      }
      return next;
    });
  };

  const toggleCreateModule = (slug) => {
    setCompanyForm((current) => {
      const selected = new Set(current.module_slugs);
      if (selected.has(slug)) selected.delete(slug);
      else selected.add(slug);
      return { ...current, module_slugs: Array.from(selected) };
    });
  };

  const toggleUserPage = (page) => {
    if (page === "Dashboard") return;
    setUserForm((current) => {
      const selected = new Set(current.allowed_pages);
      if (selected.has(page)) selected.delete(page);
      else selected.add(page);
      selected.add("Dashboard");
      return { ...current, allowed_pages: pageChoices.filter((choice) => selected.has(choice)) };
    });
  };

  // PIN Viewing & Editing Functions
  const toggleRevealPin = (userId) => {
    setRevealedPins((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  const handleOpenResetPinModal = (user) => {
    setPinModalUser(user);
    setNewPinValue(user.pin || "0000");
    setError("");
    setSuccess("");
  };

  const handleSaveUserPin = async (e) => {
    e.preventDefault();
    if (!pinModalUser) return;
    if (!/^\d{4}$/.test(newPinValue)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    setUpdatingPin(true);
    setError("");
    setSuccess("");
    try {
      await api.patch(`/users/${pinModalUser.id}/pin`, { pin: newPinValue });
      setUsers((current) =>
        current.map((u) => (u.id === pinModalUser.id ? { ...u, pin: newPinValue } : u))
      );
      setSuccess(`PIN updated successfully for ${pinModalUser.name}.`);
      setPinModalUser(null);
    } catch (err) {
      console.error("PIN update error:", err);
      setError(err.response?.data?.detail || "Failed to update user PIN.");
    } finally {
      setUpdatingPin(false);
    }
  };

  const createCompany = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!companyForm.company_name.trim()) {
      setError("Enter a company name.");
      return;
    }
    if (companyForm.admin_name.trim() && !/^\d{4}$/.test(companyForm.admin_pin)) {
      setError("Company admin PIN must be exactly 4 digits.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        company_name: companyForm.company_name.trim(),
        slug: companyForm.slug.trim() || null,
        email: companyForm.email.trim() || null,
        phone: companyForm.phone.trim() || null,
        status: companyForm.status,
        module_slugs: companyForm.module_slugs,
      };
      if (companyForm.admin_name.trim()) {
        payload.admin_name = companyForm.admin_name.trim();
        payload.admin_username = companyForm.admin_username.trim() || null;
        payload.admin_pin = companyForm.admin_pin;
        payload.admin_email = companyForm.admin_email.trim() || null;
        payload.admin_phone = companyForm.admin_phone.trim() || null;
      }
      const response = await api.post("/tenants", payload);
      const created = response.data;
      setCompanyForm({
        ...emptyCompanyForm,
        module_slugs: modules.filter((module) => module.enabled !== false).map((module) => module.slug),
      });
      await loadCompanies();
      if (created?.id) {
        setSelectedTenantId(created.id);
        await loadTenantModules(created.id);
      }
      setSuccess("Company created successfully.");
      setShowCreateModal(false);
    } catch (saveError) {
      console.error("Company create error:", saveError);
      setError(saveError.response?.data?.detail || "Unable to create company.");
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedCompany = async (event) => {
    event.preventDefault();
    if (!selectedTenant) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(`/tenants/${selectedTenant.id}`, {
        company_name: editForm.company_name.trim(),
        slug: editForm.slug.trim() || null,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        status: editForm.status,
      });
      setTenants((current) =>
        current.map((tenant) => (tenant.id === selectedTenant.id ? response.data : tenant))
      );
      setSuccess("Company details updated.");
    } catch (saveError) {
      console.error("Company update error:", saveError);
      setError(saveError.response?.data?.detail || "Unable to update company.");
    } finally {
      setSaving(false);
    }
  };

  const createCompanyUser = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!selectedTenant) {
      setError("Choose a company first.");
      return;
    }
    if (!userForm.name.trim()) {
      setError("Enter the user's name.");
      return;
    }
    if (!/^\d{4}$/.test(userForm.pin)) {
      setError("User PIN must be exactly 4 digits.");
      return;
    }

    const selectedPages = normalizePageList(["Dashboard", ...userForm.allowed_pages]).filter((page) =>
      pageChoices.includes(page)
    );
    setUserSaving(true);
    try {
      await api.post("/users", {
        tenant_id: selectedTenant.id,
        name: userForm.name.trim(),
        username: userForm.username.trim() || null,
        pin: userForm.pin,
        role: userForm.role,
        allowed_pages: selectedPages,
        is_active: userForm.is_active,
        worker_id: null,
      });
      setUserForm({ ...emptyUserForm, allowed_pages: pagesForRole(emptyUserForm.role) });
      await Promise.all([loadUsers(), loadCompanies()]);
      setSuccess("Company user created.");
    } catch (saveError) {
      console.error("Company user create error:", saveError);
      setError(saveError.response?.data?.detail || "Unable to create company user.");
    } finally {
      setUserSaving(false);
    }
  };

  const toggleTenantModule = async (module) => {
    if (!selectedTenant) return;
    setModuleSavingSlug(module.slug);
    setError("");
    setSuccess("");
    try {
      const response = await api.patch(`/tenants/${selectedTenant.id}/modules/${module.slug}`, {
        enabled: !module.enabled,
      });
      setModulesByTenant((current) => ({ ...current, [selectedTenant.id]: response.data || [] }));
    } catch (saveError) {
      console.error("Company module update error:", saveError);
      setError(saveError.response?.data?.detail || "Unable to update module access.");
    } finally {
      setModuleSavingSlug("");
    }
  };

  // Filtered companies list
  const filteredTenants = useMemo(() => {
    let result = tenants;
    if (statusFilter !== "all") {
      result = result.filter((t) => t.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (t) =>
          t.company_name?.toLowerCase().includes(q) ||
          t.slug?.toLowerCase().includes(q) ||
          t.email?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [searchQuery, statusFilter, tenants]);

  if (!isSuperAdmin) {
    return (
      <div className="cmp-wrapper">
        <section className="cmp-unauthorized-card">
          <div className="cmp-unauthorized-icon">🔒</div>
          <h1>Super Admin Authorization Required</h1>
          <p>Multi-tenant company administration, module access control, and cross-tenant user management are restricted to Super Admin role.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="cmp-wrapper">
      {/* Top Header & Metric Bar */}
      <header className="cmp-header">
        <div className="cmp-header-left">
          <div className="cmp-badge-pill">Platform Tenant Engine</div>
          <h1 className="cmp-title">Companies Management</h1>
          <p className="cmp-subtitle">Manage enterprise tenant entities, configure ERP module access, manage PINs/passwords, and switch into tenant company portals.</p>
        </div>

        <div className="cmp-metrics-strip">
          <div className="cmp-metric-pill">
            <span className="cmp-metric-num">{tenants.length}</span>
            <span className="cmp-metric-label">Total Companies</span>
          </div>
          <div className="cmp-metric-pill cmp-metric-active">
            <span className="cmp-metric-num">{activeTenants}</span>
            <span className="cmp-metric-label">Active Tenants</span>
          </div>
          <div className="cmp-metric-pill">
            <span className="cmp-metric-num">{users.length}</span>
            <span className="cmp-metric-label">System Users</span>
          </div>
        </div>
      </header>

      {/* Control Toolbar */}
      <div className="cmp-toolbar">
        <div className="cmp-search-field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            placeholder="Search companies by name, slug, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="cmp-clear-btn" onClick={() => setSearchQuery("")}>×</button>
          )}
        </div>

        <div className="cmp-filter-group">
          <select
            className="cmp-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive / Suspended</option>
          </select>

          <div className="cmp-view-toggle">
            <button
              className={`cmp-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid View"
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            </button>
            <button
              className={`cmp-toggle-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table View"
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>

          <button
            className="cmp-btn-primary"
            onClick={() => setShowCreateModal(true)}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Company
          </button>
        </div>
      </div>

      {error && <div className="cmp-toast cmp-toast-error">{error}</div>}
      {success && <div className="cmp-toast cmp-toast-success">{success}</div>}

      {/* Main Split Interface */}
      <div className="cmp-main-layout">
        {/* Left Side Directory (Grid or Table) */}
        <div className="cmp-directory-section">
          {loading ? (
            <div className="cmp-loading-card">Loading tenant directory...</div>
          ) : filteredTenants.length === 0 ? (
            <div className="cmp-empty-card">
              <div className="cmp-empty-icon">🏢</div>
              <h3>No Companies Found</h3>
              <p>No tenant records match your current filter settings.</p>
              <button className="cmp-btn-secondary" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>Reset Filters</button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="cmp-cards-grid">
              {filteredTenants.map((tenant) => {
                const isSelected = Number(selectedTenantId) === Number(tenant.id);
                return (
                  <article
                    className={`cmp-tenant-card ${isSelected ? "is-selected" : ""}`}
                    key={tenant.id}
                    onClick={() => selectTenant(tenant.id)}
                  >
                    <div className="cmp-card-top">
                      <div className="cmp-avatar">{getInitials(tenant.company_name)}</div>
                      <div className="cmp-card-head">
                        <h3>{tenant.company_name}</h3>
                        <code>{tenant.slug}</code>
                      </div>
                      <span className={`cmp-status-tag is-${tenant.status}`}>
                        <span className="cmp-dot" /> {tenant.status}
                      </span>
                    </div>

                    <div className="cmp-card-details">
                      {tenant.email && (
                        <div className="cmp-detail-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                          <span>{tenant.email}</span>
                        </div>
                      )}
                      {tenant.phone && (
                        <div className="cmp-detail-row">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                          <span>{tenant.phone}</span>
                        </div>
                      )}
                    </div>

                    <div className="cmp-card-footer">
                      <button
                        className="cmp-btn-enter-portal"
                        onClick={(e) => { e.stopPropagation(); onSwitchToCompanyPortal?.(tenant); }}
                        title={`Enter ${tenant.company_name} Portal`}
                        type="button"
                      >
                        Enter Portal ↗
                      </button>
                      <button className="cmp-btn-manage" onClick={(e) => { e.stopPropagation(); selectTenant(tenant.id); }}>
                        {isSelected ? "Managing" : "Select"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="cmp-table-card">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th>Company Name</th>
                    <th>Slug</th>
                    <th>Status</th>
                    <th>Contact Info</th>
                    <th>Users</th>
                    <th>Portal Access</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((tenant) => {
                    const isSelected = Number(selectedTenantId) === Number(tenant.id);
                    return (
                      <tr
                        className={isSelected ? "is-selected" : ""}
                        key={tenant.id}
                        onClick={() => selectTenant(tenant.id)}
                      >
                        <td className="cmp-td-company">
                          <div className="cmp-mini-avatar">{getInitials(tenant.company_name)}</div>
                          <strong>{tenant.company_name}</strong>
                        </td>
                        <td><code>{tenant.slug}</code></td>
                        <td>
                          <span className={`cmp-status-tag is-${tenant.status}`}>
                            <span className="cmp-dot" /> {tenant.status}
                          </span>
                        </td>
                        <td className="cmp-td-contact">
                          <div>{tenant.email || "No email"}</div>
                          <small>{tenant.phone || ""}</small>
                        </td>
                        <td>{tenant.user_count || 0} users</td>
                        <td>
                          <div className="cmp-table-action-group">
                            <button
                              className="cmp-btn-enter-portal"
                              onClick={(e) => { e.stopPropagation(); onSwitchToCompanyPortal?.(tenant); }}
                              title={`Enter ${tenant.company_name} Portal`}
                              type="button"
                            >
                              Enter Portal ↗
                            </button>
                            <button className="cmp-btn-sm" onClick={(e) => { e.stopPropagation(); selectTenant(tenant.id); }}>
                              {isSelected ? "Managing" : "Manage"}
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
        </div>

        {/* Right Side Workstation Panel */}
        <div className="cmp-workstation-section">
          {selectedTenant ? (
            <div className="cmp-workstation-card">
              {/* Workstation Header */}
              <div className="cmp-ws-header">
                <div className="cmp-ws-title-row">
                  <div className="cmp-ws-avatar">{getInitials(selectedTenant.company_name)}</div>
                  <div className="cmp-ws-title-box">
                    <h2>{selectedTenant.company_name}</h2>
                    <div className="cmp-ws-submeta">
                      <code>slug: {selectedTenant.slug}</code>
                      <span className={`cmp-status-tag is-${selectedTenant.status}`}>
                        {selectedTenant.status}
                      </span>
                    </div>
                  </div>
                  <button
                    className="cmp-btn-enter-portal-lg"
                    onClick={() => onSwitchToCompanyPortal?.(selectedTenant)}
                    type="button"
                  >
                    Enter Portal ↗
                  </button>
                </div>

                {/* Tabs */}
                <div className="cmp-ws-tabs">
                  <button
                    className={`cmp-ws-tab ${detailTab === "details" ? "active" : ""}`}
                    onClick={() => setDetailTab("details")}
                    type="button"
                  >
                    Details & Settings
                  </button>
                  <button
                    className={`cmp-ws-tab ${detailTab === "modules" ? "active" : ""}`}
                    onClick={() => setDetailTab("modules")}
                    type="button"
                  >
                    Modules ({enabledModules})
                  </button>
                  <button
                    className={`cmp-ws-tab ${detailTab === "users" ? "active" : ""}`}
                    onClick={() => setDetailTab("users")}
                    type="button"
                  >
                    Users & Passwords ({selectedCompanyUsers.length})
                  </button>
                  <button
                    className={`cmp-ws-tab ${detailTab === "activity" ? "active" : ""}`}
                    onClick={() => setDetailTab("activity")}
                    type="button"
                  >
                    Audit Log
                  </button>
                </div>
              </div>

              {/* Tab 1: Details */}
              {detailTab === "details" && (
                <form className="cmp-ws-body" onSubmit={saveSelectedCompany}>
                  <div className="cmp-form-grid">
                    <label className="cmp-input-group">
                      <span>Company Name *</span>
                      <input
                        onChange={(e) => setEditForm((c) => ({ ...c, company_name: e.target.value }))}
                        required
                        value={editForm.company_name}
                      />
                    </label>
                    <label className="cmp-input-group">
                      <span>Tenant Slug</span>
                      <input
                        onChange={(e) => setEditForm((c) => ({ ...c, slug: toSlug(e.target.value) }))}
                        value={editForm.slug}
                      />
                    </label>
                    <label className="cmp-input-group">
                      <span>Corporate Email</span>
                      <input
                        onChange={(e) => setEditForm((c) => ({ ...c, email: e.target.value }))}
                        type="email"
                        value={editForm.email}
                      />
                    </label>
                    <label className="cmp-input-group">
                      <span>Contact Phone</span>
                      <input
                        onChange={(e) => setEditForm((c) => ({ ...c, phone: e.target.value }))}
                        value={editForm.phone}
                      />
                    </label>
                    <label className="cmp-input-group">
                      <span>Subscription Status</span>
                      <select
                        onChange={(e) => setEditForm((c) => ({ ...c, status: e.target.value }))}
                        value={editForm.status}
                      >
                        <option value="active">Active Subscription</option>
                        <option value="inactive">Inactive / Suspended</option>
                      </select>
                    </label>
                  </div>
                  <div className="cmp-form-actions">
                    <button className="cmp-btn-primary" disabled={saving} type="submit">
                      {saving ? "Saving Changes..." : "Save Company Details"}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 2: Modules Grid */}
              {detailTab === "modules" && (
                <div className="cmp-ws-body">
                  <div className="cmp-modules-topbar">
                    <div className="cmp-modules-search">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input
                        type="text"
                        placeholder="Search ERP modules by name or slug..."
                        value={moduleSearch}
                        onChange={(e) => setModuleSearch(e.target.value)}
                      />
                      {moduleSearch && (
                        <button className="cmp-clear-btn" onClick={() => setModuleSearch("")}>×</button>
                      )}
                    </div>

                    <div className="cmp-modules-pills">
                      <button
                        className={`cmp-mod-pill ${moduleCategoryFilter === "all" ? "is-active" : ""}`}
                        onClick={() => setModuleCategoryFilter("all")}
                        type="button"
                      >
                        All ({selectedModules.length})
                      </button>
                      <button
                        className={`cmp-mod-pill ${moduleCategoryFilter === "core" ? "is-active" : ""}`}
                        onClick={() => setModuleCategoryFilter("core")}
                        type="button"
                      >
                        Core ERP
                      </button>
                      <button
                        className={`cmp-mod-pill ${moduleCategoryFilter === "integrations" ? "is-active" : ""}`}
                        onClick={() => setModuleCategoryFilter("integrations")}
                        type="button"
                      >
                        Integrations
                      </button>
                      <button
                        className={`cmp-mod-pill ${moduleCategoryFilter === "school" ? "is-active" : ""}`}
                        onClick={() => setModuleCategoryFilter("school")}
                        type="button"
                      >
                        School
                      </button>
                    </div>
                  </div>

                  <div className="cmp-modules-grid">
                    {filteredModules.length === 0 ? (
                      <div className="cmp-empty-compact">No modules matching search.</div>
                    ) : (
                      filteredModules.map((module) => {
                        const isSaving = moduleSavingSlug === module.slug;
                        const isEnabled = Boolean(module.enabled);
                        return (
                          <div
                            className={`cmp-module-card ${isEnabled ? "is-enabled" : ""}`}
                            key={module.slug}
                            onClick={() => toggleTenantModule(module)}
                          >
                            <div className="cmp-mod-card-top">
                              <div className="cmp-mod-icon">
                                {getModuleIconSvg(moduleLabel(module))}
                              </div>
                              <div className="cmp-toggle-switch">
                                <input
                                  checked={isEnabled}
                                  disabled={isSaving}
                                  onChange={() => {}}
                                  type="checkbox"
                                />
                                <span className="cmp-toggle-slider" />
                              </div>
                            </div>

                            <div className="cmp-mod-card-body">
                              <strong className="cmp-mod-title">{moduleLabel(module)}</strong>
                              <div className="cmp-mod-tags">
                                <span className={`cmp-mod-status-badge ${isEnabled ? "is-active" : ""}`}>
                                  {isEnabled ? "Enabled" : "Disabled"}
                                </span>
                                <code className="cmp-mod-slug">{module.slug}</code>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Users & PINs */}
              {detailTab === "users" && (
                <div className="cmp-ws-body">
                  <div className="cmp-subhead">
                    <h3>Company Users & Security Credentials ({selectedCompanyUsers.length})</h3>
                    <p>Inspect active login PINs and reset user credentials directly from Super Admin.</p>
                  </div>

                  <div className="cmp-user-cards-list">
                    {selectedCompanyUsers.length === 0 ? (
                      <div className="cmp-empty-compact">No users created for this tenant yet.</div>
                    ) : (
                      selectedCompanyUsers.map((user) => {
                        const isRevealed = Boolean(revealedPins[user.id]);
                        return (
                          <div className="cmp-user-card-row" key={user.id}>
                            <div className="cmp-user-avatar">{getInitials(user.name)}</div>
                            <div className="cmp-user-main">
                              <strong>{user.name}</strong>
                              <small>@{user.username || user.name}</small>
                            </div>
                            <span className={`cmp-role-pill role-${user.role}`}>
                              {roleLabel(user.role)}
                            </span>
                            
                            {/* PIN View & Reveal */}
                            <div className="cmp-pin-display-box">
                              <span className="cmp-pin-label">PIN:</span>
                              <code className="cmp-pin-code">
                                {isRevealed ? (user.pin || "0000") : "••••"}
                              </code>
                              <button
                                className="cmp-pin-eye-btn"
                                onClick={() => toggleRevealPin(user.id)}
                                title={isRevealed ? "Hide PIN" : "Reveal PIN"}
                                type="button"
                              >
                                {isRevealed ? "🙈" : "👁️"}
                              </button>
                            </div>

                            {/* Reset PIN Trigger */}
                            <button
                              className="cmp-btn-sm cmp-btn-reset-pin"
                              onClick={() => handleOpenResetPinModal(user)}
                              title={`Reset PIN for ${user.name}`}
                              type="button"
                            >
                              Reset PIN
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Create New User Section */}
                  <form className="cmp-create-user-section" onSubmit={createCompanyUser}>
                    <h4>+ Add New User to {selectedTenant.company_name}</h4>
                    <div className="cmp-form-grid">
                      <label className="cmp-input-group">
                        <span>Full Name *</span>
                        <input
                          onChange={(e) => updateUserForm("name", e.target.value)}
                          placeholder="e.g. Sara Ahmed"
                          required
                          value={userForm.name}
                        />
                      </label>
                      <label className="cmp-input-group">
                        <span>Username</span>
                        <input
                          onChange={(e) => updateUserForm("username", e.target.value)}
                          value={userForm.username}
                        />
                      </label>
                      <label className="cmp-input-group">
                        <span>4-digit PIN *</span>
                        <input
                          inputMode="numeric"
                          maxLength={4}
                          onChange={(e) => updateUserForm("pin", e.target.value.replace(/\D/g, ""))}
                          type="password"
                          value={userForm.pin}
                        />
                      </label>
                      <label className="cmp-input-group">
                        <span>User Role</span>
                        <select onChange={(e) => updateUserForm("role", e.target.value)} value={userForm.role}>
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>{roleLabel(r)}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="cmp-pages-header">
                      <span>Allowed ERP Pages ({userForm.allowed_pages.length})</span>
                      <div className="cmp-page-btns">
                        <button onClick={() => updateUserForm("allowed_pages", pagesForRole(userForm.role))} type="button">Role Default</button>
                        <button onClick={() => updateUserForm("allowed_pages", pageChoices)} type="button">Select All</button>
                      </div>
                    </div>

                    <div className="cmp-pages-pills">
                      {pageChoices.map((page) => {
                        const isChecked = userForm.allowed_pages.includes(page);
                        return (
                          <label className={`cmp-page-pill ${isChecked ? "active" : ""}`} key={page}>
                            <input
                              checked={isChecked}
                              disabled={page === "Dashboard"}
                              onChange={() => toggleUserPage(page)}
                              type="checkbox"
                            />
                            <span>{page}</span>
                          </label>
                        );
                      })}
                    </div>

                    <button className="cmp-btn-primary" disabled={userSaving} type="submit">
                      {userSaving ? "Creating Account..." : "Create User Account"}
                    </button>
                  </form>
                </div>
              )}

              {/* Tab 4: Audit */}
              {detailTab === "activity" && (
                <div className="cmp-ws-body">
                  <div className="cmp-subhead">
                    <h3>Company Audit Feed</h3>
                    <p>Log of actions performed in {selectedTenant.company_name}.</p>
                  </div>

                  <div className="cmp-activity-feed">
                    {selectedCompanyActivity.length === 0 ? (
                      <div className="cmp-empty-compact">No audit log records for this company.</div>
                    ) : (
                      selectedCompanyActivity.map((log) => (
                        <div className="cmp-activity-card" key={log.id}>
                          <div className="cmp-act-head">
                            <strong>{log.summary || log.action}</strong>
                            <small>{formatActivityTime(log.created_at)}</small>
                          </div>
                          <div className="cmp-act-meta">
                            <span>Actor: {log.actor_user_name || "Unknown"}</span>
                            <span>•</span>
                            <span>Entity: {log.page || log.entity_type || "Company"}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="cmp-workstation-placeholder">
              <div className="cmp-ph-icon">👈</div>
              <h3>Select a Company</h3>
              <p>Choose any tenant from the directory to configure modules, edit details, manage passwords, or enter tenant portal.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Reset User PIN */}
      {pinModalUser && (
        <div className="cmp-modal-backdrop" onClick={() => setPinModalUser(null)}>
          <div className="cmp-modal-card cmp-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-modal-header">
              <div>
                <h2>Update / Reset User PIN</h2>
                <p>Set a new 4-digit security PIN for <strong>{pinModalUser.name}</strong> (@{pinModalUser.username || pinModalUser.name})</p>
              </div>
              <button className="cmp-close-btn" onClick={() => setPinModalUser(null)}>×</button>
            </div>

            <form className="cmp-modal-body" onSubmit={handleSaveUserPin}>
              <label className="cmp-input-group">
                <span>New 4-Digit Security PIN</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(e) => setNewPinValue(e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 1234"
                  required
                  type="text"
                  value={newPinValue}
                />
              </label>

              <div className="cmp-modal-footer">
                <button className="cmp-btn-secondary" onClick={() => setPinModalUser(null)} type="button">
                  Cancel
                </button>
                <button className="cmp-btn-primary" disabled={updatingPin} type="submit">
                  {updatingPin ? "Updating PIN..." : "Save New PIN"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Company */}
      {showCreateModal && (
        <div className="cmp-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="cmp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-modal-header">
              <div>
                <h2>Create New Company Tenant</h2>
                <p>Provision a new enterprise tenant with admin credentials & modules</p>
              </div>
              <button className="cmp-close-btn" onClick={() => setShowCreateModal(false)}>×</button>
            </div>

            <form className="cmp-modal-body" onSubmit={createCompany}>
              <div className="cmp-modal-section">
                <h3>Basic Information</h3>
                <div className="cmp-form-grid">
                  <label className="cmp-input-group">
                    <span>Company Name *</span>
                    <input
                      onChange={(e) => updateCompanyForm("company_name", e.target.value)}
                      placeholder="e.g. Hisbenew Apparel"
                      required
                      value={companyForm.company_name}
                    />
                  </label>
                  <label className="cmp-input-group">
                    <span>Tenant Slug</span>
                    <input
                      onChange={(e) => updateCompanyForm("slug", toSlug(e.target.value))}
                      placeholder="hisbenew-apparel"
                      value={companyForm.slug}
                    />
                  </label>
                  <label className="cmp-input-group">
                    <span>Corporate Email</span>
                    <input
                      onChange={(e) => updateCompanyForm("email", e.target.value)}
                      type="email"
                      value={companyForm.email}
                    />
                  </label>
                  <label className="cmp-input-group">
                    <span>Phone</span>
                    <input
                      onChange={(e) => updateCompanyForm("phone", e.target.value)}
                      value={companyForm.phone}
                    />
                  </label>
                </div>
              </div>

              <div className="cmp-modal-section">
                <h3>First Company Admin Account</h3>
                <div className="cmp-form-grid">
                  <label className="cmp-input-group">
                    <span>Admin Name</span>
                    <input
                      onChange={(e) => updateCompanyForm("admin_name", e.target.value)}
                      placeholder="Admin full name"
                      value={companyForm.admin_name}
                    />
                  </label>
                  <label className="cmp-input-group">
                    <span>Admin Username</span>
                    <input
                      onChange={(e) => updateCompanyForm("admin_username", e.target.value)}
                      value={companyForm.admin_username}
                    />
                  </label>
                  <label className="cmp-input-group">
                    <span>Admin 4-digit PIN</span>
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      onChange={(e) => updateCompanyForm("admin_pin", e.target.value.replace(/\D/g, ""))}
                      type="password"
                      value={companyForm.admin_pin}
                    />
                  </label>
                </div>
              </div>

              <div className="cmp-modal-section">
                <h3>Enabled ERP Modules</h3>
                <div className="cmp-modules-pills-grid">
                  {modules.map((m) => {
                    const isSelected = companyForm.module_slugs.includes(m.slug);
                    return (
                      <label className={`cmp-mod-pill ${isSelected ? "selected" : ""}`} key={m.slug}>
                        <input
                          checked={isSelected}
                          onChange={() => toggleCreateModule(m.slug)}
                          type="checkbox"
                        />
                        <span>{moduleLabel(m)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="cmp-modal-footer">
                <button className="cmp-btn-secondary" onClick={() => setShowCreateModal(false)} type="button">
                  Cancel
                </button>
                <button className="cmp-btn-primary" disabled={saving} type="submit">
                  {saving ? "Creating Tenant..." : "Create Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
