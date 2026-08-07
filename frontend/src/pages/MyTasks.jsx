import { useEffect, useMemo, useState, useCallback } from "react";
import { API_BASE_URL, apiFetch, getStaticUrl } from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./Production.css";

function MyTasks({ workerId }) {
  const [tasks, setTasks] = useState([]);
  const [orderTasks, setOrderTasks] = useState([]);
  const [shippingDrafts, setShippingDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Open");
  const [taskSearch, setTaskSearch] = useState("");

  const loadTasks = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [tasksRes, orderTasksRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/production/tasks?worker_id=${workerId}`),
        apiFetch(`${API_BASE_URL}/order-workflow/tasks?worker_id=${workerId}`),
      ]);

      if (!tasksRes.ok) {
        throw new Error("Failed to fetch tasks");
      }
      if (!orderTasksRes.ok) {
        throw new Error("Failed to fetch order tasks");
      }

      const tasksData = await tasksRes.json();
      const orderTasksData = await orderTasksRes.json();
      setTasks(tasksData);
      setOrderTasks(Array.isArray(orderTasksData) ? orderTasksData : []);
      setShippingDrafts((current) => {
        const next = { ...current };
        (Array.isArray(orderTasksData) ? orderTasksData : []).forEach((task) => {
          if (!next[task.id]) {
            next[task.id] = {
              courier_name: "",
              tracking_number: "",
              package_weight_kg: "",
              shipping_cost: "",
              shipping_note: "",
            };
          }
        });
        return next;
      });
    } catch (error) {
      console.error("My Tasks load error:", error);
      setTasks([]);
      setOrderTasks([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    const load = async () => {
      await loadTasks();
    };
    load();
    const refreshId = setInterval(() => loadTasks({ silent: true }), 30000);
    return () => clearInterval(refreshId);
  }, [loadTasks]);

  const startTask = async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/production/tasks/${taskId}/start`, {
        method: "PATCH",
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.detail || "Task not started");
        return;
      }

      loadTasks();
    } catch (error) {
      console.error("Start task error:", error);
      alert("Something went wrong");
    }
  };

  const acceptOrderTask = async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/order-workflow/tasks/${taskId}/start`, {
        method: "PATCH",
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.detail || "Order task not accepted");
        return;
      }

      loadTasks();
    } catch (error) {
      console.error("Accept order task error:", error);
      alert("Something went wrong");
    }
  };

  const handleShippingDraftChange = (taskId, field, value) => {
    setShippingDrafts((current) => ({
      ...current,
      [taskId]: {
        ...(current[taskId] || {}),
        [field]: value,
      },
    }));
  };

  const completeOrderTask = async (task) => {
    const draft = shippingDrafts[task.id] || {};
    const body =
      task.task_type === "Shipping"
        ? {
            courier_name: draft.courier_name || "",
            tracking_number: draft.tracking_number || "",
            package_weight_kg:
              draft.package_weight_kg === ""
                ? null
                : Number(draft.package_weight_kg),
            shipping_cost:
              draft.shipping_cost === "" ? null : Number(draft.shipping_cost),
            shipping_note: draft.shipping_note || "",
            verify: false,
          }
        : { note: "Preparation submitted by worker.", verify: false };

    try {
      const res = await apiFetch(`${API_BASE_URL}/order-workflow/tasks/${task.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.detail || "Order task not submitted");
        return;
      }

      loadTasks();
    } catch (error) {
      console.error("Complete order task error:", error);
      alert("Something went wrong");
    }
  };

  const completeProductionTask = async (task) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/production/tasks/${task.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed_quantity: Number(task.assigned_quantity || 0),
          delay_reason: null,
          verify: false,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.detail || "Task not submitted");
        return;
      }

      loadTasks();
    } catch (error) {
      console.error("Submit production task error:", error);
      alert("Something went wrong");
    }
  };

  const getStatusClass = (status) => {
    if (status === "Completed") return "status completed";
    if (status === "Pending Verification") return "status ready";
    if (status === "In Progress") return "status progress";
    if (["New", "Pending", "Ready"].includes(status)) return "status pending";
    return "status pending";
  };

  const isNotStartedStatus = (status) =>
    ["New", "Pending", "Ready"].includes(status);

  const getDisplayStatus = (status) =>
    isNotStartedStatus(status) ? "New" : status;

  const getDisplayTimingStatus = (task) => {
    if (isNotStartedStatus(task.status)) return "Not started";
    if (task.status === "Pending Verification") {
      return task.timing_status === "Late" ? "Late" : "";
    }
    return task.timing_status && task.timing_status !== task.status
      ? task.timing_status
      : "";
  };

  const formatDate = (value) => {
    if (!value) return "-";
    return formatUtcLocal(value);
  };

  const formatCurrency = (value) =>
    `Rs. ${Number(value || 0).toLocaleString("en-PK", {
      maximumFractionDigits: 0,
    })}`;

  const combinedTasks = useMemo(() => {
    const normalizedOrderTasks = orderTasks
      .filter((task) => task.status !== "Canceled")
      .map((task) => {
        const firstItem = (task.items || [])[0] || {};
        const assignedQuantity = Number(
          task.assigned_quantity ||
            (task.items || []).reduce(
              (total, item) => total + Number(item.quantity || 0),
              0
            ) ||
            1
        );
        return {
          ...task,
          id: `order-${task.id}`,
          original_id: task.id,
          task_kind: "order",
          source_type: "Order",
          step_name: task.title || `${task.task_type || "Order"} task`,
          article_no: task.order_no ? `Order #${task.order_no}` : "Order task",
          product_name: firstItem.product_name || task.task_type || "Order task",
          product_image_url: firstItem.product_image_url || null,
          assigned_quantity: assignedQuantity,
          completed_quantity:
            task.status === "Completed"
              ? Number(task.completed_quantity || assignedQuantity)
              : 0,
          timing_status:
            task.due_at &&
            task.status !== "Completed" &&
            new Date(task.due_at) < new Date()
              ? "Late"
              : isNotStartedStatus(task.status)
                ? "Not started"
                : task.status || "Open",
          expected_completion_time: task.due_at,
          actual_start_time: task.started_at,
          actual_completion_time: task.completed_at,
          search_text: [
            task.title,
            task.task_type,
            task.order_no,
            firstItem.article_no,
            firstItem.product_name,
            task.status,
          ]
            .filter(Boolean)
            .join(" "),
        };
      });

    const normalizedProductionTasks = tasks.map((task) => ({
      ...task,
      task_kind: "production",
      search_text: [
        task.step_name,
        task.article_no,
        task.product_name,
        task.status,
        task.timing_status,
      ]
        .filter(Boolean)
        .join(" "),
    }));

    return [...normalizedOrderTasks, ...normalizedProductionTasks];
  }, [orderTasks, tasks]);

  const taskSummary = useMemo(
    () => ({
      completed: combinedTasks.filter((task) => task.status === "Completed").length,
      inProgress: combinedTasks.filter((task) => task.status === "In Progress").length,
      late: combinedTasks.filter((task) => task.timing_status === "Late").length,
      open: combinedTasks.filter((task) => task.status !== "Completed").length,
      unstarted: combinedTasks.filter((task) =>
        ["New", "Pending", "Ready"].includes(task.status)
      ).length,
      verification: combinedTasks.filter(
        (task) => task.status === "Pending Verification"
      ).length,
      total: combinedTasks.length,
    }),
    [combinedTasks]
  );

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();

    return combinedTasks.filter((task) => {
      const matchesSearch =
        !query ||
        [
          task.search_text,
          task.step_name,
          task.article_no,
          task.product_name,
          task.status,
          task.timing_status,
        ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Open" && task.status !== "Completed") ||
        (statusFilter === "Not started" &&
          ["New", "Pending", "Ready"].includes(task.status)) ||
        (statusFilter === "In Progress" && task.status === "In Progress") ||
        (statusFilter === "Verification" &&
          task.status === "Pending Verification") ||
        (statusFilter === "Late" && task.timing_status === "Late") ||
        (statusFilter === "Completed" && task.status === "Completed");

      return matchesSearch && matchesStatus;
    });
  }, [combinedTasks, statusFilter, taskSearch]);

  if (loading) {
    return (
      <div className="production-page">
        <div className="production-header">
          <div>
            <span className="page-tag">Worker Portal</span>
            <h1>My Tasks</h1>
            <p>Loading your assigned production tasks.</p>
          </div>
        </div>
        <div className="empty-box">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="production-page">
      <div className="production-header">
        <div>
          <span className="page-tag">Worker Portal</span>
          <h1>My Tasks</h1>
          <p>Start assigned work. Admin will mark tasks complete.</p>
        </div>
      </div>

      <section className="mytasks-summary" aria-label="Task summary">
        <article className={taskSummary.open > 0 ? "is-active" : ""}>
          <span>Open tasks</span>
          <strong>{taskSummary.open}</strong>
        </article>
        <article className={taskSummary.unstarted > 0 ? "is-active" : ""}>
          <span>Not started</span>
          <strong>{taskSummary.unstarted}</strong>
        </article>
        <article>
          <span>In progress</span>
          <strong>{taskSummary.inProgress}</strong>
        </article>
        <article className={taskSummary.verification > 0 ? "is-active" : ""}>
          <span>Verification</span>
          <strong>{taskSummary.verification}</strong>
        </article>
        <article className={taskSummary.late > 0 ? "is-late" : ""}>
          <span>Late</span>
          <strong>{taskSummary.late}</strong>
        </article>
      </section>

      <section className="mytasks-toolbar">
        <div className="mytasks-tabs" aria-label="Filter tasks">
          {[
            ["Open", taskSummary.open],
            ["Not started", taskSummary.unstarted],
            ["In Progress", taskSummary.inProgress],
            ["Verification", taskSummary.verification],
            ["Late", taskSummary.late],
            ["Completed", taskSummary.completed],
            ["All", taskSummary.total],
          ].map(([label, count]) => (
            <button
              aria-pressed={statusFilter === label}
              className={statusFilter === label ? "is-active" : ""}
              key={label}
              onClick={() => setStatusFilter(label)}
              type="button"
            >
              <span>{label}</span>
              <strong>{count}</strong>
            </button>
          ))}
        </div>

        <label className="mytasks-search">
          <span>Search</span>
          <input
            aria-label="Search tasks"
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="SKU, step, status"
            value={taskSearch}
          />
        </label>
      </section>

      {combinedTasks.length === 0 ? (
        <div className="empty-box">No tasks currently assigned to you.</div>
      ) : filteredTasks.length === 0 ? (
        <div className="empty-box">No tasks match the selected filter.</div>
      ) : (
        <div className="batch-list mytasks-list">
          {filteredTasks.map((task) => {
            const isOrderTask = task.task_kind === "order";
            const originalTaskId = isOrderTask ? task.original_id : task.id;
            const actionTask = isOrderTask
              ? { ...task, id: task.original_id }
              : task;
            const draft = isOrderTask ? shippingDrafts[originalTaskId] || {} : {};
            const imageUrl = getStaticUrl(task.product_image_url);
            const displayStatus = getDisplayStatus(task.status);
            const displayTimingStatus = getDisplayTimingStatus(task);
            return (
              <div
                className={`batch-card mytask-card ${
                  task.timing_status === "Late" ? "is-late" : ""
                } ${task.status === "Completed" ? "is-completed" : ""}`}
                key={`${task.task_kind}-${task.id}`}
              >
                <div className="batch-top worker-task-top">
                  <div className="worker-task-product">
                    {imageUrl ? (
                      <img
                        alt={task.article_no || "Product"}
                        className="worker-task-thumbnail"
                        src={imageUrl}
                      />
                    ) : (
                      <span className="worker-task-thumbnail worker-task-placeholder">
                        SKU
                      </span>
                    )}
                    <div>
                      <span className="worker-task-sku">
                        {isOrderTask ? task.article_no || "Order task" : `SKU ${task.article_no || "-"}`}
                      </span>
                      <h3>{task.step_name}</h3>
                    </div>
                  </div>

                  <div className="batch-status-box">
                    <span className={getStatusClass(task.status)}>
                      {displayStatus}
                    </span>
                    {displayTimingStatus && <small>{displayTimingStatus}</small>}
                  </div>
                </div>

                {isOrderTask && task.task_type === "Shipping" && task.status === "In Progress" && (
                  <div className="mytasks-shipping-fields">
                    <input
                      onChange={(event) =>
                        handleShippingDraftChange(
                          originalTaskId,
                          "courier_name",
                          event.target.value
                        )
                      }
                      placeholder="Courier"
                      value={draft.courier_name || ""}
                    />
                    <input
                      onChange={(event) =>
                        handleShippingDraftChange(
                          originalTaskId,
                          "tracking_number",
                          event.target.value
                        )
                      }
                      placeholder="Tracking number"
                      value={draft.tracking_number || ""}
                    />
                    <input
                      min="0"
                      onChange={(event) =>
                        handleShippingDraftChange(
                          originalTaskId,
                          "package_weight_kg",
                          event.target.value
                        )
                      }
                      placeholder="Weight kg"
                      step="0.01"
                      type="number"
                      value={draft.package_weight_kg || ""}
                    />
                    <input
                      min="0"
                      onChange={(event) =>
                        handleShippingDraftChange(
                          originalTaskId,
                          "shipping_cost",
                          event.target.value
                        )
                      }
                      placeholder="Cost"
                      step="0.01"
                      type="number"
                      value={draft.shipping_cost || ""}
                    />
                  </div>
                )}

                <div className="worker-task-action-row">
                  {isOrderTask ? (
                    <>
                      {(task.status === "New" || task.status === "Ready") && (
                        <button
                          className="start-btn"
                          onClick={() => acceptOrderTask(originalTaskId)}
                          type="button"
                        >
                          Start task
                        </button>
                      )}
                      {task.status !== "New" &&
                        task.status !== "Ready" &&
                        task.status !== "Pending Verification" &&
                        task.status !== "Completed" && (
                          <button
                            className="start-btn"
                            onClick={() => completeOrderTask(actionTask)}
                            type="button"
                          >
                            {task.task_type === "Shipping"
                              ? "Submit shipping"
                              : "Submit for verification"}
                          </button>
                        )}
                      {task.status === "Pending Verification" && (
                        <span className="worker-task-readonly">
                          Submitted. Waiting admin verification.
                        </span>
                      )}
                      {task.status === "Completed" && (
                        <span className="worker-task-readonly">
                          Verified complete
                        </span>
                      )}
                    </>
                  ) : task.status === "Ready" ? (
                    <button
                      className="start-btn"
                      onClick={() => startTask(task.id)}
                      type="button"
                    >
                      Start task
                    </button>
                  ) : task.status === "In Progress" ? (
                    <button
                      className="start-btn"
                      onClick={() => completeProductionTask(task)}
                      type="button"
                    >
                      Submit for verification
                    </button>
                  ) : task.status === "Pending Verification" ? (
                    <span className="worker-task-readonly">
                      Submitted. Waiting admin verification.
                    </span>
                  ) : (
                    <span className="worker-task-readonly">
                      {task.status === "Completed"
                        ? "Verified complete"
                        : "Waiting"}
                    </span>
                  )}
                </div>

                <div className="task-time-row">
                  <span>Rate: {formatCurrency(task.rate_per_piece)} / piece</span>
                  <span>
                    Earning:{" "}
                    {task.status === "Completed"
                      ? formatCurrency(
                          task.labor_cost ||
                            Number(task.completed_quantity || task.assigned_quantity || 0) *
                              Number(task.rate_per_piece || 0)
                        )
                      : "Pending verification"}
                  </span>
                  <span>Expected: {formatDate(task.expected_completion_time)}</span>
                  <span>Started: {formatDate(task.actual_start_time)}</span>
                  <span>Completed: {formatDate(task.actual_completion_time)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MyTasks;
