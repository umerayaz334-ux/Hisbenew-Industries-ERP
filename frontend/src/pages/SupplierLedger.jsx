import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import "./SupplierLedger.css";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatExcelNumber = (value) => Number(value || 0).toFixed(2);

const getSupplierLedgerIdFromPath = () => {
  const match = window.location.pathname.match(
    /^\/portal\/suppliers\/(\d+)\/ledger\/?$/
  );
  return match ? Number(match[1]) : null;
};

const getActiveFaultyQuantity = (movement = {}) => {
  if (!movement.faulty) return 0;

  const quantity = Math.max(Number(movement.quantity || 0), 0);
  const faultyQuantity = Math.max(Number(movement.faulty_quantity || 0), 0);
  return Math.min(faultyQuantity, quantity);
};

const getPayableStockQuantity = (movement = {}) => {
  const quantity = Math.max(Number(movement.quantity || 0), 0);
  return Math.max(quantity - getActiveFaultyQuantity(movement), 0);
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const sanitizeFilename = (value) =>
  String(value || "supplier")
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "supplier";

const buildSupplierLedgerEntries = (supplier) => {
  if (!supplier) return [];

  const stockRows = (supplier.stock_movements || [])
    .filter((movement) => movement.movement_type === "Supplier Purchase")
    .map((movement) => {
      const quantity = Math.max(Number(movement.quantity || 0), 0);
      const payableQuantity = getPayableStockQuantity(movement);
      const unitPrice = Number(movement.purchase_price || 0);
      const total = unitPrice * payableQuantity;
      const faultyDeducted = quantity - payableQuantity;

      return {
        id: `stock-${movement.id}`,
        balanceDelta: total,
        credit: total,
        date: movement.created_at,
        debit: 0,
        ledgerType: "Stock added",
        note:
          faultyDeducted > 0
            ? `Faulty deducted: ${faultyDeducted}`
            : movement.note || "",
        quantity,
        quantityLabel:
          payableQuantity < quantity ? `${payableQuantity}/${quantity}` : String(quantity),
        reference: movement.reference || movement.source || "-",
        sku: movement.article_no || "-",
        sourceType: "stock",
        thumbnailUrl: getStaticUrl(movement.product_image_url),
        total,
        unitPrice,
      };
    });

  const supplyRows = (supplier.supply_items || []).map((item) => {
    const quantity = Math.max(Number(item.quantity || 0), 0);
    const unitPrice = Number(item.unit_price || 0);
    const total = Number(item.line_total || quantity * unitPrice);

    return {
      id: `supply-${item.id}`,
      balanceDelta: total,
      credit: total,
      date: item.created_at,
      debit: 0,
      ledgerType: "Supplies / accessories",
      note: item.note || item.usage_area || "",
      quantity,
      quantityLabel: String(quantity),
      reference: item.sku || item.category || "-",
      sku: item.item_name || "-",
      sourceType: "supply",
      thumbnailUrl: null,
      total,
      unitPrice,
    };
  });

  const paymentRows = (supplier.payments || []).map((payment) => {
    const amount = Number(payment.amount || 0);

    return {
      id: `payment-${payment.id}`,
      balanceDelta: -amount,
      credit: 0,
      date: payment.payment_date || payment.created_at,
      debit: amount,
      ledgerType: "Payment",
      note: payment.note || "",
      quantity: 0,
      quantityLabel: "-",
      reference: payment.payment_reference || payment.payment_method || "-",
      sku: "-",
      sourceType: "payment",
      thumbnailUrl: null,
      total: amount,
      unitPrice: 0,
    };
  });

  const transactionRows = (supplier.transactions || []).map((transaction) => {
    const amount = Number(transaction.amount || 0);

    return {
      id: `transaction-${transaction.id}`,
      balanceDelta: amount,
      credit: amount > 0 ? amount : 0,
      date: transaction.created_at,
      debit: amount < 0 ? Math.abs(amount) : 0,
      ledgerType: transaction.transaction_type || "Adjustment",
      note: transaction.note || "",
      quantity: 0,
      quantityLabel: "-",
      reference: transaction.reference || "-",
      sku: "-",
      sourceType: amount >= 0 ? "credit" : "debit",
      thumbnailUrl: null,
      total: Math.abs(amount),
      unitPrice: 0,
    };
  });

  let runningBalance = 0;
  return [...stockRows, ...supplyRows, ...paymentRows, ...transactionRows]
    .sort((left, right) => {
      const leftTime = parseUtcLocal(left.date)?.getTime() || 0;
      const rightTime = parseUtcLocal(right.date)?.getTime() || 0;
      return leftTime - rightTime;
    })
    .map((entry) => {
      runningBalance += entry.balanceDelta;
      return { ...entry, balance: runningBalance };
    });
};

const SupplierLedger = () => {
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const supplierId = getSupplierLedgerIdFromPath();

  useEffect(() => {
    let active = true;

    if (!supplierId) {
      setNotice("Account ledger link is invalid.");
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    api
      .get(`/suppliers/${supplierId}`)
      .then((response) => {
        if (!active) return;
        setSupplier(response.data);
        setNotice("");
      })
      .catch((error) => {
        console.error("Supplier ledger error:", error);
        if (active) {
          setNotice(error.response?.data?.detail || "Account ledger could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [supplierId]);

  const ledgerEntries = useMemo(
    () => buildSupplierLedgerEntries(supplier),
    [supplier]
  );

  const ledgerTotals = useMemo(
    () =>
      ledgerEntries.reduce(
        (totals, entry) => ({
          credit: totals.credit + Number(entry.credit || 0),
          debit: totals.debit + Number(entry.debit || 0),
          stockQuantity:
            totals.stockQuantity +
            (entry.sourceType === "stock" ? Number(entry.quantity || 0) : 0),
        }),
        { credit: 0, debit: 0, stockQuantity: 0 }
      ),
    [ledgerEntries]
  );

  const exportLedgerExcel = () => {
    const generatedAt = formatUtcLocal(new Date().toISOString());
    const rows = ledgerEntries
      .map((entry) => {
        const thumbnail =
          entry.sourceType === "stock"
            ? entry.thumbnailUrl
              ? `<img src="${escapeHtml(entry.thumbnailUrl)}" width="54" height="54" style="width:54px;height:54px;display:block;margin:0 auto;border:1px solid #d9dee5;" />`
              : `<span class="thumb-empty">No image</span>`
            : "";

        return `
          <tr class="ledger-row ${escapeHtml(entry.sourceType)}" style="height:50pt;mso-height-source:userset;">
            <td>${escapeHtml(formatUtcLocal(entry.date))}</td>
            <td><span class="type-pill ${escapeHtml(entry.sourceType)}">${escapeHtml(entry.ledgerType)}</span></td>
            <td class="thumb-cell" align="center" valign="middle" style="width:62pt;height:50pt;padding:4px;text-align:center;vertical-align:middle;">${thumbnail}</td>
            <td style="mso-number-format:'\\@';">${escapeHtml(entry.sku)}</td>
            <td>${escapeHtml(entry.quantityLabel)}</td>
            <td class="money">${entry.unitPrice ? formatExcelNumber(entry.unitPrice) : ""}</td>
            <td class="money">${formatExcelNumber(entry.total)}</td>
            <td class="money debit">${entry.debit ? formatExcelNumber(entry.debit) : ""}</td>
            <td class="money credit">${entry.credit ? formatExcelNumber(entry.credit) : ""}</td>
            <td class="money balance">${formatExcelNumber(entry.balance)}</td>
            <td>${escapeHtml(entry.reference)}</td>
            <td>${escapeHtml(entry.note)}</td>
          </tr>`;
      })
      .join("");

    const html = `<!doctype html>
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8" />
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Account Ledger</x:Name>
                  <x:WorksheetOptions>
                    <x:FreezePanes/>
                    <x:FrozenNoSplit/>
                    <x:SplitHorizontal>7</x:SplitHorizontal>
                    <x:TopRowBottomPane>7</x:TopRowBottomPane>
                    <x:DisplayGridlines/>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            body {
              margin: 0;
              background: #f5f7fa;
              color: #1f2937;
              font-family: "Segoe UI", Arial, sans-serif;
            }

            table {
              border-collapse: collapse;
              font-family: "Segoe UI", Arial, sans-serif;
            }

            .sheet {
              width: 100%;
            }

            .hero td {
              padding: 18px 20px;
              border: 0;
              background: #1f2937;
              color: #ffffff;
            }

            .hero-title {
              font-size: 22pt;
              font-weight: 700;
              line-height: 1.1;
            }

            .hero-subtitle {
              margin-top: 5px;
              color: #dbe4ee;
              font-size: 10pt;
            }

            .spacer td {
              height: 10pt;
              border: 0;
              background: #f5f7fa;
            }

            .summary td {
              padding: 10px 12px;
              border: 1px solid #d7dde5;
              background: #ffffff;
            }

            .summary-label {
              color: #64748b;
              font-size: 8pt;
              font-weight: 700;
              text-transform: uppercase;
            }

            .summary-value {
              margin-top: 4px;
              color: #111827;
              font-size: 14pt;
              font-weight: 700;
              mso-number-format: "#,##0.00";
            }

            .ledger-table {
              width: 100%;
              table-layout: fixed;
            }

            .ledger-table th {
              height: 25pt;
              padding: 7px 8px;
              border: 1px solid #111827;
              background: #111827;
              color: #ffffff;
              font-size: 8pt;
              font-weight: 700;
              text-align: left;
              vertical-align: middle;
            }

            .ledger-table td {
              height: 50pt;
              padding: 7px 8px;
              border: 1px solid #d7dde5;
              background: #ffffff;
              color: #1f2937;
              font-size: 9pt;
              vertical-align: middle;
              mso-height-source: userset;
            }

            .ledger-row:nth-child(even) td {
              background: #f9fbfd;
            }

            .ledger-row.payment td {
              background: #fff7ed !important;
              border-color: #f0d7bd;
            }

            .ledger-row.debit td {
              background: #fff1f1 !important;
              border-color: #efcaca;
            }

            .ledger-row.credit td {
              background: #f0f8f3 !important;
              border-color: #cfe7d6;
            }

            .thumb-cell {
              width: 62pt;
              height: 50pt;
              padding: 4px !important;
              text-align: center;
              vertical-align: middle;
              mso-width-source: userset;
              mso-height-source: userset;
            }

            .thumb-empty {
              display: block;
              width: 54px;
              height: 54px;
              margin: 0 auto;
              border: 1px solid #d9dee5;
              background: #eef2f6;
              color: #7a8491;
              font-size: 7pt;
              line-height: 54px;
              text-align: center;
            }

            .type-pill {
              display: inline-block;
              padding: 3px 7px;
              border: 1px solid #cfd7e1;
              background: #eef2f6;
              color: #334155;
              font-size: 8pt;
              font-weight: 700;
            }

            .type-pill.stock,
            .type-pill.credit,
            .credit {
              color: #17613a;
            }

            .type-pill.payment,
            .type-pill.debit,
            .debit {
              color: #92402f;
            }

            .money {
              text-align: right;
              mso-number-format: "#,##0.00";
            }

            .balance {
              font-weight: 700;
              background: #f3f6f9 !important;
            }
          </style>
        </head>
        <body>
          <table class="sheet">
            <tr class="hero">
              <td colspan="12">
                <div class="hero-title">${escapeHtml(supplier?.name || "Supplier")} Ledger</div>
                <div class="hero-subtitle">Generated ${escapeHtml(generatedAt)} / ${ledgerEntries.length} entries</div>
              </td>
            </tr>
            <tr class="spacer"><td colspan="12"></td></tr>
          </table>

          <table class="summary">
            <tr>
              <td>
                <div class="summary-label">Stock quantity</div>
                <div class="summary-value">${ledgerTotals.stockQuantity}</div>
              </td>
              <td>
                <div class="summary-label">Debit (PKR)</div>
                <div class="summary-value">${formatExcelNumber(ledgerTotals.debit)}</div>
              </td>
              <td>
                <div class="summary-label">Credit (PKR)</div>
                <div class="summary-value">${formatExcelNumber(ledgerTotals.credit)}</div>
              </td>
              <td>
                <div class="summary-label">Balance (PKR)</div>
                <div class="summary-value">${formatExcelNumber(supplier?.balance_due)}</div>
              </td>
            </tr>
          </table>

          <table class="sheet">
            <tr class="spacer"><td colspan="12"></td></tr>
          </table>

          <table class="ledger-table">
            <col style="width:120pt" />
            <col style="width:95pt" />
            <col style="width:62pt" />
            <col style="width:90pt" />
            <col style="width:58pt" />
            <col style="width:78pt" />
            <col style="width:86pt" />
            <col style="width:86pt" />
            <col style="width:86pt" />
            <col style="width:92pt" />
            <col style="width:110pt" />
            <col style="width:180pt" />
            <thead>
              <tr>
                <th>Date</th>
                <th>Ledger type</th>
                <th>Thumbnail</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit (PKR)</th>
                <th>Total (PKR)</th>
                <th>Debit (PKR)</th>
                <th>Credit (PKR)</th>
                <th>Balance (PKR)</th>
                <th>Reference</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`;

    const blob = new Blob(["\ufeff", html], {
      type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${sanitizeFilename(supplier?.name)}-ledger-${date}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportLedgerPdf = () => {
    const generatedAt = formatUtcLocal(new Date().toISOString());
    const documentTitle = `${supplier?.name || "Account"} Ledger`;
    const rows = ledgerEntries
      .map((entry) => {
        const productCell =
          entry.sourceType === "stock"
            ? `<div class="product-cell">${
                entry.thumbnailUrl
                  ? `<img class="product-thumb" src="${escapeHtml(entry.thumbnailUrl)}" alt="${escapeHtml(entry.sku)}" />`
                  : `<span class="product-thumb empty">No image</span>`
              }<strong>${escapeHtml(entry.sku)}</strong></div>`
            : `<span class="event-product-cell">-</span>`;
        const typeClass = entry.sourceType === "payment" ? "debit" : "credit";

        return `
          <tr class="${escapeHtml(entry.sourceType)}-row">
            <td class="date-cell">${escapeHtml(formatUtcLocal(entry.date))}</td>
            <td><span class="type-chip ${escapeHtml(typeClass)}">${escapeHtml(entry.ledgerType)}</span></td>
            <td>${productCell}</td>
            <td class="number-cell">${escapeHtml(entry.quantityLabel)}</td>
            <td class="money-cell">${entry.unitPrice ? `PKR ${escapeHtml(formatMoney(entry.unitPrice))}` : "-"}</td>
            <td class="money-cell">PKR ${escapeHtml(formatMoney(entry.total))}</td>
            <td class="money-cell debit-text">${entry.debit ? `PKR ${escapeHtml(formatMoney(entry.debit))}` : "-"}</td>
            <td class="money-cell credit-text">${entry.credit ? `PKR ${escapeHtml(formatMoney(entry.credit))}` : "-"}</td>
            <td class="money-cell balance-cell">PKR ${escapeHtml(formatMoney(entry.balance))}</td>
            <td>
              <strong class="reference-text">${escapeHtml(entry.reference)}</strong>
              ${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""}
            </td>
          </tr>`;
      })
      .join("");

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(documentTitle)}</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 10mm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              background: #eef1f5;
              color: #1f2937;
              font-family: "Segoe UI", Arial, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .print-shell {
              width: 277mm;
              min-height: 190mm;
              margin: 0 auto;
              padding: 12mm;
              background: #ffffff;
            }

            .print-toolbar {
              display: flex;
              justify-content: flex-end;
              gap: 8px;
              margin-bottom: 10px;
            }

            .print-toolbar button {
              min-height: 34px;
              padding: 0 12px;
              border: 1px solid #2f3338;
              border-radius: 4px;
              background: #2f3338;
              color: #ffffff;
              cursor: pointer;
              font-size: 12px;
              font-weight: 700;
            }

            .pdf-header {
              display: grid;
              grid-template-columns: minmax(0, 1fr) auto;
              gap: 18px;
              align-items: end;
              padding-bottom: 12px;
              border-bottom: 2px solid #1f2937;
            }

            .pdf-kicker {
              color: #64748b;
              font-size: 9px;
              font-weight: 800;
              letter-spacing: 0.6px;
              text-transform: uppercase;
            }

            h1 {
              margin: 4px 0 0;
              color: #111827;
              font-size: 24px;
              line-height: 1.05;
            }

            .pdf-meta {
              margin-top: 6px;
              color: #64748b;
              font-size: 11px;
            }

            .balance-box {
              min-width: 190px;
              padding: 10px 12px;
              border: 1px solid #d7dde5;
              border-radius: 6px;
              background: #f8fafc;
              text-align: right;
            }

            .balance-box span {
              display: block;
              color: #64748b;
              font-size: 9px;
              font-weight: 800;
              text-transform: uppercase;
            }

            .balance-box strong {
              display: block;
              margin-top: 4px;
              color: #111827;
              font-size: 18px;
            }

            .summary-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 8px;
              margin: 12px 0;
            }

            .summary-card {
              min-height: 54px;
              padding: 9px 10px;
              border: 1px solid #d7dde5;
              border-radius: 6px;
              background: #f9fbfd;
            }

            .summary-card span {
              display: block;
              color: #64748b;
              font-size: 9px;
              font-weight: 800;
              text-transform: uppercase;
            }

            .summary-card strong {
              display: block;
              margin-top: 4px;
              color: #111827;
              font-size: 14px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }

            thead {
              display: table-header-group;
            }

            tr {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            th {
              padding: 8px 7px;
              border: 1px solid #111827;
              background: #111827;
              color: #ffffff;
              font-size: 9px;
              font-weight: 800;
              text-align: left;
              text-transform: uppercase;
            }

            td {
              padding: 7px;
              border: 1px solid #d9dee5;
              color: #1f2937;
              font-size: 10px;
              line-height: 1.35;
              vertical-align: middle;
            }

            tbody tr:nth-child(even) td {
              background: #f8fafc;
            }

            tbody tr.payment-row td {
              background: #fff7ed;
              border-color: #f0d7bd;
            }

            tbody tr.debit-row td {
              background: #fff1f1;
              border-color: #efcaca;
            }

            tbody tr.credit-row td {
              background: #f0f8f3;
              border-color: #cfe7d6;
            }

            small {
              display: block;
              margin-top: 3px;
              color: #64748b;
              font-size: 8.5px;
              line-height: 1.35;
            }

            .date-cell {
              width: 92px;
            }

            .product-cell {
              display: grid;
              grid-template-columns: 42px minmax(0, 1fr);
              align-items: center;
              gap: 7px;
            }

            .product-thumb {
              display: block;
              width: 42px;
              height: 42px;
              border: 1px solid #cfd7e1;
              border-radius: 5px;
              background: #eef2f6;
              object-fit: cover;
            }

            .product-thumb.empty {
              display: grid;
              place-items: center;
              color: #7a8491;
              font-size: 7px;
              font-weight: 800;
              line-height: 1.1;
              text-align: center;
            }

            .product-cell strong,
            .reference-text,
            .event-product-cell {
              color: #111827;
              font-size: 10px;
              font-weight: 800;
              overflow-wrap: anywhere;
            }

            .type-chip {
              display: inline-flex;
              min-height: 22px;
              align-items: center;
              padding: 0 7px;
              border: 1px solid #cfd7e1;
              border-radius: 999px;
              background: #ffffff;
              font-size: 8px;
              font-weight: 800;
              white-space: nowrap;
            }

            .type-chip.credit,
            .credit-text {
              color: #17613a;
            }

            .type-chip.debit,
            .debit-text {
              color: #92402f;
            }

            .number-cell,
            .money-cell {
              text-align: right;
              white-space: nowrap;
            }

            .balance-cell {
              color: #111827;
              font-weight: 800;
            }

            .footer {
              margin-top: 10px;
              color: #64748b;
              font-size: 9px;
              text-align: right;
            }

            @media print {
              body {
                background: #ffffff;
              }

              .print-shell {
                width: auto;
                min-height: auto;
                margin: 0;
                padding: 0;
              }

              .print-toolbar {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <main class="print-shell">
            <div class="print-toolbar">
              <button type="button" onclick="window.print()">Save / Print PDF</button>
            </div>

            <header class="pdf-header">
              <div>
                <span class="pdf-kicker">Account ledger</span>
                <h1>${escapeHtml(documentTitle)}</h1>
                <div class="pdf-meta">Generated ${escapeHtml(generatedAt)} / ${ledgerEntries.length} entries</div>
              </div>
              <div class="balance-box">
                <span>Current balance</span>
                <strong>PKR ${escapeHtml(formatMoney(supplier?.balance_due))}</strong>
              </div>
            </header>

            <section class="summary-grid">
              <div class="summary-card">
                <span>Stock quantity</span>
                <strong>${ledgerTotals.stockQuantity}</strong>
              </div>
              <div class="summary-card">
                <span>Debit</span>
                <strong>PKR ${escapeHtml(formatMoney(ledgerTotals.debit))}</strong>
              </div>
              <div class="summary-card">
                <span>Credit</span>
                <strong>PKR ${escapeHtml(formatMoney(ledgerTotals.credit))}</strong>
              </div>
              <div class="summary-card">
                <span>Net balance</span>
                <strong>PKR ${escapeHtml(formatMoney(supplier?.balance_due))}</strong>
              </div>
            </section>

            <table>
              <colgroup>
                <col style="width: 86px" />
                <col style="width: 88px" />
                <col style="width: 132px" />
                <col style="width: 44px" />
                <col style="width: 76px" />
                <col style="width: 78px" />
                <col style="width: 78px" />
                <col style="width: 78px" />
                <col style="width: 86px" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Balance</th>
                  <th>Reference / note</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>

            <div class="footer">A4 landscape ledger / ${escapeHtml(documentTitle)}</div>
          </main>
          <script>
            (function () {
              var printed = false;
              function printOnce() {
                if (printed) return;
                printed = true;
                window.focus();
                window.print();
              }

              window.addEventListener("load", function () {
                var images = Array.prototype.slice.call(document.images || []);
                if (!images.length) {
                  setTimeout(printOnce, 250);
                  return;
                }

                var remaining = images.length;
                function done() {
                  remaining -= 1;
                  if (remaining <= 0) setTimeout(printOnce, 350);
                }

                images.forEach(function (image) {
                  if (image.complete) {
                    done();
                    return;
                  }
                  image.addEventListener("load", done, { once: true });
                  image.addEventListener("error", done, { once: true });
                });

                setTimeout(printOnce, 3000);
              });
            })();
          </script>
        </body>
      </html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Allow popups to export the PDF ledger.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <main className="supplier-ledger-page">
      <header className="supplier-ledger-header">
        <div>
          <span className="supplier-ledger-kicker">Account ledger</span>
          <h1>{supplier?.name || "Account ledger"}</h1>
          <p>
            Stock additions, payments, and adjustments with running balance.
          </p>
        </div>
        <div className="supplier-ledger-actions">
          <button
            className="supplier-ledger-secondary"
            onClick={() => window.close()}
            type="button"
          >
            Close tab
          </button>
          <button
            className="supplier-ledger-primary"
            disabled={!ledgerEntries.length}
            onClick={exportLedgerExcel}
            type="button"
          >
            Export Excel
          </button>
          <button
            className="supplier-ledger-primary"
            disabled={!ledgerEntries.length}
            onClick={exportLedgerPdf}
            type="button"
          >
            Export PDF
          </button>
        </div>
      </header>

      {notice && (
        <div className="supplier-ledger-notice" role="status">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="supplier-ledger-empty">Loading account ledger...</div>
      ) : (
        <>
          <section className="supplier-ledger-summary">
            <div>
              <span>Stock quantity</span>
              <strong>{ledgerTotals.stockQuantity}</strong>
            </div>
            <div>
              <span>Debit</span>
              <strong>PKR {formatMoney(ledgerTotals.debit)}</strong>
            </div>
            <div>
              <span>Credit</span>
              <strong>PKR {formatMoney(ledgerTotals.credit)}</strong>
            </div>
            <div>
              <span>Balance</span>
              <strong>PKR {formatMoney(supplier?.balance_due)}</strong>
            </div>
          </section>

          {ledgerEntries.length ? (
            <section className="supplier-ledger-table-panel">
              <div className="supplier-ledger-table-wrap">
                <table className="supplier-ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Ledger type</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Total</th>
                      <th>Debit</th>
                      <th>Credit</th>
                      <th>Balance</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntries.map((entry) => (
                      <tr
                        className={`supplier-ledger-row is-${entry.sourceType}`}
                        key={entry.id}
                      >
                        <td>{formatUtcLocal(entry.date)}</td>
                        <td>
                          <span className={`supplier-ledger-type is-${entry.sourceType}`}>
                            {entry.ledgerType}
                          </span>
                        </td>
                        <td>
                          {entry.sourceType === "stock" ? (
                            <div className="supplier-ledger-product">
                              {entry.thumbnailUrl ? (
                                <img src={entry.thumbnailUrl} alt={entry.sku} />
                              ) : (
                                <span className="supplier-ledger-noimg">No image</span>
                              )}
                              <strong>{entry.sku}</strong>
                            </div>
                          ) : (
                            <span className="supplier-ledger-event-product">-</span>
                          )}
                        </td>
                        <td>{entry.quantityLabel}</td>
                        <td>{entry.unitPrice ? `PKR ${formatMoney(entry.unitPrice)}` : "-"}</td>
                        <td>PKR {formatMoney(entry.total)}</td>
                        <td className="supplier-ledger-debit">
                          {entry.debit ? `PKR ${formatMoney(entry.debit)}` : "-"}
                        </td>
                        <td className="supplier-ledger-credit">
                          {entry.credit ? `PKR ${formatMoney(entry.credit)}` : "-"}
                        </td>
                        <td>
                          <strong>PKR {formatMoney(entry.balance)}</strong>
                        </td>
                        <td>
                          <span>{entry.reference}</span>
                          {entry.note && <small>{entry.note}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="supplier-ledger-empty">
              No ledger activity has been recorded for this account.
            </div>
          )}
        </>
      )}
    </main>
  );
};

export default SupplierLedger;
