import { useEffect, useRef, useState } from "react";
import defaultSchoolLogo from "../assets/dar-e-arqam-logo.svg";
import { schoolText } from "../school/theme";
import "./sidebar.css";

const menuItems = [
  { name: "Dashboard", icon: "dashboard" },
  { name: "My Tasks", icon: "tasks" },
  { name: "Customers", icon: "customers" },
  { name: "Orders", icon: "orders" },
  { name: "Payouts", icon: "wallet" },
  { name: "Billings", icon: "wallet" },
  { name: "Accounting", icon: "scale" },
  { name: "Shipping", icon: "truck" },
  { name: "Shipping Balance", icon: "scale" },
  { name: "Warehouse / Fulfillment", label: "Fulfillment", icon: "fulfillment" },
  { name: "Warehouse Dispatch", label: "Dispatch", icon: "orders" },
  { name: "Warehouse Shipments", label: "Shipments", icon: "truck" },
  { name: "Warehouse Stock", label: "Stock / Boxes", icon: "inventory" },
  { name: "Service Takers", label: "Service Takers", icon: "fulfillment" },
  { name: "Service Dashboard", label: "Dashboard", icon: "dashboard" },
  { name: "Service Products", label: "Products & Inventory", icon: "box" },
  { name: "Service Inbound", label: "Inbound", icon: "inventory" },
  { name: "Service Shipments", label: "Ship Order", icon: "truck" },
  { name: "Service Charges", label: "Charges", icon: "wallet" },
  { name: "Follow Ups", icon: "message" },
  { name: "Products", icon: "box" },
  { name: "Inventory", icon: "inventory" },
  { name: "Label Printer", label: "Label Printer 1", icon: "inventory" },
  { name: "Inspiration", label: "Inspirations", icon: "spark" },
  { name: "Suppliers", label: "Accounts", icon: "suppliers" },
  { name: "Manufacturing", icon: "factory" },
  { name: "Production", icon: "gear" },
  { name: "Workers", icon: "workers" },
  {
    name: "Worker Payouts",
    label: "Worker Accounts",
    workerLabel: "Payouts",
    icon: "wallet",
  },
  { name: "Reports", label: "Reports & Analytics", icon: "chart" },
  { name: "Settings", icon: "settings" },
  { name: "Amazon Settings", label: "Amazon", icon: "amazon" },
  { name: "Amazon Listings", label: "Amazon Listings", icon: "inventory" },
  { name: "Amazon FBA Orders", label: "Amazon FBA Orders", icon: "orders" },
  { name: "Amazon FBA Inbound", label: "Amazon FBA Inbound", icon: "truck" },
  { name: "Amazon Finances", label: "Amazon Finances", icon: "scale" },
  { name: "Amazon Pricing", label: "Amazon Pricing", icon: "wallet" },
  { name: "Quotes", icon: "quote" },
  { name: "Website", icon: "spark" },
  { name: "Deployment", icon: "deployment" },
  { name: "Users", icon: "users" },
  { name: "TempData", label: "Temp Data", icon: "database" },
  { name: "Messages", icon: "message" },
  { name: "Copy Clipboard", icon: "clipboard" },
];

const roleAllowedPages = {
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
    "Quotes",
    "Inspiration",
    "Suppliers",
    "Manufacturing",
    "Production",
    "Workers",
    "Worker Payouts",
    "Reports",
    "Website",
    "Deployment",
    "Users",
    "Settings",
    "Amazon Settings",
    "Amazon Listings",
    "Amazon FBA Orders",
    "Amazon FBA Inbound",
    "Amazon Finances",
    "Amazon Pricing",
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
    "Quotes",
    "Inspiration",
    "Website",
    "Suppliers",
    "Manufacturing",
    "Production",
    "Worker Payouts",
    "Reports",
    "Settings",
    "TempData",
    "Messages",
    "Copy Clipboard",
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
  worker: ["Dashboard", "My Tasks", "Worker Payouts", "Manufacturing", "Production", "Messages", "Settings"],
  service_taker: [
    "Service Dashboard",
    "Service Products",
    "Service Inbound",
    "Service Shipments",
    "Service Charges",
  ],
};

