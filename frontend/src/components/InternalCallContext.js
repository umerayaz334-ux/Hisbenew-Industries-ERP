import { createContext, useContext } from "react";

export const InternalCallContext = createContext(null);

export function useInternalCall() {
  const context = useContext(InternalCallContext);
  if (!context) throw new Error("useInternalCall must be used inside InternalCallProvider");
  return context;
}
