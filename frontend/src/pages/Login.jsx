import { useState } from "react";
import api, { API_BASE_URL } from "../api/api";
import "./Login.css";


const initialAuthMode = () => {
  if (typeof window === "undefined") return "signin";
  return new URLSearchParams(window.location.search).get("mode") === "signup"
    ? "signup"
    : "signin";
};

export default function Login({ onLogin, message, onClearMessage }) {
  const [mode, setMode] = useState(initialAuthMode);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [accessForm, setAccessForm] = useState({
    fullName: "",
    preferredUsername: "",
    workEmail: "",
    phone: "",
    role: "Factory operations",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const clearFeedback = () => {
    onClearMessage?.();
    setError("");
    setNotice("");
  };

  const switchMode = (nextMode) => {
    clearFeedback();
    setMode(nextMode);
    if (typeof window !== "undefined" && window.location.pathname === "/login") {
      window.history.replaceState({}, "", nextMode === "signup" ? "/login?mode=signup" : "/login");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearFeedback();

    if (!username.trim()) {
      setError("Enter username.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("PIN must be 4 digits.");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/login", {
        username: username.trim(),
        pin,
      });
      onLogin(response.data);
    } catch (err) {
      console.error("Login error:", err);
      if (err?.response?.data?.detail) {
        setError(err.response.data.detail);
      } else if (err?.code === "ECONNABORTED" || err?.message?.includes("timeout")) {
        setError(`Backend request timed out. Make sure the API server at ${API_BASE_URL} is running.`);
      } else if (err?.request) {
        setError(`Could not reach backend. Is the API server running at ${API_BASE_URL}?`);
      } else {
        setError(err?.message || "Login failed.");
      }
    } finally {
      setLoading(false);
    }
  };


  const updateAccessForm = (field, value) => {
    clearFeedback();
    setAccessForm((current) => ({ ...current, [field]: value }));
  };

  const handleAccessRequest = async (event) => {
    event.preventDefault();
    clearFeedback();
    if (!accessForm.fullName.trim()) {
      setError("Enter your full name.");
      return;
    }
    if (!accessForm.workEmail.trim() && !accessForm.phone.trim()) {
      setError("Add an email or phone number.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/access-requests", {
        full_name: accessForm.fullName.trim(),
        preferred_username: accessForm.preferredUsername.trim() || null,
        work_email: accessForm.workEmail.trim() || null,
        phone: accessForm.phone.trim() || null,
        requested_workspace: accessForm.role,
        message: accessForm.message.trim() || null,
      });
      setNotice("Access request submitted. An ERP admin can approve it from Users and access.");
      setAccessForm({
        fullName: "",
        preferredUsername: "",
        workEmail: "",
        phone: "",
        role: "Factory operations",
        message: "",
      });
    } catch (requestError) {
      console.error("Access request error:", requestError);
      setError(
        requestError.response?.data?.detail ||
          "Unable to submit access request. Ask an ERP admin to check the backend."
      );
    } finally {
      setLoading(false);
    }
  };

  const feedback = error || notice || message;
  const feedbackTone = error ? "is-error" : "is-info";

  return (
    <div className="login-shell">
      <section className="login-stage" aria-label="Hisbenew ERP access">
        <aside className="login-brand-panel">
          <a className="login-mark" href="/" aria-label="Hisbenew website">
            HI
          </a>
          <div>
            <span className="login-eyebrow">Secure command center</span>
            <h1>Hisbenew Industries ERP</h1>
            <p>
              Factory operations, inventory, fulfillment, Amazon, finance, and
              teams in one private workspace.
            </p>
          </div>
          <div className="login-proof-grid" aria-label="Workspace highlights">
            <article>
              <strong>Portal</strong>
              <span>Role based access</span>
            </article>
            <article>
              <strong>Storefront</strong>
              <span>Public storefront</span>
            </article>
            <article>
              <strong>Security</strong>
              <span>PIN plus managed users</span>
            </article>
          </div>
        </aside>

        <main className="login-card">
          <div className="login-card-top">
            <span>Account access</span>
            <a href="/">View website</a>
          </div>

          <div className="login-tabs" role="tablist" aria-label="Login mode">
            <button
              aria-selected={mode === "signin"}
              className={mode === "signin" ? "is-active" : ""}
              onClick={() => switchMode("signin")}
              role="tab"
              type="button"
            >
              Sign in
            </button>
            <button
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "is-active" : ""}
              onClick={() => switchMode("signup")}
              role="tab"
              type="button"
            >
              Sign up
            </button>
          </div>

          <header className="login-heading">
            <span>{mode === "signin" ? "Welcome back" : "New account"}</span>
            <h2>{mode === "signin" ? "Sign in to your portal" : "Request ERP access"}</h2>
            <p>
              {mode === "signin"
                ? "Use your ERP username and 4-digit PIN."
                : "Accounts are approved by an ERP admin before activation."}
            </p>
          </header>

          {mode === "signin" ? (
            <form className="login-form" onSubmit={handleSubmit}>
              <label>
                <span>Username</span>
                <input
                  value={username}
                  onChange={(event) => {
                    clearFeedback();
                    setUsername(event.target.value);
                  }}
                  placeholder="adminmain"
                  autoFocus
                />
              </label>

              <label>
                <span>4-digit PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(event) => {
                    clearFeedback();
                    setPin(event.target.value.replace(/\D/g, ""));
                  }}
                  placeholder="0000"
                />
              </label>

              <button type="submit" className="login-button" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleAccessRequest}>
              <label>
                <span>Full name</span>
                <input
                  value={accessForm.fullName}
                  onChange={(event) => updateAccessForm("fullName", event.target.value)}
                  placeholder="Your name"
                  autoFocus
                />
              </label>

              <div className="login-form-grid">
                <label>
                  <span>Preferred username</span>
                  <input
                    value={accessForm.preferredUsername}
                    onChange={(event) => updateAccessForm("preferredUsername", event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  <span>Work email</span>
                  <input
                    type="email"
                    value={accessForm.workEmail}
                    onChange={(event) => updateAccessForm("workEmail", event.target.value)}
                    placeholder="name@company.com"
                  />
                </label>
                <label>
                  <span>Phone</span>
                  <input
                    value={accessForm.phone}
                    onChange={(event) => updateAccessForm("phone", event.target.value)}
                    placeholder="+92..."
                  />
                </label>
              </div>

              <label>
                <span>Workspace needed</span>
                <select
                  value={accessForm.role}
                  onChange={(event) => updateAccessForm("role", event.target.value)}
                >
                  <option>Factory operations</option>
                  <option>Warehouse and fulfillment</option>
                  <option>Finance and accounting</option>
                  <option>School ERP</option>
                  <option>Service taker portal</option>
                </select>
              </label>

              <label>
                <span>Access notes</span>
                <textarea
                  rows="3"
                  value={accessForm.message}
                  onChange={(event) => updateAccessForm("message", event.target.value)}
                  placeholder="Pages, role, or reason for access"
                />
              </label>

              <button type="submit" className="login-button" disabled={loading}>
                {loading ? "Submitting..." : "Submit access request"}
              </button>
            </form>
          )}

          {feedback && (
            <p className={`login-feedback ${feedbackTone}`} role="status">
              {feedback}
            </p>
          )}

          <footer className="login-footer">
            <span>Protected ERP workspace</span>
            <a href="/login">Portal sign in</a>
          </footer>
        </main>
      </section>
    </div>
  );
}
