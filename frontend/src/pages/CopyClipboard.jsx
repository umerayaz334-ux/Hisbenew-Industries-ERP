import { useMemo, useState } from "react";
import { useConfirmDialog } from "../components/DialogProvider";
import { useWorkspaceData } from "../utils/workspaceData";
import "./Messages.css";

const EMPTY_FORM = { heading: "", content: "" };

const normalizeMessages = (messages) => (Array.isArray(messages) ? messages : []);

const loadMessages = () => {
  if (typeof window === "undefined") return { data: [], exists: false };

  const saved = window.localStorage.getItem("messages");
  if (!saved) return { data: [], exists: false };

  try {
    const parsed = JSON.parse(saved);
    return { data: normalizeMessages(parsed), exists: true };
  } catch (error) {
    console.error("Failed to load messages", error);
    return { data: [], exists: false };
  }
};

const saveMessagesLocally = (messages) => {
  window.localStorage.setItem("messages", JSON.stringify(messages));
};

function CopyClipboard() {
  const confirmDialog = useConfirmDialog();
  const [messages, setMessages, syncStatus] = useWorkspaceData({
    dataKey: "copy-clipboard",
    loadLocal: loadMessages,
    normalize: normalizeMessages,
    saveLocal: saveMessagesLocally,
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [copiedId, setCopiedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return messages;

    return messages.filter((message) => {
      const heading = String(message.heading || "").toLowerCase();
      const content = String(message.content || "").toLowerCase();
      return heading.includes(query) || content.includes(query);
    });
  }, [messages, searchQuery]);

  const stats = useMemo(() => {
    const totalLines = messages.reduce((total, message) => {
      const lineCount = String(message.content || "")
        .split("\n")
        .filter((line) => line.trim()).length;
      return total + lineCount;
    }, 0);

    return {
      averageLines: messages.length ? Math.max(1, Math.round(totalLines / messages.length)) : 0,
      savedLines: totalLines,
      total: messages.length,
      visible: filteredMessages.length,
    };
  }, [filteredMessages.length, messages]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const openFormForNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openFormForEdit = (message) => {
    setEditingId(message.id);
    setForm({
      content: message.content || "",
      heading: message.heading || "",
    });
    setShowForm(true);
  };

  const handleSave = (event) => {
    event.preventDefault();

    const heading = form.heading.trim();
    const content = form.content.trim();

    if (!heading || !content) {
      alert("Please fill in both heading and message content.");
      return;
    }

    if (editingId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === editingId ? { ...message, content, heading } : message
        )
      );
    } else {
      const newMessage = {
        content,
        createdAt: new Date().toISOString(),
        heading,
        id: Date.now(),
      };
      setMessages((current) => [newMessage, ...current]);
    }

    closeForm();
  };

  const handleDelete = async (id) => {
    const confirmed = await confirmDialog({
      title: "Delete message template?",
      message: "This will remove the saved message template.",
      tone: "danger",
      confirmText: "Delete template",
    });
    if (!confirmed) return;

    setMessages((current) => current.filter((message) => message.id !== id));
  };

  const writeClipboard = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const copyToClipboard = async (content, id) => {
    try {
      await writeClipboard(content);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch (error) {
      console.error("Failed to copy message", error);
      alert("Unable to copy this message.");
    }
  };

  const formatContent = (text) => {
    if (!text.trim()) {
      return <span className="messages-preview-placeholder">Empty preview</span>;
    }

    return text.split("\n").map((line, lineIndex) => {
      const parts = line.split(/(\*\*.*?\*\*)/g);
      return (
        <div key={`${line}-${lineIndex}`}>
          {parts.map((part, partIndex) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return <strong key={`${part}-${partIndex}`}>{part.replace(/\*\*/g, "")}</strong>;
            }
            return part;
          })}
        </div>
      );
    });
  };

  const getPreview = (message) => {
    const firstLine =
      String(message.content || "")
        .split("\n")
        .find((line) => line.trim()) || "";

    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
  };

  const getDateLabel = (dateValue) => {
    if (!dateValue) return "No date";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "No date";
    return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="messages-page">
      <header className="messages-header">
        <div>
          <span className="messages-kicker">Clipboard library</span>
          <h1>Copy Clipboard</h1>
          <p>Store customer-ready replies and copy them quickly.</p>
        </div>
        <button className="messages-primary-button" onClick={openFormForNew} type="button">
          New template
        </button>
      </header>

      <section className="messages-summary" aria-label="Messages summary">
        <article>
          <span>Templates</span>
          <strong>{stats.total}</strong>
        </article>
        <article>
          <span>Showing</span>
          <strong>{stats.visible}</strong>
        </article>
        <article>
          <span>Saved lines</span>
          <strong>{stats.savedLines}</strong>
        </article>
        <article>
          <span>Avg. lines</span>
          <strong>{stats.averageLines}</strong>
        </article>
      </section>

      <section className="messages-workspace">
        <div className="messages-toolbar">
          <div>
            <h2>Templates</h2>
            <p>
              Copy, edit, and filter saved customer messages.{" "}
              {syncStatus === "local"
                ? "Database reconnect pending."
                : syncStatus === "synced"
                  ? "Stored in the ERP database."
                  : "Saving to the ERP database."}
            </p>
          </div>
          <label className="messages-search">
            <span>Search</span>
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Find a template"
              type="search"
              value={searchQuery}
            />
          </label>
        </div>

        {filteredMessages.length === 0 ? (
          <div className="messages-empty-state">
            <strong>{messages.length ? "No matching templates" : "No templates yet"}</strong>
            <span>
              {messages.length
                ? "Try another search term."
                : "Create the first message template for repeated customer replies."}
            </span>
          </div>
        ) : (
          <div className="messages-list">
            {filteredMessages.map((message) => (
              <article className="message-card" key={message.id}>
                <div className="message-card-main">
                  <div className="message-card-top">
                    <h3>{message.heading}</h3>
                    <span>{getDateLabel(message.createdAt)}</span>
                  </div>
                  <p>{getPreview(message)}</p>
                </div>

                <div className="message-actions">
                  <button
                    className={`messages-copy-button ${
                      copiedId === message.id ? "is-copied" : ""
                    }`}
                    onClick={() => copyToClipboard(message.content, message.id)}
                    type="button"
                  >
                    {copiedId === message.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    className="messages-secondary-button"
                    onClick={() => openFormForEdit(message)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="messages-danger-button"
                    onClick={() => handleDelete(message.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <div className="messages-modal-overlay" onClick={closeForm}>
          <section
            aria-modal="true"
            className="messages-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="messages-modal-header">
              <div>
                <span className="messages-kicker">Template editor</span>
                <h2>{editingId ? "Edit Message" : "New Message"}</h2>
              </div>
              <button
                aria-label="Close message form"
                className="messages-close-button"
                onClick={closeForm}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="messages-form" onSubmit={handleSave}>
              <label>
                <span>Template name</span>
                <input
                  name="heading"
                  onChange={handleChange}
                  placeholder="Review request"
                  required
                  type="text"
                  value={form.heading}
                />
              </label>

              <label>
                <span>Message</span>
                <textarea
                  name="content"
                  onChange={handleChange}
                  placeholder="Hi dear customer, your order is ready for dispatch."
                  required
                  rows="8"
                  value={form.content}
                />
              </label>

              <div className="messages-preview">
                <h3>Preview</h3>
                <div className="messages-preview-box">{formatContent(form.content)}</div>
              </div>

              <div className="messages-form-actions">
                <button className="messages-primary-button" type="submit">
                  {editingId ? "Save changes" : "Create template"}
                </button>
                <button className="messages-secondary-button" onClick={closeForm} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default CopyClipboard;
