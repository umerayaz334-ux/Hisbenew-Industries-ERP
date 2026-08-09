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

export default function SuperAdminDashboard({ authenticatedUser, onNavigate }) {
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadPlatform = async () => {
      setLoading(true);
      setError("");
      try {
        const [tenantsResponse, usersResponse, activityResponse] = await Promise.all([
          api.get("/tenants"),
          api.get("/users"),
          api.get("/activity-logs?limit=12"),
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

  const tenantById = useMemo(
    () => new Map(tenants.map((tenant) => [Number(tenant.id), tenant])),
    [tenants]
  );
  const activeCompanies = tenants.filter((tenant) => tenant.status === "active").length;
  const companyUsers = users.filter((user) => user.role !== "super_admin");
  const companyAdmins = users.filter((user) => user.role === "admin");
  const recentCompanies = tenants.slice(0, 5);

  return (
    <div className="super-admin-page">
      <header className="super-admin-header">
        <div>
          <span>Platform dashboard</span>
          <h1>Super admin</h1>
          <p>{authenticatedUser?.name || "Hafiz Umer"} can manage companies, users, access, and activity from here.</p>
        </div>
        <div className="super-admin-actions">
          <button onClick={() => onNavigate?.("Companies")} type="button">Companies</button>
          <button onClick={() => onNavigate?.("Users")} type="button">Users</button>
        </div>
      </header>

      {error && <div className="super-admin-alert">{error}</div>}

      <section className="super-admin-metrics" aria-label="Platform metrics">
        <article>
          <span>Companies</span>
          <strong>{loading ? "..." : tenants.length}</strong>
          <small>{activeCompanies} active</small>
        </article>
        <article>
          <span>Company users</span>
          <strong>{loading ? "..." : companyUsers.length}</strong>
          <small>{companyAdmins.length} admins</small>
        </article>
        <article>
          <span>Recent activity</span>
          <strong>{loading ? "..." : activityLogs.length}</strong>
          <small>Latest platform feed</small>
        </article>
      </section>

      <div className="super-admin-grid">
        <section className="super-admin-panel">
          <div className="super-admin-panel-heading">
            <h2>Companies</h2>
            <button onClick={() => onNavigate?.("Companies")} type="button">Manage</button>
          </div>
          <div className="super-admin-company-list">
            {recentCompanies.length === 0 ? (
              <div className="super-admin-empty">No companies yet.</div>
            ) : (
              recentCompanies.map((tenant) => (
                <article className="super-admin-company-row" key={tenant.id}>
                  <div>
                    <strong>{tenant.company_name}</strong>
                    <small>{tenant.slug}</small>
                  </div>
                  <span className={`super-admin-status is-${tenant.status}`}>{tenant.status}</span>
                  <span>{tenant.user_count || 0} users</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="super-admin-panel">
          <div className="super-admin-panel-heading">
            <h2>Activity</h2>
            <button onClick={() => onNavigate?.("Users")} type="button">Open users</button>
          </div>
          <div className="super-admin-activity-list">
            {activityLogs.length === 0 ? (
              <div className="super-admin-empty">No recent activity yet.</div>
            ) : (
              activityLogs.map((activity) => {
                const tenant = tenantById.get(Number(activity.tenant_id));
                return (
                  <article className="super-admin-activity-row" key={activity.id}>
                    <div>
                      <strong>{activity.summary || activity.action}</strong>
                      <small>{activity.actor_user_name || "Unknown user"} - {tenant?.company_name || "Platform"}</small>
                    </div>
                    <span>{formatTime(activity.created_at)}</span>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
