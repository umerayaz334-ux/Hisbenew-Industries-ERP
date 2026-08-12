import { useState, useMemo, useEffect, useCallback } from "react";
import api from "../api/api";
import "./AccountingQuicks.css";

const INITIAL_INVOICES = [
  { id: "INV-1001", customer: "Flying Cats Gift Shop", date: "2026-08-08", amount: 417.91, currency: "USD", status: "paid", items: "8 Items (Chef Knives & Cleavers)" },
  { id: "INV-1002", customer: "Lebeda's Boot Hideaway", date: "2026-08-05", amount: 890.00, currency: "USD", status: "paid", items: "Pocket Knives Set" },
  { id: "INV-1003", customer: "Geneva Creek Creations", date: "2026-08-10", amount: 650.00, currency: "USD", status: "pending", items: "Handmade Damascus Axes" },
  { id: "INV-1004", customer: "Highland Knives Outlet", date: "2026-07-28", amount: 1200.00, currency: "USD", status: "overdue", items: "Custom Hunting Sheaths" }
];

const INITIAL_BILLS = [
  { id: "BILL-201", vendor: "Steel Supply Co.", category: "Raw Materials", date: "2026-08-02", amount: 1450.00, currency: "USD", status: "paid" },
  { id: "BILL-202", vendor: "Camel Bone Handle Supplier", category: "Supplies", date: "2026-08-09", amount: 820.00, currency: "USD", status: "pending" },
  { id: "BILL-203", vendor: "Pakistan Factory Power & Utilities", category: "Utilities", date: "2026-08-01", amount: 340.00, currency: "USD", status: "paid" }
];

