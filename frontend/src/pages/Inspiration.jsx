import { useEffect, useMemo, useState } from "react";
import api from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./Inspiration.css";

const emptyForm = { title: "", notes: "", imageFile: null, imageUrl: "" };
const statusOptions = ["all", "saved", "shortlist", "final"];

const statusLabel = (status) => {
  if (status === "shortlist") return "Shortlist";
  if (status === "final") return "Final";
  return "Saved";
};

function Inspiration() {
  const confirmDialog = useConfirmDialog();
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showView, setShowView] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [notice, setNotice] = useState("");

  const loadItems = async () => {
    try {
      const response = await api.get("/inspiration");
      setItems(Array.isArray(response.data) ? response.data : []);
      setNotice("");
    } catch (error) {
      console.error("Failed to load inspiration items", error);
      setNotice("Inspiration items could not be loaded.");
    }
  };

  useEffect(() => {
    let active = true;

    api
      .get("/inspiration")
      .then((response) => {
        if (active) {
          setItems(Array.isArray(response.data) ? response.data : []);
        }
      })
      .catch((error) => {
        console.error("Failed to load inspiration items", error);
        if (active) setNotice("Inspiration items could not be loaded.");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const modalOpen = showForm || showView || editingId !== null;
    document.body.style.overflow = modalOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showForm, showView, editingId]);

  const summary = useMemo(
    () => ({
      total: items.length,
      shortlist: items.filter((item) => item.status === "shortlist").length,
      final: items.filter((item) => item.status === "final").length,
      withImages: items.filter((item) => item.image_url).length,
    }),
    [items]
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      const status = item.status || "saved";
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesSearch =
        !query ||
        [item.title, item.notes, status].some((value) =>
          String(value || "").toLowerCase().includes(query)
        );

      return matchesStatus && matchesSearch;
    });
  }, [items, searchQuery, statusFilter]);

  const handleChange = (event) => {
    const { name, value, files } = event.target;
    if (name === "imageFile") {
      setForm((current) => ({ ...current, imageFile: files[0] || null }));
      return;
    }

    setForm((current) => ({ ...current, [name]: value }));
  };

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const openFormForNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openFormForEdit = (item) => {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      notes: item.notes || "",
      imageFile: null,
      imageUrl: item.image_url || "",
    });
    setShowForm(true);
  };

  const handleView = (item) => {
    setSelectedItem(item);
    setShowView(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();

    const existingItem = editingId
      ? items.find((item) => item.id === editingId)
      : null;
    let imageData = form.imageUrl || "";

    if (form.imageFile) {
      imageData = await readFileAsDataUrl(form.imageFile);
    } else if (editingId && !form.imageUrl && existingItem) {
      imageData = existingItem.image_url || "";
    }

    const payload = {
      title: form.title.trim(),
      notes: form.notes.trim(),
      image_url: imageData || null,
      status: existingItem?.status || "saved",
    };

    try {
      if (editingId) {
        await api.put(`/inspiration/${editingId}`, payload);
      } else {
        await api.post("/inspiration", payload);
      }
      await loadItems();
      closeForm();
    } catch (error) {
      console.error("Failed to save inspiration item", error);
      setNotice("Inspiration item could not be saved.");
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirmDialog({
      title: "Delete inspiration item?",
      message: "This will permanently delete this inspiration item.",
      tone: "danger",
      confirmText: "Delete item",
    });
    if (!confirmed) return;
    try {
      await api.delete(`/inspiration/${id}`);
      await loadItems();
    } catch (error) {
      console.error("Failed to delete item", error);
      setNotice("Inspiration item could not be deleted.");
    }
  };

  const updateStatus = async (id, status) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;

    try {
      await api.put(`/inspiration/${id}`, {
        title: item.title,
        notes: item.notes,
        image_url: item.image_url,
        status,
      });
      await loadItems();
      if (selectedItem?.id === id) {
        setSelectedItem({ ...selectedItem, status });
      }
    } catch (error) {
      console.error("Failed to update item status", error);
      setNotice("Status could not be updated.");
    }
  };

  const toggleShortlist = (id) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    updateStatus(id, item.status === "shortlist" ? "saved" : "shortlist");
  };

  const finalize = (id) => {
    updateStatus(id, "final");
  };

  return (
    <div className="inspiration-page">
      <header className="inspiration-header">
        <div>
          <span className="inspiration-kicker">Ideas</span>
          <h1>Inspiration</h1>
          <p>Product references, visual ideas, and shortlisted designs.</p>
        </div>
        <button className="inspiration-primary-button" onClick={openFormForNew} type="button">
          Add inspiration
        </button>
      </header>

      <section className="inspiration-summary" aria-label="Inspiration summary">
        <article>
          <span>Total ideas</span>
          <strong>{summary.total}</strong>
        </article>
        <article>
          <span>Shortlisted</span>
          <strong>{summary.shortlist}</strong>
        </article>
        <article>
          <span>Final</span>
          <strong>{summary.final}</strong>
        </article>
        <article>
          <span>With images</span>
          <strong>{summary.withImages}</strong>
        </article>
      </section>

      {notice && (
        <div className="inspiration-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} type="button">
            Dismiss
          </button>
        </div>
      )}

      <section className="inspiration-workspace">
        <div className="inspiration-toolbar">
          <div>
            <h2>Saved ideas</h2>
            <p>{filteredItems.length} shown</p>
          </div>
          <div className="inspiration-tools">
            <label className="inspiration-search">
              <span>Search</span>
              <input
                aria-label="Search inspiration"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Title, note, or status"
                value={searchQuery}
              />
            </label>
            <select
              aria-label="Filter inspiration status"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All statuses" : statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="inspiration-empty">
            <strong>{items.length === 0 ? "No inspiration saved" : "No matches found"}</strong>
            <span>
              {items.length === 0
                ? "Your saved references will appear here."
                : "Adjust the search or status filter."}
            </span>
          </div>
        ) : (
          <div className="inspiration-grid">
            {filteredItems.map((item) => (
              <article className="inspiration-card" key={item.id}>
                <button
                  className="inspiration-card-media"
                  onClick={() => handleView(item)}
                  type="button"
                >
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.title || "Inspiration"} />
                  ) : (
                    <span>No image</span>
                  )}
                </button>
                <div className="inspiration-card-body">
                  <div className="inspiration-card-title">
                    <h3>{item.title || "Untitled idea"}</h3>
                    <span className={`inspiration-status is-${item.status || "saved"}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p>{item.notes || "No notes added."}</p>
                  <div className="inspiration-card-actions">
                    <button onClick={() => handleView(item)} type="button">
                      View
                    </button>
                    <button onClick={() => openFormForEdit(item)} type="button">
                      Edit
                    </button>
                    <button onClick={() => toggleShortlist(item.id)} type="button">
                      {item.status === "shortlist" ? "Saved" : "Shortlist"}
                    </button>
                    <button
                      className="is-danger"
                      onClick={() => handleDelete(item.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <div className="inspiration-modal-overlay" onMouseDown={closeForm}>
          <div className="inspiration-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="inspiration-modal-header">
              <h2>{editingId ? "Edit inspiration" : "Add inspiration"}</h2>
              <button onClick={closeForm} type="button">
                Close
              </button>
            </div>

            <form className="inspiration-form" onSubmit={handleSave}>
              <label className="inspiration-field">
                <span>Title</span>
                <input name="title" onChange={handleChange} required value={form.title} />
              </label>

              <label className="inspiration-field">
                <span>Notes</span>
                <textarea name="notes" onChange={handleChange} rows="4" value={form.notes} />
              </label>

              <label className="inspiration-field">
                <span>Image file</span>
                <input accept="image/*" name="imageFile" onChange={handleChange} type="file" />
              </label>

              <label className="inspiration-field">
                <span>Image URL</span>
                <input
                  name="imageUrl"
                  onChange={handleChange}
                  placeholder="https://..."
                  value={form.imageUrl}
                />
              </label>

              <div className="inspiration-form-actions">
                <button className="inspiration-secondary-button" onClick={closeForm} type="button">
                  Cancel
                </button>
                <button className="inspiration-primary-button" type="submit">
                  Save inspiration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showView && selectedItem && (
        <div className="inspiration-modal-overlay" onMouseDown={() => setShowView(false)}>
          <div
            className="inspiration-modal inspiration-view-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="inspiration-modal-header">
              <h2>{selectedItem.title || "Untitled idea"}</h2>
              <button onClick={() => setShowView(false)} type="button">
                Close
              </button>
            </div>

            <div className="inspiration-view-body">
              <div className="inspiration-view-media">
                {selectedItem.image_url ? (
                  <img src={selectedItem.image_url} alt={selectedItem.title || "Inspiration"} />
                ) : (
                  <span>No image</span>
                )}
              </div>
              <div className="inspiration-view-info">
                <span className={`inspiration-status is-${selectedItem.status || "saved"}`}>
                  {statusLabel(selectedItem.status)}
                </span>
                <p>{selectedItem.notes || "No notes added."}</p>
                <div className="inspiration-card-actions">
                  <button
                    onClick={() => {
                      openFormForEdit(selectedItem);
                      setShowView(false);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      toggleShortlist(selectedItem.id);
                      setSelectedItem({
                        ...selectedItem,
                        status: selectedItem.status === "shortlist" ? "saved" : "shortlist",
                      });
                    }}
                    type="button"
                  >
                    {selectedItem.status === "shortlist" ? "Saved" : "Shortlist"}
                  </button>
                  <button
                    onClick={() => {
                      finalize(selectedItem.id);
                      setSelectedItem({ ...selectedItem, status: "final" });
                    }}
                    type="button"
                  >
                    Final
                  </button>
                  <button
                    className="is-danger"
                    onClick={() => {
                      handleDelete(selectedItem.id);
                      setShowView(false);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inspiration;
