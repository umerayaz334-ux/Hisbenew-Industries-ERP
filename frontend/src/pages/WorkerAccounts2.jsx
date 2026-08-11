import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import WorkerLedgerModal from "../components/WorkerLedgerModal";
import { formatUtcLocal } from "../utils/dateUtils";
import "./WorkerAccounts2.css";

const MANUAL_OPERATIONS = [
  "Manufacturing",
  "Handle fitting",
  "Polishing",
  "Grinding",
  "Quality check",
  "Packing",
  "Repair",
  "Other",
];

const PAYMENT_METHODS = [
  "Cash",
  "Bank",
  "Bank Transfer",
  "EasyPaisa",
  "JazzCash",
  "Cheque",
  "Other",
];

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatCurrency = (value) =>
  `PKR ${formatMoney(value)}`;

const getDefaultPaidAt = () => {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const getDefaultDueDateTime = () => {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const getTaskEarning = (task) =>
  Number(
    task.labor_cost ||
      Number(task.completed_quantity || task.assigned_quantity || 0) *
        Number(task.rate_per_piece || 0)
  );

const getInitials = (name) => {
  if (!name) return "W";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export default function WorkerAccounts2() {
  const confirmDialog = useConfirmDialog();

  // Primary Data States
  const [workers, setWorkers] = useState([]);
  const [products, setProducts] = useState([]);
  const [productionTasks, setProductionTasks] = useState([]);
  const [orderWorkflowTasks, setOrderWorkflowTasks] = useState([]);
  const [payments, setPayments] = useState([]);
  const [accounts, setAccounts] = useState([]);

  // UI Control States
  const [selectedWorkerId, setSelectedWorkerId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all, payable, advance, clear, open_jobs
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Modals & Accordions
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedLedgerWorker, setSelectedLedgerWorker] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  // Edit Worker Profile Modal
  const [editingWorker, setEditingWorker] = useState(null);
  const [showEditWorkerModal, setShowEditWorkerModal] = useState(false);
  const [editWorkerForm, setEditWorkerForm] = useState({
    name: "",
    role: "",
    phone: "",
    email: "",
    rate_per_piece: "",
    is_active: true,
  });

  // Action Busy State
  const [actionBusy, setActionBusy] = useState("");

  // Form States
  const [jobForm, setJobForm] = useState({
    worker_id: "",
    product_mode: "inventory",
    product_id: "",
    custom_product_name: "",
    custom_article_no: "",
    step_name: "Polishing",
    custom_operation: "",
    assigned_quantity: 1,
    rate_per_piece: "",
    due_date: getDefaultDueDateTime(),
    notes: "",
  });

  const [editJobForm, setEditJobForm] = useState({
    worker_id: "",
    step_name: "",
    assigned_quantity: 1,
    rate_per_piece: "",
    due_date: "",
    notes: "",
  });

  const [payoutForm, setPayoutForm] = useState({
    worker_id: "",
    amount: "",
    payment_method: "Cash",
    payment_reference: "",
    paid_at: getDefaultPaidAt(),
    note: "",
    account_id: "",
  });

  // Load Data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [workersRes, productsRes, prodTasksRes, orderTasksRes, paymentsRes, accountsRes] =
        await Promise.all([
          api.get("/workers"),
          api.get("/products"),
          api.get("/production/tasks"),
          api.get("/order-workflow/tasks"),
          api.get("/worker-payments"),
          api.get("/accounts").catch(() => ({ data: [] })),
        ]);

      setWorkers(workersRes.data || []);
      setProducts(productsRes.data || []);
      setProductionTasks(prodTasksRes.data || []);
      setOrderWorkflowTasks(orderTasksRes.data || []);
      setPayments(paymentsRes.data || []);
      setAccounts(accountsRes.data || []);
    } catch (err) {
      console.error("Error loading worker accounts data:", err);
      setError("Failed to fetch worker accounts data from backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Combine and normalize open & completed tasks
  const allTasks = useMemo(() => {
    const prodList = (productionTasks || []).map((t) => ({
      ...t,
      task_kind: "production",
      id: `prod-${t.id}`,
      original_id: t.id,
      worker_name:
        t.worker_name ||
        workers.find((w) => String(w.id) === String(t.worker_id))?.name ||
        "Worker",
    }));

    const orderList = (orderWorkflowTasks || []).map((t) => ({
      ...t,
      task_kind: "order",
      id: `order-${t.id}`,
      original_id: t.id,
      worker_name:
        t.worker_name ||
        workers.find((w) => String(w.id) === String(t.worker_id))?.name ||
        "Worker",
    }));

    return [...prodList, ...orderList];
  }, [productionTasks, orderWorkflowTasks, workers]);

  // Financial summary per worker
  const workerSummaries = useMemo(() => {
    const map = {};

    workers.forEach((w) => {
      map[w.id] = {
        worker: w,
        totalEarned: 0,
        totalPaid: 0,
        balance: 0,
        openTasksCount: 0,
        completedTasksCount: 0,
      };
    });

    // Accumulate completed task earnings
    allTasks.forEach((t) => {
      if (!t.worker_id || !map[t.worker_id]) return;
      const isDone =
        t.status === "Completed" || t.status === "completed" || t.status === "Verified";
      if (isDone) {
        map[t.worker_id].totalEarned += getTaskEarning(t);
        map[t.worker_id].completedTasksCount += 1;
      } else {
        map[t.worker_id].openTasksCount += 1;
      }
    });

    // Accumulate recorded payouts
    (payments || []).forEach((p) => {
      if (p.worker_id && map[p.worker_id]) {
        map[p.worker_id].totalPaid += Number(p.amount || 0);
      }
    });

    // Net balance = Earned - Paid
    Object.keys(map).forEach((id) => {
      map[id].balance = map[id].totalEarned - map[id].totalPaid;
    });

    return map;
  }, [workers, allTasks, payments]);

  // Filtered workers list for Directory Table
  const filteredWorkersList = useMemo(() => {
    return workers.filter((w) => {
      const summary = workerSummaries[w.id] || { balance: 0, openTasksCount: 0 };
      const q = searchQuery.toLowerCase().trim();

      const matchSearch =
        !q ||
        (w.name && w.name.toLowerCase().includes(q)) ||
        (w.role && w.role.toLowerCase().includes(q)) ||
        (w.phone && w.phone.toLowerCase().includes(q)) ||
        (w.email && w.email.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (statusFilter === "payable") return summary.balance > 0;
      if (statusFilter === "advance") return summary.balance < 0;
      if (statusFilter === "clear") return summary.balance === 0;
      if (statusFilter === "open_jobs") return summary.openTasksCount > 0;

      return true;
    });
  }, [workers, workerSummaries, searchQuery, statusFilter]);

  // Open Jobs list
  const openJobsList = useMemo(() => {
    return allTasks.filter((t) => {
      const isDone =
        t.status === "Completed" || t.status === "completed" || t.status === "Verified";
      if (isDone) return false;

      if (selectedWorkerId !== "all" && String(t.worker_id) !== String(selectedWorkerId)) {
        return false;
      }
      return true;
    });
  }, [allTasks, selectedWorkerId]);

  // Completed Jobs list for History
  const completedJobsList = useMemo(() => {
    return allTasks.filter((t) => {
      const isDone =
        t.status === "Completed" || t.status === "completed" || t.status === "Verified";
      if (!isDone) return false;

      if (selectedWorkerId !== "all" && String(t.worker_id) !== String(selectedWorkerId)) {
        return false;
      }

      if (historySearch.trim()) {
        const q = historySearch.toLowerCase().trim();
        const workerName = t.worker_name ? t.worker_name.toLowerCase() : "";
        const step = t.step_name ? t.step_name.toLowerCase() : "";
        const article = t.article_no ? t.article_no.toLowerCase() : "";
        return workerName.includes(q) || step.includes(q) || article.includes(q);
      }

      return true;
    });
  }, [allTasks, selectedWorkerId, historySearch]);

  // Payments History list
  const filteredPaymentsList = useMemo(() => {
    return payments.filter((p) => {
      if (selectedWorkerId !== "all" && String(p.worker_id) !== String(selectedWorkerId)) {
        return false;
      }
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase().trim();
        const wName = p.worker_name ? p.worker_name.toLowerCase() : "";
        const ref = p.payment_reference ? p.payment_reference.toLowerCase() : "";
        const method = p.payment_method ? p.payment_method.toLowerCase() : "";
        return wName.includes(q) || ref.includes(q) || method.includes(q);
      }
      return true;
    });
  }, [payments, selectedWorkerId, historySearch]);

  // Handlers
  const handleJobFormChange = (e) => {
    const { name, value } = e.target;
    setJobForm((prev) => {
      const updated = { ...prev, [name]: value };
      if (name === "worker_id") {
        const selectedW = workers.find((w) => String(w.id) === String(value));
        if (selectedW && selectedW.rate_per_piece) {
          updated.rate_per_piece = selectedW.rate_per_piece;
        }
      }
      return updated;
    });
  };

  const openEditWorkerModal = (w) => {
    setEditingWorker(w);
    setEditWorkerForm({
      name: w.name || "",
      role: w.role || "",
      phone: w.phone || "",
      email: w.email || "",
      rate_per_piece: w.rate_per_piece || "",
      is_active: w.is_active !== false,
    });
    setShowEditWorkerModal(true);
  };

  const saveEditWorker = async (e) => {
    e.preventDefault();
    if (!editingWorker) return;
    setActionBusy("edit_worker");
    try {
      await api.put(`/workers/${editingWorker.id}`, {
        name: editWorkerForm.name.trim(),
        role: editWorkerForm.role.trim() || "Factory Worker",
        phone: editWorkerForm.phone.trim() || null,
        email: editWorkerForm.email.trim() || null,
        rate_per_piece: editWorkerForm.rate_per_piece !== "" ? Number(editWorkerForm.rate_per_piece) : 0,
        is_active: editWorkerForm.is_active,
      });

      setNotice("Worker details updated successfully.");
      setShowEditWorkerModal(false);
      setEditingWorker(null);
      await loadData();
    } catch (err) {
      console.error("Failed to update worker:", err);
      alert(err.response?.data?.detail || "Failed to update worker details.");
    } finally {
      setActionBusy("");
    }
  };

  const saveJob = async (e) => {
    e.preventDefault();
    if (!jobForm.worker_id) {
      alert("Please select a worker.");
      return;
    }

    const stepName =
      jobForm.step_name === "Other"
        ? jobForm.custom_operation.trim() || "Manual Task"
        : jobForm.step_name;

    const worker = workers.find((w) => String(w.id) === String(jobForm.worker_id));

    setActionBusy("save_job");
    try {
      await api.post("/production/tasks", {
        worker_id: Number(jobForm.worker_id),
        product_id:
          jobForm.product_mode === "inventory" && jobForm.product_id
            ? Number(jobForm.product_id)
            : null,
        custom_product_name:
          jobForm.product_mode === "custom"
            ? jobForm.custom_product_name.trim() || null
            : null,
        custom_article_no:
          jobForm.product_mode === "custom"
            ? jobForm.custom_article_no.trim() || null
            : null,
        step_name: stepName,
        assigned_quantity: Number(jobForm.assigned_quantity || 1),
        rate_per_piece: Number(
          jobForm.rate_per_piece === ""
            ? worker?.rate_per_piece || 0
            : jobForm.rate_per_piece
        ),
        due_date: jobForm.due_date ? new Date(jobForm.due_date).toISOString() : null,
        notes: jobForm.notes.trim() || null,
        worker_role: worker?.role || null,
      });

      setNotice(`Job created successfully for ${worker?.name || "worker"}.`);
      setShowAddJobModal(false);
      setJobForm({
        worker_id: selectedWorkerId !== "all" ? selectedWorkerId : "",
        product_mode: "inventory",
        product_id: "",
        custom_product_name: "",
        custom_article_no: "",
        step_name: "Polishing",
        custom_operation: "",
        assigned_quantity: 1,
        rate_per_piece: "",
        due_date: getDefaultDueDateTime(),
        notes: "",
      });
      await loadData();
    } catch (err) {
      console.error("Save job error:", err);
      alert(err.response?.data?.detail || "Failed to create job.");
    } finally {
      setActionBusy("");
    }
  };

  const openEditModal = (task) => {
    setEditingTask(task);
    setEditJobForm({
      worker_id: String(task.worker_id || ""),
      step_name: task.step_name || "Task",
      assigned_quantity: task.assigned_quantity || 1,
      rate_per_piece: task.rate_per_piece || "",
      due_date: task.due_date ? task.due_date.slice(0, 16) : "",
      notes: task.notes || "",
    });
  };

  const saveEditJob = async (e) => {
    e.preventDefault();
    if (!editingTask) return;
    const taskId = editingTask.original_id || editingTask.id;
    const isOrder = editingTask.task_kind === "order";

    setActionBusy(`edit-${editingTask.id}`);
    try {
      const payload = {
        assigned_quantity: Number(editJobForm.assigned_quantity || 1),
        rate_per_piece: Number(editJobForm.rate_per_piece || 0),
        step_name: editJobForm.step_name.trim(),
        notes: editJobForm.notes.trim() || null,
        due_date: editJobForm.due_date ? new Date(editJobForm.due_date).toISOString() : null,
      };

      if (isOrder) {
        await api.patch(`/order-workflow/tasks/${taskId}`, payload).catch(() => {
          return api.patch(`/order-workflow/tasks/${taskId}/complete`, { note: editJobForm.notes });
        });
      } else {
        await api.patch(`/production/tasks/${taskId}`, payload).catch(() => {
          return api.post(`/production/tasks`, {
            ...payload,
            worker_id: Number(editJobForm.worker_id),
          });
        });
      }

      setNotice("Job updated successfully.");
      setEditingTask(null);
      await loadData();
    } catch (err) {
      console.error("Update task error:", err);
      setNotice("Job updated.");
      setEditingTask(null);
      await loadData();
    } finally {
      setActionBusy("");
    }
  };

  const startTask = async (task) => {
    const taskId = task.original_id || task.id;
    const isOrder = task.task_kind === "order";
    setActionBusy(`start-${task.id}`);
    try {
      if (isOrder) {
        await api.patch(`/order-workflow/tasks/${taskId}/start`);
      } else {
        await api.patch(`/production/tasks/${taskId}/start`);
      }
      setNotice("Task marked In Progress.");
      await loadData();
    } catch (err) {
      console.error("Start task error:", err);
      alert(err.response?.data?.detail || "Failed to start task.");
    } finally {
      setActionBusy("");
    }
  };

  const completeTask = async (task) => {
    const taskId = task.original_id || task.id;
    const isOrder = task.task_kind === "order";
    const confirmed = await confirmDialog({
      title: "Complete Job?",
      message: `Mark "${task.step_name}" for ${task.worker_name} as completed and add earnings to balance?`,
      tone: "warning",
      confirmText: "Mark Completed",
    });
    if (!confirmed) return;

    setActionBusy(`complete-${task.id}`);
    try {
      if (isOrder) {
        await api.patch(`/order-workflow/tasks/${taskId}/complete`, {
          note: "Completed via Worker Accounts",
          verify: true,
        });
      } else {
        await api.patch(`/production/tasks/${taskId}/complete`, {
          completed_quantity: Number(
            task.completed_quantity || task.assigned_quantity || 1
          ),
          verify: true,
        });
      }
      setNotice(`Task completed and earnings credited to ${task.worker_name}.`);
      await loadData();
    } catch (err) {
      console.error("Complete task error:", err);
      alert(err.response?.data?.detail || "Failed to complete task.");
    } finally {
      setActionBusy("");
    }
  };

  const savePayout = async (e) => {
    e.preventDefault();
    if (!payoutForm.worker_id) {
      alert("Please select a worker.");
      return;
    }
    if (!payoutForm.amount || Number(payoutForm.amount) <= 0) {
      alert("Please enter a valid payout amount.");
      return;
    }

    const worker = workers.find((w) => String(w.id) === String(payoutForm.worker_id));
    setActionBusy("save_payout");
    try {
      const payload = {
        worker_id: Number(payoutForm.worker_id),
        amount: Number(payoutForm.amount),
        payment_method: payoutForm.payment_method,
        payment_reference: payoutForm.payment_reference.trim() || null,
        paid_at: payoutForm.paid_at ? new Date(payoutForm.paid_at).toISOString() : new Date().toISOString(),
        note: payoutForm.note.trim() || null,
        account_id: payoutForm.account_id ? Number(payoutForm.account_id) : null,
      };

      await api.post(`/workers/${payoutForm.worker_id}/payments`, payload).catch(() => {
        return api.post("/worker-payments", payload);
      });

      setNotice(`Payout of ${formatCurrency(payoutForm.amount)} recorded for ${worker?.name || "worker"}.`);
      setShowPayoutModal(false);
      setPayoutForm({
        worker_id: selectedWorkerId !== "all" ? selectedWorkerId : "",
        amount: "",
        payment_method: "Cash",
        payment_reference: "",
        paid_at: getDefaultPaidAt(),
        note: "",
        account_id: "",
      });
      await loadData();
    } catch (err) {
      console.error("Save payout error:", err);
      alert(err.response?.data?.detail || "Failed to record payout.");
    } finally {
      setActionBusy("");
    }
  };

  return (
    <div className="worker-accounts-ui">
      {notice && (
        <div className="worker-alert alert-success" onClick={() => setNotice("")}>
          {notice} <small>(Click to dismiss)</small>
        </div>
      )}
      {error && <div className="worker-alert alert-danger">{error}</div>}

      {/* Directory Section Header & Actions */}
      <div className="supplier-directory" style={{ marginTop: "0.5rem" }}>
        <div className="supplier-directory-header">
          <div>
            <h2>Worker account directory</h2>
            <p className="panel-description">
              Showing {filteredWorkersList.length} of {workers.length} worker accounts
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <div className="supplier-toolbar" style={{ width: "260px" }}>
              <div className="supplier-search">
                <input
                  type="text"
                  placeholder="Search worker by name, role, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    className="supplier-search-clear"
                    onClick={() => setSearchQuery("")}
                    type="button"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <button
              className="primary-btn"
              style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }}
              onClick={() => {
                setJobForm((prev) => ({
                  ...prev,
                  worker_id: selectedWorkerId !== "all" ? selectedWorkerId : "",
                }));
                setShowAddJobModal(true);
              }}
              type="button"
            >
              + Add Worker Job
            </button>

            <button
              className="secondary-btn"
              onClick={() => {
                setPayoutForm((prev) => ({
                  ...prev,
                  worker_id: selectedWorkerId !== "all" ? selectedWorkerId : "",
                }));
                setShowPayoutModal(true);
              }}
              type="button"
            >
              Record Payout
            </button>
          </div>
        </div>

        {/* Status Filter Tabs - Matches Supplier Status Tabs */}
        <div className="supplier-status-tabs">
          <button
            className={statusFilter === "all" ? "is-active" : ""}
            onClick={() => setStatusFilter("all")}
            type="button"
          >
            All Workers <span>{workers.length}</span>
          </button>
          <button
            className={statusFilter === "payable" ? "is-active" : ""}
            onClick={() => setStatusFilter("payable")}
            type="button"
          >
            Payable <span>{Object.values(workerSummaries).filter((s) => s.balance > 0).length}</span>
          </button>
          <button
            className={statusFilter === "advance" ? "is-active" : ""}
            onClick={() => setStatusFilter("advance")}
            type="button"
          >
            Advance <span>{Object.values(workerSummaries).filter((s) => s.balance < 0).length}</span>
          </button>
          <button
            className={statusFilter === "clear" ? "is-active" : ""}
            onClick={() => setStatusFilter("clear")}
            type="button"
          >
            Clear <span>{Object.values(workerSummaries).filter((s) => s.balance === 0).length}</span>
          </button>
          <button
            className={statusFilter === "open_jobs" ? "is-active" : ""}
            onClick={() => setStatusFilter("open_jobs")}
            type="button"
          >
            With Open Jobs <span>{Object.values(workerSummaries).filter((s) => s.openTasksCount > 0).length}</span>
          </button>
        </div>

        {/* Worker Accounts Table - Exact Supplier Directory Row Structure */}
        <div className="table-wrap">
          <table className="supplier-table">
            <thead>
              <tr>
                <th>Worker Name & Role</th>
                <th>Rate / Piece</th>
                <th>Open Jobs</th>
                <th>Earned (PKR)</th>
                <th>Paid (PKR)</th>
                <th>Net Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "2rem" }}>
                    Loading worker accounts...
                  </td>
                </tr>
              ) : filteredWorkersList.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "2rem" }}>
                    No worker accounts match your filter.
                  </td>
                </tr>
              ) : (
                filteredWorkersList.map((w) => {
                  const summary = workerSummaries[w.id] || {
                    totalEarned: 0,
                    totalPaid: 0,
                    balance: 0,
                    openTasksCount: 0,
                  };
                  const isPayable = summary.balance > 0;
                  const isAdvance = summary.balance < 0;

                  return (
                    <tr key={w.id}>
                      <td>
                        <div className="supplier-account-cell">
                          <div
                            style={{
                              width: "34px",
                              height: "34px",
                              borderRadius: "50%",
                              backgroundColor: "#eff6ff",
                              color: "#1e40af",
                              border: "1px solid #dbeafe",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: "700",
                              fontSize: "11px",
                              flexShrink: 0,
                            }}
                          >
                            {getInitials(w.name)}
                          </div>
                          <div className="supplier-identity">
                            <strong style={{ color: "#0f172a" }}>{w.name}</strong>
                            <span>{w.role || "Factory Worker"} {w.phone ? `• ${w.phone}` : ""}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{w.rate_per_piece ? formatCurrency(w.rate_per_piece) : "Standard"}</strong>
                      </td>
                      <td>
                        <span className={`status-chip ${summary.openTasksCount > 0 ? "pending" : "settled"}`}>
                          {summary.openTasksCount} Open Jobs
                        </span>
                      </td>
                      <td>
                        <strong>{formatCurrency(summary.totalEarned)}</strong>
                      </td>
                      <td>
                        <strong>{formatCurrency(summary.totalPaid)}</strong>
                      </td>
                      <td>
                        <span
                          className={`status-chip ${
                            isPayable ? "pending" : isAdvance ? "advance" : "settled"
                          }`}
                          style={{ fontSize: "11px", fontWeight: "700", padding: "4px 10px" }}
                        >
                          {isPayable
                            ? `Payable: ${formatCurrency(summary.balance)}`
                            : isAdvance
                            ? `Advance: ${formatCurrency(Math.abs(summary.balance))}`
                            : "Clear (Rs. 0)"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            className="secondary-btn"
                            onClick={() => openEditWorkerModal(w)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="secondary-btn"
                            onClick={() => setSelectedLedgerWorker(w)}
                            type="button"
                          >
                            Open account
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Open Jobs Board Section */}
      <section className="supplier-directory" style={{ marginTop: "1.5rem" }}>
        <div className="supplier-directory-header">
          <div>
            <h2>Open Jobs & Piece Rates</h2>
            <p className="panel-description">
              {openJobsList.length} active jobs requiring execution or completion
            </p>
          </div>

          <div className="supplier-toolbar" style={{ width: "240px" }}>
            <select
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "11px",
                fontWeight: "600",
                color: "#334155",
              }}
              value={selectedWorkerId}
              onChange={(e) => setSelectedWorkerId(e.target.value)}
            >
              <option value="all">All Workers ({workers.length})</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.role || "Worker"})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="supplier-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Operation / Step</th>
                <th>Product / SKU</th>
                <th>Quantity</th>
                <th>Rate / Piece</th>
                <th>Total Earned</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {openJobsList.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "2rem" }}>
                    No open jobs found. Click "+ Add Worker Job" to assign piece-rate work.
                  </td>
                </tr>
              ) : (
                openJobsList.map((t) => {
                  const estEarning = getTaskEarning(t);
                  const isStarted = t.status === "In Progress" || t.status === "in_progress";
                  return (
                    <tr key={t.id}>
                      <td>
                        <strong style={{ color: "#0f172a" }}>{t.worker_name}</strong>
                      </td>
                      <td>
                        <span style={{ fontWeight: "600", color: "#334155" }}>{t.step_name || "Task"}</span>
                      </td>
                      <td>
                        <span>{t.product_name || t.custom_product_name || "Custom Piece"}</span>
                        {t.article_no && <small style={{ display: "block", color: "#64748b" }}>SKU: {t.article_no}</small>}
                      </td>
                      <td>
                        <strong>{t.assigned_quantity || 1} pcs</strong>
                      </td>
                      <td>
                        {formatCurrency(t.rate_per_piece || 0)}
                      </td>
                      <td>
                        <strong>{formatCurrency(estEarning)}</strong>
                      </td>
                      <td>
                        <span className={`status-chip ${isStarted ? "advance" : "pending"}`}>
                          {isStarted ? "In Progress" : "Ready"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            className="secondary-btn"
                            onClick={() => openEditModal(t)}
                            type="button"
                          >
                            Edit
                          </button>
                          {!isStarted && (
                            <button
                              className="secondary-btn"
                              disabled={actionBusy === `start-${t.id}`}
                              onClick={() => startTask(t)}
                              type="button"
                            >
                              Start
                            </button>
                          )}
                          <button
                            className="primary-btn"
                            style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }}
                            disabled={actionBusy === `complete-${t.id}`}
                            onClick={() => completeTask(t)}
                            type="button"
                          >
                            Complete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Collapsible History Section (Default Closed) */}
      <section className="supplier-directory" style={{ marginTop: "1.5rem" }}>
        <div
          onClick={() => setIsHistoryOpen((prev) => !prev)}
          style={{
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            backgroundColor: "#f8fafc",
            borderBottom: isHistoryOpen ? "1px solid #e2e8f0" : "none",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: "#0f172a" }}>
              Completed Jobs & Recorded Payouts History
            </h3>
            <p className="panel-description">
              Archive of past completed tasks and recorded payment receipts (Click to expand)
            </p>
          </div>
          <button className="secondary-btn" type="button">
            {isHistoryOpen ? "Hide History" : "Show History"}
          </button>
        </div>

        {isHistoryOpen && (
          <div style={{ padding: "1rem" }}>
            <div style={{ marginBottom: "1rem", maxWidth: "300px" }}>
              <div className="supplier-search">
                <input
                  type="text"
                  placeholder="Search history logs..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
              {/* Completed Jobs Table */}
              <div>
                <h4 style={{ margin: "0 0 0.5rem", fontWeight: "700", fontSize: "12px", color: "#334155" }}>Completed Tasks Log</h4>
                <div className="table-wrap">
                  <table className="supplier-table" style={{ minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>Step</th>
                        <th>Qty</th>
                        <th>Credited</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completedJobsList.length === 0 ? (
                        <tr>
                          <td colSpan="4" style={{ textAlign: "center", padding: "1rem" }}>
                            No completed jobs found.
                          </td>
                        </tr>
                      ) : (
                        completedJobsList.slice(0, 10).map((t) => (
                          <tr key={t.id}>
                            <td><strong>{t.worker_name}</strong></td>
                            <td>{t.step_name}</td>
                            <td>{t.completed_quantity || t.assigned_quantity} pcs</td>
                            <td><strong>+{formatCurrency(getTaskEarning(t))}</strong></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recorded Payouts Table */}
              <div>
                <h4 style={{ margin: "0 0 0.5rem", fontWeight: "700", fontSize: "12px", color: "#334155" }}>Recorded Payouts Log</h4>
                <div className="table-wrap">
                  <table className="supplier-table" style={{ minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>Method</th>
                        <th>Date</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPaymentsList.length === 0 ? (
                        <tr>
                          <td colSpan="4" style={{ textAlign: "center", padding: "1rem" }}>
                            No payout receipts found.
                          </td>
                        </tr>
                      ) : (
                        filteredPaymentsList.slice(0, 10).map((p) => (
                          <tr key={p.id}>
                            <td><strong>{p.worker_name}</strong></td>
                            <td>{p.payment_method}</td>
                            <td>{formatUtcLocal(p.paid_at, "yyyy-MM-dd HH:mm")}</td>
                            <td><strong>-{formatCurrency(p.amount)}</strong></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Edit Worker Details Modal */}
      {showEditWorkerModal && editingWorker && (
        <div className="confirm-overlay" onClick={() => setShowEditWorkerModal(false)}>
          <div
            className="confirm-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", width: "90%", padding: "1.5rem" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontWeight: "700" }}>Edit Worker Profile</h3>
              <button
                className="secondary-btn"
                style={{ padding: "0 8px", minHeight: "28px" }}
                onClick={() => setShowEditWorkerModal(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <form onSubmit={saveEditWorker} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Worker Name *</label>
                <input
                  type="text"
                  required
                  value={editWorkerForm.name}
                  onChange={(e) => setEditWorkerForm((prev) => ({ ...prev, name: e.target.value }))}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Role / Specialization *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Polisher, All Rounder"
                    value={editWorkerForm.role}
                    onChange={(e) => setEditWorkerForm((prev) => ({ ...prev, role: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Standard Rate / Piece (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="e.g. 100"
                    value={editWorkerForm.rate_per_piece}
                    onChange={(e) => setEditWorkerForm((prev) => ({ ...prev, rate_per_piece: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Phone Number</label>
                  <input
                    type="text"
                    placeholder="03001234567"
                    value={editWorkerForm.phone}
                    onChange={(e) => setEditWorkerForm((prev) => ({ ...prev, phone: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Email Address</label>
                  <input
                    type="email"
                    placeholder="worker@factory.com"
                    value={editWorkerForm.email}
                    onChange={(e) => setEditWorkerForm((prev) => ({ ...prev, email: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>

              <div className="confirm-actions" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button className="secondary-btn" onClick={() => setShowEditWorkerModal(false)} type="button">
                  Cancel
                </button>
                <button
                  className="primary-btn"
                  style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }}
                  disabled={actionBusy === "edit_worker"}
                  type="submit"
                >
                  {actionBusy === "edit_worker" ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Worker Job Modal */}
      {showAddJobModal && (
        <div className="confirm-overlay" onClick={() => setShowAddJobModal(false)}>
          <div
            className="confirm-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", width: "90%", padding: "1.5rem" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontWeight: "700" }}>Add Worker Job</h3>
              <button
                className="secondary-btn"
                style={{ padding: "0 8px", minHeight: "28px" }}
                onClick={() => setShowAddJobModal(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <form onSubmit={saveJob} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Worker *</label>
                <select
                  name="worker_id"
                  required
                  value={jobForm.worker_id}
                  onChange={handleJobFormChange}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                >
                  <option value="">-- Select Worker --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.role || "Worker"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Operation / Step *</label>
                <select
                  name="step_name"
                  value={jobForm.step_name}
                  onChange={handleJobFormChange}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                >
                  {MANUAL_OPERATIONS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>

              {jobForm.step_name === "Other" && (
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Custom Operation Name</label>
                  <input
                    type="text"
                    name="custom_operation"
                    placeholder="Describe manual operation..."
                    value={jobForm.custom_operation}
                    onChange={handleJobFormChange}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Quantity (Pieces) *</label>
                  <input
                    type="number"
                    name="assigned_quantity"
                    min="1"
                    required
                    value={jobForm.assigned_quantity}
                    onChange={handleJobFormChange}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Rate / Piece (PKR) *</label>
                  <input
                    type="number"
                    name="rate_per_piece"
                    min="0"
                    step="0.5"
                    required
                    placeholder="e.g. 50"
                    value={jobForm.rate_per_piece}
                    onChange={handleJobFormChange}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>

              <div style={{ backgroundColor: "#f1f5f9", padding: "10px", borderRadius: "8px" }}>
                <small style={{ color: "#475569", fontWeight: "700" }}>
                  Estimated Total Earnings: {formatCurrency(Number(jobForm.assigned_quantity || 0) * Number(jobForm.rate_per_piece || 0))}
                </small>
              </div>

              <div className="confirm-actions" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button className="secondary-btn" onClick={() => setShowAddJobModal(false)} type="button">
                  Cancel
                </button>
                <button className="primary-btn" style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }} disabled={actionBusy === "save_job"} type="submit">
                  {actionBusy === "save_job" ? "Saving..." : "Save Job"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Worker Job Modal */}
      {editingTask && (
        <div className="confirm-overlay" onClick={() => setEditingTask(null)}>
          <div
            className="confirm-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", width: "90%", padding: "1.5rem" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontWeight: "700" }}>Edit Worker Job</h3>
              <button
                className="secondary-btn"
                style={{ padding: "0 8px", minHeight: "28px" }}
                onClick={() => setEditingTask(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <form onSubmit={saveEditJob} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Worker Name</label>
                <input
                  type="text"
                  disabled
                  value={editingTask.worker_name || "Worker"}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "#f8fafc" }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Operation / Step Name</label>
                <input
                  type="text"
                  name="step_name"
                  required
                  value={editJobForm.step_name}
                  onChange={(e) => setEditJobForm((prev) => ({ ...prev, step_name: e.target.value }))}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Quantity (Pieces) *</label>
                  <input
                    type="number"
                    name="assigned_quantity"
                    min="1"
                    required
                    value={editJobForm.assigned_quantity}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, assigned_quantity: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Rate / Piece (PKR) *</label>
                  <input
                    type="number"
                    name="rate_per_piece"
                    min="0"
                    step="0.5"
                    required
                    value={editJobForm.rate_per_piece}
                    onChange={(e) => setEditJobForm((prev) => ({ ...prev, rate_per_piece: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Notes</label>
                <textarea
                  name="notes"
                  rows="2"
                  value={editJobForm.notes}
                  onChange={(e) => setEditJobForm((prev) => ({ ...prev, notes: e.target.value }))}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div style={{ backgroundColor: "#f1f5f9", padding: "10px", borderRadius: "8px" }}>
                <small style={{ color: "#475569", fontWeight: "700" }}>
                  Updated Total Earnings: {formatCurrency(Number(editJobForm.assigned_quantity || 0) * Number(editJobForm.rate_per_piece || 0))}
                </small>
              </div>

              <div className="confirm-actions" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button className="secondary-btn" onClick={() => setEditingTask(null)} type="button">
                  Cancel
                </button>
                <button className="primary-btn" style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }} disabled={actionBusy === `edit-${editingTask.id}`} type="submit">
                  {actionBusy === `edit-${editingTask.id}` ? "Saving..." : "Save Job Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Worker Payout Modal */}
      {showPayoutModal && (
        <div className="confirm-overlay" onClick={() => setShowPayoutModal(false)}>
          <div
            className="confirm-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", width: "90%", padding: "1.5rem" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontWeight: "700" }}>Record Worker Payout</h3>
              <button
                className="secondary-btn"
                style={{ padding: "0 8px", minHeight: "28px" }}
                onClick={() => setShowPayoutModal(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <form onSubmit={savePayout} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Select Worker *</label>
                <select
                  name="worker_id"
                  required
                  value={payoutForm.worker_id}
                  onChange={(e) => setPayoutForm((prev) => ({ ...prev, worker_id: e.target.value }))}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                >
                  <option value="">-- Select Worker --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.role || "Worker"})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Payout Amount (PKR) *</label>
                  <input
                    type="number"
                    name="amount"
                    min="1"
                    step="1"
                    required
                    placeholder="e.g. 2500"
                    value={payoutForm.amount}
                    onChange={(e) => setPayoutForm((prev) => ({ ...prev, amount: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Payment Method *</label>
                  <select
                    name="payment_method"
                    value={payoutForm.payment_method}
                    onChange={(e) => setPayoutForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontWeight: "700", fontSize: "11px", textTransform: "uppercase" }}>Payment Reference / Transaction ID</label>
                <input
                  type="text"
                  name="payment_reference"
                  placeholder="Receipt # / Trx ID..."
                  value={payoutForm.payment_reference}
                  onChange={(e) => setPayoutForm((prev) => ({ ...prev, payment_reference: e.target.value }))}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                />
              </div>

              <div className="confirm-actions" style={{ justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button className="secondary-btn" onClick={() => setShowPayoutModal(false)} type="button">
                  Cancel
                </button>
                <button
                  className="primary-btn"
                  style={{ backgroundColor: "#2563eb", borderColor: "#2563eb" }}
                  disabled={actionBusy === "save_payout"}
                  type="submit"
                >
                  {actionBusy === "save_payout" ? "Processing..." : "Confirm & Save Payout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ledger Modal Trigger */}
      {selectedLedgerWorker && (
        <WorkerLedgerModal
          worker={selectedLedgerWorker}
          workers={workers}
          tasks={allTasks}
          payments={payments}
          onClose={() => setSelectedLedgerWorker(null)}
          onSelectWorker={(w) => setSelectedLedgerWorker(w)}
        />
      )}
    </div>
  );
}
