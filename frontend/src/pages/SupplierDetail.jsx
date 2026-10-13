import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal, parseUtcLocal } from "../utils/dateUtils";
import { normalizeAppPath, scopedAppPath } from "../utils/routeUtils";
import "./Suppliers.css";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const supplierIdFromPath = () => {
  const match = normalizeAppPath(window.location.pathname).match(
    /^\/portal\/suppliers\/(\d+)\/?$/
  );
  return match ? Number(match[1]) : null;
};

const getInitials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "AC";

const getImageUrl = (url) => getStaticUrl(url);

const sortNewest = (items = []) =>
  [...items].sort(
    (left, right) =>
      (parseUtcLocal(right.created_at)?.getTime() || 0) -
      (parseUtcLocal(left.created_at)?.getTime() || 0)
  );

function SupplierDetail() {
  const [supplier, setSupplier] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const supplierId = supplierIdFromPath();

  useEffect(() => {
    let active = true;

    if (!supplierId) {
      setError("Supplier account could not be found.");
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError("");
    api
      .get(`/suppliers/${supplierId}`)
      .then((response) => {
        if (!active) return;
        setSupplier(response.data);
      })
      .catch((requestError) => {
        if (!active) return;
        setSupplier(null);
        setError(
          requestError.response?.data?.detail ||
            "Supplier account could not be loaded."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [supplierId]);

  const payments = useMemo(() => sortNewest(supplier?.payments || []), [supplier]);
  const stockMovements = useMemo(
    () => sortNewest(supplier?.stock_movements || []),
    [supplier]
  );
  const balance = Number(supplier?.balance_due || 0);

  const backToAccounts = () => {
    window.history.pushState({}, "", scopedAppPath("/portal/suppliers"));
    window.dispatchEvent(
      new CustomEvent("erp:navigation", {
        detail: { page: "Suppliers", source: "supplier-detail" },
      })
    );
  };

  if (loading || error || !supplier) {
    return (
      <div className="suppliers-page">
        <main className="supplier-account-page supplier-account-modal">
          <div className="account-empty-state">
            <strong>{error || "Opening account..."}</strong>
            <span>
              {error
                ? "Go back to the accounts list and choose an available supplier."
                : "Loading the selected supplier account."}
            </span>
            {error && (
              <button className="secondary-btn" onClick={backToAccounts} type="button">
                Back to accounts
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="suppliers-page">
      <main
        aria-labelledby="supplier-account-title"
        className="supplier-account-page supplier-account-modal"
      >
        <div className="modal-header supplier-account-header">
          <div className="supplier-account-identity">
            <div className="supplier-avatar" aria-hidden="true">
              {getInitials(supplier.name)}
            </div>
            <div>
              <span className="page-tag">Account profile</span>
              <h3 id="supplier-account-title">{supplier.name}</h3>
              <div className="supplier-account-meta">
                <span>{supplier.contact_person || "Contact not added"}</span>
                <span>{supplier.phone || "Phone not added"}</span>
                <span>{supplier.email || "Email not added"}</span>
              </div>
            </div>
          </div>
          <div className="modal-action-group">
            <button className="secondary-btn" onClick={backToAccounts} type="button">
              Back to accounts
            </button>
          </div>
        </div>

        <div className="detail-grid supplier-account-overview">
          <div className="detail-card account-summary-card">
            <div className="account-summary-header">
              <div>
                <span className="section-kicker">Financial position</span>
                <h4>
                  {balance > 0
                    ? "Balance payable"
                    : balance < 0
                      ? "Advance available"
                      : "Account settled"}
                </h4>
                <p>PKR {formatMoney(Math.abs(balance))}</p>
              </div>
              <span
                className={`status-chip ${
                  supplier.balance_status?.toLowerCase() || "settled"
                }`}
              >
                {supplier.balance_status || "Settled"}
              </span>
            </div>
          </div>

          <div className="detail-card">
            <span className="section-kicker">Purchases</span>
            <strong>{stockMovements.length}</strong>
            <p>purchase records</p>
          </div>

          <div className="detail-card">
            <span className="section-kicker">Payments</span>
            <strong>{payments.length}</strong>
            <p>recorded payments</p>
          </div>
        </div>

        <section className="panel small-panel account-work-card stock-history-card">
          <div className="account-section-heading">
            <div>
              <span className="section-kicker">Purchase activity</span>
              <h4>Recent purchases</h4>
              <p className="section-subtitle">
                {stockMovements.length} product stock records
              </p>
            </div>
          </div>
          {stockMovements.length ? (
            <div className="table-wrap">
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMovements.slice(0, 10).map((movement) => (
                    <tr key={movement.id}>
                      <td className="product-cell">
                        {movement.product_image_url ? (
                          <img
                            alt={movement.article_no || "Product"}
                            className="stock-image"
                            src={getImageUrl(movement.product_image_url)}
                          />
                        ) : (
                          <div className="stock-image stock-image-placeholder">
                            No Image
                          </div>
                        )}
                        <div>
                          <span>{movement.article_no || "No SKU"}</span>
                          <small>{movement.product_name || "Stock item"}</small>
                        </div>
                      </td>
                      <td>{movement.quantity || 0}</td>
                      <td>PKR {formatMoney(movement.purchase_price)}</td>
                      <td>
                        PKR{" "}
                        {formatMoney(
                          Number(movement.quantity || 0) *
                            Number(movement.purchase_price || 0)
                        )}
                      </td>
                      <td>{formatUtcLocal(movement.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="account-empty-state">
              <strong>No stock activity yet</strong>
              <span>Add a product stock purchase to create the first record.</span>
            </div>
          )}
        </section>

        <section className="panel small-panel account-work-card supplier-payments-card">
          <div className="account-section-heading">
            <div>
              <span className="section-kicker">Money activity</span>
              <h4>Payment history</h4>
              <p>{payments.length} recorded payments</p>
            </div>
          </div>
          {payments.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, 10).map((payment) => (
                    <tr key={payment.id}>
                      <td>PKR {formatMoney(payment.amount)}</td>
                      <td>{payment.payment_method || "-"}</td>
                      <td>{payment.payment_reference || "-"}</td>
                      <td>{formatUtcLocal(payment.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="account-empty-state">
              <strong>No payments yet</strong>
              <span>No payment records have been saved for this account.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default SupplierDetail;
