import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/api";

const timestampStorageKey = (dataKey) => `erpWorkspaceUpdatedAt:${dataKey}`;

const readTimestamp = (dataKey) => {
  try {
    return Number(window.localStorage.getItem(timestampStorageKey(dataKey))) || 0;
  } catch {
    return 0;
  }
};

const writeTimestamp = (dataKey, value) => {
  try {
    window.localStorage.setItem(timestampStorageKey(dataKey), String(value));
  } catch {
    // The database remains the primary store if browser storage is unavailable.
  }
};

export const useWorkspaceData = ({
  dataKey,
  loadLocal,
  normalize,
  saveLocal,
}) => {
  const [initialLocal] = useState(() => {
    const loaded = loadLocal();
    return {
      data: normalize(loaded.data),
      exists: Boolean(loaded.exists),
      updatedAt: readTimestamp(dataKey),
    };
  });

  const [data, setDataState] = useState(initialLocal.data);
  const [syncStatus, setSyncStatus] = useState("loading");
  const dataRef = useRef(initialLocal.data);
  const hydratedRef = useRef(false);
  const changedBeforeHydrationRef = useRef(false);
  const pendingServerDataRef = useRef(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  const saveLocalData = useCallback((nextData, updatedAt = Date.now()) => {
    try {
      saveLocal(nextData);
      writeTimestamp(dataKey, updatedAt);
    } catch (error) {
      console.warn(`Could not cache ${dataKey} in this browser.`, error);
    }
  }, [dataKey, saveLocal]);

  const drainServerWrites = useCallback(() => {
    if (savingRef.current || pendingServerDataRef.current === null) return;
    savingRef.current = true;

    const run = async () => {
      while (pendingServerDataRef.current !== null) {
        const nextData = pendingServerDataRef.current;
        pendingServerDataRef.current = null;
        if (mountedRef.current) setSyncStatus("saving");

        try {
          const response = await api.put(`/workspace-data/${dataKey}`, {
            data: nextData,
          });
          const serverUpdatedAt = Date.parse(response.data?.updated_at || "") || Date.now();
          if (
            pendingServerDataRef.current === null &&
            dataRef.current === nextData
          ) {
            writeTimestamp(dataKey, serverUpdatedAt);
          }
          if (mountedRef.current && pendingServerDataRef.current === null) {
            setSyncStatus("synced");
          }
        } catch (error) {
          console.warn(`Could not save ${dataKey} to the ERP database.`, error);
          if (mountedRef.current) setSyncStatus("local");
          break;
        }
      }

      savingRef.current = false;
    };

    void run();
  }, [dataKey]);

  const queueServerSave = useCallback((nextData) => {
    pendingServerDataRef.current = nextData;
    drainServerWrites();
  }, [drainServerWrites]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const hydrate = async () => {
      try {
        const response = await api.get(`/workspace-data/${dataKey}`);
        if (cancelled) return;

        const serverFound = Boolean(response.data?.found);
        const serverUpdatedAt =
          Date.parse(response.data?.updated_at || "") || 0;
        const localIsNewer =
          initialLocal.exists &&
          initialLocal.updatedAt > serverUpdatedAt;

        hydratedRef.current = true;
        if (changedBeforeHydrationRef.current || localIsNewer) {
          queueServerSave(dataRef.current);
          return;
        }

        if (serverFound) {
          const serverData = normalize(response.data.data);
          dataRef.current = serverData;
          setDataState(serverData);
          saveLocalData(serverData, serverUpdatedAt || Date.now());
          setSyncStatus("synced");
          return;
        }

        if (initialLocal.exists) {
          queueServerSave(dataRef.current);
        } else {
          setSyncStatus("synced");
        }
      } catch (error) {
        if (cancelled) return;
        hydratedRef.current = true;
        setSyncStatus("local");
        console.warn(`Could not load ${dataKey} from the ERP database.`, error);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [dataKey, initialLocal, normalize, queueServerSave, saveLocalData]);

  const setData = useCallback((nextValue) => {
    setDataState((current) => {
      const candidate =
        typeof nextValue === "function" ? nextValue(current) : nextValue;
      const nextData = normalize(candidate);
      dataRef.current = nextData;
      saveLocalData(nextData);

      if (hydratedRef.current) {
        queueServerSave(nextData);
      } else {
        changedBeforeHydrationRef.current = true;
      }
      return nextData;
    });
  }, [normalize, queueServerSave, saveLocalData]);

  return [data, setData, syncStatus];
};
