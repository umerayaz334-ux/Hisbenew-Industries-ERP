import axios from "axios";
import { errorDetailText } from "../utils/apiError";

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

let authExpiredNotified = false;

const isLoginRequest = (url = "") => String(url || "").includes("/login");

const notifyAuthExpired = (detail = "Your session expired. Please sign in again.") => {
  if (typeof window === "undefined" || authExpiredNotified) return;
  authExpiredNotified = true;
  try {
    window.localStorage.removeItem("erpUser");
  } catch {}
  window.dispatchEvent(
    new CustomEvent("erp:auth-expired", {
      detail: { message: detail },
    })
  );
};

const getBrowserNetworkApiBase = () => {
  if (typeof window === "undefined") return "";

  const { hostname, port, protocol } = window.location;
  if (!hostname) return "";
  if (!["http:", "https:"].includes(protocol)) return "";

  // Local Vite requests stay same-origin through the configured /api proxy.
  if (import.meta.env.DEV && port === "5173") {
    return "/api";
  }

  if (isLoopbackHost(hostname)) return "";
  if (!import.meta.env.DEV && port !== "5173") return "";

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

const PRODUCTION_API_BASE = "https://api.hisbenew.com";

const isHisbenewProductionHost = (hostname) => {
  const host = String(hostname || "").toLowerCase();
  return host === "hisbenew.com" || host.endsWith(".hisbenew.com");
};

const resolveApiBaseUrl = () => {
  const storedApiBase = getStoredApiBase();
  const browserNetworkApiBase = getBrowserNetworkApiBase();
  if (browserNetworkApiBase === "/api") return browserNetworkApiBase;

  const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
  const isPublicDomain = currentHost && !isPrivateNetworkHost(currentHost);

  // Live ERP domain must always talk to the public API — never a leftover LAN/localhost URL.
  if (isHisbenewProductionHost(currentHost)) {
    const storedHost = getUrlHostname(storedApiBase).toLowerCase();
    if (storedApiBase && storedHost !== "api.hisbenew.com") {
      try {
        window.localStorage.removeItem("erpApiBaseUrl");
      } catch {
        // Ignore storage failures; production API still wins.
      }
    }
    if (configuredApiBase && !isConfiguredLoopback && getUrlHostname(configuredApiBase).toLowerCase() === "api.hisbenew.com") {
      return configuredApiBase;
    }
    return PRODUCTION_API_BASE;
  }

  // Isolate local development (localhost:5173): strictly connect to local backend on PC
  if (isLoopbackHost(currentHost)) {
    return configuredApiBase || "http://127.0.0.1:8000";
  }

  if (storedApiBase) {
    const storedHost = getUrlHostname(storedApiBase);
    const storedIsLoopback = isLoopbackHost(storedHost);
    
    // On public production domain, never use a stored local loopback URL (127.0.0.1/localhost)
    if (isPublicDomain && (storedIsLoopback || isPrivateNetworkHost(storedHost))) {
      try {
        window.localStorage.removeItem("erpApiBaseUrl");
      } catch {}
    } else {
      const browserHost = getUrlHostname(browserNetworkApiBase);
      const storedIsOldLocalNetwork =
        browserHost &&
        storedHost &&
        isPrivateNetworkHost(storedHost) &&
        storedHost !== browserHost;
      if (!storedIsOldLocalNetwork) return storedApiBase;
    }
  }

  if (browserNetworkApiBase && isConfiguredLoopback) {
    return browserNetworkApiBase;
  }
  if (configuredApiBase && !isConfiguredLoopback) return configuredApiBase;
  if (browserNetworkApiBase) return browserNetworkApiBase;

  return import.meta.env.DEV ? "http://127.0.0.1:8000" : PRODUCTION_API_BASE;
};

export const getApiBaseUrl = () => resolveApiBaseUrl();

// Resolved once per page load after clearing bad stored LAN URLs on hisbenew.com.
export const API_BASE_URL = resolveApiBaseUrl();

/** Display widths used like CDN image transforms (thumb / card / detail / hero). */
export const IMAGE_WIDTH = {
  thumb: 96,
  tile: 180,
  card: 360,
  grid: 480,
  detail: 900,
  hero: 1400,
};

const clampImageWidth = (value) => {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.max(48, Math.min(1600, Math.round(width)));
};

/**
 * Build a static asset URL. Always pass a width for list/grid thumbnails so the
 * API returns a small WebP instead of the full upload (Shopify/Amazon-style).
 */
export const getStaticUrl = (path, options = {}) => {
  if (!path) return null;
  const value = String(path).trim();
  if (/^(blob:|data:)/i.test(value)) return value;
  const width = clampImageWidth(options?.w ?? options?.width);
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const apiHost = getUrlHostname(API_BASE_URL);
    const ownUpload = url.pathname.startsWith("/static/uploads/") &&
      [apiHost, "api.hisbenew.com", "app.hisbenew.com", "hisbenew.com", "www.hisbenew.com", "localhost", "127.0.0.1"].includes(url.hostname);
    if (!ownUpload) return value;
    path = url.pathname + url.search;
  } else {
    path = value.startsWith("/") ? value : `/${value}`;
  }
  const baseUrl = `${API_BASE_URL}${path}`;
  if (!width) return baseUrl;
  const [pathname, query = ""] = baseUrl.split("?");
  const params = new URLSearchParams(query);
  params.set("w", String(width));
  return `${pathname}?${params}`;
};

