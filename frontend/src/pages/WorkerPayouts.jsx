import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import WorkerLedgerModal from "../components/WorkerLedgerModal";
import { formatUtcLocal } from "../utils/dateUtils";
import "./WorkerPayouts.css";

const getDefaultPaidAt = () => {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const emptyPaymentForm = {
  worker_id: "",
  amount: "",
  payment_method: "Cash",
  payment_reference: "",
  paid_at: getDefaultPaidAt(),
  note: "",
  account_id: "",
};

const paymentMethods = [
  "Cash",
  "Bank",
  "Bank Transfer",
  "EasyPaisa",
  "JazzCash",
  "Cheque",
  "Other",
];

function Icon({ name, size = 18 }) {
  const paths = {
    wallet: (
      <>
        <path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6" />
        <path d="M16 13h2" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
        <path d="M9 7h6M9 11h6M9 15h3" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 18 6-6-6-6" />,
    trash: (
      <>
        <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    task: (
      <>
        <path d="M9 11l2 2 4-5" />
        <path d="M20 6v14H4V4h10" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="wa-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

const formatAmount = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  });

const formatCurrency = (value) => `PKR ${formatAmount(value)}`;

const getInitials = (name = "") =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "WK";

const getTaskEarning = (task) =>
  Number(
    task.labor_cost ||
      Number(task.completed_quantity || 0) * Number(task.rate_per_piece || 0)
  );

const normalizeOrderTaskForLedger = (task) => {
  const items = Array.isArray(task.items) ? task.items : [];
  const assignedQuantity = Number(
    task.assigned_quantity ||
      items.reduce((total, item) => total + Number(item.quantity || 0), 0) ||
      1
  );
  const firstItem = items[0] || {};
  return {
    ...task,
    id: `order-${task.id}`,
    source_type: "Order",
    worker_id: task.assigned_worker_id,
    worker_name: task.assigned_worker_name,
    batch_no: task.order_no ? `Order ${task.order_no}` : `Order #${task.order_id}`,
    article_no: firstItem.article_no || task.order_no || "Order",
    product_name:
      items
        .map((item) => item.article_no || item.product_name)
        .filter(Boolean)
        .join(", ") || task.platform || "Order workflow",
    step_name: task.title || `${task.task_type || "Order"} task`,
    assigned_quantity: assignedQuantity,
    completed_quantity:
      task.status === "Completed"
        ? Number(task.completed_quantity || assignedQuantity)
        : 0,
    expected_completion_time: task.due_at,
    actual_start_time: task.started_at,
    actual_completion_time: task.completed_at,
    completed_at: task.completed_at,
    rate_per_piece: Number(task.rate_per_piece || 0),
    labor_cost: Number(task.labor_cost || 0),
  };
};

function WorkerPayouts({ userRole, workerId, userName }) {
  const confirmDialog = useConfirmDialog();
  const isWorkerPortal = userRole === "worker";
  const pageTitle = isWorkerPortal ? "Payouts" : "Worker Accounts";
  const pageKicker = isWorkerPortal ? "Worker Portal" : "Factory Accounts";
  const balanceSectionTitle = isWorkerPortal ? "Payout balance" : "Worker accounts";
  const balanceSectionCount = isWorkerPortal ? "balance records" : "accounts";
  const balanceSearchLabel = isWorkerPortal
    ? "Search payout balance"
    : "Search worker accounts";
  const [workers, setWorkers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [payments, setPayments] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [workerFilter, setWorkerFilter] = useState(
    isWorkerPortal && workerId ? String(workerId) : "all"
  );
  const [balanceFilter, setBalanceFilter] = useState("All");
  const [accountSearch, setAccountSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [payoutSearch, setPayoutSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("All methods");
  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [selectedLedgerWorker, setSelectedLedgerWorker] = useState(null);
  const [isTaskHistoryOpen, setIsTaskHistoryOpen] = useState(false);
  const [isPayoutHistoryOpen, setIsPayoutHistoryOpen] = useState(false);
  const [form, setForm] = useState(emptyPaymentForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isWorkerPortal || !workerId) return undefined;
    const syncFilterId = window.setTimeout(() => {
      setWorkerFilter(String(workerId));
    }, 0);
    return () => window.clearTimeout(syncFilterId);
  }, [isWorkerPortal, workerId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workerQuery = isWorkerPortal && workerId ? `?worker_id=${workerId}` : "";
      const [tasksResponse, orderTasksResponse, paymentsResponse, workersResponse, accountsResponse] =
        await Promise.all([
          api.get(`/production/tasks${workerQuery}`),
          api.get(`/order-workflow/tasks${workerQuery}`),
          api.get(`/worker-payments${workerQuery}`),
          isWorkerPortal
            ? Promise.resolve({
                data: workerId
                  ? [{ id: workerId, name: userName || "Worker", role: "Worker" }]
                  : [],
              })
            : api.get("/workers"),
          isWorkerPortal ? Promise.resolve({ data: [] }) : api.get("/accounting/accounts"),
        ]);

      const productionTasks = Array.isArray(tasksResponse.data)
        ? tasksResponse.data
        : [];
      const orderLedgerTasks = Array.isArray(orderTasksResponse.data)
        ? orderTasksResponse.data.map(normalizeOrderTaskForLedger)
        : [];
      setTasks([...productionTasks, ...orderLedgerTasks]);
      setPayments(Array.isArray(paymentsResponse.data) ? paymentsResponse.data : []);
      setWorkers(Array.isArray(workersResponse.data) ? workersResponse.data : []);
      setAccounts(Array.isArray(accountsResponse.data) ? accountsResponse.data : []);
    } catch (loadError) {
      console.error("Worker accounts load error:", loadError);
      setError(
        isWorkerPortal
          ? "Payout data could not be loaded."
          : "Worker account data could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [isWorkerPortal, userName, workerId]);

  useEffect(() => {
    const loadId = window.setTimeout(loadData, 0);
    return () => window.clearTimeout(loadId);
  }, [loadData]);

  const ledger = useMemo(
    () =>
      workers.map((worker) => {
        const workerTasks = tasks.filter(
          (task) => String(task.worker_id || "") === String(worker.id)
        );
        const completedTaskList = workerTasks.filter(
          (task) => task.status === "Completed"
        );
        const earned = completedTaskList.reduce(
          (total, task) => total + getTaskEarning(task),
          0
        );
        const paid = payments
          .filter((payment) => String(payment.worker_id) === String(worker.id))
          .reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const balance = earned - paid;
        const settlementPercent =
          earned > 0
            ? Math.min(100, Math.max(0, Math.round((paid / earned) * 100)))
            : 0;

        return {
          worker,
          earned,
          paid,
          balance,
          settlementPercent,
          openTasks: workerTasks.filter((task) => task.status !== "Completed").length,
          completedTasks: completedTaskList.length,
          status: balance > 0 ? "payable" : balance < 0 ? "advance" : "clear",
        };
      }),
    [payments, tasks, workers]
  );

  const totals = useMemo(
    () =>
      ledger.reduce(
        (summary, item) => ({
          earned: summary.earned + item.earned,
          paid: summary.paid + item.paid,
          balance: summary.balance + item.balance,
          completed: summary.completed + item.completedTasks,
          open: summary.open + item.openTasks,
          payable: summary.payable + (item.balance > 0 ? 1 : 0),
          clear: summary.clear + (item.balance === 0 ? 1 : 0),
          advance: summary.advance + (item.balance < 0 ? 1 : 0),
          openAccounts: summary.openAccounts + (item.openTasks > 0 ? 1 : 0),
        }),
        {
          earned: 0,
          paid: 0,
          balance: 0,
          completed: 0,
          open: 0,
          payable: 0,
          clear: 0,
          advance: 0,
          openAccounts: 0,
        }
      ),
    [ledger]
  );

  const settlementPercent =
    totals.earned > 0
      ? Math.min(100, Math.max(0, Math.round((totals.paid / totals.earned) * 100)))
      : 0;

  const filteredLedger = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();

    return [...ledger]
      .filter((item) => {
        const matchesSearch = [item.worker.name, item.worker.role]
          .some((value) => String(value || "").toLowerCase().includes(query));
        const matchesStatus =
          balanceFilter === "All" ||
          (balanceFilter === "Payable" && item.balance > 0) ||
          (balanceFilter === "Clear" && item.balance === 0) ||
          (balanceFilter === "Advance" && item.balance < 0) ||
          (balanceFilter === "Open work" && item.openTasks > 0);

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
  }, [accountSearch, balanceFilter, ledger]);

  const selectedWorkerIds = useMemo(() => {
    if (workerFilter === "all") {
      return new Set(workers.map((worker) => String(worker.id)));
    }
    return new Set([String(workerFilter)]);
  }, [workerFilter, workers]);

  const visibleTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    return tasks
      .filter(
        (task) =>
          selectedWorkerIds.has(String(task.worker_id || "")) &&
          task.status === "Completed"
      )
      .filter((task) =>
        [
          task.step_name,
          task.product_name,
          task.article_no,
          task.source_type,
          task.notes,
          task.worker_name,
        ].some((value) => String(value || "").toLowerCase().includes(query))
      )
      .sort(
        (a, b) =>
          new Date(b.completed_at || b.actual_completion_time || 0) -
          new Date(a.completed_at || a.actual_completion_time || 0)
      );
  }, [selectedWorkerIds, taskSearch, tasks]);

  const visiblePayments = useMemo(() => {
    const query = payoutSearch.trim().toLowerCase();
    return payments
      .filter((payment) => selectedWorkerIds.has(String(payment.worker_id || "")))
      .filter((payment) => {
        const matchesQuery = [
          payment.worker_name,
          payment.payment_method,
          payment.payment_reference,
          payment.note,
        ].some((value) => String(value || "").toLowerCase().includes(query));
        const matchesMethod =
          methodFilter === "All methods" || payment.payment_method === methodFilter;
        return matchesQuery && matchesMethod;
      })
      .sort((a, b) => new Date(b.paid_at || 0) - new Date(a.paid_at || 0));
  }, [methodFilter, payments, payoutSearch, selectedWorkerIds]);

  const availableMethods = useMemo(
    () =>
      Array.from(
        new Set(payments.map((payment) => payment.payment_method).filter(Boolean))
      ).sort(),
    [payments]
  );

  const selectedLedger = useMemo(
    () => ledger.find((item) => String(item.worker.id) === String(form.worker_id)),
    [form.worker_id, ledger]
  );

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const scrollToPayoutForm = () => {
    window.requestAnimationFrame(() => {
      document
        .getElementById("worker-payout-form")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const openPayoutForm = () => {
    if (isWorkerPortal) return;
    setNotice("");
    setShowPayoutForm(true);
    if (workerFilter !== "all") {
      setForm((current) => ({ ...current, worker_id: workerFilter }));
    }
    scrollToPayoutForm();
  };

  const selectWorkerForPayout = (item) => {
    if (isWorkerPortal) {
      setWorkerFilter(String(item.worker.id));
      return;
    }

    setWorkerFilter(String(item.worker.id));
    setForm((current) => ({
      ...current,
      worker_id: String(item.worker.id),
      amount: item.balance > 0 ? String(Math.ceil(item.balance)) : current.amount,
    }));
    setNotice("");
    setShowPayoutForm(true);
    scrollToPayoutForm();
  };

  const savePayment = async (event) => {
    event.preventDefault();
    if (isWorkerPortal) return;
    setError("");
    setNotice("");

    if (!form.worker_id) {
      setError("Select a worker account.");
      return;
    }
    if (Number(form.amount) <= 0) {
      setError("Payout amount must be greater than 0.");
      return;
    }

    setSaving(true);
    try {
      await api.post(`/workers/${form.worker_id}/payments`, {
        amount: Number(form.amount),
        payment_method: form.payment_method || null,
        payment_reference: form.payment_reference.trim() || null,
        paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : null,
        note: form.note.trim() || null,
        account_id: form.account_id ? Number(form.account_id) : null,
      });
      setNotice("Worker payout recorded.");
      setForm((current) => ({
        ...emptyPaymentForm,
        worker_id: current.worker_id,
        account_id: current.account_id,
      }));
      await loadData();
    } catch (saveError) {
      console.error("Worker payout save error:", saveError);
      setError(saveError.response?.data?.detail || "Worker payout could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async (payment) => {
    if (isWorkerPortal) return;
    const confirmed = await confirmDialog({
      title: "Delete payout?",
      message: `Delete ${formatCurrency(payment.amount)} for ${
        payment.worker_name || "this worker"
      }?`,
      tone: "danger",
      confirmText: "Delete payout",
    });
    if (!confirmed) return;

    try {
      await api.delete(`/workers/${payment.worker_id}/payments/${payment.id}`);
      setNotice("Worker payout deleted.");
      await loadData();
    } catch (deleteError) {
      console.error("Worker payout delete error:", deleteError);
      setError(deleteError.response?.data?.detail || "Worker payout could not be deleted.");
    }
  };

  if (loading) {
    return (
      <div className="worker-payouts-page">
        <div className="wa-state">
          {isWorkerPortal ? "Loading payouts..." : "Loading worker accounts..."}
        </div>
      </div>
    );
  }

  return (
    <div className="worker-payouts-page worker-accounts-page">
      <header className="wa-page-header">
        <div>
          <span className="wa-page-kicker">{pageKicker}</span>
          <h1>{pageTitle}</h1>
          <p>
            {isWorkerPortal
              ? "Your completed job earnings, recorded payouts, and remaining balance."
              : "Track worker earnings, payouts, account balances, and task-level wages."}
          </p>
        </div>

        <div className="wa-header-actions">
          <div className="wa-settlement-summary">
            <div>
              <span>Settlement progress</span>
              <strong>{settlementPercent}%</strong>
            </div>
            <div className="wa-meter-track">
              <span style={{ width: `${settlementPercent}%` }} />
            </div>
          </div>

          {!isWorkerPortal && (
            <button className="wa-primary-button" onClick={openPayoutForm} type="button">
              <Icon name="plus" />
              Record payout
            </button>
          )}
        </div>
      </header>

      {notice && <div className="wa-alert wa-alert-success">{notice}</div>}
      {error && <div className="wa-alert wa-alert-error">{error}</div>}

      <section
        className="wa-summary-grid"
        aria-label={isWorkerPortal ? "Payout summary" : "Worker account summary"}
      >
        <article className="wa-summary-card">
          <div className="wa-summary-icon">
            <Icon name="task" />
          </div>
          <div>
            <span>Total earned</span>
            <strong>{formatCurrency(totals.earned)}</strong>
            <small>{formatAmount(totals.completed)} completed jobs</small>
          </div>
        </article>
        <article className="wa-summary-card wa-summary-paid">
          <div className="wa-summary-icon">
            <Icon name="check" />
          </div>
          <div>
            <span>Total paid</span>
            <strong>{formatCurrency(totals.paid)}</strong>
            <small>{payments.length} payouts recorded</small>
          </div>
        </article>
        <article className="wa-summary-card wa-summary-due">
          <div className="wa-summary-icon">
            <Icon name="wallet" />
          </div>
          <div>
            <span>Outstanding balance</span>
            <strong>{formatCurrency(totals.balance)}</strong>
            <small>
              {isWorkerPortal
                ? `${totals.payable} payout balance${totals.payable === 1 ? "" : "s"}`
                : `${totals.payable} payable accounts`}
            </small>
          </div>
        </article>
        <article className="wa-summary-card wa-summary-open">
          <div className="wa-summary-icon">
            <Icon name="clock" />
          </div>
          <div>
            <span>Open work</span>
            <strong>{formatAmount(totals.open)}</strong>
            <small>Tasks still in progress</small>
          </div>
        </article>
      </section>

      <section className="wa-panel wa-accounts-panel">
        <div className="wa-panel-toolbar">
          <div>
            <h2>{balanceSectionTitle}</h2>
            <p>
              {filteredLedger.length} {balanceSectionCount} shown
            </p>
          </div>
          <div className="wa-account-tools">
            <div className="wa-status-filter" aria-label={balanceSearchLabel}>
              {[
                ["All", ledger.length],
                ["Payable", totals.payable],
                ["Clear", totals.clear],
                ["Advance", totals.advance],
                ["Open work", totals.openAccounts],
              ].map(([label, count]) => (
                <button
                  aria-pressed={balanceFilter === label}
                  className={balanceFilter === label ? "is-active" : ""}
                  key={label}
                  onClick={() => setBalanceFilter(label)}
                  type="button"
                >
                  <span>{label}</span>
                  <strong>{count}</strong>
                </button>
              ))}
            </div>

            <label className="wa-search-box">
              <Icon name="search" />
              <input
                aria-label={balanceSearchLabel}
                onChange={(event) => setAccountSearch(event.target.value)}
                placeholder={isWorkerPortal ? "Search payout" : "Search worker"}
                value={accountSearch}
              />
            </label>
          </div>
        </div>

        {filteredLedger.length === 0 ? (
          <div className="wa-empty-state">
            <div className="wa-empty-icon">
              <Icon name="user" />
            </div>
            <h3>{isWorkerPortal ? "No payout balance found" : "No worker accounts found"}</h3>
            <p>
              {isWorkerPortal
                ? "Completed jobs and recorded payouts will appear here."
                : "Assigned and completed production jobs will create worker balances."}
            </p>
          </div>
        ) : (
          <div className="wa-account-grid">
            {filteredLedger.map((item) => {
              const statusLabel =
                item.status === "payable"
                  ? "Payout due"
                  : item.status === "advance"
                    ? "Advance"
                    : "Clear";
              const balanceLabel =
                item.status === "advance" ? "Advance balance" : "Outstanding balance";

              return (
                <article className="wa-account-card" key={item.worker.id}>
                  <div className="wa-account-card-header">
                    <div className="wa-worker-cell">
                      <span>{getInitials(item.worker.name)}</span>
                      <div>
                        <strong>{item.worker.name}</strong>
                        <small>{item.worker.role || "Worker"}</small>
                      </div>
                    </div>
                    <span className={`wa-status wa-status-${item.status}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <div className="wa-account-total">
                    <span>{balanceLabel}</span>
                    <strong className={`is-${item.status}`}>
                      {formatCurrency(Math.abs(item.balance))}
                    </strong>
                  </div>

                  <div className="wa-account-settlement">
                    <div>
                      <span>Settlement</span>
                      <strong>{item.settlementPercent}%</strong>
                    </div>
                    <div className="wa-account-progress">
                      <span style={{ width: `${item.settlementPercent}%` }} />
                    </div>
                  </div>

                  <div className="wa-account-metrics">
                    <div>
                      <span>Earned</span>
                      <strong>{formatCurrency(item.earned)}</strong>
                    </div>
                    <div>
                      <span>Paid</span>
                      <strong>{formatCurrency(item.paid)}</strong>
                    </div>
                    <div>
                      <span>Done / Open</span>
                      <strong>
                        {item.completedTasks} / {item.openTasks}
                      </strong>
                    </div>
                  </div>

                  <div className="wa-account-actions-row" style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button
                      className="wa-account-action"
                      style={{ background: "var(--bg-hover, #f1f5f9)", color: "var(--color-primary, #2563eb)", flex: 1 }}
                      onClick={() => setSelectedLedgerWorker(item.worker)}
                      type="button"
                    >
                      📜 View Ledger
                    </button>
                    <button
                      className="wa-account-action"
                      style={{ flex: 1 }}
                      onClick={() => selectWorkerForPayout(item)}
                      type="button"
                    >
                      {isWorkerPortal ? "View payouts" : "Record payout"}
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {!isWorkerPortal && showPayoutForm && (
        <section className="wa-panel wa-payment-panel" id="worker-payout-form">
          <div className="wa-panel-heading">
            <div>
              <h2>Record worker payout</h2>
              <p>Save a payment against a worker account balance.</p>
            </div>

            {selectedLedger && (
              <div className="wa-selected-account">
                <span>Selected balance</span>
                <strong className={selectedLedger.balance > 0 ? "is-due" : "is-clear"}>
                  {selectedLedger.worker.name} / {formatCurrency(selectedLedger.balance)}
                </strong>
              </div>
            )}
            <button
              className="wa-close-form-button"
              onClick={() => setShowPayoutForm(false)}
              type="button"
            >
              Close
            </button>
          </div>

          <form className="wa-payment-form" onSubmit={savePayment}>
            <label className="wa-field">
              <span>Worker account</span>
              <select
                onChange={(event) => updateForm("worker_id", event.target.value)}
                value={form.worker_id}
              >
                <option value="">Select worker</option>
                {ledger.map(({ worker, balance }) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} / Balance {formatCurrency(balance)}
                  </option>
                ))}
              </select>
            </label>

            <label className="wa-field">
              <span>Amount (PKR)</span>
              <input
                min="1"
                onChange={(event) => updateForm("amount", event.target.value)}
                placeholder="0"
                type="number"
                value={form.amount}
              />
            </label>

            <label className="wa-field">
              <span>Payment method</span>
              <select
                onChange={(event) => updateForm("payment_method", event.target.value)}
                value={form.payment_method}
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>

            <label className="wa-field">
              <span>Accounting</span>
              <select
                onChange={(event) => updateForm("account_id", event.target.value)}
                value={form.account_id}
              >
                <option value="">Do not sync</option>
                {accounts
                  .filter((account) => account.is_active !== false)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} / {account.currency}
                    </option>
                  ))}
              </select>
            </label>

            <label className="wa-field">
              <span>Reference</span>
              <input
                onChange={(event) =>
                  updateForm("payment_reference", event.target.value)
                }
                placeholder="Receipt or transfer no."
                value={form.payment_reference}
              />
            </label>

            <label className="wa-field">
              <span>Paid at</span>
              <input
                onChange={(event) => updateForm("paid_at", event.target.value)}
                type="datetime-local"
                value={form.paid_at}
              />
            </label>

            <label className="wa-field wa-note-field">
              <span>Internal note</span>
              <input
                onChange={(event) => updateForm("note", event.target.value)}
                placeholder="Weekly settlement, advance, or adjustment"
                value={form.note}
              />
            </label>

            <div className="wa-form-footer">
              <span className="wa-form-help">
                The worker account balance updates immediately.
              </span>
              <button className="wa-save-button" disabled={saving} type="submit">
                {saving ? "Recording..." : "Record payout"}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Collapsible Task Earnings History Section (Default Closed) */}
      <section className="wa-panel wa-task-panel wa-collapsible-history-panel">
        <button
          className="wa-history-toggle-button"
          onClick={() => setIsTaskHistoryOpen(!isTaskHistoryOpen)}
          type="button"
          aria-expanded={isTaskHistoryOpen}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem",
            background: "none",
            border: "none",
            fontSize: "1.1rem",
            fontWeight: "700",
            cursor: "pointer",
            color: "var(--text-color, #0f172a)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>📜 Task Earnings History</span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)", fontWeight: "500" }}>
              ({visibleTasks.length} completed jobs &bull; Closed by default)
            </span>
          </div>
          <span>{isTaskHistoryOpen ? "▲ Hide" : "▼ Expand History"}</span>
        </button>

        {isTaskHistoryOpen && (
          <>
            <div className="wa-ledger-header" style={{ borderTop: "1px solid var(--border-color, #e2e8f0)" }}>
              <div>
                <h2>Completed Job Earnings</h2>
              </div>

              <div className="wa-ledger-filters">
                {!isWorkerPortal && (
                  <select
                    aria-label="Filter task earnings by worker"
                    onChange={(event) => setWorkerFilter(event.target.value)}
                    value={workerFilter}
                  >
                    <option value="all">All workers</option>
                    {workers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.name}
                      </option>
                    ))}
                  </select>
                )}
                <label className="wa-search-box wa-ledger-search">
                  <Icon name="search" />
                  <input
                    aria-label="Search task earnings"
                    onChange={(event) => setTaskSearch(event.target.value)}
                    placeholder="Search task"
                    value={taskSearch}
                  />
                </label>
              </div>
            </div>

            {visibleTasks.length === 0 ? (
              <div className="wa-empty-state wa-empty-ledger">
                <div className="wa-empty-icon">
                  <Icon name="task" />
                </div>
                <h3>No completed paid jobs</h3>
                <p>Completed production and order jobs with earnings will appear here.</p>
              </div>
            ) : (
              <div className="wa-table-wrap">
                <table className="wa-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Worker</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th className="wa-align-right">Earning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <strong>{task.step_name}</strong>
                          <small>
                            {task.source_type === "Order" ? "Order task / " : ""}
                            {task.product_name || task.article_no || "Custom work"}
                          </small>
                        </td>
                        <td>{task.worker_name || "-"}</td>
                        <td>
                          {formatAmount(task.completed_quantity)}/
                          {formatAmount(task.assigned_quantity)}
                        </td>
                        <td>{formatCurrency(task.rate_per_piece)} / pc</td>
                        <td className="wa-amount-cell">
                          {formatCurrency(getTaskEarning(task))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Collapsible Payout History Section (Default Closed) */}
      <section className="wa-panel wa-ledger-panel wa-collapsible-history-panel">
        <button
          className="wa-history-toggle-button"
          onClick={() => setIsPayoutHistoryOpen(!isPayoutHistoryOpen)}
          type="button"
          aria-expanded={isPayoutHistoryOpen}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 1.25rem",
            background: "none",
            border: "none",
            fontSize: "1.1rem",
            fontWeight: "700",
            cursor: "pointer",
            color: "var(--text-color, #0f172a)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>🧾 Payout History</span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)", fontWeight: "500" }}>
              ({visiblePayments.length} recorded payouts &bull; Closed by default)
            </span>
          </div>
          <span>{isPayoutHistoryOpen ? "▲ Hide" : "▼ Expand History"}</span>
        </button>

        {isPayoutHistoryOpen && (
          <>
            <div className="wa-ledger-header" style={{ borderTop: "1px solid var(--border-color, #e2e8f0)" }}>
              <div>
                <h2>Payout Transactions</h2>
              </div>

              <div className="wa-ledger-filters">
                <label className="wa-search-box wa-ledger-search">
                  <Icon name="search" />
                  <input
                    aria-label="Search payouts"
                    onChange={(event) => setPayoutSearch(event.target.value)}
                    placeholder="Search payout"
                    value={payoutSearch}
                  />
                </label>
                <select
                  aria-label="Filter by payment method"
                  onChange={(event) => setMethodFilter(event.target.value)}
                  value={methodFilter}
                >
                  <option>All methods</option>
                  {availableMethods.map((method) => (
                    <option key={method}>{method}</option>
                  ))}
                </select>
              </div>
            </div>

            {visiblePayments.length === 0 ? (
              <div className="wa-empty-state wa-empty-ledger">
                <div className="wa-empty-icon">
                  <Icon name="receipt" />
                </div>
                <h3>No matching payouts</h3>
                <p>Recorded worker payouts will appear here.</p>
              </div>
            ) : (
              <div className="wa-table-wrap">
                <table className="wa-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Worker</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th>Note</th>
                      <th className="wa-align-right">Amount</th>
                      {!isWorkerPortal && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePayments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{formatUtcLocal(payment.paid_at)}</td>
                        <td>
                          <div className="wa-worker-cell is-table-cell">
                            <span>{getInitials(payment.worker_name)}</span>
                            <strong>{payment.worker_name || "Worker"}</strong>
                          </div>
                        </td>
                        <td>
                          <span className="wa-method-pill">
                            {payment.payment_method || "Payout"}
                          </span>
                        </td>
                        <td>{payment.payment_reference || "-"}</td>
                        <td>{payment.note || "-"}</td>
                        <td className="wa-amount-cell">
                          {formatCurrency(payment.amount)}
                        </td>
                        {!isWorkerPortal && (
                          <td>
                            <button
                              aria-label={`Delete payout for ${
                                payment.worker_name || "worker"
                              }`}
                              className="wa-delete-button"
                              onClick={() => deletePayment(payment)}
                              title="Delete payout"
                              type="button"
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Worker Ledger Modal */}
      {selectedLedgerWorker && (
        <WorkerLedgerModal
          worker={selectedLedgerWorker}
          workers={workers}
          tasks={tasks}
          payments={payments}
          onClose={() => setSelectedLedgerWorker(null)}
          onSelectWorker={(w) => setSelectedLedgerWorker(w)}
          onRecordPayout={(w) => {
            selectWorkerForPayout({ worker: w, balance: ledger.find((l) => l.worker.id === w.id)?.balance || 0 });
          }}
        />
      )}
    </div>
  );
}

export default WorkerPayouts;
