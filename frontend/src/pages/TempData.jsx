import { useMemo, useState } from "react";
import { useConfirmDialog } from "../components/DialogProvider";
import { useWorkspaceData } from "../utils/workspaceData";
import "./TempData.css";

const createEmptyRow = (columnCount) => Array(columnCount).fill("");

const normalizeTempData = (data) => {
  const columnCount = Math.max(1, Number(data?.columnCount) || 5);
  const rows = Array.isArray(data?.rows)
    ? data.rows.map((row) => {
        const cells = Array.isArray(row) ? row.slice(0, columnCount) : [];
        while (cells.length < columnCount) cells.push("");
        return cells;
      })
    : [];
  return { columnCount, rows };
};

const loadTempData = () => {
  if (typeof window === "undefined") {
    return { data: { columnCount: 5, rows: [] }, exists: false };
  }

  const saved = window.localStorage.getItem("tempData");
  if (!saved) {
    return { data: { columnCount: 5, rows: [] }, exists: false };
  }

  try {
    return { data: normalizeTempData(JSON.parse(saved)), exists: true };
  } catch (error) {
    console.error("Failed to load temp data", error);
    return { data: { columnCount: 5, rows: [] }, exists: false };
  }
};

const saveTempDataLocally = (data) => {
  window.localStorage.setItem("tempData", JSON.stringify(data));
};

function TempData() {
  const confirmDialog = useConfirmDialog();
  const [tempData, setTempData, syncStatus] = useWorkspaceData({
    dataKey: "temp-data",
    loadLocal: loadTempData,
    normalize: normalizeTempData,
    saveLocal: saveTempDataLocally,
  });
  const [editCell, setEditCell] = useState(null);
  const { columnCount, rows } = tempData;

  const stats = useMemo(() => {
    const filledCells = rows.reduce(
      (total, row) =>
        total + row.filter((cell) => String(cell || "").trim()).length,
      0
    );

    return {
      cells: rows.length * columnCount,
      columns: columnCount,
      filledCells,
      rows: rows.length,
    };
  }, [columnCount, rows]);

  const addRow = () => {
    setTempData((current) => ({
      ...current,
      rows: [...current.rows, createEmptyRow(current.columnCount)],
    }));
  };

  const updateCell = (rowIndex, colIndex, value) => {
    setTempData((current) => ({
      ...current,
      rows: current.rows.map((row, index) =>
        index === rowIndex
          ? row.map((cell, cellIndex) => (cellIndex === colIndex ? value : cell))
          : row
      ),
    }));
  };

  const deleteRow = (rowIndex) => {
    setTempData((current) => ({
      ...current,
      rows: current.rows.filter((_, index) => index !== rowIndex),
    }));
  };

  const addColumn = () => {
    setTempData((current) => ({
      columnCount: current.columnCount + 1,
      rows: current.rows.map((row) => [...row, ""]),
    }));
  };

  const removeColumn = () => {
    if (columnCount <= 1) return;
    setTempData((current) => {
      const nextColumnCount = current.columnCount - 1;
      return {
        columnCount: nextColumnCount,
        rows: current.rows.map((row) => row.slice(0, nextColumnCount)),
      };
    });
  };

  const clearAll = async () => {
    const confirmed = await confirmDialog({
      title: "Clear temporary data?",
      message: "This will clear all temporary data.",
      tone: "warning",
      confirmText: "Clear data",
    });
    if (!confirmed) return;
    setTempData((current) => ({ ...current, rows: [] }));
  };

  const exportAsCSV = () => {
    const escapeCell = (cell) => `"${String(cell || "").replace(/"/g, '""')}"`;
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `temp-data-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="temp-data-page">
      <header className="temp-data-header">
        <div>
          <span className="temp-data-kicker">Scratch sheet</span>
          <h1>Temporary Data</h1>
          <p>Fast local table storage for short-lived lists and notes.</p>
        </div>
      </header>

      <section className="temp-summary" aria-label="Temporary data summary">
        <article>
          <span>Rows</span>
          <strong>{stats.rows}</strong>
        </article>
        <article>
          <span>Columns</span>
          <strong>{stats.columns}</strong>
        </article>
        <article>
          <span>Filled cells</span>
          <strong>{stats.filledCells}</strong>
        </article>
        <article>
          <span>Total cells</span>
          <strong>{stats.cells}</strong>
        </article>
      </section>

      <section className="temp-workspace">
        <div className="temp-toolbar">
          <div>
            <h2>Data sheet</h2>
            <p>
              {syncStatus === "local"
                ? "Saved locally; ERP database reconnect pending"
                : syncStatus === "synced"
                  ? "Saved in the ERP database"
                  : "Saving to the ERP database"}
            </p>
          </div>
          <div className="temp-controls">
            <button className="temp-primary-button" onClick={addRow} type="button">
              Add row
            </button>
            <button className="temp-secondary-button" onClick={addColumn} type="button">
              Add column
            </button>
            <button
              className="temp-secondary-button"
              disabled={columnCount <= 1}
              onClick={removeColumn}
              type="button"
            >
              Remove column
            </button>
            <button
              className="temp-secondary-button"
              disabled={rows.length === 0}
              onClick={exportAsCSV}
              type="button"
            >
              Export CSV
            </button>
            <button
              className="temp-danger-button"
              disabled={rows.length === 0}
              onClick={clearAll}
              type="button"
            >
              Clear all
            </button>
          </div>
        </div>

        <div className="temp-table-container">
          {rows.length === 0 ? (
            <div className="temp-empty-state">
              <strong>No temporary rows</strong>
              <span>New rows will appear in this sheet.</span>
            </div>
          ) : (
            <table className="temp-data-table">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  {Array(columnCount)
                    .fill(null)
                    .map((_, colIndex) => (
                      <th key={colIndex} className="col-header">
                        {String.fromCharCode(65 + colIndex)}
                      </th>
                    ))}
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="data-row">
                    <td className="row-num">{rowIndex + 1}</td>
                    {row.map((cell, colIndex) => (
                      <td
                        key={colIndex}
                        className="data-cell"
                        onClick={() => setEditCell({ row: rowIndex, col: colIndex })}
                      >
                        {editCell?.row === rowIndex && editCell?.col === colIndex ? (
                          <input
                            autoFocus
                            onBlur={() => setEditCell(null)}
                            onChange={(event) =>
                              updateCell(rowIndex, colIndex, event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") setEditCell(null);
                              if (event.key === "Escape") setEditCell(null);
                            }}
                            type="text"
                            value={cell}
                          />
                        ) : (
                          <span>{cell || "-"}</span>
                        )}
                      </td>
                    ))}
                    <td className="actions-col">
                      <button
                        className="temp-danger-button is-small"
                        onClick={() => deleteRow(rowIndex)}
                        type="button"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

export default TempData;
