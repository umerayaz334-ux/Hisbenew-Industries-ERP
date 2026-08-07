import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./Accounting.css";

const EMPTY_ACCOUNT_FORM = {
  name: "",
  account_type: "Bank",
  platform: "",
  currency: "PKR",
  opening_balance: "",
  notes: "",
  is_active: true,
};

const EMPTY_TRANSACTION_FORM = {
  account_id: "",
  direction: "Money In",
  category: "Sales",
  amount: "",
  currency: "PKR",
  exchange_rate: "1",
  amount_pkr: "",
  counterparty: "",
  platform: "",
  reference: "",
  transaction_date: "",
  description: "",
};

const EMPTY_LIST = [];
const EMPTY_SUMMARY = {};

const moneyInCategories = [
  "Sales",
  "Order Payout",
  "Platform Deposit",
  "Owner Deposit",
  "Refund",
  "Other",
];

const moneyOutCategories = [
  "Expense",
  "Worker Payment",
  "Supplier Payment",
  "Courier Payment",
  "Regular Bill",
  "Bank Charge",
  "Refund",
  "Other",
];

const formatNumber = (value, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value || 0));

const formatCurrency = (value, currency = "PKR") => {
  const cleanCurrency = currency || "PKR";
  return `${cleanCurrency} ${formatNumber(value, cleanCurrency === "PKR" ? 0 : 2)}`;
};

const formatDate = (value) => {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const toDatetimeLocal = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

const toOptionalNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  return Number(value);
};

const transactionCategoriesFor = (direction) =>
  direction === "Money Out" ? moneyOutCategories : moneyInCategories;

