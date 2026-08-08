import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import "./Deployment.css";

const ACTION_LABELS = {
  frontend_build: "Build frontend",
  trigger_frontend_deploy: "Trigger frontend deploy",
  trigger_backend_deploy: "Trigger backend deploy",
  local_backend_deploy: "Run VPS deploy script",
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const shortSha = (value) => String(value || "").slice(0, 12) || "-";

const statusLabel = (ok, good = "Ready", bad = "Needs setup") =>
  ok ? good : bad;

function StatusPill({ ok, warning = false, children }) {
  const className = ok
    ? "deployment-pill is-good"
    : warning
      ? "deployment-pill is-warning"
      : "deployment-pill is-bad";
  return <span className={className}>{children}</span>;
}

function MetricCard({ label, value, detail, ok, warning }) {
  return (
    <article className="deployment-metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <StatusPill ok={ok} warning={warning}>
        {ok ? "OK" : warning ? "Check" : "Issue"}
      </StatusPill>
      {detail && <p>{detail}</p>}
    </article>
  );
}

function WorkflowRow({ title, workflow }) {
  return (
    <article className="deployment-workflow-row">
      <div>
        <strong>{title}</strong>
        <span>{workflow?.path || "-"}</span>
      </div>
      <StatusPill ok={workflow?.local_exists} warning={!workflow?.local_exists}>
        {workflow?.local_exists ? "Local file" : "Missing local"}
      </StatusPill>
      <StatusPill ok={workflow?.tracked_on_origin_main} warning={workflow?.local_exists}>
        {workflow?.tracked_on_origin_main ? "On GitHub main" : "Not on main"}
      </StatusPill>
    </article>
  );
}

function ActionButton({ action, disabled, busy, onRun }) {
  return (
    <button disabled={disabled || busy} onClick={() => onRun(action)} type="button">
      {busy ? "Working..." : ACTION_LABELS[action]}
    </button>
  );
}

function Deployment() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [actionResult, setActionResult] = useState(null);

  const loadStatus = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/deployment/status");
      setStatus(response.data || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.detail ||
          "Deployment status could not be loaded."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const runAction = async (action) => {
    if (
      action === "local_backend_deploy" &&
      !window.confirm("Run the local VPS backend deploy script from ERP?")
    ) {
      return;
    }

    setBusyAction(action);
    setError("");
    setMessage("");
    setActionResult(null);
    try {
      const response = await api.post("/admin/deployment/actions", { action });
      const payload = response.data || {};
      setActionResult(payload);
      if (payload.status) setStatus(payload.status);
      if (payload.ok) {
        setMessage(payload.message || "Deployment action completed.");
      } else {
        setError(payload.message || "Deployment action did not complete.");
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.detail ||
          "Deployment action could not be started."
      );
    } finally {
      setBusyAction("");
    }
  };

  const repo = status?.repository || {};
  const workflows = status?.workflows || {};
  const capabilities = status?.capabilities || {};
  const liveFrontend = status?.live_frontend || {};
  const localFrontend = status?.local_frontend || {};
  const health = status?.health || {};
  const githubActions = status?.github_actions || {};

  const liveBundleMatches = useMemo(
    () =>
      Boolean(
        liveFrontend.asset &&
          localFrontend.index_asset &&
          liveFrontend.asset === localFrontend.index_asset
      ),
    [liveFrontend.asset, localFrontend.index_asset]
  );

  const workflowRuns = githubActions.runs || [];

  return (
    <div className="deployment-page">
      <header className="deployment-hero">
        <div>
          <span className="deployment-eyebrow">Production control</span>
          <h1>GitHub and deployment</h1>
          <p>
            Track GitHub, cPanel frontend publishing, backend VPS health, and
            the deployment connections needed for hisbenew.com.
          </p>
        </div>
        <div className="deployment-hero-actions">
          <button
            disabled={loading || refreshing || Boolean(busyAction)}
            onClick={() => loadStatus({ quiet: true })}
            type="button"
          >
            {refreshing ? "Refreshing..." : "Refresh status"}
          </button>
          <a href="https://github.com/umerayaz334-ux/Hisbenew-Industries-ERP/actions" rel="noreferrer" target="_blank">
            GitHub Actions
          </a>
        </div>
      </header>

      {error && (
        <div className="deployment-alert is-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="deployment-alert is-success" role="status">
          {message}
        </div>
      )}

      {loading && !status ? (
        <section className="deployment-loading">Loading deployment status...</section>
      ) : (
        <>
          <section className="deployment-status-grid">
            <MetricCard
              detail={`${repo.branch || "-"} at ${shortSha(repo.head)} - ${repo.message || "No commit message"}`}
              label="Local repository"
              ok={repo.clean}
              warning={!repo.clean}
              value={repo.clean ? "Clean" : `${repo.status_counts?.changed || 0} local changes`}
            />
            <MetricCard
              detail={`Live: ${liveFrontend.asset || "-"} | Local: ${localFrontend.index_asset || "-"}`}
              label="hisbenew.com bundle"
              ok={liveBundleMatches}
              value={liveBundleMatches ? "Current" : "Not current"}
            />
            <MetricCard
              detail={health.public_api?.url || "https://api.hisbenew.com/health"}
              label="Public API"
              ok={health.public_api?.ok}
              value={health.public_api?.ok ? "Reachable" : "Not reachable"}
            />
            <MetricCard
              detail={githubActions.repository || repo.github_repository || "Repository not detected"}
              label="GitHub control"
              ok={capabilities.trigger_github_workflows}
              warning={!capabilities.trigger_github_workflows}
              value={
                capabilities.trigger_github_workflows
                  ? "Token ready"
                  : "Token needed"
              }
            />
          </section>

          <section className="deployment-grid">
            <article className="deployment-panel deployment-panel-wide">
              <div className="deployment-panel-heading">
                <div>
                  <span className="deployment-eyebrow">Workflow bridge</span>
                  <h2>Automatic deployment setup</h2>
                </div>
                <StatusPill ok={workflows.frontend?.tracked_on_origin_main} warning>
                  {statusLabel(workflows.frontend?.tracked_on_origin_main, "Frontend active", "Frontend pending")}
                </StatusPill>
              </div>
              <div className="deployment-workflow-list">
                <WorkflowRow title="Frontend to cPanel" workflow={workflows.frontend} />
                <WorkflowRow title="Backend to Windows VPS" workflow={workflows.backend} />
              </div>
              <div className="deployment-checklist">
                {(status?.checklist || []).map((item) => (
                  <article key={item.key}>
                    <StatusPill ok={item.ok} warning={!item.ok}>
                      {item.ok ? "Done" : "Needed"}
                    </StatusPill>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.help}</p>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="deployment-panel">
              <div className="deployment-panel-heading">
                <div>
                  <span className="deployment-eyebrow">Safe actions</span>
                  <h2>Commands</h2>
                </div>
              </div>
              <div className="deployment-action-list">
                <ActionButton
                  action="frontend_build"
                  busy={busyAction === "frontend_build"}
                  disabled={!capabilities.frontend_build}
                  onRun={runAction}
                />
                <ActionButton
                  action="trigger_frontend_deploy"
                  busy={busyAction === "trigger_frontend_deploy"}
                  disabled={!capabilities.trigger_github_workflows || !workflows.frontend?.tracked_on_origin_main}
                  onRun={runAction}
                />
                <ActionButton
                  action="trigger_backend_deploy"
                  busy={busyAction === "trigger_backend_deploy"}
                  disabled={!capabilities.trigger_github_workflows || !workflows.backend?.tracked_on_origin_main}
                  onRun={runAction}
                />
                <ActionButton
                  action="local_backend_deploy"
                  busy={busyAction === "local_backend_deploy"}
                  disabled={!capabilities.local_backend_deploy}
                  onRun={runAction}
                />
              </div>
              <p className="deployment-panel-note">
                GitHub trigger buttons need GITHUB_DEPLOY_TOKEN on the backend
                server. The local VPS deploy button needs
                ERP_ENABLE_LOCAL_DEPLOY_ACTIONS=true.
              </p>
            </article>

            <article className="deployment-panel">
              <div className="deployment-panel-heading">
                <div>
                  <span className="deployment-eyebrow">Connections</span>
                  <h2>Server health</h2>
                </div>
              </div>
              <dl className="deployment-detail-list">
                <div>
                  <dt>Live frontend</dt>
                  <dd>{liveFrontend.status_code || "-"} in {liveFrontend.elapsed_ms || 0} ms</dd>
                </div>
                <div>
                  <dt>Local API</dt>
                  <dd>{health.local_api?.ok ? "Reachable" : "Not reachable"}</dd>
                </div>
                <div>
                  <dt>Public API</dt>
                  <dd>{health.public_api?.ok ? "Reachable" : "Not reachable"}</dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd>{formatDateTime(status?.generated_at)}</dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="deployment-panel deployment-panel-full">
            <div className="deployment-panel-heading">
              <div>
                <span className="deployment-eyebrow">GitHub</span>
                <h2>Workflow runs</h2>
              </div>
              <StatusPill ok={githubActions.token_configured} warning>
                {githubActions.token_configured ? "Token configured" : "Token not configured"}
              </StatusPill>
            </div>
            {githubActions.error && (
              <p className="deployment-panel-note">{githubActions.error}</p>
            )}
            {workflowRuns.length ? (
              <div className="deployment-run-list">
                {workflowRuns.map((run) => (
                  <article key={`${run.name}-${run.head_sha}-${run.created_at}`}>
                    <div>
                      <strong>{run.name || "Workflow"}</strong>
                      <span>{shortSha(run.head_sha)} on {run.head_branch || "-"}</span>
                    </div>
                    <span>{run.status || "-"}</span>
                    <span>{run.conclusion || "running"}</span>
                    <a href={run.html_url} rel="noreferrer" target="_blank">
                      Open
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <p className="deployment-empty">
                Add GITHUB_DEPLOY_TOKEN on the backend server to show workflow
                runs inside ERP.
              </p>
            )}
          </section>

          {actionResult && (
            <section className="deployment-panel deployment-panel-full">
              <div className="deployment-panel-heading">
                <div>
                  <span className="deployment-eyebrow">Last action</span>
                  <h2>{ACTION_LABELS[actionResult.action] || actionResult.action}</h2>
                </div>
                <StatusPill ok={actionResult.ok} warning={!actionResult.ok}>
                  {actionResult.ok ? "Completed" : "Failed"}
                </StatusPill>
              </div>
              <pre className="deployment-command-output">
                {[
                  actionResult.message,
                  actionResult.result?.command,
                  actionResult.result?.stdout,
                  actionResult.result?.stderr,
                ]
                  .filter(Boolean)
                  .join("\n\n")}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default Deployment;