/** Responsive srcset for product cards — browser picks the smallest fit. */
export const getStaticSrcSet = (path, widths = [IMAGE_WIDTH.tile, IMAGE_WIDTH.card, IMAGE_WIDTH.grid]) => {
  if (!path || path.startsWith("http")) return undefined;
  const unique = [...new Set(widths.map(clampImageWidth).filter(Boolean))];
  if (!unique.length) return undefined;
  return unique.map((width) => `${getStaticUrl(path, { w: width })} ${width}w`).join(", ");
};

export const getImageProps = (path, options = {}) => {
  const {
    w = IMAGE_WIDTH.card,
    widths,
    sizes = "(max-width: 640px) 45vw, 240px",
    priority = false,
    alt = "",
  } = options;
  if (!path) return null;
  const src = getStaticUrl(path, { w });
  const srcSet = getStaticSrcSet(path, widths || [w, Math.round(w * 1.5), Math.round(w * 2)]);
  return {
    src,
    srcSet,
    sizes,
    alt,
    loading: priority ? "eager" : "lazy",
    decoding: "async",
    fetchPriority: priority ? "high" : "auto",
  };
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
    if (user?.impersonatedBySuperAdmin && user?.tenant_id) {
      headers["X-ERP-Tenant-Id"] = String(user.tenant_id);
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

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/*
 * Retry policy for an unreliable link to the API server.
 * - Reads (GET/HEAD/OPTIONS) are safe to repeat: retry on dropped connections,
 *   timeouts and gateway errors.
 * - Writes (POST/PUT/PATCH/DELETE) may already have reached the server when the
 *   connection drops, so they are only retried on 502/503, which mean the proxy
 *   never reached the backend. This avoids duplicate orders, payments, shipments.
 */
const READ_METHODS = ["get", "head", "options"];
const READ_RETRY_STATUSES = [502, 503, 504];
const WRITE_RETRY_STATUSES = [502, 503];
const MAX_READ_RETRIES = 3;
const MAX_WRITE_RETRIES = 2;
const READ_ATTEMPT_TIMEOUT_MS = 25000;

const isReadMethod = (method) => READ_METHODS.includes(String(method || "get").toLowerCase());

// 1s, 2s, 4s (+ up to 400ms jitter so many tabs do not retry in lockstep).
const retryDelay = (retryNumber) => 1000 * 2 ** (retryNumber - 1) + Math.random() * 400;

const notifyRetry = (retryNumber) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("erp:network-retry", { detail: { attempt: retryNumber } }));
};

