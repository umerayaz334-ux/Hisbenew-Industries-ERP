import { useEffect, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import "./PrinterSettings.css";

const PRINTER_CONNECTION_MODE_STORAGE_KEY = "erpLabelPrinterConnectionMode";
const LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY = "erpLabelPrinterLocalBridgeUrl";
const DIRECT_PRINTER_STORAGE_KEY = "erpLabelPrinterDirectPrinter";
const DEFAULT_LOCAL_PRINT_BRIDGE_URL = "http://127.0.0.1:8000";

const navigateTo = (href, pageName) => {
  if (typeof window !== "undefined") {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new CustomEvent("erp:navigation", { detail: { page: pageName } }));
  }
};

const normalizeApiBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const isLoopbackHostname = (hostname) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(hostname || "").toLowerCase());

const readStoredText = (key, fallback = "") => {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const getInitialPrinterConnectionMode = () => {
  if (typeof window !== "undefined" && !isLoopbackHostname(window.location.hostname)) {
    return "server";
  }
  const savedMode = readStoredText(PRINTER_CONNECTION_MODE_STORAGE_KEY);
  if (["local", "server"].includes(savedMode)) return savedMode;
  return "server";
};

const getInitialLocalPrintBridgeUrl = () =>
  normalizeApiBaseUrl(readStoredText(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, DEFAULT_LOCAL_PRINT_BRIDGE_URL)) ||
  DEFAULT_LOCAL_PRINT_BRIDGE_URL;

const buildPrintBridgeUrl = (baseUrl, path) =>
  `${normalizeApiBaseUrl(baseUrl) || DEFAULT_LOCAL_PRINT_BRIDGE_URL}${path.startsWith("/") ? path : `/${path}`}`;

const getPrinterApiError = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

export default function PrinterSettings() {
  const [printerConnectionMode, setPrinterConnectionModeState] = useState(getInitialPrinterConnectionMode);
  const [localPrintBridgeUrl, setLocalPrintBridgeUrlState] = useState(getInitialLocalPrintBridgeUrl);
  const [directPrinter, setDirectPrinterState] = useState(() => readStoredText(DIRECT_PRINTER_STORAGE_KEY, ""));
  const [printerStatus, setPrinterStatus] = useState({ loading: false, data: null, error: "" });
  const [notice, setNotice] = useState("");
  const [testingPrinter, setTestingPrinter] = useState(false);

  const useLocalPrinterBridge = printerConnectionMode === "local";

  const setPrinterConnectionMode = (mode) => {
    setPrinterConnectionModeState(mode);
    try {
      window.localStorage.setItem(PRINTER_CONNECTION_MODE_STORAGE_KEY, mode);
    } catch {}
  };

  const setLocalPrintBridgeUrl = (value) => {
    setLocalPrintBridgeUrlState(value);
    try {
      window.localStorage.setItem(LOCAL_PRINT_BRIDGE_URL_STORAGE_KEY, value);
    } catch {}
  };

  const setDirectPrinter = (printerName) => {
    setDirectPrinterState(printerName);
    try {
      window.localStorage.setItem(DIRECT_PRINTER_STORAGE_KEY, printerName);
    } catch {}
  };

  const getPrinterEndpoint = (path) => {
    if (useLocalPrinterBridge) {
      return buildPrintBridgeUrl(localPrintBridgeUrl, path);
    }
    return `/print-agent${path.startsWith("/") ? path : `/${path}`}`;
  };

  const fetchPrinterData = (path, options = {}) => {
    if (useLocalPrinterBridge) {
      const endpoint = getPrinterEndpoint(path);
      return fetch(endpoint, options).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.detail || body?.message || `Local print bridge returned HTTP ${res.status}`);
        }
        return { data: body };
      });
    }
    return api({ url: getPrinterEndpoint(path), ...options });
  };

  const postPrinterLabels = (payload) => {
    if (useLocalPrinterBridge) {
      return fetchPrinterData("/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    return api.post(getPrinterEndpoint("/print"), payload);
  };

  const loadLabelPrinters = async (options = {}) => {
    const showNotice = options.showNotice ?? false;
    setPrinterStatus((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const response = await fetchPrinterData("/printers");
      const data = response?.data || {};
      setPrinterStatus({ loading: false, data, error: "" });
      const availablePrinters = Array.isArray(data.printers) ? data.printers : [];
      if (availablePrinters.length > 0) {
        setDirectPrinterState((current) => {
          if (current && availablePrinters.some((p) => p.name === current)) {
            return current;
          }
          const defaultP = availablePrinters.find((p) => p.is_default) || availablePrinters[0];
          const chosen = defaultP?.name || "";
          try {
            window.localStorage.setItem(DIRECT_PRINTER_STORAGE_KEY, chosen);
          } catch {}
          return chosen;
        });
      }
      if (showNotice) {
        setNotice(`Found ${availablePrinters.length} printer${availablePrinters.length === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      const errMsg = getPrinterApiError(error, "Could not fetch printer status");
      setPrinterStatus({ loading: false, data: null, error: errMsg });
      if (showNotice) setNotice(errMsg);
    }
  };

  useEffect(() => {
    loadLabelPrinters();
  }, [printerConnectionMode, localPrintBridgeUrl]);

  const printerOptions = Array.isArray(printerStatus.data?.printers) ? printerStatus.data.printers : [];
  const selectedPrinter = printerOptions.find((p) => p.name === directPrinter) || null;
  const connectedCount = printerOptions.filter((p) => p.is_connected).length;

  const handleTestPrint = async () => {
    if (!directPrinter) {
      setNotice("Select a printer before testing.");
      return;
    }
    setTestingPrinter(true);
    setNotice("Sending test label...");
    try {
      const response = await postPrinterLabels({
        labels: [
          {
            title: "PRINTER TEST LABEL",
            sku: "TEST-AGENT-001",
            barcode: "TEST-AGENT-001",
            quantity: 1,
          },
        ],
        size: { width_mm: 50, height_mm: 25, gap_mm: 2 },
        printer_name: directPrinter,
      });
      setNotice(`Test label successfully sent to ${response.data.printer}! (Job #${response.data.job_id})`);
      loadLabelPrinters();
    } catch (err) {
      setNotice(getPrinterApiError(err, "Failed to send test print job."));
    } finally {
      setTestingPrinter(false);
    }
  };

  return (
    <main className="printer-settings-page">
      <header className="printer-settings-header">
        <div>
          <div className="printer-settings-breadcrumbs">
            <a href="/portal" onClick={(e) => { e.preventDefault(); navigateTo("/portal", "Dashboard"); }}>Portal</a> / <a href="/portal/label-printer" onClick={(e) => { e.preventDefault(); navigateTo("/portal/label-printer", "Label Printer"); }}>Label Printer</a> / <span>Printer Settings</span>
          </div>
          <h1>Printer Settings</h1>
          <p>Manage direct thermal print agents, select default hardware printers, and calibrate media options.</p>
        </div>
        <div className="printer-settings-header-actions">
          <a className="printer-settings-btn secondary" href="/portal/label-printer" onClick={(e) => { e.preventDefault(); navigateTo("/portal/label-printer", "Label Printer"); }}>
            Back to Label Studio
          </a>
        </div>
      </header>

      {notice ? <div className="printer-settings-notice">{notice}</div> : null}

      <div className="printer-settings-grid">
        {/* Card 1: Connection Source */}
        <section className="printer-settings-card">
          <h2>1. Connection Source</h2>
          <p>Choose where the ERP sends direct print commands. Use <strong>This laptop</strong> if running the python print agent locally, or <strong>ERP server</strong> for cloud web sockets.</p>
          
          <div className="printer-settings-mode-toggle">
            <button
              className={useLocalPrinterBridge ? "active" : ""}
              onClick={() => setPrinterConnectionMode("local")}
              type="button"
            >
              This laptop (Local Bridge)
            </button>
            <button
              className={!useLocalPrinterBridge ? "active" : ""}
              onClick={() => setPrinterConnectionMode("server")}
              type="button"
            >
              ERP Cloud Server
            </button>
          </div>

          {useLocalPrinterBridge ? (
            <div className="printer-settings-field">
              <label>Local Print Bridge Endpoint URL</label>
              <input
                onChange={(e) => setLocalPrintBridgeUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000"
                value={localPrintBridgeUrl}
              />
              <small>Local Python agent address running on Windows.</small>
            </div>
          ) : (
            <div className="printer-settings-info-box">
              <strong>ERP Cloud Agent Active</strong>
              <p>Connected via WebSockets / REST endpoint: <code>https://api.hisbenew.com/print-agent</code></p>
            </div>
          )}
        </section>

        {/* Card 2: Selected Hardware Printer */}
        <section className="printer-settings-card">
          <h2>2. Selected Label Printer</h2>
          <p>Choose your default thermal label printer (e.g. Gainscha GA-3406T, TSC, Xprinter, Zebra).</p>

          <div className="printer-settings-field">
            <label>Active Windows Printer</label>
            <select
              disabled={printerStatus.loading || printerOptions.length === 0}
              onChange={(e) => setDirectPrinter(e.target.value)}
              value={directPrinter}
            >
              <option value="">-- Select Printer --</option>
              {printerOptions.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {`${printer.name}${printer.is_default ? " (System Default)" : ""}${printer.is_connected ? "" : " - Offline"}`}
                </option>
              ))}
            </select>
          </div>

          <div className="printer-settings-actions-row">
            <button
              className="printer-settings-btn secondary"
              disabled={printerStatus.loading}
              onClick={() => loadLabelPrinters({ showNotice: true })}
              type="button"
            >
              {printerStatus.loading ? "Checking..." : "Refresh Printer List"}
            </button>
            <button
              className="printer-settings-btn primary"
              disabled={testingPrinter || !directPrinter}
              onClick={handleTestPrint}
              type="button"
            >
              {testingPrinter ? "Printing..." : "Print Test Label"}
            </button>
          </div>
        </section>

        {/* Card 3: Agent Diagnostics & Status */}
        <section className="printer-settings-card full-width">
          <h2>3. Agent Status & Diagnostics</h2>
          <div className="printer-settings-status-grid">
            <div className="printer-settings-stat-item">
              <span className="stat-label">Agent Connection</span>
              <span className={`stat-value ${printerStatus.error ? "error" : "success"}`}>
                {printerStatus.error ? "Offline / Error" : "Connected & Ready"}
              </span>
            </div>
            <div className="printer-settings-stat-item">
              <span className="stat-label">Printers Detected</span>
              <span className="stat-value">{connectedCount} of {printerOptions.length} Online</span>
            </div>
            <div className="printer-settings-stat-item">
              <span className="stat-label">Selected Hardware</span>
              <span className="stat-value highlight">{selectedPrinter?.name || directPrinter || "None"}</span>
            </div>
            <div className="printer-settings-stat-item">
              <span className="stat-label">Direct Thermal TSPL</span>
              <span className="stat-value">
                {selectedPrinter?.supports_direct_labels ? "Supported (TSPL Ready)" : "Dialog / Windows RAW"}
              </span>
            </div>
          </div>

          {printerStatus.error ? (
            <div className="printer-settings-error-banner">
              <strong>Connection Error:</strong> {printerStatus.error}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
