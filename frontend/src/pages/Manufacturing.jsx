import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./Manufacturing.css";

const EMPTY_STEP = {
  product_id: "",
  step_order: 1,
  step_name: "",
  worker_role: "",
  rate_per_piece: 0,
  estimated_minutes_per_piece: 0,
  is_optional: false,
  is_active: true,
};

const STANDARD_WORKFLOW = [
  ["CNC Cutting", "CNC Operator", 12],
  ["Grinding", "Grinder", 15],
  ["Beveling", "Beveling Operator", 10],
  ["Polishing", "Polisher", 12],
  ["Assembly", "Assembler", 10],
  ["Quality Check", "Quality Inspector", 6],
  ["Packing", "Packer", 5],
];

const stepPayload = (step, overrides = {}) => ({
  product_id: Number(step.product_id),
  step_order: Number(step.step_order),
  step_name: step.step_name.trim(),
  worker_role: step.worker_role?.trim() || null,
  rate_per_piece: Number(step.rate_per_piece) || 0,
  estimated_minutes_per_piece:
    Number(step.estimated_minutes_per_piece) || 0,
  is_optional: Boolean(step.is_optional),
  is_active: Boolean(step.is_active),
  ...overrides,
});

function Manufacturing() {
  const confirmDialog = useConfirmDialog();
  const [products, setProducts] = useState([]);
  const [workflowSteps, setWorkflowSteps] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [search, setSearch] = useState("");
  const [coverageFilter, setCoverageFilter] = useState("all");
  const [showStepForm, setShowStepForm] = useState(false);
  const [editingStepId, setEditingStepId] = useState(null);
  const [stepForm, setStepForm] = useState(EMPTY_STEP);
  const [copySourceId, setCopySourceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [productsResponse, stepsResponse] = await Promise.all([
        api.get("/products"),
        api.get("/workflow-steps"),
      ]);
      const nextProducts = productsResponse.data || [];
      setProducts(nextProducts);
      setWorkflowSteps(stepsResponse.data || []);
      setSelectedProductId((current) => {
        if (current && nextProducts.some((product) => String(product.id) === current)) {
          return current;
        }
        return nextProducts[0] ? String(nextProducts[0].id) : "";
      });
    } catch (loadError) {
      console.error("Manufacturing loading error:", loadError);
      setError("Unable to load manufacturing workflows.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      await loadData();
    };
    load();
  }, [loadData]);

  const stepsByProduct = useMemo(() => {
    const grouped = new Map();
    workflowSteps.forEach((step) => {
      const key = String(step.product_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(step);
    });
    grouped.forEach((steps) =>
      steps.sort((left, right) => left.step_order - right.step_order)
    );
    return grouped;
  }, [workflowSteps]);

  const productRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products
      .map((product) => {
        const steps = stepsByProduct.get(String(product.id)) || [];
        return {
          ...product,
          stepCount: steps.length,
          activeStepCount: steps.filter((step) => step.is_active).length,
        };
      })
      .filter((product) => {
        const matchesSearch =
          !query ||
          `${product.article_no} ${product.name}`.toLowerCase().includes(query);
        const matchesCoverage =
          coverageFilter === "all" ||
          (coverageFilter === "ready"
            ? product.activeStepCount > 0
            : product.activeStepCount === 0);
        return matchesSearch && matchesCoverage;
      });
  }, [coverageFilter, products, search, stepsByProduct]);

  const selectedProduct = products.find(
    (product) => String(product.id) === selectedProductId
  );
  const selectedSteps = stepsByProduct.get(selectedProductId) || [];
  const activeSelectedSteps = selectedSteps.filter((step) => step.is_active);
  const timePerPiece = activeSelectedSteps.reduce(
    (total, step) => total + (step.estimated_minutes_per_piece || 0),
    0
  );
  const laborPerPiece = activeSelectedSteps.reduce(
    (total, step) => total + (step.rate_per_piece || 0),
    0
  );
  const readyProducts = products.filter(
    (product) => (stepsByProduct.get(String(product.id)) || []).some((step) => step.is_active)
  ).length;

  const openAddStep = () => {
    setEditingStepId(null);
    setStepForm({
      ...EMPTY_STEP,
      product_id: selectedProductId,
      step_order: selectedSteps.length + 1,
    });
    setError("");
    setShowStepForm(true);
  };

  const openEditStep = (step) => {
    setEditingStepId(step.id);
    setStepForm({ ...step });
    setError("");
    setShowStepForm(true);
  };

  const closeStepForm = () => {
    setShowStepForm(false);
    setEditingStepId(null);
    setError("");
  };

  const handleStepChange = (event) => {
    const { name, value, type, checked } = event.target;
    setStepForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const saveWorkflowStep = async (event) => {
    event.preventDefault();
    setError("");
    if (!stepForm.product_id || !stepForm.step_name.trim()) {
      setError("Select an article and enter an operation name.");
      return;
    }

    setSaving(true);
    try {
      const payload = stepPayload(stepForm);
      if (editingStepId) {
        await api.put(`/workflow-steps/${editingStepId}`, payload);
      } else {
        await api.post("/workflow-steps", payload);
      }
      setNotice(editingStepId ? "Operation updated." : "Operation added.");
      closeStepForm();
      await loadData();
    } catch (saveError) {
      console.error("Save workflow step error:", saveError);
      setError(saveError.response?.data?.detail || "Unable to save the operation.");
    } finally {
      setSaving(false);
    }
  };

  const updateStep = async (step, overrides, successMessage = "") => {
    setError("");
    try {
      await api.put(`/workflow-steps/${step.id}`, stepPayload(step, overrides));
      if (successMessage) setNotice(successMessage);
      await loadData();
    } catch (updateError) {
      console.error("Workflow update error:", updateError);
      setError(updateError.response?.data?.detail || "Unable to update workflow.");
    }
  };

  const moveStep = async (step, direction) => {
    const index = selectedSteps.findIndex((item) => item.id === step.id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= selectedSteps.length) return;
    const otherStep = selectedSteps[swapIndex];

    setError("");
    try {
      await Promise.all([
        api.put(
          `/workflow-steps/${step.id}`,
          stepPayload(step, { step_order: otherStep.step_order })
        ),
        api.put(
          `/workflow-steps/${otherStep.id}`,
          stepPayload(otherStep, { step_order: step.step_order })
        ),
      ]);
      await loadData();
    } catch (moveError) {
      console.error("Workflow reorder error:", moveError);
      setError("Unable to reorder these operations.");
    }
  };

  const deleteStep = async (step) => {
    const confirmed = await confirmDialog({
      title: "Delete operation?",
      message: `Delete "${step.step_name}" from this workflow?`,
      tone: "danger",
      confirmText: "Delete operation",
    });
    if (!confirmed) return;
    try {
      await api.delete(`/workflow-steps/${step.id}`);
      setNotice("Operation deleted.");
      await loadData();
    } catch (deleteError) {
      console.error("Delete workflow step error:", deleteError);
      setError("Unable to delete this operation.");
    }
  };

  const copyWorkflow = async () => {
    if (!copySourceId || !selectedProductId) {
      setError("Choose a source article first.");
      return;
    }
    if (
      selectedSteps.length > 0 &&
      !(await confirmDialog({
        title: "Replace workflow?",
        message: "Replace this article's current workflow with the copied workflow?",
        tone: "warning",
        confirmText: "Replace workflow",
      }))
    ) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.post("/workflow-steps/copy", {
        source_product_id: Number(copySourceId),
        target_product_id: Number(selectedProductId),
        replace_existing: true,
      });
      setNotice("Workflow copied successfully.");
      setCopySourceId("");
      await loadData();
    } catch (copyError) {
      console.error("Copy workflow error:", copyError);
      setError(copyError.response?.data?.detail || "Unable to copy this workflow.");
    } finally {
      setSaving(false);
    }
  };

  const applyStandardWorkflow = async () => {
    if (!selectedProduct || selectedSteps.length > 0) return;
    setSaving(true);
    setError("");
    try {
      for (const [index, [name, role, minutes]] of STANDARD_WORKFLOW.entries()) {
        await api.post("/workflow-steps", {
          product_id: selectedProduct.id,
          step_order: index + 1,
          step_name: name,
          worker_role: role,
          rate_per_piece: 0,
          estimated_minutes_per_piece: minutes,
          is_optional: false,
          is_active: true,
        });
      }
      setNotice("Standard knife workflow added. Review rates and timings before production.");
      await loadData();
    } catch (templateError) {
      console.error("Standard workflow error:", templateError);
      setError("The starter workflow could not be completed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="manufacturing-page">
      <header className="manufacturing-hero">
        <div>
          <h1>Manufacturing</h1>
        </div>
        <div className="manufacturing-hero-actions">
          <button className="manufacturing-primary" onClick={openAddStep} type="button">
            Add operation
          </button>
        </div>
      </header>

      <section className="manufacturing-metrics">
        <article>
          <span>Articles covered</span>
          <strong>{readyProducts}</strong>
          <small>of {products.length} products ready</small>
        </article>
        <article className={products.length - readyProducts > 0 ? "needs-attention" : ""}>
          <span>Missing workflows</span>
          <strong>{products.length - readyProducts}</strong>
          <small>cannot start production yet</small>
        </article>
        <article>
          <span>Active operations</span>
          <strong>{workflowSteps.filter((step) => step.is_active).length}</strong>
          <small>across all articles</small>
        </article>
        <article>
          <span>Defined worker roles</span>
          <strong>
            {new Set(workflowSteps.map((step) => step.worker_role).filter(Boolean)).size}
          </strong>
          <small>available for auto-assignment</small>
        </article>
      </section>

      {notice && (
        <div className="manufacturing-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} type="button">Dismiss</button>
        </div>
      )}
      {error && !showStepForm && (
        <div className="manufacturing-error">{error}</div>
      )}

      <div className="manufacturing-workspace">
        <aside className="manufacturing-products">
          <div className="manufacturing-panel-heading">
            <div>
              <h2>Articles</h2>
              <p>{productRows.length} shown</p>
            </div>
          </div>
          <div className="manufacturing-filters">
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search article or product"
              value={search}
            />
            <select
              onChange={(event) => setCoverageFilter(event.target.value)}
              value={coverageFilter}
            >
              <option value="all">All coverage</option>
              <option value="ready">Workflow ready</option>
              <option value="missing">Missing workflow</option>
            </select>
          </div>

          <div className="manufacturing-product-list">
            {loading ? (
              <div className="manufacturing-empty">Loading articles...</div>
            ) : productRows.length === 0 ? (
              <div className="manufacturing-empty">No matching articles.</div>
            ) : (
              productRows.map((product) => (
                <button
                  className={
                    String(product.id) === selectedProductId ? "is-selected" : ""
                  }
                  key={product.id}
                  onClick={() => setSelectedProductId(String(product.id))}
                  type="button"
                >
                  <span>
                    <strong>{product.article_no}</strong>
                    <small>{product.name}</small>
                  </span>
                  <span
                    className={`manufacturing-coverage ${
                      product.activeStepCount > 0 ? "is-ready" : "is-missing"
                    }`}
                  >
                    {product.activeStepCount > 0
                      ? `${product.activeStepCount} steps`
                      : "Setup needed"}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="manufacturing-route">
          {!selectedProduct ? (
            <div className="manufacturing-empty large">Select an article to configure its workflow.</div>
          ) : (
            <>
              <div className="manufacturing-route-header">
                <div>
                  <span className="manufacturing-route-code">
                    {selectedProduct.article_no}
                  </span>
                  <h2>{selectedProduct.name}</h2>
                  <p>
                    {activeSelectedSteps.length
                      ? "This route will create production tasks in the order below."
                      : "Production is blocked until this article has an active workflow."}
                  </p>
                </div>
                <button className="manufacturing-primary" onClick={openAddStep} type="button">
                  Add operation
                </button>
              </div>

              <div className="manufacturing-route-metrics">
                <div><span>Operations</span><strong>{activeSelectedSteps.length}</strong></div>
                <div><span>Time / piece</span><strong>{timePerPiece} min</strong></div>
                <div><span>Labor / piece</span><strong>PKR {laborPerPiece.toFixed(2)}</strong></div>
                <div>
                  <span>100-piece estimate</span>
                  <strong>{Math.round((timePerPiece * 100) / 60)} hrs</strong>
                </div>
              </div>

              <section className="manufacturing-copy-tool">
                <div>
                  <strong>Reuse an existing workflow</strong>
                  <span>Copy the full route, then adjust rates or timing for this article.</span>
                </div>
                <select
                  onChange={(event) => setCopySourceId(event.target.value)}
                  value={copySourceId}
                >
                  <option value="">Choose source article</option>
                  {products
                    .filter(
                      (product) =>
                        String(product.id) !== selectedProductId &&
                        (stepsByProduct.get(String(product.id)) || []).length > 0
                    )
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.article_no} - {product.name}
                      </option>
                    ))}
                </select>
                <button
                  disabled={!copySourceId || saving}
                  onClick={copyWorkflow}
                  type="button"
                >
                  Copy workflow
                </button>
              </section>

              {selectedSteps.length === 0 ? (
                <section className="manufacturing-zero-state">
                  <span className="manufacturing-zero-icon">01</span>
                  <h3>No production route yet</h3>
                  <p>
                    Add operations manually, copy another article, or begin with
                    the standard knife-production route.
                  </p>
                  <div>
                    <button className="manufacturing-primary" onClick={openAddStep} type="button">
                      Add first operation
                    </button>
                    <button
                      className="manufacturing-secondary"
                      disabled={saving}
                      onClick={applyStandardWorkflow}
                      type="button"
                    >
                      Use standard workflow
                    </button>
                  </div>
                </section>
              ) : (
                <section className="manufacturing-timeline">
                  {selectedSteps.map((step, index) => (
                    <article
                      className={`manufacturing-step ${step.is_active ? "" : "is-inactive"}`}
                      key={step.id}
                    >
                      <div className="manufacturing-step-index">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {index < selectedSteps.length - 1 && <i />}
                      </div>
                      <div className="manufacturing-step-body">
                        <div className="manufacturing-step-title">
                          <div>
                            <h3>{step.step_name}</h3>
                            <p>{step.worker_role || "Any production worker"}</p>
                          </div>
                          <div className="manufacturing-step-badges">
                            {step.is_optional && <span>Optional</span>}
                            <span className={step.is_active ? "active" : "inactive"}>
                              {step.is_active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>
                        <div className="manufacturing-step-facts">
                          <span><small>Time</small>{step.estimated_minutes_per_piece || 0} min / pc</span>
                          <span><small>Piece rate</small>PKR {Number(step.rate_per_piece || 0).toFixed(2)}</span>
                          <span><small>Batch sequence</small>Operation {step.step_order}</span>
                        </div>
                        <div className="manufacturing-step-actions">
                          <button disabled={index === 0} onClick={() => moveStep(step, -1)} type="button">Move up</button>
                          <button disabled={index === selectedSteps.length - 1} onClick={() => moveStep(step, 1)} type="button">Move down</button>
                          <button onClick={() => openEditStep(step)} type="button">Edit</button>
                          <button
                            onClick={() =>
                              updateStep(
                                step,
                                { is_active: !step.is_active },
                                step.is_active ? "Operation deactivated." : "Operation activated."
                              )
                            }
                            type="button"
                          >
                            {step.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button className="danger" onClick={() => deleteStep(step)} type="button">Delete</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {showStepForm && (
        <div className="manufacturing-modal-overlay" onClick={closeStepForm}>
          <section
            aria-modal="true"
            className="manufacturing-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="manufacturing-modal-header">
              <div>
                <span className="manufacturing-eyebrow">
                  {editingStepId ? "Edit operation" : "New operation"}
                </span>
                <h2>{editingStepId ? "Update workflow step" : "Add workflow step"}</h2>
                <p>Define ownership, sequence, standard time, and labor rate.</p>
              </div>
              <button onClick={closeStepForm} type="button">x</button>
            </div>

            <form className="manufacturing-form" onSubmit={saveWorkflowStep}>
              <label>
                Product / article
                <select
                  name="product_id"
                  onChange={handleStepChange}
                  required
                  value={stepForm.product_id}
                >
                  <option value="">Select article</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.article_no} - {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sequence
                <input
                  min="1"
                  name="step_order"
                  onChange={handleStepChange}
                  required
                  type="number"
                  value={stepForm.step_order}
                />
              </label>
              <label>
                Operation name
                <input
                  autoFocus
                  name="step_name"
                  onChange={handleStepChange}
                  placeholder="e.g. Grinding"
                  required
                  value={stepForm.step_name}
                />
              </label>
              <label>
                Required worker role
                <input
                  name="worker_role"
                  onChange={handleStepChange}
                  placeholder="e.g. Grinder"
                  value={stepForm.worker_role || ""}
                />
                <small>Used by automatic worker assignment.</small>
              </label>
              <label>
                Piece rate (PKR)
                <input
                  min="0"
                  name="rate_per_piece"
                  onChange={handleStepChange}
                  step="0.01"
                  type="number"
                  value={stepForm.rate_per_piece}
                />
              </label>
              <label>
                Standard minutes / piece
                <input
                  min="0"
                  name="estimated_minutes_per_piece"
                  onChange={handleStepChange}
                  step="0.1"
                  type="number"
                  value={stepForm.estimated_minutes_per_piece}
                />
              </label>
              <div className="manufacturing-form-toggles">
                <label>
                  <input
                    checked={stepForm.is_optional}
                    name="is_optional"
                    onChange={handleStepChange}
                    type="checkbox"
                  />
                  <span><strong>Optional operation</strong><small>Can be excluded when creating a batch.</small></span>
                </label>
                <label>
                  <input
                    checked={stepForm.is_active}
                    name="is_active"
                    onChange={handleStepChange}
                    type="checkbox"
                  />
                  <span><strong>Active operation</strong><small>Included in new production batches.</small></span>
                </label>
              </div>

              {error && <div className="manufacturing-error">{error}</div>}
              <div className="manufacturing-form-actions">
                <button className="manufacturing-primary" disabled={saving} type="submit">
                  {saving ? "Saving..." : editingStepId ? "Save changes" : "Add operation"}
                </button>
                <button className="manufacturing-secondary" onClick={closeStepForm} type="button">Cancel</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default Manufacturing;
