import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, apiFetch, getStaticUrl } from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./Dashboard.css";

const AMAZON_SALE_JOBS_STORAGE_KEY = "erpAmazonSaleNotificationJobsV1";
const AMAZON_ORDER_SYNC_INTERVAL_MS = 2 * 60 * 1000;

let amazonSaleAudioContext = null;
const amazonSaleActiveOscillators = new Set();

const getAmazonSaleAudioContext = () => {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!amazonSaleAudioContext) {
    amazonSaleAudioContext = new AudioContextClass();
  }
  return amazonSaleAudioContext;
};

const primeAmazonSaleAudio = () => {
  const audioContext = getAmazonSaleAudioContext();
  if (audioContext?.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
};

const playAmazonSaleRingtone = async () => {
  const audioContext = getAmazonSaleAudioContext();
  if (!audioContext) return false;

  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    if (audioContext.state !== "running") return false;

    const startAt = audioContext.currentTime + 0.03;
    [
      [659.25, 0, 0.16],
      [783.99, 0.18, 0.16],
      [987.77, 0.36, 0.22],
      [783.99, 0.64, 0.13],
      [987.77, 0.8, 0.3],
    ].forEach(([frequency, offset, duration]) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const noteStart = startAt + offset;
      const noteEnd = noteStart + duration;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.22, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      amazonSaleActiveOscillators.add(oscillator);
      oscillator.onended = () => {
        amazonSaleActiveOscillators.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    });
    return true;
  } catch {
    return false;
  }
};

const stopAmazonSaleRingtone = () => {
  amazonSaleActiveOscillators.forEach((oscillator) => {
    try {
      oscillator.stop();
    } catch {
      // The note already ended.
    }
  });
  amazonSaleActiveOscillators.clear();
  window.navigator.vibrate?.(0);
};

const waitFor = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const formatAmount = (value, currency = "PKR") =>
  `${currency} ${Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  })}`;

const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const formatNumber = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  });

