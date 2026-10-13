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

const EMPTY_JOURNAL_LINE = {
  account_id: "",
  description: "",
  debit: "",
  credit: "",
  currency: "PKR",
  exchange_rate: "1",
  amount_pkr: "",
};

const EMPTY_JOURNAL_FORM = {
  entry_no: "",
  entry_date: "",
  memo: "",
  status: "Posted",
  lines: [],
};

const EMPTY_DOCUMENT_LINE = {
  account_id: "",
  description: "",
  quantity: "1",
  unit_price: "",
  amount: "",
  tax_amount: "",
};

const EMPTY_DOCUMENT_FORM = {
  document_type: "Invoice",
  document_no: "",
  contact_name: "",
  contact_email: "",
  issue_date: "",
  due_date: "",
  status: "Open",
  currency: "PKR",
  exchange_rate: "1",
  notes: "",
  lines: [],
};

const EMPTY_PAYMENT_FORM = {
  account_id: "",
  amount: "",
  currency: "PKR",
  exchange_rate: "1",
  amount_pkr: "",
  payment_date: "",
  reference: "",
  notes: "",
};

const EMPTY_BANK_TRANSACTION_FORM = {
  account_id: "",
  transaction_date: "",
  description: "",
  reference: "",
  counterparty: "",
  money_in: "",
  money_out: "",
  currency: "PKR",
  exchange_rate: "1",
  amount_pkr: "",
  status: "Unmatched",
  notes: "",
};

const EMPTY_BANK_RULE_FORM = {
  name: "",
  account_id: "",
  match_field: "Any",
  match_type: "Contains",
  match_value: "",
  action: "Create Money Entry",
  direction: "",
  category: "Other",
  counterparty: "",
  platform: "",
  description_template: "",
  priority: "100",
  is_active: true,
  auto_match: true,
};

const bankRuleMatchFields = ["Any", "Description", "Reference", "Counterparty"];
const bankRuleMatchTypes = ["Contains", "Equals", "Starts With", "Ends With"];
const bankRuleActions = ["Create Money Entry", "Ignore"];

const EMPTY_RECURRING_FORM = {
  name: "",
  template_type: "Money Entry",
  status: "Active",
  frequency: "Monthly",
  interval_count: "1",
  next_run_date: "",
  end_date: "",
  max_occurrences: "",
  account_id: "",
  line_account_id: "",
  direction: "Money Out",
  category: "Expense",
  amount: "",
  tax_amount: "",
  currency: "PKR",
  exchange_rate: "1",
  contact_name: "",
  contact_email: "",
  document_status: "Open",
  line_description: "",
  notes: "",
};

const recurringTypes = ["Money Entry", "Invoice", "Bill"];
const recurringStatuses = ["Active", "Paused"];
const recurringFrequencies = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];


const EMPTY_BANK_IMPORT_FORM = {
  account_id: "",
  csv_text: "",
  date_column: "date",
  description_column: "description",
  reference_column: "reference",
  counterparty_column: "counterparty",
  money_in_column: "money_in",
  money_out_column: "money_out",
  amount_column: "amount",
  currency: "PKR",
  exchange_rate: "1",
  skip_duplicates: true,
};

const BANK_CSV_SAMPLE = "date,description,reference,counterparty,money_in,money_out\n2026-08-13,Customer payment,INV-001,ABC Store,2500,";


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

const isManualJournalEntry = (entry) => !entry?.source_type;

