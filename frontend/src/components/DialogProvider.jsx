import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const DialogContext = createContext(null);

const normalizeDialog = (options, defaults = {}) => {
  const input = typeof options === "string" ? { message: options } : options || {};
  return {
    title: input.title || defaults.title || "Notice",
    message: input.message || defaults.message || "",
    detail: input.detail || defaults.detail || "",
    tone: input.tone || defaults.tone || "default",
    confirmText: input.confirmText || defaults.confirmText || "OK",
    cancelText: input.cancelText || defaults.cancelText || "Cancel",
    type: input.type || defaults.type || "alert",
  };
};

const inferAlertPresentation = (message) => {
  const text = String(message || "").toLowerCase();
  if (/(success|successfully|saved|updated|deleted|recorded|completed|copied|added)/.test(text)) {
    return { title: "Success", tone: "success" };
  }
  if (/(could not|failed|unable|error|wrong|not connected|required|select|enter|allow)/.test(text)) {
    return { title: "Needs attention", tone: "warning" };
  }
  return { title: "Notice", tone: "default" };
};

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const activeDialogRef = useRef(null);
  const queueRef = useRef([]);

  const showNextDialog = useCallback(() => {
    if (activeDialogRef.current || queueRef.current.length === 0) return;
    const nextDialog = queueRef.current.shift();
    activeDialogRef.current = nextDialog;
    setDialog(nextDialog);
  }, []);

  const openDialog = useCallback(
    (options) =>
      new Promise((resolve) => {
        queueRef.current.push({
          ...options,
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          resolve,
        });
        showNextDialog();
      }),
    [showNextDialog]
  );

  const closeDialog = useCallback(
    (result) => {
      const currentDialog = activeDialogRef.current;
      if (!currentDialog) return;
      currentDialog.resolve(result);
      activeDialogRef.current = null;
      setDialog(null);
      window.setTimeout(showNextDialog, 0);
    },
    [showNextDialog]
  );

  const alertDialog = useCallback(
    (options) =>
      openDialog(
        normalizeDialog(options, {
          confirmText: "Got it",
          type: "alert",
        })
      ).then(() => undefined),
    [openDialog]
  );

  const confirmDialog = useCallback(
    (options) =>
      openDialog(
        normalizeDialog(options, {
          title: "Confirm action",
          confirmText: "Continue",
          type: "confirm",
        })
      ),
    [openDialog]
  );

  useEffect(() => {
    const originalAlert = window.alert;
    const styledAlert = (message) => {
      const presentation = inferAlertPresentation(message);
      alertDialog({
        message: String(message || ""),
        title: presentation.title,
        tone: presentation.tone,
      });
    };

    window.alert = styledAlert;
    return () => {
      if (window.alert === styledAlert) {
        window.alert = originalAlert;
      }
    };
  }, [alertDialog]);

  useEffect(() => {
    if (!dialog) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeDialog(false);
      }
      if (event.key === "Enter" && dialog.type === "confirm") {
        closeDialog(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, dialog]);

  const value = useMemo(
    () => ({
      alert: alertDialog,
      confirm: confirmDialog,
    }),
    [alertDialog, confirmDialog]
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className="app-dialog-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog(false);
          }}
        >
          <section
            aria-labelledby="app-dialog-title"
            aria-modal="true"
            className={`app-dialog is-${dialog.tone}`}
            role="dialog"
          >
            <div className="app-dialog-mark" aria-hidden="true">
              {dialog.tone === "danger" ? "!" : dialog.tone === "success" ? "OK" : "i"}
            </div>
            <div className="app-dialog-copy">
              <h2 id="app-dialog-title">{dialog.title}</h2>
              {dialog.message && <p>{dialog.message}</p>}
              {dialog.detail && <small>{dialog.detail}</small>}
            </div>
            <div className="app-dialog-actions">
              {dialog.type === "confirm" && (
                <button
                  className="app-dialog-secondary"
                  onClick={() => closeDialog(false)}
                  type="button"
                >
                  {dialog.cancelText}
                </button>
              )}
              <button
                className="app-dialog-primary"
                onClick={() => closeDialog(true)}
                type="button"
              >
                {dialog.confirmText}
              </button>
            </div>
          </section>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used inside DialogProvider.");
  }
  return context;
};

export const useConfirmDialog = () => useDialog().confirm;
export const useAlertDialog = () => useDialog().alert;
