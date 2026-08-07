import axios from "axios";

const normalizeApiBase = (value) => String(value || "").trim().replace(/\/+$/, "");

const isLoopbackHost = (hostname) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(hostname || "").toLowerCase()
  );

const isPrivateNetworkHost = (hostname) => {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return (
    isLoopbackHost(normalized) ||
    /^10(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(normalized) ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".lan")
  );
};

const getUrlHostname = (value) => {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
};

const getBrowserNetworkApiBase = () => {
  if (typeof window === "undefined") return "";

  const { hostname, port, protocol } = window.location;
  if (!hostname || isLoopbackHost(hostname)) return "";
  if (!["http:", "https:"].includes(protocol)) return "";

  if (!import.meta.env.DEV && port !== "5173") return "";

  // The mobile launcher terminates local HTTPS in Vite and proxies /api to
  // FastAPI, keeping microphone-capable pages free of mixed HTTP content.
  if (import.meta.env.DEV && protocol === "https:" && port === "5173") {
    return "/api";
  }

  return `${protocol === "https:" ? "https" : "http"}://${hostname}:8000`;
};

const getStoredApiBase = () => {
  if (typeof window === "undefined") return "";

  try {
    return normalizeApiBase(window.localStorage.getItem("erpApiBaseUrl"));
  } catch {
    return "";
  }
};

const configuredApiBase = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);

const isConfiguredLoopback =
  configuredApiBase &&
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(
    configuredApiBase
  );

const resolveApiBaseUrl = () => {
  const storedApiBase = getStoredApiBase();
  const browserNetworkApiBase = getBrowserNetworkApiBase();
  if (browserNetworkApiBase === "/api") return browserNetworkApiBase;
  if (storedApiBase) {
    const storedHost = getUrlHostname(storedApiBase);
    const browserHost = getUrlHostname(browserNetworkApiBase);
    const storedIsOldLocalNetwork =
      browserHost &&
      storedHost &&
      isPrivateNetworkHost(storedHost) &&
      storedHost !== browserHost;
    if (!storedIsOldLocalNetwork) return storedApiBase;
  }

  if (browserNetworkApiBase && isConfiguredLoopback) {
    return browserNetworkApiBase;
  }
  if (configuredApiBase && !isConfiguredLoopback) return configuredApiBase;
  if (browserNetworkApiBase) return browserNetworkApiBase;

  return import.meta.env.DEV ? "http://127.0.0.1:8000" : "";
};

export const API_BASE_URL = resolveApiBaseUrl();

export const getStaticUrl = (path) => {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${API_BASE_URL}${path}`;
};

export const getAuditHeaders = () => {
  const headers = {};
  if (typeof window === "undefined") return headers;

  try {
    const rawUser = window.localStorage.getItem("erpUser");
    const user = rawUser ? JSON.parse(rawUser) : null;
    if (user?.id) {
      headers["X-ERP-User-Id"] = String(user.id);
    }
    if (user?.name || user?.username) {
      headers["X-ERP-User-Name"] = user.name || user.username;
    }
  } catch {
    // Keep API calls working even if local storage contains an old value.
  }

  return headers;
};

const getAuthToken = () => {
  if (typeof window === "undefined") return null;

  try {
    const rawUser = window.localStorage.getItem("erpUser");
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser);
    return parsed?.access_token || null;
  } catch {
    return null;
  }
};

export const getAuthHeaders = (baseHeaders = {}) => {
  const headers = {
    ...baseHeaders,
    ...getAuditHeaders(),
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

export const apiFetch = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: getAuthHeaders(options.headers || {}),
  });

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 5000,
});

api.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  Object.entries(getAuditHeaders()).forEach(([key, value]) => {
    config.headers[key] = value;
  });
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
