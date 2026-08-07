export const DEFAULT_SCHOOL_SETTINGS = {
  school_name: "Dar-e-Arqam",
  campus_name: "School ERP",
  academic_session: "2026-2027",
  primary_color: "#191797",
  accent_color: "#fff200",
  surface_color: "#ffffff",
  logo_data_url: "",
  splash_enabled: true,
  interface_language: "en",
  secondary_language: "ur",
  currency: "PKR",
  timezone: "Asia/Karachi",
};

const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ""));

export const normalizeSchoolSettings = (settings = {}) => ({
  ...DEFAULT_SCHOOL_SETTINGS,
  ...settings,
  primary_color: isHexColor(settings.primary_color)
    ? settings.primary_color
    : DEFAULT_SCHOOL_SETTINGS.primary_color,
  accent_color: isHexColor(settings.accent_color)
    ? settings.accent_color
    : DEFAULT_SCHOOL_SETTINGS.accent_color,
  surface_color: isHexColor(settings.surface_color)
    ? settings.surface_color
    : DEFAULT_SCHOOL_SETTINGS.surface_color,
  splash_enabled: settings.splash_enabled !== false,
  interface_language: settings.interface_language === "ur" ? "ur" : "en",
  secondary_language: settings.secondary_language === "en" ? "en" : "ur",
  currency: "PKR",
  timezone: "Asia/Karachi",
});

const schoolTranslations = {
  en: {
    home: "Home",
    students: "Students",
    attendance: "Attendance",
    finance: "Fees & Accounting",
    foundation: "Foundation",
    settings: "Settings",
    switchWorkspace: "Switch workspace",
    schoolWorkspace: "School workspace",
  },
  ur: {
    home: "ہوم",
    students: "طلبہ",
    attendance: "حاضری",
    finance: "فیس اور اکاؤنٹنگ",
    foundation: "انتظام",
    settings: "ترتیبات",
    switchWorkspace: "ورک اسپیس تبدیل کریں",
    schoolWorkspace: "اسکول ورک اسپیس",
  },
};

export const schoolText = (language, key) =>
  schoolTranslations[language === "ur" ? "ur" : "en"]?.[key] ||
  schoolTranslations.en[key] ||
  key;

export const schoolThemeStyle = (settings) => {
  const normalized = normalizeSchoolSettings(settings);
  return {
    "--school-primary": normalized.primary_color,
    "--school-accent": normalized.accent_color,
    "--school-surface": normalized.surface_color,
  };
};
