import { useEffect, useMemo, useState } from "react";
import api, { API_BASE_URL } from "../api/api";
import { useConfirmDialog } from "../components/DialogProvider";
import "./Users.css";
import "./Settings.css";

const isLoopbackHost = (hostname) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(hostname || "").toLowerCase()
  );

const isPrivateIpv4Host = (hostname) => {
  const parts = String(hostname || "")
    .trim()
    .split(".")
    .map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
};

const getAccessMode = (hostname) => {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized || isLoopbackHost(normalized)) return "local";
  if (
    isPrivateIpv4Host(normalized) ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".lan")
  ) {
    return "same_wifi";
  }
  return "remote";
};

const accessModeLabels = {
  local: "This PC only",
  same_wifi: "Same Wi-Fi only",
  remote: "Remote ready",
};

const installButtonLabels = {
  Installed: "Installed",
  Ready: "Install app",
  "HTTPS required": "Copy app link",
  "Browser menu": "Copy app link",
};

const getPortalUrl = () => {
  if (typeof window === "undefined") return "/portal";
  return `${window.location.origin}/portal`;
};

const isStandaloneApp = () => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
};

const getInstallReadiness = (installState, installPrompt) => {
  if (installState === "installed" || isStandaloneApp()) {
    return "Installed";
  }

  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "HTTPS required";
  }

  if (installPrompt || installState === "ready") {
    return "Ready";
  }

  return "Browser menu";
};

const formatDateTime = (value) => {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const writeClipboard = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Copy command failed");
  }
};

const getDownloadFilename = (headers, fallback) => {
  const disposition = headers?.["content-disposition"] || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (!match?.[1]) return fallback;

  try {
    return decodeURIComponent(match[1].replaceAll('"', "").trim()) || fallback;
  } catch {
    return fallback;
  }
};

const getApiErrorDetail = async (error, fallback) => {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      return parsed?.detail || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.detail || fallback;
};

const EMAIL_EVENTS = [
  { key: "production_task_assigned", label: "Production task assigned" },
  { key: "manual_task_assigned", label: "Manual worker task" },
  { key: "batch_auto_assigned", label: "Batch auto-assigned" },
  { key: "order_workflow_task_assigned", label: "Order workflow task" },
];

const DEFAULT_EMAIL_SETTINGS = {
  enabled: false,
  provider: "smtp",
  from_name: "Hisbenew ERP",
  from_email: "",
  reply_to: "",
  admin_recipients: "",
  cc: "",
  bcc: "",
  smtp: {
    host: "",
    port: 587,
    username: "",
    password: "",
    use_tls: true,
    use_ssl: false,
  },
  api: {
    provider: "resend",
    api_key: "",
    endpoint: "",
    bearer_token: "",
  },
  style: {
    accent_color: "#173a57",
    background_color: "#f6f7f9",
    button_label: "Open ERP",
    button_url: "",
    footer_text: "This message was sent by Hisbenew Industries ERP.",
  },
  events: {
    production_task_assigned: {
      label: "Production task assigned",
      enabled: true,
      recipients: "worker",
      subject: "New production task: {{task_name}}",
      preheader: "{{worker_name}}, a production task is ready for you.",
      heading: "New production task assigned",
      body: "Hi {{worker_name}},\n\nYou have been assigned {{task_name}} for {{product_name}}.\nQuantity: {{quantity}}\nBatch: {{batch_no}}\nDue: {{due_date}}\n\nPlease open ERP My Tasks to start or update this work.",
      custom_recipients: "",
    },
    manual_task_assigned: {
      label: "Manual worker task assigned",
      enabled: true,
      recipients: "worker",
      subject: "Manual task assigned: {{task_name}}",
      preheader: "A manual production job was assigned in ERP.",
      heading: "Manual task assigned",
      body: "Hi {{worker_name}},\n\n{{task_name}} has been assigned for {{product_name}}.\nQuantity: {{quantity}}\nDue: {{due_date}}\nNotes: {{notes}}\n\nPlease review it in ERP My Tasks.",
      custom_recipients: "",
    },
    batch_auto_assigned: {
      label: "Production batch auto-assigned",
      enabled: false,
      recipients: "worker",
      subject: "Auto-assigned task: {{task_name}}",
      preheader: "ERP auto-assigned a production task to you.",
      heading: "Production work auto-assigned",
      body: "Hi {{worker_name}},\n\nERP auto-assigned {{task_name}} for {{product_name}}.\nBatch: {{batch_no}}\nQuantity: {{quantity}}\n\nOpen My Tasks to review the next step.",
      custom_recipients: "",
    },
    order_workflow_task_assigned: {
      label: "Order workflow task assigned",
      enabled: false,
      recipients: "worker",
      subject: "Order task assigned: {{task_name}}",
      preheader: "An order workflow task needs attention.",
      heading: "Order task assigned",
      body: "Hi {{worker_name}},\n\nYou have a new {{task_name}} task for order {{order_no}}.\nCustomer: {{customer_name}}\nDue: {{due_date}}\n\nPlease open ERP to complete the workflow.",
      custom_recipients: "",
    },
  },
};

const mergeEmailSettings = (incoming = {}) => ({
  ...DEFAULT_EMAIL_SETTINGS,
  ...incoming,
  smtp: { ...DEFAULT_EMAIL_SETTINGS.smtp, ...(incoming.smtp || {}) },
  api: { ...DEFAULT_EMAIL_SETTINGS.api, ...(incoming.api || {}) },
  style: { ...DEFAULT_EMAIL_SETTINGS.style, ...(incoming.style || {}) },
  events: Object.fromEntries(
    EMAIL_EVENTS.map((event) => [
      event.key,
      {
        ...DEFAULT_EMAIL_SETTINGS.events[event.key],
        ...((incoming.events || {})[event.key] || {}),
      },
    ])
  ),
});

