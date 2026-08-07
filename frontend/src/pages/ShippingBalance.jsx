import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, apiFetch, getAuthHeaders } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import { formatUtcLocal } from "../utils/dateUtils";
import "./ShippingBalance.css";

const emptyForm = {
  courier_name: "",
  amount: "",
  payment_method: "",
  payment_reference: "",
  payment_date: "",
  note: "",
};

const paymentMethods = [
  "Cash",
  "Bank Transfer",
  "JazzCash",
  "EasyPaisa",
  "Cheque",
  "Other",
];

function Icon({ name, size = 20 }) {
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
    arrow: <path d="m9 18 6-6-6-6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: (
      <>
        <path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="sb-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function ShippingBalance() {
  const confirmDialog = useConfirmDialog();
  const [balances, setBalances] = useState([]);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [courierSearch, setCourierSearch] = useState("");
  const [transactionSearch, setTransactionSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("All methods");
  const [balanceFilter, setBalanceFilter] = useState("All");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const fetchDashboardData = async () => {
    const [balanceResponse, paymentResponse] = await Promise.all([
      apiFetch(`${API_BASE_URL}/courier-balances`),
      apiFetch(`${API_BASE_URL}/courier-payments`),
    ]);

    if (!balanceResponse.ok || !paymentResponse.ok) {
      throw new Error("The courier account data could not be loaded.");
    }

    return Promise.all([balanceResponse.json(), paymentResponse.json()]);
  };

  const loadData = async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    setLoadError("");

    try {
      const [balanceData, paymentData] = await fetchDashboardData();
      setBalances(Array.isArray(balanceData) ? balanceData : []);
      setPayments(Array.isArray(paymentData) ? paymentData : []);
    } catch (error) {
      console.error("Shipping balance loading error:", error);
      setLoadError("Unable to connect to courier accounts. Check the backend and try again.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;

    Promise.all([
      apiFetch(`${API_BASE_URL}/courier-balances`),
      apiFetch(`${API_BASE_URL}/courier-payments`),
    ])
      .then(async ([balanceResponse, paymentResponse]) => {
        if (!balanceResponse.ok || !paymentResponse.ok) {
          throw new Error("The courier account data could not be loaded.");
        }
        return Promise.all([balanceResponse.json(), paymentResponse.json()]);
      })
      .then(([balanceData, paymentData]) => {
        if (!active) return;
        setBalances(Array.isArray(balanceData) ? balanceData : []);
        setPayments(Array.isArray(paymentData) ? paymentData : []);
        setLoadError("");
      })
      .catch((error) => {
        console.error("Shipping balance loading error:", error);
        if (active) {
          setLoadError("Unable to connect to courier accounts. Check the backend and try again.");
        }
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const formatAmount = (value) =>
    Number(value || 0).toLocaleString("en-PK", {
      maximumFractionDigits: 0,
    });

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    return formatUtcLocal(dateValue);
  };

  const totals = useMemo(
    () =>
      balances.reduce(
        (summary, item) => ({
          shippingCost: summary.shippingCost + Number(item.total_shipping_cost || 0),
          paid: summary.paid + Number(item.total_paid || 0),
          due: summary.due + Number(item.balance_due || 0),
          pendingCosts: summary.pendingCosts + Number(item.shipping_cost_pending || 0),
          shipments: summary.shipments + Number(item.total_shipments || 0),
        }),
        { shippingCost: 0, paid: 0, due: 0, pendingCosts: 0, shipments: 0 }
      ),
    [balances]
  );

  const paidPercent =
    totals.shippingCost > 0
      ? Math.min(100, Math.max(0, Math.round((totals.paid / totals.shippingCost) * 100)))
      : 0;

  const selectedCourier = useMemo(
    () =>
      balances.find(
        (item) =>
          item.courier_name.toLowerCase() === form.courier_name.trim().toLowerCase()
      ),
    [balances, form.courier_name]
  );

  const filteredBalances = useMemo(() => {
    const query = courierSearch.trim().toLowerCase();
    return [...balances]
      .filter((item) => {
        const balance = Number(item.balance_due || 0);
        const missingCosts = Number(item.shipping_cost_pending || 0);
        const matchesSearch = item.courier_name.toLowerCase().includes(query);
        const matchesStatus =
          balanceFilter === "All" ||
          (balanceFilter === "Due" && balance > 0) ||
          (balanceFilter === "Clear" && balance === 0) ||
          (balanceFilter === "Advance" && balance < 0) ||
          (balanceFilter === "Missing cost" && missingCosts > 0);

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => Number(b.balance_due || 0) - Number(a.balance_due || 0));
  }, [balanceFilter, balances, courierSearch]);

  const balanceSummary = useMemo(
    () => ({
      advance: balances.filter((item) => Number(item.balance_due || 0) < 0)
        .length,
      clear: balances.filter((item) => Number(item.balance_due || 0) === 0)
        .length,
      due: balances.filter((item) => Number(item.balance_due || 0) > 0)
        .length,
      missingCost: balances.filter(
        (item) => Number(item.shipping_cost_pending || 0) > 0
      ).length,
    }),
    [balances]
  );

  const filteredPayments = useMemo(() => {
    const query = transactionSearch.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesQuery = [
        payment.courier_name,
        payment.payment_reference,
        payment.note,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesMethod =
        methodFilter === "All methods" || payment.payment_method === methodFilter;
      return matchesQuery && matchesMethod;
    });
  }, [methodFilter, payments, transactionSearch]);

  const availableMethods = useMemo(
    () =>
      Array.from(
        new Set(payments.map((payment) => payment.payment_method).filter(Boolean))
      ).sort(),
    [payments]
  );

  const handleChange = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const selectCourierForPayment = (courier) => {
    setForm((previous) => ({
      ...previous,
      courier_name: courier.courier_name,
      amount: courier.balance_due > 0 ? String(courier.balance_due) : previous.amount,
    }));
    setShowPaymentForm(true);
    setNotice("");
    window.requestAnimationFrame(() => {
      document
        .getElementById("courier-payment-form")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const openPaymentForm = () => {
    setShowPaymentForm(true);
    setNotice("");
    window.requestAnimationFrame(() => {
      document
        .getElementById("courier-payment-form")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const addPayment = async (event) => {
    event.preventDefault();
    setNotice("");

    if (!form.courier_name.trim()) {
      setNotice("Choose or enter a courier before recording payment.");
      return;
    }

    if (!form.amount || Number(form.amount) <= 0) {
      setNotice("Enter a payment amount greater than zero.");
      return;
    }

    setLoading(true);

    try {
      const payload = {
        courier_name: form.courier_name.trim(),
        amount: Number(form.amount),
        payment_method: form.payment_method || "",
        payment_reference: form.payment_reference || "",
        note: form.note || "",
        payment_date: form.payment_date
          ? new Date(form.payment_date).toISOString()
          : null,
      };

      const response = await apiFetch(`${API_BASE_URL}/courier-payments`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.detail || "Payment could not be saved.");
      }

      setForm(emptyForm);
      setNotice("Payment recorded successfully.");
      await loadData({ quiet: true });
    } catch (error) {
      console.error("Payment save error:", error);
      setNotice(error.message || "Payment could not be saved.");
    } finally {
      setLoading(false);
    }
  };

  const deletePayment = async (paymentId) => {
    const confirmed = await confirmDialog({
      title: "Delete payment transaction?",
      message: "This will permanently delete this payment transaction.",
      tone: "danger",
      confirmText: "Delete payment",
    });
    if (!confirmed) return;

    try {
      const response = await apiFetch(`${API_BASE_URL}/courier-payments/${paymentId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!response.ok) throw new Error("Payment could not be deleted.");

      setNotice("Payment transaction deleted.");
      await loadData({ quiet: true });
    } catch (error) {
      console.error("Delete payment error:", error);
      setNotice(error.message || "Payment could not be deleted.");
    }
  };

  return (
    <div className="shipping-balance-page">
      <header className="sb-page-header">
        <div>
          <span className="sb-page-kicker">Courier Accounts</span>
          <h1>Shipping Balance</h1>
          <p>Track courier dues, settlements, and missing shipment costs.</p>
        </div>

        <div className="sb-header-actions">
          <div className="sb-settlement-summary">
            <div>
              <span>Settlement progress</span>
              <strong>{paidPercent}%</strong>
            </div>
            <div className="sb-meter-track">
              <span style={{ width: `${paidPercent}%` }} />
            </div>
          </div>

          <button
            className="sb-header-payment-button"
            onClick={openPaymentForm}
            type="button"
          >
            <Icon name="plus" size={17} />
            Record payment
          </button>
          <button
            aria-controls="shipping-balance-header-summary"
            aria-expanded={showSummary}
            className="overview-header-toggle"
            onClick={() => setShowSummary((current) => !current)}
            type="button"
          >
            Overview
            <span aria-hidden="true" className="overview-toggle-chevron" />
          </button>
        </div>

        {showSummary && (
        <section
          className="sb-summary-grid"
          aria-label="Courier account summary"
          id="shipping-balance-header-summary"
        >
          <article className="sb-summary-card">
            <div className="sb-summary-icon">
              <Icon name="receipt" />
            </div>
            <div>
              <span>Total shipping cost</span>
              <strong>PKR {formatAmount(totals.shippingCost)}</strong>
              <small>{formatAmount(totals.shipments)} total shipments</small>
            </div>
          </article>

          <article className="sb-summary-card sb-summary-paid">
            <div className="sb-summary-icon">
              <Icon name="check" />
            </div>
            <div>
              <span>Total settled</span>
              <strong>PKR {formatAmount(totals.paid)}</strong>
              <small>{payments.length} payments recorded</small>
            </div>
          </article>

          <article className="sb-summary-card sb-summary-due">
            <div className="sb-summary-icon">
              <Icon name="wallet" />
            </div>
            <div>
              <span>Outstanding balance</span>
              <strong>PKR {formatAmount(totals.due)}</strong>
              <small>Payable to courier accounts</small>
            </div>
          </article>

          <article className="sb-summary-card sb-summary-pending">
            <div className="sb-summary-icon">
              <Icon name="clock" />
            </div>
            <div>
              <span>Missing shipping cost</span>
              <strong>{formatAmount(totals.pendingCosts)}</strong>
              <small>Shipments needing cost entry</small>
            </div>
          </article>
        </section>
        )}
      </header>

      {loadError && (
        <div className="sb-alert sb-alert-error" role="alert">
          <span>{loadError}</span>
          <button onClick={() => loadData()} type="button">
            Try again
          </button>
        </div>
      )}

      <section className="sb-panel sb-accounts-panel">
        <div className="sb-panel-toolbar">
          <div>
            <h2>Courier accounts</h2>
            <p>{filteredBalances.length} accounts shown</p>
          </div>
          <div className="sb-account-tools">
            <div className="sb-status-filter" aria-label="Filter courier accounts">
              {[
                ["All", balances.length],
                ["Due", balanceSummary.due],
                ["Clear", balanceSummary.clear],
                ["Advance", balanceSummary.advance],
                ["Missing cost", balanceSummary.missingCost],
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
            <label className="sb-search-box">
              <Icon name="search" size={18} />
              <input
                aria-label="Search couriers"
                onChange={(event) => setCourierSearch(event.target.value)}
                placeholder="Search courier"
                value={courierSearch}
              />
            </label>
          </div>
        </div>

        {refreshing && balances.length === 0 ? (
          <div className="sb-loading-rows">
            {[1, 2, 3].map((item) => (
              <div className="sb-loading-row" key={item} />
            ))}
          </div>
        ) : filteredBalances.length === 0 ? (
          <div className="sb-empty-state">
            <div className="sb-empty-icon">
              <Icon name="wallet" size={24} />
            </div>
            <h3>No courier accounts found</h3>
            <p>Add courier and shipping cost details on the Shipping page first.</p>
          </div>
        ) : (
          <div className="sb-account-grid">
            {filteredBalances.map((item) => {
              const balance = Number(item.balance_due || 0);
              const shippingCost = Number(item.total_shipping_cost || 0);
              const paid = Number(item.total_paid || 0);
              const status = balance > 0 ? "due" : balance < 0 ? "advance" : "clear";
              const settlementPercent =
                shippingCost > 0
                  ? Math.min(100, Math.max(0, Math.round((paid / shippingCost) * 100)))
                  : 0;

              return (
                <article className="sb-account-block" key={item.courier_name}>
                  <div className="sb-account-block-header">
                    <div className="sb-courier-cell">
                      <span>{item.courier_name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{item.courier_name}</strong>
                        <small>{item.total_shipments} shipments</small>
                      </div>
                    </div>

                    <span className={`sb-status sb-status-${status}`}>
                      {status === "due"
                        ? "Payment due"
                        : status === "advance"
                        ? "Advance"
                        : "Clear"}
                    </span>
                  </div>

                  <div className="sb-account-total">
                    <span>{status === "advance" ? "Advance balance" : "Outstanding balance"}</span>
                    <strong className={`is-${status}`}>
                      PKR {formatAmount(Math.abs(balance))}
                    </strong>
                  </div>

                  <div className="sb-account-settlement">
                    <div>
                      <span>Settlement</span>
                      <strong>{settlementPercent}%</strong>
                    </div>
                    <div className="sb-account-progress">
                      <span style={{ width: `${settlementPercent}%` }} />
                    </div>
                  </div>

                  <div className="sb-account-metrics">
                    <div>
                      <span>Shipping Cost</span>
                      <strong>PKR {formatAmount(shippingCost)}</strong>
                    </div>
                    <div>
                      <span>Total Paid</span>
                      <strong>PKR {formatAmount(paid)}</strong>
                    </div>
                    <div>
                      <span>Missing Cost</span>
                      <strong className={item.shipping_cost_pending > 0 ? "has-warning" : ""}>
                        {item.shipping_cost_pending}
                      </strong>
                    </div>
                  </div>

                  <button
                    className="sb-account-pay-button"
                    onClick={() => selectCourierForPayment(item)}
                    type="button"
                  >
                    Record payment
                    <Icon name="arrow" size={16} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showPaymentForm && (
        <section className="sb-panel sb-payment-panel" id="courier-payment-form">
          <div className="sb-panel-heading">
            <div>
              <h2>Record courier payment</h2>
              <p>Save a settlement against a courier account.</p>
            </div>

            {selectedCourier && (
              <div className="sb-selected-account">
                <span>Selected balance</span>
                <strong
                  className={
                    selectedCourier.balance_due > 0 ? "is-due" : "is-clear"
                  }
                >
                  {selectedCourier.courier_name} / PKR{" "}
                  {formatAmount(selectedCourier.balance_due)}
                </strong>
              </div>
            )}
            <button
              className="sb-close-form-button"
              onClick={() => setShowPaymentForm(false)}
              type="button"
            >
              Close
            </button>
          </div>

          <form className="sb-payment-form" onSubmit={addPayment}>
          <label className="sb-field">
            <span>Courier account</span>
            <input
              list="courier-list"
              onChange={(event) => handleChange("courier_name", event.target.value)}
              placeholder="Choose courier"
              value={form.courier_name}
            />
            <datalist id="courier-list">
              {balances.map((item) => (
                <option key={item.courier_name} value={item.courier_name} />
              ))}
            </datalist>
          </label>

          <label className="sb-field">
            <span>Amount (PKR)</span>
            <input
              min="1"
              onChange={(event) => handleChange("amount", event.target.value)}
              placeholder="0"
              type="number"
              value={form.amount}
            />
          </label>

          <label className="sb-field">
            <span>Payment method</span>
            <select
              onChange={(event) => handleChange("payment_method", event.target.value)}
              value={form.payment_method}
            >
              <option value="">Select method</option>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>

          <label className="sb-field">
            <span>Reference</span>
            <input
              onChange={(event) =>
                handleChange("payment_reference", event.target.value)
              }
              placeholder="Transaction or cheque no."
              value={form.payment_reference}
            />
          </label>

          <label className="sb-field">
            <span>Payment date</span>
            <input
              onChange={(event) => handleChange("payment_date", event.target.value)}
              type="datetime-local"
              value={form.payment_date}
            />
          </label>

          <label className="sb-field sb-note-field">
            <span>Internal note</span>
            <input
              onChange={(event) => handleChange("note", event.target.value)}
              placeholder="Weekly settlement details"
              value={form.note}
            />
          </label>

          <div className="sb-form-footer">
            {notice ? (
              <div
                className={`sb-form-notice ${
                  notice.includes("successfully") || notice.includes("deleted")
                    ? "is-success"
                    : ""
                }`}
              >
                {notice}
              </div>
            ) : (
              <span className="sb-form-help">
                The courier balance updates immediately.
              </span>
            )}

            <button className="sb-save-button" disabled={loading} type="submit">
              {loading ? "Recording..." : "Record payment"}
            </button>
          </div>
          </form>
        </section>
      )}

      <section className="sb-panel sb-ledger-panel">
        <div className="sb-ledger-header">
          <div>
            <h2>Payment history</h2>
            <p>{filteredPayments.length} transactions shown</p>
          </div>

          <div className="sb-ledger-filters">
            <label className="sb-search-box sb-ledger-search">
              <Icon name="search" size={18} />
              <input
                aria-label="Search transactions"
                onChange={(event) => setTransactionSearch(event.target.value)}
                placeholder="Search payment"
                value={transactionSearch}
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

        {filteredPayments.length === 0 ? (
          <div className="sb-empty-state sb-empty-ledger">
            <div className="sb-empty-icon">
              <Icon name="receipt" size={24} />
            </div>
            <h3>No matching payments</h3>
            <p>Recorded courier payments will appear here.</p>
          </div>
        ) : (
          <div className="sb-table-wrap">
            <table className="sb-payment-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Courier</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Note</th>
                  <th className="sb-align-right">Amount</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <div className="sb-date-cell">
                        <Icon name="calendar" size={16} />
                        {formatDate(payment.payment_date)}
                      </div>
                    </td>
                    <td>
                      <div className="sb-courier-cell">
                        <span>{payment.courier_name.slice(0, 2).toUpperCase()}</span>
                        <strong>{payment.courier_name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="sb-method-pill">
                        {payment.payment_method || "Unspecified"}
                      </span>
                    </td>
                    <td className="sb-reference-cell">
                      {payment.payment_reference || "-"}
                    </td>
                    <td className="sb-note-cell">{payment.note || "-"}</td>
                    <td className="sb-amount-cell">
                      PKR {formatAmount(payment.amount)}
                    </td>
                    <td>
                      <button
                        aria-label={`Delete payment for ${payment.courier_name}`}
                        className="sb-delete-button"
                        onClick={() => deletePayment(payment.id)}
                        title="Delete payment"
                        type="button"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ShippingBalance;
