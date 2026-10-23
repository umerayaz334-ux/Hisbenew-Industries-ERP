export function errorDetailText(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(errorDetailText).filter(Boolean).join("; ");
  if (detail && typeof detail === "object") {
    const field = Array.isArray(detail.loc) ? detail.loc.filter((part) => part !== "body").join(".") : "";
    const message = typeof detail.msg === "string" ? detail.msg : typeof detail.message === "string" ? detail.message : "The request could not be processed.";
    return field ? `${field}: ${message}` : message;
  }
  return "";
}