function Accounting() {
  const confirmDialog = useConfirmDialog();
  const [overview, setOverview] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [transactionModal, setTransactionModal] = useState(null);
  const [transactionForm, setTransactionForm] = useState(EMPTY_TRANSACTION_FORM);
  const [accountModal, setAccountModal] = useState(null);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);

  const accounts = overview?.accounts ?? EMPTY_LIST;
  const platforms = overview?.platforms ?? EMPTY_LIST;
  const summary = overview?.summary ?? EMPTY_SUMMARY;

  const defaultAccountId = useMemo(() => {
    const activeBank = accounts.find(
      (account) => account.is_active && account.account_type !== "Platform"
    );
    return activeBank?.id || accounts[0]?.id || "";
  }, [accounts]);

  const loadAccounting = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewResponse, transactionsResponse] = await Promise.all([
        api.get("/accounting/overview"),
        api.get("/accounting/transactions"),
      ]);
      setOverview(overviewResponse.data);
      setTransactions(transactionsResponse.data || []);
    } catch (loadError) {
      console.error("Accounting load failed", loadError);
      setError("Accounting data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoadId = setTimeout(loadAccounting, 0);
    return () => clearTimeout(initialLoadId);
  }, [loadAccounting]);

  const refreshAfterSave = async (message) => {
    await loadAccounting();
    setNotice(message);
    setTimeout(() => setNotice(""), 3200);
  };

  const openTransactionModal = (direction, transaction = null) => {
    const nextDirection = transaction?.direction || direction || "Money In";
    setTransactionForm({
      ...EMPTY_TRANSACTION_FORM,
      account_id: transaction?.account_id || defaultAccountId,
      direction: nextDirection,
      category:
        transaction?.category ||
        (nextDirection === "Money Out" ? "Expense" : "Sales"),
      amount: transaction?.amount ?? "",
      currency: transaction?.currency || "PKR",
      exchange_rate: transaction?.exchange_rate ?? "1",
      amount_pkr: transaction?.amount_pkr ?? "",
      counterparty: transaction?.counterparty || "",
      platform: transaction?.platform || "",
      reference: transaction?.reference || "",
      transaction_date: toDatetimeLocal(transaction?.transaction_date),
      description: transaction?.description || "",
    });
    setTransactionModal(transaction || { direction: nextDirection });
  };

  const closeTransactionModal = () => {
    setTransactionModal(null);
    setTransactionForm(EMPTY_TRANSACTION_FORM);
  };

  const setTransactionDirection = (direction) => {
    const categories = transactionCategoriesFor(direction);
    setTransactionForm((current) => ({
      ...current,
      direction,
      category: categories.includes(current.category)
        ? current.category
        : categories[0],
    }));
  };

  const handleTransactionSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        account_id: Number(transactionForm.account_id || defaultAccountId),
        direction: transactionForm.direction,
        category: transactionForm.category,
        amount: Number(transactionForm.amount || 0),
        currency: transactionForm.currency,
        exchange_rate: Number(transactionForm.exchange_rate || 0),
        amount_pkr: toOptionalNumber(transactionForm.amount_pkr),
        counterparty: transactionForm.counterparty || null,
        platform: transactionForm.platform || null,
        reference: transactionForm.reference || null,
        transaction_date: transactionForm.transaction_date || null,
        description: transactionForm.description || null,
      };

      if (transactionModal?.id) {
        await api.put(`/accounting/transactions/${transactionModal.id}`, payload);
        await refreshAfterSave("Accounting entry updated.");
      } else {
        await api.post("/accounting/transactions", payload);
        await refreshAfterSave("Accounting entry added.");
      }
      closeTransactionModal();
    } catch (saveError) {
      console.error("Accounting save failed", saveError);
      setError(saveError.response?.data?.detail || "Accounting entry could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteTransaction = async (transactionId) => {
    const confirmed = await confirmDialog({
      title: "Delete accounting entry?",
      message: "This will permanently delete this accounting entry.",
      tone: "danger",
      confirmText: "Delete entry",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/transactions/${transactionId}`);
      await refreshAfterSave("Accounting entry deleted.");
    } catch (deleteError) {
      console.error("Accounting delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Accounting entry could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const openAccountModal = (account = null) => {
    setAccountForm({
      ...EMPTY_ACCOUNT_FORM,
      name: account?.name || "",
      account_type: account?.account_type || "Bank",
      platform: account?.platform || "",
      currency: account?.currency || "PKR",
      opening_balance: account?.opening_balance ?? "",
      notes: account?.notes || "",
      is_active: account?.is_active ?? true,
    });
    setAccountModal(account || {});
  };

  const closeAccountModal = () => {
    setAccountModal(null);
    setAccountForm(EMPTY_ACCOUNT_FORM);
  };

  const handleAccountSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: accountForm.name,
        account_type: accountForm.account_type,
        platform: accountForm.platform || null,
        currency: accountForm.currency,
        opening_balance: Number(accountForm.opening_balance || 0),
        notes: accountForm.notes || null,
        is_active: accountForm.is_active,
      };

      if (accountModal?.id) {
        await api.put(`/accounting/accounts/${accountModal.id}`, payload);
        await refreshAfterSave("Account updated.");
      } else {
        await api.post("/accounting/accounts", payload);
        await refreshAfterSave("Account added.");
      }
      closeAccountModal();
    } catch (saveError) {
      console.error("Account save failed", saveError);
      setError(saveError.response?.data?.detail || "Account could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (accountId) => {
    const confirmed = await confirmDialog({
      title: "Delete account?",
      message: "This will permanently delete this account.",
      tone: "danger",
      confirmText: "Delete account",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/accounts/${accountId}`);
      await refreshAfterSave("Account deleted.");
    } catch (deleteError) {
      console.error("Account delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Account could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const syncPayouts = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await api.post("/accounting/sync-order-payouts");
      setOverview(response.data.overview);
      const transactionsResponse = await api.get("/accounting/transactions");
      setTransactions(transactionsResponse.data || []);
      setNotice(`${response.data.synced || 0} order payouts synced.`);
      setTimeout(() => setNotice(""), 3200);
    } catch (syncError) {
      console.error("Payout sync failed", syncError);
      setError(syncError.response?.data?.detail || "Order payouts could not be synced.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="accounting-page">
      <header className="accounting-header">
        <div>
          <h1>Accounting</h1>
          <p>Accounts, payout totals, expenses, and money movement.</p>
        </div>
        <div className="accounting-header-actions">
          <button
            className="accounting-secondary-btn"
            disabled={saving}
            onClick={syncPayouts}
            type="button"
          >
            Sync payouts
          </button>
          <button
            className="accounting-light-btn"
            onClick={() => openTransactionModal("Money Out")}
            type="button"
          >
            Money out
          </button>
          <button
            className="accounting-primary-btn"
            onClick={() => openTransactionModal("Money In")}
            type="button"
          >
            Money in
          </button>
        </div>
      </header>

      <main className="accounting-body">
        {(notice || error) && (
          <div className={`accounting-alert ${error ? "is-error" : ""}`}>
            {error || notice}
          </div>
        )}

        <section className="accounting-summary-grid" aria-label="Accounting summary">
          <article>
            <span>Money in</span>
            <strong>{formatCurrency(summary.money_in_pkr, "PKR")}</strong>
            <small>{formatNumber(summary.transactions_count)} ledger entries</small>
          </article>
          <article>
            <span>Expenses</span>
            <strong>{formatCurrency(summary.expenses_pkr, "PKR")}</strong>
            <small>Money out: {formatCurrency(summary.money_out_pkr, "PKR")}</small>
          </article>
          <article>
            <span>Net position</span>
            <strong>{formatCurrency(summary.net_pkr, "PKR")}</strong>
            <small>{formatNumber(summary.accounts_count)} accounts</small>
          </article>
          <article>
            <span>Pending payouts</span>
            <strong>USD {formatNumber(summary.pending_platform_payout_usd, 2)}</strong>
            <small>{formatNumber(platforms.length)} platforms</small>
          </article>
        </section>

        <section className="accounting-workspace">
          <div className="accounting-ledger-panel">
            <div className="accounting-panel-heading">
              <div>
                <span>Ledger</span>
                <h2>Money in and out</h2>
              </div>
              <button
                className="accounting-secondary-btn"
                onClick={() => openTransactionModal("Money In")}
                type="button"
              >
                Add entry
              </button>
            </div>

            {loading ? (
              <div className="accounting-empty">Loading accounting records...</div>
            ) : transactions.length === 0 ? (
              <div className="accounting-empty">No accounting entries yet.</div>
            ) : (
              <div className="accounting-table-wrap">
                <table className="accounting-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Account</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>Amount</th>
                      <th>PKR value</th>
                      <th>Reference</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{formatDate(transaction.transaction_date)}</td>
                        <td>
                          <strong>{transaction.account_name || "Account"}</strong>
                          <small>{transaction.counterparty || transaction.platform || "General"}</small>
                        </td>
                        <td>
                          <span
                            className={`accounting-chip ${
                              transaction.direction === "Money Out" ? "is-out" : "is-in"
                            }`}
                          >
                            {transaction.direction}
                          </span>
                        </td>
                        <td>
                          <span>{transaction.category}</span>
                          {transaction.source_type === "order_payout" && (
                            <small className="accounting-auto-tag">Auto</small>
                          )}
                        </td>
                        <td>{formatCurrency(transaction.amount, transaction.currency)}</td>
                        <td>{formatCurrency(transaction.amount_pkr, "PKR")}</td>
                        <td>{transaction.reference || "-"}</td>
                        <td>
                          <div className="accounting-row-actions">
                            <button
                              className="accounting-icon-btn"
                              onClick={() => openTransactionModal(transaction.direction, transaction)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="accounting-icon-btn is-danger"
                              onClick={() => deleteTransaction(transaction.id)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="accounting-side-stack">
            <section className="accounting-side-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Accounts</span>
                  <h2>Balances</h2>
                </div>
                <button
                  className="accounting-secondary-btn"
                  onClick={() => openAccountModal()}
                  type="button"
                >
                  Add
                </button>
              </div>

              <div className="accounting-account-list">
                {accounts.map((account) => (
                  <article className="accounting-account-row" key={account.id}>
                    <div>
                      <strong>{account.name}</strong>
                      <small>
                        {account.account_type}
                        {account.platform ? ` / ${account.platform}` : ""}
                      </small>
                    </div>
                    <div>
                      <span>{formatCurrency(account.balance, account.currency)}</span>
                      <small>{formatCurrency(account.balance_pkr, "PKR")}</small>
                    </div>
                    <div className="accounting-mini-actions">
                      <button onClick={() => openAccountModal(account)} type="button">
                        Edit
                      </button>
                      <button onClick={() => deleteAccount(account.id)} type="button">
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="accounting-side-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Platforms</span>
                  <h2>Payouts</h2>
                </div>
              </div>

              <div className="accounting-platform-list">
                {platforms.length === 0 ? (
                  <div className="accounting-empty compact">No platform orders yet.</div>
                ) : (
                  platforms.map((platform) => (
                    <article className="accounting-platform-row" key={platform.platform}>
                      <div>
                        <strong>{platform.platform}</strong>
                        <small>{formatNumber(platform.orders_count)} orders</small>
                      </div>
                      <dl>
                        <div>
                          <dt>Expected</dt>
                          <dd>USD {formatNumber(platform.expected_usd, 2)}</dd>
                        </div>
                        <div>
                          <dt>Received</dt>
                          <dd>USD {formatNumber(platform.received_usd, 2)}</dd>
                        </div>
                        <div>
                          <dt>Pending</dt>
                          <dd>USD {formatNumber(platform.pending_usd, 2)}</dd>
                        </div>
                      </dl>
                    </article>
                  ))
                )}
              </div>
            </section>
          </aside>
        </section>
      </main>

      {transactionModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{transactionModal.id ? "Edit entry" : "Add entry"}</h2>
              <button onClick={closeTransactionModal} type="button">
                Close
              </button>
            </div>
            <form className="accounting-form" onSubmit={handleTransactionSubmit}>
              <div className="accounting-segmented" role="group" aria-label="Direction">
                {["Money In", "Money Out"].map((direction) => (
                  <button
                    className={transactionForm.direction === direction ? "active" : ""}
                    key={direction}
                    onClick={() => setTransactionDirection(direction)}
                    type="button"
                  >
                    {direction}
                  </button>
                ))}
              </div>

              <div className="accounting-form-grid">
                <label>
                  <span>Account</span>
                  <select
                    required
                    value={transactionForm.account_id}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        account_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Category</span>
                  <select
                    value={transactionForm.category}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                  >
                    {transactionCategoriesFor(transactionForm.direction).map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Amount</span>
                  <input
                    min="0"
                    required
                    step="0.01"
                    type="number"
                    value={transactionForm.amount}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Currency</span>
                  <select
                    value={transactionForm.currency}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        currency: event.target.value,
                        exchange_rate: event.target.value === "PKR" ? "1" : current.exchange_rate,
                      }))
                    }
                  >
                    <option value="PKR">PKR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>

                <label>
                  <span>Exchange rate</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={transactionForm.exchange_rate}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        exchange_rate: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>PKR value</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={transactionForm.amount_pkr}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        amount_pkr: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Counterparty</span>
                  <input
                    value={transactionForm.counterparty}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        counterparty: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Platform</span>
                  <input
                    placeholder="Faire, Amazon"
                    value={transactionForm.platform}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        platform: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Reference</span>
                  <input
                    value={transactionForm.reference}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        reference: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Date</span>
                  <input
                    type="datetime-local"
                    value={transactionForm.transaction_date}
                    onChange={(event) =>
                      setTransactionForm((current) => ({
                        ...current,
                        transaction_date: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <label className="accounting-wide-field">
                <span>Notes</span>
                <textarea
                  rows="3"
                  value={transactionForm.description}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>

              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeTransactionModal} type="button">
                  Cancel
                </button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">
                  Save entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {accountModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal compact-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{accountModal.id ? "Edit account" : "Add account"}</h2>
              <button onClick={closeAccountModal} type="button">
                Close
              </button>
            </div>
            <form className="accounting-form" onSubmit={handleAccountSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Name</span>
                  <input
                    required
                    value={accountForm.name}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Type</span>
                  <select
                    value={accountForm.account_type}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        account_type: event.target.value,
                      }))
                    }
                  >
                    <option value="Bank">Bank</option>
                    <option value="Cash">Cash</option>
                    <option value="Platform">Platform</option>
                    <option value="Wallet">Wallet</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                <label>
                  <span>Platform</span>
                  <input
                    value={accountForm.platform}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        platform: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Currency</span>
                  <select
                    value={accountForm.currency}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        currency: event.target.value,
                      }))
                    }
                  >
                    <option value="PKR">PKR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>

                <label>
                  <span>Opening balance</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={accountForm.opening_balance}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        opening_balance: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="accounting-toggle-field">
                  <input
                    checked={accountForm.is_active}
                    type="checkbox"
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                  />
                  <span>Active</span>
                </label>
              </div>

              <label className="accounting-wide-field">
                <span>Notes</span>
                <textarea
                  rows="3"
                  value={accountForm.notes}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>

              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeAccountModal} type="button">
                  Cancel
                </button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">
                  Save account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Accounting;