function Accounting() {
  const confirmDialog = useConfirmDialog();
  const [activeTab, setActiveTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bankTransactions, setBankTransactions] = useState([]);
  const [bankRules, setBankRules] = useState([]);
  const [recurringTemplates, setRecurringTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [transactionModal, setTransactionModal] = useState(null);
  const [transactionForm, setTransactionForm] = useState(EMPTY_TRANSACTION_FORM);
  const [accountModal, setAccountModal] = useState(null);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT_FORM);
  const [journalModal, setJournalModal] = useState(null);
  const [journalForm, setJournalForm] = useState(EMPTY_JOURNAL_FORM);
  const [documentModal, setDocumentModal] = useState(null);
  const [documentForm, setDocumentForm] = useState(EMPTY_DOCUMENT_FORM);
  const [paymentModal, setPaymentModal] = useState(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
  const [bankModal, setBankModal] = useState(null);
  const [bankForm, setBankForm] = useState(EMPTY_BANK_TRANSACTION_FORM);
  const [bankMatchModal, setBankMatchModal] = useState(null);
  const [bankMatchSource, setBankMatchSource] = useState("");
  const [bankImportModal, setBankImportModal] = useState(false);
  const [bankImportForm, setBankImportForm] = useState(EMPTY_BANK_IMPORT_FORM);
  const [bankImportResult, setBankImportResult] = useState(null);
  const [bankRuleModal, setBankRuleModal] = useState(null);
  const [bankRuleForm, setBankRuleForm] = useState(EMPTY_BANK_RULE_FORM);
  const [recurringModal, setRecurringModal] = useState(null);
  const [recurringForm, setRecurringForm] = useState(EMPTY_RECURRING_FORM);

  const accounts = overview?.accounts ?? EMPTY_LIST;
  const platforms = overview?.platforms ?? EMPTY_LIST;
  const summary = overview?.summary ?? EMPTY_SUMMARY;
  const reports = overview?.reports ?? EMPTY_SUMMARY;
  const trialBalance = reports.trial_balance ?? EMPTY_SUMMARY;
  const profitLoss = reports.profit_loss ?? EMPTY_SUMMARY;
  const balanceSheet = reports.balance_sheet ?? EMPTY_SUMMARY;
  const receivablesAging = reports.receivables_aging ?? EMPTY_SUMMARY;
  const payablesAging = reports.payables_aging ?? EMPTY_SUMMARY;
  const bankingSummary = reports.banking_summary ?? EMPTY_SUMMARY;
  const recurringAutomation = reports.recurring_automation ?? EMPTY_SUMMARY;
  const schedulerRunning = summary.recurring_scheduler_running !== false && summary.recurring_scheduler_enabled !== false;
  const recurringDueCount = useMemo(() => {
    const now = new Date();
    return recurringTemplates.filter((template) => {
      if (template.status !== "Active" || !template.next_run_date) return false;
      const nextRun = new Date(template.next_run_date);
      return !Number.isNaN(nextRun.getTime()) && nextRun <= now;
    }).length;
  }, [recurringTemplates]);
  const recurringGeneratedCount = useMemo(
    () => recurringTemplates.reduce((total, template) => total + Number(template.occurrences_generated || 0), 0),
    [recurringTemplates]
  );
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.is_active !== false),
    [accounts]
  );

  const defaultAccountId = useMemo(() => {
    const activeBank = activeAccounts.find(
      (account) => account.account_type !== "Platform"
    );
    return activeBank?.id || activeAccounts[0]?.id || accounts[0]?.id || "";
  }, [accounts, activeAccounts]);

  const invoiceDocuments = useMemo(
    () => documents.filter((document) => document.document_type === "Invoice"),
    [documents]
  );
  const billDocuments = useMemo(
    () => documents.filter((document) => document.document_type === "Bill"),
    [documents]
  );
  const revenueAccountId = useMemo(() => {
    const revenueAccount = activeAccounts.find((account) =>
      String(account.account_type || "").toLowerCase().includes("revenue") ||
      String(account.account_type || "").toLowerCase().includes("income") ||
      String(account.name || "").toLowerCase().includes("sales")
    );
    return revenueAccount?.id || activeAccounts[0]?.id || defaultAccountId || "";
  }, [activeAccounts, defaultAccountId]);
  const expenseAccountId = useMemo(() => {
    const expenseAccount = activeAccounts.find((account) =>
      String(account.account_type || "").toLowerCase().includes("expense") ||
      String(account.name || "").toLowerCase().includes("expense") ||
      String(account.name || "").toLowerCase().includes("cost")
    );
    return expenseAccount?.id || activeAccounts[0]?.id || defaultAccountId || "";
  }, [activeAccounts, defaultAccountId]);
  const bankAccounts = useMemo(
    () => activeAccounts.filter((account) => ["Bank", "Cash", "Wallet", "Platform"].includes(account.account_type)),
    [activeAccounts]
  );
  const recurringMoneyAccounts = bankAccounts.length ? bankAccounts : activeAccounts;
  const paymentAccountId = useMemo(() => {
    const cashAccount = bankAccounts.find((account) => ["Bank", "Cash", "Wallet"].includes(account.account_type));
    return cashAccount?.id || defaultAccountId || "";
  }, [bankAccounts, defaultAccountId]);

  const journalTotals = useMemo(() => {
    const debit = journalForm.lines.reduce(
      (total, line) => total + Number(line.debit || 0),
      0
    );
    const credit = journalForm.lines.reduce(
      (total, line) => total + Number(line.credit || 0),
      0
    );
    const difference = Math.round((debit - credit) * 100) / 100;
    return {
      debit,
      credit,
      difference,
      isBalanced: Math.abs(difference) < 0.01 && debit > 0,
    };
  }, [journalForm.lines]);

  const bankMatchCandidates = useMemo(() => {
    const moneyEntryCandidates = transactions.map((transaction) => ({
      key: `accounting_transaction:${transaction.id}`,
      source_type: "accounting_transaction",
      source_id: transaction.id,
      account_id: transaction.account_id,
      money_in: transaction.direction === "Money In" ? Number(transaction.amount || 0) : 0,
      money_out: transaction.direction === "Money Out" ? Number(transaction.amount || 0) : 0,
      label: `Money entry / ${transaction.reference || transaction.category || transaction.id}`,
    }));
    const paymentCandidates = documents.flatMap((document) =>
      (document.payments || []).map((payment) => ({
        key: `accounting_document_payment:${payment.id}`,
        source_type: "accounting_document_payment",
        source_id: payment.id,
        account_id: payment.account_id,
        money_in: document.document_type === "Invoice" ? Number(payment.amount || 0) : 0,
        money_out: document.document_type === "Bill" ? Number(payment.amount || 0) : 0,
        label: `${document.document_no} payment / ${document.contact_name}`,
      }))
    );
    return [...moneyEntryCandidates, ...paymentCandidates];
  }, [transactions, documents]);

  const bankMatchedCandidateKeys = useMemo(() => new Set(
    bankTransactions
      .filter((transaction) => transaction.status === "Matched")
      .map((transaction) => `${transaction.matched_source_type}:${transaction.matched_source_id}`)
      .filter((key) => !key.includes("null") && !key.includes("undefined"))
  ), [bankTransactions]);

  const getBankMatchCandidatesFor = useCallback((transaction) => {
    if (!transaction) return EMPTY_LIST;
    return bankMatchCandidates.filter((candidate) =>
      !bankMatchedCandidateKeys.has(candidate.key) &&
      Number(candidate.account_id) === Number(transaction.account_id) &&
      Number(candidate.money_in || 0).toFixed(2) === Number(transaction.money_in || 0).toFixed(2) &&
      Number(candidate.money_out || 0).toFixed(2) === Number(transaction.money_out || 0).toFixed(2)
    );
  }, [bankMatchCandidates, bankMatchedCandidateKeys]);

  const availableBankMatchCandidates = useMemo(
    () => getBankMatchCandidatesFor(bankMatchModal),
    [getBankMatchCandidatesFor, bankMatchModal]
  );

  const bankSuggestionCounts = useMemo(() => {
    const counts = {};
    bankTransactions.forEach((transaction) => {
      if (transaction.status === "Unmatched") {
        counts[transaction.id] = getBankMatchCandidatesFor(transaction).length;
      }
    });
    return counts;
  }, [bankTransactions, getBankMatchCandidatesFor]);

  const loadAccounting = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const requests = [
        { key: "overview", label: "overview", request: api.get("/accounting/overview") },
        { key: "transactions", label: "money entries", request: api.get("/accounting/transactions") },
        { key: "journalEntries", label: "journal entries", request: api.get("/accounting/journal-entries") },
        { key: "documents", label: "documents", request: api.get("/accounting/documents") },
        { key: "bankTransactions", label: "bank transactions", request: api.get("/accounting/bank-transactions") },
        { key: "bankRules", label: "bank rules", request: api.get("/accounting/bank-rules") },
        { key: "recurringTemplates", label: "recurring automation", request: api.get("/accounting/recurring-templates") },
      ];
      const results = await Promise.allSettled(requests.map((item) => item.request));
      const payload = {};
      const failedSections = [];

      results.forEach((result, index) => {
        const request = requests[index];
        if (result.status === "fulfilled") {
          payload[request.key] = result.value.data;
          return;
        }
        failedSections.push(request.label);
        console.error(`Accounting ${request.label} load failed`, result.reason);
      });

      if (!payload.overview) {
        throw new Error("Accounting overview could not be loaded.");
      }

      setOverview(payload.overview);
      setTransactions(payload.transactions || []);
      setJournalEntries(payload.journalEntries || []);
      setDocuments(payload.documents || []);
      setBankTransactions(payload.bankTransactions || []);
      setBankRules(payload.bankRules || []);
      setRecurringTemplates(payload.recurringTemplates || []);

      if (failedSections.length) {
        setError(`Some accounting sections could not be loaded: ${failedSections.join(", ")}.`);
      }    } catch (loadError) {
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

  const openJournalModal = (entry = null) => {
    if (entry && !isManualJournalEntry(entry)) {
      setError("Auto journals are controlled by the source money entry.");
      return;
    }
    const firstAccountId = String(activeAccounts[0]?.id || defaultAccountId || "");
    const secondAccountId = String(
      activeAccounts.find((account) => String(account.id) !== firstAccountId)?.id ||
        firstAccountId
    );
    const entryLines = (entry?.lines || []).map((line) => ({
      ...EMPTY_JOURNAL_LINE,
      account_id: String(line.account_id || ""),
      description: line.description || "",
      debit: Number(line.debit || 0) > 0 ? String(line.debit) : "",
      credit: Number(line.credit || 0) > 0 ? String(line.credit) : "",
      currency: line.currency || "PKR",
      exchange_rate: line.exchange_rate ?? "1",
      amount_pkr: "",
    }));

    setJournalForm({
      ...EMPTY_JOURNAL_FORM,
      entry_no: entry?.entry_no || "",
      entry_date: toDatetimeLocal(entry?.entry_date),
      memo: entry?.memo || "",
      status: entry?.status || "Posted",
      lines: entryLines.length
        ? entryLines
        : [
            { ...EMPTY_JOURNAL_LINE, account_id: firstAccountId },
            { ...EMPTY_JOURNAL_LINE, account_id: secondAccountId },
          ],
    });
    setJournalModal(entry || {});
    setActiveTab("ledger");
  };

  const closeJournalModal = () => {
    setJournalModal(null);
    setJournalForm(EMPTY_JOURNAL_FORM);
  };

  const updateJournalLine = (lineIndex, changes) => {
    setJournalForm((current) => ({
      ...current,
      lines: current.lines.map((line, index) =>
        index === lineIndex ? { ...line, ...changes } : line
      ),
    }));
  };

  const addJournalLine = () => {
    setJournalForm((current) => ({
      ...current,
      lines: [
        ...current.lines,
        { ...EMPTY_JOURNAL_LINE, account_id: String(defaultAccountId || "") },
      ],
    }));
  };

  const removeJournalLine = (lineIndex) => {
    setJournalForm((current) => ({
      ...current,
      lines:
        current.lines.length <= 2
          ? current.lines
          : current.lines.filter((_, index) => index !== lineIndex),
    }));
  };

  const handleJournalSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const lines = journalForm.lines
      .map((line) => ({
        account_id: Number(line.account_id || 0),
        description: line.description || null,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        currency: line.currency || "PKR",
        exchange_rate: Number(line.exchange_rate || 1),
        amount_pkr: toOptionalNumber(line.amount_pkr),
      }))
      .filter((line) => line.account_id && (line.debit > 0 || line.credit > 0));

    if (lines.length < 2) {
      setError("Add at least two journal lines.");
      return;
    }
    if (lines.some((line) => line.debit > 0 && line.credit > 0)) {
      setError("A journal line can have a debit or a credit, not both.");
      return;
    }
    const debitTotal = lines.reduce((total, line) => total + line.debit, 0);
    const creditTotal = lines.reduce((total, line) => total + line.credit, 0);
    if (Math.abs(debitTotal - creditTotal) > 0.01) {
      setError("Journal debits and credits must balance before saving.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        entry_no: journalForm.entry_no.trim() || null,
        entry_date: journalForm.entry_date || null,
        memo: journalForm.memo || null,
        status: journalForm.status || "Posted",
        lines,
      };
      if (journalModal?.id) {
        await api.put(`/accounting/journal-entries/${journalModal.id}`, payload);
        await refreshAfterSave("Journal entry updated.");
      } else {
        await api.post("/accounting/journal-entries", payload);
        await refreshAfterSave("Journal entry added.");
      }
      closeJournalModal();
    } catch (saveError) {
      console.error("Journal save failed", saveError);
      setError(saveError.response?.data?.detail || "Journal entry could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteJournalEntry = async (entry) => {
    if (!isManualJournalEntry(entry)) {
      setError("Auto journals are controlled by the source money entry.");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete journal entry?",
      message: "This will permanently delete this manual journal entry.",
      tone: "danger",
      confirmText: "Delete journal",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/journal-entries/${entry.id}`);
      await refreshAfterSave("Journal entry deleted.");
    } catch (deleteError) {
      console.error("Journal delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Journal entry could not be deleted.");
    } finally {
      setSaving(false);
    }
  };


  const documentLineTotal = (line) => {
    const amount = line.amount !== "" && line.amount !== null && line.amount !== undefined
      ? Number(line.amount || 0)
      : Number(line.quantity || 0) * Number(line.unit_price || 0);
    return amount + Number(line.tax_amount || 0);
  };

  const openDocumentModal = (document = null, documentType = "Invoice") => {
    const type = document?.document_type || documentType || "Invoice";
    const defaultLineAccountId = String(type === "Bill" ? expenseAccountId : revenueAccountId || "");
    const lines = (document?.lines || []).map((line) => ({
      ...EMPTY_DOCUMENT_LINE,
      account_id: String(line.account_id || ""),
      description: line.description || "",
      quantity: line.quantity ?? "1",
      unit_price: line.unit_price ?? "",
      amount: line.amount ?? "",
      tax_amount: line.tax_amount ?? "",
    }));
    setDocumentForm({
      ...EMPTY_DOCUMENT_FORM,
      document_type: type,
      document_no: document?.document_no || "",
      contact_name: document?.contact_name || "",
      contact_email: document?.contact_email || "",
      issue_date: toDatetimeLocal(document?.issue_date),
      due_date: toDatetimeLocal(document?.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
      status: document?.status || "Open",
      currency: document?.currency || "PKR",
      exchange_rate: document?.exchange_rate ?? "1",
      notes: document?.notes || "",
      lines: lines.length ? lines : [{ ...EMPTY_DOCUMENT_LINE, account_id: defaultLineAccountId }],
    });
    setDocumentModal(document || {});
    setActiveTab("documents");
  };

  const closeDocumentModal = () => {
    setDocumentModal(null);
    setDocumentForm(EMPTY_DOCUMENT_FORM);
  };

  const updateDocumentLine = (lineIndex, changes) => {
    setDocumentForm((current) => ({
      ...current,
      lines: current.lines.map((line, index) => index === lineIndex ? { ...line, ...changes } : line),
    }));
  };

  const addDocumentLine = () => {
    const defaultLineAccountId = String(documentForm.document_type === "Bill" ? expenseAccountId : revenueAccountId || "");
    setDocumentForm((current) => ({
      ...current,
      lines: [...current.lines, { ...EMPTY_DOCUMENT_LINE, account_id: defaultLineAccountId }],
    }));
  };

  const removeDocumentLine = (lineIndex) => {
    setDocumentForm((current) => ({
      ...current,
      lines: current.lines.length <= 1 ? current.lines : current.lines.filter((_, index) => index !== lineIndex),
    }));
  };

  const handleDocumentSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const lines = documentForm.lines
        .map((line) => ({
          account_id: Number(line.account_id || 0),
          description: line.description || null,
          quantity: Number(line.quantity || 0),
          unit_price: Number(line.unit_price || 0),
          amount: line.amount === "" ? null : Number(line.amount || 0),
          tax_amount: Number(line.tax_amount || 0),
        }))
        .filter((line) => line.account_id && ((line.amount ?? line.quantity * line.unit_price) + line.tax_amount > 0));
      if (lines.length === 0) {
        setError("Add at least one document line.");
        setSaving(false);
        return;
      }
      const payload = {
        document_type: documentForm.document_type,
        document_no: documentForm.document_no.trim() || null,
        contact_name: documentForm.contact_name,
        contact_email: documentForm.contact_email || null,
        issue_date: documentForm.issue_date || null,
        due_date: documentForm.due_date || null,
        status: documentForm.status || "Open",
        currency: documentForm.currency || "PKR",
        exchange_rate: Number(documentForm.exchange_rate || 1),
        notes: documentForm.notes || null,
        lines,
      };
      if (documentModal?.id) {
        await api.put(`/accounting/documents/${documentModal.id}`, payload);
        await refreshAfterSave(`${documentForm.document_type} updated.`);
      } else {
        await api.post("/accounting/documents", payload);
        await refreshAfterSave(`${documentForm.document_type} created.`);
      }
      closeDocumentModal();
    } catch (saveError) {
      console.error("Document save failed", saveError);
      setError(saveError.response?.data?.detail || "Accounting document could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteDocument = async (document) => {
    const confirmed = await confirmDialog({
      title: `Delete ${document.document_type.toLowerCase()}?`,
      message: "This removes the document and its linked journal entry. Payments must be deleted first.",
      tone: "danger",
      confirmText: "Delete document",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/documents/${document.id}`);
      await refreshAfterSave(`${document.document_type} deleted.`);
    } catch (deleteError) {
      console.error("Document delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Accounting document could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const openPaymentModal = (document) => {
    setPaymentForm({
      ...EMPTY_PAYMENT_FORM,
      account_id: String(paymentAccountId || ""),
      amount: document?.balance_due ?? "",
      currency: document?.currency || "PKR",
      exchange_rate: document?.exchange_rate ?? "1",
      payment_date: toDatetimeLocal(new Date()),
      reference: "",
      notes: "",
    });
    setPaymentModal(document);
  };

  const closePaymentModal = () => {
    setPaymentModal(null);
    setPaymentForm(EMPTY_PAYMENT_FORM);
  };

  const handlePaymentSubmit = async (event) => {
    event.preventDefault();
    if (!paymentModal?.id) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        account_id: Number(paymentForm.account_id || 0),
        amount: Number(paymentForm.amount || 0),
        currency: paymentForm.currency || "PKR",
        exchange_rate: Number(paymentForm.exchange_rate || 1),
        amount_pkr: toOptionalNumber(paymentForm.amount_pkr),
        payment_date: paymentForm.payment_date || null,
        reference: paymentForm.reference || null,
        notes: paymentForm.notes || null,
      };
      await api.post(`/accounting/documents/${paymentModal.id}/payments`, payload);
      await refreshAfterSave("Payment recorded.");
      closePaymentModal();
    } catch (saveError) {
      console.error("Payment save failed", saveError);
      setError(saveError.response?.data?.detail || "Payment could not be recorded.");
    } finally {
      setSaving(false);
    }
  };

  const deleteDocumentPayment = async (payment) => {
    const confirmed = await confirmDialog({
      title: "Delete payment?",
      message: "This reverses the payment journal entry.",
      tone: "danger",
      confirmText: "Delete payment",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/document-payments/${payment.id}`);
      await refreshAfterSave("Payment deleted.");
    } catch (deleteError) {
      console.error("Payment delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Payment could not be deleted.");
    } finally {
      setSaving(false);
    }
  };


  const openBankTransactionModal = (transaction = null) => {
    setBankForm({
      ...EMPTY_BANK_TRANSACTION_FORM,
      account_id: String(transaction?.account_id || paymentAccountId || ""),
      transaction_date: toDatetimeLocal(transaction?.transaction_date),
      description: transaction?.description || "",
      reference: transaction?.reference || "",
      counterparty: transaction?.counterparty || "",
      money_in: Number(transaction?.money_in || 0) > 0 ? String(transaction.money_in) : "",
      money_out: Number(transaction?.money_out || 0) > 0 ? String(transaction.money_out) : "",
      currency: transaction?.currency || "PKR",
      exchange_rate: transaction?.exchange_rate ?? "1",
      amount_pkr: transaction?.amount_pkr ?? "",
      status: transaction?.status || "Unmatched",
      notes: transaction?.notes || "",
    });
    setBankModal(transaction || {});
    setActiveTab("banking");
  };

  const closeBankTransactionModal = () => {
    setBankModal(null);
    setBankForm(EMPTY_BANK_TRANSACTION_FORM);
  };

  const openBankImportModal = () => {
    setBankImportForm({
      ...EMPTY_BANK_IMPORT_FORM,
      account_id: String(paymentAccountId || bankAccounts[0]?.id || ""),
      csv_text: "",
    });
    setBankImportResult(null);
    setBankImportModal(true);
    setActiveTab("banking");
  };

  const closeBankImportModal = () => {
    setBankImportModal(false);
    setBankImportForm(EMPTY_BANK_IMPORT_FORM);
    setBankImportResult(null);
  };

  const bankRuleFormFromLine = (transaction = null) => {
    if (!transaction) return EMPTY_BANK_RULE_FORM;
    const counterparty = transaction.counterparty || "";
    const reference = transaction.reference || "";
    const description = transaction.description || "";
    const matchField = counterparty ? "Counterparty" : reference ? "Reference" : "Description";
    const matchValue = counterparty || reference || description;
    const direction = Number(transaction.money_in || 0) > 0 ? "Money In" : "Money Out";
    return {
      ...EMPTY_BANK_RULE_FORM,
      name: `Rule for ${matchValue || "bank line"}`,
      account_id: String(transaction.account_id || ""),
      match_field: matchField,
      match_value: matchValue,
      direction,
      category: direction === "Money In" ? "Sales" : "Expense",
      counterparty,
      description_template: "{description}",
    };
  };

  const openBankRuleModal = (rule = null, transaction = null) => {
    setBankRuleForm(rule ? {
      ...EMPTY_BANK_RULE_FORM,
      name: rule.name || "",
      account_id: rule.account_id ? String(rule.account_id) : "",
      match_field: rule.match_field || "Any",
      match_type: rule.match_type || "Contains",
      match_value: rule.match_value || "",
      action: rule.action || "Create Money Entry",
      direction: rule.direction || "",
      category: rule.category || "Other",
      counterparty: rule.counterparty || "",
      platform: rule.platform || "",
      description_template: rule.description_template || "",
      priority: rule.priority ?? "100",
      is_active: rule.is_active !== false,
      auto_match: rule.auto_match !== false,
    } : bankRuleFormFromLine(transaction));
    setBankRuleModal(rule || {});
    setActiveTab("banking");
  };

  const closeBankRuleModal = () => {
    setBankRuleModal(null);
    setBankRuleForm(EMPTY_BANK_RULE_FORM);
  };

  const handleBankRuleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: bankRuleForm.name,
        account_id: bankRuleForm.account_id ? Number(bankRuleForm.account_id) : null,
        match_field: bankRuleForm.match_field,
        match_type: bankRuleForm.match_type,
        match_value: bankRuleForm.match_value,
        action: bankRuleForm.action,
        direction: bankRuleForm.direction || null,
        category: bankRuleForm.category || "Other",
        counterparty: bankRuleForm.counterparty || null,
        platform: bankRuleForm.platform || null,
        description_template: bankRuleForm.description_template || null,
        priority: Number(bankRuleForm.priority || 100),
        is_active: Boolean(bankRuleForm.is_active),
        auto_match: Boolean(bankRuleForm.auto_match),
      };
      if (bankRuleModal?.id) {
        await api.put(`/accounting/bank-rules/${bankRuleModal.id}`, payload);
        await refreshAfterSave("Bank rule updated.");
      } else {
        await api.post("/accounting/bank-rules", payload);
        await refreshAfterSave("Bank rule created.");
      }
      closeBankRuleModal();
    } catch (saveError) {
      console.error("Bank rule save failed", saveError);
      setError(saveError.response?.data?.detail || "Bank rule could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteBankRule = async (rule) => {
    const confirmed = await confirmDialog({
      title: "Delete bank rule?",
      message: "This removes the automation rule only. Existing ledger entries and matched bank lines stay unchanged.",
      tone: "danger",
      confirmText: "Delete rule",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/bank-rules/${rule.id}`);
      await refreshAfterSave("Bank rule deleted.");
    } catch (deleteError) {
      console.error("Bank rule delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Bank rule could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const runBankRules = async (options = {}) => {
    setSaving(true);
    setError("");
    try {
      const response = await api.post("/accounting/bank-rules/apply", {
        rule_id: options.rule_id || null,
        bank_transaction_id: options.bank_transaction_id || null,
        limit: options.limit || 200,
      });
      await loadAccounting();
      setNotice(`${response.data.created || 0} entries created, ${response.data.ignored || 0} ignored, ${response.data.skipped || 0} skipped.`);
      setTimeout(() => setNotice(""), 3200);
    } catch (runError) {
      console.error("Bank rules run failed", runError);
      setError(runError.response?.data?.detail || "Bank rules could not be applied.");
    } finally {
      setSaving(false);
    }
  };

  const updateRecurringType = (templateType) => {
    const lineAccountId = String(templateType === "Bill" ? expenseAccountId : revenueAccountId || "");
    setRecurringForm((current) => ({
      ...current,
      template_type: templateType,
      account_id: templateType === "Money Entry" ? current.account_id || String(paymentAccountId || "") : "",
      line_account_id: templateType === "Money Entry" ? "" : current.line_account_id || lineAccountId,
      direction: templateType === "Money Entry" ? current.direction || "Money Out" : "Money Out",
      category: templateType === "Bill" ? "Expense" : templateType === "Invoice" ? "Sales" : current.category || "Expense",
    }));
  };

  const openRecurringModal = (template = null, templateType = "Money Entry") => {
    const type = template?.template_type || templateType || "Money Entry";
    const defaultLineAccountId = String(type === "Bill" ? expenseAccountId : revenueAccountId || "");
    const direction = template?.direction || "Money Out";
    setRecurringForm({
      ...EMPTY_RECURRING_FORM,
      name: template?.name || "",
      template_type: type,
      status: template?.status || "Active",
      frequency: template?.frequency || "Monthly",
      interval_count: template?.interval_count ?? "1",
      next_run_date: toDatetimeLocal(template?.next_run_date),
      end_date: template?.end_date ? toDatetimeLocal(template.end_date) : "",
      max_occurrences: template?.max_occurrences ?? "",
      account_id: String(template?.account_id || (type === "Money Entry" ? paymentAccountId : "") || ""),
      line_account_id: String(template?.line_account_id || (type === "Money Entry" ? "" : defaultLineAccountId) || ""),
      direction,
      category: template?.category || (direction === "Money In" ? "Sales" : "Expense"),
      amount: template?.amount ?? "",
      tax_amount: template?.tax_amount ?? "",
      currency: template?.currency || "PKR",
      exchange_rate: template?.exchange_rate ?? "1",
      contact_name: template?.contact_name || "",
      contact_email: template?.contact_email || "",
      document_status: template?.document_status || "Open",
      line_description: template?.line_description || "",
      notes: template?.notes || "",
    });
    setRecurringModal(template || {});
    setActiveTab("recurring");
  };

  const closeRecurringModal = () => {
    setRecurringModal(null);
    setRecurringForm(EMPTY_RECURRING_FORM);
  };

  const handleRecurringSubmit = async (event) => {
    event.preventDefault();
    const isMoneyEntry = recurringForm.template_type === "Money Entry";
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: recurringForm.name.trim(),
        template_type: recurringForm.template_type,
        status: recurringForm.status,
        frequency: recurringForm.frequency,
        interval_count: Number(recurringForm.interval_count || 1),
        next_run_date: recurringForm.next_run_date || null,
        end_date: recurringForm.end_date || null,
        max_occurrences: toOptionalNumber(recurringForm.max_occurrences),
        account_id: isMoneyEntry ? Number(recurringForm.account_id || 0) : null,
        line_account_id: isMoneyEntry ? null : Number(recurringForm.line_account_id || 0),
        direction: isMoneyEntry ? recurringForm.direction : null,
        category: recurringForm.category || (isMoneyEntry && recurringForm.direction === "Money In" ? "Sales" : "Expense"),
        amount: Number(recurringForm.amount || 0),
        tax_amount: Number(recurringForm.tax_amount || 0),
        currency: recurringForm.currency || "PKR",
        exchange_rate: Number(recurringForm.exchange_rate || 1),
        contact_name: isMoneyEntry ? null : recurringForm.contact_name,
        contact_email: isMoneyEntry ? null : recurringForm.contact_email || null,
        document_status: isMoneyEntry ? "Open" : recurringForm.document_status,
        line_description: isMoneyEntry ? null : recurringForm.line_description || null,
        notes: recurringForm.notes || null,
      };
      if (recurringModal?.id) {
        await api.put(`/accounting/recurring-templates/${recurringModal.id}`, payload);
        await refreshAfterSave("Recurring template updated.");
      } else {
        await api.post("/accounting/recurring-templates", payload);
        await refreshAfterSave("Recurring template created.");
      }
      closeRecurringModal();
    } catch (saveError) {
      console.error("Recurring template save failed", saveError);
      setError(saveError.response?.data?.detail || "Recurring template could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteRecurringTemplate = async (template) => {
    const confirmed = await confirmDialog({
      title: "Delete recurring template?",
      message: "This removes the future automation only. Already generated entries and documents stay unchanged.",
      tone: "danger",
      confirmText: "Delete template",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/recurring-templates/${template.id}`);
      await refreshAfterSave("Recurring template deleted.");
    } catch (deleteError) {
      console.error("Recurring template delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Recurring template could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const runRecurringTemplates = async (options = {}) => {
    setSaving(true);
    setError("");
    try {
      const response = await api.post("/accounting/recurring-templates/run-due", {
        template_id: options.template_id || null,
        through_date: options.through_date || null,
        limit: options.limit || 100,
      });
      await loadAccounting();
      setNotice(`${response.data.generated || 0} recurring items generated. ${response.data.skipped || 0} skipped.`);
      setTimeout(() => setNotice(""), 3200);
    } catch (runError) {
      console.error("Recurring automation run failed", runError);
      setError(runError.response?.data?.detail || "Recurring automation could not be run.");
    } finally {
      setSaving(false);
    }
  };

  const handleBankImportSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        account_id: Number(bankImportForm.account_id || 0),
        csv_text: bankImportForm.csv_text,
        date_column: bankImportForm.date_column || "date",
        description_column: bankImportForm.description_column || "description",
        reference_column: bankImportForm.reference_column || null,
        counterparty_column: bankImportForm.counterparty_column || null,
        money_in_column: bankImportForm.money_in_column || null,
        money_out_column: bankImportForm.money_out_column || null,
        amount_column: bankImportForm.amount_column || null,
        currency: bankImportForm.currency || "PKR",
        exchange_rate: Number(bankImportForm.exchange_rate || 1),
        skip_duplicates: Boolean(bankImportForm.skip_duplicates),
      };
      const response = await api.post("/accounting/bank-transactions/import", payload);
      setBankImportResult(response.data);
      await loadAccounting();
      setNotice(`${response.data.created || 0} bank lines imported. ${response.data.skipped || 0} duplicates skipped.`);
      setTimeout(() => setNotice(""), 3200);
    } catch (saveError) {
      console.error("Bank CSV import failed", saveError);
      setError(saveError.response?.data?.detail || "Bank CSV could not be imported.");
    } finally {
      setSaving(false);
    }
  };

  const handleBankTransactionSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        account_id: Number(bankForm.account_id || 0),
        transaction_date: bankForm.transaction_date || null,
        description: bankForm.description || null,
        reference: bankForm.reference || null,
        counterparty: bankForm.counterparty || null,
        money_in: Number(bankForm.money_in || 0),
        money_out: Number(bankForm.money_out || 0),
        currency: bankForm.currency || "PKR",
        exchange_rate: Number(bankForm.exchange_rate || 1),
        amount_pkr: toOptionalNumber(bankForm.amount_pkr),
        status: bankForm.status || "Unmatched",
        notes: bankForm.notes || null,
      };
      if (bankModal?.id) {
        await api.put(`/accounting/bank-transactions/${bankModal.id}`, payload);
        await refreshAfterSave("Bank transaction updated.");
      } else {
        await api.post("/accounting/bank-transactions", payload);
        await refreshAfterSave("Bank transaction added.");
      }
      closeBankTransactionModal();
    } catch (saveError) {
      console.error("Bank transaction save failed", saveError);
      setError(saveError.response?.data?.detail || "Bank transaction could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteBankTransaction = async (transaction) => {
    const confirmed = await confirmDialog({
      title: "Delete bank transaction?",
      message: "This removes the imported statement line only. Ledger entries stay unchanged.",
      tone: "danger",
      confirmText: "Delete line",
    });
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await api.delete(`/accounting/bank-transactions/${transaction.id}`);
      await refreshAfterSave("Bank transaction deleted.");
    } catch (deleteError) {
      console.error("Bank transaction delete failed", deleteError);
      setError(deleteError.response?.data?.detail || "Bank transaction could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const openBankMatchModal = (transaction) => {
    setBankMatchModal(transaction);
    const firstCandidate = getBankMatchCandidatesFor(transaction)[0];
    setBankMatchSource(firstCandidate?.key || "");
  };

  const closeBankMatchModal = () => {
    setBankMatchModal(null);
    setBankMatchSource("");
  };

  const matchBankTransaction = async (event) => {
    event.preventDefault();
    if (!bankMatchModal?.id || !bankMatchSource) return;
    const [source_type, sourceId] = bankMatchSource.split(":");
    setSaving(true);
    setError("");
    try {
      await api.post(`/accounting/bank-transactions/${bankMatchModal.id}/match`, {
        source_type,
        source_id: Number(sourceId),
      });
      await refreshAfterSave("Bank transaction matched.");
      closeBankMatchModal();
    } catch (saveError) {
      console.error("Bank transaction match failed", saveError);
      setError(saveError.response?.data?.detail || "Bank transaction could not be matched.");
    } finally {
      setSaving(false);
    }
  };

  const unmatchBankTransaction = async (transaction) => {
    setSaving(true);
    setError("");
    try {
      await api.post(`/accounting/bank-transactions/${transaction.id}/unmatch`);
      await refreshAfterSave("Bank transaction unmatched.");
    } catch (saveError) {
      console.error("Bank transaction unmatch failed", saveError);
      setError(saveError.response?.data?.detail || "Bank transaction could not be unmatched.");
    } finally {
      setSaving(false);
    }
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
      await loadAccounting();
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
          <h1>
            Accounting
            <span className="accounting-suite-badge">Financial Suite</span>
          </h1>
          <p>Enterprise double-entry financial studio, ledgers, statements, and operating controls.</p>
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
            onClick={() => openDocumentModal(null, "Invoice")}
            type="button"
          >
            New invoice
          </button>
          <button
            className="accounting-light-btn"
            onClick={() => openDocumentModal(null, "Bill")}
            type="button"
          >
            New bill
          </button>
          <button
            className="accounting-light-btn"
            onClick={openBankImportModal}
            type="button"
          >
            Import CSV
          </button>
          <button
            className="accounting-light-btn"
            onClick={() => openBankTransactionModal()}
            type="button"
          >
            Bank entry
          </button>
          <button
            className="accounting-light-btn"
            onClick={() => openJournalModal()}
            type="button"
          >
            Journal
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

      <nav className="accounting-tabs-bar">
        <button
          className={`accounting-tab-btn ${activeTab === "overview" ? "is-active" : ""}`}
          onClick={() => setActiveTab("overview")}
          type="button"
        >
          Overview
        </button>
        <button
          className={`accounting-tab-btn ${activeTab === "ledger" ? "is-active" : ""}`}
          onClick={() => setActiveTab("ledger")}
          type="button"
        >
          Ledger
        </button>
        <button
          className={`accounting-tab-btn ${activeTab === "accounts" ? "is-active" : ""}`}
          onClick={() => setActiveTab("accounts")}
          type="button"
        >
          Accounts
        </button>
        <button
          className={`accounting-tab-btn ${activeTab === "documents" ? "is-active" : ""}`}
          onClick={() => setActiveTab("documents")}
          type="button"
        >
          Invoices & bills
        </button>
        <button
          className={`accounting-tab-btn ${activeTab === "banking" ? "is-active" : ""}`}
          onClick={() => setActiveTab("banking")}
          type="button"
        >
          Banking
        </button>
        <button
          className={`accounting-tab-btn ${activeTab === "recurring" ? "is-active" : ""}`}
          onClick={() => setActiveTab("recurring")}
          type="button"
        >
          Recurring
        </button>
        <button
          className={`accounting-tab-btn ${activeTab === "reports" ? "is-active" : ""}`}
          onClick={() => setActiveTab("reports")}
          type="button"
        >
          Reports
        </button>
      </nav>

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
            <small>{formatNumber(summary.transactions_count)} money entries</small>
          </article>
          <article>
            <span>Expenses</span>
            <strong>{formatCurrency(summary.expenses_pkr, "PKR")}</strong>
            <small>Money out: {formatCurrency(summary.money_out_pkr, "PKR")}</small>
          </article>
          <article>
            <span>Net income</span>
            <strong>{formatCurrency(summary.net_income_pkr ?? profitLoss.net_income, "PKR")}</strong>
            <small>{formatNumber(summary.journal_entries_count)} journal entries</small>
          </article>
          <article>
            <span>Trial balance</span>
            <strong>{formatCurrency(summary.trial_balance_difference || 0, "PKR")}</strong>
            <small>{trialBalance.is_balanced ? "Balanced" : "Needs review"}</small>
          </article>
          <article>
            <span>Receivables</span>
            <strong>{formatCurrency(summary.receivables_balance_pkr || 0, "PKR")}</strong>
            <small>{formatNumber(invoiceDocuments.length)} invoices</small>
          </article>
          <article>
            <span>Payables</span>
            <strong>{formatCurrency(summary.payables_balance_pkr || 0, "PKR")}</strong>
            <small>{formatNumber(billDocuments.length)} bills</small>
          </article>
          <article>
            <span>Bank unmatched</span>
            <strong>{formatNumber(summary.unmatched_bank_transactions || 0)}</strong>
            <small>{formatCurrency(summary.unmatched_bank_amount_pkr || 0, "PKR")}</small>
          </article>
          <article>
            <span>Recurring due</span>
            <strong>{formatNumber(summary.recurring_due_count ?? recurringDueCount)}</strong>
            <small>{schedulerRunning ? "Auto scheduler running" : "Scheduler needs attention"}</small>
          </article>
        </section>

        {activeTab === "overview" && (
          <section className="accounting-workspace">
            <div className="accounting-ledger-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Money Ledger</span>
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
                  <button className="accounting-secondary-btn" onClick={() => openAccountModal()} type="button">
                    Add
                  </button>
                </div>
                <div className="accounting-account-list">
                  {accounts.slice(0, 8).map((account) => (
                    <article className="accounting-account-row" key={account.id}>
                      <div>
                        <strong>{account.name}</strong>
                        <small>{account.account_type}{account.platform ? ` / ${account.platform}` : ""}</small>
                      </div>
                      <div>
                        <span>{formatCurrency(account.balance, account.currency)}</span>
                        <small>{formatCurrency(account.balance_pkr, "PKR")}</small>
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
        )}

        {activeTab === "ledger" && (
          <section className="accounting-ledger-panel accounting-full-panel">
            <div className="accounting-panel-heading">
              <div>
                <span>Double Entry Ledger</span>
                <h2>Journal entries</h2>
              </div>
              <button className="accounting-secondary-btn" onClick={() => openJournalModal()} type="button">
                New journal
              </button>
            </div>
            {loading ? (
              <div className="accounting-empty">Loading journal entries...</div>
            ) : journalEntries.length === 0 ? (
              <div className="accounting-empty">No journal entries yet.</div>
            ) : (
              <div className="accounting-table-wrap">
                <table className="accounting-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entry</th>
                      <th>Memo</th>
                      <th>Debits</th>
                      <th>Credits</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDate(entry.entry_date)}</td>
                        <td>
                          <strong>{entry.entry_no}</strong>
                          <small>{entry.source_type === "accounting_transaction" ? "Auto from money entry" : "Manual journal"}</small>
                        </td>
                        <td>{entry.memo || "-"}</td>
                        <td>
                          {(entry.lines || []).filter((line) => Number(line.debit || 0) > 0).map((line) => (
                            <small key={line.id}>{line.account_name}: {formatCurrency(line.debit, line.currency)}</small>
                          ))}
                        </td>
                        <td>
                          {(entry.lines || []).filter((line) => Number(line.credit || 0) > 0).map((line) => (
                            <small key={line.id}>{line.account_name}: {formatCurrency(line.credit, line.currency)}</small>
                          ))}
                        </td>
                        <td><span className="accounting-chip">{entry.status}</span></td>
                        <td>
                          <div className="accounting-row-actions">
                            {isManualJournalEntry(entry) ? (
                              <>
                                <button className="accounting-icon-btn" onClick={() => openJournalModal(entry)} type="button">Edit</button>
                                <button className="accounting-icon-btn is-danger" onClick={() => deleteJournalEntry(entry)} type="button">Delete</button>
                              </>
                            ) : (
                              <span className="accounting-auto-tag">Auto</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === "accounts" && (
          <section className="accounting-ledger-panel accounting-full-panel">
            <div className="accounting-panel-heading">
              <div>
                <span>Chart Of Accounts</span>
                <h2>Accounts and balances</h2>
              </div>
              <button className="accounting-secondary-btn" onClick={() => openAccountModal()} type="button">
                Add account
              </button>
            </div>
            <div className="accounting-table-wrap">
              <table className="accounting-table accounting-accounts-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Class</th>
                    <th>Debit total</th>
                    <th>Credit total</th>
                    <th>Balance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>
                        <strong>{account.name}</strong>
                        <small>{account.account_type}{account.platform ? ` / ${account.platform}` : ""}</small>
                      </td>
                      <td>{account.account_class || account.account_type}</td>
                      <td>{formatCurrency(account.debit_total || 0, "PKR")}</td>
                      <td>{formatCurrency(account.credit_total || 0, "PKR")}</td>
                      <td>{formatCurrency(account.balance_pkr, "PKR")}</td>
                      <td>
                        <div className="accounting-row-actions">
                          <button className="accounting-icon-btn" onClick={() => openAccountModal(account)} type="button">Edit</button>
                          <button className="accounting-icon-btn is-danger" onClick={() => deleteAccount(account.id)} type="button">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}


        {activeTab === "documents" && (
          <section className="accounting-documents-grid">
            <article className="accounting-report-card">
              <h3>Receivables Aging</h3>
              <div className="accounting-report-row accounting-report-total"><span>Total due</span><strong>{formatCurrency(receivablesAging.total_balance || 0, "PKR")}</strong></div>
              <div className="accounting-aging-buckets">
                <span>Current {formatCurrency(receivablesAging.buckets?.current || 0, "PKR")}</span>
                <span>1-30 {formatCurrency(receivablesAging.buckets?.days_1_30 || 0, "PKR")}</span>
                <span>31-60 {formatCurrency(receivablesAging.buckets?.days_31_60 || 0, "PKR")}</span>
                <span>61-90 {formatCurrency(receivablesAging.buckets?.days_61_90 || 0, "PKR")}</span>
                <span>90+ {formatCurrency(receivablesAging.buckets?.days_over_90 || 0, "PKR")}</span>
              </div>
            </article>
            <article className="accounting-report-card">
              <h3>Payables Aging</h3>
              <div className="accounting-report-row accounting-report-total"><span>Total due</span><strong>{formatCurrency(payablesAging.total_balance || 0, "PKR")}</strong></div>
              <div className="accounting-aging-buckets">
                <span>Current {formatCurrency(payablesAging.buckets?.current || 0, "PKR")}</span>
                <span>1-30 {formatCurrency(payablesAging.buckets?.days_1_30 || 0, "PKR")}</span>
                <span>31-60 {formatCurrency(payablesAging.buckets?.days_31_60 || 0, "PKR")}</span>
                <span>61-90 {formatCurrency(payablesAging.buckets?.days_61_90 || 0, "PKR")}</span>
                <span>90+ {formatCurrency(payablesAging.buckets?.days_over_90 || 0, "PKR")}</span>
              </div>
            </article>

            <section className="accounting-ledger-panel accounting-full-panel accounting-documents-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Accounts Receivable and Payable</span>
                  <h2>Invoices and bills</h2>
                </div>
                <div className="accounting-row-actions">
                  <button className="accounting-secondary-btn" onClick={() => openDocumentModal(null, "Invoice")} type="button">New invoice</button>
                  <button className="accounting-light-btn" onClick={() => openDocumentModal(null, "Bill")} type="button">New bill</button>
                </div>
              </div>
              {loading ? (
                <div className="accounting-empty">Loading documents...</div>
              ) : documents.length === 0 ? (
                <div className="accounting-empty">No invoices or bills yet.</div>
              ) : (
                <div className="accounting-table-wrap">
                  <table className="accounting-table accounting-documents-table">
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Contact</th>
                        <th>Due</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Balance</th>
                        <th>Status</th>
                        <th>Payments</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((document) => (
                        <tr key={document.id}>
                          <td>
                            <strong>{document.document_no}</strong>
                            <small>{document.document_type} / {formatDate(document.issue_date)}</small>
                          </td>
                          <td>
                            <strong>{document.contact_name}</strong>
                            <small>{document.contact_email || "No email"}</small>
                          </td>
                          <td>
                            <span>{formatDate(document.due_date)}</span>
                            <small>{document.days_past_due > 0 ? `${document.days_past_due} days overdue` : "On schedule"}</small>
                          </td>
                          <td>{formatCurrency(document.total, document.currency)}</td>
                          <td>{formatCurrency(document.paid_total, document.currency)}</td>
                          <td>{formatCurrency(document.balance_due, document.currency)}</td>
                          <td><span className={`accounting-chip ${document.payment_status === "Paid" ? "is-in" : document.payment_status === "Overdue" ? "is-out" : ""}`}>{document.payment_status}</span></td>
                          <td>
                            {(document.payments || []).length === 0 ? (
                              <small>No payments</small>
                            ) : (
                              (document.payments || []).map((payment) => (
                                <small key={payment.id}>{formatDate(payment.payment_date)} / {formatCurrency(payment.amount, payment.currency)} <button className="accounting-link-btn" onClick={() => deleteDocumentPayment(payment)} type="button">Delete</button></small>
                              ))
                            )}
                          </td>
                          <td>
                            <div className="accounting-row-actions">
                              {Number(document.balance_due || 0) > 0 && !["Draft", "Void"].includes(document.status) && (
                                <button className="accounting-icon-btn" onClick={() => openPaymentModal(document)} type="button">Pay</button>
                              )}
                              <button className="accounting-icon-btn" onClick={() => openDocumentModal(document)} type="button">Edit</button>
                              <button className="accounting-icon-btn is-danger" onClick={() => deleteDocument(document)} type="button">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}


        {activeTab === "banking" && (
          <section className="accounting-documents-grid accounting-banking-grid">
            {(bankingSummary.rows || []).map((row) => (
              <article className="accounting-report-card" key={row.account_id}>
                <h3>{row.account_name}</h3>
                <div className="accounting-report-row"><span>Statement in</span><strong>{formatCurrency(row.statement_money_in, row.currency)}</strong></div>
                <div className="accounting-report-row"><span>Statement out</span><strong>{formatCurrency(row.statement_money_out, row.currency)}</strong></div>
                <div className="accounting-report-row accounting-report-total"><span>Unmatched</span><strong>{formatNumber(row.unmatched_count)} / {formatCurrency(row.unmatched_amount, row.currency)}</strong></div>
              </article>
            ))}
            {(bankingSummary.rows || []).length === 0 && (
              <article className="accounting-report-card">
                <h3>Banking</h3>
                <div className="accounting-empty compact">Create a Bank, Cash, Wallet, or Platform account to start reconciliation.</div>
              </article>
            )}

            <section className="accounting-ledger-panel accounting-full-panel accounting-documents-panel accounting-bank-rules-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Bank Rules</span>
                  <h2>Auto-categorization rules</h2>
                </div>
                <div className="accounting-mini-actions">
                  <button className="accounting-light-btn" disabled={saving || bankRules.length === 0} onClick={() => runBankRules()} type="button">
                    Run Rules
                  </button>
                  <button className="accounting-secondary-btn" onClick={() => openBankRuleModal()} type="button">
                    New bank rule
                  </button>
                </div>
              </div>
              {bankRules.length === 0 ? (
                <div className="accounting-empty compact">No bank rules yet. Create a rule from a repeated statement description, reference, or counterparty.</div>
              ) : (
                <div className="accounting-rule-list">
                  {bankRules.map((rule) => (
                    <article className="accounting-rule-card" key={rule.id}>
                      <div>
                        <strong>{rule.name}</strong>
                        <small>{rule.match_field} {rule.match_type.toLowerCase()} "{rule.match_value}"</small>
                      </div>
                      <div>
                        <span className={`accounting-chip ${rule.is_active ? "is-in" : ""}`}>{rule.is_active ? "Active" : "Off"}</span>
                        <small>{rule.action}{rule.action === "Create Money Entry" ? ` / ${rule.direction || "Bank direction"} / ${rule.category}` : ""}</small>
                      </div>
                      <div className="accounting-row-actions">
                        <button className="accounting-icon-btn" disabled={saving || !rule.is_active} onClick={() => runBankRules({ rule_id: rule.id })} type="button">Run</button>
                        <button className="accounting-icon-btn" onClick={() => openBankRuleModal(rule)} type="button">Edit</button>
                        <button className="accounting-icon-btn is-danger" onClick={() => deleteBankRule(rule)} type="button">Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="accounting-ledger-panel accounting-full-panel accounting-documents-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Bank Statement Matching</span>
                  <h2>Imported bank transactions</h2>
                </div>
                <div className="accounting-mini-actions">
                  <button className="accounting-light-btn" onClick={openBankImportModal} type="button">
                    Import CSV
                  </button>
                  <button className="accounting-secondary-btn" onClick={() => openBankTransactionModal()} type="button">
                    Add statement line
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="accounting-empty">Loading bank transactions...</div>
              ) : bankTransactions.length === 0 ? (
                <div className="accounting-empty">No bank statement lines yet.</div>
              ) : (
                <div className="accounting-table-wrap">
                  <table className="accounting-table accounting-bank-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Account</th>
                        <th>Description</th>
                        <th>Money in</th>
                        <th>Money out</th>
                        <th>Status</th>
                        <th>Matched to</th>
                        <th>Suggestions</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{formatDate(transaction.transaction_date)}</td>
                          <td>
                            <strong>{transaction.account_name || "Account"}</strong>
                            <small>{transaction.reference || "No reference"}</small>
                          </td>
                          <td>
                            <strong>{transaction.counterparty || "Statement line"}</strong>
                            <small>{transaction.description || transaction.notes || "No description"}</small>
                          </td>
                          <td>{Number(transaction.money_in || 0) > 0 ? formatCurrency(transaction.money_in, transaction.currency) : "-"}</td>
                          <td>{Number(transaction.money_out || 0) > 0 ? formatCurrency(transaction.money_out, transaction.currency) : "-"}</td>
                          <td><span className={`accounting-chip ${transaction.status === "Matched" ? "is-in" : transaction.status === "Ignored" ? "" : "is-out"}`}>{transaction.status}</span></td>
                          <td>{transaction.matched_label || (transaction.matched_source_type ? `${transaction.matched_source_type} #${transaction.matched_source_id}` : "-")}</td>
                          <td>{transaction.status === "Unmatched" && bankSuggestionCounts[transaction.id] ? `${bankSuggestionCounts[transaction.id]} exact` : "-"}</td>
                          <td>
                            <div className="accounting-row-actions">
                              {transaction.status === "Matched" ? (
                                <button className="accounting-icon-btn" onClick={() => unmatchBankTransaction(transaction)} type="button">Unmatch</button>
                              ) : (
                                <>
                                  <button className="accounting-icon-btn" onClick={() => openBankMatchModal(transaction)} type="button">Match</button>
                                  <button className="accounting-icon-btn" disabled={saving || bankRules.length === 0} onClick={() => runBankRules({ bank_transaction_id: transaction.id })} type="button">Rules</button>
                                  <button className="accounting-icon-btn" onClick={() => openBankRuleModal(null, transaction)} type="button">Make rule</button>
                                </>
                              )}
                              <button className="accounting-icon-btn" onClick={() => openBankTransactionModal(transaction)} type="button">Edit</button>
                              <button className="accounting-icon-btn is-danger" onClick={() => deleteBankTransaction(transaction)} type="button">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {activeTab === "recurring" && (
          <section className="accounting-documents-grid accounting-banking-grid">
            <article className="accounting-report-card">
              <h3>Active Automations</h3>
              <div className="accounting-report-row"><span>Templates</span><strong>{formatNumber(recurringTemplates.length)}</strong></div>
              <div className="accounting-report-row"><span>Active</span><strong>{formatNumber(recurringTemplates.filter((template) => template.status === "Active").length)}</strong></div>
              <div className="accounting-report-row accounting-report-total"><span>Due now</span><strong>{formatNumber(recurringDueCount)}</strong></div>
            </article>
            <article className="accounting-report-card">
              <h3>Generated History</h3>
              <div className="accounting-report-row"><span>Total generated</span><strong>{formatNumber(summary.recurring_generated_total ?? recurringGeneratedCount)}</strong></div>
              <div className="accounting-report-row"><span>Money entries</span><strong>{formatNumber(recurringTemplates.filter((template) => template.template_type === "Money Entry").length)}</strong></div>
              <div className="accounting-report-row accounting-report-total"><span>Documents</span><strong>{formatNumber(recurringTemplates.filter((template) => template.template_type !== "Money Entry").length)}</strong></div>
            </article>
            <article className="accounting-report-card">
              <h3>Scheduler Status</h3>
              <div className="accounting-report-row"><span>Background job</span><strong>{schedulerRunning ? "Running" : "Stopped"}</strong></div>
              <div className="accounting-report-row"><span>Last checked</span><strong>{summary.recurring_scheduler_last_checked_at ? formatDate(summary.recurring_scheduler_last_checked_at) : "Not yet"}</strong></div>
              <div className="accounting-report-row accounting-report-total"><span>Next run</span><strong>{recurringAutomation.next_run_date ? formatDate(recurringAutomation.next_run_date) : "No active schedule"}</strong></div>
              {summary.recurring_scheduler_last_error && <small className="accounting-report-warning">{summary.recurring_scheduler_last_error}</small>}
            </article>

            <section className="accounting-ledger-panel accounting-full-panel accounting-documents-panel">
              <div className="accounting-panel-heading">
                <div>
                  <span>Recurring</span>
                  <h2>Scheduled money entries, invoices, and bills</h2>
                </div>
                <div className="accounting-mini-actions">
                  <button className="accounting-light-btn" disabled={saving || recurringTemplates.length === 0} onClick={() => runRecurringTemplates()} type="button">
                    Generate Due
                  </button>
                  <button className="accounting-secondary-btn" onClick={() => openRecurringModal()} type="button">
                    New recurring
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="accounting-empty">Loading recurring templates...</div>
              ) : recurringTemplates.length === 0 ? (
                <div className="accounting-empty">No recurring templates yet. Add monthly rent, subscriptions, repeated supplier bills, or scheduled customer invoices.</div>
              ) : (
                <div className="accounting-table-wrap">
                  <table className="accounting-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Schedule</th>
                        <th>Posting</th>
                        <th>Amount</th>
                        <th>Next run</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recurringTemplates.map((template) => (
                        <tr key={template.id}>
                          <td>
                            <strong>{template.name}</strong>
                            <small>{template.notes || template.line_description || "No notes"}</small>
                          </td>
                          <td><span className={`accounting-chip ${template.template_type === "Money Entry" ? "" : "is-in"}`}>{template.template_type}</span></td>
                          <td>
                            <strong>{template.frequency}</strong>
                            <small>Every {formatNumber(template.interval_count || 1)} interval</small>
                          </td>
                          <td>
                            <strong>{template.template_type === "Money Entry" ? template.direction : template.contact_name || "No contact"}</strong>
                            <small>{template.template_type === "Money Entry" ? template.category : template.line_account_name || "No line account"}</small>
                          </td>
                          <td>
                            <strong>{formatCurrency(Number(template.amount || 0) + Number(template.tax_amount || 0), template.currency)}</strong>
                            {Number(template.tax_amount || 0) > 0 && <small>Tax {formatCurrency(template.tax_amount, template.currency)}</small>}
                          </td>
                          <td>{formatDate(template.next_run_date)}</td>
                          <td>
                            <span className={`accounting-chip ${template.status === "Active" ? "is-in" : ""}`}>{template.status}</span>
                            <small>{formatNumber(template.occurrences_generated || 0)} generated</small>
                          </td>
                          <td>
                            <div className="accounting-row-actions">
                              <button className="accounting-icon-btn" disabled={saving || template.status !== "Active"} onClick={() => runRecurringTemplates({ template_id: template.id })} type="button">Run</button>
                              <button className="accounting-icon-btn" onClick={() => openRecurringModal(template)} type="button">Edit</button>
                              <button className="accounting-icon-btn is-danger" onClick={() => deleteRecurringTemplate(template)} type="button">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}

        {activeTab === "reports" && (
          <section className="accounting-reports-grid">
            <article className="accounting-report-card">
              <h3>Profit And Loss</h3>
              <div className="accounting-report-row"><span>Total income</span><strong>{formatCurrency(profitLoss.total_income, "PKR")}</strong></div>
              <div className="accounting-report-row"><span>Total expenses</span><strong>{formatCurrency(profitLoss.total_expenses, "PKR")}</strong></div>
              <div className="accounting-report-row accounting-report-total"><span>Net income</span><strong>{formatCurrency(profitLoss.net_income, "PKR")}</strong></div>
              {(profitLoss.income || []).map((row) => (
                <div className="accounting-report-row" key={`income-${row.account_id}`}><span>{row.account_name}</span><strong>{formatCurrency(row.amount, "PKR")}</strong></div>
              ))}
              {(profitLoss.expenses || []).map((row) => (
                <div className="accounting-report-row" key={`expense-${row.account_id}`}><span>{row.account_name}</span><strong>{formatCurrency(row.amount, "PKR")}</strong></div>
              ))}
            </article>

            <article className="accounting-report-card">
              <h3>Balance Sheet</h3>
              <div className="accounting-report-row"><span>Total assets</span><strong>{formatCurrency(balanceSheet.total_assets, "PKR")}</strong></div>
              <div className="accounting-report-row"><span>Liabilities</span><strong>{formatCurrency(balanceSheet.total_liabilities, "PKR")}</strong></div>
              <div className="accounting-report-row"><span>Equity</span><strong>{formatCurrency(balanceSheet.total_equity, "PKR")}</strong></div>
              <div className="accounting-report-row"><span>Current earnings</span><strong>{formatCurrency(balanceSheet.current_earnings, "PKR")}</strong></div>
              <div className="accounting-report-row accounting-report-total"><span>Difference</span><strong>{formatCurrency(balanceSheet.difference, "PKR")}</strong></div>
              <small className={balanceSheet.is_balanced ? "accounting-report-ok" : "accounting-report-warning"}>
                {balanceSheet.is_balanced ? "Balanced" : "Needs review"}
              </small>
            </article>

            <article className="accounting-report-card accounting-report-wide">
              <h3>Trial Balance</h3>
              <div className="accounting-report-row accounting-report-total">
                <span>Debits: {formatCurrency(trialBalance.total_debit, "PKR")}</span>
                <strong>Credits: {formatCurrency(trialBalance.total_credit, "PKR")}</strong>
              </div>
              <div className="accounting-table-wrap">
                <table className="accounting-table accounting-report-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Class</th>
                      <th>Debit</th>
                      <th>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(trialBalance.rows || []).map((row) => (
                      <tr key={row.account_id}>
                        <td>{row.account_name}</td>
                        <td>{row.account_class}</td>
                        <td>{formatCurrency(row.debit, "PKR")}</td>
                        <td>{formatCurrency(row.credit, "PKR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}
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


      {journalModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal journal-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{journalModal.id ? "Edit journal" : "New journal"}</h2>
              <button onClick={closeJournalModal} type="button">
                Close
              </button>
            </div>
            <form className="accounting-form" onSubmit={handleJournalSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Entry number</span>
                  <input
                    placeholder="Auto"
                    value={journalForm.entry_no}
                    onChange={(event) =>
                      setJournalForm((current) => ({
                        ...current,
                        entry_no: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Date</span>
                  <input
                    required
                    type="datetime-local"
                    value={journalForm.entry_date}
                    onChange={(event) =>
                      setJournalForm((current) => ({
                        ...current,
                        entry_date: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={journalForm.status}
                    onChange={(event) =>
                      setJournalForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                  >
                    <option value="Posted">Posted</option>
                    <option value="Draft">Draft</option>
                  </select>
                </label>
                <label className="accounting-wide-field">
                  <span>Memo</span>
                  <textarea
                    rows="2"
                    placeholder="Reason for this journal entry"
                    value={journalForm.memo}
                    onChange={(event) =>
                      setJournalForm((current) => ({
                        ...current,
                        memo: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="accounting-journal-lines">
                {journalForm.lines.map((line, index) => (
                  <div className="accounting-journal-line" key={`journal-line-${index}`}>
                    <label>
                      <span>Account</span>
                      <select
                        required
                        value={line.account_id}
                        onChange={(event) =>
                          updateJournalLine(index, { account_id: event.target.value })
                        }
                      >
                        <option value="">Select account</option>
                        {activeAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} ({account.account_type})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Description</span>
                      <input
                        value={line.description}
                        onChange={(event) =>
                          updateJournalLine(index, { description: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Debit</span>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={line.debit}
                        onChange={(event) =>
                          updateJournalLine(index, {
                            debit: event.target.value,
                            credit: event.target.value ? "" : line.credit,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Credit</span>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={line.credit}
                        onChange={(event) =>
                          updateJournalLine(index, {
                            credit: event.target.value,
                            debit: event.target.value ? "" : line.debit,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Currency</span>
                      <input
                        value={line.currency}
                        onChange={(event) =>
                          updateJournalLine(index, { currency: event.target.value.toUpperCase() })
                        }
                      />
                    </label>
                    <label>
                      <span>Rate</span>
                      <input
                        min="0"
                        step="0.0001"
                        type="number"
                        value={line.exchange_rate}
                        onChange={(event) =>
                          updateJournalLine(index, { exchange_rate: event.target.value })
                        }
                      />
                    </label>
                    <button
                      className="accounting-icon-btn is-danger accounting-journal-remove"
                      disabled={journalForm.lines.length <= 2}
                      onClick={() => removeJournalLine(index)}
                      type="button"
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>

              <div className="accounting-journal-footer">
                <button className="accounting-light-btn" onClick={addJournalLine} type="button">
                  Add line
                </button>
                <div className={`accounting-journal-balance ${journalTotals.isBalanced ? "is-balanced" : "is-unbalanced"}`}>
                  <span>Debit {formatCurrency(journalTotals.debit, "PKR")}</span>
                  <span>Credit {formatCurrency(journalTotals.credit, "PKR")}</span>
                  <strong>Difference {formatCurrency(journalTotals.difference, "PKR")}</strong>
                </div>
              </div>

              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeJournalModal} type="button">
                  Cancel
                </button>
                <button className="accounting-primary-btn" disabled={saving || !journalTotals.isBalanced} type="submit">
                  Save journal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {recurringModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal document-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{recurringModal.id ? "Edit recurring template" : "New recurring template"}</h2>
              <button onClick={closeRecurringModal} type="button">Close</button>
            </div>
            <form className="accounting-form" onSubmit={handleRecurringSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Name *</span>
                  <input required value={recurringForm.name} onChange={(event) => setRecurringForm((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label>
                  <span>Type</span>
                  <select value={recurringForm.template_type} onChange={(event) => updateRecurringType(event.target.value)}>
                    {recurringTypes.map((type) => (<option key={type} value={type}>{type}</option>))}
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select value={recurringForm.status} onChange={(event) => setRecurringForm((current) => ({ ...current, status: event.target.value }))}>
                    {recurringStatuses.map((status) => (<option key={status} value={status}>{status}</option>))}
                  </select>
                </label>
                <label>
                  <span>Frequency</span>
                  <select value={recurringForm.frequency} onChange={(event) => setRecurringForm((current) => ({ ...current, frequency: event.target.value }))}>
                    {recurringFrequencies.map((frequency) => (<option key={frequency} value={frequency}>{frequency}</option>))}
                  </select>
                </label>
                <label>
                  <span>Interval</span>
                  <input min="1" type="number" value={recurringForm.interval_count} onChange={(event) => setRecurringForm((current) => ({ ...current, interval_count: event.target.value }))} />
                </label>
                <label>
                  <span>Next run</span>
                  <input required type="datetime-local" value={recurringForm.next_run_date} onChange={(event) => setRecurringForm((current) => ({ ...current, next_run_date: event.target.value }))} />
                </label>
                <label>
                  <span>End date</span>
                  <input type="datetime-local" value={recurringForm.end_date} onChange={(event) => setRecurringForm((current) => ({ ...current, end_date: event.target.value }))} />
                </label>
                <label>
                  <span>Max runs</span>
                  <input min="1" type="number" value={recurringForm.max_occurrences} onChange={(event) => setRecurringForm((current) => ({ ...current, max_occurrences: event.target.value }))} />
                </label>
                {recurringForm.template_type === "Money Entry" ? (
                  <>
                    <label>
                      <span>Account</span>
                      <select required value={recurringForm.account_id} onChange={(event) => setRecurringForm((current) => ({ ...current, account_id: event.target.value }))}>
                        <option value="">Select account</option>
                        {recurringMoneyAccounts.map((account) => (<option key={account.id} value={account.id}>{account.name} ({account.account_type})</option>))}
                      </select>
                    </label>
                    <label>
                      <span>Direction</span>
                      <select value={recurringForm.direction} onChange={(event) => setRecurringForm((current) => ({ ...current, direction: event.target.value, category: event.target.value === "Money Out" ? "Expense" : "Sales" }))}>
                        <option value="Money In">Money In</option>
                        <option value="Money Out">Money Out</option>
                      </select>
                    </label>
                    <label>
                      <span>Category</span>
                      <select value={recurringForm.category} onChange={(event) => setRecurringForm((current) => ({ ...current, category: event.target.value }))}>
                        {transactionCategoriesFor(recurringForm.direction).map((category) => (<option key={category} value={category}>{category}</option>))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      <span>Contact name *</span>
                      <input required value={recurringForm.contact_name} onChange={(event) => setRecurringForm((current) => ({ ...current, contact_name: event.target.value }))} />
                    </label>
                    <label>
                      <span>Contact email</span>
                      <input type="email" value={recurringForm.contact_email} onChange={(event) => setRecurringForm((current) => ({ ...current, contact_email: event.target.value }))} />
                    </label>
                    <label>
                      <span>Line account</span>
                      <select required value={recurringForm.line_account_id} onChange={(event) => setRecurringForm((current) => ({ ...current, line_account_id: event.target.value }))}>
                        <option value="">Select account</option>
                        {activeAccounts.map((account) => (<option key={account.id} value={account.id}>{account.name} ({account.account_type})</option>))}
                      </select>
                    </label>
                    <label>
                      <span>Document status</span>
                      <select value={recurringForm.document_status} onChange={(event) => setRecurringForm((current) => ({ ...current, document_status: event.target.value }))}>
                        <option value="Open">Open</option>
                        <option value="Draft">Draft</option>
                        <option value="Void">Void</option>
                      </select>
                    </label>
                  </>
                )}
                <label>
                  <span>Amount *</span>
                  <input min="0" required step="0.01" type="number" value={recurringForm.amount} onChange={(event) => setRecurringForm((current) => ({ ...current, amount: event.target.value }))} />
                </label>
                <label>
                  <span>Tax</span>
                  <input min="0" step="0.01" type="number" value={recurringForm.tax_amount} onChange={(event) => setRecurringForm((current) => ({ ...current, tax_amount: event.target.value }))} />
                </label>
                <label>
                  <span>Currency</span>
                  <input value={recurringForm.currency} onChange={(event) => setRecurringForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
                </label>
                <label>
                  <span>Exchange rate</span>
                  <input min="0" step="0.0001" type="number" value={recurringForm.exchange_rate} onChange={(event) => setRecurringForm((current) => ({ ...current, exchange_rate: event.target.value }))} />
                </label>
                {recurringForm.template_type !== "Money Entry" && (
                  <label className="accounting-wide-field">
                    <span>Line description</span>
                    <textarea rows="2" value={recurringForm.line_description} onChange={(event) => setRecurringForm((current) => ({ ...current, line_description: event.target.value }))} />
                  </label>
                )}
                <label className="accounting-wide-field">
                  <span>Notes</span>
                  <textarea rows="2" value={recurringForm.notes} onChange={(event) => setRecurringForm((current) => ({ ...current, notes: event.target.value }))} />
                </label>
              </div>
              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeRecurringModal} type="button">Cancel</button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">Save template</button>
              </div>
            </form>
          </div>
        </div>
      )}


      {bankRuleModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal compact-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{bankRuleModal.id ? "Edit bank rule" : "New bank rule"}</h2>
              <button onClick={closeBankRuleModal} type="button">Close</button>
            </div>
            <form className="accounting-form" onSubmit={handleBankRuleSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Rule name</span>
                  <input required value={bankRuleForm.name} onChange={(event) => setBankRuleForm((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label>
                  <span>Account scope</span>
                  <select value={bankRuleForm.account_id} onChange={(event) => setBankRuleForm((current) => ({ ...current, account_id: event.target.value }))}>
                    <option value="">Any bank/cash account</option>
                    {bankAccounts.map((account) => (<option key={account.id} value={account.id}>{account.name} ({account.account_type})</option>))}
                  </select>
                </label>
                <label>
                  <span>Match field</span>
                  <select value={bankRuleForm.match_field} onChange={(event) => setBankRuleForm((current) => ({ ...current, match_field: event.target.value }))}>
                    {bankRuleMatchFields.map((field) => (<option key={field} value={field}>{field}</option>))}
                  </select>
                </label>
                <label>
                  <span>Match type</span>
                  <select value={bankRuleForm.match_type} onChange={(event) => setBankRuleForm((current) => ({ ...current, match_type: event.target.value }))}>
                    {bankRuleMatchTypes.map((type) => (<option key={type} value={type}>{type}</option>))}
                  </select>
                </label>
                <label className="accounting-wide-field">
                  <span>Text to match</span>
                  <input required value={bankRuleForm.match_value} onChange={(event) => setBankRuleForm((current) => ({ ...current, match_value: event.target.value }))} />
                </label>
                <label>
                  <span>Action</span>
                  <select value={bankRuleForm.action} onChange={(event) => setBankRuleForm((current) => ({ ...current, action: event.target.value }))}>
                    {bankRuleActions.map((action) => (<option key={action} value={action}>{action}</option>))}
                  </select>
                </label>
                <label>
                  <span>Direction</span>
                  <select disabled={bankRuleForm.action === "Ignore"} value={bankRuleForm.direction} onChange={(event) => setBankRuleForm((current) => ({ ...current, direction: event.target.value, category: event.target.value === "Money Out" ? "Expense" : event.target.value === "Money In" ? "Sales" : current.category }))}>
                    <option value="">Use bank line direction</option>
                    <option value="Money In">Money In</option>
                    <option value="Money Out">Money Out</option>
                  </select>
                </label>
                <label>
                  <span>Category</span>
                  <select disabled={bankRuleForm.action === "Ignore"} value={bankRuleForm.category} onChange={(event) => setBankRuleForm((current) => ({ ...current, category: event.target.value }))}>
                    {transactionCategoriesFor(bankRuleForm.direction || "Money In").map((category) => (<option key={category} value={category}>{category}</option>))}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <input type="number" value={bankRuleForm.priority} onChange={(event) => setBankRuleForm((current) => ({ ...current, priority: event.target.value }))} />
                </label>
                <label>
                  <span>Counterparty override</span>
                  <input disabled={bankRuleForm.action === "Ignore"} value={bankRuleForm.counterparty} onChange={(event) => setBankRuleForm((current) => ({ ...current, counterparty: event.target.value }))} />
                </label>
                <label>
                  <span>Platform</span>
                  <input disabled={bankRuleForm.action === "Ignore"} value={bankRuleForm.platform} onChange={(event) => setBankRuleForm((current) => ({ ...current, platform: event.target.value }))} />
                </label>
                <label className="accounting-toggle-field">
                  <input checked={bankRuleForm.is_active} onChange={(event) => setBankRuleForm((current) => ({ ...current, is_active: event.target.checked }))} type="checkbox" />
                  <span>Rule active</span>
                </label>
                <label className="accounting-toggle-field">
                  <input checked={bankRuleForm.auto_match} disabled={bankRuleForm.action === "Ignore"} onChange={(event) => setBankRuleForm((current) => ({ ...current, auto_match: event.target.checked }))} type="checkbox" />
                  <span>Create and match automatically</span>
                </label>
                <label className="accounting-wide-field">
                  <span>Description template</span>
                  <textarea disabled={bankRuleForm.action === "Ignore"} rows="2" value={bankRuleForm.description_template} onChange={(event) => setBankRuleForm((current) => ({ ...current, description_template: event.target.value }))} />
                </label>
              </div>
              <div className="accounting-import-help">Templates can use description, reference, counterparty, and rule placeholders in braces.</div>
              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeBankRuleModal} type="button">Cancel</button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">Save rule</button>
              </div>
            </form>
          </div>
        </div>
      )}


      {bankImportModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal document-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>Import bank CSV</h2>
              <button onClick={closeBankImportModal} type="button">Close</button>
            </div>
            <form className="accounting-form" onSubmit={handleBankImportSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Bank or cash account</span>
                  <select required value={bankImportForm.account_id} onChange={(event) => setBankImportForm((current) => ({ ...current, account_id: event.target.value }))}>
                    <option value="">Select account</option>
                    {bankAccounts.map((account) => (<option key={account.id} value={account.id}>{account.name} ({account.account_type})</option>))}
                  </select>
                </label>
                <label>
                  <span>Currency</span>
                  <input value={bankImportForm.currency} onChange={(event) => setBankImportForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
                </label>
                <label>
                  <span>Exchange rate to PKR</span>
                  <input min="0" step="0.0001" type="number" value={bankImportForm.exchange_rate} onChange={(event) => setBankImportForm((current) => ({ ...current, exchange_rate: event.target.value }))} />
                </label>
                <label className="accounting-toggle-field">
                  <input checked={bankImportForm.skip_duplicates} onChange={(event) => setBankImportForm((current) => ({ ...current, skip_duplicates: event.target.checked }))} type="checkbox" />
                  <span>Skip duplicate statement lines</span>
                </label>
                <label><span>Date column</span><input value={bankImportForm.date_column} onChange={(event) => setBankImportForm((current) => ({ ...current, date_column: event.target.value }))} /></label>
                <label><span>Description column</span><input value={bankImportForm.description_column} onChange={(event) => setBankImportForm((current) => ({ ...current, description_column: event.target.value }))} /></label>
                <label><span>Reference column</span><input value={bankImportForm.reference_column} onChange={(event) => setBankImportForm((current) => ({ ...current, reference_column: event.target.value }))} /></label>
                <label><span>Counterparty column</span><input value={bankImportForm.counterparty_column} onChange={(event) => setBankImportForm((current) => ({ ...current, counterparty_column: event.target.value }))} /></label>
                <label><span>Money in column</span><input value={bankImportForm.money_in_column} onChange={(event) => setBankImportForm((current) => ({ ...current, money_in_column: event.target.value }))} /></label>
                <label><span>Money out column</span><input value={bankImportForm.money_out_column} onChange={(event) => setBankImportForm((current) => ({ ...current, money_out_column: event.target.value }))} /></label>
                <label><span>Signed amount column</span><input value={bankImportForm.amount_column} onChange={(event) => setBankImportForm((current) => ({ ...current, amount_column: event.target.value }))} /></label>
                <label className="accounting-wide-field">
                  <span>CSV text</span>
                  <textarea required rows="9" placeholder={BANK_CSV_SAMPLE} value={bankImportForm.csv_text} onChange={(event) => setBankImportForm((current) => ({ ...current, csv_text: event.target.value }))} />
                </label>
              </div>
              <div className="accounting-import-help">Use either money_in and money_out columns, or leave those blank and map one signed amount column.</div>
              {bankImportResult && (
                <div className="accounting-import-result">
                  <div><strong>{bankImportResult.created || 0}</strong><span>created</span></div>
                  <div><strong>{bankImportResult.skipped || 0}</strong><span>duplicates skipped</span></div>
                  <div><strong>{(bankImportResult.suggestions || []).length}</strong><span>lines with exact match suggestions</span></div>
                  {(bankImportResult.errors || []).length > 0 && (
                    <ul className="accounting-import-errors">
                      {(bankImportResult.errors || []).map((item) => (<li key={`${item.row}-${item.error}`}>Row {item.row}: {item.error}</li>))}
                    </ul>
                  )}
                </div>
              )}
              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeBankImportModal} type="button">Cancel</button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">Import CSV</button>
              </div>
            </form>
          </div>
        </div>
      )}


      {bankModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal compact-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{bankModal.id ? "Edit bank transaction" : "Add bank transaction"}</h2>
              <button onClick={closeBankTransactionModal} type="button">
                Close
              </button>
            </div>
            <form className="accounting-form" onSubmit={handleBankTransactionSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Account</span>
                  <select
                    required
                    value={bankForm.account_id}
                    onChange={(event) => setBankForm((current) => ({ ...current, account_id: event.target.value }))}
                  >
                    <option value="">Select account</option>
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.name} ({account.account_type})</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Date</span>
                  <input
                    required
                    type="datetime-local"
                    value={bankForm.transaction_date}
                    onChange={(event) => setBankForm((current) => ({ ...current, transaction_date: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Money in</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={bankForm.money_in}
                    onChange={(event) => setBankForm((current) => ({ ...current, money_in: event.target.value, money_out: event.target.value ? "" : current.money_out }))}
                  />
                </label>
                <label>
                  <span>Money out</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={bankForm.money_out}
                    onChange={(event) => setBankForm((current) => ({ ...current, money_out: event.target.value, money_in: event.target.value ? "" : current.money_in }))}
                  />
                </label>
                <label>
                  <span>Currency</span>
                  <input
                    value={bankForm.currency}
                    onChange={(event) => setBankForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                  />
                </label>
                <label>
                  <span>Exchange rate</span>
                  <input
                    min="0"
                    step="0.0001"
                    type="number"
                    value={bankForm.exchange_rate}
                    onChange={(event) => setBankForm((current) => ({ ...current, exchange_rate: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Counterparty</span>
                  <input
                    value={bankForm.counterparty}
                    onChange={(event) => setBankForm((current) => ({ ...current, counterparty: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Reference</span>
                  <input
                    value={bankForm.reference}
                    onChange={(event) => setBankForm((current) => ({ ...current, reference: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={bankForm.status}
                    onChange={(event) => setBankForm((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="Unmatched">Unmatched</option>
                    <option value="Ignored">Ignored</option>
                  </select>
                </label>
                <label className="accounting-wide-field">
                  <span>Description</span>
                  <textarea
                    rows="2"
                    value={bankForm.description}
                    onChange={(event) => setBankForm((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <label className="accounting-wide-field">
                  <span>Notes</span>
                  <textarea
                    rows="2"
                    value={bankForm.notes}
                    onChange={(event) => setBankForm((current) => ({ ...current, notes: event.target.value }))}
                  />
                </label>
              </div>
              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeBankTransactionModal} type="button">Cancel</button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">Save line</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bankMatchModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal compact-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>Match bank transaction</h2>
              <button onClick={closeBankMatchModal} type="button">Close</button>
            </div>
            <form className="accounting-form" onSubmit={matchBankTransaction}>
              <div className="accounting-match-summary">
                <strong>{bankMatchModal.counterparty || bankMatchModal.description || "Statement line"}</strong>
                <span>{Number(bankMatchModal.money_in || 0) > 0 ? formatCurrency(bankMatchModal.money_in, bankMatchModal.currency) : formatCurrency(bankMatchModal.money_out, bankMatchModal.currency)}</span>
              </div>
              <label className="accounting-wide-field">
                <span>Matching source</span>
                <select
                  required
                  value={bankMatchSource}
                  onChange={(event) => setBankMatchSource(event.target.value)}
                >
                  <option value="">Select matching money entry or payment</option>
                  {availableBankMatchCandidates.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
                  ))}
                </select>
              </label>
              {availableBankMatchCandidates.length === 0 && (
                <div className="accounting-empty compact">No exact same-account, same-amount candidates found. Create or edit the source money entry/payment first.</div>
              )}
              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeBankMatchModal} type="button">Cancel</button>
                <button className="accounting-primary-btn" disabled={saving || !bankMatchSource} type="submit">Match</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {documentModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal document-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>{documentModal.id ? `Edit ${documentForm.document_type.toLowerCase()}` : `New ${documentForm.document_type.toLowerCase()}`}</h2>
              <button onClick={closeDocumentModal} type="button">
                Close
              </button>
            </div>
            <form className="accounting-form" onSubmit={handleDocumentSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Type</span>
                  <select
                    disabled={Boolean(documentModal.id)}
                    value={documentForm.document_type}
                    onChange={(event) =>
                      setDocumentForm((current) => ({
                        ...current,
                        document_type: event.target.value,
                      }))
                    }
                  >
                    <option value="Invoice">Invoice</option>
                    <option value="Bill">Bill</option>
                  </select>
                </label>
                <label>
                  <span>Document number</span>
                  <input
                    placeholder="Auto"
                    value={documentForm.document_no}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, document_no: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Contact name *</span>
                  <input
                    required
                    value={documentForm.contact_name}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, contact_name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Contact email</span>
                  <input
                    type="email"
                    value={documentForm.contact_email}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, contact_email: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Issue date</span>
                  <input
                    required
                    type="datetime-local"
                    value={documentForm.issue_date}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, issue_date: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Due date</span>
                  <input
                    type="datetime-local"
                    value={documentForm.due_date}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, due_date: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={documentForm.status}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, status: event.target.value }))
                    }
                  >
                    <option value="Open">Open</option>
                    <option value="Draft">Draft</option>
                    <option value="Void">Void</option>
                  </select>
                </label>
                <label>
                  <span>Currency</span>
                  <input
                    value={documentForm.currency}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                    }
                  />
                </label>
                <label>
                  <span>Exchange rate</span>
                  <input
                    min="0"
                    step="0.0001"
                    type="number"
                    value={documentForm.exchange_rate}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, exchange_rate: event.target.value }))
                    }
                  />
                </label>
                <label className="accounting-wide-field">
                  <span>Notes</span>
                  <textarea
                    rows="2"
                    value={documentForm.notes}
                    onChange={(event) =>
                      setDocumentForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="accounting-document-lines">
                {documentForm.lines.map((line, index) => (
                  <div className="accounting-document-line" key={`document-line-${index}`}>
                    <label>
                      <span>Account</span>
                      <select
                        required
                        value={line.account_id}
                        onChange={(event) => updateDocumentLine(index, { account_id: event.target.value })}
                      >
                        <option value="">Select account</option>
                        {activeAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} ({account.account_type})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Description</span>
                      <input
                        value={line.description}
                        onChange={(event) => updateDocumentLine(index, { description: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Qty</span>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={line.quantity}
                        onChange={(event) => updateDocumentLine(index, { quantity: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Unit price</span>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={line.unit_price}
                        onChange={(event) => updateDocumentLine(index, { unit_price: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Amount</span>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={line.amount}
                        onChange={(event) => updateDocumentLine(index, { amount: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Tax</span>
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={line.tax_amount}
                        onChange={(event) => updateDocumentLine(index, { tax_amount: event.target.value })}
                      />
                    </label>
                    <strong className="accounting-document-line-total">
                      {formatCurrency(documentLineTotal(line), documentForm.currency)}
                    </strong>
                    <button
                      className="accounting-icon-btn is-danger accounting-journal-remove"
                      disabled={documentForm.lines.length <= 1}
                      onClick={() => removeDocumentLine(index)}
                      type="button"
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>

              <div className="accounting-journal-footer">
                <button className="accounting-light-btn" onClick={addDocumentLine} type="button">
                  Add line
                </button>
                <div className="accounting-document-total-box">
                  <span>Total</span>
                  <strong>{formatCurrency(documentForm.lines.reduce((total, line) => total + documentLineTotal(line), 0), documentForm.currency)}</strong>
                </div>
              </div>

              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closeDocumentModal} type="button">
                  Cancel
                </button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">
                  Save {documentForm.document_type.toLowerCase()}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {paymentModal && (
        <div className="accounting-modal-backdrop" role="presentation">
          <div className="accounting-modal compact-modal" role="dialog" aria-modal="true">
            <div className="accounting-modal-header">
              <h2>Record payment</h2>
              <button onClick={closePaymentModal} type="button">
                Close
              </button>
            </div>
            <form className="accounting-form" onSubmit={handlePaymentSubmit}>
              <div className="accounting-form-grid">
                <label>
                  <span>Document</span>
                  <input disabled value={paymentModal.document_no || ""} />
                </label>
                <label>
                  <span>Pay from/to account</span>
                  <select
                    required
                    value={paymentForm.account_id}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, account_id: event.target.value }))
                    }
                  >
                    <option value="">Select account</option>
                    {activeAccounts
                      .filter((account) => ["Bank", "Cash", "Wallet", "Platform"].includes(account.account_type))
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.account_type})
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>Amount</span>
                  <input
                    min="0.01"
                    required
                    step="0.01"
                    type="number"
                    value={paymentForm.amount}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Payment date</span>
                  <input
                    required
                    type="datetime-local"
                    value={paymentForm.payment_date}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, payment_date: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Currency</span>
                  <input
                    value={paymentForm.currency}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                    }
                  />
                </label>
                <label>
                  <span>Exchange rate</span>
                  <input
                    min="0"
                    step="0.0001"
                    type="number"
                    value={paymentForm.exchange_rate}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, exchange_rate: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Reference</span>
                  <input
                    value={paymentForm.reference}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, reference: event.target.value }))
                    }
                  />
                </label>
                <label className="accounting-wide-field">
                  <span>Notes</span>
                  <textarea
                    rows="2"
                    value={paymentForm.notes}
                    onChange={(event) =>
                      setPaymentForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="accounting-modal-actions">
                <button className="accounting-light-btn" onClick={closePaymentModal} type="button">
                  Cancel
                </button>
                <button className="accounting-primary-btn" disabled={saving} type="submit">
                  Save payment
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
                    <option value="Accounts Receivable">Accounts Receivable</option>
                    <option value="Accounts Payable">Accounts Payable</option>
                    <option value="Sales Revenue">Sales Revenue</option>
                    <option value="Other Income">Other Income</option>
                    <option value="General Expenses">General Expenses</option>
                    <option value="Cost of Goods Sold">Cost of Goods Sold</option>
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