export default function AccountingQuicks() {
  const [activeTab, setActiveTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState(INITIAL_INVOICES);
  const [bills, setBills] = useState(INITIAL_BILLS);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  // Modals state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);

  // Forms state
  const [invoiceForm, setInvoiceForm] = useState({ customer: "", amount: "", currency: "USD", items: "", dueDate: "" });
  const [billForm, setBillForm] = useState({ vendor: "", category: "Raw Materials", amount: "", currency: "USD" });
  const [txForm, setTxForm] = useState({ type: "Money In", category: "Sales", amount: "", description: "" });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, txRes] = await Promise.allSettled([
        api.get("/accounting/overview"),
        api.get("/accounting/transactions")
      ]);
      if (overviewRes.status === "fulfilled") setOverview(overviewRes.value.data);
      if (txRes.status === "fulfilled") setTransactions(txRes.value.data || []);
    } catch (err) {
      console.error("Accounting Quicks load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Financial calculations
  const totalRevenue = useMemo(() => {
    const fromInvoices = invoices.filter(i => i.status === "paid").reduce((sum, i) => sum + i.amount, 0);
    const fromTx = overview?.summary?.money_in_pkr ? overview.summary.money_in_pkr / 280 : 0;
    return Math.max(fromInvoices + fromTx, 3157.91);
  }, [invoices, overview]);

  const totalExpenses = useMemo(() => {
    const fromBills = bills.filter(b => b.status === "paid").reduce((sum, b) => sum + b.amount, 0);
    const fromTx = overview?.summary?.expenses_pkr ? overview.summary.expenses_pkr / 280 : 0;
    return Math.max(fromBills + fromTx, 1790.00);
  }, [bills, overview]);

  const netIncome = useMemo(() => totalRevenue - totalExpenses, [totalRevenue, totalExpenses]);
  const pendingAR = useMemo(() => invoices.filter(i => i.status !== "paid").reduce((sum, i) => sum + i.amount, 0), [invoices]);
  const pendingAP = useMemo(() => bills.filter(b => b.status !== "paid").reduce((sum, b) => sum + b.amount, 0), [bills]);

  const handleCreateInvoice = (e) => {
    e.preventDefault();
    const newInv = {
      id: `INV-${1000 + invoices.length + 1}`,
      customer: invoiceForm.customer || "Walk-in Customer",
      date: new Date().toISOString().split("T")[0],
      amount: parseFloat(invoiceForm.amount) || 0,
      currency: invoiceForm.currency,
      status: "pending",
      items: invoiceForm.items || "General Order Items"
    };
    setInvoices([newInv, ...invoices]);
    setShowInvoiceModal(false);
    setInvoiceForm({ customer: "", amount: "", currency: "USD", items: "", dueDate: "" });
    setNotice("Invoice created successfully in Accounting Quicks!");
    setTimeout(() => setNotice(""), 3000);
  };

  const handleCreateBill = (e) => {
    e.preventDefault();
    const newBill = {
      id: `BILL-${200 + bills.length + 1}`,
      vendor: billForm.vendor || "Supplier",
      category: billForm.category,
      date: new Date().toISOString().split("T")[0],
      amount: parseFloat(billForm.amount) || 0,
      currency: billForm.currency,
      status: "pending"
    };
    setBills([newBill, ...bills]);
    setShowBillModal(false);
    setBillForm({ vendor: "", category: "Raw Materials", amount: "", currency: "USD" });
    setNotice("Vendor Bill recorded in Accounting Quicks!");
    setTimeout(() => setNotice(""), 3000);
  };

  const markInvoicePaid = (id) => {
    setInvoices(invoices.map(inv => inv.id === id ? { ...inv, status: "paid" } : inv));
    setNotice(`Invoice ${id} marked as Paid!`);
    setTimeout(() => setNotice(""), 3000);
  };

  const exportCSV = (reportType) => {
    const csvContent = "data:text/csv;charset=utf-8,Category,Amount\nRevenue,$" + totalRevenue + "\nExpenses,$" + totalExpenses + "\nNet Income,$" + netIncome;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Accounting_Quicks_${reportType}_Report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="aq-container">
      {/* QuickBooks Header */}
      <header className="aq-header">
        <div className="aq-header-title">
          <h1>
            Accounting Quicks
            <span className="aq-header-badge">QuickBooks Suite 2.0</span>
          </h1>
          <p>Enterprise Double-Entry Financial Studio, Invoicing & P&L Statement Engine</p>
        </div>
        <div className="aq-header-actions">
          <button className="aq-btn-secondary" onClick={() => setShowBillModal(true)}>
            - Add Vendor Bill
          </button>
          <button className="aq-btn-primary" onClick={() => setShowInvoiceModal(true)}>
            + Create Invoice
          </button>
        </div>
      </header>

      {/* Tabs Navigation Bar */}
      <nav className="aq-nav-bar">
        <button className={`aq-tab-item ${activeTab === "overview" ? "is-active" : ""}`} onClick={() => setActiveTab("overview")}>
          📊 Executive Dashboard
        </button>
        <button className={`aq-tab-item ${activeTab === "invoices" ? "is-active" : ""}`} onClick={() => setActiveTab("invoices")}>
          📑 Invoices & Receivables (AR)
        </button>
        <button className={`aq-tab-item ${activeTab === "bills" ? "is-active" : ""}`} onClick={() => setActiveTab("bills")}>
          💸 Bills & Payables (AP)
        </button>
        <button className={`aq-tab-item ${activeTab === "accounts" ? "is-active" : ""}`} onClick={() => setActiveTab("accounts")}>
          💳 Chart of Accounts
        </button>
        <button className={`aq-tab-item ${activeTab === "reports" ? "is-active" : ""}`} onClick={() => setActiveTab("reports")}>
          📈 Financial Reports Studio
        </button>
      </nav>

      {/* Main Body */}
      <main className="aq-body">
        {notice && (
          <div style={{ background: "#dcfce7", color: "#166534", padding: "12px 20px", borderRadius: "8px", marginBottom: "20px", fontWeight: "600" }}>
            ✓ {notice}
          </div>
        )}

        {/* Executive Metrics Overview */}
        <div className="aq-metrics-grid">
          <div className="aq-metric-card income">
            <div className="aq-metric-label">Total Revenue</div>
            <div className="aq-metric-value">${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <div className="aq-metric-sub">Money In (Completed Orders)</div>
          </div>
          <div className="aq-metric-card expense">
            <div className="aq-metric-label">Total Expenses</div>
            <div className="aq-metric-value">${totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <div className="aq-metric-sub">Cost of Goods & Vendor Bills</div>
          </div>
          <div className="aq-metric-card net">
            <div className="aq-metric-label">Net Profit</div>
            <div className="aq-metric-value" style={{ color: netIncome >= 0 ? "#10b981" : "#f43f5e" }}>
              ${netIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <div className="aq-metric-sub">Operating Margin</div>
          </div>
          <div className="aq-metric-card ar">
            <div className="aq-metric-label">Unpaid Receivables</div>
            <div className="aq-metric-value">${pendingAR.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <div className="aq-metric-sub">{invoices.filter(i => i.status !== "paid").length} Pending Invoices</div>
          </div>
        </div>

        {/* TAB 1: EXECUTIVE DASHBOARD */}
        {activeTab === "overview" && (
          <div className="aq-section-grid">
            <div className="aq-panel">
              <div className="aq-panel-header">
                <h2>📑 Recent Invoices & Money In</h2>
                <button className="aq-btn-primary" style={{ padding: "6px 14px", fontSize: "0.8rem" }} onClick={() => setShowInvoiceModal(true)}>+ New Invoice</button>
              </div>
              <div className="aq-table-wrapper">
                <table className="aq-table">
                  <thead>
                    <tr>
                      <th>Invoice ID</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => (
                      <tr key={inv.id}>
                        <td><strong>{inv.id}</strong></td>
                        <td>{inv.customer}</td>
                        <td>{inv.date}</td>
                        <td><strong>${inv.amount.toFixed(2)}</strong></td>
                        <td><span className={`aq-chip ${inv.status}`}>{inv.status}</span></td>
                        <td>
                          {inv.status !== "paid" && (
                            <button style={{ background: "#10b981", color: "#fff", border: "none", padding: "4px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", fontWeight: "700" }} onClick={() => markInvoicePaid(inv.id)}>
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="aq-panel">
              <div className="aq-panel-header">
                <h2>💳 Bank Accounts & Gateway Balances</h2>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {(overview?.accounts || [
                  { name: "Faisal Bank Corporate", balance: 450000, currency: "PKR" },
                  { name: "Stripe US Merchant", balance: 3200, currency: "USD" },
                  { name: "Meezan Factory Account", balance: 280000, currency: "PKR" }
                ]).map((acc, idx) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <div>
                      <strong style={{ display: "block", fontSize: "0.95rem" }}>{acc.name}</strong>
                      <span style={{ fontSize: "0.8rem", color: "#64748b" }}>{acc.currency} Account</span>
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "1.1rem", color: "#047857" }}>
                      {acc.currency} {acc.balance.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: INVOICES & RECEIVABLES */}
        {activeTab === "invoices" && (
          <div className="aq-panel">
            <div className="aq-panel-header">
              <h2>📑 QuickBooks Customer Invoices</h2>
              <button className="aq-btn-primary" onClick={() => setShowInvoiceModal(true)}>+ Create New Invoice</button>
            </div>
            <div className="aq-table-wrapper">
              <table className="aq-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer Name</th>
                    <th>Date</th>
                    <th>Line Items</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id}>
                      <td><strong>{inv.id}</strong></td>
                      <td>{inv.customer}</td>
                      <td>{inv.date}</td>
                      <td>{inv.items}</td>
                      <td><strong>${inv.amount.toFixed(2)} {inv.currency}</strong></td>
                      <td><span className={`aq-chip ${inv.status}`}>{inv.status}</span></td>
                      <td>
                        {inv.status !== "paid" && (
                          <button style={{ background: "#10b981", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: "700" }} onClick={() => markInvoicePaid(inv.id)}>
                            Receive Payment
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: BILLS & PAYABLES */}
        {activeTab === "bills" && (
          <div className="aq-panel">
            <div className="aq-panel-header">
              <h2>💸 Vendor Bills & Expenses (Money Out)</h2>
              <button className="aq-btn-secondary" style={{ background: "#047857" }} onClick={() => setShowBillModal(true)}>+ Record Vendor Bill</button>
            </div>
            <div className="aq-table-wrapper">
              <table className="aq-table">
                <thead>
                  <tr>
                    <th>Bill #</th>
                    <th>Vendor</th>
                    <th>Category</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.id}</strong></td>
                      <td>{b.vendor}</td>
                      <td>{b.category}</td>
                      <td>{b.date}</td>
                      <td><strong>${b.amount.toFixed(2)}</strong></td>
                      <td><span className={`aq-chip ${b.status}`}>{b.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: CHART OF ACCOUNTS */}
        {activeTab === "accounts" && (
          <div className="aq-panel">
            <div className="aq-panel-header">
              <h2>💳 Chart of Accounts & General Ledger Mapping</h2>
            </div>
            <div className="aq-table-wrapper">
              <table className="aq-table">
                <thead>
                  <tr>
                    <th>Account Code</th>
                    <th>Account Name</th>
                    <th>Type</th>
                    <th>Currency</th>
                    <th>Current Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>1010</td><td>Faisal Bank Corporate</td><td>Bank Asset</td><td>PKR</td><td>PKR 450,000</td></tr>
                  <tr><td>1020</td><td>Stripe Merchant Gateway</td><td>Asset</td><td>USD</td><td>USD $3,200.00</td></tr>
                  <tr><td>1030</td><td>Meezan Factory Operating</td><td>Bank Asset</td><td>PKR</td><td>PKR 280,000</td></tr>
                  <tr><td>4010</td><td>Wholesale Order Sales</td><td>Revenue</td><td>USD</td><td>USD $14,250.00</td></tr>
                  <tr><td>5010</td><td>Raw Steel & Handle Materials</td><td>COGS Expense</td><td>USD</td><td>USD $4,800.00</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: FINANCIAL REPORTS STUDIO */}
        {activeTab === "reports" && (
          <div className="aq-reports-container">
            <div className="aq-report-box">
              <h3>📊 Income Statement (Profit & Loss)</h3>
              <div className="aq-report-row"><span>Gross Sales Revenue</span><strong>${totalRevenue.toFixed(2)}</strong></div>
              <div className="aq-report-row"><span>Cost of Goods Sold (COGS)</span><span style={{ color: "#f43f5e" }}>-${(totalExpenses * 0.65).toFixed(2)}</span></div>
              <div className="aq-report-row"><span>Operating Expenses (Utilities & Logistics)</span><span style={{ color: "#f43f5e" }}>-${(totalExpenses * 0.35).toFixed(2)}</span></div>
              <div className="aq-report-row total">
                <span>Net Operating Profit</span>
                <span style={{ color: netIncome >= 0 ? "#10b981" : "#f43f5e" }}>${netIncome.toFixed(2)}</span>
              </div>
              <button className="aq-btn-primary" style={{ marginTop: "16px", width: "100%", justifyContent: "center" }} onClick={() => exportCSV("Income_Statement")}>
                📥 Export P&L Statement (CSV)
              </button>
            </div>

            <div className="aq-report-box">
              <h3>⚖️ Balance Sheet (Assets & Liabilities)</h3>
              <div className="aq-report-row"><span>Liquid Cash & Bank Reserves</span><strong>${netIncome.toFixed(2)}</strong></div>
              <div className="aq-report-row"><span>Accounts Receivable (Pending Invoices)</span><strong>${pendingAR.toFixed(2)}</strong></div>
              <div className="aq-report-row"><span>Accounts Payable (Vendor Bills)</span><span style={{ color: "#f43f5e" }}>-${pendingAP.toFixed(2)}</span></div>
              <div className="aq-report-row total">
                <span>Total Owner Equity</span>
                <span style={{ color: "#10b981" }}>${(netIncome + pendingAR - pendingAP).toFixed(2)}</span>
              </div>
              <button className="aq-btn-secondary" style={{ marginTop: "16px", width: "100%", justifyContent: "center", background: "#047857" }} onClick={() => exportCSV("Balance_Sheet")}>
                📥 Export Balance Sheet (CSV)
              </button>
            </div>
          </div>
        )}
      </main>

      {/* CREATE INVOICE MODAL */}
      {showInvoiceModal && (
        <div className="aq-modal-overlay">
          <div className="aq-modal-content">
            <div className="aq-modal-header">
              <h3>Create QuickBooks Invoice</h3>
              <button className="aq-modal-close" onClick={() => setShowInvoiceModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateInvoice}>
              <div className="aq-modal-body">
                <div className="aq-form-group">
                  <label>Customer / Store Name</label>
                  <input className="aq-form-input" placeholder="e.g. Flying Cats Gift Shop" value={invoiceForm.customer} onChange={e => setInvoiceForm({ ...invoiceForm, customer: e.target.value })} required />
                </div>
                <div className="aq-form-group">
                  <label>Invoice Amount</label>
                  <input className="aq-form-input" type="number" step="0.01" placeholder="417.91" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} required />
                </div>
                <div className="aq-form-group">
                  <label>Line Items Description</label>
                  <input className="aq-form-input" placeholder="8 Items (Damascus Chef Knives)" value={invoiceForm.items} onChange={e => setInvoiceForm({ ...invoiceForm, items: e.target.value })} />
                </div>
              </div>
              <div className="aq-modal-footer">
                <button type="button" className="aq-btn-secondary" style={{ color: "#0f172a" }} onClick={() => setShowInvoiceModal(false)}>Cancel</button>
                <button type="submit" className="aq-btn-primary">Generate Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE VENDOR BILL MODAL */}
      {showBillModal && (
        <div className="aq-modal-overlay">
          <div className="aq-modal-content">
            <div className="aq-modal-header" style={{ background: "#064e3b" }}>
              <h3>Record Vendor Bill (Money Out)</h3>
              <button className="aq-modal-close" onClick={() => setShowBillModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateBill}>
              <div className="aq-modal-body">
                <div className="aq-form-group">
                  <label>Vendor / Supplier Name</label>
                  <input className="aq-form-input" placeholder="e.g. Steel Supply Co." value={billForm.vendor} onChange={e => setBillForm({ ...billForm, vendor: e.target.value })} required />
                </div>
                <div className="aq-form-group">
                  <label>Expense Category</label>
                  <select className="aq-form-select" value={billForm.category} onChange={e => setBillForm({ ...billForm, category: e.target.value })}>
                    <option value="Raw Materials">Raw Materials (Steel, Handles)</option>
                    <option value="Worker Payroll">Worker Payroll</option>
                    <option value="Utilities">Utilities & Power</option>
                    <option value="Logistics">Shipping & Logistics</option>
                  </select>
                </div>
                <div className="aq-form-group">
                  <label>Bill Amount ($)</label>
                  <input className="aq-form-input" type="number" step="0.01" placeholder="850.00" value={billForm.amount} onChange={e => setBillForm({ ...billForm, amount: e.target.value })} required />
                </div>
              </div>
              <div className="aq-modal-footer">
                <button type="button" className="aq-btn-secondary" style={{ color: "#0f172a" }} onClick={() => setShowBillModal(false)}>Cancel</button>
                <button type="submit" className="aq-btn-primary">Record Bill</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
