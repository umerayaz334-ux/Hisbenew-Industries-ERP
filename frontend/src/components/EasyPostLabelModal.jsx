import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api, { getStaticUrl } from "../api/api";
import CARRIER_LOGOS, { carrierLogoKey } from "./carrierLogos";
import "./EasyPostLabelModal.css";

const KG_TO_OZ = 35.27396;
const WEIGHT_UNITS = { kg: KG_TO_OZ, lb: 16, oz: 1 };
const WEIGHT_UNIT_KEY = "erpEasypostWeightUnit";

const readWeightUnit = () => {
  try {
    const saved = window.localStorage.getItem(WEIGHT_UNIT_KEY);
    return WEIGHT_UNITS[saved] ? saved : "kg";
  } catch {
    return "kg";
  }
};

// Round for display in a unit: kg and lb to 0.01, oz to 0.1.
const formatWeight = (oz, unit) => {
  if (!oz) return "";
  const value = oz / WEIGHT_UNITS[unit];
  const rounded = unit === "oz" ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
  return String(rounded);
};

const describeWeight = (oz) => {
  if (!oz) return "";
  const pounds = Math.floor(oz / 16);
  const ounces = Math.round((oz % 16) * 10) / 10;
  const kg = Math.round((oz / KG_TO_OZ) * 100) / 100;
  return `${kg} kg = ${pounds ? `${pounds} lb ` : ""}${ounces} oz`;
};
const EMPTY_ADDRESS = {
  name: "",
  company: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  phone: "",
  email: "",
};

const TAG_LABELS = {
  cheapest: "Cheapest",
  fastest: "Fastest",
  best_value: "Best value",
};

const money = (value, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value || 0));

const errorText = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg).filter(Boolean).join(" ");
  return fallback;
};

