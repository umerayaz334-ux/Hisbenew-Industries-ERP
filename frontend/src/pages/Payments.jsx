import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import "./Payments.css";

const frequencyOptions = ["Weekly", "Monthly", "Quarterly", "Yearly", "One-time"];
const statusOptions = ["Active", "Paused", "Completed"];
const categoryOptions = [
  "Internet",
  "Utilities",
  "Rent",
  "Software",
  "Services",
  "Other",
];
const paymentMethods = [
  "Cash",
  "Bank Transfer",
  "JazzCash",
  "EasyPaisa",
  "Card",
  "Cheque",
  "Other",
];

const formatMoney = (value, currency = "PKR") =>
  `${currency || "PKR"} ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  })}`;

const toInputDateTime = (value) => {
  const date = value ? parseUtcLocal(value) : new Date();
  if (!date) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const defaultBillForm = () => {
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(9, 0, 0, 0);

  return {
    name: "",
    category: "Internet",
    vendor: "",
    amount: "",
    currency: "PKR",
    frequency: "Monthly",
    next_due_date: toInputDateTime(due),
    reminder_days: 7,
    payment_method: "",
    account_reference: "",
    status: "Active",
    notes: "",
  };
};

const defaultPaymentForm = (bill = null) => ({
  amount: bill ? String(bill.amount || "") : "",
  payment_method: bill?.payment_method || "",
  payment_reference: "",
  paid_at: toInputDateTime(new Date()),
  note: "",
});

const paymentFormFromRecord = (bill, payment) => ({
  amount: String(payment.amount || ""),
  payment_method: payment.payment_method || bill?.payment_method || "",
  payment_reference: payment.payment_reference || "",
  paid_at: payment.paid_at ? toInputDateTime(payment.paid_at) : toInputDateTime(new Date()),
  note: payment.note || "",
});

const Icon = ({ name }) => {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    edit: (
      <>
        <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" />
        <path d="m13 6 5 5" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

function Payments() {
  const confirmDialog = useConfirmDialog();
  const [bills, setBills] = useState([]);
  const [billForm, setBillForm] = useState(defaultBillForm);
  const [paymentForm, setPaymentForm] = useState(defaultPaymentForm);
  const [editingBillId, setEditingBillId] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentBill, setPaymentBill] = useState(null);
  const [showBillForm, setShowBillForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");

  const loadBills = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/regular-bills");
      setBills(Array.isArray(response.data) ? response.data : []);
      setNotice("");
    } catch (error) {
      console.error("Regular bills loading error:", error);
      setNotice("Regular bills could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadId = setTimeout(loadBills, 0);
    return () => clearTimeout(loadId);
  }, [loadBills]);

  const billSummary = useMemo(() => {
    const active = bills.filter((bill) => bill.status === "Active");
    const upcoming = active.filter((bill) =>
      ["Overdue", "Due today", "Upcoming"].includes(bill.due_status)
    );
    const overdue = active.filter((bill) => bill.due_status === "Overdue");
    const thisMonth = new Date();

    const paidThisMonth = bills.reduce(
      (sum, bill) =>
        sum +
        (bill.payments || []).reduce((paymentSum, payment) => {
          const paidAt = parseUtcLocal(payment.paid_at);
          if (
            paidAt &&
            paidAt.getMonth() === thisMonth.getMonth() &&
            paidAt.getFullYear() === thisMonth.getFullYear()
          ) {
            return paymentSum + Number(payment.amount || 0);
          }
          return paymentSum;
        }, 0),
      0
    );

    return {
      active: active.length,
      upcoming: upcoming.length,
      overdue: overdue.length,
      dueAmount: upcoming.reduce((sum, bill) => sum + Number(bill.amount || 0), 0),
      paidThisMonth,
    };
  }, [bills]);

  const filteredBills = useMemo(() => {
    const query = search.trim().toLowerCase();

    return bills.filter((bill) => {
      const matchesSearch =
        !query ||
        [
          bill.name,
          bill.vendor,
          bill.category,
          bill.payment_method,
          bill.account_reference,
        ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesFilter =
        filter === "All" ||
        bill.status === filter ||
        bill.due_status === filter ||
        (filter === "Upcoming" &&
          ["Upcoming", "Due today"].includes(bill.due_status));

      return matchesSearch && matchesFilter;
    });
  }, [bills, filter, search]);

  const paymentHistory = useMemo(
    () =>
      bills
        .flatMap((bill) =>
          (bill.payments || []).map((payment) => ({
            ...payment,
            bill_name: bill.name,
            bill,
            currency: bill.currency,
          }))
        )
        .sort(
          (left, right) =>
            (parseUtcLocal(right.paid_at)?.getTime() || 0) -
            (parseUtcLocal(left.paid_at)?.getTime() || 0)
        ),
    [bills]
  );

  const updateBillForm = (event) => {
    const { name, value } = event.target;
    setBillForm((current) => ({ ...current, [name]: value }));
  };

  const updatePaymentForm = (event) => {
    const { name, value } = event.target;
    setPaymentForm((current) => ({ ...current, [name]: value }));
  };

  const openCreateForm = () => {
    setBillForm(defaultBillForm());
    setEditingBillId(null);
    setShowBillForm(true);
    setNotice("");
  };

  const startEditBill = (bill) => {
    setBillForm({
      name: bill.name || "",
      category: bill.category || "Utilities",
      vendor: bill.vendor || "",
      amount: String(bill.amount || ""),
      currency: bill.currency || "PKR",
      frequency: bill.frequency || "Monthly",
      next_due_date: bill.next_due_date ? toInputDateTime(bill.next_due_date) : "",
      reminder_days: bill.reminder_days ?? 7,
      payment_method: bill.payment_method || "",
      account_reference: bill.account_reference || "",
      status: bill.status || "Active",
      notes: bill.notes || "",
    });
    setEditingBillId(bill.id);
    setShowBillForm(true);
    setNotice("");
  };

  const closeBillForm = () => {
    setShowBillForm(false);
    setEditingBillId(null);
    setBillForm(defaultBillForm());
  };

  const saveBill = async (event) => {
    event.preventDefault();
    if (!billForm.name.trim()) {
      setNotice("Bill name is required.");
      return;
    }
    if (Number(billForm.amount) < 0) {
      setNotice("Amount cannot be negative.");
      return;
    }

    const payload = {
      ...billForm,
      amount: Number(billForm.amount || 0),
      reminder_days: Number(billForm.reminder_days || 0),
      next_due_date: billForm.next_due_date
        ? new Date(billForm.next_due_date).toISOString()
        : null,
    };

    setSaving(true);
    try {
      if (editingBillId) {
        await api.put(`/regular-bills/${editingBillId}`, payload);
      } else {
        await api.post("/regular-bills", payload);
      }
      await loadBills();
      closeBillForm();
      setNotice(editingBillId ? "Bill updated." : "Bill added.");
    } catch (error) {
      console.error("Regular bill save error:", error);
      setNotice(error.response?.data?.detail || "Bill could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteBill = async (bill) => {
    const confirmed = await confirmDialog({
      title: "Delete bill?",
      message: `This will permanently delete ${bill.name}.`,
      tone: "danger",
      confirmText: "Delete bill",
    });
    if (!confirmed) return;

    try {
      await api.delete(`/regular-bills/${bill.id}`);
      await loadBills();
      setNotice("Bill deleted.");
    } catch (error) {
      console.error("Regular bill delete error:", error);
      setNotice(error.response?.data?.detail || "Bill could not be deleted.");
    }
  };

  const openPaymentModal = (bill) => {
    setEditingPayment(null);
    setPaymentBill(bill);
    setPaymentForm(defaultPaymentForm(bill));
    setNotice("");
  };

  const openEditPaymentModal = (payment) => {
    setEditingPayment(payment);
    setPaymentBill(payment.bill);
    setPaymentForm(paymentFormFromRecord(payment.bill, payment));
    setNotice("");
  };

  const closePaymentModal = () => {
    setEditingPayment(null);
    setPaymentBill(null);
    setPaymentForm(defaultPaymentForm());
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    if (!paymentBill) return;
    if (Number(paymentForm.amount) <= 0) {
      setNotice("Payment amount must be greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...paymentForm,
        amount: Number(paymentForm.amount || 0),
        paid_at: paymentForm.paid_at
          ? new Date(paymentForm.paid_at).toISOString()
          : null,
      };

      if (editingPayment) {
        await api.put(
          `/regular-bills/${paymentBill.id}/payments/${editingPayment.id}`,
          payload
        );
      } else {
        await api.post(`/regular-bills/${paymentBill.id}/payments`, payload);
      }

      await loadBills();
      closePaymentModal();
      setNotice(editingPayment ? "Payment updated." : `${paymentBill.name} marked paid.`);
    } catch (error) {
      console.error("Regular bill payment error:", error);
      setNotice(error.response?.data?.detail || "Payment could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async (payment) => {
    const confirmed = await confirmDialog({
      title: "Delete payment?",
      message: `This will permanently delete the payment for ${payment.bill_name}.`,
      tone: "danger",
      confirmText: "Delete payment",
    });
    if (!confirmed) return;

    try {
      await api.delete(`/regular-bills/${payment.bill_id}/payments/${payment.id}`);
      await loadBills();
      setNotice("Payment deleted.");
    } catch (error) {
      console.error("Regular bill payment delete error:", error);
      setNotice(error.response?.data?.detail || "Payment could not be deleted.");
    }
  };

  const dueText = (bill) => {
    if (bill.status !== "Active") return bill.status;
    if (bill.days_until_due == null) return "No due date";
    if (bill.days_until_due < 0) {
      return `${Math.abs(bill.days_until_due)} days overdue`;
    }
    if (bill.days_until_due === 0) return "Due today";
    return `Due in ${bill.days_until_due} days`;
  };

  return (
    <div className="payments-page">
      <header className="payments-header">
        <div>
          <span>Billings</span>
          <h1>Regular Bills</h1>
        </div>
        <button className="payments-primary-btn" onClick={openCreateForm} type="button">
          <Icon name="plus" />
          Add bill
        </button>
      </header>

      {notice && <div className="payments-notice">{notice}</div>}

      <section className="payments-summary" aria-label="Regular billing summary">
        <article>
          <span>Upcoming</span>
          <strong>{billSummary.upcoming}</strong>
          <small>{formatMoney(billSummary.dueAmount)}</small>
        </article>
        <article className={billSummary.overdue > 0 ? "is-alert" : ""}>
          <span>Overdue</span>
          <strong>{billSummary.overdue}</strong>
          <small>Needs payment</small>
        </article>
        <article>
          <span>Active bills</span>
          <strong>{billSummary.active}</strong>
          <small>{bills.length} total records</small>
        </article>
        <article>
          <span>Paid this month</span>
          <strong>{formatMoney(billSummary.paidThisMonth)}</strong>
          <small>Recorded payments</small>
        </article>
      </section>

      <section className="payments-toolbar" aria-label="Filter regular bills">
        <div className="payments-search">
          <Icon name="search" />
          <input
            aria-label="Search regular bills"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search bill, vendor, method, or reference"
            value={search}
          />
        </div>
        <div className="payments-tabs" role="group" aria-label="Bill status filter">
          {["All", "Upcoming", "Overdue", "Active", "Paused", "Completed"].map(
            (item) => (
              <button
                aria-pressed={filter === item}
                className={filter === item ? "is-active" : ""}
                key={item}
                onClick={() => setFilter(item)}
                type="button"
              >
                {item}
              </button>
            )
          )}
        </div>
      </section>

      <main className="payments-layout">
        <section className="payments-bill-list">
          {loading ? (
            <div className="payments-empty">Loading bills...</div>
          ) : filteredBills.length === 0 ? (
            <div className="payments-empty">No regular bills found.</div>
          ) : (
            filteredBills.map((bill) => (
              <article className="payment-bill-card" key={bill.id}>
                <div className="payment-bill-main">
                  <div>
                    <span className="payment-category">{bill.category || "Bill"}</span>
                    <h2>{bill.name}</h2>
                    <p>{bill.vendor || bill.account_reference || "No vendor"}</p>
                  </div>
                  <span
                    className={`payment-status status-${String(
                      bill.due_status || bill.status
                    )
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {bill.due_status || bill.status}
                  </span>
                </div>

                <div className="payment-bill-grid">
                  <div>
                    <span>Amount</span>
                    <strong>{formatMoney(bill.amount, bill.currency)}</strong>
                  </div>
                  <div>
                    <span>Next due</span>
                    <strong>{bill.next_due_date ? formatUtcLocal(bill.next_due_date) : "-"}</strong>
                    <small>{dueText(bill)}</small>
                  </div>
                  <div>
                    <span>Frequency</span>
                    <strong>{bill.frequency}</strong>
                    <small>{bill.reminder_days} day notice</small>
                  </div>
                  <div>
                    <span>Method</span>
                    <strong>{bill.payment_method || "-"}</strong>
                  </div>
                </div>

                <div className="payment-card-actions">
                  {bill.status === "Active" && (
                    <button
                      className="payments-primary-btn"
                      onClick={() => openPaymentModal(bill)}
                      type="button"
                    >
                      <Icon name="check" />
                      Mark paid
                    </button>
                  )}
                  <button
                    className="payments-secondary-btn"
                    onClick={() => startEditBill(bill)}
                    type="button"
                  >
                    <Icon name="edit" />
                    Edit
                  </button>
                  <button
                    className="payments-danger-btn"
                    onClick={() => deleteBill(bill)}
                    type="button"
                  >
                    <Icon name="trash" />
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </section>

        <aside className="payments-history">
          <button
            aria-expanded={showHistory}
            className="payments-history-toggle"
            onClick={() => setShowHistory((current) => !current)}
            type="button"
          >
            <span>
              <small>Ledger</small>
              <strong>Payment history</strong>
            </span>
            <span className="payments-history-count">{paymentHistory.length}</span>
            <Icon name="chevron" />
          </button>
          {showHistory && paymentHistory.length === 0 && (
            <div className="payments-empty compact">No payments recorded.</div>
          )}
          {showHistory && paymentHistory.length > 0 && (
            <div className="payments-ledger-list">
              {paymentHistory.map((payment) => (
                <div key={payment.id}>
                  <span className="payments-ledger-details">
                    <strong>{payment.bill_name}</strong>
                    <small>
                      {formatUtcLocal(payment.paid_at)}
                      {payment.payment_method ? ` - ${payment.payment_method}` : ""}
                    </small>
                  </span>
                  <strong className="payments-ledger-amount">
                    {formatMoney(payment.amount, payment.currency)}
                  </strong>
                  <span className="payments-ledger-actions">
                    <button
                      aria-label={`Edit payment for ${payment.bill_name}`}
                      className="payments-secondary-btn"
                      onClick={() => openEditPaymentModal(payment)}
                      type="button"
                    >
                      <Icon name="edit" />
                      Edit
                    </button>
                    <button
                      aria-label={`Delete payment for ${payment.bill_name}`}
                      className="payments-danger-btn"
                      onClick={() => deletePayment(payment)}
                      type="button"
                    >
                      <Icon name="trash" />
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </main>

      {showBillForm && (
        <div className="payments-overlay" onClick={closeBillForm}>
          <form className="payments-drawer" onClick={(event) => event.stopPropagation()} onSubmit={saveBill}>
            <div className="payments-form-header">
              <div>
                <span>{editingBillId ? "Edit bill" : "New bill"}</span>
                <h2>{editingBillId ? "Update regular bill" : "Add regular bill"}</h2>
              </div>
              <button className="payments-secondary-btn" onClick={closeBillForm} type="button">
                Close
              </button>
            </div>

            <div className="payments-form-grid">
              <label>
                <span>Bill name</span>
                <input name="name" onChange={updateBillForm} required value={billForm.name} />
              </label>
              <label>
                <span>Category</span>
                <select name="category" onChange={updateBillForm} value={billForm.category}>
                  {categoryOptions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Vendor</span>
                <input name="vendor" onChange={updateBillForm} value={billForm.vendor} />
              </label>
              <label>
                <span>Amount</span>
                <input min="0" name="amount" onChange={updateBillForm} step="0.01" type="number" value={billForm.amount} />
              </label>
              <label>
                <span>Currency</span>
                <input name="currency" onChange={updateBillForm} value={billForm.currency} />
              </label>
              <label>
                <span>Frequency</span>
                <select name="frequency" onChange={updateBillForm} value={billForm.frequency}>
                  {frequencyOptions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Next due</span>
                <input name="next_due_date" onChange={updateBillForm} type="datetime-local" value={billForm.next_due_date} />
              </label>
              <label>
                <span>Notice days</span>
                <input min="0" name="reminder_days" onChange={updateBillForm} type="number" value={billForm.reminder_days} />
              </label>
              <label>
                <span>Payment method</span>
                <select name="payment_method" onChange={updateBillForm} value={billForm.payment_method}>
                  <option value="">Not set</option>
                  {paymentMethods.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select name="status" onChange={updateBillForm} value={billForm.status}>
                  {statusOptions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="payments-wide-field">
                <span>Account reference</span>
                <input name="account_reference" onChange={updateBillForm} value={billForm.account_reference} />
              </label>
              <label className="payments-wide-field">
                <span>Notes</span>
                <textarea name="notes" onChange={updateBillForm} rows="3" value={billForm.notes} />
              </label>
            </div>

            <div className="payments-form-actions">
              <button className="payments-secondary-btn" onClick={closeBillForm} type="button">
                Cancel
              </button>
              <button className="payments-primary-btn" disabled={saving} type="submit">
                {saving ? "Saving..." : "Save bill"}
              </button>
            </div>
          </form>
        </div>
      )}

      {paymentBill && (
        <div className="payments-overlay" onClick={closePaymentModal}>
          <form className="payments-modal" onClick={(event) => event.stopPropagation()} onSubmit={recordPayment}>
            <div className="payments-form-header">
              <div>
                <span>{editingPayment ? "Edit payment" : "Record payment"}</span>
                <h2>{paymentBill.name}</h2>
              </div>
              <button className="payments-secondary-btn" onClick={closePaymentModal} type="button">
                Close
              </button>
            </div>

            <label>
              <span>Amount</span>
              <input min="0.01" name="amount" onChange={updatePaymentForm} step="0.01" type="number" value={paymentForm.amount} />
            </label>
            <label>
              <span>Payment method</span>
              <select name="payment_method" onChange={updatePaymentForm} value={paymentForm.payment_method}>
                <option value="">Not set</option>
                {paymentMethods.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Reference</span>
              <input name="payment_reference" onChange={updatePaymentForm} value={paymentForm.payment_reference} />
            </label>
            <label>
              <span>Paid at</span>
              <input name="paid_at" onChange={updatePaymentForm} type="datetime-local" value={paymentForm.paid_at} />
            </label>
            <label>
              <span>Note</span>
              <textarea name="note" onChange={updatePaymentForm} rows="3" value={paymentForm.note} />
            </label>

            <div className="payments-form-actions">
              <button className="payments-secondary-btn" onClick={closePaymentModal} type="button">
                Cancel
              </button>
              <button className="payments-primary-btn" disabled={saving} type="submit">
                {saving ? "Saving..." : editingPayment ? "Save payment" : "Record payment"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Payments;