const mainMenuOrder = [
  "Dashboard",
  "My Tasks",
  "Orders",
  "Customers",
  "Suppliers",
  "Inventory",
  "Label Printer",
  "Payouts",
  "Billings",
  "Accounting",
  "Products",
  "Shipping",
  "Warehouse / Fulfillment",
  "Warehouse Dispatch",
  "Warehouse Shipments",
  "Warehouse Stock",
  "Service Takers",
  "Service Dashboard",
  "Service Products",
  "Service Inbound",
  "Service Shipments",
  "Service Charges",
  "Shipping Balance",
  "Follow Ups",
];

const secondaryMenuOrder = [
  "Production",
  "Manufacturing",
  "Workers",
  "Worker Payouts",
  "Reports",
  "Quotes",
  "Website",
  "Deployment",
  "Messages",
  "Copy Clipboard",
  "Inspiration",
  "Users",
  "Amazon Listings",
  "Amazon FBA Orders",
  "Amazon FBA Inbound",
  "Amazon Finances",
  "Amazon Pricing",
  "Amazon Settings",
  "Settings",
  "TempData",
];

const menuOrder = [...mainMenuOrder, ...secondaryMenuOrder];
const mobilePrimaryPages = ["Dashboard", "Orders", "Shipping", "Products"];
const schoolMenuItems = [
  { name: "School ERP", labelKey: "home", icon: "dashboard", permission: "view_dashboard" },
  { name: "School Students", labelKey: "students", icon: "students", permission: "view_students" },
  { name: "School Attendance", labelKey: "attendance", icon: "tasks", permission: "view_attendance" },
  { name: "School Finance", labelKey: "finance", icon: "scale", permission: "view_finance" },
  { name: "School Foundation", labelKey: "foundation", icon: "database", permission: "manage_foundation" },
  { name: "School Settings", labelKey: "settings", icon: "settings", permission: "manage_branding" },
];

const menuItemByName = new Map(menuItems.map((item) => [item.name, item]));
roleAllowedPages.super_admin = roleAllowedPages.admin;

const warehouseRoleOnlyPages = new Set([
  "Warehouse Dispatch",
  "Warehouse Shipments",
  "Warehouse Stock",
]);

const getMenuInitials = (label) =>
  String(label)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

