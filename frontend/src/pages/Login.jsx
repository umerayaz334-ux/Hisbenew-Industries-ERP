import { useState } from "react";
import api, { API_BASE_URL } from "../api/api";
import "./Login.css";

export default function Login({ onLogin, message, onClearMessage }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const clearFeedback = () => {
    onClearMessage?.();
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearFeedback();

    if (!username.trim()) {
      setError("Please enter your username.");
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
        setError(`Connection timeout to ${API_BASE_URL}`);
      } else if (err?.request) {
        setError(`Could not reach backend API at ${API_BASE_URL}`);
      } else {
        setError(err?.message || "Invalid username or PIN.");
      }
    } finally {
      setLoading(false);
    }
  };

  const feedback = error || message;

  return (
    <div className="sleek-login-container">
      <div className="sleek-login-card">
        {/* Brand Mark */}
        <div className="sleek-brand-header">
          <div className="sleek-logo">HI</div>
          <h1>Hisbenew Industries</h1>
          <p>Enterprise ERP Portal</p>
        </div>

        {/* Login Form */}
        <form className="sleek-form" onSubmit={handleSubmit}>
          <div className="sleek-input-group">
            <label htmlFor="sleek-username">Username</label>
            <input
              id="sleek-username"
              type="text"
              value={username}
              onChange={(e) => {
                clearFeedback();
                setUsername(e.target.value);
              }}
              placeholder="Username"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="sleek-input-group">
            <label htmlFor="sleek-pin">4-Digit PIN</label>
            <div className="sleek-pin-wrapper">
              <input
                id="sleek-pin"
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pin}
                onChange={(e) => {
                  clearFeedback();
                  setPin(e.target.value.replace(/\D/g, ""));
                }}
                placeholder="••••"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="sleek-show-toggle"
                onClick={() => setShowPin(!showPin)}
              >
                {showPin ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button type="submit" className="sleek-submit-btn" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {feedback && (
          <div className="sleek-error-alert" role="alert">
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}
