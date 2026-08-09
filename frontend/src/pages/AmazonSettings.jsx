import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./AmazonSettings.css";

const REGION_ENDPOINTS = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
};

const EMPTY_FORM = {
  account_name: "Hisbenew Industries Amazon USA",
  client_identifier: "",
  client_secret: "",
  app_id: "",
  refresh_token: "",
  seller_id: "",
  marketplace_id: "ATVPDKIKX0DER",
  region: "NA",
  endpoint: REGION_ENDPOINTS.NA,
  currency: "USD",
  is_active: true,
  lwa_secret_rotation_due_date: "",
};

const TERMINAL_SYNC_STATUSES = new Set([
  "Completed",
  "Failed",
  "Retrying",
  "Cancelled",
]);

const formatDateTime = (value) => {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const dateInputValue = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const responseError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg).filter(Boolean).join(" ") || fallback;
  }
  return typeof detail === "string" && detail ? detail : fallback;
};

const statusTone = (status) => {
  if (status === "Connected") return "is-connected";
  if (["Testing", "Not Connected"].includes(status)) return "is-pending";
  if (status === "Disabled") return "is-disabled";
  return "is-error";
};

const syncJobTone = (status) => {
  if (status === "Completed") return "is-complete";
  if (["Failed", "Cancelled"].includes(status)) return "is-failed";
  if (status === "Retrying") return "is-warning";
  return "is-working";
};

const diagnosticTone = (status) => {
  if (status === "ok") return "is-ok";
  if (status === "warning") return "is-warning";
  if (status === "skipped") return "is-skipped";
  return "is-failed";
};

const diagnosticLabel = (status) => {
  if (status === "ok") return "OK";
  if (status === "warning") return "Warning";
  if (status === "skipped") return "Skipped";
  return "Failed";
};

const getRotationWarning = (value, referenceTime) => {
  if (!value) return "";
  const dueDate = new Date(value);
  if (Number.isNaN(dueDate.getTime())) return "";
  const daysRemaining = Math.ceil(
    (dueDate.getTime() - referenceTime) / 86400000
  );
  if (daysRemaining < 0) {
    return "The configured LWA client secret rotation date has passed. Rotate the secret and update this connection.";
  }
  if (daysRemaining <= 30) {
    return `The LWA client secret rotation date is ${daysRemaining} day${
      daysRemaining === 1 ? "" : "s"
    } away. Plan the credential rotation now.`;
  }
  return "";
};

function CredentialState({ label, masked, saved }) {
  return (
    <article className="amazon-credential-state">
      <span>{label}</span>
      <strong>{saved ? masked || "Saved securely" : "Not saved"}</strong>
      <small className={saved ? "is-saved" : ""}>
        {saved ? "Encrypted at rest" : "Required before connection test"}
      </small>
    </article>
  );
}

