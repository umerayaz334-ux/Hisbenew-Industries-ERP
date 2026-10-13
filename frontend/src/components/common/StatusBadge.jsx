import React from "react";

const STATUS_COLOR_MAP = {
  // Common
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive: "bg-gray-100 text-gray-600 border-gray-200",
  new: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  dispatched: "bg-indigo-50 text-indigo-700 border-indigo-200",
  reversed: "bg-rose-50 text-rose-700 border-rose-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  unpaid: "bg-rose-50 text-rose-700 border-rose-200",
};

export function StatusBadge({ status, label, className = "" }) {
  const normalized = String(status || "").trim().toLowerCase();
  const colorClasses = STATUS_COLOR_MAP[normalized] || "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colorClasses} ${className}`}
    >
      {label || status || "Unknown"}
    </span>
  );
}

export default StatusBadge;
