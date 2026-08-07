import { useEffect, useState } from "react";
import api from "../../api/api";
import defaultSchoolLogo from "../../assets/dar-e-arqam-logo.svg";
import { DEFAULT_SCHOOL_SETTINGS, normalizeSchoolSettings } from "../theme";
import "./SchoolStudents.css";
import "./SchoolSettings.css";

const THEME_PRESETS = [
  { name: "Dar-e-Arqam Classic", primary: "#191797", accent: "#fff200", surface: "#ffffff" },
  { name: "Royal Navy", primary: "#15145f", accent: "#f6ce3a", surface: "#ffffff" },
  { name: "Bright Academic", primary: "#233bbd", accent: "#ffeb00", surface: "#fbfcff" },
];

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

function SchoolSettings({ settings, onSettingsChange }) {
  const [form, setForm] = useState(() => normalizeSchoolSettings(settings));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setForm(normalizeSchoolSettings(settings)),
      0
    );
    return () => window.clearTimeout(timer);
  }, [settings]);

  const updateField = (event) => {
    const { checked, name, type, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };

  const applyPreset = (preset) => {
    setForm((current) => ({
      ...current,
      primary_color: preset.primary,
      accent_color: preset.accent,
      surface_color: preset.surface,
    }));
  };

  const uploadLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice({ type: "error", text: "Please choose a PNG, JPG, WebP, or SVG image." });
      return;
    }
    if (file.size > 1_400_000) {
      setNotice({ type: "error", text: "Logo must be smaller than 1.4 MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, logo_data_url: String(reader.result || "") }));
      setNotice({ type: "success", text: "Logo selected. Save settings to apply it everywhere." });
    };
    reader.onerror = () => setNotice({ type: "error", text: "The logo file could not be read." });
    reader.readAsDataURL(file);
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await api.put("/school/settings", form);
      const saved = normalizeSchoolSettings(response.data);
      setForm(saved);
      onSettingsChange?.(saved);
      setNotice({ type: "success", text: "School appearance settings saved." });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error, "Settings could not be saved.") });
    } finally {
      setSaving(false);
    }
  };

  const resetBranding = () => {
    setForm((current) => ({ ...current, ...DEFAULT_SCHOOL_SETTINGS }));
    setNotice({ type: "success", text: "Dar-e-Arqam default branding restored. Save to confirm." });
  };

  const logoSource = form.logo_data_url || defaultSchoolLogo;

  return (
    <section className="school-settings-page">
      <header className="school-page-header">
        <div className="school-page-heading">
          <img src={logoSource} alt="" />
          <div><p>{form.school_name}</p><h1>School Settings</h1><span>Branding, theme and opening experience</span></div>
        </div>
      </header>

      {notice && <div className={`school-notice is-${notice.type}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} type="button" aria-label="Dismiss message">×</button></div>}

      <form className="school-settings-layout" onSubmit={saveSettings}>
        <div className="school-settings-form">
          <section className="school-settings-card">
            <div className="school-settings-card-heading"><span>01</span><div><h2>School identity</h2><p>The name and session shown across the school ERP.</p></div></div>
            <div className="school-settings-fields">
              <label><span>School name</span><input name="school_name" value={form.school_name} onChange={updateField} required /></label>
              <label><span>Campus / workspace name</span><input name="campus_name" value={form.campus_name} onChange={updateField} required /></label>
              <label><span>Academic session</span><input name="academic_session" value={form.academic_session} onChange={updateField} placeholder="2026-2027" /></label>
            </div>
          </section>

          <section className="school-settings-card">
            <div className="school-settings-card-heading"><span>02</span><div><h2>Logo</h2><p>The supplied Dar-e-Arqam book and sun logo is the default.</p></div></div>
            <div className="school-logo-setting">
              <div className="school-logo-preview"><img src={logoSource} alt="Current school logo" /></div>
              <div><label className="school-logo-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} /><span>Choose another logo</span></label><button className="school-link-button" onClick={() => setForm((current) => ({ ...current, logo_data_url: "" }))} type="button">Use Dar-e-Arqam default logo</button><small>PNG, JPG, WebP or SVG · maximum 1.4 MB</small></div>
            </div>
          </section>

          <section className="school-settings-card">
            <div className="school-settings-card-heading"><span>03</span><div><h2>Theme and colors</h2><p>Choose a preset or set exact colors for this workspace.</p></div></div>
            <div className="school-theme-presets">
              {THEME_PRESETS.map((preset) => {
                const selected = form.primary_color.toLowerCase() === preset.primary.toLowerCase() && form.accent_color.toLowerCase() === preset.accent.toLowerCase();
                return <button className={selected ? "is-selected" : ""} key={preset.name} onClick={() => applyPreset(preset)} type="button"><span><i style={{ background: preset.primary }} /><i style={{ background: preset.accent }} /></span><strong>{preset.name}</strong><small>{selected ? "Selected" : "Apply theme"}</small></button>;
              })}
            </div>
            <div className="school-color-fields">
              <label><span>Primary blue</span><div><input type="color" name="primary_color" value={form.primary_color} onChange={updateField} /><code>{form.primary_color}</code></div></label>
              <label><span>Accent yellow</span><div><input type="color" name="accent_color" value={form.accent_color} onChange={updateField} /><code>{form.accent_color}</code></div></label>
              <label><span>Surface</span><div><input type="color" name="surface_color" value={form.surface_color} onChange={updateField} /><code>{form.surface_color}</code></div></label>
            </div>
          </section>

          <section className="school-settings-card">
            <div className="school-settings-card-heading"><span>04</span><div><h2>Language and regional settings</h2><p>School records use PKR and Pakistan Standard Time.</p></div></div>
            <div className="school-settings-fields">
              <label><span>Interface language</span><select name="interface_language" value={form.interface_language} onChange={updateField}><option value="en">English</option><option value="ur">اردو (Urdu)</option></select></label>
              <label><span>Secondary language</span><select name="secondary_language" value={form.secondary_language} onChange={updateField}><option value="ur">اردو (Urdu)</option><option value="en">English</option></select></label>
              <label><span>Currency</span><input value="PKR — Pakistani Rupee" readOnly /></label>
              <label><span>Timezone</span><input value="Asia/Karachi — Pakistan Standard Time" readOnly /></label>
            </div>
          </section>

          <section className="school-settings-card">
            <div className="school-settings-card-heading"><span>05</span><div><h2>Opening screen</h2><p>Show the animated logo briefly when switching into the school ERP.</p></div></div>
            <label className="school-setting-toggle"><span><strong>Branded opening animation</strong><small>Displays the school logo and loading bar once when entering.</small></span><input type="checkbox" name="splash_enabled" checked={form.splash_enabled} onChange={updateField} /><i /></label>
          </section>

          <div className="school-settings-actions"><button className="school-secondary-button" onClick={resetBranding} type="button">Restore defaults</button><button className="school-primary-button" disabled={saving} type="submit">{saving ? "Saving…" : "Save school settings"}</button></div>
        </div>

        <aside className="school-settings-preview" style={{ "--preview-primary": form.primary_color, "--preview-accent": form.accent_color, "--preview-surface": form.surface_color }}>
          <p>Live preview</p>
          <div className="school-preview-window">
            <div className="school-preview-sidebar"><img src={logoSource} alt="" /><span /><span /><span /></div>
            <div className="school-preview-content"><small>{form.academic_session}</small><h2>{form.school_name}</h2><p>{form.campus_name}</p><div><span /><span /><span /></div><button type="button">Add student</button></div>
          </div>
          <small>Changes preview here immediately and apply across the School ERP after saving.</small>
        </aside>
      </form>
    </section>
  );
}

export default SchoolSettings;