function AmazonSettings({ authenticatedUser }) {
  const confirmDialog = useConfirmDialog();
  const refreshTokenRef = useRef(null);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState(false);
  const [reauthorizing, setReauthorizing] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showRefreshToken, setShowRefreshToken] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [syncJobs, setSyncJobs] = useState([]);
  const [autoSyncForm, setAutoSyncForm] = useState({
    enabled: true,
    interval_minutes: 15,
  });
  const [rotationReferenceTime] = useState(() => Date.now());
  const isAdmin = ["admin", "super_admin"].includes(authenticatedUser?.role);

  const applySettings = useCallback((data) => {
    setSettings(data);
    setAutoSyncForm({
      enabled: data?.auto_sync_enabled !== false,
      interval_minutes: Number(data?.auto_sync_interval_minutes || 15),
    });
    setForm({
      ...EMPTY_FORM,
      account_name: data?.account_name || EMPTY_FORM.account_name,
      marketplace_id: data?.marketplace_id || EMPTY_FORM.marketplace_id,
      region: data?.region || EMPTY_FORM.region,
      endpoint:
        data?.endpoint ||
        REGION_ENDPOINTS[data?.region || EMPTY_FORM.region] ||
        EMPTY_FORM.endpoint,
      currency: data?.currency || EMPTY_FORM.currency,
      is_active: data?.is_active !== false,
      lwa_secret_rotation_due_date: dateInputValue(
        data?.lwa_secret_rotation_due_date
      ),
      client_identifier: "",
      client_secret: "",
      app_id: "",
      refresh_token: "",
      seller_id: "",
    });
    if (!data?.id) setEditing(true);
  }, []);

  const loadSettings = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.get("/amazon/settings");
      applySettings(response.data || {});
      setError("");
      return response.data;
    } catch (loadError) {
      setError(
        responseError(
          loadError,
          "Amazon Seller Central settings could not be loaded."
        )
      );
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applySettings]);

  const loadDiagnostics = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setDiagnosticsLoading(true);
    try {
      const response = await api.get("/amazon/settings/diagnostics");
      setDiagnostics(response.data || null);
      setDiagnosticsError("");
      return response.data;
    } catch (diagnosticError) {
      setDiagnostics(null);
      setDiagnosticsError(
        responseError(
          diagnosticError,
          "Amazon VPS diagnostics could not be loaded."
        )
      );
      return null;
    } finally {
      if (!quiet) setDiagnosticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    api
      .get("/amazon/settings")
      .then((response) => {
        if (cancelled) return;
        applySettings(response.data || {});
        setError("");
        loadDiagnostics({ quiet: true });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(
          responseError(
            loadError,
            "Amazon Seller Central settings could not be loaded."
          )
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySettings, isAdmin, loadDiagnostics]);

  const updateField = (field, value) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "region") {
        next.endpoint = REGION_ENDPOINTS[value] || current.endpoint;
      }
      return next;
    });
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    setError("");
    try {
      const response = await api.put("/amazon/settings", {
        ...form,
        lwa_secret_rotation_due_date: form.lwa_secret_rotation_due_date
          ? `${form.lwa_secret_rotation_due_date}T00:00:00`
          : null,
        reauthorize: reauthorizing,
      });
      applySettings(response.data);
      setEditing(false);
      setReauthorizing(false);
      setShowClientSecret(false);
      setShowRefreshToken(false);
      loadDiagnostics({ quiet: true });
      setMessage(
        reauthorizing
          ? "Amazon authorization credentials updated. Test the connection to confirm access."
          : "Amazon Seller Central settings saved securely."
      );
    } catch (saveError) {
      setError(
        responseError(saveError, "Amazon settings could not be saved.")
      );
    } finally {
      setBusy("");
    }
  };

  const testConnection = async () => {
    setBusy("test");
    setMessage("");
    setError("");
    try {
      const response = await api.post("/amazon/settings/test-connection");
      applySettings(response.data);
      loadDiagnostics({ quiet: true });
      setMessage(
        "Amazon Seller Central connected successfully through the Sellers API."
      );
    } catch (testError) {
      await loadSettings({ quiet: true });
      loadDiagnostics({ quiet: true });
      setError(
        responseError(
          testError,
          "Amazon connection test failed. Review the saved credentials and permissions."
        )
      );
    } finally {
      setBusy("");
    }
  };

  const pollAllSyncJobs = async (initialJobs) => {
    let currentJobs = initialJobs;
    setSyncJobs(currentJobs);
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (
        currentJobs.length > 0 &&
        currentJobs.every((job) => TERMINAL_SYNC_STATUSES.has(job.status))
      ) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const response = await api.get("/amazon/sync/jobs", {
        params: {
          job_ids: currentJobs.map((job) => job.id).join(","),
        },
      });
      currentJobs = response.data || [];
      setSyncJobs(currentJobs);
    }
    return currentJobs;
  };

  const syncAllAmazonData = async () => {
    setBusy("sync-all");
    setMessage("");
    setError("");
    try {
      const response = await api.post("/amazon/sync/all");
      const initialJobs = response.data?.jobs || [];
      setSyncJobs(initialJobs);
      setMessage(
        `${response.data?.queued_count || 0} Amazon synchronization job${
          response.data?.queued_count === 1 ? "" : "s"
        } queued.`
      );
      const finalJobs = await pollAllSyncJobs(initialJobs);
      const failedJobs = finalJobs.filter(
        (job) => job.status !== "Completed"
      );
      if (failedJobs.length) {
        setError(
          `Amazon synchronization finished with ${failedJobs.length} area${
            failedJobs.length === 1 ? "" : "s"
          } requiring attention.`
        );
        setMessage("");
      } else {
        setMessage(
          "All Amazon data synchronized: products, inventory, orders, inbound shipments, finances, payouts, and balance."
        );
        await loadSettings({ quiet: true });
      }
    } catch (syncError) {
      setError(
        responseError(syncError, "Amazon data synchronization could not be started.")
      );
    } finally {
      setBusy("");
    }
  };

  const saveAutoSyncSettings = async () => {
    setBusy("auto-sync");
    setMessage("");
    setError("");
    try {
      const response = await api.patch("/amazon/settings/auto-sync", autoSyncForm);
      applySettings(response.data);
      setMessage(
        response.data?.auto_sync_enabled
          ? `Automatic Amazon sync set to every ${response.data.auto_sync_interval_minutes} minutes.`
          : "Automatic Amazon sync turned off."
      );
    } catch (saveError) {
      setError(
        responseError(saveError, "Automatic sync settings could not be saved.")
      );
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    const confirmed = await confirmDialog({
      title: "Disconnect Amazon?",
      message:
        "Automatic Amazon work will remain disabled. Historical Amazon records and logs will be preserved.",
      tone: "warning",
      confirmText: "Disconnect",
    });
    if (!confirmed) return;
    setBusy("disconnect");
    setMessage("");
    setError("");
    try {
      const response = await api.post("/amazon/settings/disconnect", {
        confirm: true,
      });
      applySettings(response.data);
      setMessage("Amazon connection disabled. Historical records were preserved.");
    } catch (disconnectError) {
      setError(
        responseError(disconnectError, "Amazon could not be disconnected.")
      );
    } finally {
      setBusy("");
    }
  };

  const clearCredentials = async () => {
    const confirmed = await confirmDialog({
      title: "Clear Amazon credentials?",
      message:
        "This permanently removes the encrypted client credentials, seller identifier, app ID, and refresh token. Historical business records remain.",
      detail: "You will need to enter every credential again before reconnecting.",
      tone: "danger",
      confirmText: "Clear credentials",
    });
    if (!confirmed) return;
    setBusy("clear");
    setMessage("");
    setError("");
    try {
      const response = await api.post("/amazon/settings/clear-credentials", {
        confirm: true,
      });
      applySettings(response.data);
      setEditing(true);
      setMessage("Encrypted Amazon credentials cleared.");
    } catch (clearError) {
      setError(
        responseError(clearError, "Amazon credentials could not be cleared.")
      );
    } finally {
      setBusy("");
    }
  };

  const beginReauthorization = () => {
    setEditing(true);
    setReauthorizing(true);
    setMessage(
      "Enter the new self-authorization refresh token, then save and test the connection."
    );
    window.setTimeout(() => refreshTokenRef.current?.focus(), 0);
  };

  const connectionFacts = useMemo(
    () => [
      ["Account", settings?.account_name || "Not configured"],
      ["Marketplace", settings?.marketplace_id || "Not configured"],
      ["Region", settings?.region || "Not configured"],
      ["Endpoint", settings?.endpoint || "Not configured"],
      ["Currency", settings?.currency || "Not configured"],
      ["Last test", formatDateTime(settings?.last_connection_test)],
      [
        "Last successful connection",
        formatDateTime(settings?.last_successful_connection),
      ],
      ["Last failed connection", formatDateTime(settings?.last_failed_connection)],
      ["Authorization date", formatDateTime(settings?.authorization_date)],
      [
        "Secret rotation due",
        formatDateTime(settings?.lwa_secret_rotation_due_date),
      ],
    ],
    [settings]
  );
  const rotationWarning = getRotationWarning(
    settings?.lwa_secret_rotation_due_date,
    rotationReferenceTime
  );
  const diagnosticChecks = diagnostics?.checks || [];
  const failedDiagnosticCount = diagnosticChecks.filter((check) =>
    ["failed", "warning"].includes(check.status)
  ).length;
  const completedSyncJobs = syncJobs.filter((job) =>
    TERMINAL_SYNC_STATUSES.has(job.status)
  ).length;
  const syncProgress = syncJobs.length
    ? Math.round((completedSyncJobs / syncJobs.length) * 100)
    : 0;

  if (!isAdmin) {
    return (
      <div className="amazon-settings-page">
        <section className="amazon-access-denied">
          <span>Administrator access required</span>
          <h1>Amazon Seller Central settings</h1>
          <p>Only ERP administrators can view or change Amazon credentials.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="amazon-settings-page">
      <header className="amazon-settings-header">
        <div>
          <span className="amazon-eyebrow">Settings · Integrations</span>
          <h1>Amazon Seller Central</h1>
          <p>
            Secure connection settings for the private Hisbenew SP-API
            application. FBA synchronization remains off until a successful
            connection test.
          </p>
        </div>
        <div className="amazon-header-actions">
          <button
            className="amazon-primary-button"
            disabled={
              Boolean(busy) ||
              settings?.connection_status !== "Connected"
            }
            onClick={syncAllAmazonData}
            type="button"
          >
            {busy === "sync-all"
              ? `Syncing ${completedSyncJobs} of ${syncJobs.length || 6}…`
              : "Sync all Amazon data"}
          </button>
          {settings?.id && !editing && (
            <button
              className="amazon-secondary-button"
              onClick={() => setEditing(true)}
              type="button"
            >
              Edit settings
            </button>
          )}
          <span
            className={`amazon-status-pill ${statusTone(
              settings?.connection_status
            )}`}
          >
            <i aria-hidden="true" />
            {settings?.connection_status || "Missing Credentials"}
          </span>
        </div>
      </header>

      <main className="amazon-settings-content">
        {loading ? (
          <section className="amazon-loading-card">Loading Amazon settings…</section>
        ) : (
          <>
            {!settings?.encryption_key_configured && (
              <section className="amazon-notice is-warning" role="alert">
                <strong>Credential encryption key required</strong>
                <p>
                  Set <code>AMAZON_CREDENTIALS_ENCRYPTION_KEY</code> in the
                  server environment before saving credentials. Docker VPS
                  installs should set it in the root <code>.env</code>; local
                  runs can use <code>backend/.env</code>. The key never belongs
                  in the browser or source control.
                </p>
              </section>
            )}

            {message && (
              <section className="amazon-notice is-success" role="status">
                {message}
              </section>
            )}
            {error && (
              <section className="amazon-notice is-error" role="alert">
                {error}
              </section>
            )}
            {rotationWarning && (
              <section className="amazon-notice is-warning" role="alert">
                <strong>Secret rotation reminder</strong>
                <p>{rotationWarning}</p>
              </section>
            )}

            {settings?.id && (
              <section className="amazon-auto-sync-panel">
                <div className="amazon-section-heading">
                  <div>
                    <span className="amazon-eyebrow">Automation</span>
                    <h2>Automatic Amazon sync</h2>
                  </div>
                  <span
                    className={`amazon-auto-sync-status ${
                      autoSyncForm.enabled ? "is-on" : ""
                    }`}
                  >
                    {autoSyncForm.enabled ? "On" : "Off"}
                  </span>
                </div>

                <div className="amazon-auto-sync-controls">
                  <label className="amazon-auto-sync-toggle">
                    <input
                      checked={autoSyncForm.enabled}
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        setAutoSyncForm((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>Enable automatic full sync</span>
                  </label>
                  <label className="amazon-auto-sync-interval">
                    <span>Interval</span>
                    <select
                      disabled={Boolean(busy) || !autoSyncForm.enabled}
                      onChange={(event) =>
                        setAutoSyncForm((current) => ({
                          ...current,
                          interval_minutes: Number(event.target.value),
                        }))
                      }
                      value={autoSyncForm.interval_minutes}
                    >
                      <option value="5">5 minutes</option>
                      <option value="15">15 minutes — recommended</option>
                      <option value="30">30 minutes</option>
                      <option value="60">60 minutes</option>
                    </select>
                  </label>
                  <button
                    className="amazon-primary-button"
                    disabled={Boolean(busy)}
                    onClick={saveAutoSyncSettings}
                    type="button"
                  >
                    {busy === "auto-sync" ? "Saving…" : "Save schedule"}
                  </button>
                </div>

                <div className="amazon-auto-sync-facts">
                  <div>
                    <span>Last automatic run</span>
                    <strong>
                      {formatDateTime(settings.auto_sync_last_finished_at)}
                    </strong>
                  </div>
                  <div>
                    <span>Next full sync</span>
                    <strong>
                      {autoSyncForm.enabled
                        ? formatDateTime(settings.auto_sync_next_run_at)
                        : "Turned off"}
                    </strong>
                  </div>
                  <div>
                    <span>Order checks</span>
                    <strong>Every 2 minutes</strong>
                  </div>
                </div>

                {settings.auto_sync_last_error && (
                  <div className="amazon-auto-sync-error" role="alert">
                    {settings.auto_sync_last_error}
                  </div>
                )}
              </section>
            )}

            {syncJobs.length > 0 && (
              <section className="amazon-sync-all-panel" aria-live="polite">
                <div className="amazon-section-heading">
                  <div>
                    <span className="amazon-eyebrow">Unified synchronization</span>
                    <h2>Amazon data sync</h2>
                  </div>
                  <strong>
                    {completedSyncJobs} / {syncJobs.length} complete
                  </strong>
                </div>
                <div
                  aria-label={`${syncProgress}% complete`}
                  className="amazon-sync-progress"
                  role="progressbar"
                  aria-valuemax="100"
                  aria-valuemin="0"
                  aria-valuenow={syncProgress}
                >
                  <span style={{ width: `${syncProgress}%` }} />
                </div>
                <div className="amazon-sync-job-grid">
                  {syncJobs.map((job) => (
                    <article key={job.id}>
                      <span>{job.job_type}</span>
                      <strong className={syncJobTone(job.status)}>
                        {job.status}
                      </strong>
                      {job.error_message && <small>{job.error_message}</small>}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="amazon-diagnostics-panel">
              <div className="amazon-section-heading">
                <div>
                  <span className="amazon-eyebrow">VPS diagnostics</span>
                  <h2>Amazon connection checks</h2>
                  <p>
                    {!diagnosticChecks.length
                      ? "Refresh checks to inspect this backend."
                      : failedDiagnosticCount
                        ? `${failedDiagnosticCount} check${failedDiagnosticCount === 1 ? "" : "s"} need attention on this backend.`
                        : "Backend settings and Amazon network checks are clear."}
                  </p>
                </div>
                <button
                  className="amazon-secondary-button"
                  disabled={diagnosticsLoading}
                  onClick={() => loadDiagnostics()}
                  type="button"
                >
                  {diagnosticsLoading ? "Checking..." : "Refresh checks"}
                </button>
              </div>
              {diagnosticsError ? (
                <div className="amazon-safe-error" role="alert">
                  <strong>Diagnostics unavailable</strong>
                  <p>{diagnosticsError}</p>
                </div>
              ) : null}
              <div className="amazon-diagnostics-grid">
                {diagnosticChecks.map((check) => (
                  <article className={diagnosticTone(check.status)} key={check.key}>
                    <span>{check.label}</span>
                    <strong>{diagnosticLabel(check.status)}</strong>
                    <small>{check.detail}</small>
                    {check.http_status || check.duration_ms ? (
                      <em>
                        {check.http_status ? `HTTP ${check.http_status}` : "No HTTP status"}
                        {check.duration_ms ? ` | ${check.duration_ms} ms` : ""}
                      </em>
                    ) : null}
                  </article>
                ))}
                {!diagnosticsLoading && diagnosticChecks.length === 0 ? (
                  <article className="is-skipped">
                    <span>Diagnostics</span>
                    <strong>Not checked</strong>
                    <small>Refresh checks to inspect this backend.</small>
                  </article>
                ) : null}
              </div>
            </section>
            <section className="amazon-overview-grid">
              <article className="amazon-connection-card">
                <div className="amazon-card-heading">
                  <div>
                    <span className="amazon-eyebrow">Connection</span>
                    <h2>SP-API status</h2>
                  </div>
                  <span
                    className={`amazon-status-pill ${statusTone(
                      settings?.connection_status
                    )}`}
                  >
                    <i aria-hidden="true" />
                    {settings?.connection_status || "Missing Credentials"}
                  </span>
                </div>
                <div className="amazon-facts-grid">
                  {connectionFacts.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                {settings?.sanitized_last_error && (
                  <div className="amazon-safe-error">
                    <strong>Last safe error</strong>
                    <p>{settings.sanitized_last_error}</p>
                  </div>
                )}
              </article>

              <article className="amazon-security-card">
                <div className="amazon-card-heading">
                  <div>
                    <span className="amazon-eyebrow">Security</span>
                    <h2>Saved credential state</h2>
                  </div>
                </div>
                <div className="amazon-credential-grid">
                  <CredentialState
                    label="Client identifier"
                    masked={settings?.client_identifier_masked}
                    saved={settings?.client_identifier_saved}
                  />
                  <CredentialState
                    label="Client secret"
                    saved={settings?.client_secret_saved}
                  />
                  <CredentialState
                    label="Amazon app ID"
                    masked={settings?.app_id_masked}
                    saved={settings?.app_id_saved}
                  />
                  <CredentialState
                    label="Refresh token"
                    saved={settings?.refresh_token_saved}
                  />
                  <CredentialState
                    label="Seller ID"
                    masked={settings?.seller_id_masked}
                    saved={settings?.seller_id_saved}
                  />
                  <CredentialState
                    label="Encryption key"
                    saved={settings?.encryption_key_configured}
                  />
                </div>
              </article>
            </section>

            <form className="amazon-settings-form" onSubmit={saveSettings}>
              <div className="amazon-section-heading">
                <div>
                  <span className="amazon-eyebrow">
                    {reauthorizing ? "Reauthorization" : "Account configuration"}
                  </span>
                  <h2>
                    {reauthorizing
                      ? "Update the refresh token"
                      : "Private application settings"}
                  </h2>
                  <p>
                    Saved credential values are never loaded back into these
                    fields. Leave a credential blank to preserve its encrypted
                    value.
                  </p>
                </div>
                <label className="amazon-active-switch">
                  <input
                    checked={form.is_active}
                    disabled={!editing}
                    onChange={(event) =>
                      updateField("is_active", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>{form.is_active ? "Active" : "Inactive"}</span>
                </label>
              </div>

              <fieldset disabled={!editing || Boolean(busy)}>
                <div className="amazon-form-grid">
                  <label>
                    Account name
                    <input
                      maxLength={160}
                      onChange={(event) =>
                        updateField("account_name", event.target.value)
                      }
                      required
                      value={form.account_name}
                    />
                  </label>
                  <label>
                    Marketplace ID
                    <input
                      autoComplete="off"
                      maxLength={64}
                      onChange={(event) =>
                        updateField("marketplace_id", event.target.value)
                      }
                      required
                      value={form.marketplace_id}
                    />
                  </label>
                  <label>
                    SP-API region
                    <select
                      onChange={(event) =>
                        updateField("region", event.target.value)
                      }
                      value={form.region}
                    >
                      <option value="NA">North America (NA)</option>
                      <option value="EU">Europe (EU)</option>
                      <option value="FE">Far East (FE)</option>
                    </select>
                  </label>
                  <label>
                    Currency
                    <input
                      autoComplete="off"
                      maxLength={3}
                      minLength={3}
                      onChange={(event) =>
                        updateField("currency", event.target.value.toUpperCase())
                      }
                      required
                      value={form.currency}
                    />
                  </label>
                  <label className="is-wide">
                    SP-API endpoint
                    <input readOnly value={form.endpoint} />
                    <small>Locked to the selected official Amazon region.</small>
                  </label>
                </div>

                <div className="amazon-form-divider">
                  <span>Credentials</span>
                  <p>
                    Enter only new or rotated values. Existing values remain
                    encrypted when these fields are blank.
                  </p>
                </div>

                <div className="amazon-form-grid">
                  <label>
                    Client identifier
                    <input
                      autoComplete="off"
                      onChange={(event) =>
                        updateField("client_identifier", event.target.value)
                      }
                      placeholder={
                        settings?.client_identifier_saved
                          ? `Saved: ${
                              settings.client_identifier_masked ||
                              "encrypted value"
                            }`
                          : "Enter LWA client identifier"
                      }
                      value={form.client_identifier}
                    />
                  </label>
                  <label>
                    Amazon app ID
                    <input
                      autoComplete="off"
                      onChange={(event) =>
                        updateField("app_id", event.target.value)
                      }
                      placeholder={
                        settings?.app_id_saved
                          ? `Saved: ${settings.app_id_masked || "masked value"}`
                          : "Enter Amazon app ID"
                      }
                      value={form.app_id}
                    />
                  </label>
                  <label>
                    Client secret
                    <div className="amazon-secret-input">
                      <input
                        autoComplete="new-password"
                        onChange={(event) =>
                          updateField("client_secret", event.target.value)
                        }
                        placeholder={
                          settings?.client_secret_saved
                            ? "Saved securely · blank preserves current secret"
                            : "Enter LWA client secret"
                        }
                        type={showClientSecret ? "text" : "password"}
                        value={form.client_secret}
                      />
                      <button
                        disabled={!form.client_secret}
                        onClick={() => setShowClientSecret((current) => !current)}
                        type="button"
                      >
                        {showClientSecret ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                  <label>
                    Seller ID / merchant token
                    <input
                      autoComplete="off"
                      onChange={(event) =>
                        updateField("seller_id", event.target.value)
                      }
                      placeholder={
                        settings?.seller_id_saved
                          ? `Saved: ${
                              settings.seller_id_masked || "encrypted value"
                            }`
                          : "Enter seller ID"
                      }
                      value={form.seller_id}
                    />
                  </label>
                  <label className="is-wide">
                    Refresh token / self-authorization token
                    <div className="amazon-secret-input">
                      <input
                        autoComplete="new-password"
                        onChange={(event) =>
                          updateField("refresh_token", event.target.value)
                        }
                        placeholder={
                          settings?.refresh_token_saved
                            ? "Saved securely · blank preserves current token"
                            : "Enter self-authorization refresh token"
                        }
                        ref={refreshTokenRef}
                        type={showRefreshToken ? "text" : "password"}
                        value={form.refresh_token}
                      />
                      <button
                        disabled={!form.refresh_token}
                        onClick={() => setShowRefreshToken((current) => !current)}
                        type="button"
                      >
                        {showRefreshToken ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                  <label>
                    LWA secret rotation due date
                    <input
                      onChange={(event) =>
                        updateField(
                          "lwa_secret_rotation_due_date",
                          event.target.value
                        )
                      }
                      type="date"
                      value={form.lwa_secret_rotation_due_date}
                    />
                  </label>
                </div>
              </fieldset>

              <div className="amazon-form-actions">
                {editing ? (
                  <>
                    <button
                      className="amazon-primary-button"
                      disabled={Boolean(busy)}
                      type="submit"
                    >
                      {busy === "save" ? "Saving securely…" : "Save settings"}
                    </button>
                    {settings?.id && (
                      <button
                        className="amazon-secondary-button"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          applySettings(settings);
                          setEditing(false);
                          setReauthorizing(false);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    className="amazon-secondary-button"
                    onClick={() => setEditing(true)}
                    type="button"
                  >
                    Edit settings
                  </button>
                )}
              </div>
            </form>

            <section className="amazon-actions-panel">
              <div className="amazon-section-heading">
                <div>
                  <span className="amazon-eyebrow">Connection actions</span>
                  <h2>Authorize and control access</h2>
                  <p>
                    Connection tests exchange the saved refresh token for a
                    short-lived access token, then call the non-PII Sellers API.
                  </p>
                </div>
              </div>
              <div className="amazon-action-grid">
                <button
                  className="amazon-primary-button"
                  disabled={Boolean(busy) || !settings?.credentials_complete}
                  onClick={testConnection}
                  type="button"
                >
                  {busy === "test" ? "Testing connection…" : "Test connection"}
                </button>
                <button
                  className="amazon-secondary-button"
                  disabled={Boolean(busy)}
                  onClick={beginReauthorization}
                  type="button"
                >
                  Reauthorize account
                </button>
                <button
                  className="amazon-secondary-button"
                  disabled={Boolean(busy) || !settings?.id}
                  onClick={disconnect}
                  type="button"
                >
                  {busy === "disconnect" ? "Disconnecting…" : "Disconnect Amazon"}
                </button>
                <button
                  className="amazon-danger-button"
                  disabled={Boolean(busy) || !settings?.id}
                  onClick={clearCredentials}
                  type="button"
                >
                  {busy === "clear" ? "Clearing…" : "Clear credentials"}
                </button>
              </div>
              <p className="amazon-security-footnote">
                Access tokens are held only in short-lived backend memory.
                Credentials, authorization headers, and customer information are
                never returned by these APIs or written to Amazon logs.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default AmazonSettings;
