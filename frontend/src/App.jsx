import { Component, lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import "./App.css";

import api from "./api/api";
import { saveAuthenticatedUser, clearAuthenticatedUser } from "./api/auth";
import { InternalCallProvider } from "./components/InternalCallProvider";
import SchoolSplash from "./school/SchoolSplash";
import Sidebar from "./components/sidebar";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import {
 normalizeAppPath,
 routeScopeSlugFromPath,
 scopedAppPath,
} from "./utils/routeUtils";
import "./pages/OperationsSizing.css";
import "./pages/DashboardDesktop.css";
import "./pages/DashboardFocus.css";
import { DEFAULT_SCHOOL_SETTINGS, normalizeSchoolSettings, schoolThemeStyle } from "./school/theme";

const staleChunkReloadKey = "erp.staleChunkReload";

function isStaleChunkError(error) {
  const text = String(error?.message || error || "");
  return text.includes("Failed to fetch dynamically imported module")
    || text.includes("Importing a module script failed")
    || text.includes("error loading dynamically imported module")
    || text.includes("Loading CSS chunk")
    || /Loading chunk [\w-]+ failed/.test(text);
}

function reloadForStaleChunk(error) {
  if (!isStaleChunkError(error)) return false;
  try {
    if (window.sessionStorage.getItem(staleChunkReloadKey) === "1") return false;
    window.sessionStorage.setItem(staleChunkReloadKey, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function loadPage(importer) {
  return () => importer().catch((error) => {
    if (reloadForStaleChunk(error)) return new Promise(() => {});
    throw error;
  });
}

window.addEventListener("unhandledrejection", (event) => {
  if (reloadForStaleChunk(event.reason)) event.preventDefault();
});

const pageImporters = {
  Products: () => import("./pages/Products"),
  Inventory: () => import("./pages/Inventory"),
  Inspiration: () => import("./pages/Inspiration"),
  Customers: () => import("./pages/Customers"),
  Suppliers: () => import("./pages/Suppliers"),
  "Supplier Ledger": () => import("./pages/SupplierLedger"),
  Orders: () => import("./pages/Orders"),
  Manufacturing: () => import("./pages/Manufacturing"),
  Workers: () => import("./pages/Workers"),
  Shipping: () => import("./pages/Shipping"),
  "Shipping Balance": () => import("./pages/ShippingBalance"),
  "Warehouse / Fulfillment": () => import("./pages/Fulfillment"),
  "Warehouse Dispatch": () => import("./pages/Fulfillment"),
  "Warehouse Shipments": () => import("./pages/Fulfillment"),
  "Warehouse Stock": () => import("./pages/Fulfillment"),
  "Label Printer": () => import("./pages/LabelPrinter"),
  "Printer Settings": () => import("./pages/PrinterSettings"),
  "Service Takers": () => import("./pages/ServiceTakers"),
  "Service Dashboard": () => import("./pages/ServiceTakerPortal"),
  "Service Products": () => import("./pages/ServiceTakerPortal"),
  "Service Inbound": () => import("./pages/ServiceTakerPortal"),
  "Service Shipments": () => import("./pages/ServiceTakerPortal"),
  "Service Manufacturing": () => import("./pages/ServiceTakerPortal"),
  "Service Quotations": () => import("./pages/ServiceTakerPortal"),
  "Service Charges": () => import("./pages/ServiceTakerPortal"),
  "Local Orders": () => import("./pages/LocalOrders"),
  "Follow Ups": () => import("./pages/FollowUps"),
  Payouts: () => import("./pages/Payouts"),
  Billings: () => import("./pages/Payments"),
  "Worker Payouts": () => import("./pages/WorkerPayouts"),
  "Worker Accounts": () => import("./pages/WorkerAccounts2"),
  Accounting: () => import("./pages/Accounting"),
  Production: () => import("./pages/Production"),
  "My Tasks": () => import("./pages/MyTasks"),
  Reports: () => import("./pages/Reports"),
  Website: () => import("./pages/WebsiteAdmin"),
  "Website Visitors": () => import("./pages/WebsiteVisitors"),
  Deployment: () => import("./pages/Deployment"),
  WebsiteCatalog: () => import("./pages/WebsiteCatalog"),
  Settings: () => import("./pages/Settings"),
  "Amazon Settings": () => import("./pages/AmazonSettings"),
  "Amazon Listings": () => import("./pages/AmazonListings"),
  "Amazon FBA Orders": () => import("./pages/AmazonOrders"),
  "Amazon FBA Inbound": () => import("./pages/AmazonFbaInbound"),
  "Amazon Finances": () => import("./pages/AmazonFinances"),
  "Amazon Pricing": () => import("./pages/AmazonPricing"),
  Users: () => import("./pages/Users"),
  Companies: () => import("./pages/Companies"),
  "Add Company": () => import("./pages/Companies"),
  Quotes: () => import("./pages/Quotes"),
  TempData: () => import("./pages/TempData"),
  Messages: () => import("./pages/Messages"),
  "Copy Clipboard": () => import("./pages/CopyClipboard"),
  "School ERP": () => import("./school/pages/SchoolDashboard"),
  "School Students": () => import("./school/pages/SchoolStudents"),
  "School Settings": () => import("./school/pages/SchoolSettings"),
  "School Foundation": () => import("./school/pages/SchoolFoundation"),
  "School Admission Apply": () => import("./school/pages/SchoolAdmissionApply"),
  "School Attendance": () => import("./school/pages/SchoolAttendance"),
  "School Finance": () => import("./school/pages/SchoolFinance"),
};

for (const name of Object.keys(pageImporters)) {
  pageImporters[name] = loadPage(pageImporters[name]);
}

const Products = lazy(pageImporters.Products);
const Inventory = lazy(pageImporters.Inventory);
const Inspiration = lazy(pageImporters.Inspiration);
const Customers = lazy(pageImporters.Customers);
const Suppliers = lazy(pageImporters.Suppliers);
const SupplierLedger = lazy(pageImporters["Supplier Ledger"]);
const Orders = lazy(pageImporters.Orders);
const Manufacturing = lazy(pageImporters.Manufacturing);
const Workers = lazy(pageImporters.Workers);
const Shipping = lazy(pageImporters.Shipping);
const ShippingBalance = lazy(pageImporters["Shipping Balance"]);
const Fulfillment = lazy(pageImporters["Warehouse / Fulfillment"]);
const LabelPrinter = lazy(pageImporters["Label Printer"]);
const PrinterSettings = lazy(pageImporters["Printer Settings"]);
const ServiceTakers = lazy(pageImporters["Service Takers"]);
const ServiceTakerPortal = lazy(pageImporters["Service Dashboard"]);
const LocalOrders = lazy(pageImporters["Local Orders"]);
const FollowUps = lazy(pageImporters["Follow Ups"]);
const Payouts = lazy(pageImporters.Payouts);
const Payments = lazy(pageImporters.Billings);
const WorkerPayouts = lazy(pageImporters["Worker Payouts"]);
const WorkerAccounts2 = lazy(pageImporters["Worker Accounts"]);
const Accounting = lazy(pageImporters.Accounting);
const Production = lazy(pageImporters.Production);
const MyTasks = lazy(pageImporters["My Tasks"]);
const Reports = lazy(pageImporters.Reports);
const WebsiteAdmin = lazy(pageImporters.Website);
const WebsiteVisitors = lazy(pageImporters["Website Visitors"]);
const Deployment = lazy(pageImporters.Deployment);
const WebsiteCatalog = lazy(pageImporters.WebsiteCatalog);
const Settings = lazy(pageImporters.Settings);
const AmazonSettings = lazy(pageImporters["Amazon Settings"]);
const AmazonListings = lazy(pageImporters["Amazon Listings"]);
const AmazonOrders = lazy(pageImporters["Amazon FBA Orders"]);
const AmazonFbaInbound = lazy(pageImporters["Amazon FBA Inbound"]);
const AmazonFinances = lazy(pageImporters["Amazon Finances"]);
const AmazonPricing = lazy(pageImporters["Amazon Pricing"]);
const Users = lazy(pageImporters.Users);
const Companies = lazy(pageImporters.Companies);
const SuperAdminDashboard = lazy(loadPage(() => import("./pages/SuperAdminDashboard")));
const Quotes = lazy(pageImporters.Quotes);
const TempData = lazy(pageImporters.TempData);
const Messages = lazy(pageImporters.Messages);
const CopyClipboard = lazy(pageImporters["Copy Clipboard"]);
const SchoolDashboard = lazy(pageImporters["School ERP"]);
const SchoolStudents = lazy(pageImporters["School Students"]);
const SchoolSettings = lazy(pageImporters["School Settings"]);
const SchoolFoundation = lazy(pageImporters["School Foundation"]);
const SchoolAdmissionApply = lazy(pageImporters["School Admission Apply"]);
const SchoolAttendance = lazy(pageImporters["School Attendance"]);
const SchoolFinance = lazy(pageImporters["School Finance"]);

const prefetchedPages = new Set();
const prefetchPageModule = (pageName) => {
  const importer = pageImporters[pageName];
  if (!importer || prefetchedPages.has(pageName)) return;
  prefetchedPages.add(pageName);
  importer().catch(() => {
    prefetchedPages.delete(pageName);
  });
};

const pagePaths = {
  Dashboard: "/portal",
  Products: "/portal/products",
  Inventory: "/portal/inventory",
  Inspiration: "/portal/inspiration",
  Quotes: "/portal/quotes",
  Website: "/portal/website",
  "Website Visitors": "/portal/website-visitors",
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
  "Local Orders": "/portal/local-orders",
  Shipping: "/portal/shipping",
  "Shipping Balance": "/portal/shipping-balance",
  "Warehouse / Fulfillment": "/portal/fulfillment",
  "Warehouse Dispatch": "/portal/warehouse/dispatch",
  "Warehouse Shipments": "/portal/warehouse/shipments",
  "Warehouse Stock": "/portal/warehouse/stock",
  "Label Printer": "/portal/label-printer",
  "Printer Settings": "/portal/printer-settings",
  "Service Takers": "/portal/service-takers",
  "Service Dashboard": "/portal/service-taker/dashboard",
  "Service Products": "/portal/service-taker/products",
  "Service Inbound": "/portal/service-taker/inbound",
  "Service Shipments": "/portal/service-taker/shipments",
  "Service Manufacturing": "/portal/service-taker/local-orders",
  "Service Quotations": "/portal/service-taker/quotations",
  "Service Charges": "/portal/service-taker/charges",
  "Follow Ups": "/portal/follow-ups",
  Payouts: "/portal/payouts",
  Billings: "/portal/billings",
  "Worker Accounts": "/portal/worker-accounts",
  "Worker Payouts": "/portal/worker-payouts",
  Accounting: "/portal/accounting",
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
  "Service Manufacturing",
  "Service Charges",
];

const PLATFORM_SUPER_ADMIN_PAGES = ["Dashboard", "Companies", "Users", "Settings"];

const rolePages = {
  admin: [
    "Dashboard",
    "Customers",
    "Orders",
    "Local Orders",
    "Payouts",
    "Billings",
    "Accounting",
    "Shipping",
    "Shipping Balance",
    "Warehouse Dispatch",
    "Warehouse Shipments",
    "Warehouse Stock",
    "Service Takers",
    "Follow Ups",
    "Products",
    "Inventory",
    "Label Printer",
    "Printer Settings",
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
    "Website Visitors",
    "Deployment",
    "TempData",
    "Messages",
    "Copy Clipboard",
  ],
  manager: [
    "Dashboard",
    "Customers",
    "Orders",
    "Local Orders",
    "Payouts",
    "Billings",
    "Accounting",
    "Shipping",
    "Shipping Balance",
    "Warehouse Dispatch",
    "Warehouse Shipments",
    "Warehouse Stock",
    "Follow Ups",
    "Products",
    "Inventory",
    "Label Printer",
    "Printer Settings",
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
    "Website Visitors",
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
pathToPage["/portal/service-taker/manufacturing"] = "Service Manufacturing";
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

const publicPages = new Set(["WebsiteStorefront", "WebsiteCatalog", "School Admission Apply"]);

const isSchoolWorkspacePage = (page) => schoolWorkspacePages.has(page);
const isPublicPage = (page) => publicPages.has(page);

const normalizePath = normalizeAppPath;

const pageFromPath = (pathname) => {
  const path = normalizePath(pathname);
  if (path === "/") return "Login";
  if (path === "/website") return "WebsiteStorefront";
  if (path === "/portal/website") return "Website";
  if (pathToPage[path]) return pathToPage[path];
  if (/^\/portal\/orders\/\d+$/.test(path)) return "Orders";
  if (/^\/portal\/worker-accounts\/suppliers\/\d+$/.test(path)) return "Worker Accounts";
  if (/^\/portal\/suppliers\/\d+(?:\/ledger)?$/.test(path)) return "Suppliers";
  return "Dashboard";
};

const isSupplierLedgerPath = (pathname) =>
  /^\/portal\/suppliers\/\d+\/ledger\/?$/.test(normalizePath(pathname));


const normalizeClientAllowedPages = (pages = [], role = "", impersonatedBySuperAdmin = false) => {
  if (impersonatedBySuperAdmin) return rolePages.admin;
  if (role === "service_taker") {
    const visibleServicePages = (Array.isArray(pages) ? pages : [])
      .filter((page) => serviceTakerPages.includes(page));
    const hasFulfillmentPage = visibleServicePages.some((page) =>
      ['Service Inbound', 'Service Shipments'].includes(page)
    );
    if (
      visibleServicePages.includes("Service Charges") &&
      !hasFulfillmentPage &&
      !visibleServicePages.includes("Service Manufacturing")
    ) {
      const insertAt = visibleServicePages.includes("Service Dashboard") ? 1 : 0;
      visibleServicePages.splice(insertAt, 0, "Service Manufacturing");
    }
    return visibleServicePages.length ? visibleServicePages : ["Service Dashboard"];
  }
  if (role === "super_admin") return PLATFORM_SUPER_ADMIN_PAGES;
  const normalized = [];

  pages.forEach((page) => {
    if (page === "Payments") page = "Billings";
    if (page === "Amazon FBA Inventory") page = "Products";
    if (page === "Warehouse / Fulfillment") {
      ["Warehouse Dispatch", "Warehouse Shipments", "Warehouse Stock"].forEach(
        (warehousePage) => {
          if (!normalized.includes(warehousePage)) normalized.push(warehousePage);
        }
      );
      return;
    }
    if (!normalized.includes(page)) normalized.push(page);
  });


  if ((role === "admin" || role === "manager" || role === "worker") && normalized.includes("Workers")) {
    if (!normalized.includes("Worker Accounts")) normalized.push("Worker Accounts");
  }
  if (normalized.includes("Website") && !normalized.includes("Website Visitors")) {
    normalized.push("Website Visitors");
  }
  if (normalized.includes("Label Printer") || normalized.includes("Settings")) {
    if (!normalized.includes("Printer Settings")) normalized.push("Printer Settings");
  }
  if (!normalized.includes("Dashboard")) normalized.unshift("Dashboard");
  return normalized;
};

const TENANT_MODULE_ALWAYS_VISIBLE_PAGES = new Set(["Dashboard"]);
const TENANT_MODULE_PAGE_ALIASES = {
  "Printer Settings": "Label Printer",
  "Worker Accounts": "Workers",
  "Warehouse Dispatch": "Warehouse / Fulfillment",
  "Warehouse Shipments": "Warehouse / Fulfillment",
  "Warehouse Stock": "Warehouse / Fulfillment",
};

const tenantModuleControllerPage = (page) => TENANT_MODULE_PAGE_ALIASES[page] || page;

const filterPagesByTenantModules = (pages = [], modules = [], user = null) => {
  if (!user || (user.role === "super_admin" && !user.impersonatedBySuperAdmin)) {
    return pages;
  }
  if (!Array.isArray(modules) || modules.length === 0) return pages;

  const enabledByPage = new Map();
  modules.forEach((module) => {
    if (module?.page_name) enabledByPage.set(module.page_name, Boolean(module.enabled));
  });
  if (enabledByPage.size === 0) return pages;

  return pages.filter((page) => {
    if (TENANT_MODULE_ALWAYS_VISIBLE_PAGES.has(page)) return true;
    const controllerPage = tenantModuleControllerPage(page);
    return !enabledByPage.has(controllerPage) || enabledByPage.get(controllerPage);
  });
};

const allowedPagesForRouteUser = (user, modules = []) => {
  if (!user) return [];
  const pages = Array.isArray(user.allowed_pages)
    ? user.allowed_pages
    : rolePages[user.role] || rolePages.worker;
  return filterPagesByTenantModules(
    normalizeClientAllowedPages(
      pages,
      user.role,
      user.impersonatedBySuperAdmin
    ),
    modules,
    user
  );
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
    if (reloadForStaleChunk(error)) return;
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
    if (requestedPage === "Login") return "Login";
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
  const [currentRoute, setCurrentRoute] = useState(
    () => `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
  const lastActivityPageRef = useRef("");
  const pendingLoginPathRef = useRef("");

  const currentFullPath = () =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  const sanitizeLoginReturnPath = (path) => {
    if (!path) return "";

    try {
      const targetUrl = new URL(path, window.location.origin);
      if (targetUrl.origin !== window.location.origin) return "";

      const normalizedPath = normalizePath(targetUrl.pathname);
      const targetPage = pageFromPath(targetUrl.pathname);
      if (normalizedPath === "/login" || targetPage === "Login") return "";

      return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    } catch {
      return "";
    }
  };

  const getLoginNextPath = () => {
    const params = new URLSearchParams(window.location.search);
    return sanitizeLoginReturnPath(params.get("next"));
  };

  const rememberLoginReturnPath = (path = currentFullPath()) => {
    const returnPath = sanitizeLoginReturnPath(path);
    if (returnPath) pendingLoginPathRef.current = returnPath;
    return returnPath;
  };

  const buildLoginPath = (returnPath = pendingLoginPathRef.current) => {
    const loginPath = scopedAppPath("/login", { preserveCurrentScope: true });
    const safeReturnPath = sanitizeLoginReturnPath(returnPath);
    return safeReturnPath
      ? `${loginPath}?next=${encodeURIComponent(safeReturnPath)}`
      : loginPath;
  };

  const pathAllowedForUser = (path, user) => {
    if (!path || !user) return false;

    const targetPage = pageFromPath(path);
    if (targetPage === "Login") return false;
    if (isPublicPage(targetPage)) return true;
    const modulesForUser = user?.id === authenticatedUser?.id ? tenantModules : [];
    if (user.role === "school") return isSchoolWorkspacePage(targetPage);
    if (user.role === "service_taker") return allowedPagesForRouteUser(user, modulesForUser).includes(targetPage);

    return allowedPagesForRouteUser(user, modulesForUser).includes(targetPage);
  };

  const scopedReturnPathForUser = (path, user) => {
    const targetUrl = new URL(path, window.location.origin);
    const scopedPath = scopedAppPath(normalizePath(targetUrl.pathname), {
      user,
      pathname: targetUrl.pathname,
      preserveCurrentScope: true,
    });
    return `${scopedPath}${targetUrl.search}${targetUrl.hash}`;
  };
  const [tenantModules, setTenantModules] = useState([]);
  const rawAllowedPages = authenticatedUser
    ? Array.isArray(authenticatedUser.allowed_pages)
      ? authenticatedUser.allowed_pages
      : rolePages[authenticatedUser.role] || rolePages.worker
    : [];
  const normalizedAllowedPages = filterPagesByTenantModules(
    normalizeClientAllowedPages(
      rawAllowedPages,
      authenticatedUser?.role,
      authenticatedUser?.impersonatedBySuperAdmin
    ),
    tenantModules,
    authenticatedUser
  );
  const allowedPageKey = normalizedAllowedPages.join("|");
  const schoolWorkspaceActive = isSchoolWorkspacePage(activePage);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { window.sessionStorage.removeItem(staleChunkReloadKey); } catch { /* ignore */ }
    }, 15000);
    return () => window.clearTimeout(timer);
  }, []);

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
    if (authenticatedUser.role === "super_admin" && !authenticatedUser.impersonatedBySuperAdmin) return true;
    if (!Array.isArray(tenantModules) || tenantModules.length === 0) return true;
    const schoolMod = tenantModules.find(
      (m) => m.slug === "school-erp" || m.page_name === "School ERP" || m.name === "School ERP"
    );
    return schoolMod ? Boolean(schoolMod.enabled) : true;
  }, [authenticatedUser, tenantModules]);

  useEffect(() => {
    if (!authenticatedUser || !hasSchoolPortalAccess) return;
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
  }, [authenticatedUser, hasSchoolPortalAccess]);


  useEffect(() => {
    if (!authenticatedUser) return;

    const routeTenantSlug = routeScopeSlugFromPath(window.location.pathname);
    const userTenantSlug =
      authenticatedUser.role === "super_admin" && !authenticatedUser.impersonatedBySuperAdmin
        ? ""
        : (authenticatedUser.tenant_slug || "").trim().toLowerCase();

    if (!routeTenantSlug || !userTenantSlug || routeTenantSlug === userTenantSlug) {
      return;
    }

    const returnPath = rememberLoginReturnPath();
    clearAuthenticatedUser();
    setAuthenticatedUser(null);
    setSchoolAccess(null);
    setSidebarCounts({});
    setLogoutMessage(`Please sign in to the ${routeTenantSlug} company workspace.`);
    setActivePage("Login");
    window.history.replaceState(
      {},
      "",
      buildLoginPath(returnPath)
    );
  }, [
    authenticatedUser?.id,
    authenticatedUser?.role,
    authenticatedUser?.tenant_slug,
    authenticatedUser?.impersonatedBySuperAdmin,
  ]);
  useEffect(() => {
    if (!authenticatedUser || !hasSchoolPortalAccess) return undefined;
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
  }, [authenticatedUser, hasSchoolPortalAccess]);

  useEffect(() => {
    if (!showSchoolSplash) return undefined;
    const timer = window.setTimeout(() => setShowSchoolSplash(false), 1280);
    return () => window.clearTimeout(timer);
  }, [showSchoolSplash]);

  useEffect(() => {
    const readRoute = () =>
      `${window.location.pathname}${window.location.search}${window.location.hash}`;

    const handlePopState = () => {
      const nextPage = pageFromPath(window.location.pathname);
      setCurrentRoute(readRoute());
      setActivePage(nextPage);
      window.dispatchEvent(
        new CustomEvent("erp:navigation", {
          detail: { page: nextPage, source: "history" },
        })
      );
    };

    const handleClientNavigation = (event) => {
      const nextPage =
        event.detail?.page || pageFromPath(window.location.pathname);
      setCurrentRoute(readRoute());
      setActivePage(nextPage);
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("erp:navigation", handleClientNavigation);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("erp:navigation", handleClientNavigation);
    };
  }, []);

  const logoutWithMessage = useCallback((message) => {
    setAuthenticatedUser(null);
    setSchoolAccess(null);
    setSidebarCounts({});
    clearAuthenticatedUser();
    pendingLoginPathRef.current = "";
    window.history.pushState({}, "", "/login");
    setActivePage("Login");
    setLogoutMessage(message);
  }, [authenticatedUser]);

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
      // Load each badge independently so one failing endpoint cannot hide
      // Shipping (or other) counts for a tenant.
      const nextCounts = {};
      const loadCount = async (label, loader) => {
        try {
          Object.assign(nextCounts, await loader());
        } catch (error) {
          console.warn(`Sidebar ${label} count could not be loaded.`, error);
        }
      };

      const countLoaders = [];

      if (sidebarRole === "worker" && sidebarWorkerId) {
        countLoaders.push(
          loadCount("My Tasks", async () => {
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
            return {
              "My Tasks": openOrderTasks.length + openProductionTasks.length,
            };
          })
        );
      }

      if (
        ["admin", "manager", "warehouse", "super_admin"].includes(sidebarRole) &&
        allowedPagesForCounts.includes("Shipping")
      ) {
        countLoaders.push(
          loadCount("Shipping", async () => {
            const response = await api.get("/shipping/pending-count");
            return {
              Shipping: Number(response.data?.count || 0),
            };
          })
        );
      }

      if (
        ["admin", "manager", "warehouse", "super_admin"].includes(sidebarRole) &&
        (allowedPagesForCounts.includes("Warehouse / Fulfillment") ||
          allowedPagesForCounts.includes("Warehouse Dispatch"))
      ) {
        countLoaders.push(
          loadCount("Warehouse", async () => {
            const response = await api.get("/fulfillment/pending-count");
            const unfulfilledCount = Number(response.data?.count || 0);
            return {
              "Warehouse / Fulfillment": unfulfilledCount,
              "Warehouse Dispatch": unfulfilledCount,
            };
          })
        );
      }

      if (allowedPagesForCounts.includes("Messages")) {
        countLoaders.push(
          loadCount("Messages", async () => {
            const response = await api.get("/internal-messages/unread-count");
            return { Messages: Number(response.data?.unread_count || 0) };
          })
        );
      }

      if (allowedPagesForCounts.includes("Website Visitors")) {
        countLoaders.push(
          loadCount("Website Visitors", async () => {
            const response = await api.get("/visitor-chat/sessions/unread-count");
            return {
              "Website Visitors": Number(response.data?.unread_count || 0),
            };
          })
        );
      }

      await Promise.all(countLoaders);
      if (active) setSidebarCounts(nextCounts);
    };

    const initialLoadId = setTimeout(loadSidebarCounts, 0);
    const intervalId = setInterval(loadSidebarCounts, 30000);
    const handleRefresh = () => {
      loadSidebarCounts();
    };

    window.addEventListener("erp:refresh-sidebar-counts", handleRefresh);
    window.addEventListener("erp:shipping-updated", handleRefresh);
    window.addEventListener("erp:order-updated", handleRefresh);

    return () => {
      active = false;
      clearTimeout(initialLoadId);
      clearInterval(intervalId);
      window.removeEventListener("erp:refresh-sidebar-counts", handleRefresh);
      window.removeEventListener("erp:shipping-updated", handleRefresh);
      window.removeEventListener("erp:order-updated", handleRefresh);
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

  useEffect(() => {
    if (authenticatedUser || isPublicPage(activePage) || activePage === "Login") return;
    const returnPath = rememberLoginReturnPath();
    const loginPath = buildLoginPath(returnPath);
    if (currentFullPath() !== loginPath) {
      window.history.replaceState({}, "", loginPath);
    }
    setActivePage("Login");
  }, [activePage, authenticatedUser]);

  const updatePath = (page, routeUser = authenticatedUser) => {
    const isWorkspacePage = isSchoolWorkspacePage(page);
    const routeAllowedPages = allowedPagesForRouteUser(routeUser, routeUser?.id === authenticatedUser?.id ? tenantModules : []);
    const targetPage = isPublicPage(page) || isWorkspacePage
      ? page
      : routeUser && !routeAllowedPages.includes(page)
      ? "Dashboard"
      : page;
    const nextPath = scopedAppPath(pagePaths[targetPage] || "/portal", {
      user: routeUser,
      preserveCurrentScope: !routeUser,
    });
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
    const returnPath =
      pendingLoginPathRef.current ||
      getLoginNextPath() ||
      sanitizeLoginReturnPath(currentFullPath());
    const fallbackPage =
      user.role === "school"
        ? "School ERP"
        : user.role === "service_taker"
          ? "Service Dashboard"
          : "Dashboard";

    if (returnPath && pathAllowedForUser(returnPath, user)) {
      const requestedPage = pageFromPath(returnPath);
      const nextPath = scopedReturnPathForUser(returnPath, user);
      const pathChanged = currentFullPath() !== nextPath;
      if (pathChanged) {
        window.history.pushState({}, "", nextPath);
      }
      window.dispatchEvent(
        new CustomEvent("erp:navigation", {
          detail: {
            page: requestedPage,
            source: pathChanged ? "navigation" : "reselect",
          },
        })
      );
      setActivePage(requestedPage);
      pendingLoginPathRef.current = "";
      return;
    }

    pendingLoginPathRef.current = "";
    updatePath(fallbackPage, user);
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
    updatePath("Dashboard", updatedUser);
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
    updatePath("Dashboard", superAdminUser);
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
    if (activePage === "Printer Settings") return <PrinterSettings />;
    if (activePage === "Inspiration") return <Inspiration />;
    if (activePage === "Quotes") return <Quotes />;
    if (activePage === "TempData") return <TempData />;
    if (activePage === "Messages") return <Messages />;
    if (activePage === "Website Visitors") return <WebsiteVisitors />;
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
      return isSupplierLedgerPath(currentRoute) ? (
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
    if (activePage === "Local Orders") return <LocalOrders />;
    if (serviceTakerPages.includes(activePage)) {
      const portalSection =
        activePage === "Service Dashboard"
          ? "dashboard"
          : activePage === "Service Inbound"
          ? "inbound"
          : activePage === "Service Shipments"
            ? "orders"
            : activePage === "Service Manufacturing"
              ? "manufacturing"
              : activePage === "Service Quotations"
                ? "quotations"
              : activePage === "Service Charges"
                ? "billing"
              : "inventory";
      return <ServiceTakerPortal authenticatedUser={authenticatedUser} section={portalSection} />;
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
    if (activePage === "Copy Clipboard") return <CopyClipboard />;

    return <Dashboard />;
  };

  if (activePage === "Login") {
    return (
      <GlobalErrorBoundary>
        <Login
          onLogin={handleLoginSuccess}
          message={logoutMessage}
          onClearMessage={clearLogoutMessage}
        />
      </GlobalErrorBoundary>
    );
  }

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
              onPrefetchPage={prefetchPageModule}
              getPageHref={(page) => scopedAppPath(pagePaths[page] || "/portal", {
                user: authenticatedUser,
                preserveCurrentScope: !authenticatedUser,
              })}
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


