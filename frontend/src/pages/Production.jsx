import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./Production.css";

const EMPTY_FORM = {
  batch_no: "",
  product_id: "",
  batch_quantity: "",
  priority: "Normal",
  due_date: "",
  notes: "",
  include_optional_steps: false,
};

const DELAY_REASONS = [
  "Machine issue",
  "Worker unavailable",
  "Material shortage",
  "Electricity issue",
  "Quality issue",
  "Priority changed",
  "Other",
];

function Production() {
  const [summary, setSummary] = useState(null);
  const [planning, setPlanning] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [taskInputs, setTaskInputs] = useState({});
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryResponse, planningResponse, workersResponse, batchesResponse] =
        await Promise.all([
          api.get("/production/summary"),
          api.get("/production/planning"),
          api.get("/workers"),
          api.get("/production/batches"),
        ]);
      setSummary(summaryResponse.data);
      setPlanning(planningResponse.data);
      setWorkers((workersResponse.data || []).filter((worker) => worker.is_active));
      setBatches(batchesResponse.data || []);
      setForm((current) => ({
        ...current,
        batch_no: current.batch_no || planningResponse.data.next_batch_no || "",
      }));
    } catch (loadError) {
      console.error("Production loading error:", loadError);
      setError("Unable to load the production control board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      await loadData();
    };
    load();
  }, [loadData]);

  const productionPlans = planning?.products || [];
  const selectedPlan = productionPlans.find(
    (product) => String(product.product_id) === String(form.product_id)
  );

  const attentionBatches = useMemo(
    () =>
      batches.filter(
        (batch) =>
          batch.status !== "Completed" &&
          (batch.due_status === "Overdue" ||
            batch.late_tasks > 0 ||
            batch.unassigned_tasks > 0)
      ),
    [batches]
  );

  const filteredBatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return batches.filter((batch) => {
      const matchesSearch =
        !query ||
        `${batch.batch_no} ${batch.article_no} ${batch.product_name}`
          .toLowerCase()
          .includes(query);
      let matchesStatus = true;
      if (statusFilter === "attention") {
        matchesStatus = attentionBatches.some((item) => item.id === batch.id);
      } else if (statusFilter === "active") {
        matchesStatus = batch.status !== "Completed";
      } else if (statusFilter === "completed") {
        matchesStatus = batch.status === "Completed";
      }
      return matchesSearch && matchesStatus;
    });
  }, [attentionBatches, batches, search, statusFilter]);

  const handleFormChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openBatchForm = (plan = null) => {
    setForm({
      ...EMPTY_FORM,
      batch_no: planning?.next_batch_no || "",
      product_id: plan ? String(plan.product_id) : "",
      batch_quantity:
        plan && plan.recommended_quantity > 0
          ? String(plan.recommended_quantity)
          : "",
    });
    setError("");
    setShowBatchForm(true);
  };

  const closeBatchForm = () => {
    setShowBatchForm(false);
    setError("");
  };

  const createBatch = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.product_id || Number(form.batch_quantity) <= 0) {
      setError("Select a product and enter a valid batch quantity.");
      return;
    }
    if (!selectedPlan?.workflow_ready) {
      setError("This article needs an active manufacturing workflow first.");
      return;
    }

    setBusyAction("create");
    try {
      await api.post("/production/batches", {
        batch_no: form.batch_no.trim() || null,
        product_id: Number(form.product_id),
        batch_quantity: Number(form.batch_quantity),
        priority: form.priority,
        due_date: form.due_date
          ? new Date(form.due_date).toISOString()
          : null,
        notes: form.notes.trim() || null,
        include_optional_steps: form.include_optional_steps,
      });
      setNotice("Production batch created and its task route generated.");
      closeBatchForm();
      setForm(EMPTY_FORM);
      await loadData();
    } catch (createError) {
      console.error("Batch create error:", createError);
      setError(createError.response?.data?.detail || "Unable to create this batch.");
    } finally {
      setBusyAction("");
    }
  };

  const handleTaskInput = (taskId, field, value) => {
    setTaskInputs((current) => ({
      ...current,
      [taskId]: { ...current[taskId], [field]: value },
    }));
  };

  const runAction = async (key, request, successMessage = "") => {
    setBusyAction(key);
    setError("");
    try {
      const response = await request();
      if (successMessage) setNotice(successMessage);
      await loadData();
      return response;
    } catch (actionError) {
      console.error("Production action error:", actionError);
      setError(actionError.response?.data?.detail || "Unable to complete this action.");
      return null;
    } finally {
      setBusyAction("");
    }
  };

  const assignWorker = async (task) => {
    const workerId = taskInputs[task.id]?.worker_id ?? task.worker_id ?? "";
    const rateValue = taskInputs[task.id]?.rate_per_piece ?? task.rate_per_piece ?? "";
    await runAction(
      `assign-${task.id}`,
      () =>
        api.patch(`/production/tasks/${task.id}/assign`, {
          worker_id: workerId ? Number(workerId) : null,
          rate_per_piece:
            rateValue === "" || rateValue === null || rateValue === undefined
              ? null
              : Number(rateValue),
        }),
      workerId ? "Worker assignment updated." : "Worker removed from task."
    );
  };

  const startTask = async (task) => {
    await runAction(
      `start-${task.id}`,
      () => api.patch(`/production/tasks/${task.id}/start`),
      `${task.step_name} started.`
    );
  };

  const updateProgress = async (task) => {
    const value = taskInputs[task.id]?.completed_quantity;
    if (value === undefined || value === "") {
      setError("Enter the completed quantity before updating progress.");
      return;
    }
    const response = await runAction(
      `progress-${task.id}`,
      () =>
        api.patch(`/production/tasks/${task.id}/progress`, {
          completed_quantity: Number(value),
        }),
      "Production quantity updated."
    );
    if (response) {
      setTaskInputs((current) => ({
        ...current,
        [task.id]: { ...current[task.id], completed_quantity: "" },
      }));
    }
  };

  const completeTask = async (task) => {
    const completedQuantity = taskInputs[task.id]?.completed_quantity;
    const delayReason = taskInputs[task.id]?.delay_reason || "";
    const response = await runAction(
      `complete-${task.id}`,
      () =>
        api.patch(`/production/tasks/${task.id}/complete`, {
          completed_quantity:
            completedQuantity === undefined || completedQuantity === ""
              ? null
              : Number(completedQuantity),
          delay_reason: delayReason || null,
          verify: true,
        }),
      `${task.step_name} completed. The next operation is now ready.`
    );
    if (response) {
      setTaskInputs((current) => ({
        ...current,
        [task.id]: {
          ...current[task.id],
          completed_quantity: "",
          delay_reason: "",
        },
      }));
    }
  };

  const autoAssign = async (batch) => {
    const response = await runAction(
      `auto-${batch.id}`,
      () => api.post(`/production/batches/${batch.id}/auto-assign`)
    );
    if (response) {
      const unmatched = response.data.unmatched_steps || [];
      setNotice(
        unmatched.length
          ? `${response.data.assigned.length} tasks assigned. No role match for: ${unmatched.join(", ")}.`
          : `${response.data.assigned.length} tasks assigned by role and current workload.`
      );
    }
  };

  const updateBatchPriority = async (batch, priority) => {
    await runAction(
      `batch-${batch.id}`,
      () => api.patch(`/production/batches/${batch.id}`, { priority }),
      "Batch priority updated."
    );
  };

  const toggleBatch = (batchId) => {
    setExpandedBatches((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const formatDate = (value) => (value ? formatUtcLocal(value) : "Not set");
  const formatMinutes = (value) => {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours && remainder) return `${hours}h ${remainder}m`;
    if (hours) return `${hours}h`;
    return `${remainder}m`;
  };
  const statusClass = (status) =>
    `status ${String(status || "Pending").toLowerCase().replace(/\s+/g, "-")}`;
  const matchingWorkers = (task) => {
    const role = (task.worker_role || "").toLowerCase();
    return [...workers].sort((left, right) => {
      const leftMatch = role && (left.role || "").toLowerCase().includes(role);
      const rightMatch = role && (right.role || "").toLowerCase().includes(role);
      return Number(rightMatch) - Number(leftMatch) || left.name.localeCompare(right.name);
    });
  };

  return (
    <div className="production-page">
      <header className="production-header production-command-header">
        <div>
          <h1>Production</h1>
        </div>
        <div className="production-header-actions">
          <button className="production-create" onClick={() => openBatchForm()} type="button">
            New batch
          </button>
        </div>
      </header>

      {summary && (
        <section className="production-summary-grid" aria-label="Production summary">
          <article>
            <span>Active batches</span>
            <strong>{summary.pending_batches + summary.in_progress_batches}</strong>
            <p>{summary.in_progress_batches} currently moving</p>
          </article>
          <article>
            <span>Ready operations</span>
            <strong>{summary.ready_tasks}</strong>
            <p>available to start now</p>
          </article>
          <article className={summary.unassigned_tasks ? "warning" : ""}>
            <span>Unassigned work</span>
            <strong>{summary.unassigned_tasks}</strong>
            <p>needs worker ownership</p>
          </article>
          <article className={summary.late_tasks ? "danger" : ""}>
            <span>Late operations</span>
            <strong>{summary.late_tasks}</strong>
            <p>{summary.completing_today} expected today</p>
          </article>
          <article>
            <span>Completed batches</span>
            <strong>{summary.completed_batches}</strong>
            <p>stock posted to factory</p>
          </article>
        </section>
      )}

      {notice && (
        <div className="production-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} type="button">Dismiss</button>
        </div>
      )}
      {error && !showBatchForm && <div className="production-error">{error}</div>}

      {planning && (
        <section className="production-planning-card">
          <div className="production-section-heading">
            <div>
              <h2>What should enter production?</h2>
              <p>
                Recommendations consider available stock, reserved units,
                low-stock targets, and quantities already in active batches.
              </p>
            </div>
            <div className="production-planning-summary">
              <span><strong>{planning.products_needing_production}</strong> need production</span>
              <span><strong>{planning.products_missing_workflow}</strong> missing workflow</span>
              <span><strong>{planning.active_workers}</strong> active workers</span>
            </div>
          </div>

          <div className="production-plan-grid">
            {productionPlans
              .filter(
                (plan) =>
                  plan.recommended_quantity > 0 || !plan.workflow_ready
              )
              .slice(0, 6)
              .map((plan) => (
                <article
                  className={plan.workflow_ready ? "" : "workflow-missing"}
                  key={plan.product_id}
                >
                  <div className="production-plan-title">
                    <div>
                      <strong>{plan.article_no}</strong>
                      <span>{plan.product_name}</span>
                    </div>
                    <span className={plan.workflow_ready ? "is-ready" : "is-blocked"}>
                      {plan.workflow_ready
                        ? `${plan.workflow_step_count} steps`
                        : "Workflow missing"}
                    </span>
                  </div>
                  <div className="production-plan-facts">
                    <span><small>Available</small>{plan.available_stock}</span>
                    <span><small>Reserved</small>{plan.reserved_stock}</span>
                    <span><small>Already planned</small>{plan.active_batch_quantity}</span>
                  </div>
                  <div className="production-plan-recommendation">
                    <span>Recommended batch</span>
                    <strong>{plan.recommended_quantity}</strong>
                    <button
                      disabled={!plan.workflow_ready || plan.recommended_quantity <= 0}
                      onClick={() => openBatchForm(plan)}
                      type="button"
                    >
                      Plan batch
                    </button>
                  </div>
                </article>
              ))}
            {productionPlans.every(
              (plan) => plan.recommended_quantity === 0 && plan.workflow_ready
            ) && (
              <div className="empty-box">
                Stock coverage looks healthy and every article has a production route.
              </div>
            )}
          </div>
        </section>
      )}

      {attentionBatches.length > 0 && (
        <section className="production-attention">
          <div className="production-section-heading compact">
            <div>
              <h2>Action required</h2>
              <p>Resolve ownership and schedule risks before they become bottlenecks.</p>
            </div>
            <button onClick={() => setStatusFilter("attention")} type="button">
              Show all {attentionBatches.length}
            </button>
          </div>
          <div className="production-attention-list">
            {attentionBatches.slice(0, 4).map((batch) => (
              <button
                key={batch.id}
                onClick={() => {
                  setStatusFilter("attention");
                  setExpandedBatches((current) => new Set(current).add(batch.id));
                }}
                type="button"
              >
                <span>
                  <strong>{batch.batch_no}</strong>
                  <small>{batch.article_no} - {batch.current_step}</small>
                </span>
                <span>
                  {batch.due_status === "Overdue"
                    ? "Overdue"
                    : batch.late_tasks
                      ? `${batch.late_tasks} late`
                      : `${batch.unassigned_tasks} unassigned`}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="production-board">
        <div className="production-board-header">
          <div>
            <h2>Production batches</h2>
            <p>{filteredBatches.length} of {batches.length} batches shown</p>
          </div>
          <div className="production-board-controls">
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search batch or article"
              value={search}
            />
            <div className="production-filter-tabs">
              {["active", "attention", "completed", "all"].map((filter) => (
                <button
                  className={statusFilter === filter ? "is-active" : ""}
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="empty-box">Loading production board...</div>
        ) : filteredBatches.length === 0 ? (
          <div className="empty-box">
            No batches match this view. Create a new batch or change the filter.
          </div>
        ) : (
          <div className="batch-list">
            {filteredBatches.map((batch) => {
              const currentTask = batch.tasks.find(
                (task) => task.id === batch.current_task_id
              );
              const isExpanded = expandedBatches.has(batch.id);
              return (
                <article
                  className={`batch-card priority-${batch.priority.toLowerCase()}`}
                  key={batch.id}
                >
                  <div className="batch-top">
                    <div className="batch-identity">
                      <span className="batch-article">{batch.article_no}</span>
                      <h3>{batch.batch_no}</h3>
                      <p>{batch.product_name}</p>
                    </div>
                    <div className="batch-status-box">
                      <span className={statusClass(batch.status)}>{batch.status}</span>
                      <span className={`due-state ${batch.due_status.toLowerCase().replace(/\s+/g, "-")}`}>
                        {batch.due_status}
                      </span>
                    </div>
                  </div>

                  <div className="batch-overview">
                    <div className="batch-progress-block">
                      <div>
                        <span>Overall progress</span>
                        <strong>{batch.progress_percent}%</strong>
                      </div>
                      <div className="progress-bar">
                        <div style={{ width: `${Math.min(100, batch.progress_percent)}%` }} />
                      </div>
                      <small>
                        {batch.completed_tasks} of {batch.total_tasks} operations complete
                      </small>
                    </div>
                    <div className="batch-info-grid">
                      <div><span>Quantity</span><strong>{batch.batch_quantity}</strong></div>
                      <div><span>Current operation</span><strong>{batch.current_step}</strong></div>
                      <div><span>Due date</span><strong>{formatDate(batch.due_date)}</strong></div>
                      <div><span>Labor estimate</span><strong>PKR {Number(batch.estimated_labor_cost || 0).toFixed(0)}</strong></div>
                    </div>
                  </div>

                  {currentTask && (
                    <section className="current-operation">
                      <div className="current-operation-main">
                        <span className="current-operation-index">
                          {String(currentTask.step_order).padStart(2, "0")}
                        </span>
                        <div>
                          <span className="current-label">Current operation</span>
                          <h4>{currentTask.step_name}</h4>
                          <p>
                            {currentTask.worker_role || "Any production worker"} ·{" "}
                            {currentTask.worker_name || "Worker not assigned"}
                          </p>
                          <div className="current-operation-meta">
                            <span>{currentTask.completed_quantity} / {currentTask.assigned_quantity} complete</span>
                            <span>{formatMinutes(currentTask.estimated_total_minutes)} estimated</span>
                            <span>PKR {Number(currentTask.labor_cost || 0).toFixed(0)} labor</span>
                          </div>
                        </div>
                      </div>

                      <div className="current-operation-actions">
                        <div className="production-field-row">
                          <select
                            onChange={(event) =>
                              handleTaskInput(currentTask.id, "worker_id", event.target.value)
                            }
                            value={
                              taskInputs[currentTask.id]?.worker_id ??
                              currentTask.worker_id ??
                              ""
                            }
                          >
                            <option value="">Select worker</option>
                            {matchingWorkers(currentTask).map((worker) => (
                              <option key={worker.id} value={worker.id}>
                                {worker.name} - {worker.role}
                              </option>
                            ))}
                          </select>
                          <input
                            min="0"
                            onChange={(event) =>
                              handleTaskInput(currentTask.id, "rate_per_piece", event.target.value)
                            }
                            placeholder="Rate / piece"
                            type="number"
                            value={
                              taskInputs[currentTask.id]?.rate_per_piece ??
                              currentTask.rate_per_piece ??
                              ""
                            }
                          />
                          <button
                            disabled={busyAction === `assign-${currentTask.id}`}
                            onClick={() => assignWorker(currentTask)}
                            type="button"
                          >
                            Assign
                          </button>
                        </div>

                        {currentTask.status === "Ready" && (
                          <button
                            className="start-btn"
                            disabled={
                              busyAction === `start-${currentTask.id}` ||
                              !(taskInputs[currentTask.id]?.worker_id ?? currentTask.worker_id)
                            }
                            onClick={() => startTask(currentTask)}
                            type="button"
                          >
                            {taskInputs[currentTask.id]?.worker_id ?? currentTask.worker_id
                              ? "Start operation"
                              : "Assign worker to start"}
                          </button>
                        )}

                        {currentTask.status === "In Progress" && (
                          <>
                            <div className="production-field-row">
                              <input
                                max={currentTask.assigned_quantity}
                                min="0"
                                onChange={(event) =>
                                  handleTaskInput(
                                    currentTask.id,
                                    "completed_quantity",
                                    event.target.value
                                  )
                                }
                                placeholder={`Done of ${currentTask.assigned_quantity}`}
                                type="number"
                                value={taskInputs[currentTask.id]?.completed_quantity || ""}
                              />
                              <button
                                disabled={busyAction === `progress-${currentTask.id}`}
                                onClick={() => updateProgress(currentTask)}
                                type="button"
                              >
                                Update
                              </button>
                            </div>
                            <select
                              onChange={(event) =>
                                handleTaskInput(currentTask.id, "delay_reason", event.target.value)
                              }
                              value={taskInputs[currentTask.id]?.delay_reason || ""}
                            >
                              <option value="">Delay reason, if applicable</option>
                              {DELAY_REASONS.map((reason) => (
                                <option key={reason} value={reason}>{reason}</option>
                              ))}
                            </select>
                            <button
                              className="complete-btn"
                              disabled={busyAction === `complete-${currentTask.id}`}
                              onClick={() => completeTask(currentTask)}
                              type="button"
                            >
                              Complete and release next
                            </button>
                          </>
                        )}

                        {currentTask.status === "Pending Verification" && (
                          <button
                            className="complete-btn"
                            disabled={busyAction === `complete-${currentTask.id}`}
                            onClick={() => completeTask(currentTask)}
                            type="button"
                          >
                            Verify and release next
                          </button>
                        )}
                      </div>
                    </section>
                  )}

                  <div className="batch-toolbar">
                    <div>
                      <label>
                        Priority
                        <select
                          disabled={batch.status === "Completed"}
                          onChange={(event) => updateBatchPriority(batch, event.target.value)}
                          value={batch.priority}
                        >
                          <option value="Urgent">Urgent</option>
                          <option value="High">High</option>
                          <option value="Normal">Normal</option>
                          <option value="Low">Low</option>
                        </select>
                      </label>
                      {batch.unassigned_tasks > 0 && (
                        <button
                          disabled={busyAction === `auto-${batch.id}`}
                          onClick={() => autoAssign(batch)}
                          type="button"
                        >
                          Auto-assign {batch.unassigned_tasks} tasks
                        </button>
                      )}
                    </div>
                    <button onClick={() => toggleBatch(batch.id)} type="button">
                      {isExpanded ? "Hide full route" : `View full route (${batch.total_tasks})`}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="task-list production-route-list">
                      {batch.tasks.map((task) => (
                        <article className={`task-card task-${task.status.toLowerCase().replace(/\s+/g, "-")}`} key={task.id}>
                          <div className="task-left">
                            <div className="step-circle">{task.step_order}</div>
                            <div>
                              <div className="task-title-row">
                                <h4>{task.step_name}</h4>
                                <span className={statusClass(task.status)}>{task.status}</span>
                              </div>
                              <p>{task.worker_role || "Any role"} · {task.worker_name || "Unassigned"}</p>
                              <div className="task-meta">
                                <span>Qty {task.completed_quantity}/{task.assigned_quantity}</span>
                                <span>{task.progress_percent}% complete</span>
                                <span>{formatMinutes(task.estimated_total_minutes)}</span>
                                <span>PKR {Number(task.labor_cost || 0).toFixed(0)}</span>
                                <span>{task.timing_status}</span>
                              </div>
                              {task.delay_reason && (
                                <div className="late-reason">
                                  {task.delay_reason} · {formatMinutes(task.delay_minutes)} delay
                                </div>
                              )}
                            </div>
                          </div>
                          {task.status !== "Completed" && task.id !== batch.current_task_id && (
                            <div className="task-assign-compact">
                              <select
                                onChange={(event) =>
                                  handleTaskInput(task.id, "worker_id", event.target.value)
                                }
                                value={taskInputs[task.id]?.worker_id ?? task.worker_id ?? ""}
                              >
                                <option value="">Select worker</option>
                                {matchingWorkers(task).map((worker) => (
                                  <option key={worker.id} value={worker.id}>
                                    {worker.name} - {worker.role}
                                  </option>
                                ))}
                              </select>
                              <input
                                min="0"
                                onChange={(event) =>
                                  handleTaskInput(task.id, "rate_per_piece", event.target.value)
                                }
                                placeholder="Rate / piece"
                                type="number"
                                value={
                                  taskInputs[task.id]?.rate_per_piece ??
                                  task.rate_per_piece ??
                                  ""
                                }
                              />
                              <button onClick={() => assignWorker(task)} type="button">Assign</button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showBatchForm && (
        <div className="production-modal-overlay" onClick={closeBatchForm}>
          <section
            aria-modal="true"
            className="production-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="production-modal-header">
              <div>
                <h2>Create a production batch</h2>
                <p>The system generates sequential tasks from the article workflow.</p>
              </div>
              <button onClick={closeBatchForm} type="button">x</button>
            </div>

            <form className="production-form" onSubmit={createBatch}>
              <label>
                Batch number
                <input
                  onChange={(event) => handleFormChange("batch_no", event.target.value)}
                  placeholder="Generated automatically"
                  value={form.batch_no}
                />
                <small>Keep the suggested number or enter your own reference.</small>
              </label>
              <label>
                Product / article
                <select
                  onChange={(event) => {
                    const productId = event.target.value;
                    const plan = productionPlans.find(
                      (item) => String(item.product_id) === productId
                    );
                    setForm((current) => ({
                      ...current,
                      product_id: productId,
                      batch_quantity:
                        plan?.recommended_quantity > 0
                          ? String(plan.recommended_quantity)
                          : current.batch_quantity,
                    }));
                  }}
                  required
                  value={form.product_id}
                >
                  <option value="">Select article</option>
                  {productionPlans.map((product) => (
                    <option key={product.product_id} value={product.product_id}>
                      {product.article_no} - {product.product_name}
                      {!product.workflow_ready ? " (workflow missing)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Batch quantity
                <input
                  min="1"
                  onChange={(event) => handleFormChange("batch_quantity", event.target.value)}
                  required
                  type="number"
                  value={form.batch_quantity}
                />
              </label>
              <label>
                Priority
                <select
                  onChange={(event) => handleFormChange("priority", event.target.value)}
                  value={form.priority}
                >
                  <option value="Urgent">Urgent</option>
                  <option value="High">High</option>
                  <option value="Normal">Normal</option>
                  <option value="Low">Low</option>
                </select>
              </label>
              <label>
                Due date
                <input
                  onChange={(event) => handleFormChange("due_date", event.target.value)}
                  type="datetime-local"
                  value={form.due_date}
                />
              </label>
              <label className="production-full-field">
                Production notes
                <textarea
                  onChange={(event) => handleFormChange("notes", event.target.value)}
                  placeholder="Special material, finish, packaging, or quality instructions"
                  value={form.notes}
                />
              </label>

              {selectedPlan && (
                <section className={`production-release-preview ${selectedPlan.workflow_ready ? "" : "is-blocked"}`}>
                  <div>
                    <span>Available stock</span>
                    <strong>{selectedPlan.available_stock}</strong>
                  </div>
                  <div>
                    <span>Recommended</span>
                    <strong>{selectedPlan.recommended_quantity}</strong>
                  </div>
                  <div>
                    <span>Workflow</span>
                    <strong>
                      {selectedPlan.workflow_ready
                        ? `${selectedPlan.workflow_step_count} operations`
                        : "Missing"}
                    </strong>
                  </div>
                  <div>
                    <span>Time / piece</span>
                    <strong>{formatMinutes(selectedPlan.estimated_minutes_per_piece)}</strong>
                  </div>
                  <div>
                    <span>Labor / piece</span>
                    <strong>PKR {Number(selectedPlan.estimated_labor_per_piece).toFixed(0)}</strong>
                  </div>
                </section>
              )}

              <label className="production-checkbox production-full-field">
                <input
                  checked={form.include_optional_steps}
                  onChange={(event) =>
                    handleFormChange("include_optional_steps", event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Include optional workflow operations</strong>
                  <small>Leave off for the article's standard production route.</small>
                </span>
              </label>

              {error && <div className="production-error production-full-field">{error}</div>}
              <div className="production-modal-actions production-full-field">
                <button
                  className="production-create"
                  disabled={busyAction === "create" || !selectedPlan?.workflow_ready}
                  type="submit"
                >
                  {busyAction === "create" ? "Creating..." : "Create and generate tasks"}
                </button>
                <button className="production-refresh" onClick={closeBatchForm} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default Production;