const prettyService = (service = "") =>
  String(service)
    .replace(/^(FEDEX|UPS|DHL|USPS)_/i, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const prettyCarrier = (carrier = "") =>
  String(carrier).replace(/Default$/i, "").replace(/^Fedex/i, "FedEx") || "Carrier";

/** Turn the free-text "ship to" into a structured address (best effort). */
const parseShipTo = (text, fallbackName = "") => {
  const address = { ...EMPTY_ADDRESS, name: fallbackName || "" };
  const raw = String(text || "").trim();
  if (!raw) return address;

  const phone = raw.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phone) address.phone = phone[0].trim();
  const email = raw.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (email) address.email = email[0];

  let lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !(phone && line === phone[0].trim()) && !(email && line === email[0]))
    .map((line) => line.replace(/^(phone|tel|email)\s*[:-]\s*.*/i, "").trim())
    .filter(Boolean);

  if (lines.length === 1) lines = lines[0].split(/\s*,\s*/).filter(Boolean);

  const countryLine = lines[lines.length - 1];
  if (/^(usa|us|united states( of america)?)$/i.test(countryLine || "")) {
    lines.pop();
  } else if (lines.length > 2 && /^[A-Za-z ]{4,}$/.test(countryLine) && !/\d/.test(countryLine)) {
    const maybeCountry = countryLine.trim();
    if (maybeCountry.length === 2) address.country = maybeCountry.toUpperCase();
  }

  const cityRe = /^(.*?)[,\s]+([A-Za-z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/;
  let cityIndex = lines.findIndex((line) => cityRe.test(line));
  if (cityIndex === -1) {
    // "City, ST" and "12345" split across comma pieces
    const zipIndex = lines.findIndex((line) => /^\d{5}(-\d{4})?$/.test(line));
    if (zipIndex > 1 && /^[A-Za-z]{2}$/.test(lines[zipIndex - 1])) {
      lines.splice(zipIndex - 2, 3, `${lines[zipIndex - 2]}, ${lines[zipIndex - 1]} ${lines[zipIndex]}`);
      cityIndex = zipIndex - 2;
    } else if (zipIndex === -1) {
      const stateZipIndex = lines.findIndex((line) => /^[A-Za-z]{2}\s+\d{5}(-\d{4})?$/.test(line));
      if (stateZipIndex > 0) {
        lines.splice(stateZipIndex - 1, 2, `${lines[stateZipIndex - 1]}, ${lines[stateZipIndex]}`);
        cityIndex = stateZipIndex - 1;
      }
    } else if (zipIndex > 0) {
      const stateZip = lines[zipIndex - 1].match(/^(.*?)\s+([A-Za-z]{2})$/);
      if (stateZip) {
        lines.splice(zipIndex - 1, 2, `${stateZip[1]}, ${stateZip[2]} ${lines[zipIndex]}`);
        cityIndex = zipIndex - 1;
      }
    }
  }
  if (cityIndex >= 0) {
    const [, city, state, zip] = lines[cityIndex].match(cityRe);
    Object.assign(address, {
      city: city.replace(/,$/, "").trim(),
      state: state.toUpperCase(),
      zip,
    });
    const before = lines.slice(0, cityIndex);
    const streetStart = before.findIndex((line) => /^\d/.test(line) || /^(po box|p\.o\.)/i.test(line));
    if (streetStart >= 0) {
      if (streetStart > 0) address.name = before[0];
      if (streetStart > 1) address.company = before.slice(1, streetStart).join(", ");
      address.street1 = before[streetStart] || "";
      address.street2 = before.slice(streetStart + 1).join(", ");
    } else if (before.length) {
      address.street1 = before[before.length - 1];
      if (before.length > 1) address.name = before[0];
    }
  } else if (lines.length) {
    address.street1 = lines[/^\d/.test(lines[0]) ? 0 : Math.min(1, lines.length - 1)];
    if (!/^\d/.test(lines[0]) && lines.length > 1) address.name = lines[0];
  }
  if (!address.name) address.name = fallbackName || "";
  return address;
};

const addressComplete = (address) =>
  Boolean(address?.street1 && address?.city && address?.zip && (address?.state || address?.country !== "US"));

const addressOneLine = (address) =>
  [address?.street1, address?.city, [address?.state, address?.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

function CarrierLogo({ carrier }) {
  const logo = CARRIER_LOGOS[carrierLogoKey(carrier)];
  const name = prettyCarrier(carrier);
  if (!logo) {
    return (
      <span className="ep-carrier is-text" title={name}>
        {name.slice(0, 5)}
      </span>
    );
  }
  return (
    <span
      className={`ep-carrier ${logo.wide ? "is-wide" : ""}`}
      style={{ background: logo.background, color: logo.color }}
      title={name}
    >
      <svg aria-label={name} role="img" viewBox="0 0 24 24">
        <path d={logo.path} fill="currentColor" />
      </svg>
    </span>
  );
}

function Svg({ name, size = 16 }) {
  const paths = {
    close: "M6 6l12 12M18 6L6 18",
    gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.5a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z",
    pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    box: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12m0 0 8.5-4.5M12 12v9",
    truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
    check: "M5 12.5 10 17l9-10",
    print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    shield: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z",
    edit: "M4 20h4L19 9l-4-4L4 16v4Z",
    undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
    bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  };
  return (
    <svg aria-hidden="true" className="ep-icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d={paths[name]} />
    </svg>
  );
}

function AddressFields({ value, onChange, compact = false, requirePhone = false }) {
  const [pasteText, setPasteText] = useState("");
  const set = (field) => (event) => onChange({ ...value, [field]: event.target.value });
  const upper = (field) => (event) => onChange({ ...value, [field]: event.target.value.toUpperCase() });

  const applyPaste = (text) => {
    const parsed = parseShipTo(text, value.name);
    const filled = Object.fromEntries(
      Object.entries(parsed).filter(([field, fieldValue]) => fieldValue && !(field === "country" && fieldValue === "US"))
    );
    onChange({ ...value, ...filled, name: value.name || parsed.name });
    setPasteText("");
  };

  const field = (name, label, props = {}, onFieldChange = set(name)) => (
    <label className={`ep-field ep-col-${name}`}>
      <span>{label}</span>
      <input autoComplete="off" onChange={onFieldChange} value={value[name] || ""} {...props} />
    </label>
  );

  return (
    <div className={`ep-address ${compact ? "is-compact" : ""}`}>
      <div className="ep-paste">
        <input
          aria-label="Paste a full address"
          onBlur={() => pasteText.trim() && applyPaste(pasteText)}
          onChange={(event) => setPasteText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && pasteText.trim()) {
              event.preventDefault();
              applyPaste(pasteText);
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (text.trim()) {
              event.preventDefault();
              applyPaste(text);
            }
          }}
          placeholder="Paste a full address to fill the fields below"
          value={pasteText}
        />
      </div>
      <div className="ep-address-grid">
        {field("name", "Name")}
        {field("company", "Company")}
        {field("phone", requirePhone ? "Phone (required)" : "Phone", { inputMode: "tel" })}
        {field("street1", "Street address")}
        {field("street2", "Apt / suite")}
        {field("city", "City")}
        {field("state", "State", { maxLength: 3 }, upper("state"))}
        {field("zip", "ZIP", { inputMode: "numeric" })}
        {field("country", "Country", { maxLength: 2 }, upper("country"))}
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onSaved, onBack, canManage }) {
  const [mode, setMode] = useState(settings.mode);
  const [testKey, setTestKey] = useState("");
  const [liveKey, setLiveKey] = useState("");
  const [fromAddress, setFromAddress] = useState({
    ...EMPTY_ADDRESS,
    ...(addressComplete(settings.from_address) ? {} : settings.from_address_suggestion),
    ...settings.from_address,
  });
  const [defaults, setDefaults] = useState(settings.defaults);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const payload = { mode, from_address: fromAddress, defaults };
    if (testKey.trim()) payload.test_api_key = testKey.trim();
    if (liveKey.trim()) payload.live_api_key = liveKey.trim();
    try {
      const { data } = await api.put("/shipping/easypost/settings", payload);
      setTestKey("");
      setLiveKey("");
      onSaved(data);
      setMessage({ type: "success", text: "EasyPost settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: errorText(error, "Settings could not be saved.") });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await api.post("/shipping/easypost/test-connection");
      setMessage({ type: "success", text: data.message });
    } catch (error) {
      setMessage({ type: "error", text: errorText(error, "Connection failed.") });
    } finally {
      setBusy(false);
    }
  };

  const setDefault = (field, value) => setDefaults((current) => ({ ...current, [field]: value }));

  return (
    <div className="ep-settings">
      {!canManage && (
        <div className="ep-alert is-info">Only admins and managers can change EasyPost settings.</div>
      )}
      <section className="ep-card">
        <header className="ep-card-head">
          <h3>Account mode</h3>
          <p>Test mode makes free sample labels. Live mode buys real postage on your EasyPost account.</p>
        </header>
        <div className="ep-mode-switch" role="radiogroup">
          {["test", "live"].map((option) => (
            <button
              aria-checked={mode === option}
              className={`ep-mode-option is-${option} ${mode === option ? "is-active" : ""}`}
              disabled={!canManage}
              key={option}
              onClick={() => setMode(option)}
              role="radio"
              type="button"
            >
              <strong>{option === "test" ? "Test" : "Live"}</strong>
              <small>
                {settings.keys[option].configured
                  ? `Key ${settings.keys[option].masked}${settings.keys[option].source === "server" ? " · server" : ""}`
                  : "No key yet"}
              </small>
            </button>
          ))}
        </div>
        <div className="ep-key-grid">
          <label className="ep-field">
            <span>Test API key</span>
            <input
              autoComplete="off"
              disabled={!canManage}
              onChange={(event) => setTestKey(event.target.value)}
              placeholder={settings.keys.test.configured ? "Saved. Paste a new key to replace it" : "EZTK…"}
              type="password"
              value={testKey}
            />
          </label>
          <label className="ep-field">
            <span>Live API key</span>
            <input
              autoComplete="off"
              disabled={!canManage}
              onChange={(event) => setLiveKey(event.target.value)}
              placeholder={settings.keys.live.configured ? "Saved. Paste a new key to replace it" : "EZAK…"}
              type="password"
              value={liveKey}
            />
          </label>
        </div>
      </section>

      <section className="ep-card">
        <header className="ep-card-head">
          <h3>Ship from (return address)</h3>
          <p>
            {addressComplete(settings.from_address)
              ? "Used on every label unless you change it on an order."
              : "Company and phone come from your company profile. Paste your warehouse address once and it is saved for every label."}
          </p>
        </header>
        <AddressFields onChange={setFromAddress} value={fromAddress} />
      </section>

      <section className="ep-card">
        <header className="ep-card-head">
          <h3>Automation</h3>
          <p>How much of the label flow happens on its own.</p>
        </header>
        <div className="ep-settings-grid">
          <label className="ep-field">
            <span>Auto-pick rate</span>
            <select onChange={(event) => setDefault("auto_select", event.target.value)} value={defaults.auto_select}>
              <option value="cheapest">Cheapest</option>
              <option value="fastest">Fastest</option>
              <option value="none">Let me choose</option>
            </select>
          </label>
          <label className="ep-field">
            <span>Label format</span>
            <select onChange={(event) => setDefault("label_format", event.target.value)} value={defaults.label_format}>
              {settings.label_formats.map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span>Label size</span>
            <select onChange={(event) => setDefault("label_size", event.target.value)} value={defaults.label_size}>
              {settings.label_sizes.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="ep-toggle-list">
          {[
            ["verify_addresses", "Check the ship-to address before getting rates"],
            ["open_label_after_buy", "Open the label for printing after buying"],
            ["mark_shipped_after_buy", "Mark the order shipped after buying (when stock is picked)"],
          ].map(([field, text]) => (
            <label className="ep-toggle" key={field}>
              <input
                checked={Boolean(defaults[field])}
                onChange={(event) => setDefault(field, event.target.checked)}
                type="checkbox"
              />
              <span className="ep-toggle-track" />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </section>

      {message && <div className={`ep-alert is-${message.type}`}>{message.text}</div>}

      <footer className="ep-footer">
        <button className="ep-btn is-ghost" onClick={onBack} type="button">
          Back to label
        </button>
        <div className="ep-footer-actions">
          <button className="ep-btn is-secondary" disabled={busy} onClick={testConnection} type="button">
            <Svg name="link" /> Test connection
          </button>
          <button className="ep-btn is-primary" disabled={busy || !canManage} onClick={save} type="button">
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default function EasyPostLabelModal({
  order,
  onClose,
  onLabelBought,
  canShipAfterBuy,
  canManage,
  kind = "fulfillment",
  shipAfterBuyLabel = "Mark shipped after buying",
}) {
  const orderPath = `/shipping/easypost/${kind === "sales" ? "sales-orders" : "orders"}/${order.id}`;
  const orderRef = order.fulfillment_order_no || order.order_no || `#${order.id}`;
  const [settings, setSettings] = useState(null);
  const [view, setView] = useState("label");
  const [loadError, setLoadError] = useState("");
  const [toAddress, setToAddress] = useState(() => parseShipTo(order.ship_to, order.customer_name));
  const [fromAddress, setFromAddress] = useState(EMPTY_ADDRESS);
  const [editTo, setEditTo] = useState(false);
  const [editFrom, setEditFrom] = useState(false);
  const [verify, setVerify] = useState(null);
  const [weightUnit, setWeightUnit] = useState(readWeightUnit);
  // Where the starting weight came from, for the hint under the field.
  const [weightSource] = useState(() => {
    if (Number(order.package_weight_kg) > 0) return "order";
    const itemsKg = (order.items || []).reduce(
      (sum, item) => sum + Number(item.unit_weight_kg || 0) * Number(item.quantity || 0),
      0
    );
    return itemsKg > 0 ? "products" : "none";
  });
  const [parcel, setParcel] = useState(() => {
    // The order's package weight (what the dispatch form uses) wins; otherwise
    // add up product weights plus 5% for packing material.
    const packageKg = Number(order.package_weight_kg) || 0;
    const itemsKg = (order.items || []).reduce(
      (sum, item) => sum + Number(item.unit_weight_kg || 0) * Number(item.quantity || 0),
      0
    );
    const oz = packageKg > 0 ? packageKg * KG_TO_OZ : itemsKg * KG_TO_OZ * 1.05;
    return { weight: formatWeight(oz, readWeightUnit()), length: "", width: "", height: "", preset: "" };
  });
  const [labelFormat, setLabelFormat] = useState("PDF");
  const [signature, setSignature] = useState(false);
  const [insurance, setInsurance] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoteKey, setQuoteKey] = useState("");
  const [selectedRateId, setSelectedRateId] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [error, setError] = useState("");
  const [bought, setBought] = useState(null);
  const [history, setHistory] = useState([]);
  const [markShipped, setMarkShipped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [carrierFilter, setCarrierFilter] = useState("all");
  const autoQuoted = useRef(false);
  const canShipRef = useRef(canShipAfterBuy);

  const weightOz = Math.max(0, Number(parcel.weight || 0)) * WEIGHT_UNITS[weightUnit];

  const changeWeightUnit = (unit) => {
    if (unit === weightUnit) return;
    // Keep the same physical weight, shown in the new unit.
    setParcel((current) => ({ ...current, weight: formatWeight(weightOz, unit) }));
    setWeightUnit(unit);
    try {
      window.localStorage.setItem(WEIGHT_UNIT_KEY, unit);
    } catch {
      /* preference is optional */
    }
  };

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await api.get(`${orderPath}/labels`);
      setHistory(data.labels || []);
    } catch {
      setHistory([]);
    }
  }, [orderPath]);

  useEffect(() => {
    let alive = true;
    api
      .get("/shipping/easypost/settings")
      .then(({ data }) => {
        if (!alive) return;
        setSettings(data);
        const savedFrom = addressComplete(data.from_address) && Boolean(data.from_address.phone);
        setFromAddress({
          ...EMPTY_ADDRESS,
          ...(savedFrom ? {} : data.from_address_suggestion),
          ...data.from_address,
        });
        if (!savedFrom) setEditFrom(true);
        setLabelFormat(data.defaults.label_format || "PDF");
        setMarkShipped(Boolean(data.defaults.mark_shipped_after_buy) && canShipRef.current);
        // Only an API key needs the settings screen; everything else is filled inline.
        if (!data.keys[data.mode]?.configured) setView("settings");
        const preset = (data.defaults.parcel_presets || [])[0];
        if (preset) {
          setParcel((current) =>
            current.length ? current : { ...current, preset: preset.name, length: preset.length, width: preset.width, height: preset.height }
          );
        }
      })
      .catch((err) => alive && setLoadError(errorText(err, "EasyPost settings could not be loaded.")));
    const timer = setTimeout(loadHistory, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [loadHistory]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !buying) onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [buying, onClose]);

  const fromReady = addressComplete(fromAddress) && Boolean(String(fromAddress.phone || "").trim());
  const ready = Boolean(settings) && addressComplete(toAddress) && fromReady && weightOz > 0;
  const currentKey = JSON.stringify([toAddress, fromAddress, weightOz, parcel.length, parcel.width, parcel.height, labelFormat, signature]);
  const quoteStale = quote && quoteKey !== currentKey;

  const getRates = useCallback(async () => {
    if (!settings) return;
    setQuoting(true);
    setError("");
    setConfirmLive(false);
    try {
      if (settings.defaults.verify_addresses && !verify) {
        try {
          const { data } = await api.post("/shipping/easypost/verify-address", { address: toAddress });
          setVerify(data);
        } catch {
          /* verification is advisory only */
        }
      }
      const { data } = await api.post(`${orderPath}/rates`, {
        to_address: toAddress,
        from_address: fromAddress,
        parcel: { weight_oz: weightOz, length: parcel.length, width: parcel.width, height: parcel.height },
        label_format: labelFormat,
        label_size: settings.defaults.label_size,
        signature,
      });
      setQuote(data);
      // First successful quote: remember the ship-from address as the default.
      if (canManage && (!addressComplete(settings.from_address) || !settings.from_address.phone) && fromReady) {
        api
          .put("/shipping/easypost/settings", { from_address: fromAddress })
          .then(({ data: saved }) => setSettings(saved))
          .catch(() => {});
      }
      setQuoteKey(currentKey);
      const pick = settings.defaults.auto_select;
      const auto =
        pick === "none" ? null : data.rates.find((rate) => rate.tags.includes(pick)) || data.rates[0];
      setSelectedRateId(auto?.id || "");
      if (!data.rates.length) setError("No carrier returned a rate for this package. Check the address and weight.");
    } catch (err) {
      setQuote(null);
      setError(errorText(err, "Rates could not be loaded."));
    } finally {
      setQuoting(false);
    }
  }, [canManage, currentKey, fromAddress, fromReady, labelFormat, orderPath, parcel, settings, signature, toAddress, verify, weightOz]);

  // Fully automatic: as soon as everything is filled in, fetch rates once.
  useEffect(() => {
    if (view === "label" && ready && !autoQuoted.current && !bought) {
      autoQuoted.current = true;
      const timer = setTimeout(getRates, 200);
      return () => clearTimeout(timer);
    }
    return undefined
  }, [bought, getRates, ready, view]);

  const selectedRate = quote?.rates.find((rate) => rate.id === selectedRateId) || null;
  const isLive = (quote?.mode || settings?.mode) === "live";

  const buyLabel = async () => {
    if (!selectedRate || !quote) return;
    if (isLive && !confirmLive) {
      setConfirmLive(true);
      return;
    }
    setBuying(true);
    setError("");
    try {
      const { data } = await api.post(`${orderPath}/buy`, {
        shipment_id: quote.shipment_id,
        rate_id: selectedRate.id,
        label_format: quote.label_format,
        insurance: Number(insurance || 0),
        confirm_live: isLive,
      });
      setBought(data.label);
      loadHistory();
      if (settings.defaults.open_label_after_buy && data.label.label_file_url && data.label.label_format !== "ZPL") {
        window.open(getStaticUrl(data.label.label_file_url), "_blank", "noopener");
      }
      await onLabelBought?.(data.label, { markShipped: markShipped && canShipAfterBuy });
    } catch (err) {
      setError(errorText(err, "The label could not be bought."));
    } finally {
      setBuying(false);
      setConfirmLive(false);
    }
  };

  const voidLabel = async (label) => {
    if (!window.confirm(`Void the ${prettyCarrier(label.carrier)} label ${label.tracking_code || ""}? Unused postage is refunded by the carrier.`)) return;
    setError("");
    try {
      const { data } = await api.post(`/shipping/easypost/labels/${label.id}/refund`);
      if (bought?.id === label.id) setBought(data.label);
      loadHistory();
      await onLabelBought?.(data.label, { markShipped: false, refunded: true });
    } catch (err) {
      setError(errorText(err, "The label could not be voided."));
    }
  };

  const copyTracking = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const applyPreset = (name) => {
    const preset = settings?.defaults.parcel_presets.find((item) => item.name === name);
    setParcel((current) =>
      preset
        ? { ...current, preset: name, length: preset.length, width: preset.width, height: preset.height }
        : { ...current, preset: "" }
    );
  };

  const activeHistory = useMemo(() => history.filter((label) => label.status === "purchased"), [history]);

  const modeBadge = settings && (
    <span className={`ep-mode-badge is-${settings.mode}`}>
      <i />
      {settings.mode === "live" ? "Live" : "Test mode"}
    </span>
  );

  const renderRates = () => {
    if (!ready) {
      return (
        <div className="ep-rates-empty">
          <Svg name="truck" size={30} />
          <strong>Rates show up here</strong>
          <span>
            {!addressComplete(toAddress)
              ? "Finish the ship-to address."
              : !addressComplete(fromAddress)
                ? "Add your ship-from address (left, bottom). It is saved for next time."
                : !fromReady
                  ? "Add a ship-from phone number. FedEx and UPS require it."
                : "Enter the package weight."}
          </span>
        </div>
      );
    }
    if (quoting) {
      return (
        <div className="ep-rate-list" aria-busy="true">
          {[0, 1, 2, 3].map((index) => (
            <div className="ep-rate is-skeleton" key={index}>
              <span className="ep-skel is-logo" />
              <span className="ep-skel is-line" />
              <span className="ep-skel is-price" />
            </div>
          ))}
        </div>
      );
    }
    if (!quote) {
      return (
        <div className="ep-rates-empty">
          <Svg name="truck" size={30} />
          <strong>Ready for rates</strong>
          <button className="ep-btn is-primary" onClick={getRates} type="button">
            <Svg name="refresh" size={14} /> Check rates
          </button>
        </div>
      );
    }
    const carriers = [...new Set(quote.rates.map((rate) => prettyCarrier(rate.carrier)))];
    const visibleRates =
      carrierFilter === "all"
        ? quote.rates
        : quote.rates.filter((rate) => prettyCarrier(rate.carrier) === carrierFilter);
    return (
      <>
        {carriers.length > 1 && (
          <div className="ep-carrier-chips" role="group" aria-label="Filter by carrier">
            {["all", ...carriers].map((carrier) => (
              <button
                className={carrierFilter === carrier ? "is-active" : ""}
                key={carrier}
                onClick={() => setCarrierFilter(carrier)}
                type="button"
              >
                {carrier === "all" ? `All (${quote.rates.length})` : carrier}
              </button>
            ))}
          </div>
        )}
        {quoteStale && (
          <button className="ep-stale" onClick={getRates} type="button">
            <Svg name="refresh" /> Package or address changed. Refresh rates
          </button>
        )}
        <div className="ep-rate-list" role="radiogroup" aria-label="Shipping rates">
          {visibleRates.map((rate) => {
            const selected = rate.id === selectedRateId;
            return (
              <button
                aria-checked={selected}
                className={`ep-rate ${selected ? "is-selected" : ""}`}
                disabled={quoteStale}
                key={rate.id}
                onClick={() => {
                  setSelectedRateId(rate.id);
                  setConfirmLive(false);
                }}
                role="radio"
                type="button"
              >
                <CarrierLogo carrier={rate.carrier} />
                <span className="ep-rate-main">
                  <strong>{prettyService(rate.service)}</strong>
                  <small>
                    {prettyCarrier(rate.carrier)}
                    {rate.delivery_days ? ` · ${rate.delivery_days} day${rate.delivery_days > 1 ? "s" : ""}` : " · Delivery time varies"}
                    {rate.delivery_date_guaranteed ? " · Guaranteed" : ""}
                  </small>
                  {rate.tags.length > 0 && (
                    <span className="ep-tags">
                      {rate.tags.map((tag) => (
                        <em className={`ep-tag is-${tag}`} key={tag}>
                          {TAG_LABELS[tag]}
                        </em>
                      ))}
                    </span>
                  )}
                </span>
                <span className="ep-rate-price">
                  <strong>{money(rate.rate, rate.currency)}</strong>
                  {rate.retail_rate && rate.retail_rate > rate.rate && (
                    <s>{money(rate.retail_rate, rate.currency)}</s>
                  )}
                </span>
                <span className="ep-radio" />
              </button>
            );
          })}
        </div>
        {quote.messages.length > 0 && (
          <details className="ep-carrier-notes">
            <summary>{quote.messages.length} carrier note{quote.messages.length > 1 ? "s" : ""}</summary>
            <ul>
              {quote.messages.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  };

  const renderSuccess = () => (
    <div className="ep-success">
      <div className={`ep-success-hero ${bought.status !== "purchased" ? "is-voided" : ""}`}>
        <span className="ep-success-check">
          <Svg name={bought.status === "purchased" ? "check" : "undo"} size={26} />
        </span>
        <div>
          <h3>{bought.status === "purchased" ? "Label ready" : "Label voided"}</h3>
          <p>
            {prettyCarrier(bought.carrier)} {prettyService(bought.service)} · {money(bought.rate, bought.currency)}
            {bought.mode === "test" ? " · test label, no charge" : ""}
          </p>
        </div>
      </div>

      <div className="ep-tracking">
        <small>Tracking number</small>
        <div>
          <code>{bought.tracking_code || "Pending"}</code>
          {bought.tracking_code && (
            <button className="ep-icon-btn" onClick={() => copyTracking(bought.tracking_code)} title="Copy tracking number" type="button">
              <Svg name={copied ? "check" : "copy"} />
            </button>
          )}
        </div>
        {bought.tracking_url && (
          <a href={bought.tracking_url} rel="noreferrer" target="_blank">
            Open tracking page
          </a>
        )}
      </div>

      {bought.status === "purchased" && (
        <div className="ep-success-actions">
          <a className="ep-btn is-primary is-large" href={getStaticUrl(bought.label_file_url)} rel="noreferrer" target="_blank">
            <Svg name="print" /> {bought.label_format === "ZPL" ? "Download ZPL label" : "Print label"}
          </a>
          <button className="ep-btn is-ghost is-danger" onClick={() => voidLabel(bought)} type="button">
            <Svg name="undo" /> Void label
          </button>
        </div>
      )}
      <p className="ep-success-note">
        The label is saved on order {orderRef}
        {kind === "sales"
          ? ". Carrier and tracking number are filled into the dispatch form."
          : ", so the warehouse can print it from the Dispatch queue."}
      </p>
      <footer className="ep-footer">
        <span />
        <button className="ep-btn is-secondary" onClick={onClose} type="button">
          Done
        </button>
      </footer>
    </div>
  );

  const renderLabel = () => (
    <div className="ep-body">
      <div className="ep-form">
        {activeHistory.length > 0 && (
          <div className="ep-alert is-warn">
            This order already has a {prettyCarrier(activeHistory[0].carrier)} label ({activeHistory[0].tracking_code}).
            Buying another one creates a second label.{" "}
            <button className="ep-link-btn" onClick={() => voidLabel(activeHistory[0])} type="button">
              Void it
            </button>
          </div>
        )}

        <section className="ep-card">
          <header className="ep-card-head is-row">
            <span className="ep-step">1</span>
            <h3>Ship to</h3>
            {verify && !editTo && (
              <span className={`ep-verify ${verify.valid ? "is-ok" : "is-bad"}`}>
                <Svg name={verify.valid ? "shield" : "pin"} size={13} />
                {verify.valid ? (verify.residential ? "Verified · Residential" : "Verified") : "Not verified"}
              </span>
            )}
            <button className="ep-link-btn" onClick={() => setEditTo((value) => !value)} type="button">
              {editTo ? "Done" : "Edit"}
            </button>
          </header>
          {editTo || !addressComplete(toAddress) ? (
            <>
              {order.ship_to && (
                <p className="ep-source">
                  From order: <span>{order.ship_to}</span>
                </p>
              )}
              <AddressFields
                onChange={(next) => {
                  setToAddress(next);
                  setVerify(null);
                }}
                value={toAddress}
              />
            </>
          ) : (
            <div className="ep-address-summary">
              <strong>{toAddress.name || "Recipient"}</strong>
              {toAddress.company && <span>{toAddress.company}</span>}
              <span>
                {toAddress.street1}
                {toAddress.street2 ? `, ${toAddress.street2}` : ""}
              </span>
              <span>
                {toAddress.city}, {toAddress.state} {toAddress.zip} · {toAddress.country}
              </span>
            </div>
          )}
          {verify && !verify.valid && verify.messages.length > 0 && (
            <div className="ep-alert is-warn">{verify.messages.join(" ")}</div>
          )}
          {verify?.valid && verify.suggested?.street1 && verify.suggested.street1 !== toAddress.street1 && (
            <div className="ep-alert is-info">
              Suggested: {addressOneLine(verify.suggested)}{" "}
              <button
                className="ep-link-btn"
                onClick={() =>
                  setToAddress((current) => ({
                    ...EMPTY_ADDRESS,
                    ...verify.suggested,
                    name: current.name,
                    company: current.company,
                    phone: current.phone,
                    email: current.email,
                  }))
                }
                type="button"
              >
                Use it
              </button>
            </div>
          )}
        </section>

        <section className="ep-card">
          <header className="ep-card-head is-row">
            <span className="ep-step">2</span>
            <h3>Package</h3>
          </header>
          <div className="ep-package-grid">
            <label className="ep-field is-wide">
              <span>Box</span>
              <select onChange={(event) => applyPreset(event.target.value)} value={parcel.preset}>
                <option value="">Custom size</option>
                {(settings?.defaults.parcel_presets || []).map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name} · {preset.length}×{preset.width}×{preset.height} in
                  </option>
                ))}
              </select>
            </label>
            <div className="ep-dims">
              {["length", "width", "height"].map((dim) => (
                <label className="ep-field" key={dim}>
                  <span>{dim[0].toUpperCase() + dim.slice(1)} in</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setParcel((current) => ({ ...current, [dim]: event.target.value, preset: "" }))}
                    type="number"
                    value={parcel[dim]}
                  />
                </label>
              ))}
            </div>
            <div className="ep-weight">
              <label className="ep-field">
                <span>Weight</span>
                <input
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setParcel((current) => ({ ...current, weight: event.target.value }))}
                  placeholder="0"
                  step="0.01"
                  type="number"
                  value={parcel.weight}
                />
              </label>
              <div className="ep-unit-switch" role="radiogroup" aria-label="Weight unit">
                {Object.keys(WEIGHT_UNITS).map((unit) => (
                  <button
                    aria-checked={weightUnit === unit}
                    className={weightUnit === unit ? "is-active" : ""}
                    key={unit}
                    onClick={() => changeWeightUnit(unit)}
                    role="radio"
                    type="button"
                  >
                    {unit}
                  </button>
                ))}
              </div>
              {weightOz > 0 && <span className="ep-weight-conversion">{describeWeight(weightOz)}</span>}
            </div>
          </div>
          <p className="ep-hint">
            {order.total_units ? `${order.total_units} unit${order.total_units > 1 ? "s" : ""}. ` : ""}
            {weightSource === "order"
              ? "Weight is taken from the order's package weight. Change it if your scale shows something different."
              : weightSource === "products"
                ? "Weight is filled in from product weights plus 5% for packing. Change it if your scale shows something different."
                : "No weight on this order or its products. Enter the parcel weight from your scale."}
          </p>
          <details className="ep-more">
            <summary>Label options</summary>
            <div className="ep-settings-grid">
              <label className="ep-field">
                <span>Format</span>
                <select onChange={(event) => setLabelFormat(event.target.value)} value={labelFormat}>
                  {(settings?.label_formats || ["PDF"]).map((format) => (
                    <option key={format}>{format}</option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span>Insure for (USD)</span>
                <input inputMode="decimal" min="0" onChange={(event) => setInsurance(event.target.value)} placeholder="0" type="number" value={insurance} />
              </label>
              <label className="ep-toggle is-inline">
                <input checked={signature} onChange={(event) => setSignature(event.target.checked)} type="checkbox" />
                <span className="ep-toggle-track" />
                <span>Signature on delivery</span>
              </label>
            </div>
          </details>
        </section>

        <section className="ep-card is-quiet">
          <header className="ep-card-head is-row">
            <span className="ep-step is-muted">
              <Svg name="pin" size={13} />
            </span>
            <h3>Ship from</h3>
            {addressComplete(settings?.from_address) && settings?.from_address?.phone ? (
              <button className="ep-link-btn" onClick={() => setEditFrom((value) => !value)} type="button">
                {editFrom ? "Done" : "Change for this order"}
              </button>
            ) : (
              <span className="ep-hint-pill">Saved for next time</span>
            )}
          </header>
          {editFrom ? (
            <AddressFields compact onChange={setFromAddress} requirePhone value={fromAddress} />
          ) : (
            <p className="ep-from-line">
              {addressComplete(fromAddress) ? (
                <>
                  <strong>{fromAddress.name || fromAddress.company}</strong> {addressOneLine(fromAddress)}
                </>
              ) : (
                <button className="ep-link-btn" onClick={() => setEditFrom(true)} type="button">
                  Add a ship-from address
                </button>
              )}
            </p>
          )}
        </section>
      </div>

      <aside className="ep-rates">
        <header className="ep-rates-head">
          <span className="ep-step">3</span>
          <h3>Choose a service</h3>
          <button
            className="ep-btn is-check"
            disabled={!ready || quoting}
            onClick={getRates}
            title={ready ? "Get live rates from all carriers" : "Fill in the addresses and weight first"}
            type="button"
          >
            {quoting ? <span className="ep-spinner is-dark" /> : <Svg name="refresh" size={14} />}
            {quoting ? "Checking…" : quote ? "Refresh rates" : "Check rates"}
          </button>
        </header>
        <div className="ep-rates-scroll">{renderRates()}</div>

        <div className="ep-buy">
          {error && <div className="ep-alert is-error">{error}</div>}
          {canShipAfterBuy && (
            <label className="ep-toggle is-inline">
              <input checked={markShipped} onChange={(event) => setMarkShipped(event.target.checked)} type="checkbox" />
              <span className="ep-toggle-track" />
              <span>{shipAfterBuyLabel}</span>
            </label>
          )}
          {confirmLive && selectedRate && (
            <div className="ep-alert is-live">
              <Svg name="bolt" size={14} /> This charges <b>{money(selectedRate.rate, selectedRate.currency)}</b> to your
              EasyPost account. Click again to confirm.
            </div>
          )}
          <button
            className={`ep-btn is-buy ${isLive ? "is-live" : ""}`}
            disabled={!selectedRate || buying || quoting || quoteStale}
            onClick={buyLabel}
            type="button"
          >
            {buying ? (
              <>
                <span className="ep-spinner" /> Buying label…
              </>
            ) : selectedRate ? (
              <>
                {confirmLive ? "Confirm and buy" : "Buy label"}
                <b>{money(selectedRate.rate, selectedRate.currency)}</b>
              </>
            ) : (
              "Select a rate"
            )}
          </button>
          {!isLive && settings && <small className="ep-buy-note">Test mode makes sample labels. You are not charged.</small>}
        </div>
      </aside>
    </div>
  );

  const renderHistory = () =>
    history.length > 0 && view === "label" && !bought ? (
      <details className="ep-history">
        <summary>Label history ({history.length})</summary>
        <ul>
          {history.map((label) => (
            <li key={label.id}>
              <span className={`ep-dot is-${label.status}`} />
              <span>
                <strong>{prettyCarrier(label.carrier)} {prettyService(label.service)}</strong>
                <small>
                  {label.tracking_code} · {money(label.rate, label.currency)} · {label.mode}
                  {label.status !== "purchased" ? ` · ${label.status.replace("_", " ")}` : ""}
                </small>
              </span>
              {label.status === "purchased" && (
                <>
                  <a className="ep-link-btn" href={getStaticUrl(label.label_file_url)} rel="noreferrer" target="_blank">
                    Label
                  </a>
                  <button className="ep-link-btn is-danger" onClick={() => voidLabel(label)} type="button">
                    Void
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  return createPortal(
    <div
      className="ep-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !buying) onClose();
      }}
    >
      <div aria-labelledby="ep-title" aria-modal="true" className="ep-modal" role="dialog">
        <header className="ep-head">
          <div className="ep-head-title">
            <span className="ep-brand">
              <Svg name="box" size={18} />
            </span>
            <div>
              <h2 id="ep-title">{view === "settings" ? "EasyPost settings" : "Buy shipping label"}</h2>
              <p>
                {orderRef}
                {order.customer_name ? ` · ${order.customer_name}` : ""}
              </p>
            </div>
          </div>
          <div className="ep-head-actions">
            {modeBadge}
            {view !== "settings" && (
              <button className="ep-icon-btn" onClick={() => setView("settings")} title="EasyPost settings" type="button">
                <Svg name="gear" />
              </button>
            )}
            <button aria-label="Close" className="ep-icon-btn" disabled={buying} onClick={onClose} type="button">
              <Svg name="close" />
            </button>
          </div>
        </header>

        {loadError ? (
          <div className="ep-pad">
            <div className="ep-alert is-error">{loadError}</div>
          </div>
        ) : !settings ? (
          <div className="ep-loading">
            <span className="ep-spinner is-dark" /> Connecting to EasyPost…
          </div>
        ) : view === "settings" ? (
          <SettingsPanel
            canManage={canManage}
            onBack={() => setView("label")}
            onSaved={(data) => {
              setSettings(data);
              setFromAddress({ ...EMPTY_ADDRESS, ...data.from_address });
              setQuote(null);
              autoQuoted.current = false;
            }}
            settings={settings}
          />
        ) : bought ? (
          renderSuccess()
        ) : (
          renderLabel()
        )}
        {renderHistory()}
      </div>
    </div>,
    document.body
  );
}
