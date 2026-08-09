import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./Companies.css";

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

const toSlug = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const moduleLabel = (module) => module?.page_name || module?.name || module?.slug || "Module";

export default function Companies({ authenticatedUser }) {
  const isSuperAdmin = authenticatedUser?.role === "super_admin";
  const [tenants, setTenants] = useState([]);
  const [modules, setModules] = useState([]);
  const [modulesByTenant, setModulesByTenant] = useState({});
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [editForm, setEditForm] = useState({ company_name: "", slug: "", email: "", phone: "", status: "active" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moduleSavingSlug, setModuleSavingSlug] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => Number(tenant.id) === Number(selectedTenantId)) || null,
    [selectedTenantId, tenants]
  );
  const selectedModules = selectedTenantId ? modulesByTenant[selectedTenantId] || [] : [];
  const activeTenants = tenants.filter((tenant) => tenant.status === "active").length;
  const enabledModules = selectedModules.filter((module) => module.enabled).length;

  const loadTenantModules = useCallback(async (tenantId) => {
    if (!tenantId) return [];
    const response = await api.get(`/tenants/${tenantId}/modules`);
    const nextModules = Array.isArray(response.data) ? response.data : [];
    setModulesByTenant((current) => ({ ...current, [tenantId]: nextModules }));
    return nextModules;
  }, []);

  const loadCompanies = useCallback(async () => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [tenantsResponse, modulesResponse] = await Promise.all([
        api.get("/tenants"),
        api.get("/modules"),
      ]);
      const nextTenants = Array.isArray(tenantsResponse.data) ? tenantsResponse.data : [];
      const nextModules = Array.isArray(modulesResponse.data) ? modulesResponse.data : [];
      setTenants(nextTenants);
      setModules(nextModules);
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

  const selectTenant = async (tenantId) => {
    setSelectedTenantId(tenantId);
    setError("");
    setSuccess("");
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
        next.admin_username = toSlug(value).replace(/-/g, ".");
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
          <p>Manage company tenants, first admins, and enabled ERP modules.</p>
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
            <span>Modules</span>
            <strong>{enabledModules}</strong>
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
            </>
          ) : (
            <div className="companies-empty">Select a company to edit details and modules.</div>
          )}
        </section>
      </div>
    </div>
  );
}
