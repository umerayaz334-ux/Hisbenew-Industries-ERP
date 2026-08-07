export const getAccessToken = () => {
  if (typeof window === "undefined") return null;
  try {
    const rawUser = window.localStorage.getItem("erpUser");
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser);
    return parsed?.access_token || null;
  } catch {
    return null;
  }
};

export const saveAuthenticatedUser = (user) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("erpUser", JSON.stringify(user));
  } catch {
    // ignore storage failures
  }
};

export const clearAuthenticatedUser = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("erpUser");
  } catch {
    // ignore storage failures
  }
};
