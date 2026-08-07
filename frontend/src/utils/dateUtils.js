export function parseUtcLocal(value) {
  if (!value) {
    return null;
  }

  let dateStr = value;

  if (typeof value === "string") {
    const naiveIsoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    if (naiveIsoRegex.test(value)) {
      dateStr = `${value}Z`;
    }
  }

  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtcLocal(value) {
  const date = parseUtcLocal(value);
  if (!date) {
    return "—";
  }

  return date.toLocaleString();
}