function Settings({ authenticatedUser, onUpdateUser }) {
  const confirmDialog = useConfirmDialog();
  const [name, setName] = useState(authenticatedUser?.name || "");
  const [username, setUsername] = useState(
    authenticatedUser?.username || authenticatedUser?.name || ""
  );
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installState, setInstallState] = useState(() =>
    isStandaloneApp() ? "installed" : "browser"
  );
  const [copiedTarget, setCopiedTarget] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [eraseOptions, setEraseOptions] = useState([]);
  const [selectedEraseKeys, setSelectedEraseKeys] = useState([]);
  const [eraseIncludeFiles, setEraseIncludeFiles] = useState(true);
  const [eraseLoading, setEraseLoading] = useState(false);
  const [eraseRunning, setEraseRunning] = useState(false);
  const [eraseError, setEraseError] = useState("");
  const [eraseResult, setEraseResult] = useState(null);
  const [dataBusy, setDataBusy] = useState("");
  const [dataError, setDataError] = useState("");
  const [dataResult, setDataResult] = useState(null);
  const [backupFile, setBackupFile] = useState(null);
  const [backupInputKey, setBackupInputKey] = useState(0);
  const [orderImportBatches, setOrderImportBatches] = useState([]);
  const [orderImportBatchesLoading, setOrderImportBatchesLoading] = useState(false);
  const [orderImportBatchError, setOrderImportBatchError] = useState("");
  const [reversingOrderImportBatch, setReversingOrderImportBatch] = useState("");
  const [emailSettings, setEmailSettings] = useState(() =>
    mergeEmailSettings()
  );
  const [emailTemplateKey, setEmailTemplateKey] = useState(
    "production_task_assigned"
  );
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailTestRecipient, setEmailTestRecipient] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [callSettings, setCallSettings] = useState({
    video_calls_enabled: true,
  });
  const [callSettingsLoading, setCallSettingsLoading] = useState(false);
  const [callSettingsSaving, setCallSettingsSaving] = useState(false);
  const [callSettingsMessage, setCallSettingsMessage] = useState("");
  const [callSettingsError, setCallSettingsError] = useState("");
  const [connection, setConnection] = useState(() => ({
    loading: true,
    browserOnline:
      typeof navigator === "undefined" ? true : navigator.onLine,
    serverOnline: false,
    appInfo: null,
    lastSyncAt:
      typeof window === "undefined"
        ? ""
        : window.localStorage.getItem("erpLastAppSyncAt") || "",
    error: "",
  }));

  const fallbackPortalUrl = useMemo(getPortalUrl, []);
  const appInfo = connection.appInfo || {};
  const currentDevicePortalUrl = appInfo.portal_url || fallbackPortalUrl;
  const portalUrl =
    appInfo.access_mode === "remote"
      ? currentDevicePortalUrl
      : appInfo.lan_portal_url || currentDevicePortalUrl;
  const apiUrl =
    appInfo.access_mode === "remote"
      ? appInfo.api_url || API_BASE_URL || fallbackPortalUrl.replace(/\/portal$/, "")
      : appInfo.lan_api_url ||
        appInfo.api_url ||
        API_BASE_URL ||
        fallbackPortalUrl.replace(/\/portal$/, "");
  const portalHost = useMemo(() => {
    try {
      return new URL(portalUrl).hostname;
    } catch {
      return "";
    }
  }, [portalUrl]);
  const accessMode = appInfo.access_mode || getAccessMode(portalHost);
  const accessModeLabel = accessModeLabels[accessMode] || "Checking";
  const wifiChangeLabel =
    accessMode === "remote" ? "Auto switch ready" : "Use current link";
  const installReadiness = getInstallReadiness(installState, installPrompt);
  const installButtonLabel = installButtonLabels[installReadiness] || "Install app";
  const isAdmin = authenticatedUser?.role === "admin";
  const allEraseKeys = useMemo(
    () => eraseOptions.map((option) => option.key),
    [eraseOptions]
  );
  const allEraseSelected =
    allEraseKeys.length > 0 &&
    allEraseKeys.every((key) => selectedEraseKeys.includes(key));
  const settingsTabs = useMemo(
    () => [
      { key: "profile", label: "Profile" },
      ...(isAdmin ? [{ key: "calling", label: "Calling" }] : []),
      ...(isAdmin ? [{ key: "emails", label: "Email APIs" }] : []),
      { key: "install", label: "App install" },
      { key: "sync", label: "Connection" },
      ...(isAdmin ? [{ key: "data", label: "Data" }] : []),
    ],
    [isAdmin]
  );
  const selectedEmailEvent =
    emailSettings.events?.[emailTemplateKey] ||
    DEFAULT_EMAIL_SETTINGS.events.production_task_assigned;

  const refreshAppConnection = async ({ quiet = false } = {}) => {
    if (!quiet) {
      setSyncing(true);
    }

    setConnection((current) => ({
      ...current,
      loading: quiet ? current.loading : true,
      browserOnline:
        typeof navigator === "undefined" ? true : navigator.onLine,
      error: "",
    }));

    try {
      const response = await api.get("/app-install-info", { timeout: 5000 });
      const lastSyncAt = new Date().toISOString();

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => registration.update())
          .catch(() => undefined);
      }

      window.localStorage.setItem("erpLastAppSyncAt", lastSyncAt);
      setConnection({
        loading: false,
        browserOnline:
          typeof navigator === "undefined" ? true : navigator.onLine,
        serverOnline: true,
        appInfo: response.data,
        lastSyncAt,
        error: "",
      });
    } catch (syncError) {
      console.warn("ERP app connection check failed.", syncError);
      setConnection((current) => ({
        ...current,
        loading: false,
        browserOnline:
          typeof navigator === "undefined" ? true : navigator.onLine,
        serverOnline: false,
        error:
          syncError?.response?.data?.detail ||
          "Server is not reachable from this device.",
      }));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setInstallState("ready");
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setInstallState("installed");
      setMessage("App installed successfully.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    refreshAppConnection({ quiet: true });

    const updateNetworkState = () => {
      setConnection((current) => ({
        ...current,
        browserOnline: navigator.onLine,
      }));
      if (navigator.onLine) {
        refreshAppConnection({ quiet: true });
      }
    };

    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);

    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;

    let active = true;
    setEraseLoading(true);
    api
      .get("/admin/data-erase/options")
      .then((response) => {
        if (!active) return;
        setEraseOptions(Array.isArray(response.data?.options) ? response.data.options : []);
        setEraseError("");
      })
      .catch((optionsError) => {
        console.error("Data erase options error:", optionsError);
        if (active) {
          setEraseError(
            optionsError.response?.data?.detail ||
              "Erase options could not be loaded."
          );
        }
      })
      .finally(() => {
        if (active) setEraseLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const fetchOrderImportBatches = async ({ quiet = false } = {}) => {
    if (!quiet) setOrderImportBatchesLoading(true);
    setOrderImportBatchError("");

    try {
      const response = await api.get("/orders/import-batches", {
        params: { limit: 50 },
      });
      setOrderImportBatches(Array.isArray(response.data) ? response.data : []);
    } catch (batchError) {
      console.error("Order CSV import batches error:", batchError);
      setOrderImportBatchError(
        batchError.response?.data?.detail ||
          "Order CSV import history could not be loaded."
      );
    } finally {
      if (!quiet) setOrderImportBatchesLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || activeSettingsTab !== "data") return;
    fetchOrderImportBatches({ quiet: true });
  }, [activeSettingsTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    let active = true;
    setCallSettingsLoading(true);
    api
      .get("/admin/call-settings")
      .then((response) => {
        if (!active) return;
        setCallSettings({
          video_calls_enabled: response.data?.video_calls_enabled !== false,
        });
        setCallSettingsError("");
      })
      .catch((loadError) => {
        console.error("Call settings loading error:", loadError);
        if (active) {
          setCallSettingsError(
            loadError.response?.data?.detail || "Call settings could not be loaded."
          );
        }
      })
      .finally(() => {
        if (active) setCallSettingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    let active = true;
    setEmailLoading(true);
    api
      .get("/admin/email-settings")
      .then((response) => {
        if (!active) return;
        setEmailSettings(mergeEmailSettings(response.data || {}));
        setEmailError("");
      })
      .catch((emailLoadError) => {
        console.error("Email settings loading error:", emailLoadError);
        if (active) {
          setEmailError(
            emailLoadError.response?.data?.detail ||
              "Email API settings could not be loaded."
          );
        }
      })
      .finally(() => {
        if (active) setEmailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (settingsTabs.some((tab) => tab.key === activeSettingsTab)) return;
    setActiveSettingsTab("profile");
  }, [activeSettingsTab, settingsTabs]);

  const copyText = async (value, target, successMessage) => {
    try {
      await writeClipboard(value);
      setCopiedTarget(target);
      setMessage(successMessage);
      window.setTimeout(() => setCopiedTarget(""), 1800);
    } catch (clipboardError) {
      console.warn("Clipboard copy failed.", clipboardError);
      setError("Unable to copy the app link.");
    }
  };

  const installCurrentDevice = async () => {
    setError("");
    setMessage("");

    if (isStandaloneApp() || installState === "installed") {
      setInstallState("installed");
      setMessage("App is already installed on this device.");
      return;
    }

    if (!installPrompt) {
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        await copyText(
          portalUrl,
          "install",
          "App link copied. True PWA install needs a secure HTTPS ERP link."
        );
        return;
      }

      await copyText(
        portalUrl,
        "install",
        "Install prompt is not available here. App link copied instead."
      );
      return;
    }

    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);

    if (choice?.outcome === "accepted") {
      setInstallState("installed");
      setMessage("App installed successfully.");
    } else {
      setInstallState("browser");
      setMessage("Install was cancelled.");
    }
  };

  const shareAndroidLink = async () => {
    setError("");
    setMessage("");

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Hisbenew ERP",
          text: "Hisbenew ERP app link",
          url: portalUrl,
        });
        setMessage("Android app link shared.");
        return;
      } catch (shareError) {
        if (shareError?.name === "AbortError") return;
        console.warn("Android app link share failed.", shareError);
      }
    }

    await copyText(portalUrl, "android", "Android app link copied.");
  };

  const downloadPcShortcut = () => {
    setError("");
    setMessage("");

    const shortcut = [
      "[InternetShortcut]",
      `URL=${portalUrl}`,
      `IconFile=${window.location.origin}/favicon.svg`,
      "IconIndex=0",
      "",
    ].join("\r\n");
    const blob = new Blob([shortcut], { type: "application/internet-shortcut" });
    const shortcutUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = shortcutUrl;
    link.download = "Hisbenew-ERP.url";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(shortcutUrl);
    setMessage("PC app shortcut downloaded.");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!name.trim()) {
      setError("Enter your full name.");
      return;
    }

    if (pin && !/^\d{4}$/.test(pin)) {
      setError("PIN must be 4 digits.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        username: username.trim() || null,
      };

      if (pin) payload.pin = pin;

      const response = await api.put(
        `/users/${authenticatedUser.id}/profile`,
        payload
      );
      onUpdateUser(response.data);
      setMessage("Profile updated successfully.");
      setPin("");
    } catch (err) {
      console.error("Settings update error:", err);
      setError(err?.response?.data?.detail || "Unable to update profile.");
    } finally {
      setLoading(false);
    }
  };

  const toggleEraseKey = (key) => {
    setEraseResult(null);
    setSelectedEraseKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const toggleAllEraseKeys = () => {
    setEraseResult(null);
    setSelectedEraseKeys(allEraseSelected ? [] : allEraseKeys);
  };

  const updateEmailSetting = (key, value) => {
    setEmailSettings((current) => ({ ...current, [key]: value }));
  };

  const updateEmailGroup = (group, key, value) => {
    setEmailSettings((current) => ({
      ...current,
      [group]: {
        ...(current[group] || {}),
        [key]: value,
      },
    }));
  };

  const updateEmailEvent = (eventKey, key, value) => {
    setEmailSettings((current) => ({
      ...current,
      events: {
        ...current.events,
        [eventKey]: {
          ...(current.events?.[eventKey] || {}),
          [key]: value,
        },
      },
    }));
  };

  const updateVideoCallsEnabled = async (enabled) => {
    const previous = callSettings.video_calls_enabled;
    setCallSettings({ video_calls_enabled: enabled });
    setCallSettingsSaving(true);
    setCallSettingsMessage("");
    setCallSettingsError("");
    try {
      const response = await api.put("/admin/call-settings", {
        video_calls_enabled: enabled,
      });
      const savedSettings = {
        video_calls_enabled: response.data?.video_calls_enabled !== false,
      };
      setCallSettings(savedSettings);
      setCallSettingsMessage(
        savedSettings.video_calls_enabled
          ? "Video calling enabled for ERP users."
          : "Video calling disabled. Voice calls and screen sharing remain available."
      );
      window.dispatchEvent(
        new CustomEvent("erp.call-settings-updated", {
          detail: savedSettings,
        })
      );
    } catch (saveError) {
      console.error("Call settings save error:", saveError);
      setCallSettings({ video_calls_enabled: previous });
      setCallSettingsError(
        saveError.response?.data?.detail || "Call settings could not be saved."
      );
    } finally {
      setCallSettingsSaving(false);
    }
  };

  const saveEmailSettings = async () => {
    setEmailError("");
    setEmailMessage("");
    setEmailSaving(true);
    try {
      const response = await api.put("/admin/email-settings", emailSettings, {
        timeout: 15000,
      });
      setEmailSettings(mergeEmailSettings(response.data || {}));
      setEmailMessage("Email API settings saved.");
      return true;
    } catch (saveEmailError) {
      console.error("Email settings save error:", saveEmailError);
      setEmailError(
        saveEmailError.response?.data?.detail ||
          "Email API settings could not be saved."
      );
      return false;
    } finally {
      setEmailSaving(false);
    }
  };

  const previewEmailTemplate = async () => {
    setEmailError("");
    setEmailPreview(null);
    try {
      const response = await api.post("/admin/email/preview", {
        event_key: emailTemplateKey,
        context: {},
      });
      setEmailPreview(response.data);
    } catch (previewError) {
      console.error("Email preview error:", previewError);
      setEmailError(
        previewError.response?.data?.detail ||
          "Email preview could not be generated."
      );
    }
  };

  const sendEmailTest = async () => {
    setEmailError("");
    setEmailMessage("");
    if (!emailTestRecipient.trim()) {
      setEmailError("Enter a test recipient email.");
      return;
    }
    setEmailTesting(true);
    try {
      const saved = await saveEmailSettings();
      if (!saved) return;
      await api.post(
        "/admin/email/test",
        {
          event_key: emailTemplateKey,
          recipient: emailTestRecipient.trim(),
          context: {},
        },
        { timeout: 60000 }
      );
      setEmailMessage(`Test email sent to ${emailTestRecipient.trim()}.`);
    } catch (testError) {
      console.error("Email test error:", testError);
      setEmailError(
        testError.response?.data?.detail || "Test email could not be sent."
      );
    } finally {
      setEmailTesting(false);
    }
  };

  const downloadDataBackup = async () => {
    setDataError("");
    setDataResult(null);
    setDataBusy("backup");

    try {
      const response = await api.get("/admin/data/backup", {
        responseType: "blob",
        timeout: 300000,
      });
      const filename = getDownloadFilename(
        response.headers,
        `hisbenew-erp-data-backup-${new Date()
          .toISOString()
          .slice(0, 10)}.zip`
      );
      const blob = new Blob([response.data], { type: "application/zip" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setDataResult({
        title: "Backup downloaded",
        detail: `${filename} includes the database, uploaded files, website settings, and email settings.`,
      });
    } catch (backupError) {
      console.error("Data backup error:", backupError);
      setDataError(
        await getApiErrorDetail(
          backupError,
          "ERP data backup could not be downloaded."
        )
      );
    } finally {
      setDataBusy("");
    }
  };

  const restoreDataBackup = async () => {
    setDataError("");
    setDataResult(null);

    if (!backupFile) {
      setDataError("Choose a backup zip file to upload.");
      return;
    }

    const confirmed = await confirmDialog({
      title: "Restore uploaded backup?",
      message:
        "This will replace the current ERP database and uploaded host files with the selected backup.",
      detail: "Download a fresh backup first if you need to keep the current data.",
      tone: "danger",
      confirmText: "Restore backup",
    });
    if (!confirmed) return;

    const formData = new FormData();
    formData.append("file", backupFile);
    formData.append("confirm", "true");

    setDataBusy("restore");
    try {
      const response = await api.post("/admin/data/restore", formData, {
        timeout: 300000,
      });
      const counts = response.data?.counts || {};
      setDataResult({
        title: "Backup restored",
        detail: `Database restored. Uploaded files restored: ${
          counts.uploads_restored ?? 0
        }.`,
      });
      setBackupFile(null);
      setBackupInputKey((current) => current + 1);
    } catch (restoreError) {
      console.error("Data restore error:", restoreError);
      setDataError(
        restoreError.response?.data?.detail ||
          "Uploaded backup could not be restored."
      );
    } finally {
      setDataBusy("");
    }
  };

  const reverseOrderImportBatch = async (batch) => {
    const batchKey = batch?.batch_key;
    const remainingCount = Number(batch?.remaining_count || 0);
    if (!batchKey || remainingCount <= 0 || reversingOrderImportBatch) return;

    const label = batch.filename || batchKey;
    const confirmed = await confirmDialog({
      title: "Reverse CSV import?",
      message: `This will permanently remove ${remainingCount} order${
        remainingCount === 1 ? "" : "s"
      } from ${label}.`,
      detail: "Only orders created by this CSV upload batch will be removed.",
      tone: "danger",
      confirmText: "Reverse import",
      cancelText: "Keep orders",
    });
    if (!confirmed) return;

    setReversingOrderImportBatch(batchKey);
    setOrderImportBatchError("");
    setDataResult(null);

    try {
      const response = await api.delete(
        `/orders/import-batches/${encodeURIComponent(batchKey)}`,
        { timeout: 120000 }
      );
      const removedOrders = Number(response.data?.counts?.orders || 0);
      setDataResult({
        title: "CSV import reversed",
        detail: `Removed ${removedOrders} imported order${
          removedOrders === 1 ? "" : "s"
        } from ${label}.`,
      });
      await fetchOrderImportBatches({ quiet: true });
    } catch (batchError) {
      console.error("Order CSV import reverse error:", batchError);
      setOrderImportBatchError(
        batchError.response?.data?.detail ||
          "Order CSV import batch could not be reversed."
      );
    } finally {
      setReversingOrderImportBatch("");
    }
  };

  const eraseSelectedData = async () => {
    setEraseError("");
    setEraseResult(null);

    if (selectedEraseKeys.length === 0) {
      setEraseError("Choose at least one ERP area to erase.");
      return;
    }

    const confirmed = await confirmDialog({
      title: allEraseSelected ? "Erase all test data?" : "Erase selected data?",
      message: allEraseSelected
        ? "This will remove all selected business data areas and keep admin access available."
        : `This will erase ${selectedEraseKeys.length} selected data area${
            selectedEraseKeys.length === 1 ? "" : "s"
          }.`,
      detail: eraseIncludeFiles
        ? "Referenced uploads and selected host files will also be removed."
        : "Database rows will be removed, but host upload files will be kept.",
      tone: "danger",
      confirmText: "Erase data",
    });
    if (!confirmed) return;

    setEraseRunning(true);
    try {
      const response = await api.post("/admin/data-erase", {
        keys: selectedEraseKeys,
        include_files: eraseIncludeFiles,
        confirm: true,
      });
      setEraseResult(response.data);
      setMessage("Selected ERP data erased successfully.");
      setSelectedEraseKeys([]);
      await fetchOrderImportBatches({ quiet: true });
    } catch (eraseRequestError) {
      console.error("Data erase error:", eraseRequestError);
      setEraseError(
        eraseRequestError.response?.data?.detail ||
          "Selected ERP data could not be erased."
      );
    } finally {
      setEraseRunning(false);
    }
  };

  return (
    <div className="users-page settings-page">
      <header className="users-header settings-page-header">
        <div>
          <h1>Account settings</h1>
          <p>Your profile, app access, connection status, and admin data tools.</p>
        </div>
      </header>

      <nav className="settings-tabs" aria-label="Account settings sections">
        {settingsTabs.map((tab) => (
          <button
            aria-current={activeSettingsTab === tab.key ? "page" : undefined}
            className={activeSettingsTab === tab.key ? "is-active" : ""}
            key={tab.key}
            onClick={() => setActiveSettingsTab(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {isAdmin && activeSettingsTab === "calling" && (
        <section className="settings-call-panel settings-card">
          <div className="settings-panel-heading">
            <div>
              <span className="users-eyebrow">Calling</span>
              <h2>Video calling</h2>
              <p>
                Control whether ERP users can start camera video calls. This
                setting applies to Messages on PC and mobile.
              </p>
            </div>
            <label className="settings-switch">
              <input
                checked={Boolean(callSettings.video_calls_enabled)}
                disabled={callSettingsLoading || callSettingsSaving}
                onChange={(event) =>
                  updateVideoCallsEnabled(event.target.checked)
                }
                type="checkbox"
              />
              <span>
                {callSettingsSaving
                  ? "Saving..."
                  : callSettings.video_calls_enabled
                    ? "Enabled"
                    : "Disabled"}
              </span>
            </label>
          </div>

          <div className="settings-call-feature-grid">
            <article>
              <strong>Camera video calls</strong>
              <p>
                {callSettings.video_calls_enabled
                  ? "Users can start video calls and turn their cameras on during calls."
                  : "The Video button and camera controls are hidden for all users."}
              </p>
            </article>
            <article className="is-always-on">
              <strong>Voice calls and screen sharing</strong>
              <p>
                Always available. Users can share their screens inside an audio
                call even when camera video is disabled.
              </p>
            </article>
          </div>

          {callSettingsLoading && (
            <p className="settings-switch-note">Loading call settings...</p>
          )}
          {callSettingsMessage && (
            <p className="settings-call-message" role="status">
              {callSettingsMessage}
            </p>
          )}
          {callSettingsError && (
            <p className="settings-sync-error" role="alert">
              {callSettingsError}
            </p>
          )}
        </section>
      )}

      {isAdmin && activeSettingsTab === "emails" && (
        <section className="settings-email-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="users-eyebrow">Email APIs</span>
              <h2>Email automation</h2>
              <p>
                Connect SMTP or email APIs, choose ERP events, and control the
                message templates used for worker and order notifications.
              </p>
            </div>
            <label className="settings-switch">
              <input
                checked={Boolean(emailSettings.enabled)}
                onChange={(event) =>
                  updateEmailSetting("enabled", event.target.checked)
                }
                type="checkbox"
              />
              <span>{emailSettings.enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </div>

          {emailLoading ? (
            <p className="settings-erase-note">Loading email settings...</p>
          ) : (
            <>
              <div className="settings-email-grid">
                <article className="settings-email-card">
                  <h3>Sender</h3>
                  <div className="settings-form-grid">
                    <label>
                      Provider
                      <select
                        value={emailSettings.provider}
                        onChange={(event) =>
                          updateEmailSetting("provider", event.target.value)
                        }
                      >
                        <option value="smtp">SMTP</option>
                        <option value="resend">Resend API</option>
                        <option value="webhook">Custom webhook API</option>
                      </select>
                    </label>
                    <label>
                      From name
                      <input
                        value={emailSettings.from_name}
                        onChange={(event) =>
                          updateEmailSetting("from_name", event.target.value)
                        }
                        placeholder="Hisbenew ERP"
                      />
                    </label>
                    <label>
                      From email
                      <input
                        type="email"
                        value={emailSettings.from_email}
                        onChange={(event) =>
                          updateEmailSetting("from_email", event.target.value)
                        }
                        placeholder="erp@yourdomain.com"
                      />
                    </label>
                    <label>
                      Reply-to
                      <input
                        type="email"
                        value={emailSettings.reply_to}
                        onChange={(event) =>
                          updateEmailSetting("reply_to", event.target.value)
                        }
                        placeholder="Optional reply email"
                      />
                    </label>
                  </div>
                </article>

                <article className="settings-email-card">
                  <h3>
                    {emailSettings.provider === "smtp"
                      ? "SMTP connection"
                      : "API connection"}
                  </h3>
                  {emailSettings.provider === "smtp" ? (
                    <div className="settings-form-grid">
                      <label>
                        SMTP host
                        <input
                          value={emailSettings.smtp.host}
                          onChange={(event) =>
                            updateEmailGroup("smtp", "host", event.target.value)
                          }
                          placeholder="smtp.gmail.com"
                        />
                      </label>
                      <label>
                        Port
                        <input
                          min="1"
                          type="number"
                          value={emailSettings.smtp.port}
                          onChange={(event) =>
                            updateEmailGroup("smtp", "port", Number(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        Username
                        <input
                          value={emailSettings.smtp.username}
                          onChange={(event) =>
                            updateEmailGroup("smtp", "username", event.target.value)
                          }
                          placeholder="SMTP username"
                        />
                      </label>
                      <label>
                        Password / app password
                        <input
                          type="password"
                          value={emailSettings.smtp.password}
                          onChange={(event) =>
                            updateEmailGroup("smtp", "password", event.target.value)
                          }
                          placeholder="SMTP password"
                        />
                      </label>
                      <label className="settings-check-row">
                        <input
                          checked={Boolean(emailSettings.smtp.use_tls)}
                          onChange={(event) =>
                            updateEmailGroup("smtp", "use_tls", event.target.checked)
                          }
                          type="checkbox"
                        />
                        Use STARTTLS
                      </label>
                      <label className="settings-check-row">
                        <input
                          checked={Boolean(emailSettings.smtp.use_ssl)}
                          onChange={(event) =>
                            updateEmailGroup("smtp", "use_ssl", event.target.checked)
                          }
                          type="checkbox"
                        />
                        Use SSL
                      </label>
                    </div>
                  ) : (
                    <div className="settings-form-grid">
                      <label>
                        API key
                        <input
                          type="password"
                          value={emailSettings.api.api_key}
                          onChange={(event) =>
                            updateEmailGroup("api", "api_key", event.target.value)
                          }
                          placeholder={
                            emailSettings.provider === "resend"
                              ? "Resend API key"
                              : "Optional API key"
                          }
                        />
                      </label>
                      {emailSettings.provider === "webhook" && (
                        <>
                          <label>
                            Endpoint URL
                            <input
                              value={emailSettings.api.endpoint}
                              onChange={(event) =>
                                updateEmailGroup("api", "endpoint", event.target.value)
                              }
                              placeholder="https://email-api.example.com/send"
                            />
                          </label>
                          <label>
                            Bearer token
                            <input
                              type="password"
                              value={emailSettings.api.bearer_token}
                              onChange={(event) =>
                                updateEmailGroup("api", "bearer_token", event.target.value)
                              }
                              placeholder="Optional webhook token"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </article>
              </div>

              <div className="settings-email-card">
                <div className="settings-card-heading-row">
                  <div>
                    <h3>Events and recipients</h3>
                    <p>Choose when ERP sends emails and who receives them.</p>
                  </div>
                  <label>
                    Admin recipients
                    <input
                      value={emailSettings.admin_recipients}
                      onChange={(event) =>
                        updateEmailSetting("admin_recipients", event.target.value)
                      }
                      placeholder="admin@example.com, manager@example.com"
                    />
                  </label>
                </div>

                <div className="settings-event-grid">
                  {EMAIL_EVENTS.map((event) => {
                    const config = emailSettings.events[event.key];
                    return (
                      <article
                        className={`settings-event-card ${
                          config.enabled ? "is-enabled" : ""
                        }`}
                        key={event.key}
                      >
                        <label className="settings-check-row">
                          <input
                            checked={Boolean(config.enabled)}
                            onChange={(changeEvent) =>
                              updateEmailEvent(
                                event.key,
                                "enabled",
                                changeEvent.target.checked
                              )
                            }
                            type="checkbox"
                          />
                          <strong>{config.label || event.label}</strong>
                        </label>
                        <select
                          value={config.recipients}
                          onChange={(changeEvent) =>
                            updateEmailEvent(
                              event.key,
                              "recipients",
                              changeEvent.target.value
                            )
                          }
                        >
                          <option value="worker">Assigned worker</option>
                          <option value="admins">Admins only</option>
                          <option value="both">Worker and admins</option>
                          <option value="custom">Custom recipients</option>
                        </select>
                        {config.recipients === "custom" && (
                          <input
                            value={config.custom_recipients || ""}
                            onChange={(changeEvent) =>
                              updateEmailEvent(
                                event.key,
                                "custom_recipients",
                                changeEvent.target.value
                              )
                            }
                            placeholder="custom@example.com"
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="settings-email-editor">
                <article className="settings-email-card">
                  <div className="settings-card-heading-row">
                    <div>
                      <h3>Template editor</h3>
                      <p>
                        Tokens: {"{{worker_name}}"}, {"{{task_name}}"},{" "}
                        {"{{product_name}}"}, {"{{quantity}}"}, {"{{due_date}}"},{" "}
                        {"{{order_no}}"}.
                      </p>
                    </div>
                    <label>
                      Template
                      <select
                        value={emailTemplateKey}
                        onChange={(event) => setEmailTemplateKey(event.target.value)}
                      >
                        {EMAIL_EVENTS.map((event) => (
                          <option key={event.key} value={event.key}>
                            {event.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="settings-form-grid">
                    <label className="settings-wide-field">
                      Subject
                      <input
                        value={selectedEmailEvent.subject || ""}
                        onChange={(event) =>
                          updateEmailEvent(
                            emailTemplateKey,
                            "subject",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <label>
                      Preheader
                      <input
                        value={selectedEmailEvent.preheader || ""}
                        onChange={(event) =>
                          updateEmailEvent(
                            emailTemplateKey,
                            "preheader",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <label>
                      Heading
                      <input
                        value={selectedEmailEvent.heading || ""}
                        onChange={(event) =>
                          updateEmailEvent(
                            emailTemplateKey,
                            "heading",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <label className="settings-wide-field">
                      Email body
                      <textarea
                        rows={9}
                        value={selectedEmailEvent.body || ""}
                        onChange={(event) =>
                          updateEmailEvent(
                            emailTemplateKey,
                            "body",
                            event.target.value
                          )
                        }
                      />
                    </label>
                  </div>
                </article>

                <article className="settings-email-card">
                  <h3>Style and test</h3>
                  <div className="settings-form-grid">
                    <label>
                      Accent color
                      <input
                        type="color"
                        value={emailSettings.style.accent_color}
                        onChange={(event) =>
                          updateEmailGroup("style", "accent_color", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Button URL
                      <input
                        value={emailSettings.style.button_url}
                        onChange={(event) =>
                          updateEmailGroup("style", "button_url", event.target.value)
                        }
                        placeholder={portalUrl}
                      />
                    </label>
                    <label>
                      Button label
                      <input
                        value={emailSettings.style.button_label}
                        onChange={(event) =>
                          updateEmailGroup("style", "button_label", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Test recipient
                      <input
                        type="email"
                        value={emailTestRecipient}
                        onChange={(event) => setEmailTestRecipient(event.target.value)}
                        placeholder="you@example.com"
                      />
                    </label>
                    <label className="settings-wide-field">
                      Footer text
                      <textarea
                        rows={3}
                        value={emailSettings.style.footer_text}
                        onChange={(event) =>
                          updateEmailGroup("style", "footer_text", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-email-actions">
                    <button
                      className="settings-secondary-action"
                      onClick={previewEmailTemplate}
                      type="button"
                    >
                      Preview
                    </button>
                    <button
                      className="settings-secondary-action"
                      disabled={emailSaving}
                      onClick={saveEmailSettings}
                      type="button"
                    >
                      {emailSaving ? "Saving..." : "Save settings"}
                    </button>
                    <button
                      className="settings-primary-action settings-test-email-button"
                      disabled={emailTesting}
                      onClick={sendEmailTest}
                      type="button"
                    >
                      {emailTesting ? "Sending..." : "Send test"}
                    </button>
                  </div>
                </article>
              </div>

              {emailError && <p className="settings-sync-error">{emailError}</p>}
              {emailMessage && <p className="users-success">{emailMessage}</p>}
              {emailPreview && (
                <div className="settings-email-preview">
                  <div>
                    <span>Preview subject</span>
                    <strong>{emailPreview.subject}</strong>
                  </div>
                  <iframe
                    title="Email preview"
                    srcDoc={emailPreview.html}
                    sandbox=""
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {activeSettingsTab === "install" && (
        <section className="settings-install-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="users-eyebrow">Install app</span>
              <h2>Android and PC access</h2>
            </div>
            <span
              className={`settings-status-pill ${
                installReadiness === "HTTPS required"
                  ? "is-warning"
                  : connection.serverOnline
                    ? "is-online"
                    : "is-offline"
              }`}
            >
              {installReadiness}
            </span>
          </div>

          <div className="settings-install-grid">
            <article className="settings-platform-tile">
              <div className="settings-tile-head">
                <span className="settings-device-mark">A</span>
                <div>
                  <h3>Android app</h3>
                  <p>{accessModeLabel}</p>
                </div>
              </div>
              <button
                type="button"
                className="settings-primary-action"
                onClick={shareAndroidLink}
              >
                {copiedTarget === "android" ? "Copied" : "Share Android link"}
              </button>
            </article>

            <article className="settings-platform-tile">
              <div className="settings-tile-head">
                <span className="settings-device-mark">PC</span>
                <div>
                  <h3>PC app</h3>
                  <p>{accessModeLabel}</p>
                </div>
              </div>
              <button
                type="button"
                className="settings-primary-action"
                onClick={downloadPcShortcut}
              >
                Download PC shortcut
              </button>
            </article>

            <article className="settings-platform-tile">
              <div className="settings-tile-head">
                <span className="settings-device-mark">APP</span>
                <div>
                  <h3>This device</h3>
                  <p>
                    {installReadiness === "HTTPS required"
                      ? "Copy link now, install after HTTPS is enabled."
                      : installReadiness}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="settings-primary-action"
                onClick={installCurrentDevice}
                disabled={installState === "installed"}
              >
                {copiedTarget === "install" ? "Copied" : installButtonLabel}
              </button>
            </article>
          </div>

          {installReadiness === "HTTPS required" && (
            <p className="settings-install-note">
              Android and PC browsers require HTTPS for a real installed PWA.
              This LAN link can still be opened or saved as a shortcut.
            </p>
          )}
        </section>
      )}

      {activeSettingsTab === "sync" && (
        <section className="settings-sync-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="users-eyebrow">Remote sync</span>
              <h2>Connection status</h2>
            </div>
            <button
              type="button"
              className="settings-secondary-action"
              onClick={() => refreshAppConnection()}
              disabled={syncing}
            >
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          </div>

          <div className="settings-sync-grid">
            <div>
              <span>Browser</span>
              <strong>{connection.browserOnline ? "Online" : "Offline"}</strong>
            </div>
            <div>
              <span>Server</span>
              <strong>{connection.serverOnline ? "Connected" : "Not connected"}</strong>
            </div>
            <div>
              <span>Access mode</span>
              <strong>{accessModeLabel}</strong>
            </div>
            <div>
              <span>Wi-Fi change</span>
              <strong>{wifiChangeLabel}</strong>
            </div>
            <div>
              <span>Last sync</span>
              <strong>{formatDateTime(connection.lastSyncAt)}</strong>
            </div>
          </div>

          {accessMode !== "remote" && (
            <p className="settings-switch-note">
              When laptop Wi-Fi changes, old mobile links cannot auto-switch
              after they stop loading. Open or copy the current mobile link
              below.
            </p>
          )}

          <div className="settings-link-row">
            <label>
              Current mobile link
              <input value={portalUrl} readOnly />
            </label>
            <button
              type="button"
              className="settings-secondary-action"
              onClick={() =>
                copyText(portalUrl, "portal", "Current mobile link copied.")
              }
            >
              {copiedTarget === "portal" ? "Copied" : "Copy link"}
            </button>
          </div>

          <div className="settings-link-row">
            <label>
              API server
              <input value={apiUrl} readOnly />
            </label>
            <button
              type="button"
              className="settings-secondary-action"
              onClick={() => copyText(apiUrl, "api", "API server link copied.")}
            >
              {copiedTarget === "api" ? "Copied" : "Copy API"}
            </button>
          </div>

          {connection.error && (
            <p className="settings-sync-error">{connection.error}</p>
          )}
        </section>
      )}

      {isAdmin && activeSettingsTab === "data" && (
        <section className="settings-danger-panel settings-data-panel">
          <div className="settings-panel-heading">
            <div>
              <span className="users-eyebrow">Admin data</span>
              <h2>Data</h2>
              <p>Back up, restore, or erase ERP test data from this host.</p>
            </div>
            <span className="settings-danger-pill">Admin only</span>
          </div>

          <div className="settings-data-actions">
            <article className="settings-data-card">
              <div>
                <h3>Take backup and download</h3>
                <p>
                  Download one zip with the database, uploaded files, and website
                  settings before you erase or restore anything.
                </p>
              </div>
              <button
                className="settings-secondary-action"
                disabled={Boolean(dataBusy)}
                onClick={downloadDataBackup}
                type="button"
              >
                {dataBusy === "backup" ? "Preparing..." : "Download backup"}
              </button>
            </article>

            <article className="settings-data-card">
              <div>
                <h3>Upload backup</h3>
                <p>
                  Restore a downloaded backup zip. Current data and uploaded host
                  files will be replaced.
                </p>
              </div>
              <label className="settings-upload-drop">
                <input
                  accept=".zip,application/zip"
                  disabled={dataBusy === "restore"}
                  key={backupInputKey}
                  onChange={(event) =>
                    setBackupFile(event.target.files?.[0] || null)
                  }
                  type="file"
                />
                <span>{backupFile?.name || "Choose backup zip"}</span>
              </label>
              <button
                className="settings-danger-action settings-restore-action"
                disabled={Boolean(dataBusy) || !backupFile}
                onClick={restoreDataBackup}
                type="button"
              >
                {dataBusy === "restore" ? "Restoring..." : "Upload and restore"}
              </button>
            </article>
          </div>

          {dataError && <p className="settings-sync-error">{dataError}</p>}
          {dataResult && (
            <div className="settings-erase-result">
              <strong>{dataResult.title}</strong>
              <span>{dataResult.detail}</span>
            </div>
          )}

          <div className="settings-data-divider" />

          <section className="settings-import-batches">
            <div className="settings-panel-heading settings-import-heading">
              <div>
                <span className="users-eyebrow">Order uploads</span>
                <h2>Order CSV imports</h2>
                <p>
                  Reverse dummy order uploads from testing without touching manually
                  created orders.
                </p>
              </div>
              <button
                className="settings-secondary-action"
                disabled={orderImportBatchesLoading}
                onClick={() => fetchOrderImportBatches()}
                type="button"
              >
                {orderImportBatchesLoading ? "Refreshing..." : "Refresh imports"}
              </button>
            </div>

            {orderImportBatchError && (
              <p className="settings-sync-error">{orderImportBatchError}</p>
            )}

            {orderImportBatchesLoading && orderImportBatches.length === 0 && (
              <p className="settings-erase-note">Loading CSV import history...</p>
            )}

            {!orderImportBatchesLoading && orderImportBatches.length === 0 && (
              <p className="settings-erase-note">
                No CSV order imports have been recorded yet.
              </p>
            )}

            {orderImportBatches.length > 0 && (
              <div className="settings-import-batch-list">
                {orderImportBatches.map((batch) => {
                  const activeCount = Number(batch.remaining_count || 0);
                  const importedCount = Number(batch.imported_count || 0);
                  const reversedCount = Number(batch.reversed_count || 0);
                  const isReversing =
                    reversingOrderImportBatch === batch.batch_key;
                  const isActive = activeCount > 0;

                  return (
                    <article
                      className="settings-import-batch-card"
                      key={batch.batch_key}
                    >
                      <div className="settings-import-batch-main">
                        <strong>{batch.filename || batch.batch_key}</strong>
                        <span>
                          {activeCount} active of {importedCount || activeCount} imported
                          {reversedCount > 0 ? ` / ${reversedCount} reversed` : ""}
                        </span>
                      </div>
                      <div className="settings-import-batch-meta">
                        <span>{batch.source_format || "CSV"}</span>
                        <span>{formatDateTime(batch.created_at)}</span>
                        {batch.created_by_name && <span>{batch.created_by_name}</span>}
                        <span
                          className={`settings-import-status ${
                            isActive ? "is-active" : "is-reversed"
                          }`}
                        >
                          {isActive ? "Active" : "Reversed"}
                        </span>
                      </div>
                      <button
                        className="settings-import-reverse"
                        disabled={!isActive || isReversing}
                        onClick={() => reverseOrderImportBatch(batch)}
                        type="button"
                      >
                        {isReversing
                          ? "Reversing..."
                          : isActive
                            ? "Reverse import"
                            : "Already reversed"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className="settings-data-divider" />

          <div className="settings-panel-heading settings-erase-heading">
            <div>
              <span className="users-eyebrow">Erase</span>
              <h2>Erase test data</h2>
              <p>
                Remove fake records after testing. Admin users, the database
                file, and ERP app files are preserved so you can sign back in.
              </p>
            </div>
          </div>

          <div className="settings-erase-toolbar">
            <button
              className="settings-secondary-action"
              disabled={eraseLoading || eraseRunning || eraseOptions.length === 0}
              onClick={toggleAllEraseKeys}
              type="button"
            >
              {allEraseSelected ? "Clear selection" : "Select all areas"}
            </button>
            <label className="settings-erase-files">
              <input
                checked={eraseIncludeFiles}
                disabled={eraseRunning}
                onChange={(event) => setEraseIncludeFiles(event.target.checked)}
                type="checkbox"
              />
              Remove related host files
            </label>
          </div>

          <div className="settings-erase-grid">
            {eraseOptions.map((option) => (
              <label
                className={`settings-erase-option ${
                  selectedEraseKeys.includes(option.key) ? "is-selected" : ""
                }`}
                key={option.key}
              >
                <input
                  checked={selectedEraseKeys.includes(option.key)}
                  disabled={eraseRunning}
                  onChange={() => toggleEraseKey(option.key)}
                  type="checkbox"
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                  <em>{(option.pages || []).join(", ")}</em>
                </span>
              </label>
            ))}
          </div>

          {eraseLoading && <p className="settings-erase-note">Loading erase areas...</p>}
          {eraseError && <p className="settings-sync-error">{eraseError}</p>}
          {eraseResult?.counts && (
            <div className="settings-erase-result">
              <strong>Erase complete</strong>
              <span>
                {Object.entries(eraseResult.counts)
                  .map(([key, count]) => `${key.replaceAll("_", " ")}: ${count}`)
                  .join(" / ") || "No matching records found"}
              </span>
            </div>
          )}

          <button
            className="settings-danger-action"
            disabled={eraseRunning || selectedEraseKeys.length === 0}
            onClick={eraseSelectedData}
            type="button"
          >
            {eraseRunning ? "Erasing..." : "Erase selected data"}
          </button>
        </section>
      )}

      {activeSettingsTab === "profile" && (
        <section className="settings-card">
          <div className="settings-panel-heading settings-profile-heading">
            <div>
              <h2>Profile information</h2>
              <p>Update your account name, sign-in username, and PIN.</p>
            </div>
          </div>

          <form className="users-form settings-form" onSubmit={handleSubmit}>
            <label>
              Full name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your full name"
              />
            </label>

            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={name.trim() || "Uses full name if blank"}
              />
              <small className="users-hint">
                Used to sign in. Leave blank to use your full name.
              </small>
            </label>

            <label>
              New PIN
              <input
                type="password"
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, ""))
                }
                maxLength={4}
                placeholder="Leave blank to keep current PIN"
              />
              <small className="users-hint">
                Enter a new 4-digit PIN only when you want to change it.
              </small>
            </label>

            <div className="users-form-actions">
              <button
                type="submit"
                className="users-submit-button"
                disabled={loading}
              >
                {loading ? "Saving..." : "Save changes"}
              </button>
            </div>

            {message && <p className="users-success">{message}</p>}
            {error && <p className="users-error">{error}</p>}
          </form>
        </section>
      )}
    </div>
  );
}

export default Settings;
