import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
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
const ServiceTakers = lazy(() => import("./pages/ServiceTakers"));
const ServiceTakerPortal = lazy(() => import("./pages/ServiceTakerPortal"));
const FollowUps = lazy(() => import("./pages/FollowUps"));
const Payouts = lazy(() => import("./pages/Payouts"));
const Payments = lazy(() => import("./pages/Payments"));
const WorkerPayouts = lazy(() => import("./pages/WorkerPayouts"));
const Accounting = lazy(() => import("./pages/Accounting"));
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
  WebsiteStorefront: "/website",
  WebsiteCatalog: "/website/catalog",
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
  "Service Takers": "/portal/service-takers",
  "Service Dashboard": "/portal/service-taker/dashboard",
  "Service Products": "/portal/service-taker/products",
  "Service Inbound": "/portal/service-taker/inbound",
  "Service Shipments": "/portal/service-taker/shipments",
  "Service Charges": "/portal/service-taker/charges",
  "Follow Ups": "/portal/follow-ups",
  Payouts: "/portal/payouts",
  Billings: "/portal/billings",
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
  Login: "/login",
};

const serviceTakerPages = [
  "Service Dashboard",
  "Service Products",
  "Service Inbound",
  "Service Shipments",
  "Service Charges",
];

const rolePages = {
  admin: [
    "Dashboard",
    "Customers",
    "Orders",
    "Payouts",
    "Billings",
    "Accounting",
    "Shipping",
    "Shipping Balance",
    "Warehouse / Fulfillment",
    "Service Takers",
    "Follow Ups",
    "Products",
    "Inventory",
    "Label Printer",
    "Suppliers",
    "Manufacturing",
    "Production",
    "Workers",
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
    "Suppliers",
    "Manufacturing",
    "Production",
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

const pathToPage = Object.fromEntries(
  Object.entries(pagePaths).map(([page, path]) => [path, page])
);
pathToPage["/portal/payments"] = "Billings";
pathToPage["/portal/amazon/fba-inventory"] = "Products";
pathToPage["/portal/service-taker"] = "Service Dashboard";

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

const normalizeClientAllowedPages = (pages = [], role = "") => {
  if (role === "service_taker") return serviceTakerPages;
  const normalized = [];

  pages.forEach((page) => {
    if (page === "Payments") page = "Billings";
    if (page === "Amazon FBA Inventory") page = "Products";
    if (!normalized.includes(page)) normalized.push(page);
  });

  if (role === "admin" && !normalized.includes("Deployment")) normalized.push("Deployment");
  if (!normalized.includes("Dashboard")) normalized.unshift("Dashboard");
  return normalized;
};

function App() {
  const savedUser = window.localStorage.getItem("erpUser");
  const parsedSavedUser = savedUser ? JSON.parse(savedUser) : null;
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
    authenticatedUser?.role
  );
  const allowedPageKey = normalizedAllowedPages.join("|");
  const schoolWorkspaceActive = isSchoolWorkspacePage(activePage);

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
      const response = await api.get(`/users/${authenticatedUser.id}`);
      const freshUser = response.data;
      if (!freshUser.is_active) {
        logoutWithMessage("Your account has been deactivated. Contact admin.");
        return;
      }

      const refreshedUser = {
        ...authenticatedUser,
        ...freshUser,
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
          ["admin", "manager", "warehouse"].includes(sidebarRole) &&
          allowedPagesForCounts.includes("Shipping")
        ) {
          const response = await api.get("/dashboard-stats");
          nextCounts.Shipping = Number(response.data?.pending_shipping_orders || 0);
        }

        if (
          ["admin", "manager", "warehouse"].includes(sidebarRole) &&
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
    authenticatedUser?.worker_id,
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

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("erpSidebarCollapsed", String(next));
      return next;
    });
  };

  const renderPage = () => {
    if (activePage === "WebsiteStorefront") {
      return <Website />;
    }

    if (activePage === "WebsiteCatalog") {
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
      return <Dashboard {...dashboardProps} />;
    }

    if (activePage === "Dashboard") return <Dashboard {...dashboardProps} />;
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
    if (activePage === "Users") return <Users />;
    if (activePage === "Copy Clipboard") return <CopyClipboard />;

    return <Dashboard />;
  };

  return (
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
            canSwitchToFactory={authenticatedUser.role === "admin"}
            onSwitchWorkspace={
              authenticatedUser.role === "admin"
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
  );
}

export default App;