export const apiFetch = async (url, options = {}) => {
  const { retryAttempts, ...fetchOptions } = options;
  const isRead = isReadMethod(fetchOptions.method);
  const defaultAttempts = 1 + (isRead ? MAX_READ_RETRIES : MAX_WRITE_RETRIES);
  const maxAttempts = Number(retryAttempts) > 0 ? Number(retryAttempts) : defaultAttempts;
  const retryStatuses = isRead ? READ_RETRY_STATUSES : WRITE_RETRY_STATUSES;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Reads get a per-attempt timeout so a stalled connection is retried
    // instead of hanging forever (fetch has no timeout of its own).
    const controller = isRead && !fetchOptions.signal ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(), READ_ATTEMPT_TIMEOUT_MS)
      : null;
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        ...(controller ? { signal: controller.signal } : {}),
        mode: fetchOptions.mode || "cors",
        credentials: fetchOptions.credentials || "omit",
        headers: getAuthHeaders(fetchOptions.headers || {}),
      });
      if (timer) window.clearTimeout(timer);

      if (response.status === 401 && !isLoginRequest(url)) {
        let detail = "Your session expired. Please sign in again.";
        try {
          const body = await response.clone().json();
          if (body?.detail) detail = String(body.detail);
        } catch {
          // Keep the default session message.
        }
        notifyAuthExpired(detail);
        return response;
      }

      // Retry transient gateway / restart failures from VPS deploys.
      if (retryStatuses.includes(response.status) && attempt < maxAttempts) {
        notifyRetry(attempt);
        await sleep(retryDelay(attempt));
        continue;
      }

      return response;
    } catch (error) {
      if (timer) window.clearTimeout(timer);
      lastError = error;
      // A caller-cancelled request is not a network failure.
      if (error?.name === "AbortError" && !controller) throw error;
      // Writes that failed without a response may have been applied: never repeat them.
      if (!isRead || attempt >= maxAttempts) break;
      notifyRetry(attempt);
      await sleep(retryDelay(attempt));
    }
  }

  throw lastError || new Error("Network request failed.");
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  // Shorter per-attempt timeout for reads so a stalled connection is retried
  // sooner; uploads and other writes keep the full 30s.
  if (isReadMethod(config.method) && (!config.timeout || config.timeout === 30000)) {
    config.timeout = READ_ATTEMPT_TIMEOUT_MS;
  }
  config.headers = config.headers ?? {};
  Object.entries(getAuditHeaders()).forEach(([key, value]) => {
    if (config.headers[key] === undefined) {
      config.headers[key] = value;
    }
  });
  const token = getAuthToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.data?.detail && typeof error.response.data.detail !== "string") {
      error.validationDetails = error.response.data.detail;
      error.response.data.detail = errorDetailText(error.validationDetails);
    }
    const status = error?.response?.status;
    const config = error?.config || {};
    const retryCount = Number(config.__retryCount || 0);
    const isRead = isReadMethod(config.method);
    const cancelled = axios.isCancel(error) || error?.code === "ERR_CANCELED";
    // No response at all: dropped connection (ERR_NETWORK) or timeout (ECONNABORTED/ETIMEDOUT).
    const noResponse = !error?.response && !cancelled;
    const shouldRetry =
      !isLoginRequest(config.url) &&
      !config.__noRetry &&
      (isRead
        ? retryCount < MAX_READ_RETRIES && (noResponse || READ_RETRY_STATUSES.includes(status))
        : retryCount < MAX_WRITE_RETRIES && WRITE_RETRY_STATUSES.includes(status));

    if (shouldRetry) {
      config.__retryCount = retryCount + 1;
      notifyRetry(config.__retryCount);
      await sleep(retryDelay(config.__retryCount));
      return api.request(config);
    }

    if (status === 401 && !isLoginRequest(config.url)) {
      error.__authExpired = true;
      notifyAuthExpired(
        error.response?.data?.detail || "Your session expired. Please sign in again."
      );
    }
    return Promise.reject(error);
  }
);

export default api;

