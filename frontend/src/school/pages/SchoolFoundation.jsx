import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../../api/api";
import defaultSchoolLogo from "../../assets/dar-e-arqam-logo.svg";
import "./SchoolStudents.css";
import "./SchoolFoundation.css";

const EMPTY_DATA = {
  workspace: {},
  access: { permissions: [] },
  roles: [],
  campuses: [],
  sessions: [],
  terms: [],
  rooms: [],
  classes: [],
  sections: [],
  subjects: [],
  users: [],
  notifications: [],
  documents: [],
  activity: [],
};

const tabs = [
  ["overview", "Overview"],
  ["campuses", "Campuses"],
  ["academics", "Academic calendar"],
  ["structure", "Classes & subjects"],
  ["access", "Roles & accounts"],
  ["notifications", "Notifications"],
  ["documents", "Documents"],
  ["activity", "Activity history"],
];

const endpointByKind = {
  campus: "campuses",
  session: "sessions",
  term: "terms",
  room: "rooms",
  class: "classes",
  section: "sections",
  subject: "subjects",
  user: "users",
  notification: "notifications",
};

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.detail || error?.message || fallback;

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-PK", { dateStyle: "medium", timeZone: "Asia/Karachi" }).format(date);
};

function SchoolFoundation({ settings }) {
  const [data, setData] = useState(EMPTY_DATA);
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [documentForm, setDocumentForm] = useState({ title: "", category: "General", campus_id: "", file: null });

  const loadFoundation = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/school/foundation");
      setData({ ...EMPTY_DATA, ...(response.data || {}) });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error, "School foundation could not be loaded.") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadFoundation, 0);
    return () => window.clearTimeout(timer);
  }, [loadFoundation]);

  const campusMap = useMemo(() => new Map(data.campuses.map((item) => [item.id, item])), [data.campuses]);
  const sessionMap = useMemo(() => new Map(data.sessions.map((item) => [item.id, item])), [data.sessions]);
  const can = (permission) => data.access.permissions?.includes(permission);

  const defaultCampusId = data.campuses[0]?.id || "";
  const defaultSessionId = data.sessions.find((item) => item.is_current)?.id || data.sessions[0]?.id || "";

  const editorFields = (kind) => {
    const campusOptions = data.campuses.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }));
    const sessionOptions = data.sessions.map((item) => ({ value: item.id, label: item.name }));
    const classOptions = data.classes.map((item) => ({ value: item.id, label: `${item.name} · ${campusMap.get(item.campus_id)?.name || "Campus"}` }));
    const roomOptions = data.rooms.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }));
    const userOptions = data.users.map((item) => ({ value: item.user_id, label: `${item.name} · ${item.school_role}` }));
    const roleOptions = data.roles.map((item) => ({ value: item.name, label: item.name }));
    const configurations = {
      campus: [
        ["name", "Campus name", "text", true], ["code", "Campus code", "text", true],
        ["campus_type", "Campus type", "select", true, ["Main", "Branch", "Online"]],
        ["principal_name", "Principal", "text"], ["phone", "Phone", "text"], ["email", "Email", "email"],
        ["address", "Address", "textarea"], ["primary_color", "Primary color", "color"],
        ["accent_color", "Accent color", "color"], ["logo_data_url", "Campus logo URL or data image", "textarea"],
        ["is_active", "Active campus", "checkbox"],
      ],
      session: [
        ["campus_id", "Campus", "select", false, campusOptions], ["name", "Session name", "text", true],
        ["start_date", "Start date", "date", true], ["end_date", "End date", "date", true],
        ["status", "Status", "select", true, ["Upcoming", "Current", "Completed", "Archived"]],
        ["is_current", "Current session", "checkbox"],
      ],
      term: [
        ["academic_session_id", "Academic session", "select", true, sessionOptions],
        ["campus_id", "Campus", "select", false, campusOptions], ["name", "Term / semester name", "text", true],
        ["term_type", "Type", "select", true, ["Term", "Semester", "Quarter"]],
        ["sequence", "Sequence", "number", true], ["start_date", "Start date", "date", true],
        ["end_date", "End date", "date", true], ["status", "Status", "select", true, ["Upcoming", "Current", "Completed"]],
      ],
      room: [
        ["campus_id", "Campus", "select", true, campusOptions], ["name", "Room name", "text", true],
        ["code", "Room code", "text", true], ["room_type", "Room type", "select", true, ["Classroom", "Laboratory", "Library", "Hall", "Office", "Other"]],
        ["capacity", "Capacity", "number", true], ["floor", "Floor / block", "text"], ["is_active", "Active room", "checkbox"],
      ],
      class: [
        ["campus_id", "Campus", "select", true, campusOptions], ["academic_session_id", "Academic session", "select", true, sessionOptions],
        ["name", "Class name", "text", true], ["grade_level", "Grade level", "text"],
        ["display_order", "Display order", "number"], ["is_active", "Active class", "checkbox"],
      ],
      section: [
        ["school_class_id", "Class", "select", true, classOptions], ["name", "Section name", "text", true],
        ["room_id", "Assigned room", "select", false, roomOptions], ["class_teacher_user_id", "Class teacher", "select", false, userOptions],
        ["capacity", "Capacity", "number", true], ["is_active", "Active section", "checkbox"],
      ],
      subject: [
        ["campus_id", "Campus (blank means all)", "select", false, campusOptions], ["code", "Subject code", "text", true],
        ["name", "English name", "text", true], ["name_ur", "Urdu name", "text"],
        ["subject_type", "Subject type", "select", true, ["Core", "Elective", "Co-curricular", "Religious"]],
        ["total_marks", "Total marks", "number"], ["passing_marks", "Passing marks", "number"], ["is_active", "Active subject", "checkbox"],
      ],
      user: [
        ["name", "Full name", "text", true], ["username", "Username", "text", true],
        ["pin", "4-digit PIN", "password", true], ["phone", "Phone", "text"], ["email", "Email", "email"],
        ["campus_id", "Campus (blank means all)", "select", false, campusOptions],
        ["school_role", "School role", "select", true, roleOptions],
      ],
      notification: [
        ["campus_id", "Campus (blank means all)", "select", false, campusOptions],
        ["title", "English title", "text", true], ["title_ur", "Urdu title", "text"],
        ["body", "English message", "textarea", true], ["body_ur", "Urdu message", "textarea"],
        ["audience_type", "Audience", "select", true, ["All", "Campus", "Role", "User"]],
        ["audience_value", "Audience role or user ID", "text"], ["priority", "Priority", "select", true, ["Normal", "Important", "Emergency"]],
        ["status", "Status", "select", true, ["Draft", "Published"]],
      ],
    };
    return configurations[kind] || [];
  };

  const defaultsFor = (kind) => ({
    campus: { name: "", code: "", campus_type: "Branch", phone: "", email: "", address: "", principal_name: "", primary_color: "#191797", accent_color: "#fff200", logo_data_url: "", is_active: true },
    session: { campus_id: defaultCampusId, name: "", start_date: "", end_date: "", status: "Upcoming", is_current: false },
    term: { academic_session_id: defaultSessionId, campus_id: defaultCampusId, name: "", term_type: "Term", sequence: 1, start_date: "", end_date: "", status: "Upcoming" },
    room: { campus_id: defaultCampusId, name: "", code: "", room_type: "Classroom", capacity: 30, floor: "", is_active: true },
    class: { campus_id: defaultCampusId, academic_session_id: defaultSessionId, name: "", grade_level: "", display_order: data.classes.length + 1, is_active: true },
    section: { school_class_id: data.classes[0]?.id || "", name: "A", room_id: "", class_teacher_user_id: "", capacity: 30, is_active: true },
    subject: { campus_id: "", code: "", name: "", name_ur: "", subject_type: "Core", total_marks: 100, passing_marks: 40, is_active: true },
    user: { name: "", username: "", pin: "", phone: "", email: "", campus_id: defaultCampusId, school_role: "Teacher" },
    notification: { campus_id: "", title: "", title_ur: "", body: "", body_ur: "", audience_type: "All", audience_value: "", priority: "Normal", status: "Published" },
  })[kind];

  const openEditor = (kind, item = null) => {
    setEditor({ kind, item, values: item ? { ...item } : defaultsFor(kind) });
    setNotice(null);
  };

  const updateEditorField = (field, value, type) => {
    let normalized = value;
    if (type === "number") normalized = value === "" ? 0 : Number(value);
    if (type === "checkbox") normalized = Boolean(value);
    if (["campus_id", "academic_session_id", "school_class_id", "room_id", "class_teacher_user_id"].includes(field)) {
      normalized = value === "" ? null : Number(value);
    }
    setEditor((current) => ({ ...current, values: { ...current.values, [field]: normalized } }));
  };

  const saveEditor = async (event) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      const endpoint = endpointByKind[editor.kind];
      if (editor.item && editor.kind !== "user" && editor.kind !== "notification") {
        await api.put(`/school/foundation/${endpoint}/${editor.item.id}`, editor.values);
      } else {
        await api.post(`/school/foundation/${endpoint}`, editor.values);
      }
      setEditor(null);
      await loadFoundation();
      setNotice({ type: "success", text: `${editor.kind[0].toUpperCase()}${editor.kind.slice(1)} saved successfully.` });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error, "The record could not be saved.") });
    } finally {
      setSaving(false);
    }
  };

  const uploadDocument = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!documentForm.file || !documentForm.title.trim()) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("title", documentForm.title);
      formData.append("category", documentForm.category);
      if (documentForm.campus_id) formData.append("campus_id", documentForm.campus_id);
      formData.append("entity_type", "School");
      formData.append("file", documentForm.file);
      await api.post("/school/foundation/documents", formData);
      setDocumentForm({ title: "", category: "General", campus_id: "", file: null });
      formElement.reset();
      await loadFoundation();
      setNotice({ type: "success", text: "Document uploaded successfully." });
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error, "Document could not be uploaded.") });
    } finally {
      setSaving(false);
    }
  };

  const archiveNotification = async (id) => {
    try {
      await api.delete(`/school/foundation/notifications/${id}`);
      await loadFoundation();
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error, "Notification could not be archived.") });
    }
  };

  const deleteDocument = async (id) => {
    try {
      await api.delete(`/school/foundation/documents/${id}`);
      await loadFoundation();
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error, "Document could not be deleted.") });
    }
  };

  const logoSource = settings?.logo_data_url || defaultSchoolLogo;
  const summary = {
    campuses: data.campuses.filter((item) => item.is_active).length,
    sessions: data.sessions.length,
    classes: data.classes.filter((item) => item.is_active).length,
    accounts: data.users.filter((item) => item.is_active).length,
  };

  if (loading && !data.campuses.length) {
    return <div className="school-foundation-loading"><img src={logoSource} alt="" /><strong>Preparing school foundation…</strong></div>;
  }

  return (
    <section className="school-foundation-page">
      <header className="school-foundation-header">
        <div><p>{settings?.school_name || "Dar-e-Arqam"}</p><h1>System Foundation</h1><span>{data.access.school_role || "School access"} · PKR · Asia/Karachi</span></div>
        <div className="school-foundation-language"><span>English</span><strong>/</strong><span lang="ur" dir="rtl">اردو</span></div>
      </header>

      {notice && <div className={`school-notice is-${notice.type}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} type="button" aria-label="Dismiss">×</button></div>}

      <nav className="school-foundation-tabs" aria-label="School foundation sections">
        {tabs.map(([key, label]) => <button className={activeTab === key ? "is-active" : ""} key={key} onClick={() => setActiveTab(key)} type="button">{label}</button>)}
      </nav>

      {activeTab === "overview" && (
        <div className="school-foundation-overview">
          <div className="school-foundation-stats">
            <article><span>Active campuses</span><strong>{summary.campuses}</strong></article>
            <article><span>Academic sessions</span><strong>{summary.sessions}</strong></article>
            <article><span>Classes</span><strong>{summary.classes}</strong></article>
            <article><span>School accounts</span><strong>{summary.accounts}</strong></article>
          </div>
          <div className="school-foundation-columns">
            <section className="school-foundation-card"><div className="school-card-title"><div><h2>Workspace boundary</h2><p>School records remain scoped to this workspace and permitted campuses.</p></div><span className="is-ready">Active</span></div><dl className="school-foundation-details"><div><dt>Workspace</dt><dd>{data.workspace.name}</dd></div><div><dt>Currency</dt><dd>{data.workspace.default_currency}</dd></div><div><dt>Timezone</dt><dd>{data.workspace.timezone}</dd></div><div><dt>Languages</dt><dd>English · اردو</dd></div></dl></section>
            <section className="school-foundation-card"><div className="school-card-title"><div><h2>Foundation readiness</h2><p>Core setup required before admissions and attendance.</p></div></div><ul className="school-readiness-list"><li className={data.campuses.length ? "is-done" : ""}>Campus or branch configured</li><li className={data.sessions.length ? "is-done" : ""}>Academic session created</li><li className={data.classes.length ? "is-done" : ""}>Classes and sections created</li><li className={data.subjects.length ? "is-done" : ""}>Subjects configured</li><li className={data.users.length ? "is-done" : ""}>School roles assigned</li></ul></section>
          </div>
        </div>
      )}

      {activeTab === "campuses" && (
        <FoundationPanel title="Campuses and branches" description="Every campus has independent contact details and branding." action={can("manage_foundation") ? () => openEditor("campus") : null} actionLabel="Add campus">
          <div className="school-campus-grid">{data.campuses.map((campus) => <article className="school-campus-card" key={campus.id} style={{ "--campus-primary": campus.primary_color, "--campus-accent": campus.accent_color }}><div className="school-campus-brand"><span>{campus.logo_data_url ? <img src={campus.logo_data_url} alt="" /> : campus.code.slice(0, 2)}</span><div><h3>{campus.name}</h3><p>{campus.code} · {campus.campus_type}</p></div><i className={campus.is_active ? "is-active" : ""}>{campus.is_active ? "Active" : "Inactive"}</i></div><dl><div><dt>Principal</dt><dd>{campus.principal_name || "Not assigned"}</dd></div><div><dt>Phone</dt><dd>{campus.phone || "—"}</dd></div><div><dt>Email</dt><dd>{campus.email || "—"}</dd></div><div><dt>Address</dt><dd>{campus.address || "—"}</dd></div></dl>{can("manage_foundation") && <button onClick={() => openEditor("campus", campus)} type="button">Edit campus</button>}</article>)}</div>
        </FoundationPanel>
      )}

      {activeTab === "academics" && (
        <div className="school-foundation-stack">
          <FoundationPanel title="Academic sessions" description="Define the school year separately for each campus." action={can("manage_academics") ? () => openEditor("session") : null} actionLabel="Add session"><RecordTable headers={["Session", "Campus", "Period", "Status", ""]} rows={data.sessions.map((item) => [<strong key="name">{item.name}</strong>, campusMap.get(item.campus_id)?.name || "All campuses", `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`, item.is_current ? <Status key="status" text="Current" /> : item.status, can("manage_academics") ? <RowButton key="action" onClick={() => openEditor("session", item)}>Edit</RowButton> : null])} empty="No academic sessions configured." /></FoundationPanel>
          <FoundationPanel title="Terms and semesters" description="Create terms, semesters or quarters inside an academic session." action={can("manage_academics") ? () => openEditor("term") : null} actionLabel="Add term"><RecordTable headers={["Term", "Session", "Type", "Dates", ""]} rows={data.terms.map((item) => [<strong key="name">{item.name}</strong>, sessionMap.get(item.academic_session_id)?.name || "—", item.term_type, `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`, can("manage_academics") ? <RowButton key="action" onClick={() => openEditor("term", item)}>Edit</RowButton> : null])} empty="No terms or semesters configured." /></FoundationPanel>
        </div>
      )}

      {activeTab === "structure" && (
        <div className="school-foundation-stack">
          <FoundationPanel title="Classes and sections" description="Classes belong to a campus and session; sections can have rooms and class teachers." actions={can("manage_academics") ? [{ label: "Add section", run: () => openEditor("section") }, { label: "Add class", run: () => openEditor("class"), primary: true }] : []}><RecordTable headers={["Class", "Campus / session", "Sections", "Status", ""]} rows={data.classes.map((item) => { const sections = data.sections.filter((section) => section.school_class_id === item.id); return [<strong key="name">{item.name}</strong>, <span key="scope">{campusMap.get(item.campus_id)?.name || "—"}<small>{sessionMap.get(item.academic_session_id)?.name || ""}</small></span>, sections.length ? sections.map((section) => <button className="school-section-chip" key={section.id} onClick={() => openEditor("section", section)} type="button">{section.name}</button>) : "No sections", item.is_active ? <Status key="status" text="Active" /> : "Inactive", can("manage_academics") ? <RowButton key="action" onClick={() => openEditor("class", item)}>Edit</RowButton> : null]; })} empty="No classes configured." /></FoundationPanel>
          <div className="school-foundation-columns"><FoundationPanel title="Subjects" description="English and Urdu subject names with marks settings." action={can("manage_academics") ? () => openEditor("subject") : null} actionLabel="Add subject"><CompactList items={data.subjects.map((item) => ({ id: item.id, title: item.name, meta: `${item.code} · ${item.subject_type} · ${item.total_marks} marks`, badge: item.name_ur, onClick: can("manage_academics") ? () => openEditor("subject", item) : null }))} empty="No subjects configured." /></FoundationPanel><FoundationPanel title="Rooms" description="Classrooms, laboratories, halls and offices." action={can("manage_foundation") ? () => openEditor("room") : null} actionLabel="Add room"><CompactList items={data.rooms.map((item) => ({ id: item.id, title: item.name, meta: `${item.code} · ${campusMap.get(item.campus_id)?.name || "Campus"}`, badge: `${item.capacity} seats`, onClick: can("manage_foundation") ? () => openEditor("room", item) : null }))} empty="No rooms configured." /></FoundationPanel></div>
        </div>
      )}

      {activeTab === "access" && (
        <div className="school-foundation-stack">
          <FoundationPanel title="School-specific accounts" description="Accounts only receive the school role and campus scope assigned here." action={can("manage_users") ? () => openEditor("user") : null} actionLabel="Create account"><RecordTable headers={["User", "Role", "Campus", "Contact", "Status"]} rows={data.users.map((item) => [<span key="user"><strong>{item.name}</strong><small>@{item.username}</small></span>, item.school_role, campusMap.get(item.campus_id)?.name || "All campuses", item.phone || item.email || "—", item.is_active ? <Status key="status" text="Active" /> : "Inactive"])} empty="No school accounts created." /></FoundationPanel>
          <FoundationPanel title="Role permission matrix" description="Default permissions for all twelve school roles."><div className="school-role-grid">{data.roles.map((role) => <article key={role.name}><h3>{role.name}</h3><p>{role.permissions.length} permissions</p><div>{role.permissions.slice(0, 5).map((permission) => <span key={permission}>{permission.replaceAll("_", " ")}</span>)}{role.permissions.length > 5 && <span>+{role.permissions.length - 5} more</span>}</div></article>)}</div></FoundationPanel>
        </div>
      )}

      {activeTab === "notifications" && <FoundationPanel title="School notifications" description="Publish English and Urdu notices by campus, role or user." action={can("send_notifications") ? () => openEditor("notification") : null} actionLabel="New notification"><div className="school-notification-list">{data.notifications.length ? data.notifications.map((item) => <article className={item.status === "Archived" ? "is-archived" : ""} key={item.id}><span className={`is-${item.priority.toLowerCase()}`}>{item.priority}</span><div><h3>{item.title}</h3>{item.title_ur && <strong lang="ur" dir="rtl">{item.title_ur}</strong>}<p>{item.body}</p><small>{item.audience_type} · {campusMap.get(item.campus_id)?.name || "All campuses"} · {formatDate(item.created_at)}</small></div>{can("send_notifications") && item.status !== "Archived" && <button onClick={() => archiveNotification(item.id)} type="button">Archive</button>}</article>) : <Empty text="No notifications published." />}</div></FoundationPanel>}

      {activeTab === "documents" && (
        <FoundationPanel title="School documents" description="Store policies, forms, schedules, spreadsheets and campus documents.">
          {can("manage_documents") && <form className="school-document-upload" onSubmit={uploadDocument}><label><span>Document title</span><input value={documentForm.title} onChange={(event) => setDocumentForm((current) => ({ ...current, title: event.target.value }))} required /></label><label><span>Category</span><select value={documentForm.category} onChange={(event) => setDocumentForm((current) => ({ ...current, category: event.target.value }))}><option>General</option><option>Policy</option><option>Academic</option><option>Admissions</option><option>Staff</option><option>Finance</option></select></label><label><span>Campus</span><select value={documentForm.campus_id} onChange={(event) => setDocumentForm((current) => ({ ...current, campus_id: event.target.value }))}><option value="">All campuses</option>{data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label><label className="school-file-picker"><span>File · max 15 MB</span><input type="file" onChange={(event) => setDocumentForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} required /></label><button className="school-foundation-primary" disabled={saving} type="submit">{saving ? "Uploading…" : "Upload document"}</button></form>}
          <div className="school-document-list">{data.documents.length ? data.documents.map((item) => <article key={item.id}><span>{item.original_filename.split(".").pop()?.toUpperCase()}</span><div><a href={getStaticUrl(item.file_url)} target="_blank" rel="noreferrer">{item.title}</a><small>{item.category} · {campusMap.get(item.campus_id)?.name || "All campuses"} · {(item.file_size / 1024).toFixed(1)} KB</small></div>{can("manage_documents") && <button onClick={() => deleteDocument(item.id)} type="button">Delete</button>}</article>) : <Empty text="No documents uploaded." />}</div>
        </FoundationPanel>
      )}

      {activeTab === "activity" && <FoundationPanel title="Complete activity history" description="School setup and management changes are recorded with user, time and route."><div className="school-activity-list">{data.activity.length ? data.activity.map((item) => <article key={item.id}><span>{String(item.action || "log").slice(0, 1).toUpperCase()}</span><div><strong>{item.summary}</strong><small>{item.actor_user_name || "System"} · {formatDate(item.created_at)} · {item.entity_type || "School"}</small></div></article>) : <Empty text="No school activity recorded yet." />}</div></FoundationPanel>}

      {editor && (
        <div className="school-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}>
          <form className="school-foundation-editor" onSubmit={saveEditor}>
            <div className="school-modal-header"><div><p>{editor.item ? "Update setup" : "New setup record"}</p><h2>{editor.kind[0].toUpperCase()}{editor.kind.slice(1)}</h2></div><button onClick={() => setEditor(null)} type="button" aria-label="Close">×</button></div>
            <div className="school-foundation-editor-fields">{editorFields(editor.kind).map(([name, label, type, required, options]) => <label className={type === "textarea" ? "is-wide" : ""} key={name}><span>{label}{required ? " *" : ""}</span>{type === "textarea" ? <textarea rows="3" value={editor.values[name] ?? ""} onChange={(event) => updateEditorField(name, event.target.value, type)} required={required} /> : type === "select" ? <select value={editor.values[name] ?? ""} onChange={(event) => updateEditorField(name, event.target.value, type)} required={required}><option value="">Select</option>{(options || []).map((option) => { const value = typeof option === "object" ? option.value : option; const optionLabel = typeof option === "object" ? option.label : option; return <option key={value} value={value}>{optionLabel}</option>; })}</select> : type === "checkbox" ? <span className="school-editor-checkbox"><input type="checkbox" checked={Boolean(editor.values[name])} onChange={(event) => updateEditorField(name, event.target.checked, type)} /> Enabled</span> : <input type={type} value={editor.values[name] ?? ""} onChange={(event) => updateEditorField(name, event.target.value, type)} required={required} min={type === "number" ? 0 : undefined} />}</label>)}</div>
            <div className="school-modal-actions"><button className="school-secondary-button" onClick={() => setEditor(null)} type="button">Cancel</button><button className="school-primary-button" disabled={saving} type="submit">{saving ? "Saving…" : "Save"}</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

function FoundationPanel({ title, description, action, actionLabel, actions = [], children }) {
  const buttons = actions.length ? actions : action ? [{ label: actionLabel, run: action, primary: true }] : [];
  return <section className="school-foundation-card"><div className="school-card-title"><div><h2>{title}</h2><p>{description}</p></div>{buttons.length > 0 && <div className="school-panel-actions">{buttons.map((button) => <button className={button.primary ? "school-foundation-primary" : ""} key={button.label} onClick={button.run} type="button">{button.label}</button>)}</div>}</div>{children}</section>;
}

function RecordTable({ headers, rows, empty }) {
  if (!rows.length) return <Empty text={empty} />;
  return <div className="school-foundation-table-wrap"><table className="school-foundation-table"><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function CompactList({ items, empty }) {
  if (!items.length) return <Empty text={empty} />;
  return <div className="school-compact-list">{items.map((item) => <button disabled={!item.onClick} key={item.id} onClick={item.onClick || undefined} type="button"><div><strong>{item.title}</strong><small>{item.meta}</small></div>{item.badge && <span>{item.badge}</span>}</button>)}</div>;
}

function Status({ text }) { return <span className="school-foundation-status">{text}</span>; }
function RowButton({ onClick, children }) { return <button className="school-foundation-row-button" onClick={onClick} type="button">{children}</button>; }
function Empty({ text }) { return <div className="school-foundation-empty">{text}</div>; }

export default SchoolFoundation;
