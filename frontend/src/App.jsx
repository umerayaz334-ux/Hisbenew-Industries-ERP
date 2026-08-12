import { Component, lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import "./App.css";

import api from "./api/api";
import { saveAuthenticatedUser, clearAuthenticatedUser } from "./api/auth";
import { InternalCallProvider } from "./components/InternalCallProvider";
import SchoolSplash from "./school/SchoolSplash";
import Sidebar from "./components/sidebar";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import "./pages/OperationsSizing.css";
import "./pages/DashboardDesktop.css";
import "./pages/DashboardFocus.css";
import { DEFAULT_SCHOOL_SETTINGS, normalizeSchoolSettings, schoolThemeStyle } from "./school/theme";

const Products = lazy(() => import("./pages/Products"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Inspiration = lazy(() => import("./pages/Inspiration"));
const Customers = lazy(() => import("./pages/Customers"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const SupplierLedger = lazy(() => import("./pages/SupplierLedger"));
const Orders = lazy(() => import("./pages/Orders"));
const Manufacturing = lazy(() => import("./pages/Manufacturing"));
const Workers = lazy(() => import("./pages/Workers"));
const Shipping = lazy(() => import("./pages/Shipping"));
const ShippingBalance = lazy(() => import("./pages/ShippingBalance"));
const Fulfillment = lazy(() => import("./pages/Fulfillment"));
const LabelPrinter = lazy(() => import("./pages/LabelPrinter"));
const LabelPrinter2 = lazy(() => import("./pages/LabelPrinter2"));
const ServiceTakers = lazy(() => import("./pages/ServiceTakers"));
const ServiceTakerPortal = lazy(() => import("./pages/ServiceTakerPortal"));
const FollowUps = lazy(() => import("./pages/FollowUps"));
const Payouts = lazy(() => import("./pages/Payouts"));
const Payments = lazy(() => import("./pages/Payments"));
const WorkerPayouts = lazy(() => import("./pages/WorkerPayouts"));
const WorkerAccounts2 = lazy(() => import("./pages/WorkerAccounts2"));
const Accounting = lazy(() => import("./pages/Accounting"));
const AccountingQuicks = lazy(() => import("./pages/AccountingQuicks"));
const Production = lazy(() => import("./pages/Production"));
const MyTasks = lazy(() => import("./pages/MyTasks"));
const Reports = lazy(() => import("./pages/Reports"));
const Website = lazy(() => import("./pages/Website"));
const WebsiteAdmin = lazy(() => import("./pages/WebsiteAdmin"));
const Deployment = lazy(() => import("./pages/Deployment"));
const WebsiteCatalog = lazy(() => import("./pages/WebsiteCatalog"));
const Settings = lazy(() => import("./pages/Settings"));
const AmazonSettings = lazy(() => import("./pages/AmazonSettings"));
const AmazonListings = lazy(() => import("./pages/AmazonListings"));
const AmazonOrders = lazy(() => import("./pages/AmazonOrders"));
const AmazonFbaInbound = lazy(() => import("./pages/AmazonFbaInbound"));
const AmazonFinances = lazy(() => import("./pages/AmazonFinances"));
const AmazonPricing = lazy(() => import("./pages/AmazonPricing"));
const Users = lazy(() => import("./pages/Users"));
const Companies = lazy(() => import("./pages/Companies"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const Quotes = lazy(() => import("./pages/Quotes"));
const TempData = lazy(() => import("./pages/TempData"));
const Messages = lazy(() => import("./pages/Messages"));
const CopyClipboard = lazy(() => import("./pages/CopyClipboard"));
const SchoolDashboard = lazy(() => import("./school/pages/SchoolDashboard"));
const SchoolStudents = lazy(() => import("./school/pages/SchoolStudents"));
const SchoolSettings = lazy(() => import("./school/pages/SchoolSettings"));
const SchoolFoundation = lazy(() => import("./school/pages/SchoolFoundation"));
const SchoolAdmissionApply = lazy(() => import("./school/pages/SchoolAdmissionApply"));
const SchoolAttendance = lazy(() => import("./school/pages/SchoolAttendance"));
const SchoolFinance = lazy(() => import("./school/pages/SchoolFinance"));

const pagePaths = {
  Dashboard: "/portal",
  Products: "/portal/products",
  Inventory: "/portal/inventory",
  Inspiration: "/portal/inspiration",
  Quotes: "/portal/quotes",
  Website: "/portal/website",
  Deployment: "/portal/deployment",
  WebsiteStorefront: "/",
  WebsiteCatalog: "/catalog",
  TempData: "/portal/temp-data",
  Messages: "/portal/messages",
  "Copy Clipboard": "/portal/copy-clipboard",
  "School ERP": "/portal/school",
  "School Students": "/portal/school/students",
  "School Settings": "/portal/school/settings",
  "School Foundation": "/portal/school/foundation",
  "School Admission Apply": "/school/admission/apply",
  "School Attendance": "/portal/school/attendance",
  "School Finance": "/portal/school/finance",
  Customers: "/portal/customers",
  Suppliers: "/portal/suppliers",
  Orders: "/portal/orders",
  Shipping: "/portal/shipping",
  "Shipping Balance": "/portal/shipping-balance",
  "Warehouse / Fulfillment": "/portal/fulfillment",
  "Warehouse Dispatch": "/portal/warehouse/dispatch",
  "Warehouse Shipments": "/portal/warehouse/shipments",
  "Warehouse Stock": "/portal/warehouse/stock",
  "Label Printer": "/portal/label-printer",
  "Label Printer 2": "/portal/label-printer-2",
  "Service Takers": "/portal/service-takers",
  "Service Dashboard": "/portal/service-taker/dashboard",
  "Service Products": "/portal/service-taker/products",
  "Service Inbound": "/portal/service-taker/inbound",
  "Service Shipments": "/portal/service-taker/shipments",
  "Service Charges": "/portal/service-taker/charges",
  "Follow Ups": "/portal/follow-ups",
  Payouts: "/portal/payouts",
  Billings: "/portal/billings",
  "Worker Accounts": "/portal/worker-accounts",
  "Worker Payouts": "/portal/worker-payouts",
  Accounting: "/portal/accounting",
  "Accounting Quicks": "/portal/accounting-quicks",
  Manufacturing: "/portal/manufacturing",
  Production: "/portal/production",
  "My Tasks": "/portal/my-tasks",
  Settings: "/portal/settings",
  "Amazon Settings": "/portal/settings/integrations/amazon",
  "Amazon Listings": "/portal/amazon/listings",
  "Amazon FBA Orders": "/portal/amazon/orders",
  "Amazon FBA Inbound": "/portal/amazon/fba-inbound",
  "Amazon Finances": "/portal/amazon/finances",
  "Amazon Pricing": "/portal/amazon/pricing",
  Reports: "/portal/reports",
  Workers: "/portal/workers",
  Users: "/portal/users",
  Companies: "/portal/companies",
  "Add Company": "/portal/companies/new",
  Login: "/login",
};

const serviceTakerPages = [
  "Service Dashboard",
  "Service Products",
  "Service Inbound",
  "Service Shipments",
  "Service Charges",
];

const PLATFORM_SUPER_ADMIN_PAGES = ["Dashboard", "Companies", "Users", "Settings"];

const rolePages = {
  admin: [
    "Dashboard",
    "Customers",
    "Orders",
    "Payouts",
    "Billings",
    "Accounting",
    "Accounting Quicks",
    "Shipping",
    "Shipping Balance",
    "Warehouse / Fulfillment",
    "Service Takers",
    "Follow Ups",
    "Products",
    "Inventory",
    "Label Printer",
    "Label Printer 2",
    "Suppliers",
    "Manufacturing",
    "Production",
    "Workers",
    "Worker Accounts",
    "Worker Payouts",
    "Reports",
    "Settings",
    "Amazon Settings",
    "Amazon Listings",
    "Amazon FBA Orders",
    "Amazon FBA Inbound",
    "Amazon Finances",
    "Amazon Pricing",
    "Quotes",
    "Users",
    "Inspiration",
    "Website",
    "Deployment",
    "TempData",
    "Messages",
    "Copy Clipboard",
  ],
  manager: [
    "Dashboard",
    "Customers",
    "Orders",
    "Payouts",
    "Billings",
    "Accounting",
    "Shipping",
    "Shipping Balance",
    "Warehouse / Fulfillment",
    "Follow Ups",
    "Products",
    "Inventory",
    "Label Printer",
    "Label Printer 2",
    "Suppliers",
    "Manufacturing",
    "Production",
    "Worker Accounts",
    "Worker Payouts",
    "Reports",
    "Settings",
    "Quotes",
    "Inspiration",
    "Website",
    "TempData",
    "Messages",
    "Copy Clipboard",
  ],
  worker: [
    "Dashboard",
    "My Tasks",
    "Worker Accounts",
    "Worker Payouts",
    "Manufacturing",
    "Production",
    "Messages",
    "Settings",
  ],
  warehouse: [
    "Dashboard",
    "Warehouse Dispatch",
    "Warehouse Shipments",
    "Warehouse Stock",
    "Label Printer",
    "Messages",
    "Settings",
  ],
  school: [],
  service_taker: serviceTakerPages,
};

rolePages.super_admin = PLATFORM_SUPER_ADMIN_PAGES;

const pathToPage = Object.fromEntries(
  Object.entries(pagePaths).map(([page, path]) => [path, page])
);
pathToPage["/portal/"] = "Dashboard";
pathToPage["/portal/payments"] = "Billings";
pathToPage["/portal/amazon/fba-inventory"] = "Products";
pathToPage["/portal/service-taker"] = "Service Dashboard";
pathToPage["/website"] = "WebsiteStorefront";
pathToPage["/website/catalog"] = "WebsiteCatalog";

const schoolWorkspacePages = new Set([
  "School ERP",
  "School Students",
  "School Settings",
  "School Foundation",
  "School Admission Apply",
  "School Attendance",
  "School Finance",
]);

const isSchoolWorkspacePage = (page) => schoolWorkspacePages.has(page);

const normalizePath = (pathname) => {
  if (!pathname) return "/portal";
  const cleaned = pathname.replace(/\/+$|^\/+/g, "");
  if (cleaned === "portal") return "/portal";
  return `/${cleaned}`;
};

const pageFromPath = (pathname) => {
  const path = normalizePath(pathname);
  if (path === "/website") return "WebsiteStorefront";
  if (path === "/portal/website") return "Website";
  if (pathToPage[path]) return pathToPage[path];
  if (/^\/portal\/orders\/\d+$/.test(path)) return "Orders";
  if (/^\/portal\/suppliers\/\d+(?:\/ledger)?$/.test(path)) return "Suppliers";
  return "Dashboard";
};

const isSupplierLedgerPath = (pathname) =>
  /^\/portal\/suppliers\/\d+\/ledger\/?$/.test(normalizePath(pathname));

const normalizeClientAllowedPages = (pages = [], role = "", impersonatedBySuperAdmin = false) => {
  if (impersonatedBySuperAdmin) return rolePages.admin;
  if (role === "service_taker") return serviceTakerPages;
  if (role === "super_admin") return PLATFORM_SUPER_ADMIN_PAGES;
  const normalized = [];

  pages.forEach((page) => {
    if (page === "Accounting") page = "Accounting Quicks";
    if (page === "Payments") page = "Billings";
    if (page === "Amazon FBA Inventory") page = "Products";
    if (!normalized.includes(page)) normalized.push(page);
  });

  if ((role === "admin" || role === "manager")) {
    if (!normalized.includes("Accounting Quicks")) normalized.push("Accounting Quicks");
    if (!normalized.includes("Accounting")) normalized.push("Accounting");
  }

  if (role === "admin" && !normalized.includes("Deployment")) normalized.push("Deployment");
  if ((role === "admin" || role === "manager" || role === "worker")) {
    if (!normalized.includes("Worker Accounts")) normalized.push("Worker Accounts");
  }
  if (!normalized.includes("Dashboard")) normalized.unshift("Dashboard");
  return normalized;
};

class GlobalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught ERP Portal Error:", error, errorInfo);
  }

  handleReset = () => {
    try {
      window.localStorage.removeItem("erpUser");
    } catch (e) {
      console.error(e);
    }
    window.location.href = "/login";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "30px",
          backgroundColor: "#fbfbf9",
          color: "#1c1917",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif"
        }}>
          <h2 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "8px" }}>Portal Error Detected</h2>
          <p style={{ fontSize: "13px", color: "#dc2626", marginBottom: "16px", background: "#fef2f2", padding: "10px 16px", borderRadius: "8px", border: "1px solid #fee2e2", fontFamily: "monospace", maxWidth: "600px", wordBreak: "break-word" }}>
            {this.state.error?.toString() || "Unknown Error"}
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                padding: "10px 18px",
                backgroundColor: "#1c1917",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer"
              }}
            >
              Reload Workspace
            </button>
            <button
              onClick={this.handleReset}
              style={{
                padding: "10px 18px",
                backgroundColor: "#fafaf9",
                border: "1px solid #e7e5e4",
                color: "#1c1917",
                borderRadius: "8px",
                fontWeight: "600",
                cursor: "pointer"
              }}
            >
              Sign In Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const getSavedUser = () => {
  try {
    const savedUser = window.localStorage.getItem("erpUser");
    return savedUser ? JSON.parse(savedUser) : null;
  } catch (error) {
    console.error("Error reading saved user:", error);
    return null;
  }
};

function App() {
  const parsedSavedUser = getSavedUser();
  const [authenticatedUser, setAuthenticatedUser] = useState(
    parsedSavedUser
  );
  const [activePage, setActivePage] = useState(() => {
    const requestedPage = pageFromPath(window.location.pathname);
    if (parsedSavedUser?.role === "service_taker") {
      return serviceTakerPages.includes(requestedPage)
        ? requestedPage
        : "Service Dashboard";
    }
    return parsedSavedUser?.role === "school" && !isSchoolWorkspacePage(requestedPage)
      ? "School ERP"
      : requestedPage;
  });
  const [logoutMessage, setLogoutMessage] = useState("");
  const [orderDraftCustomerId, setOrderDraftCustomerId] = useState(null);
  const [sidebarCounts, setSidebarCounts] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("erpSidebarCollapsed") === "true"
  );
  const [schoolSettings, setSchoolSettings] = useState(DEFAULT_SCHOOL_SETTINGS);
  const [schoolAccess, setSchoolAccess] = useState(null);
  const [showSchoolSplash, setShowSchoolSplash] = useState(() =>
    isSchoolWorkspacePage(pageFromPath(window.location.pathname))
  );
  const lastActivityPageRef = useRef("");

  const rawAllowedPages = authenticatedUser
    ? Array.isArray(authenticatedUser.allowed_pages)
      ? authenticatedUser.allowed_pages
      : rolePages[authenticatedUser.role] || rolePages.worker
    : [];
  const normalizedAllowedPages = normalizeClientAllowedPages(
    rawAllowedPages,
    authenticatedUser?.role,
    authenticatedUser?.impersonatedBySuperAdmin
  );
  const allowedPageKey = normalizedAllowedPages.join("|");
  const schoolWorkspaceActive = isSchoolWorkspacePage(activePage);
  const [tenantModules, setTenantModules] = useState([]);

  useEffect(() => {
    if (!authenticatedUser) return;
    let cancelled = false;
    api
      .get("/modules")
      .then((res) => {
        if (!cancelled && Array.isArray(res.data)) {
          setTenantModules(res.data);
        }
      })
      .catch(() => {
        if (!cancelled) setTenantModules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedUser?.tenant_id, authenticatedUser?.impersonatedBySuperAdmin]);

  const hasSchoolPortalAccess = useMemo(() => {
    if (!authenticatedUser) return false;
    if (authenticatedUser.role === "super_admin") return true;
    if (!Array.isArray(tenantModules) || tenantModules.length === 0) return true;
    const schoolMod = tenantModules.find(
      (m) => m.slug === "school-erp" || m.page_name === "School ERP" || m.name === "School ERP"
    );
    return schoolMod ? Boolean(schoolMod.enabled) : true;
  }, [authenticatedUser, tenantModules]);

  useEffect(() => {
    if (!authenticatedUser) return;
    let cancelled = false;
    api
      .get("/school/settings")
      .then((response) => {
        if (!cancelled) setSchoolSettings(normalizeSchoolSettings(response.data));
      })
      .catch(() => {
        if (!cancelled) setSchoolSettings(DEFAULT_SCHOOL_SETTINGS);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedUser]);

  useEffect(() => {
    if (!authenticatedUser) return undefined;
    let cancelled = false;
    api
      .get("/school/foundation/me")
      .then((response) => {
        if (!cancelled) setSchoolAccess(response.data || null);
      })
      .catch(() => {
        if (!cancelled) setSchoolAccess(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedUser]);

  useEffect(() => {
    if (!showSchoolSplash) return undefined;
    const timer = window.setTimeout(() => setShowSchoolSplash(false), 1280);
    return () => window.clearTimeout(timer);
  }, [showSchoolSplash]);

  useEffect(() => {
    const handlePopState = () => {
      const nextPage = pageFromPath(window.location.pathname);
      setActivePage(nextPage);
      window.dispatchEvent(
        new CustomEvent("erp:navigation", {
          detail: { page: nextPage, source: "history" },
        })
      );
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const logoutWithMessage = useCallback((message) => {
    setAuthenticatedUser(null);
    setSchoolAccess(null);
    setSidebarCounts({});
    clearAuthenticatedUser();
    window.history.pushState({}, "", "/login");
    setActivePage("Login");
    setLogoutMessage(message);
  }, []);

  const checkUserStatus = useCallback(async () => {
    if (!authenticatedUser) return;

    try {
      const response = await api.get(`/users/${authenticatedUser.id}`, {
        headers: { "X-ERP-Tenant-Id": "" },
      });
      const freshUser = response.data;
      if (!freshUser.is_active) {
        logoutWithMessage("Your account has been deactivated. Contact admin.");
        return;
      }

      const refreshedUser = {
        ...authenticatedUser,
        ...freshUser,
        role: authenticatedUser.role,
        tenant_id: authenticatedUser.impersonatedBySuperAdmin ? authenticatedUser.tenant_id : freshUser.tenant_id,
        tenant_name: authenticatedUser.impersonatedBySuperAdmin ? authenticatedUser.tenant_name : freshUser.tenant_name,
        tenant_slug: authenticatedUser.impersonatedBySuperAdmin ? authenticatedUser.tenant_slug : freshUser.tenant_slug,
        impersonatedBySuperAdmin: authenticatedUser.impersonatedBySuperAdmin,
        access_token: authenticatedUser.access_token,
        token_type: authenticatedUser.token_type,
      };

      if (JSON.stringify(refreshedUser) !== JSON.stringify(authenticatedUser)) {
        setAuthenticatedUser(refreshedUser);
        saveAuthenticatedUser(refreshedUser);
      }
    } catch (error) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        logoutWithMessage("Your session expired. Please sign in again.");
        return;
      }
      if (status === 404) {
        logoutWithMessage("Your account no longer exists. Contact admin.");
        return;
      }
      console.error("User status check failed:", error);
    }
  }, [authenticatedUser, logoutWithMessage]);

  useEffect(() => {
    if (!authenticatedUser) return;

    const load = async () => {
      await checkUserStatus();
    };

    load();
    const intervalId = setInterval(checkUserStatus, 60000);
    return () => clearInterval(intervalId);
  }, [authenticatedUser, checkUserStatus]);

  useEffect(() => {
    const sidebarUserId = authenticatedUser?.id;
    const sidebarRole = authenticatedUser?.role;
    const sidebarWorkerId = authenticatedUser?.worker_id;

    if (!sidebarUserId) {
      return undefined;
    }

    let active = true;
    const allowedPagesForCounts = allowedPageKey.split("|");

    const loadSidebarCounts = async () => {
      const nextCounts = {};

      try {
        if (sidebarRole === "worker" && sidebarWorkerId) {
          const [orderTasksResponse, productionTasksResponse] = await Promise.all([
            api.get("/order-workflow/tasks", {
              params: { worker_id: sidebarWorkerId },
            }),
            api.get("/production/tasks", {
              params: { worker_id: sidebarWorkerId },
            }),
          ]);
          const openOrderTasks = Array.isArray(orderTasksResponse.data)
            ? orderTasksResponse.data.filter(
                (task) =>
                  task.status !== "Completed" && task.status !== "Canceled"
              )
            : [];
          const openProductionTasks = Array.isArray(productionTasksResponse.data)
            ? productionTasksResponse.data.filter(
                (task) => task.status !== "Completed"
              )
            : [];
          nextCounts["My Tasks"] =
            openOrderTasks.length + openProductionTasks.length;
        }

        if (
          ["admin", "manager", "warehouse", "super_admin"].includes(sidebarRole) &&
          allowedPagesForCounts.includes("Shipping")
        ) {
          const response = await api.get("/dashboard-stats");
          nextCounts.Shipping = Number(response.data?.pending_shipping_orders || 0);
        }

        if (
          ["admin", "manager", "warehouse", "super_admin"].includes(sidebarRole) &&
          (allowedPagesForCounts.includes("Warehouse / Fulfillment") ||
            allowedPagesForCounts.includes("Warehouse Dispatch"))
        ) {
          const response = await api.get("/fulfillment/dashboard");
          const unfulfilledCount = Number(
            response.data?.stats?.unfulfilled_orders || 0
          );
          nextCounts["Warehouse / Fulfillment"] = unfulfilledCount;
          nextCounts["Warehouse Dispatch"] = unfulfilledCount;
        }

        if (allowedPagesForCounts.includes("Messages")) {
          const response = await api.get("/internal-messages/unread-count");
          nextCounts.Messages = Number(response.data?.unread_count || 0);
        }

        if (active) setSidebarCounts(nextCounts);
      } catch (error) {
        console.warn("Sidebar counts could not be loaded.", error);
      }
    };

    const initialLoadId = setTimeout(loadSidebarCounts, 0);
    const intervalId = setInterval(loadSidebarCounts, 120000);
    return () => {
      active = false;
      clearTimeout(initialLoadId);
      clearInterval(intervalId);
    };
  }, [
    allowedPageKey,
    authenticatedUser?.id,
    authenticatedUser?.role,
    authenticatedUser?.tenant_id,
    authenticatedUser?.worker_id,
    authenticatedUser?.impersonatedBySuperAdmin,
  ]);

  useEffect(() => {
    if (!authenticatedUser?.id) return;
    const page = isSchoolWorkspacePage(activePage)
      ? activePage
      : allowedPageKey.split("|").includes(activePage)
        ? activePage
        : "Dashboard";
    const key = `${authenticatedUser.id}:${page}`;
    if (lastActivityPageRef.current === key) return;

    lastActivityPageRef.current = key;
    api
      .post("/activity-logs/page-view", {
        user_id: authenticatedUser.id,
        user_name: authenticatedUser.name || authenticatedUser.username,
        page,
      })
      .catch((activityError) => {
        console.warn("Activity page view could not be logged.", activityError);
      });
  }, [
    activePage,
    allowedPageKey,
    authenticatedUser?.id,
    authenticatedUser?.name,
    authenticatedUser?.username,
  ]);

  const isPublicPage = (page) => ["WebsiteStorefront", "WebsiteCatalog", "School Admission Apply"].includes(page);

  useEffect(() => {
    if (authenticatedUser || isPublicPage(activePage) || activePage === "Login") return;
    if (window.location.pathname !== "/login") {
      window.history.replaceState({}, "", "/login");
    }
    setActivePage("Login");
  }, [activePage, authenticatedUser]);

  const updatePath = (page) => {
    const isWorkspacePage = isSchoolWorkspacePage(page);
    const targetPage = isPublicPage(page) || isWorkspacePage
      ? page
      : authenticatedUser && !normalizedAllowedPages.includes(page)
      ? "Dashboard"
      : page;
    const nextPath = pagePaths[targetPage] || "/portal";
    if (
      !isSchoolWorkspacePage(activePage) &&
      isSchoolWorkspacePage(targetPage) &&
      schoolSettings.splash_enabled
    ) {
      setShowSchoolSplash(true);
    } else if (!isSchoolWorkspacePage(targetPage)) {
      setShowSchoolSplash(false);
    }
    const pathChanged =
      `${window.location.pathname}${window.location.search}` !== nextPath;
    if (pathChanged) {
      window.history.pushState({}, "", nextPath);
    }
    window.dispatchEvent(
      new CustomEvent("erp:navigation", {
        detail: {
          page: targetPage,
          source: pathChanged ? "navigation" : "reselect",
        },
      })
    );
    setActivePage(targetPage);
  };

  const handleLoginSuccess = (user) => {
    setAuthenticatedUser(user);
    setSchoolAccess(null);
    setLogoutMessage("");
    saveAuthenticatedUser(user);
    const requestedPage = pageFromPath(window.location.pathname);
    updatePath(
      user.role === "school"
        ? "School ERP"
        : user.role === "service_taker"
          ? serviceTakerPages.includes(requestedPage)
            ? requestedPage
            : "Service Dashboard"
          : "Dashboard"
    );
  };

  const clearLogoutMessage = () => {
    setLogoutMessage("");
  };

  const handleUserUpdate = (user) => {
    setAuthenticatedUser(user);
    saveAuthenticatedUser(user);
  };

  const handleCreateOrderForCustomer = (customerId) => {
    setOrderDraftCustomerId(customerId);
    updatePath("Orders");
  };

  const clearOrderDraftCustomer = useCallback(() => {
    setOrderDraftCustomerId(null);
  }, []);

  const handleLogout = () => logoutWithMessage("");

  const handleSwitchToCompanyPortal = (tenant) => {
    if (!authenticatedUser || (authenticatedUser.role !== "super_admin" && !authenticatedUser.impersonatedBySuperAdmin)) return;
    const updatedUser = {
      ...authenticatedUser,
      tenant_id: tenant.id,
      tenant_name: tenant.company_name,
      tenant_slug: tenant.slug,
      impersonatedBySuperAdmin: true,
    };
    setAuthenticatedUser(updatedUser);
    saveAuthenticatedUser(updatedUser);
    updatePath("Dashboard");
  };

  const handleReturnToSuperAdmin = () => {
    if (!authenticatedUser?.impersonatedBySuperAdmin) return;
    const superAdminUser = {
      ...authenticatedUser,
      tenant_id: null,
      tenant_name: null,
      tenant_slug: null,
      impersonatedBySuperAdmin: false,
    };
    setAuthenticatedUser(superAdminUser);
    saveAuthenticatedUser(superAdminUser);
    updatePath("Dashboard");
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("erpSidebarCollapsed", String(next));
      return next;
    });
  };

  const renderPage = () => {
    if (activePage === "WebsiteStorefront" || activePage === "WebsiteCatalog") {
      return <WebsiteCatalog />;
    }

    if (activePage === "School Admission Apply") {
      return <SchoolAdmissionApply settings={schoolSettings} />;
    }

    if (!authenticatedUser) {
      return (
        <Login
          onLogin={handleLoginSuccess}
          message={logoutMessage}
          onClearMessage={clearLogoutMessage}
        />
      );
    }

    const dashboardProps = {
      userEmail: authenticatedUser.email,
      userName: authenticatedUser.name,
      userPhone: authenticatedUser.phone,
      userRole: authenticatedUser.role,
      workerId: authenticatedUser.worker_id,
    };

    if (activePage === "School ERP") {
      return <SchoolDashboard authenticatedUser={authenticatedUser} settings={schoolSettings} />;
    }
    if (activePage === "School Students") {
      return <SchoolStudents settings={schoolSettings} permissions={schoolAccess?.permissions} />;
    }
    if (activePage === "School Attendance") {
      return <SchoolAttendance settings={schoolSettings} permissions={schoolAccess?.permissions} />;
    }
    if (activePage === "School Finance") {
      return <SchoolFinance settings={schoolSettings} permissions={schoolAccess?.permissions} />;
    }
    if (activePage === "School Settings") {
      return (
        <SchoolSettings
          settings={schoolSettings}
          onSettingsChange={(nextSettings) =>
            setSchoolSettings(normalizeSchoolSettings(nextSettings))
          }
        />
      );
    }
    if (activePage === "School Foundation") {
      return <SchoolFoundation settings={schoolSettings} />;
    }

    if (!normalizedAllowedPages.includes(activePage)) {
      return authenticatedUser?.role === "super_admin" && !authenticatedUser?.impersonatedBySuperAdmin ? (
        <SuperAdminDashboard authenticatedUser={authenticatedUser} onNavigate={updatePath} onSwitchToCompanyPortal={handleSwitchToCompanyPortal} />
      ) : (
        <Dashboard {...dashboardProps} />
      );
    }

    if (activePage === "Dashboard") {
      return authenticatedUser?.role === "super_admin" && !authenticatedUser?.impersonatedBySuperAdmin ? (
        <SuperAdminDashboard authenticatedUser={authenticatedUser} onNavigate={updatePath} onSwitchToCompanyPortal={handleSwitchToCompanyPortal} />
      ) : (
        <Dashboard {...dashboardProps} />
      );
    }
    if (activePage === "Products") {
      const legacyAmazonInventoryPath =
        normalizePath(window.location.pathname) ===
        "/portal/amazon/fba-inventory";
      const requestedProductsTab = new URLSearchParams(
        window.location.search
      ).get("tab");
      return (
        <Products
          authenticatedUser={authenticatedUser}
          initialCatalogTab={
            legacyAmazonInventoryPath || requestedProductsTab === "amazon"
              ? "amazon"
              : "products"
          }
          userRole={authenticatedUser.role}
        />
      );
    }
    if (activePage === "Inventory") return <Inventory />;
    if (activePage === "Label Printer") return <LabelPrinter />;
    if (activePage === "Label Printer 2") return <LabelPrinter2 />;
    if (activePage === "Inspiration") return <Inspiration />;
    if (activePage === "Quotes") return <Quotes />;
    if (activePage === "TempData") return <TempData />;
    if (activePage === "Messages") return <Messages />;
    if (activePage === "Customers") {
      return (
        <Customers
          onCreateOrder={
            normalizedAllowedPages.includes("Orders")
              ? handleCreateOrderForCustomer
              : null
          }
        />
      );
    }
    if (activePage === "Suppliers") {
      return isSupplierLedgerPath(window.location.pathname) ? (
        <SupplierLedger />
      ) : (
        <Suppliers />
      );
    }
    if (activePage === "Orders") {
      return (
        <Orders
          initialCustomerId={orderDraftCustomerId}
          onInitialCustomerHandled={clearOrderDraftCustomer}
        />
      );
    }
    if (activePage === "Shipping") {
      return <Shipping userRole={authenticatedUser.role} />;
    }
    if (activePage === "Shipping Balance") return <ShippingBalance />;
    if (activePage === "Service Takers") return <ServiceTakers />;
    if (serviceTakerPages.includes(activePage)) {
      const portalSection =
        activePage === "Service Dashboard"
          ? "dashboard"
          : activePage === "Service Inbound"
          ? "inbound"
          : activePage === "Service Shipments"
            ? "orders"
            : activePage === "Service Charges"
              ? "billing"
              : "inventory";
      return <ServiceTakerPortal section={portalSection} />;
    }
    if (
      [
        "Warehouse / Fulfillment",
        "Warehouse Dispatch",
        "Warehouse Shipments",
        "Warehouse Stock",
      ].includes(activePage)
    ) {
      const fulfillmentInitialTab =
        activePage === "Warehouse Shipments"
          ? "shipments"
          : activePage === "Warehouse Stock"
            ? "inventory"
            : "orders";
      const handleWarehouseTabChange =
        authenticatedUser.role === "warehouse"
          ? (tab) =>
              updatePath(
                tab === "shipments"
                  ? "Warehouse Shipments"
                  : tab === "inventory"
                    ? "Warehouse Stock"
                    : "Warehouse Dispatch"
              )
          : null;
      return (
        <Fulfillment
          initialTab={fulfillmentInitialTab}
          onWarehouseTabChange={handleWarehouseTabChange}
          userRole={authenticatedUser.role}
        />
      );
    }
    if (activePage === "Follow Ups") return <FollowUps />;
    if (activePage === "Payouts") return <Payouts />;
    if (activePage === "Billings") return <Payments />;
    if (activePage === "Worker Payouts") {
      return (
        <WorkerPayouts
          userRole={authenticatedUser.role}
          workerId={authenticatedUser.worker_id}
          userName={authenticatedUser.name || authenticatedUser.username}
        />
      );
    }
    if (activePage === "Accounting") return <Accounting />;
    if (activePage === "Accounting Quicks") return <AccountingQuicks />;
    if (activePage === "Manufacturing") return <Manufacturing />;
    if (activePage === "Production") return <Production />;
    if (activePage === "My Tasks") return <MyTasks workerId={authenticatedUser.worker_id} />;
    if (activePage === "Settings") return <Settings authenticatedUser={authenticatedUser} onUpdateUser={handleUserUpdate} />;
    if (activePage === "Amazon Settings") return <AmazonSettings authenticatedUser={authenticatedUser} />;
    if (activePage === "Amazon Listings") return <AmazonListings authenticatedUser={authenticatedUser} />;
    if (activePage === "Amazon FBA Orders") {
      return <AmazonOrders authenticatedUser={authenticatedUser} />;
    }
    if (activePage === "Amazon FBA Inbound") {
      return <AmazonFbaInbound authenticatedUser={authenticatedUser} />;
    }
    if (activePage === "Amazon Finances") {
      return <AmazonFinances authenticatedUser={authenticatedUser} />;
    }
    if (activePage === "Amazon Pricing") {
      return <AmazonPricing authenticatedUser={authenticatedUser} />;
    }
    if (activePage === "Reports") return <Reports />;
    if (activePage === "Website") return <WebsiteAdmin />;
    if (activePage === "Deployment") return <Deployment />;
    if (activePage === "Workers") return <Workers />;
    if (activePage === "Worker Accounts") return <Suppliers />;
    if (activePage === "Users") return <Users authenticatedUser={authenticatedUser} />;
    if (activePage === "Companies" || activePage === "Add Company") {
      return (
        <Companies
          authenticatedUser={authenticatedUser}
          focusCreate={activePage === "Add Company"}
          onSwitchToCompanyPortal={handleSwitchToCompanyPortal}
        />
      );
    }
    if (activePage === "Label Printer") return <LabelPrinter />;
    if (activePage === "Label Printer 2") return <LabelPrinter2 />;
    if (activePage === "Copy Clipboard") return <CopyClipboard />;

    return <Dashboard />;
  };

  return (
    <GlobalErrorBoundary>
      <InternalCallProvider
        user={
          ["school", "service_taker"].includes(authenticatedUser?.role)
            ? null
            : authenticatedUser
        }
      >
        <div
          className={`app-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${
            schoolWorkspaceActive ? "school-workspace-layout" : ""
          }`.trim()}
          style={schoolWorkspaceActive ? schoolThemeStyle(schoolSettings) : undefined}
          dir={schoolWorkspaceActive && schoolSettings.interface_language === "ur" ? "rtl" : undefined}
        >
          {authenticatedUser && schoolWorkspaceActive && showSchoolSplash && (
            <SchoolSplash settings={schoolSettings} />
          )}
          {authenticatedUser && !isPublicPage(activePage) && (
            <Sidebar
              activePage={activePage}
              setActivePage={updatePath}
              workspace={schoolWorkspaceActive ? "school" : "factory"}
              schoolSettings={schoolSettings}
              schoolPermissions={schoolAccess?.permissions}
              canSwitchToFactory={["admin", "super_admin"].includes(authenticatedUser.role)}
              canSwitchToSchool={hasSchoolPortalAccess && ["admin", "super_admin"].includes(authenticatedUser.role)}
              onSwitchWorkspace={
                ["admin", "super_admin"].includes(authenticatedUser.role)
                  ? () => updatePath(schoolWorkspaceActive ? "Dashboard" : "School ERP")
                  : undefined
              }
              userRole={authenticatedUser?.role}
              authenticatedUser={authenticatedUser}
              allowedPages={normalizedAllowedPages}
              notificationCounts={sidebarCounts}
              collapsed={sidebarCollapsed}
              onToggleCollapse={toggleSidebar}
              onLogout={handleLogout}
              onReturnToSuperAdmin={handleReturnToSuperAdmin}
            />
          )}

          <main
            className={`main-content ${authenticatedUser || isPublicPage(activePage) ? "" : "login-page"} ${
              isPublicPage(activePage)
                ? "public-website-page"
                : ""
            }`}
          >
            <Suspense fallback={<div className="erp-page-loading">Loading workspace...</div>}>
              {renderPage()}
            </Suspense>
          </main>
        </div>
      </InternalCallProvider>
    </GlobalErrorBoundary>
  );
}

export default App;
