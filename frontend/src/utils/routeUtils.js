const toPathSegments = (pathname = "") => {
  const pathOnly = String(pathname || "").split(/[?#]/)[0];
  const cleaned = pathOnly.replace(/\/+$|^\/+/g, "");
  return cleaned ? cleaned.split("/") : [];
};

export const routeScopeSlugFromPath = (pathname = "") => {
  const segments = toPathSegments(pathname);
  const scopeIndex = segments.findIndex(
    (segment) => segment === "portal" || segment === "login"
  );
  if (scopeIndex !== 1) return "";

  try {
    return decodeURIComponent(segments[0]).trim().toLowerCase();
  } catch {
    return segments[0].trim().toLowerCase();
  }
};

export const routeScopePrefixFromPath = (pathname = "") => {
  const segments = toPathSegments(pathname);
  const scopeIndex = segments.findIndex(
    (segment) => segment === "portal" || segment === "login"
  );

  if (scopeIndex > 0) return `/${segments.slice(0, scopeIndex).join("/")}`;
  return "";
};

export const stripRouteScope = (pathname = "") => {
  if (!pathname) return "/portal";

  const segments = toPathSegments(pathname);
  if (segments.length === 0) return "/";

  const portalIndex = segments.indexOf("portal");
  if (portalIndex >= 0) return `/${segments.slice(portalIndex).join("/")}`;

  const loginIndex = segments.indexOf("login");
  if (loginIndex >= 0) return `/${segments.slice(loginIndex).join("/")}`;

  return `/${segments.join("/")}`;
};

export const normalizeAppPath = (pathname = "") => {
  const unscoped = stripRouteScope(pathname);
  if (!unscoped) return "/portal";

  const cleaned = unscoped.replace(/\/+$|^\/+/g, "");
  if (!cleaned) return "/";
  if (cleaned === "portal") return "/portal";

  return `/${cleaned}`;
};

export const routePrefixFromSlug = (slug = "") => {
  const cleanSlug = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
  return cleanSlug ? `/${encodeURIComponent(cleanSlug)}` : "";
};

export const companySlugForRouteUser = (user) => {
  if (!user) return "";
  if (user.role === "super_admin" && !user.impersonatedBySuperAdmin) return "";
  return user.tenant_slug || "";
};

export const scopedAppPath = (path, options = {}) => {
  const targetPath = normalizeAppPath(path);
  const {
    pathname = typeof window !== "undefined" ? window.location.pathname : "",
    preserveCurrentScope = true,
    tenantSlug = "",
    user = null,
  } = options;
  const prefix =
    routePrefixFromSlug(tenantSlug || companySlugForRouteUser(user)) ||
    (preserveCurrentScope ? routeScopePrefixFromPath(pathname) : "");

  if (!prefix || targetPath === "/" || targetPath.startsWith(`${prefix}/`)) {
    return targetPath;
  }

  return targetPath === "/login" || targetPath.startsWith("/portal")
    ? `${prefix}${targetPath}`
    : targetPath;
};
