import { useCallback, useEffect, useMemo, useState } from "react";
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

const normalizePageList = (pages = []) => {
  const next = [];
  pages.forEach((page) => {
    if (!page || next.includes(page)) return;
    next.push(page);
  });
  return next;
};

export default function Companies({ authenticatedUser }) {
  const isSuperAdmin = authenticatedUser?.role === "super_admin";
  const [tenants, setTenants] = useState([]);
  const [modules, setModules] = useState([]);
  const [users, setUsers] = useState([]);
  const [accessOptions, setAccessOptions] = useState({ pages: [], role_defaults: {} });
  const [modulesByTenant, setModulesByTenant] = useState({});
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [editForm, setEditForm] = useState({ company_name: "", slug: "", email: "", phone: "", status: "active" });
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [moduleSavingSlug, setModuleSavingSlug] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => Number(tenant.id) === Number(selectedTenantId)) || null,
    [selectedTenantId, tenants]
  );

  const selectedModules = selectedTenantId ? modulesByTenant[selectedTenantId] || [] : [];
  const selectedCompanyUsers = useMemo(
    () => users.filter((user) => Number(user.tenant_id) === Number(selectedTenantId)),
    [selectedTenantId, users]
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
      const [tenantsResponse, modulesResponse, usersResponse, accessResponse] = await Promise.all([
        api.get("/tenants"),
        api.get("/modules"),
        api.get("/users"),
        api.get("/user-access-options"),
      ]);
      const nextTenants = Array.isArray(tenantsResponse.data) ? tenantsResponse.data : [];
      const nextModules = Array.isArray(modulesResponse.data) ? modulesResponse.data : [];
      setTenants(nextTenants);
      setModules(nextModules);
      setUsers(Array.isArray(usersResponse.data) ? usersResponse.data : []);
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
      setSuccess("Company created.");
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
      setSuccess("Company updated.");
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

  if (!isSuperAdmin) {
    return (
      <div className="companies-page">
        <section className="companies-state-panel">
          <span className="companies-eyebrow">Companies</span>
          <h1>Super admin access required</h1>
          <p>Company creation, tenant modules, and cross-company user assignment are only available to Hafiz Umer as super admin.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="companies-page">
      <header className="companies-header">
        <div>
          <span className="companies-eyebrow">Super admin</span>
          <h1>Companies</h1>
          <p>Manage company tenants, company users, and enabled ERP modules.</p>
        </div>
        <div className="companies-summary-strip" aria-label="Company summary">
          <article>
            <span>Total</span>
            <strong>{tenants.length}</strong>
          </article>
          <article>
            <span>Active</span>
            <strong>{activeTenants}</strong>
          </article>
          <article>
            <span>Users</span>
            <strong>{selectedCompanyUsers.length}</strong>
          </article>
        </div>
      </header>

      {error && <div className="companies-message is-error">{error}</div>}
      {success && <div className="companies-message is-success">{success}</div>}

      <div className="companies-layout">
        <section className="companies-panel companies-create-panel">
          <div className="companies-panel-heading">
            <span className="companies-eyebrow">New company</span>
            <h2>Create tenant</h2>
          </div>
          <form className="companies-form" onSubmit={createCompany}>
            <div className="companies-form-grid">
              <label>
                Company name
                <input
                  onChange={(event) => updateCompanyForm("company_name", event.target.value)}
                  placeholder="e.g. Hisbenew Lahore"
                  required
                  value={companyForm.company_name}
                />
              </label>
              <label>
                Slug
                <input
                  onChange={(event) => updateCompanyForm("slug", toSlug(event.target.value))}
                  placeholder="hisbenew-lahore"
                  value={companyForm.slug}
                />
              </label>
              <label>
                Email
                <input
                  onChange={(event) => updateCompanyForm("email", event.target.value)}
                  type="email"
                  value={companyForm.email}
                />
              </label>
              <label>
                Phone
                <input
                  onChange={(event) => updateCompanyForm("phone", event.target.value)}
                  value={companyForm.phone}
                />
              </label>
              <label>
                Status
                <select
                  onChange={(event) => updateCompanyForm("status", event.target.value)}
                  value={companyForm.status}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>

            <div className="companies-subsection">
              <h3>First company admin</h3>
              <div className="companies-form-grid">
                <label>
                  Admin name
                  <input
                    onChange={(event) => updateCompanyForm("admin_name", event.target.value)}
                    placeholder="Optional"
                    value={companyForm.admin_name}
                  />
                </label>
                <label>
                  Admin username
                  <input
                    onChange={(event) => updateCompanyForm("admin_username", event.target.value)}
                    value={companyForm.admin_username}
                  />
                </label>
                <label>
                  Admin PIN
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => updateCompanyForm("admin_pin", event.target.value.replace(/\D/g, ""))}
                    type="password"
                    value={companyForm.admin_pin}
                  />
                </label>
                <label>
                  Admin email
                  <input
                    onChange={(event) => updateCompanyForm("admin_email", event.target.value)}
                    type="email"
                    value={companyForm.admin_email}
                  />
                </label>
                <label>
                  Admin phone
                  <input
                    onChange={(event) => updateCompanyForm("admin_phone", event.target.value)}
                    value={companyForm.admin_phone}
                  />
                </label>
              </div>
            </div>

            <div className="companies-subsection">
              <h3>Enabled modules</h3>
              <div className="companies-module-grid">
                {modules.map((module) => (
                  <label className={companyForm.module_slugs.includes(module.slug) ? "is-selected" : ""} key={module.slug}>
                    <input
                      checked={companyForm.module_slugs.includes(module.slug)}
                      onChange={() => toggleCreateModule(module.slug)}
                      type="checkbox"
                    />
                    <span>{moduleLabel(module)}</span>
                  </label>
                ))}
              </div>
            </div>

            <button className="companies-primary-button" disabled={saving} type="submit">
              {saving ? "Saving..." : "Create company"}
            </button>
          </form>
        </section>

        <section className="companies-panel companies-directory-panel">
          <div className="companies-panel-heading">
            <span className="companies-eyebrow">Directory</span>
            <h2>Company tenants</h2>
          </div>
          {loading ? (
            <div className="companies-empty">Loading companies...</div>
          ) : tenants.length === 0 ? (
            <div className="companies-empty">No companies yet.</div>
          ) : (
            <div className="companies-tenant-list">
              {tenants.map((tenant) => (
                <button
                  className={`companies-tenant-row ${Number(selectedTenantId) === Number(tenant.id) ? "is-active" : ""}`.trim()}
                  key={tenant.id}
                  onClick={() => selectTenant(tenant.id)}
                  type="button"
                >
                  <span>
                    <strong>{tenant.company_name}</strong>
                    <small>{tenant.slug}</small>
                  </span>
                  <span className={`companies-status is-${tenant.status}`}>{tenant.status}</span>
                  <span>{tenant.user_count || 0} users</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="companies-panel companies-detail-panel">
          <div className="companies-panel-heading">
            <span className="companies-eyebrow">Selected company</span>
            <h2>{selectedTenant?.company_name || "Choose a company"}</h2>
          </div>
          {selectedTenant ? (
            <>
              <form className="companies-form" onSubmit={saveSelectedCompany}>
                <div className="companies-form-grid">
                  <label>
                    Company name
                    <input
                      onChange={(event) => setEditForm((current) => ({ ...current, company_name: event.target.value }))}
                      required
                      value={editForm.company_name}
                    />
                  </label>
                  <label>
                    Slug
                    <input
                      onChange={(event) => setEditForm((current) => ({ ...current, slug: toSlug(event.target.value) }))}
                      value={editForm.slug}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))}
                      type="email"
                      value={editForm.email}
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))}
                      value={editForm.phone}
                    />
                  </label>
                  <label>
                    Status
                    <select
                      onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}
                      value={editForm.status}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                </div>
                <button className="companies-secondary-button" disabled={saving} type="submit">
                  {saving ? "Saving..." : "Save company"}
                </button>
              </form>

              <div className="companies-subsection">
                <div className="companies-module-heading">
                  <h3>Company modules</h3>
                  <span>{enabledModules} enabled</span>
                </div>
                <div className="companies-module-grid companies-module-grid-detail">
                  {selectedModules.map((module) => (
                    <label className={module.enabled ? "is-selected" : ""} key={module.slug}>
                      <input
                        checked={Boolean(module.enabled)}
                        disabled={moduleSavingSlug === module.slug}
                        onChange={() => toggleTenantModule(module)}
                        type="checkbox"
                      />
                      <span>{moduleLabel(module)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="companies-user-section">
                <div className="companies-module-heading">
                  <h3>Company users</h3>
                  <span>{selectedCompanyUsers.length} accounts</span>
                </div>
                <div className="companies-user-list">
                  {selectedCompanyUsers.length === 0 ? (
                    <div className="companies-empty companies-empty-compact">No users in this company yet.</div>
                  ) : (
                    selectedCompanyUsers.map((user) => (
                      <article className="companies-user-row" key={user.id}>
                        <span className="companies-user-avatar">
                          {(user.name || user.username || "U").slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{user.name}</strong>
                          <small>@{user.username || user.name}</small>
                        </div>
                        <span className={`companies-status is-${user.is_active ? "active" : "inactive"}`}>
                          {user.is_active ? "active" : "inactive"}
                        </span>
                        <span>{roleLabel(user.role)}</span>
                        <span>{user.allowed_pages?.length || 0} pages</span>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <form className="companies-form companies-user-form" onSubmit={createCompanyUser}>
                <div className="companies-panel-heading companies-user-form-heading">
                  <span className="companies-eyebrow">New company user</span>
                  <h2>Create user for {selectedTenant.company_name}</h2>
                </div>
                <div className="companies-form-grid">
                  <label>
                    Full name
                    <input
                      onChange={(event) => updateUserForm("name", event.target.value)}
                      placeholder="e.g. Sara Ahmed"
                      required
                      value={userForm.name}
                    />
                  </label>
                  <label>
                    Username
                    <input
                      onChange={(event) => updateUserForm("username", event.target.value)}
                      value={userForm.username}
                    />
                  </label>
                  <label>
                    4-digit PIN
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      onChange={(event) => updateUserForm("pin", event.target.value.replace(/\D/g, ""))}
                      type="password"
                      value={userForm.pin}
                    />
                  </label>
                  <label>
                    Role
                    <select onChange={(event) => updateUserForm("role", event.target.value)} value={userForm.role}>
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>{roleLabel(role)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select
                      onChange={(event) => updateUserForm("is_active", event.target.value === "active")}
                      value={userForm.is_active ? "active" : "inactive"}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                </div>

                <div className="companies-user-access-header">
                  <div>
                    <h3>Allowed ERP pages</h3>
                    <span>{userForm.allowed_pages.length} selected</span>
                  </div>
                  <div className="companies-user-access-actions">
                    <button onClick={() => updateUserForm("allowed_pages", pagesForRole(userForm.role))} type="button">
                      Role default
                    </button>
                    <button onClick={() => updateUserForm("allowed_pages", pageChoices)} type="button">
                      Select all
                    </button>
                  </div>
                </div>

                <div className="companies-page-grid">
                  {pageChoices.map((page) => (
                    <label className={userForm.allowed_pages.includes(page) ? "is-selected" : ""} key={page}>
                      <input
                        checked={userForm.allowed_pages.includes(page)}
                        disabled={page === "Dashboard"}
                        onChange={() => toggleUserPage(page)}
                        type="checkbox"
                      />
                      <span>{page}</span>
                    </label>
                  ))}
                </div>

                <button className="companies-primary-button" disabled={userSaving} type="submit">
                  {userSaving ? "Creating..." : "Create company user"}
                </button>
              </form>
            </>
          ) : (
            <div className="companies-empty">Select a company to edit details, modules, and users.</div>
          )}
        </section>
      </div>
    </div>
  );
}