function SidebarIcon({ name }) {
  const icons = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    tasks: (
      <>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="m3 6 1 1 2-2" />
        <path d="m3 12 1 1 2-2" />
        <path d="m3 18 1 1 2-2" />
      </>
    ),
    customers: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c.6-3.2 2.6-5 6-5s5.4 1.8 6 5" />
        <path d="M16 10a2.5 2.5 0 1 0 0-5" />
        <path d="M18 15c1.8.7 2.9 2.3 3.3 5" />
      </>
    ),
    orders: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M3 9h18" />
        <path d="M8 4v16" />
        <path d="M14 4v16" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 7h15a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M16 13h5" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v10H3z" />
        <path d="M14 10h4l3 3v3h-7" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
    scale: (
      <>
        <path d="M12 3v18" />
        <path d="M5 6h14" />
        <path d="m6 6-3 7h6L6 6Z" />
        <path d="m18 6-3 7h6l-3-7Z" />
      </>
    ),
    box: (
      <>
        <path d="m3 7 9 5 9-5" />
        <path d="M12 12v9" />
        <path d="M5 5 12 2l7 3 2 2v10l-9 5-9-5V7l2-2Z" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2L12 3Z" />
        <path d="M4 4h.01" />
        <path d="M20 20h.01" />
      </>
    ),
    inventory: (
      <>
        <path d="M4 4h16v5H4z" />
        <path d="M4 9h16v11H4z" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </>
    ),
    fulfillment: (
      <>
        <path d="M4 6h16v12H4z" />
        <path d="M4 10h16" />
        <path d="M8 6v12" />
        <path d="M14 6v12" />
        <path d="m17 14 2 2 3-4" />
      </>
    ),
    suppliers: (
      <>
        <path d="M7 12 4 9l3-3" />
        <path d="M17 12l3-3-3-3" />
        <path d="M5 9h14" />
        <path d="M8 16h8" />
        <path d="M10 20h4" />
      </>
    ),
    factory: (
      <>
        <path d="M3 21V9l5 3V9l5 3V6h8v15H3Z" />
        <path d="M7 17h2" />
        <path d="M13 17h2" />
        <path d="M18 10h1" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3" />
        <path d="M12 19v3" />
        <path d="m4.9 4.9 2.1 2.1" />
        <path d="m17 17 2.1 2.1" />
        <path d="M2 12h3" />
        <path d="M19 12h3" />
      </>
    ),
    workers: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 18c.7-2.4 2.4-4 5-4s4.3 1.6 5 4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h17" />
        <path d="M8 16v-5" />
        <path d="M13 16V8" />
        <path d="M18 16v-3" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a8.1 8.1 0 0 0 .1-6l-2.2-.6-1.2-2-2.2.8a8 8 0 0 0-3.8 0l-2.2-.8-1.2 2-2.2.6a8.1 8.1 0 0 0 .1 6l2.1.6 1.2 2 2.2-.8a8 8 0 0 0 3.8 0l2.2.8 1.2-2 2.1-.6Z" />
      </>
    ),
    quote: (
      <>
        <path d="M6 7h7" />
        <path d="M6 11h12" />
        <path d="M6 15h8" />
        <path d="M4 3h16v18H4z" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2" />
        <path d="M3 20c.6-3.2 2.6-5 6-5s5.4 1.8 6 5" />
        <path d="M15 15c2.2.2 3.7 1.8 4 5" />
      </>
    ),
    students: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c.6-3.2 2.6-5 6-5s5.4 1.8 6 5" />
        <path d="m15 6 3-2 3 2-3 2-3-2Z" />
        <path d="M16 9v3h4V9" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      </>
    ),
    message: (
      <>
        <path d="M4 5h16v11H8l-4 4V5Z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 4h6l1 2h3v15H5V6h3l1-2Z" />
        <path d="M9 4h6v4H9z" />
        <path d="M8 12h8" />
        <path d="M8 16h6" />
      </>
    ),
    deployment: (
      <>
        <path d="M4 7h16" />
        <path d="M7 7v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" />
        <path d="M9 4h6l2 3H7l2-3Z" />
        <path d="m9 13 2 2 4-5" />
      </>
    ),
    amazon: (
      <>
        <path d="M6 17c3.5 2.3 8.2 2.5 12 .2" />
        <path d="M16.5 19.5 19 17l-3-.5" />
        <path d="M8 8.5c.5-2.2 2-3.5 4.4-3.5 2.7 0 4.1 1.3 4.1 3.7V15" />
        <path d="M16.5 11.5c-4.8-.6-7.2.3-7.2 2.5 0 1.5 1.2 2.5 2.8 2.5 1.9 0 3.4-1.1 4.4-2.8" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="menu-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      {icons[name] || icons.dashboard}
    </svg>
  );
}

function WorkspaceSwitchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7h12" />
      <path d="m14 4 3 3-3 3" />
      <path d="M19 17H7" />
      <path d="m10 14-3 3 3 3" />
    </svg>
  );
}

