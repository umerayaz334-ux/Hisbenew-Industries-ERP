import { useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./SuperAdminDashboard.css";

const formatTime = (value) => {
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

export default function SuperAdminDashboard({ authenticatedUser, onNavigate, onSwitchToCompanyPortal }) {
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companySearch, setCompanySearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadPlatform = async () => {
      setLoading(true);
      setError("");
      try {
        const [tenantsResponse, usersResponse, activityResponse] = await Promise.all([
          api.get("/tenants"),
          api.get("/users"),
          api.get("/activity-logs?limit=15"),
        ]);
        if (cancelled) return;
        setTenants(Array.isArray(tenantsResponse.data) ? tenantsResponse.data : []);
        setUsers(Array.isArray(usersResponse.data) ? usersResponse.data : []);
        setActivityLogs(Array.isArray(activityResponse.data) ? activityResponse.data : []);
      } catch (loadError) {
        console.error("Super admin dashboard load error:", loadError);
        if (!cancelled) setError(loadError.response?.data?.detail || "Unable to load platform dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPlatform();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCompanies = tenants.filter((tenant) => tenant.status === "active").length;
  const companyUsers = users.filter((user) => user.role !== "super_admin");
  const companyAdmins = users.filter((user) => user.role === "admin");

  const filteredCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return tenants.slice(0, 5);
    return tenants
      .filter(
        (t) =>
          t.company_name?.toLowerCase().includes(q) ||
          t.slug?.toLowerCase().includes(q) ||
          t.email?.toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [companySearch, tenants]);

  const greetingName = authenticatedUser?.name || authenticatedUser?.username || "Admin";

  return (
    <div className="faire-dashboard">
      {/* Faire Serif Greeting Header */}
      <header className="faire-header">
        <h1 className="faire-greeting">Good day, {greetingName}!</h1>
        <button className="faire-link-btn" onClick={() => onNavigate?.("Companies")} type="button">
          See all companies →
        </button>
      </header>

      {error && (
        <div className="faire-alert faire-alert-error">
          <span>{error}</span>
        </div>
      )}

      {/* Target Action Banner Block */}
      <section className="faire-card faire-banner-card">
        <div className="faire-banner-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16"/><path d="M1 21h22"/><path d="M9 7h1"/><path d="M9 11h1"/><path d="M14 7h1"/><path d="M14 11h1"/></svg>
        </div>
        <div className="faire-banner-content">
          <h2>Provision & Manage Tenant Workspaces</h2>
          <p>Instantly deploy new enterprise companies, enable ERP modules, inspect login PINs, or enter company portals.</p>
          <div className="faire-banner-actions">
            <button className="faire-text-action" onClick={() => onNavigate?.("Companies")} type="button">
              + Create new company
            </button>
            <span className="faire-dot-sep">•</span>
            <button className="faire-text-action" onClick={() => onNavigate?.("Users")} type="button">
              Manage system users & PINs
            </button>
          </div>
        </div>
      </section>

      {/* Analytics Snapshot Card */}
      <section className="faire-card faire-snapshot-card">
        <div className="faire-card-header">
          <div className="faire-title-row">
            <h2>Analytics snapshot</h2>
          </div>
          <button className="faire-link-btn" onClick={() => onNavigate?.("Companies")} type="button">
            Go to companies directory →
          </button>
        </div>

        <div className="faire-snapshot-grid">
          <div className="faire-metric-col">
            <span className="faire-metric-label">Total Companies</span>
            <div className="faire-metric-num">{loading ? "..." : tenants.length}</div>
            <span className="faire-trend-pill faire-pill-green">
              ↑ {activeCompanies} Active
            </span>
          </div>

          <div className="faire-metric-col">
            <span className="faire-metric-label">Platform Users</span>
            <div className="faire-metric-num">{loading ? "..." : companyUsers.length}</div>
            <span className="faire-trend-pill faire-pill-green">
              ↑ {companyAdmins.length} Admins
            </span>
          </div>

          <div className="faire-metric-col">
            <span className="faire-metric-label">Engine Health</span>
            <div className="faire-metric-num">
              {loading ? "..." : `${Math.round((activeCompanies / (tenants.length || 1)) * 100)}%`}
            </div>
            <span className="faire-trend-pill faire-pill-green">
              ↑ 100% Operational
            </span>
          </div>

          <div className="faire-metric-col">
            <span className="faire-metric-label">Recent Audit Feed</span>
            <div className="faire-metric-num">{loading ? "..." : activityLogs.length}</div>
            <span className="faire-trend-pill faire-pill-neutral">
              Realtime Logs
            </span>
          </div>
        </div>
      </section>

      {/* Main Split Content: Companies Overview & Activity */}
      <div className="faire-split-grid">
        {/* Companies Directory Card */}
        <section className="faire-card faire-section-card">
          <div className="faire-card-header">
            <div>
              <h2>Companies Directory</h2>
              <span className="faire-subtext">{tenants.length} provisioned tenant entities</span>
            </div>
            <button className="faire-link-btn" onClick={() => onNavigate?.("Companies")} type="button">
              View all ({tenants.length})
            </button>
          </div>

          <div className="faire-search-input-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              placeholder="Search companies by name or slug..."
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
            />
          </div>

          <div className="faire-list">
            {loading ? (
              <div className="faire-empty-msg">Loading companies...</div>
            ) : filteredCompanies.length === 0 ? (
              <div className="faire-empty-msg">No companies found matching search.</div>
            ) : (
              filteredCompanies.map((tenant) => (
                <div className="faire-list-row" key={tenant.id}>
                  <div className="faire-row-main">
                    <span className={`faire-status-pill is-${tenant.status}`}>
                      {tenant.status === "active" ? "Active" : "Inactive"}
                    </span>
                    <strong className="faire-company-title">{tenant.company_name}</strong>
                    <code className="faire-slug-tag">{tenant.slug}</code>
                  </div>

                  <div className="faire-row-actions">
                    <span className="faire-user-count">{tenant.user_count || 0} users</span>
                    <button
                      className="faire-btn-enter"
                      onClick={() => onSwitchToCompanyPortal?.(tenant)}
                      title={`Enter ${tenant.company_name} portal`}
                      type="button"
                    >
                      Enter Portal ↗
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Live System Feed Card */}
        <section className="faire-card faire-section-card">
          <div className="faire-card-header">
            <div>
              <h2>Recent System Activity</h2>
              <span className="faire-subtext">Realtime audit events & page views</span>
            </div>
            <button className="faire-link-btn" onClick={() => onNavigate?.("Users")} type="button">
              Manage users →
            </button>
          </div>

          <div className="faire-list">
            {loading ? (
              <div className="faire-empty-msg">Loading audit activity...</div>
            ) : activityLogs.length === 0 ? (
              <div className="faire-empty-msg">No activity logged.</div>
            ) : (
              activityLogs.slice(0, 5).map((log) => (
                <div className="faire-list-row" key={log.id}>
                  <div className="faire-row-main">
                    <span className="faire-actor-pill">
                      {log.actor_user_name || "System"}
                    </span>
                    <span className="faire-activity-text">{log.summary || log.action}</span>
                  </div>
                  <span className="faire-time-text">{formatTime(log.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