const formatUsd = (value) =>
  `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;

const formatCurrency = (value, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch {
    return `${currency || "USD"} ${Number(value || 0).toFixed(2)}`;
  }
};

const formatCompactAmount = (value) =>
  `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(Number(value || 0))}`;

const normalizeSalesSeries = (entries) => {
  const byDate = new Map(
    (Array.isArray(entries) ? entries : []).map((entry) => [
      String(entry?.date || ""),
      {
        date: String(entry?.date || ""),
        orderCount: Math.max(0, Number(entry?.order_count || 0)),
        salesAmount: Math.max(0, Number(entry?.sales_amount || 0)),
        erpOrderCount: Math.max(0, Number(entry?.erp_order_count || 0)),
        amazonOrderCount: Math.max(0, Number(entry?.amazon_order_count || 0)),
        erpSalesAmount: Math.max(0, Number(entry?.erp_sales_amount || 0)),
        amazonSalesAmount: Math.max(
          0,
          Number(entry?.amazon_sales_amount || 0)
        ),
        platformSales: (Array.isArray(entry?.platform_sales)
          ? entry.platform_sales
          : []
        )
          .map((platform) => ({
            name: String(platform?.platform || "").trim(),
            orderCount: Math.max(0, Number(platform?.order_count || 0)),
            salesAmount: Math.max(0, Number(platform?.sales_amount || 0)),
          }))
          .filter((platform) => platform.name && platform.salesAmount > 0),
      },
    ])
  );

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const dateKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    return (
      byDate.get(dateKey) || {
        date: dateKey,
        orderCount: 0,
        salesAmount: 0,
        erpOrderCount: 0,
        amazonOrderCount: 0,
        erpSalesAmount: 0,
        amazonSalesAmount: 0,
        platformSales: [],
      }
    );
  });
};

function SevenDaySalesChart({ data }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const width = 760;
  const height = 260;
  const padding = { top: 24, right: 20, bottom: 42, left: 70 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.map((item) => item.salesAmount), 1);
  const xStep = plotWidth / Math.max(data.length - 1, 1);
  const points = data.map((item, index) => ({
    ...item,
    x: padding.left + index * xStep,
    y: padding.top + plotHeight - (item.salesAmount / maxValue) * plotHeight,
  }));
  const linePath = points
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${points.at(-1).x} ${
    padding.top + plotHeight
  } L ${points[0].x} ${padding.top + plotHeight} Z`;
  const hoveredPoint =
    hoveredIndex === null ? null : points[hoveredIndex] || null;
  const hoveredPlatforms = hoveredPoint?.platformSales || [];
  const tooltipWidth = 190;
  const tooltipHeight = hoveredPlatforms.length
    ? 75 + hoveredPlatforms.length * 21
    : 64;
  const tooltipX = hoveredPoint
    ? Math.min(
        width - tooltipWidth - 8,
        Math.max(8, hoveredPoint.x - tooltipWidth / 2)
      )
    : 0;
  const tooltipY = hoveredPoint
    ? hoveredPoint.y > tooltipHeight + 18
      ? hoveredPoint.y - tooltipHeight - 14
      : hoveredPoint.y + 15
    : 0;

  return (
    <div className="dashboard-focus-chart-wrap">
      <svg
        aria-label="Sales totals for each of the last seven days"
        className="dashboard-focus-chart"
        onMouseLeave={() => setHoveredIndex(null)}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id="dashboardSalesArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5b5bd6" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#5b5bd6" stopOpacity="0.015" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + plotHeight * ratio;
          const value = maxValue * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                className="dashboard-focus-chart-grid"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text
                className="dashboard-focus-chart-y-label"
                x={padding.left - 12}
                y={y + 4}
              >
                {formatCompactAmount(value)}
              </text>
            </g>
          );
        })}

        <path className="dashboard-focus-chart-area" d={areaPath} />
        <path className="dashboard-focus-chart-line" d={linePath} />

        {points.map((point, index) => (
          <g key={point.date}>
            <circle
              className={`dashboard-focus-chart-point ${
                hoveredIndex === index ? "is-active" : ""
              }`}
              cx={point.x}
              cy={point.y}
              r="5"
            >
              <title>
                {`${new Date(`${point.date}T00:00:00`).toLocaleDateString(
                  "en-PK",
                  { day: "numeric", month: "short" }
                )}: ${formatUsd(point.salesAmount)} from ${pluralize(
                  point.orderCount,
                  "order"
                )}`}
              </title>
            </circle>
            <circle
              aria-label={`${new Date(`${point.date}T00:00:00`).toLocaleDateString(
                "en-US",
                { day: "numeric", month: "long", year: "numeric" }
              )}, ${formatUsd(point.salesAmount)}`}
              className="dashboard-focus-chart-hit"
              cx={point.x}
              cy={point.y}
              onBlur={() => setHoveredIndex(null)}
              onClick={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onMouseEnter={() => setHoveredIndex(index)}
              r="16"
              role="button"
              tabIndex={0}
            />
            <text
              className="dashboard-focus-chart-x-label"
              x={point.x}
              y={height - 13}
            >
              {new Date(`${point.date}T00:00:00`).toLocaleDateString("en-PK", {
                weekday: "short",
              })}
            </text>
          </g>
        ))}

        {hoveredPoint && (
          <g
            className="dashboard-focus-chart-tooltip"
            transform={`translate(${tooltipX} ${tooltipY})`}
          >
            <rect height={tooltipHeight} rx="7" width={tooltipWidth} />
            <text className="dashboard-focus-tooltip-date" x="13" y="23">
              {new Date(`${hoveredPoint.date}T00:00:00`).toLocaleDateString(
                "en-US",
                { day: "numeric", month: "short", year: "numeric" }
              )}
            </text>
            <text className="dashboard-focus-tooltip-value" x="13" y="50">
              {formatUsd(hoveredPoint.salesAmount)}
            </text>
            {hoveredPlatforms.length > 0 && (
              <>
                <line
                  className="dashboard-focus-tooltip-divider"
                  x1="13"
                  x2={tooltipWidth - 13}
                  y1="64"
                  y2="64"
                />
                {hoveredPlatforms.map((platform, index) => {
                  const rowY = 84 + index * 21;
                  return (
                    <g key={platform.name}>
                      <text
                        className="dashboard-focus-tooltip-platform"
                        x="13"
                        y={rowY}
                      >
                        {platform.name}
                      </text>
                      <text
                        className="dashboard-focus-tooltip-platform-value"
                        textAnchor="end"
                        x={tooltipWidth - 13}
                        y={rowY}
                      >
                        {formatUsd(platform.salesAmount)}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

const MOBILE_DASHBOARD_QUERY =
  "(max-width: 900px), (pointer: coarse) and (max-width: 1180px)";

const useMobileDashboardLayout = () => {
  const [isMobile, setIsMobile] = useState(() =>
    window.matchMedia(MOBILE_DASHBOARD_QUERY).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_DASHBOARD_QUERY);
    const updateLayout = () => setIsMobile(mediaQuery.matches);
    updateLayout();
    if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", updateLayout);
    else mediaQuery.addListener?.(updateLayout);
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", updateLayout);
      } else {
        mediaQuery.removeListener?.(updateLayout);
      }
    };
  }, []);

  return isMobile;
};

const isFulfillmentShipped = (order) =>
  String(order?.status || "").trim().toLowerCase() === "shipped";

const fulfillmentOrderReadiness = (order) => {
  const shortageQuantity = (order?.pick_plan || []).reduce(
    (total, item) => total + Number(item.shortage_quantity || 0),
    0
  );
  const hasLabel = Boolean(order?.label_file_url);
  return {
    shortageQuantity,
    hasLabel,
    state: shortageQuantity > 0 ? "shortage" : hasLabel ? "ready" : "label",
  };
};

const getFulfillmentOrderBoxCount = (order) => {
  const boxKeys = new Set();
  (order?.pick_plan || []).forEach((line) => {
    (line?.picks || []).forEach((pick) => {
      const key = pick?.box_id || pick?.box_number || pick?.box_item_id;
      if (key) boxKeys.add(String(key));
    });
  });
  return boxKeys.size;
};

function UnassignedDashboard({ userName, userEmail, userPhone }) {
  const [showContactForm, setShowContactForm] = useState(false);
  const [requestForm, setRequestForm] = useState({
    requested_role: "",
    contact_phone: userPhone || "",
    contact_email: userEmail || "",
    message: "",
  });
  const [requestSaving, setRequestSaving] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestError, setRequestError] = useState("");

  const submitRoleRequest = async (event) => {
    event.preventDefault();
    setRequestMessage("");
    setRequestError("");
    setRequestSaving(true);

    try {
      const response = await apiFetch(`${API_BASE_URL}/role-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestForm),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Request could not be submitted.");
      }

      setRequestMessage("Your message has been sent to the admin team.");
      setShowContactForm(false);
      setRequestForm((current) => ({ ...current, message: "" }));
    } catch (error) {
      setRequestError(error.message || "Request could not be submitted.");
    } finally {
      setRequestSaving(false);
    }
  };

  return (
    <div className="dashboard-page">
      <section className="dashboard-role-waiting">
        <div className="dashboard-role-card">
          <span className="dashboard-role-eyebrow">Account setup</span>
          <h1>Hi {userName || "there"}, welcome to Hisbenew ERP.</h1>
          <p>
            We are working to assign your role. Once an admin gives you access,
            your ERP pages will appear here automatically.
          </p>
          <div className="dashboard-role-steps">
            <span>
              <strong>1</strong>
              Account created
            </span>
            <span>
              <strong>2</strong>
              Role pending
            </span>
            <span>
              <strong>3</strong>
              Access opens
            </span>
          </div>
          {requestMessage && (
            <div className="dashboard-role-notice is-success">{requestMessage}</div>
          )}
          {requestError && (
            <div className="dashboard-role-notice is-error">{requestError}</div>
          )}
          <button
            className="dashboard-role-contact"
            onClick={() => setShowContactForm(true)}
            type="button"
          >
            Contact admin
          </button>
        </div>
      </section>

      {showContactForm && (
        <div
          className="dashboard-role-modal-overlay"
          onClick={() => setShowContactForm(false)}
        >
          <form
            className="dashboard-role-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitRoleRequest}
          >
            <div className="dashboard-role-modal-header">
              <div>
                <span>Access request</span>
                <h2>Contact admin</h2>
              </div>
              <button
                aria-label="Close contact form"
                onClick={() => setShowContactForm(false)}
                type="button"
              >
                x
              </button>
            </div>

            <label>
              Requested role or page
              <input
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    requested_role: event.target.value,
                  }))
                }
                placeholder="Example: Worker, Orders, Production"
                value={requestForm.requested_role}
              />
            </label>
            <label>
              Phone
              <input
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    contact_phone: event.target.value,
                  }))
                }
                placeholder="Optional phone"
                value={requestForm.contact_phone}
              />
            </label>
            <label>
              Email
              <input
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    contact_email: event.target.value,
                  }))
                }
                placeholder="Optional email"
                type="email"
                value={requestForm.contact_email}
              />
            </label>
            <label className="dashboard-role-wide">
              Message
              <textarea
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    message: event.target.value,
                  }))
                }
                placeholder="Tell admin what access you need."
                rows={4}
                value={requestForm.message}
              />
            </label>

            <div className="dashboard-role-modal-actions">
              <button
                className="dashboard-role-secondary"
                onClick={() => setShowContactForm(false)}
                type="button"
              >
                Cancel
              </button>
              <button className="dashboard-role-primary" disabled={requestSaving} type="submit">
                {requestSaving ? "Sending..." : "Send request"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function OperationalDashboard({ userRole, workerId, userName }) {
  const isMobileDashboard = useMobileDashboardLayout();
  const [stats, setStats] = useState(null);
  const [fulfillmentData, setFulfillmentData] = useState(null);
  const [orderTasks, setOrderTasks] = useState([]);
  const [workerPayoutData, setWorkerPayoutData] = useState({
    tasks: [],
    orderTasks: [],
    payments: [],
  });
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState(false);
  const [amazonSyncing, setAmazonSyncing] = useState(["admin", "super_admin"].includes(userRole));
  const [amazonSyncError, setAmazonSyncError] = useState("");
  const [amazonSaleNotice, setAmazonSaleNotice] = useState(null);
  const amazonSyncPromiseRef = useRef(null);
  const dashboardMountedRef = useRef(true);
  const dashboardRequestIdRef = useRef(0);
  const lastDashboardRefreshRef = useRef(0);
  const amazonSaleRingIntervalRef = useRef(null);
  const amazonSaleRingSessionRef = useRef(0);
  const amazonSaleDemoStartedRef = useRef(false);

  const fetchDashboardStats = useCallback(async () => {
    const requestId = dashboardRequestIdRef.current + 1;
    dashboardRequestIdRef.current = requestId;
    lastDashboardRefreshRef.current = Date.now();
    const freshFetchOptions = {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    };
    try {
      setBackendError(false);
      const response = await apiFetch(
        `${API_BASE_URL}/dashboard-stats?refresh=${Date.now()}`,
        freshFetchOptions
      );
      if (!response.ok) {
        if (requestId === dashboardRequestIdRef.current) {
          setBackendError(true);
        }
        return;
      }
      const dashboardStats = await response.json();
      if (
        requestId !== dashboardRequestIdRef.current ||
        !dashboardMountedRef.current
      ) {
        return;
      }
      setStats(dashboardStats);

      if (userRole === "warehouse") {
        try {
          const fulfillmentResponse = await apiFetch(
            `${API_BASE_URL}/fulfillment/dashboard?refresh=${Date.now()}`,
            freshFetchOptions
          );
          if (
            fulfillmentResponse.ok &&
            requestId === dashboardRequestIdRef.current &&
            dashboardMountedRef.current
          ) {
            setFulfillmentData(await fulfillmentResponse.json());
          } else if (requestId === dashboardRequestIdRef.current) {
            setFulfillmentData({
              stats: {},
              orders: [],
              shipments: [],
              inventory: [],
            });
          }
        } catch (error) {
          console.error("Warehouse dashboard fulfillment error:", error);
          if (requestId === dashboardRequestIdRef.current) {
            setFulfillmentData({
              stats: {},
              orders: [],
              shipments: [],
              inventory: [],
            });
          }
        }
      } else if (requestId === dashboardRequestIdRef.current) {
        setFulfillmentData(null);
      }

      if (userRole === "worker" && workerId) {
        try {
          const [orderTasksResponse, workerTasksResponse, workerPaymentsResponse] =
            await Promise.all([
              apiFetch(
                `${API_BASE_URL}/order-workflow/tasks?worker_id=${workerId}&refresh=${Date.now()}`,
                freshFetchOptions
              ),
              apiFetch(
                `${API_BASE_URL}/production/tasks?worker_id=${workerId}&refresh=${Date.now()}`,
                freshFetchOptions
              ),
              apiFetch(
                `${API_BASE_URL}/worker-payments?worker_id=${workerId}&refresh=${Date.now()}`,
                freshFetchOptions
              ),
            ]);
          if (
            requestId !== dashboardRequestIdRef.current ||
            !dashboardMountedRef.current
          ) {
            return;
          }
          if (!orderTasksResponse.ok) {
            setOrderTasks([]);
            return;
          }
          const orderTasksData = await orderTasksResponse.json();
          const nextOrderTasks = Array.isArray(orderTasksData) ? orderTasksData : [];
          setOrderTasks(nextOrderTasks.filter((task) => task.status !== "Completed"));
          const workerTasksData = workerTasksResponse.ok
            ? await workerTasksResponse.json()
            : [];
          const workerPaymentsData = workerPaymentsResponse.ok
            ? await workerPaymentsResponse.json()
            : [];
          setWorkerPayoutData({
            tasks: Array.isArray(workerTasksData) ? workerTasksData : [],
            orderTasks: nextOrderTasks,
            payments: Array.isArray(workerPaymentsData) ? workerPaymentsData : [],
          });
        } catch (error) {
          console.error("Dashboard order tasks error:", error);
          if (requestId === dashboardRequestIdRef.current) {
            setOrderTasks([]);
            setWorkerPayoutData({ tasks: [], orderTasks: [], payments: [] });
          }
        }
      } else if (requestId === dashboardRequestIdRef.current) {
        setOrderTasks([]);
        setWorkerPayoutData({ tasks: [], orderTasks: [], payments: [] });
      }
    } catch (error) {
      console.error("Dashboard error:", error);
      if (
        requestId === dashboardRequestIdRef.current &&
        dashboardMountedRef.current
      ) {
        setBackendError(true);
      }
    } finally {
      if (
        requestId === dashboardRequestIdRef.current &&
        dashboardMountedRef.current
      ) {
        setLoading(false);
      }
    }
  }, [userRole, workerId]);

  const announceAmazonSale = useCallback((job) => {
    const jobId = Number(job?.id || 0);
    const newOrderCount = Number(job?.response_summary?.created || 0);
    if (!jobId || newOrderCount < 1 || typeof window === "undefined") return;

    let notifiedJobIds = [];
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(AMAZON_SALE_JOBS_STORAGE_KEY) || "[]"
      );
      notifiedJobIds = Array.isArray(saved) ? saved.map(Number) : [];
    } catch {
      // Continue with an empty device history when saved data is invalid.
    }
    if (notifiedJobIds.includes(jobId)) return;

    try {
      window.localStorage.setItem(
        AMAZON_SALE_JOBS_STORAGE_KEY,
        JSON.stringify([...notifiedJobIds, jobId].slice(-30))
      );
    } catch {
      // The in-page notification still works when storage is unavailable.
    }

    setAmazonSaleNotice({
      count: newOrderCount,
      currency: String(
        job?.response_summary?.created_order_currency || "USD"
      ).toUpperCase(),
      jobId,
      soundBlocked: false,
      value: Math.max(
        0,
        Number(job?.response_summary?.created_order_total || 0)
      ),
    });
  }, []);

  const stopAmazonSaleRinging = useCallback(() => {
    amazonSaleRingSessionRef.current += 1;
    if (amazonSaleRingIntervalRef.current) {
      window.clearInterval(amazonSaleRingIntervalRef.current);
      amazonSaleRingIntervalRef.current = null;
    }
    stopAmazonSaleRingtone();
  }, []);

  const startAmazonSaleRinging = useCallback(
    async (jobId) => {
      stopAmazonSaleRinging();
      const ringSession = amazonSaleRingSessionRef.current;

      const ringOnce = async () => {
        const played = await playAmazonSaleRingtone();
        if (
          ringSession !== amazonSaleRingSessionRef.current ||
          !dashboardMountedRef.current
        ) {
          return;
        }
        if (!played) {
          stopAmazonSaleRinging();
          setAmazonSaleNotice((current) =>
            current?.jobId === jobId
              ? { ...current, soundBlocked: true }
              : current
          );
          return;
        }
        window.navigator.vibrate?.([260, 110, 260]);
        setAmazonSaleNotice((current) =>
          current?.jobId === jobId
            ? { ...current, soundBlocked: false }
            : current
        );
      };

      await ringOnce();
      if (ringSession !== amazonSaleRingSessionRef.current) return;
      amazonSaleRingIntervalRef.current = window.setInterval(ringOnce, 1450);
    },
    [stopAmazonSaleRinging]
  );

  const syncAmazonOpenOrders = useCallback(async () => {
    if (!["admin", "super_admin"].includes(userRole)) return;
    if (amazonSyncPromiseRef.current) {
      return amazonSyncPromiseRef.current;
    }

    const syncRun = (async () => {
      if (dashboardMountedRef.current) {
        setAmazonSyncing(true);
        setAmazonSyncError("");
      }

      try {
        const syncResponse = await apiFetch(
          `${API_BASE_URL}/amazon/orders/sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days: 14, mode: "incremental" }),
          }
        );
        if (!syncResponse.ok) {
          const errorPayload = await syncResponse.json().catch(() => ({}));
          throw new Error(
            typeof errorPayload?.detail === "string"
              ? errorPayload.detail
              : "Amazon orders could not be synchronized."
          );
        }

        let job = await syncResponse.json();
        for (let attempt = 0; attempt < 75; attempt += 1) {
          if (["Completed", "Failed"].includes(job?.status)) break;
          await waitFor(1200);
          const jobResponse = await apiFetch(
            `${API_BASE_URL}/amazon/orders/jobs/${job.id}`
          );
          if (!jobResponse.ok) {
            throw new Error("Amazon order synchronization status was unavailable.");
          }
          job = await jobResponse.json();
        }

        if (job?.status !== "Completed") {
          throw new Error(
            job?.error_message ||
              (job?.status === "Failed"
                ? "Amazon order synchronization failed."
                : "Amazon order synchronization is taking longer than expected.")
          );
        }

        let saleJob = job;
        if (Number(job?.response_summary?.created || 0) < 1) {
          const recentJobsResponse = await apiFetch(
            `${API_BASE_URL}/amazon/orders/jobs?limit=100`
          );
          if (recentJobsResponse.ok) {
            const recentJobs = await recentJobsResponse.json();
            saleJob = (Array.isArray(recentJobs) ? recentJobs : []).find(
              (recentJob) =>
                Number(recentJob?.response_summary?.created || 0) > 0 &&
                Object.hasOwn(
                  recentJob?.response_summary || {},
                  "created_order_total"
                )
            );
          }
        }
        announceAmazonSale(saleJob);
      } catch (error) {
        console.error("Dashboard Amazon order sync error:", error);
        if (dashboardMountedRef.current) {
          setAmazonSyncError(error?.message || "Amazon sync unavailable.");
        }
      } finally {
        await fetchDashboardStats();
        if (dashboardMountedRef.current) {
          setAmazonSyncing(false);
        }
      }
    })();

    amazonSyncPromiseRef.current = syncRun;
    syncRun.finally(() => {
      if (amazonSyncPromiseRef.current === syncRun) {
        amazonSyncPromiseRef.current = null;
      }
    });
    return syncRun;
  }, [announceAmazonSale, fetchDashboardStats, userRole]);

  useEffect(() => {
    const initialLoadId = setTimeout(fetchDashboardStats, 0);
    const refreshId = setInterval(fetchDashboardStats, 60000);

    return () => {
      clearTimeout(initialLoadId);
      clearInterval(refreshId);
    };
  }, [fetchDashboardStats]);

  useEffect(() => {
    const refreshDashboard = (event) => {
      if (
        event?.type === "erp:navigation" &&
        event.detail?.page &&
        event.detail.page !== "Dashboard"
      ) {
        return;
      }
      if (
        event?.type === "visibilitychange" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      if (
        event?.type !== "erp:navigation" &&
        Date.now() - lastDashboardRefreshRef.current < 1500
      ) {
        return;
      }
      fetchDashboardStats();
    };

    window.addEventListener("focus", refreshDashboard);
    window.addEventListener("erp:navigation", refreshDashboard);
    document.addEventListener("visibilitychange", refreshDashboard);
    return () => {
      window.removeEventListener("focus", refreshDashboard);
      window.removeEventListener("erp:navigation", refreshDashboard);
      document.removeEventListener("visibilitychange", refreshDashboard);
    };
  }, [fetchDashboardStats]);

  useEffect(() => {
    dashboardMountedRef.current = true;
    return () => {
      dashboardMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!["admin", "super_admin"].includes(userRole)) return undefined;

    const initialSyncId = window.setTimeout(syncAmazonOpenOrders, 150);
    const syncIntervalId = window.setInterval(
      syncAmazonOpenOrders,
      AMAZON_ORDER_SYNC_INTERVAL_MS
    );
    return () => {
      window.clearTimeout(initialSyncId);
      window.clearInterval(syncIntervalId);
    };
  }, [syncAmazonOpenOrders, userRole]);

  useEffect(() => {
    if (
      !["admin", "super_admin"].includes(userRole) ||
      amazonSaleDemoStartedRef.current ||
      typeof window === "undefined"
    ) {
      return undefined;
    }

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("amazon-sale-test") !== "1") {
      return undefined;
    }

    amazonSaleDemoStartedRef.current = true;
    currentUrl.searchParams.delete("amazon-sale-test");
    window.history.replaceState(
      window.history.state,
      "",
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
    );

    const demoId = window.setTimeout(() => {
      setAmazonSaleNotice({
        count: 1,
        currency: "USD",
        isTest: true,
        jobId: `amazon-sale-demo-${Date.now()}`,
        soundBlocked: false,
        value: 49.99,
      });
    }, 250);
    return () => window.clearTimeout(demoId);
  }, [userRole]);

  useEffect(() => {
    if (!["admin", "super_admin"].includes(userRole)) return undefined;
    const unlockAudio = () => primeAmazonSaleAudio();
    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [userRole]);

  useEffect(() => {
    const jobId = amazonSaleNotice?.jobId;
    if (!jobId) return undefined;
    startAmazonSaleRinging(jobId);
    return stopAmazonSaleRinging;
  }, [
    amazonSaleNotice?.jobId,
    startAmazonSaleRinging,
    stopAmazonSaleRinging,
  ]);

  const dashboardData = stats || {};
  const amazonData = dashboardData.amazon || {};
  const pendingShipping = dashboardData.pending_shipping_orders || 0;
  const lowStock = dashboardData.low_stock_count || 0;
  const upcomingBills = dashboardData.upcoming_regular_bills || [];
  const upcomingBillCount = dashboardData.upcoming_regular_bills_count || 0;
  const overdueBillCount = dashboardData.overdue_regular_bills_count || 0;
  const workerTasks = useMemo(() => {
    const apiTasks = Array.isArray(workerPayoutData.tasks)
      ? workerPayoutData.tasks
      : [];
    if (apiTasks.length) return apiTasks;
    return (
      dashboardData.active_production_tasks?.filter(
        (task) => task.worker_id === workerId
      ) || []
    );
  }, [dashboardData.active_production_tasks, workerId, workerPayoutData.tasks]);
  const workerOpenProductionTasks = useMemo(
    () => workerTasks.filter((task) => task.status !== "Completed"),
    [workerTasks]
  );
  const workerLateTasks = useMemo(
    () =>
      workerOpenProductionTasks.filter((task) => task.timing_status === "Late"),
    [workerOpenProductionTasks]
  );
  const workerOrderTasks = useMemo(
    () => orderTasks.filter((task) => task.status !== "Completed"),
    [orderTasks]
  );
  const workerOpenTaskCount =
    workerOpenProductionTasks.length + workerOrderTasks.length;
  const workerUnstartedTaskCount =
    workerOpenProductionTasks.filter((task) =>
      ["New", "Pending", "Ready"].includes(task.status)
    ).length +
    workerOrderTasks.filter((task) => ["New", "Ready"].includes(task.status)).length;
  const workerPayoutSummary = useMemo(() => {
    const completedTasks = workerPayoutData.tasks.filter(
      (task) => task.status === "Completed"
    );
    const completedOrderTasks = (workerPayoutData.orderTasks || []).filter(
      (task) => task.status === "Completed"
    );
    const earned = completedTasks.reduce(
      (total, task) =>
        total +
        Number(
          task.labor_cost ||
            Number(task.completed_quantity || 0) * Number(task.rate_per_piece || 0)
        ),
      0
    ) + completedOrderTasks.reduce(
      (total, task) =>
        total +
        Number(
          task.labor_cost ||
            Number(task.completed_quantity || task.assigned_quantity || 0) *
              Number(task.rate_per_piece || 0)
        ),
      0
    );
    const paid = workerPayoutData.payments.reduce(
      (total, payment) => total + Number(payment.amount || 0),
      0
    );
    return {
      earned,
      paid,
      balance: earned - paid,
      completed: completedTasks.length + completedOrderTasks.length,
    };
  }, [workerPayoutData]);

  const totalOrders = dashboardData.total_orders || 0;
  const salesSeries = useMemo(
    () => normalizeSalesSeries(dashboardData.sales_last_7_days),
    [dashboardData.sales_last_7_days]
  );
  const sevenDaySales = salesSeries.reduce(
    (total, day) => total + day.salesAmount,
    0
  );
  const newOrdersLast7Days = salesSeries.reduce(
    (total, day) => total + day.orderCount,
    0
  );
  const ordersTodayCombined =
    salesSeries.at(-1)?.orderCount ??
    Number(dashboardData.new_orders_today || 0);
  const recentOrders = Array.isArray(dashboardData.recent_week_orders)
    ? dashboardData.recent_week_orders
    : [];
  const topSellingProducts = Array.isArray(
    dashboardData.top_selling_products_7_days
  )
    ? dashboardData.top_selling_products_7_days
    : [];
  const shippedOrders = dashboardData.shipped_orders || 0;
  const availableStock = Math.max(
    0,
    (dashboardData.total_factory_stock || 0) +
      (dashboardData.total_usa_stock || 0) +
      (dashboardData.total_front_room_stock || 0) -
      (dashboardData.total_reserved_stock || 0)
  );
  const shippingRate = totalOrders
    ? Math.round((shippedOrders / totalOrders) * 100)
    : 0;
  const dueTodayBillCount = upcomingBills.filter(
    (bill) => Number(bill.days_until_due) === 0
  ).length;
  const amazonOpenOrders = Number(amazonData.open_order_count || 0);
  const amazonPendingOrders = Number(amazonData.pending_order_count || 0);
  const amazonUnshippedOrders = Number(amazonData.unshipped_order_count || 0);
  const amazonLastSyncValue = String(amazonData.last_order_sync_at || "");
  const amazonLastSyncTime = amazonLastSyncValue
    ? new Date(
        /(?:Z|[+-]\d{2}:\d{2})$/i.test(amazonLastSyncValue)
          ? amazonLastSyncValue
          : `${amazonLastSyncValue}Z`
      )
    : null;
  const amazonLastSyncLabel =
    amazonLastSyncTime && !Number.isNaN(amazonLastSyncTime.getTime())
      ? `Synced ${amazonLastSyncTime.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "Waiting for first sync";
  const amazonInboundDiscrepancy = Number(
    amazonData.inbound_discrepancy_units || 0
  );
  const amazonUnmappedItems = Number(amazonData.unmapped_item_count || 0);
  const fulfillmentOrders = useMemo(
    () => (Array.isArray(fulfillmentData?.orders) ? fulfillmentData.orders : []),
    [fulfillmentData]
  );
  const fulfillmentShipments = useMemo(
    () =>
      Array.isArray(fulfillmentData?.shipments)
        ? fulfillmentData.shipments
        : [],
    [fulfillmentData]
  );
  const fulfillmentInventory = useMemo(
    () =>
      Array.isArray(fulfillmentData?.inventory)
        ? fulfillmentData.inventory
        : [],
    [fulfillmentData]
  );
  const warehouseUnshippedOrders = useMemo(
    () => fulfillmentOrders.filter((order) => !isFulfillmentShipped(order)),
    [fulfillmentOrders]
  );
  const warehouseFulfilledOrders = useMemo(
    () => fulfillmentOrders.filter((order) => isFulfillmentShipped(order)),
    [fulfillmentOrders]
  );
  const warehouseReadyOrders = useMemo(
    () =>
      warehouseUnshippedOrders.filter(
        (order) => fulfillmentOrderReadiness(order).state === "ready"
      ),
    [warehouseUnshippedOrders]
  );
  const warehouseShortageOrders = useMemo(
    () =>
      warehouseUnshippedOrders.filter(
        (order) => fulfillmentOrderReadiness(order).state === "shortage"
      ),
    [warehouseUnshippedOrders]
  );
  const warehousePriorityOrders = useMemo(
    () =>
      [...warehouseUnshippedOrders]
        .sort((a, b) => {
          const orderRank = { ready: 0, label: 1, shortage: 2 };
          return (
            orderRank[fulfillmentOrderReadiness(a).state] -
              orderRank[fulfillmentOrderReadiness(b).state] ||
            new Date(a.created_at || 0) - new Date(b.created_at || 0)
          );
        })
        .slice(0, 8),
    [warehouseUnshippedOrders]
  );
  const warehouseRecentFulfilled = useMemo(
    () => warehouseFulfilledOrders.slice(0, 6),
    [warehouseFulfilledOrders]
  );
  const warehouseBoxGroups = useMemo(() => {
    const grouped = new Map();
    fulfillmentInventory.forEach((item) => {
      const current = grouped.get(item.product_id) || {
        product_id: item.product_id,
        article_no: item.article_no,
        product_name: item.product_name,
        available_quantity: 0,
        boxes: 0,
      };
      current.available_quantity += Number(item.available_quantity || 0);
      current.boxes += 1;
      grouped.set(item.product_id, current);
    });
    return [...grouped.values()]
      .sort((a, b) => b.available_quantity - a.available_quantity)
      .slice(0, 6);
  }, [fulfillmentInventory]);

  const attentionItems = useMemo(() => {
    if (userRole === "worker") {
      const queueTasks = [...workerOpenProductionTasks].sort((a, b) => {
        if (a.timing_status === "Late" && b.timing_status !== "Late") return -1;
        if (a.timing_status !== "Late" && b.timing_status === "Late") return 1;
        return (
          new Date(a.expected_completion_time || a.created_at || 0) -
          new Date(b.expected_completion_time || b.created_at || 0)
        );
      });
      const orderItems = workerOrderTasks.map((task) => {
        const firstItem = (task.items || [])[0] || {};
        const itemCount = (task.items || []).reduce(
          (total, item) => total + Number(item.quantity || 0),
          0
        );
        const earning = Number(task.labor_cost || 0);
        return {
          key: `order-task-${task.id}`,
          title: task.title || `${task.task_type || "Order"} task`,
          detail: [
            `Order #${task.order_no || task.order_id}`,
            earning ? `${formatAmount(earning)} earning` : "",
          ]
            .filter(Boolean)
            .join(" / "),
          imageUrl: firstItem.product_image_url,
          sku: firstItem.article_no || "Order",
          meta:
            task.status === "New"
              ? "New"
              : itemCount
                ? `${itemCount} pcs`
                : task.task_type || "Order",
          attention: task.status === "New",
          href: "/portal/my-tasks",
        };
      });
      const productionItems = queueTasks.map((task) => ({
        key: `task-${task.task_id}`,
        title: task.step_name,
        detail: `SKU ${task.article_no || "-"}`,
        imageUrl: task.product_image_url,
        sku: task.article_no || "-",
        meta:
          task.timing_status === "Late"
              ? "Late"
              : task.status,
        attention: task.timing_status === "Late",
        href: "/portal/my-tasks",
      }));
      return [...orderItems, ...productionItems].slice(0, 8);
    }

    const items = [];
    if (upcomingBillCount > 0) {
      items.push({
        key: "payments",
        title: overdueBillCount
          ? `${pluralize(overdueBillCount, "bill")} overdue`
          : dueTodayBillCount
            ? `${pluralize(dueTodayBillCount, "bill")} due today`
            : `${pluralize(upcomingBillCount, "bill")} due soon`,
        detail: overdueBillCount
          ? `${overdueBillCount} overdue and waiting for review`
          : `${upcomingBillCount} scheduled payments need review`,
        meta: "Billings",
        attention: overdueBillCount > 0,
        href: "/portal/billings",
      });
    }
    if (pendingShipping > 0) {
      items.push({
        key: "shipping",
        title: `${pendingShipping} orders waiting shipping`,
        detail: `${shippingRate}% fulfillment rate`,
        meta: "Shipping",
        href: "/portal/shipping",
      });
    }
    if (lowStock > 0) {
      items.push({
        key: "stock",
        title: `${lowStock} products low on stock`,
        detail: `${availableStock.toLocaleString()} available after reservations`,
        meta: "Inventory",
        attention: true,
        href: "/portal/inventory",
      });
    }
    if (["admin", "super_admin"].includes(userRole) && amazonData.configured && amazonOpenOrders > 0) {
      items.push({
        key: "amazon-open-orders",
        title: `${amazonOpenOrders} Amazon FBA ${
          amazonOpenOrders === 1 ? "order is" : "orders are"
        } open`,
        detail: `${amazonPendingOrders} pending / ${amazonUnshippedOrders} unshipped`,
        meta: "Amazon",
        href: "/portal/amazon/orders",
      });
    }
    if (
      ["admin", "super_admin"].includes(userRole) &&
      amazonData.configured &&
      (amazonUnmappedItems > 0 || amazonInboundDiscrepancy > 0)
    ) {
      items.push({
        key: "amazon-issues",
        title: "Amazon items need review",
        detail: `${amazonUnmappedItems} unmapped / ${amazonInboundDiscrepancy} inbound discrepancy`,
        meta: "Amazon issue",
        attention: true,
        href: "/portal/amazon/orders",
      });
    }
    return items;
  }, [
    amazonData.configured,
    amazonInboundDiscrepancy,
    amazonOpenOrders,
    amazonPendingOrders,
    amazonUnmappedItems,
    amazonUnshippedOrders,
    availableStock,
    dueTodayBillCount,
    lowStock,
    overdueBillCount,
    pendingShipping,
    shippingRate,
    upcomingBillCount,
    userRole,
    workerOpenProductionTasks,
    workerOrderTasks,
  ]);

  const focusNotice =
    overdueBillCount > 0
      ? {
          action: "Open billings",
          detail: "Outstanding payments need review.",
          href: "/portal/billings",
          title: `${pluralize(overdueBillCount, "bill")} overdue`,
          tone: "danger",
        }
      : ["admin", "super_admin"].includes(userRole) &&
          amazonData.configured &&
          (amazonUnmappedItems > 0 || amazonInboundDiscrepancy > 0)
        ? {
            action: "Review Amazon",
            detail: `${amazonUnmappedItems} unmapped items and ${amazonInboundDiscrepancy} inbound discrepancy units.`,
            href: "/portal/amazon/orders",
            title: "Amazon records need review",
            tone: "warning",
          }
        : pendingShipping > 0
          ? {
              action: "Open shipping",
              detail: `${pendingShipping} ${
                pendingShipping === 1 ? "order is" : "orders are"
              } waiting for dispatch.`,
              href: "/portal/shipping",
              title: "Shipping queue is active",
              tone: "info",
            }
          : lowStock > 0
            ? {
                action: "Review inventory",
                detail: `${pluralize(lowStock, "product")} at or below the stock alert level.`,
                href: "/portal/inventory",
                title: "Stock needs attention",
                tone: "warning",
              }
            : {
                action: "Open orders",
                detail: "No urgent operational issues are waiting.",
                href: "/portal/orders",
                icon: "OK",
                label: "All clear",
                title: "Operations are clear",
                tone: "success",
              };

  const focusMetrics = [
    {
      detail: `${pluralize(newOrdersLast7Days, "order")} · ERP + Amazon`,
      href: "/portal/orders",
      label: "7-day sales",
      value: formatCompactAmount(sevenDaySales),
    },
    {
      detail: `${newOrdersLast7Days} in the last 7 days`,
      href: "/portal/orders",
      label: "Orders today",
      value: formatNumber(ordersTodayCombined),
    },
    {
      detail: `${shippingRate}% of all orders shipped`,
      href: "/portal/shipping",
      label: "Waiting to ship",
      value: formatNumber(pendingShipping),
    },
      ...(["admin", "super_admin"].includes(userRole)
        ? [
            {
              detail: amazonSyncing
                ? "Fetching latest Amazon orders"
                : amazonSyncError
                  ? "Latest saved count · sync unavailable"
                  : `${amazonLastSyncLabel} · ${amazonPendingOrders} pending`,
              href: "/portal/amazon/orders",
              label: "Amazon open orders",
              loading: amazonSyncing,
              value: amazonSyncing ? "Loading" : formatNumber(amazonOpenOrders),
            },
          ]
      : [
          {
            detail: `${formatNumber(availableStock)} units available`,
            href: "/portal/inventory",
            label: "Stock alerts",
            value: formatNumber(lowStock),
          },
        ]),
  ];

  const priorityCount =
    userRole === "worker"
      ? workerOpenTaskCount
      : attentionItems.length;
  const priorityTone =
    userRole === "worker"
      ? workerLateTasks.length
        ? "overdue"
        : workerOpenTaskCount
          ? "today"
          : "soon"
      : overdueBillCount
        ? "overdue"
        : dueTodayBillCount
          ? "today"
          : "soon";
  const todayLabel = new Intl.DateTimeFormat("en-PK", {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(new Date());
  const priorityHeadline =
    priorityCount > 0
      ? userRole === "worker"
        ? "Open work"
        : overdueBillCount
          ? "Urgent follow-up"
          : dueTodayBillCount
            ? "Due today"
            : "Needs attention"
      : userRole === "worker"
        ? "Everything is steady"
        : "Well Done, Everything is Good";
  const prioritySubtext =
    userRole === "worker"
      ? workerOpenTaskCount
        ? `${workerOpenTaskCount} assigned ${
            workerOpenTaskCount === 1 ? "task is" : "tasks are"
          } open until completed.`
        : workerLateTasks.length
        ? `${workerLateTasks.length} late task needs your first move.`
        : "Your work queue is clean and ready."
      : overdueBillCount
        ? `${overdueBillCount} bill ${overdueBillCount === 1 ? "is" : "are"} overdue.`
        : pendingShipping
          ? `${pendingShipping} orders are waiting for dispatch.`
        : lowStock
          ? `${lowStock} products need stock review.`
            : "No urgent follow-ups right now. Keep marketing more and bring in the next orders.";
  const priorityMetrics =
    userRole === "worker"
      ? [
          ["Open", workerOpenTaskCount],
          ["Unstarted", workerUnstartedTaskCount],
          ["Late", workerLateTasks.length],
        ]
      : [
          ["Ship queue", pendingShipping],
          ["Low stock", lowStock],
          ["Bills", overdueBillCount || upcomingBillCount],
        ];
  if (loading) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-state">Loading dashboard...</div>
      </div>
    );
  }

  if (backendError || !stats) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-state error">
          Backend not connected. Please make sure FastAPI is running.
        </div>
      </div>
    );
  }

  const greetingName = userName || "Team";
  const dashboardSubtext =
    userRole === "warehouse"
      ? "Your fulfillment queues and box-level picking work."
      : userRole === "worker"
      ? "Your current work queue for today."
      : "The work that needs attention next.";

  if (userRole === "warehouse") {
    const warehouseMetricCards = [
      {
        label: "Unshipped orders",
        value: warehouseUnshippedOrders.length,
        detail: "Awaiting pick, label, or ship",
        tone: "open",
      },
      {
        label: "Ready to fulfill",
        value: warehouseReadyOrders.length,
        detail: "Stock and label ready",
        tone: "ready",
      },
      {
        label: "Stock issues",
        value: warehouseShortageOrders.length,
        detail: "Needs replenishment or correction",
        tone: "shortage",
      },
      {
        label: "Fulfilled",
        value: warehouseFulfilledOrders.length,
        detail: "Completed fulfillment orders",
        tone: "done",
      },
    ];

    return (
      <div className="dashboard-page is-warehouse-dashboard">
        {!isMobileDashboard && (
          <header className="dashboard-topbar warehouse-dashboard-topbar">
            <div>
              <span>Warehouse dashboard</span>
              <h1>
                {dashboardData.greeting}, {greetingName}
              </h1>
              <p>{dashboardSubtext}</p>
            </div>
            <a className="warehouse-dashboard-open" href="/portal/warehouse/dispatch">
              Open dispatch
            </a>
          </header>
        )}

        <section className="warehouse-metric-grid">
          {warehouseMetricCards.map((card) => (
            <article className={`is-${card.tone}`} key={card.label}>
              <span>{card.label}</span>
              <strong>{formatNumber(card.value)}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </section>

        <section className="warehouse-dashboard-layout">
          <div className="warehouse-order-panel">
            <div className="dashboard-section-heading">
              <span>Order queue</span>
              <h2>Unshipped orders</h2>
            </div>
            {warehousePriorityOrders.length === 0 ? (
              <div className="dashboard-empty">No unshipped fulfillment orders.</div>
            ) : (
              <div className="warehouse-order-queue">
                {warehousePriorityOrders.map((order) => {
                  const readiness = fulfillmentOrderReadiness(order);
                  const skuCount = (order.items || []).filter(
                    (item) => Number(item.quantity || 0) > 0
                  ).length;
                  const boxCount = getFulfillmentOrderBoxCount(order);
                  return (
                    <a
                      className={`warehouse-order-card is-${readiness.state}`}
                      href="/portal/warehouse/dispatch"
                      key={order.id}
                    >
                      <span className="warehouse-order-status">
                        {readiness.state === "ready"
                          ? "Ready"
                          : readiness.state === "label"
                            ? "Need label"
                            : "Short stock"}
                      </span>
                      <span className="warehouse-order-main">
                        <strong>{order.fulfillment_order_no}</strong>
                        <small>{order.customer_name || order.platform || "Fulfillment order"}</small>
                      </span>
                      <span className="warehouse-order-items">
                        <b>{formatNumber(skuCount)} SKUs</b>
                        <b>
                          {boxCount
                            ? `${formatNumber(boxCount)} ${boxCount === 1 ? "box" : "boxes"}`
                            : "No boxes"}
                        </b>
                      </span>
                      <span
                        className={`warehouse-order-label ${
                          order.label_file_url ? "is-ready" : "is-missing"
                        }`}
                      >
                        <strong>{order.label_file_url ? "Ready" : "Pending"}</strong>
                        <small>Label</small>
                      </span>
                      <span className="warehouse-order-count">
                        <strong>{formatNumber(order.total_units)}</strong>
                        <small>units</small>
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          <div className="warehouse-side-column">
            <section className="warehouse-side-panel">
              <div className="dashboard-section-heading">
                <span>Box stock</span>
                <h2>Top available SKUs</h2>
              </div>
              {warehouseBoxGroups.length === 0 ? (
                <div className="dashboard-empty">No fulfillment box stock yet.</div>
              ) : (
                <div className="warehouse-stock-list">
                  {warehouseBoxGroups.map((item) => (
                    <a
                      className="warehouse-stock-row"
                      href="/portal/warehouse/stock"
                      key={item.product_id}
                    >
                      <span>
                        <strong>{item.article_no}</strong>
                        <small>{item.product_name}</small>
                      </span>
                      <em>{formatNumber(item.available_quantity)}</em>
                    </a>
                  ))}
                </div>
              )}
            </section>

            <section className="warehouse-side-panel">
              <div className="dashboard-section-heading">
                <span>Fulfilled</span>
                <h2>Recent shipped orders</h2>
              </div>
              {warehouseRecentFulfilled.length === 0 ? (
                <div className="dashboard-empty">No fulfilled orders yet.</div>
              ) : (
                <div className="warehouse-fulfilled-list">
                  {warehouseRecentFulfilled.map((order) => (
                    <a
                      className="warehouse-fulfilled-row"
                      href="/portal/warehouse/shipments"
                      key={order.id}
                    >
                      <span>
                        <strong>{order.fulfillment_order_no}</strong>
                        <small>
                          {order.shipped_at
                            ? formatUtcLocal(order.shipped_at)
                            : "Shipped"}
                        </small>
                      </span>
                      <em>{formatNumber(order.total_units)} pcs</em>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="warehouse-shipment-panel">
            <div className="dashboard-section-heading">
              <span>Inbound to fulfillment</span>
              <h2>Recent shipments</h2>
            </div>
            {fulfillmentShipments.length === 0 ? (
              <div className="dashboard-empty">No fulfillment shipments sent yet.</div>
            ) : (
              <div className="warehouse-shipment-list">
                {fulfillmentShipments.slice(0, 5).map((shipment) => (
                  <a
                    className="warehouse-shipment-row"
                    href="/portal/warehouse/shipments"
                    key={shipment.id}
                  >
                    <span>
                      <strong>{shipment.shipment_no}</strong>
                      <small>{shipment.destination_name || "Fulfillment center"}</small>
                    </span>
                    <span>
                      <strong>{formatNumber(shipment.available_units)}</strong>
                      <small>available units</small>
                    </span>
                    <em>{formatNumber(shipment.carton_count)} boxes</em>
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (userRole !== "worker") {
    return (
      <div className="dashboard-page is-focus-dashboard">
        {amazonSaleNotice ? (
          <aside
            aria-live="assertive"
            className="dashboard-amazon-sale-toast"
            role="status"
          >
            <span className="dashboard-amazon-sale-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              {amazonSaleNotice.isTest ? (
                <em className="dashboard-amazon-sale-test-label">
                  Test notification
                </em>
              ) : null}
              <strong>
                Congratulations! New Amazon{" "}
                {amazonSaleNotice.count === 1 ? "order" : "orders"}
              </strong>
              <p>
                {amazonSaleNotice.isTest
                  ? "This is a dummy alert. No real Amazon order was created."
                  : `You have received ${
                      amazonSaleNotice.count === 1
                        ? "a new order"
                        : `${amazonSaleNotice.count} new orders`
                    } on Amazon.`}
              </p>
              <span className="dashboard-amazon-sale-value">
                {amazonSaleNotice.value > 0
                  ? `${
                      amazonSaleNotice.count === 1
                        ? "Order value"
                        : "Total value"
                    }: ${formatCurrency(
                      amazonSaleNotice.value,
                      amazonSaleNotice.currency
                    )}`
                  : "Order value pending from Amazon"}
              </span>
              {amazonSaleNotice.soundBlocked ? (
                <button
                  onClick={() => {
                    primeAmazonSaleAudio();
                    startAmazonSaleRinging(amazonSaleNotice.jobId);
                  }}
                  type="button"
                >
                  Start ringtone
                </button>
              ) : null}
              <button
                className="dashboard-amazon-sale-dismiss"
                onClick={() => {
                  stopAmazonSaleRinging();
                  setAmazonSaleNotice(null);
                }}
                type="button"
              >
                Dismiss and stop ringtone
              </button>
            </div>
            <button
              aria-label="Dismiss Amazon sale notification"
              className="dashboard-amazon-sale-close"
              onClick={() => {
                stopAmazonSaleRinging();
                setAmazonSaleNotice(null);
              }}
              type="button"
            >
              ×
            </button>
          </aside>
        ) : null}

        <header className="dashboard-modern-header">
          <div className="dashboard-modern-title">
            <span>{todayLabel}</span>
            <h1>
              {dashboardData.greeting}, {greetingName}
            </h1>
          </div>
        </header>

        <section
          aria-label="Key business metrics"
          className="dashboard-modern-metrics"
        >
          {focusMetrics.map((metric) => (
            <a
              aria-busy={metric.loading || undefined}
              className={metric.loading ? "is-loading" : undefined}
              href={metric.href}
              key={metric.label}
            >
              <span>{metric.label}</span>
              <strong>
                {metric.loading ? (
                  <span className="dashboard-amazon-card-loading">
                    <i aria-hidden="true" />
                    Loading
                  </span>
                ) : (
                  metric.value
                )}
              </strong>
              <small>{metric.detail}</small>
            </a>
          ))}
        </section>

        <section
          aria-label="Operational notice"
          className={`dashboard-modern-alert is-${focusNotice.tone}`}
        >
          <span className="dashboard-modern-alert-icon" aria-hidden="true">
            {focusNotice.icon || (focusNotice.tone === "info" ? "i" : "!")}
          </span>
          <div className="dashboard-modern-alert-copy">
            <span>{focusNotice.label || "Priority"}</span>
            <h2>{focusNotice.title}</h2>
            {focusNotice.detail && <p>{focusNotice.detail}</p>}
          </div>
          <dl>
            <div>
              <dt>Shipping</dt>
              <dd>{formatNumber(pendingShipping)}</dd>
            </div>
            <div>
              <dt>Low stock</dt>
              <dd>{formatNumber(lowStock)}</dd>
            </div>
            <div>
              <dt>Bills</dt>
              <dd>{formatNumber(overdueBillCount || upcomingBillCount)}</dd>
            </div>
          </dl>
          <a href={focusNotice.href}>{focusNotice.action}</a>
        </section>

        <section className="dashboard-modern-insights">
          <article className="dashboard-modern-panel dashboard-modern-sales">
            <header className="dashboard-modern-panel-header">
              <div>
                <span>Revenue</span>
                <h2>Sales performance</h2>
              </div>
              <div className="dashboard-modern-sales-total">
                <strong>{formatUsd(sevenDaySales)}</strong>
                <span>{pluralize(newOrdersLast7Days, "order")} · 7 days</span>
              </div>
            </header>
            <SevenDaySalesChart data={salesSeries} />
          </article>

          <article className="dashboard-modern-panel dashboard-modern-products">
            <header className="dashboard-modern-panel-header">
              <div>
                <span>Last 7 days</span>
                <h2>Top-selling products</h2>
              </div>
              <a href="/portal/products">View products</a>
            </header>
            {topSellingProducts.length === 0 ? (
              <div className="dashboard-modern-empty">No product sales yet.</div>
            ) : (
              <div className="dashboard-modern-product-list">
                {topSellingProducts.slice(0, 5).map((product, index) => {
                  const imageUrl = getStaticUrl(product.image_url);
                  return (
                    <a
                      href="/portal/products"
                      key={product.product_id || product.article_no}
                    >
                      <span className="dashboard-modern-product-rank">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="dashboard-modern-product-image">
                        {imageUrl ? (
                          <img
                            alt=""
                            src={imageUrl}
                          />
                        ) : (
                          <b>
                            {String(
                              product.product_name || product.article_no || "P"
                            )
                              .charAt(0)
                              .toUpperCase()}
                          </b>
                        )}
                      </span>
                      <span className="dashboard-modern-product-copy">
                        <strong>{product.product_name}</strong>
                        <small>
                          {product.article_no}
                          {(product.platforms || []).map((platform) => (
                            <em key={platform}>{platform}</em>
                          ))}
                        </small>
                      </span>
                      <span className="dashboard-modern-product-stats">
                        <strong>{formatNumber(product.units_sold)}</strong>
                        <small>{formatUsd(product.sales_amount)}</small>
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </article>
        </section>

        <section className="dashboard-modern-bottom">
          <article className="dashboard-modern-panel">
            <header className="dashboard-modern-panel-header">
              <div>
                <span>Work queue</span>
                <h2>Needs action</h2>
              </div>
              <strong>{attentionItems.length}</strong>
            </header>
            {attentionItems.length === 0 ? (
              <div className="dashboard-modern-empty">No urgent work waiting.</div>
            ) : (
              <div className="dashboard-modern-action-list">
                {attentionItems.slice(0, 5).map((item) => (
                  <a href={item.href} key={item.key}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <em className={item.attention ? "is-hot" : ""}>
                      {item.meta}
                    </em>
                  </a>
                ))}
              </div>
            )}
          </article>

          <article className="dashboard-modern-panel">
            <header className="dashboard-modern-panel-header">
              <div>
                <span>Activity</span>
                <h2>Latest orders</h2>
              </div>
              <a href="/portal/orders">View all</a>
            </header>
            {recentOrders.length === 0 ? (
              <div className="dashboard-modern-empty">
                No orders in the last 7 days.
              </div>
            ) : (
              <div className="dashboard-modern-order-list">
                {recentOrders.slice(0, 5).map((order) => (
                  <a href="/portal/orders" key={order.order_id}>
                    <span>
                      <strong>{order.order_no}</strong>
                      <small>
                        {order.customer_name || "Customer"} ·{" "}
                        {order.platform || "ERP"}
                      </small>
                    </span>
                    <span>
                      <strong>{formatUsd(order.total_amount_usd)}</strong>
                      <small>{order.status || "New"}</small>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </article>
        </section>
      </div>
    );
  }

  return (
    <div
      className={`dashboard-page ${
        userRole === "worker" ? "is-worker-dashboard" : "is-command-dashboard"
      }`}
    >
      {!isMobileDashboard && (
        <header className="dashboard-topbar">
          <div>
            <span>Dashboard</span>
            <h1>
              {dashboardData.greeting}, {greetingName}
            </h1>
            <p>{dashboardSubtext}</p>
          </div>
        </header>
      )}

      <section
        className={`dashboard-mobile-hero is-${priorityTone} ${
          userRole === "worker" ? "is-worker-snapshot" : ""
        }`}
        aria-label="Today snapshot"
      >
        <div className="dashboard-mobile-hero-main">
          <span>{todayLabel}</span>
          <h2>{priorityHeadline}</h2>
          <p>{prioritySubtext}</p>
        </div>
        <div className="dashboard-mobile-hero-metrics">
          {priorityMetrics.map(([label, value]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-workspace">
        {userRole === "worker" && (
          <div className="dashboard-worker-payout-card">
            <div className="dashboard-section-heading">
              <span>Payouts</span>
              <h2>Your worker account</h2>
            </div>
            <div className="dashboard-worker-payout-grid">
              <article className="is-earned">
                <span>Earned</span>
                <strong>{formatAmount(workerPayoutSummary.earned)}</strong>
                <small>
                  {pluralize(workerPayoutSummary.completed, "completed task")}
                </small>
              </article>
              <article className="is-paid">
                <span>Paid</span>
                <strong>{formatAmount(workerPayoutSummary.paid)}</strong>
                <small>Recorded payouts</small>
              </article>
              <article className="is-balance">
                <span>Balance</span>
                <strong>{formatAmount(workerPayoutSummary.balance)}</strong>
                <small>
                  {workerPayoutSummary.balance < 0
                    ? "Overpaid against tasks"
                    : "Remaining task payout"}
                </small>
              </article>
            </div>
            <a className="dashboard-worker-payout-link" href="/portal/worker-payouts">
              Open worker accounts
            </a>
          </div>
        )}

        <div className="dashboard-list-section">
          <div className="dashboard-section-heading">
            <span>Work queue</span>
            <h2>{userRole === "worker" ? "Your tasks" : "What to check next"}</h2>
          </div>

          {attentionItems.length === 0 ? (
            <div className="dashboard-empty">
              {userRole === "worker"
                ? "No work waiting right now."
                : "Well Done, Everything is Good. Keep marketing more."}
            </div>
          ) : (
            <div className="dashboard-action-list">
              {attentionItems.map((item) => {
                const imageUrl = getStaticUrl(item.imageUrl);
                const content = (
                  <>
                    <span className={item.sku ? "dashboard-worker-task" : ""}>
                      {item.sku &&
                        (imageUrl ? (
                          <img
                            alt={item.sku}
                            className="dashboard-worker-thumbnail"
                            src={imageUrl}
                          />
                        ) : (
                          <span className="dashboard-worker-thumbnail dashboard-worker-placeholder">
                            SKU
                          </span>
                        ))}
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </span>
                    <em className={item.attention ? "is-hot" : ""}>{item.meta}</em>
                  </>
                );

                return item.href ? (
                  <a className="dashboard-action-row" href={item.href} key={item.key}>
                    {content}
                  </a>
                ) : (
                  <div className="dashboard-action-row" key={item.key}>
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Dashboard(props) {
  if (props.userRole === "unassigned") {
    return (
      <UnassignedDashboard
        userEmail={props.userEmail}
        userName={props.userName}
        userPhone={props.userPhone}
      />
    );
  }

  return <OperationalDashboard {...props} />;
}

export default Dashboard;