function Sidebar({
  activePage,
  setActivePage,
  workspace = "factory",
  schoolSettings,
  schoolPermissions,
  canSwitchToFactory = true,
  onSwitchWorkspace,
  userRole,
  authenticatedUser,
  allowedPages,
  notificationCounts = {},
  collapsed = false,
  onToggleCollapse,
  onLogout,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const desktopMenuRef = useRef(null);
  const isSchoolWorkspace = workspace === "school";
  const effectiveAllowedPages = Array.isArray(allowedPages)
    ? allowedPages
    : roleAllowedPages[userRole] || roleAllowedPages.worker;
  const normalizedVisibleAllowedPages = effectiveAllowedPages;
  const visibleMenuItems = isSchoolWorkspace
    ? schoolMenuItems
        .filter(
          (item) =>
            ["admin", "super_admin"].includes(userRole) ||
            !Array.isArray(schoolPermissions) ||
            schoolPermissions.includes(item.permission) ||
            (item.name === "School Foundation" &&
              schoolPermissions.some((permission) =>
                ["manage_academics", "manage_users", "send_notifications", "manage_documents", "view_audit"].includes(permission)
              ))
        )
        .map((item) => ({
          ...item,
          label: schoolText(schoolSettings?.interface_language, item.labelKey),
        }))
    : menuOrder
        .map((page) => menuItemByName.get(page))
        .filter(
          (item) =>
            item &&
            normalizedVisibleAllowedPages.includes(item.name) &&
            (userRole === "warehouse" || !warehouseRoleOnlyPages.has(item.name))
        );
  const visibleMenuCount = visibleMenuItems.length;
  const mobilePrimaryPageOrder =
    userRole === "service_taker"
      ? [
          "Service Dashboard",
          "Service Products",
          "Service Inbound",
          "Service Shipments",
          "Service Charges",
        ]
      : userRole === "warehouse"
      ? ["Dashboard", "Warehouse Dispatch", "Warehouse Shipments", "Warehouse Stock"]
      : mobilePrimaryPages;
  const mobilePrimaryItems = isSchoolWorkspace
    ? schoolMenuItems
    : mobilePrimaryPageOrder
        .map((page) => menuItemByName.get(page))
        .filter((item) => item && normalizedVisibleAllowedPages.includes(item.name));
  const activeInMobilePrimary = mobilePrimaryItems.some(
    (item) => item.name === activePage
  );

  const roleLabel =
    ["admin", "super_admin"].includes(userRole)
      ? "Administrator"
      : userRole === "manager"
        ? "Manager"
        : userRole === "warehouse"
          ? "Warehouse"
          : userRole === "worker"
            ? "Employee"
            : userRole === "service_taker"
              ? "Service taker"
            : userRole;
  const userInitials = String(
    authenticatedUser?.name || authenticatedUser?.username || "ERP"
  )
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    const activeButton = desktopMenuRef.current?.querySelector(".menu-button.active");
    activeButton?.scrollIntoView({ block: "nearest" });
  }, [activePage, visibleMenuCount]);

  const handleNavigation = (page) => {
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  const handleMobileLogout = () => {
    setMobileMenuOpen(false);
    onLogout?.();
  };

  const handleWorkspaceSwitch = () => {
    setMobileMenuOpen(false);
    onSwitchWorkspace?.();
  };

  const currentWorkspaceName = isSchoolWorkspace
    ? `${schoolSettings?.school_name || "Dar-e-Arqam"} ${schoolSettings?.campus_name || "School ERP"}`
    : "Hisbenew Industries ERP";
  const targetWorkspaceName = isSchoolWorkspace
    ? "Hisbenew Industries ERP"
    : `${schoolSettings?.school_name || "Dar-e-Arqam"} ${schoolSettings?.campus_name || "School ERP"}`;
  const schoolLogoSource = schoolSettings?.logo_data_url || defaultSchoolLogo;
  const showWorkspaceSwitch = Boolean(onSwitchWorkspace) && (!isSchoolWorkspace || canSwitchToFactory);

  const getItemLabel = (item) =>
    userRole === "worker" && item.workerLabel
      ? item.workerLabel
      : item.label || item.name;

  const mobileLabel = (item) =>
    item.name === "Dashboard" ? "Home" : getItemLabel(item);
  const getNotificationCount = (item) => {
    if (userRole === "service_taker") return 0;
    const count = Number(notificationCounts?.[item.name] || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  };
  const formatNotificationCount = (count) => (count > 99 ? "99+" : String(count));

  return (
    <aside
      className={`sidebar ${collapsed ? "is-collapsed" : ""} ${
        mobileMenuOpen ? "has-mobile-menu" : ""
      } ${isSchoolWorkspace ? "school-workspace-sidebar" : ""}`.trim()}
    >
      <div className="brand-box">
        <div className="brand-mark">
          {isSchoolWorkspace ? <img src={schoolLogoSource} alt="" /> : "HI"}
        </div>
        <div className="brand-copy">
          <h2>{isSchoolWorkspace ? schoolSettings?.school_name || "Dar-e-Arqam" : "Hisbenew"}</h2>
          <span>{isSchoolWorkspace ? schoolSettings?.campus_name || "School ERP" : "Industries ERP"}</span>
        </div>
        {showWorkspaceSwitch && (
          <button
            aria-label={`Switch to ${targetWorkspaceName}`}
            className="workspace-switch-icon-button"
            onClick={handleWorkspaceSwitch}
            title={`Switch to ${targetWorkspaceName}`}
            type="button"
          >
            <WorkspaceSwitchIcon />
          </button>
        )}
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="sidebar-collapse-button"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <nav
        aria-label="Main navigation"
        className="sidebar-menu sidebar-menu-desktop"
        ref={desktopMenuRef}
      >
        {visibleMenuItems.map((item) => {
          const notificationCount = getNotificationCount(item);
          const itemLabel = getItemLabel(item);

          return (
            <button
              aria-current={activePage === item.name ? "page" : undefined}
              aria-label={itemLabel}
              className={`menu-button ${
                isSchoolWorkspace || mainMenuOrder.includes(item.name) ? "" : "menu-secondary-button"
              } ${activePage === item.name ? "active" : ""}`.trim()}
              key={item.name}
              onClick={() => handleNavigation(item.name)}
              title={itemLabel}
              type="button"
            >
              <SidebarIcon name={item.icon} />
              <span className="menu-initial">{getMenuInitials(itemLabel)}</span>
              <span className="menu-label">{itemLabel}</span>
              {notificationCount > 0 && (
                <span className="menu-badge">
                  {formatNotificationCount(notificationCount)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <nav aria-label="Mobile primary navigation" className="mobile-tabbar">
        {mobilePrimaryItems.map((item) => {
          const notificationCount = getNotificationCount(item);

          return (
            <button
              aria-current={activePage === item.name ? "page" : undefined}
              aria-label={mobileLabel(item)}
              className={`mobile-tab-button ${
                activePage === item.name ? "active" : ""
              }`.trim()}
              key={item.name}
              onClick={() => handleNavigation(item.name)}
              title={mobileLabel(item)}
              type="button"
            >
              <SidebarIcon name={item.icon} />
              <span>{mobileLabel(item)}</span>
              {notificationCount > 0 && (
                <span className="menu-badge">
                  {formatNotificationCount(notificationCount)}
                </span>
              )}
            </button>
          );
        })}

        <button
          aria-expanded={mobileMenuOpen}
          aria-haspopup="dialog"
          aria-label="Open all pages menu"
          className={`mobile-tab-button mobile-menu-trigger ${
            mobileMenuOpen || !activeInMobilePrimary ? "active" : ""
          }`.trim()}
          onClick={() => setMobileMenuOpen((current) => !current)}
          type="button"
        >
          <SidebarIcon name="menu" />
          <span>Menu</span>
        </button>
      </nav>

      {mobileMenuOpen && (
        <div
          className="mobile-menu-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <section
            aria-label="All ERP pages"
            aria-modal="true"
            className="mobile-menu-sheet"
            role="dialog"
          >
            <div className="mobile-menu-header">
              <div>
                <strong>{isSchoolWorkspace ? "School workspace" : "All pages"}</strong>
                <span>{currentWorkspaceName}</span>
              </div>
              <div className="mobile-menu-header-actions">
                {showWorkspaceSwitch && (
                  <button
                    aria-label={`Switch to ${targetWorkspaceName}`}
                    className="workspace-switch-icon-button"
                    onClick={handleWorkspaceSwitch}
                    title={`Switch to ${targetWorkspaceName}`}
                    type="button"
                  >
                    <WorkspaceSwitchIcon />
                  </button>
                )}
                <button
                  aria-label="Close menu"
                  onClick={() => setMobileMenuOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mobile-menu-grid">
              {visibleMenuItems.map((item) => {
                const notificationCount = getNotificationCount(item);
                const itemLabel = getItemLabel(item);

                return (
                  <button
                    aria-current={activePage === item.name ? "page" : undefined}
                    className={`mobile-menu-item ${
                      activePage === item.name ? "active" : ""
                    }`.trim()}
                    key={item.name}
                    onClick={() => handleNavigation(item.name)}
                    type="button"
                  >
                    <SidebarIcon name={item.icon} />
                    <span>{itemLabel}</span>
                    {notificationCount > 0 && (
                      <span className="menu-badge">
                        {formatNotificationCount(notificationCount)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mobile-menu-footer">
              <div className="mobile-menu-user">
                <span className="sidebar-user-avatar">{userInitials}</span>
                <div>
                  <strong>
                    {authenticatedUser?.name ||
                      authenticatedUser?.username ||
                      "ERP user"}
                  </strong>
                  <span>{roleLabel}</span>
                </div>
              </div>
              <button
                className="mobile-menu-logout"
                onClick={handleMobileLogout}
                type="button"
              >
                Log out
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-user-card">
          <span className="sidebar-user-avatar">{userInitials}</span>
          <div className="sidebar-user-copy">
            <strong>
              {authenticatedUser?.name ||
                authenticatedUser?.username ||
                "ERP user"}
            </strong>
            <span>{roleLabel}</span>
          </div>
        </div>

        <button
          aria-label="Log out"
          className="sidebar-logout-button"
          onClick={onLogout}
          title="Log out"
          type="button"
        >
          <span className="sidebar-logout-full">Log out</span>
          <span className="sidebar-logout-short">Exit</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
