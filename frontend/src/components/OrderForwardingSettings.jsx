import { useEffect, useState } from "react";
import api from "../api/api";
import WorkerForwarding from "./WorkerForwarding";

export default function OrderForwardingSettings() {
  const [workers, setWorkers] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.get("/workers").then(({ data }) => { if (active) setWorkers(data); })
      .catch((err) => { if (active) setError(err.response?.data?.detail || "Workers could not be loaded."); });
    return () => { active = false; };
  }, []);
  return <>{error && <p role="alert">{error}</p>}<WorkerForwarding workers={workers} /></>;
}
