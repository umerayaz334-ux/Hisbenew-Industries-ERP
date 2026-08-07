import { useState } from "react";
import api, { API_BASE_URL } from "../api/api";
import "./Login.css";

export default function Login({ onLogin, message, onClearMessage }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    onClearMessage?.();
    setError("");

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

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>
          Welcome to<br />
          Hisbenew Industries
        </h1>
        <p className="login-subtitle">Login to continue and access your workspace.</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => {
                onClearMessage?.();
                setUsername(e.target.value);
              }}
              placeholder="admin"
              autoFocus
            />
          </label>

          <label>
            4-digit PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                onClearMessage?.();
                setPin(e.target.value.replace(/\D/g, ""));
              }}
              placeholder="0000"
            />
          </label>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>

          {(error || message) && (
            <p className="login-error">{error || message}</p>
          )}
        </form>
      </div>
    </div>
  );
}
