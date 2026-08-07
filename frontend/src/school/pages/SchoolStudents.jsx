import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { getStaticUrl } from "../../api/api";
import defaultSchoolLogo from "../../assets/dar-e-arqam-logo.svg";
import "./SchoolStudents.css";

const today = () => new Date().toISOString().slice(0, 10);
const emptyApplication = () => ({
  campus_id: "", academic_session_id: "", school_class_id: "", school_section_id: "",
  source: "Office", student_name: "", date_of_birth: "", gender: "", b_form_no: "",
  birth_certificate_no: "", father_name: "", mother_name: "", guardian_name: "",
  guardian_phone: "", guardian_email: "", address: "", previous_school: "",
  medical_conditions: "", allergies: "", special_requirements: "",
  emergency_contact_name: "", emergency_contact_phone: "", custom_answers: {},
});
const emptyWorkflow = () => ({
  status: "Under Review", test_scheduled_at: "", test_venue: "", test_score: "",
  test_result: "", interview_scheduled_at: "", interviewer: "", interview_result: "",
  review_notes: "", rejection_reason: "", school_class_id: "", school_section_id: "",
});
const emptyGuardian = { full_name: "", relationship_type: "Father", cnic: "", phone: "", alternate_phone: "", email: "", occupation: "", employer: "", address: "", is_primary: false, is_authorized_pickup: true, receives_notifications: true };
const emptyEmergency = { full_name: "", relationship_type: "", phone: "", alternate_phone: "", priority: 1, notes: "" };
const emptyMedical = { blood_group: "", medical_conditions: "", allergies: "", medications: "", disabilities: "", special_requirements: "", doctor_name: "", doctor_phone: "", health_notes: "" };
const emptyLifecycle = () => ({ event_type: "Promotion", event_date: today(), campus_id: "", academic_session_id: "", school_class_id: "", school_section_id: "", reason: "", notes: "" });
const emptyCertificate = () => ({ certificate_type: "Transfer Certificate", issue_date: today(), purpose: "", conduct: "Good", remarks: "" });
const emptyField = { campus_id: null, field_key: "", label: "", label_ur: "", input_type: "text", options: [], is_required: false, is_active: true, display_order: 100 };

const errorMessage = (error, fallback = "The request could not be completed.") => error?.response?.data?.detail || error?.message || fallback;
const html = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const statusClass = (status) => String(status || "unknown").toLowerCase().replaceAll(" ", "-");

function SchoolStudents({ settings, permissions }) {
  const [tab, setTab] = useState("admissions");
  const [students, setStudents] = useState([]);
  const [admissions, setAdmissions] = useState({ applications: [], counts: {}, form_fields: [], statuses: [] });
  const [foundation, setFoundation] = useState({ campuses: [], sessions: [], classes: [], sections: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [campusFilter, setCampusFilter] = useState("All");
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationForm, setApplicationForm] = useState(emptyApplication());
  const [workflowApplication, setWorkflowApplication] = useState(null);
  const [workflowForm, setWorkflowForm] = useState(emptyWorkflow());
  const [formBuilderOpen, setFormBuilderOpen] = useState(false);
  const [newField, setNewField] = useState(emptyField);
  const [profile, setProfile] = useState(null);
  const [profileTab, setProfileTab] = useState("overview");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileForm, setProfileForm] = useState({});
  const [guardianForm, setGuardianForm] = useState(emptyGuardian);
  const [emergencyForm, setEmergencyForm] = useState(emptyEmergency);
  const [medicalForm, setMedicalForm] = useState(emptyMedical);
  const [siblingForm, setSiblingForm] = useState({ sibling_student_id: "", family_discount_percent: 0, notes: "" });
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [lifecycleForm, setLifecycleForm] = useState(emptyLifecycle());
  const [certificateForm, setCertificateForm] = useState(emptyCertificate());
  const importInputRef = useRef(null);
  const canViewAdmissions = permissions ? permissions.includes("view_admissions") : true;
  const canManageAdmissions = permissions ? permissions.includes("manage_admissions") : true;
  const canManageStudents = permissions ? permissions.includes("manage_students") : true;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [studentResult, admissionResult, foundationResult] = await Promise.allSettled([
        api.get("/school/student-information"),
        canViewAdmissions ? api.get("/school/admissions") : Promise.resolve({ data: { applications: [], counts: {}, form_fields: [], statuses: [] } }),
        api.get("/school/foundation"),
      ]);
      if (studentResult.status === "rejected") throw studentResult.reason;
      if (foundationResult.status === "rejected") throw foundationResult.reason;
      setStudents(studentResult.value.data || []);
      setAdmissions(admissionResult.status === "fulfilled" ? admissionResult.value.data : { applications: [], counts: {}, form_fields: [], statuses: [] });
      if (admissionResult.status === "rejected" && admissionResult.reason?.response?.status !== 403) throw admissionResult.reason;
      if (!canViewAdmissions || admissionResult.status === "rejected") setTab("students");
      setFoundation({
        campuses: foundationResult.value.data?.campuses || [], sessions: foundationResult.value.data?.sessions || [],
        classes: foundationResult.value.data?.classes || [], sections: foundationResult.value.data?.sections || [],
      });
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error, "Student information could not be loaded.") });
    } finally {
      setLoading(false);
    }
  }, [canViewAdmissions]);

  useEffect(() => {
    const timer = window.setTimeout(loadData, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const filteredStudents = useMemo(() => students.filter((student) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [student.student_name, student.admission_no, student.b_form_no, student.guardian_name, student.guardian_phone, student.roll_number].some((value) => String(value || "").toLowerCase().includes(query));
    return matchesSearch && (statusFilter === "All" || student.status === statusFilter) && (campusFilter === "All" || student.campus_id === Number(campusFilter));
  }), [campusFilter, search, statusFilter, students]);

  const filteredApplications = useMemo(() => admissions.applications.filter((application) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [application.student_name, application.application_no, application.guardian_phone, application.b_form_no].some((value) => String(value || "").toLowerCase().includes(query));
    return matchesSearch && (statusFilter === "All" || application.status === statusFilter) && (campusFilter === "All" || application.campus_id === Number(campusFilter));
  }), [admissions.applications, campusFilter, search, statusFilter]);

  const stats = {
    applications: admissions.applications.filter((item) => !["Admitted", "Rejected", "Withdrawn"].includes(item.status)).length,
    tests: admissions.applications.filter((item) => item.status === "Test Scheduled").length,
    active: students.filter((item) => item.status === "Active").length,
    alumni: students.filter((item) => ["Graduated", "Alumni"].includes(item.status)).length,
  };
  const logo = settings?.logo_data_url || defaultSchoolLogo;

  const classesFor = (campusId, sessionId) => foundation.classes.filter((item) => item.campus_id === Number(campusId) && (!sessionId || item.academic_session_id === Number(sessionId)));
  const sectionsFor = (classId) => foundation.sections.filter((item) => item.school_class_id === Number(classId));

  const openApplication = () => {
    const campusId = foundation.campuses[0]?.id || "";
    const sessionId = foundation.sessions.find((item) => item.is_current && (!item.campus_id || item.campus_id === campusId))?.id || foundation.sessions[0]?.id || "";
    setApplicationForm({ ...emptyApplication(), campus_id: campusId, academic_session_id: sessionId });
    setApplicationOpen(true);
  };

  const updateApplication = (event) => {
    const { name, value } = event.target;
    setApplicationForm((current) => ({
      ...current, [name]: value,
      ...(name === "campus_id" ? { school_class_id: "", school_section_id: "" } : {}),
      ...(name === "school_class_id" ? { school_section_id: "" } : {}),
    }));
  };

  const saveApplication = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/school/admissions", {
        ...applicationForm,
        campus_id: Number(applicationForm.campus_id), academic_session_id: Number(applicationForm.academic_session_id),
        school_class_id: applicationForm.school_class_id ? Number(applicationForm.school_class_id) : null,
        school_section_id: applicationForm.school_section_id ? Number(applicationForm.school_section_id) : null,
      });
      setApplicationOpen(false);
      await loadData();
      setNotice({ type: "success", text: "Office admission application created." });
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error) });
    } finally { setBusy(false); }
  };

  const openWorkflow = (application, status = "Under Review") => {
    setWorkflowApplication(application);
    setWorkflowForm({ ...emptyWorkflow(), status, school_class_id: application.school_class_id || "", school_section_id: application.school_section_id || "" });
  };

  const saveWorkflow = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...workflowForm,
        test_score: workflowForm.test_score === "" ? null : Number(workflowForm.test_score),
        school_class_id: workflowForm.school_class_id ? Number(workflowForm.school_class_id) : null,
        school_section_id: workflowForm.school_section_id ? Number(workflowForm.school_section_id) : null,
      };
      const response = await api.post(`/school/admissions/${workflowApplication.id}/transition`, payload);
      setWorkflowApplication(null);
      await loadData();
      setNotice({ type: "success", text: response.data?.student ? `Student admitted as ${response.data.student.admission_no}.` : `Application moved to ${payload.status}.` });
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error) });
    } finally { setBusy(false); }
  };

  const loadProfile = useCallback(async (studentId, nextTab = profileTab) => {
    setProfileLoading(true);
    try {
      const response = await api.get(`/school/student-information/${studentId}`);
      setProfile(response.data);
      const student = response.data.student;
      setProfileForm({
        student_name: student.student_name || "", father_name: student.father_name || "", mother_name: student.mother_name || "",
        guardian_name: student.guardian_name || "", guardian_phone: student.guardian_phone || "", date_of_birth: student.date_of_birth || "",
        gender: student.gender || "", b_form_no: student.b_form_no || "", birth_certificate_no: student.birth_certificate_no || "",
        previous_school: student.previous_school || "", address: student.address || "", preferred_language: student.preferred_language || "en",
        family_discount_percent: student.family_discount_percent || 0, notes: student.notes || "",
      });
      setMedicalForm({ ...emptyMedical, ...(response.data.medical || {}), id: undefined, workspace_id: undefined, student_id: undefined, created_at: undefined, updated_at: undefined, updated_by_user_id: undefined });
      setProfileTab(nextTab);
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error, "Student profile could not be loaded.") });
    } finally { setProfileLoading(false); }
  }, [profileTab]);

  const openProfile = (student) => {
    setProfile({ student, guardians: [], emergency_contacts: [], siblings: [], documents: [], history: [], enrollments: [], certificates: [], medical: null });
    setProfileTab("overview");
    loadProfile(student.id, "overview");
  };

  const refreshProfile = async (tabName = profileTab) => {
    if (profile?.student?.id) await loadProfile(profile.student.id, tabName);
    await loadData();
  };

  const saveProfile = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.put(`/school/student-information/${profile.student.id}`, profileForm); await refreshProfile("overview"); setNotice({ type: "success", text: "Student profile updated." }); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const addGuardian = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.post(`/school/student-information/${profile.student.id}/guardians`, guardianForm); setGuardianForm(emptyGuardian); await refreshProfile("family"); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const addEmergency = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.post(`/school/student-information/${profile.student.id}/emergency-contacts`, emergencyForm); setEmergencyForm(emptyEmergency); await refreshProfile("family"); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const linkSibling = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.post(`/school/student-information/${profile.student.id}/siblings`, { ...siblingForm, sibling_student_id: Number(siblingForm.sibling_student_id), family_discount_percent: Number(siblingForm.family_discount_percent || 0) }); setSiblingForm({ sibling_student_id: "", family_discount_percent: 0, notes: "" }); await refreshProfile("family"); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const saveMedical = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.put(`/school/student-information/${profile.student.id}/medical`, medicalForm); await refreshProfile("medical"); setNotice({ type: "success", text: "Medical and special requirements saved." }); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const uploadDocument = async (event) => {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    try { await api.post(`/school/student-information/${profile.student.id}/documents`, data); event.currentTarget.reset(); await refreshProfile("documents"); setNotice({ type: "success", text: "Document uploaded securely." }); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const removeItem = async (path, refreshTab) => {
    setBusy(true);
    try { await api.delete(path); await refreshProfile(refreshTab); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const openLifecycle = () => {
    const student = profile.student;
    setLifecycleForm({ ...emptyLifecycle(), campus_id: student.campus_id || "", academic_session_id: student.academic_session_id || "", school_class_id: student.school_class_id || "", school_section_id: student.school_section_id || "" });
    setLifecycleOpen(true);
  };

  const saveLifecycle = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      await api.post(`/school/student-information/${profile.student.id}/lifecycle`, {
        ...lifecycleForm, campus_id: lifecycleForm.campus_id ? Number(lifecycleForm.campus_id) : null,
        academic_session_id: lifecycleForm.academic_session_id ? Number(lifecycleForm.academic_session_id) : null,
        school_class_id: lifecycleForm.school_class_id ? Number(lifecycleForm.school_class_id) : null,
        school_section_id: lifecycleForm.school_section_id ? Number(lifecycleForm.school_section_id) : null,
      });
      setLifecycleOpen(false); await refreshProfile("history"); setNotice({ type: "success", text: `${lifecycleForm.event_type} recorded without deleting previous enrollment.` });
    } catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const issueCertificate = async (event) => {
    event.preventDefault(); setBusy(true);
    try { const response = await api.post(`/school/student-information/${profile.student.id}/certificates`, certificateForm); await refreshProfile("cards"); printCertificate(response.data); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const printWindow = (title, body, landscape = false) => {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) { setNotice({ type: "error", text: "Allow pop-ups to print this document." }); return; }
    popup.document.write(`<!doctype html><html><head><title>${html(title)}</title><style>@page{size:${landscape ? "landscape" : "A4"};margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#17182b}.brand{color:${html(settings?.primary_color || "#191797")}}.accent{border-color:${html(settings?.accent_color || "#fff200")}}button{display:none}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${body}<script>window.onload=()=>{window.print()}</script></body></html>`);
    popup.document.close();
  };

  const printIdCard = () => {
    const student = profile.student;
    const photo = student.photo_url ? `<img src="${html(getStaticUrl(student.photo_url))}" style="width:92px;height:105px;object-fit:cover;border-radius:9px">` : `<div style="width:92px;height:105px;display:grid;place-items:center;background:#eef0fb;border-radius:9px;font-size:36px;font-weight:900">${html(student.student_name.slice(0, 1))}</div>`;
    printWindow("Student ID Card", `<div style="width:340px;border:2px solid ${html(settings?.primary_color || "#191797")};border-radius:18px;overflow:hidden"><header style="display:flex;gap:12px;align-items:center;padding:14px;background:${html(settings?.primary_color || "#191797")};color:white"><img src="${html(logo)}" style="width:48px;height:48px;background:white;border-radius:9px"><div><b>${html(settings?.school_name || "Dar-e-Arqam")}</b><small style="display:block;margin-top:3px">STUDENT IDENTITY CARD</small></div></header><div style="display:flex;gap:14px;padding:18px">${photo}<div><h2 style="margin:0 0 8px;font-size:18px">${html(student.student_name)}</h2><p style="margin:4px 0"><b>ID:</b> ${html(student.admission_no)}</p><p style="margin:4px 0"><b>Class:</b> ${html(student.class_name)} ${html(student.section || "")}</p><p style="margin:4px 0"><b>Roll:</b> ${html(student.roll_number || "-")}</p><p style="margin:4px 0"><b>Campus:</b> ${html(student.campus_name || "")}</p></div></div><footer style="padding:9px 14px;background:${html(settings?.accent_color || "#fff200")};font-size:11px;font-weight:bold">Valid for ${html(student.session_name || settings?.academic_session || "current session")}</footer></div>`);
  };

  const printCertificate = (certificate) => {
    const student = profile.student;
    const transfer = certificate.certificate_type === "Transfer Certificate";
    printWindow(certificate.certificate_type, `<section style="min-height:250mm;border:8px double ${html(settings?.primary_color || "#191797")};padding:30px;text-align:center"><img src="${html(logo)}" style="width:95px;height:95px;object-fit:contain"><h1 class="brand" style="font-size:30px;margin:12px 0 3px">${html(settings?.school_name || "Dar-e-Arqam")}</h1><p style="margin:0">${html(student.campus_name || settings?.campus_name || "")}</p><h2 style="margin:45px 0 8px;text-decoration:underline">${html(certificate.certificate_type)}</h2><p style="font-size:14px">Certificate No. ${html(certificate.certificate_no)} &nbsp; | &nbsp; Date ${html(certificate.issue_date)}</p><p style="margin:45px auto;max-width:680px;font-size:18px;line-height:2.1;text-align:justify">This is to certify that <b>${html(student.student_name)}</b>, admission number <b>${html(student.admission_no)}</b>, ${student.father_name ? `son/daughter of <b>${html(student.father_name)}</b>,` : ""} studied in <b>${html(student.class_name)} ${html(student.section || "")}</b> at this institution. ${transfer ? `The student is leaving the school for ${html(certificate.purpose || "further education")}.` : `The student's conduct has been <b>${html(certificate.conduct || "Good")}</b>.`} ${html(certificate.remarks || "")}</p><div style="display:flex;justify-content:space-between;margin-top:80px"><span>________________<br>Class Teacher</span><span>School stamp</span><span>________________<br>Principal</span></div></section>`);
  };

  const downloadFile = async (format) => {
    setBusy(true);
    try {
      const params = { format, ...(campusFilter !== "All" ? { campus_id: Number(campusFilter) } : {}), ...(statusFilter !== "All" ? { status: statusFilter } : {}) };
      const response = await api.get("/school/student-files/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(response.data); const link = document.createElement("a"); link.href = url; link.download = `dar-e-arqam-students-${today()}.${format}`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { setNotice({ type: "error", text: errorMessage(error, "Export failed.") }); }
    finally { setBusy(false); }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); const data = new FormData(); data.append("file", file);
    try { const response = await api.post("/school/student-files/import", data); await loadData(); setNotice({ type: response.data.skipped ? "warning" : "success", text: `Imported ${response.data.created} students; ${response.data.skipped} skipped.` }); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error, "Import failed.") }); }
    finally { setBusy(false); event.target.value = ""; }
  };

  const saveFormField = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.post("/school/admissions/form-fields", { ...newField, options: typeof newField.options === "string" ? newField.options.split(",").map((item) => item.trim()).filter(Boolean) : newField.options }); setNewField(emptyField); await loadData(); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const toggleFormField = async (field) => {
    setBusy(true);
    try { await api.put(`/school/admissions/form-fields/${field.id}`, { ...field, is_active: !field.is_active, options: field.options || [] }); await loadData(); }
    catch (error) { setNotice({ type: "error", text: errorMessage(error) }); }
    finally { setBusy(false); }
  };

  const onlineLink = `${window.location.origin}/school/admission/apply`;
  const copyOnlineLink = async () => {
    try { await navigator.clipboard.writeText(onlineLink); setNotice({ type: "success", text: "Online admission link copied." }); }
    catch { window.prompt("Copy the online admission link", onlineLink); }
  };

  return (
    <section className="school-students-page school-sis-page">
      <header className="school-page-header school-sis-header">
        <div className="school-page-heading"><img src={logo} alt="" /><div><p>{settings?.school_name || "Dar-e-Arqam"}</p><h1>Admissions & Students</h1><span>Applications, profiles, family records and complete lifecycle history</span></div></div>
        {canViewAdmissions && <div className="school-header-actions"><button className="school-secondary-button" type="button" onClick={copyOnlineLink}>Copy online form</button>{canManageAdmissions && <button className="school-primary-button" type="button" onClick={openApplication}>New application</button>}</div>}
      </header>

      {notice && <div className={`school-notice is-${notice.type}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} type="button" aria-label="Dismiss">×</button></div>}

      <div className="school-student-stats school-sis-stats">
        <article><span>Open applications</span><strong>{stats.applications}</strong><small>Admission pipeline</small></article>
        <article><span>Tests scheduled</span><strong>{stats.tests}</strong><small>Awaiting assessment</small></article>
        <article><span>Active students</span><strong>{stats.active}</strong><small>Current register</small></article>
        <article><span>Alumni</span><strong>{stats.alumni}</strong><small>Graduated records</small></article>
      </div>

      <nav className="school-sis-tabs" aria-label="Student information sections">
        {canViewAdmissions && <button className={tab === "admissions" ? "is-active" : ""} onClick={() => { setTab("admissions"); setStatusFilter("All"); }} type="button">Admissions <span>{admissions.applications.length}</span></button>}
        <button className={tab === "students" ? "is-active" : ""} onClick={() => { setTab("students"); setStatusFilter("All"); }} type="button">Student register <span>{students.length}</span></button>
      </nav>

      <div className="school-student-panel">
        <div className="school-student-toolbar school-sis-toolbar">
          <label className="school-search-field"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "admissions" ? "Search application, applicant or phone" : "Search student, admission, B-form or guardian"} /></label>
          <select value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)}><option value="All">All campuses</option>{foundation.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All</option>{(tab === "admissions" ? admissions.statuses : ["Active", "Inactive", "Withdrawn", "Graduated", "Alumni"]).map((status) => <option key={status}>{status}</option>)}</select>
          {tab === "admissions" ? canManageAdmissions && <button className="school-secondary-button" onClick={() => setFormBuilderOpen(true)} type="button">Configure form</button> : <div className="school-bulk-actions"><input ref={importInputRef} hidden type="file" accept=".csv,.xlsx" onChange={importFile} />{canManageStudents && <button onClick={() => importInputRef.current?.click()} disabled={busy} type="button">Import</button>}<button onClick={() => downloadFile("xlsx")} disabled={busy} type="button">Excel</button><button onClick={() => downloadFile("csv")} disabled={busy} type="button">CSV</button></div>}
        </div>

        {loading ? <div className="school-student-empty">Loading records...</div> : tab === "admissions" ? (
          filteredApplications.length ? <div className="school-student-table-wrap"><table className="school-student-table school-admission-table"><thead><tr><th>Applicant</th><th>Application</th><th>Applying for</th><th>Assessment</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredApplications.map((item) => <tr key={item.id}><td><strong>{item.student_name}</strong><small>{item.guardian_phone || item.father_name || "No contact"}</small></td><td><strong>{item.application_no}</strong><small>{item.source} · {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : ""}</small></td><td><strong>{item.class_name || "Class pending"}</strong><small>{item.campus_name}{item.section_name ? ` · ${item.section_name}` : ""}</small></td><td><strong>{item.test_score != null ? `${item.test_score} marks` : item.test_scheduled_at || "Not scheduled"}</strong><small>{item.interview_result || item.test_result || "No result"}</small></td><td><span className={`school-status-pill is-${statusClass(item.status)}`}>{item.status}</span></td><td>{canManageAdmissions ? <div className="school-row-actions"><button onClick={() => openWorkflow(item, "Under Review")} type="button">Review</button><button onClick={() => openWorkflow(item, "Test Scheduled")} type="button">Test</button><button onClick={() => openWorkflow(item, "Admitted")} disabled={item.status === "Admitted"} type="button">Admit</button></div> : <small>View only</small>}</td></tr>)}</tbody></table></div> : <div className="school-student-empty"><img src={logo} alt="" /><h2>No matching applications</h2><p>Create an office application or share the online form.</p>{canManageAdmissions && <button className="school-primary-button" onClick={openApplication} type="button">New application</button>}</div>
        ) : filteredStudents.length ? (
          <div className="school-student-table-wrap"><table className="school-student-table"><thead><tr><th>Student</th><th>Admission</th><th>Class</th><th>Family</th><th>Records</th><th>Status</th><th>Action</th></tr></thead><tbody>{filteredStudents.map((student) => <tr key={student.id}><td><button className="school-student-name" onClick={() => openProfile(student)} type="button">{student.photo_url ? <img src={getStaticUrl(student.photo_url)} alt="" /> : <span>{student.student_name.slice(0, 1).toUpperCase()}</span>}<strong>{student.student_name}<small>{student.father_name ? `S/O ${student.father_name}` : student.b_form_no || "Student profile"}</small></strong></button></td><td><strong>{student.admission_no}</strong><small>Roll {student.roll_number || "—"}</small></td><td><strong>{student.class_name}</strong><small>{student.section ? `Section ${student.section}` : student.campus_name}</small></td><td><strong>{student.guardian_name || "—"}</strong><small>{student.guardian_count} guardian(s) · {student.family_discount_percent || 0}% discount</small></td><td><strong>{student.document_count} documents</strong><small>{student.b_form_no || "No B-form"}</small></td><td><span className={`school-status-pill is-${statusClass(student.status)}`}>{student.status}</span></td><td><button className="school-table-open" onClick={() => openProfile(student)} type="button">Open profile</button></td></tr>)}</tbody></table></div>
        ) : <div className="school-student-empty"><img src={logo} alt="" /><h2>No matching students</h2><p>Admit an approved applicant or import your existing student register.</p></div>}
        <div className="school-table-footer">Showing {tab === "admissions" ? filteredApplications.length : filteredStudents.length} records</div>
      </div>

      {applicationOpen && <div className="school-modal-backdrop"><form className="school-student-modal school-wide-modal" onSubmit={saveApplication}><ModalHeader eyebrow="Office admission" title="New application" close={() => setApplicationOpen(false)} /><div className="school-student-form-grid">
        <SelectField label="Campus *" name="campus_id" value={applicationForm.campus_id} onChange={updateApplication} required options={foundation.campuses} />
        <SelectField label="Academic session *" name="academic_session_id" value={applicationForm.academic_session_id} onChange={updateApplication} required options={foundation.sessions.filter((item) => !item.campus_id || item.campus_id === Number(applicationForm.campus_id))} />
        <SelectField label="Class applying for" name="school_class_id" value={applicationForm.school_class_id} onChange={updateApplication} options={classesFor(applicationForm.campus_id, applicationForm.academic_session_id)} />
        <SelectField label="Preferred section" name="school_section_id" value={applicationForm.school_section_id} onChange={updateApplication} options={sectionsFor(applicationForm.school_class_id)} />
        {[["student_name", "Student name *"], ["date_of_birth", "Date of birth", "date"], ["b_form_no", "B-form number"], ["birth_certificate_no", "Birth certificate number"], ["father_name", "Father name"], ["mother_name", "Mother name"], ["guardian_name", "Guardian name"], ["guardian_phone", "Guardian phone", "tel"], ["guardian_email", "Guardian email", "email"], ["previous_school", "Previous school"], ["emergency_contact_name", "Emergency contact"], ["emergency_contact_phone", "Emergency phone", "tel"]].map(([name, label, type]) => <label key={name}><span>{label}</span><input name={name} type={type || "text"} value={applicationForm[name]} onChange={updateApplication} required={name === "student_name"} /></label>)}
        <label><span>Gender</span><select name="gender" value={applicationForm.gender} onChange={updateApplication}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></label>
        {["address", "medical_conditions", "allergies", "special_requirements"].map((name) => <label className="is-wide" key={name}><span>{name.replaceAll("_", " ")}</span><textarea name={name} value={applicationForm[name]} onChange={updateApplication} rows="2" /></label>)}
      </div><ModalActions cancel={() => setApplicationOpen(false)} busy={busy} label="Create application" /></form></div>}

      {workflowApplication && <div className="school-modal-backdrop"><form className="school-student-modal" onSubmit={saveWorkflow}><ModalHeader eyebrow={workflowApplication.application_no} title={workflowApplication.student_name} close={() => setWorkflowApplication(null)} /><div className="school-workflow-summary"><span className={`school-status-pill is-${statusClass(workflowApplication.status)}`}>{workflowApplication.status}</span><p>{workflowApplication.class_name || "Class pending"} · {workflowApplication.campus_name}</p></div><dl className="school-review-details"><div><dt>Guardian</dt><dd>{workflowApplication.guardian_name || workflowApplication.father_name || "—"}</dd></div><div><dt>Phone</dt><dd>{workflowApplication.guardian_phone || "—"}</dd></div><div><dt>Date of birth</dt><dd>{workflowApplication.date_of_birth || "—"}</dd></div><div><dt>B-form</dt><dd>{workflowApplication.b_form_no || "—"}</dd></div><div><dt>Previous school</dt><dd>{workflowApplication.previous_school || "—"}</dd></div><div><dt>Medical / special</dt><dd>{workflowApplication.medical_conditions || workflowApplication.special_requirements || "None recorded"}</dd></div></dl><div className="school-student-form-grid">
        <label><span>Move application to *</span><select value={workflowForm.status} onChange={(event) => setWorkflowForm((current) => ({ ...current, status: event.target.value }))}>{["Under Review", "Test Scheduled", "Test Completed", "Interview Scheduled", "Interview Completed", "Waitlisted", "Approved", "Rejected", "Admitted", "Withdrawn"].map((status) => <option key={status}>{status}</option>)}</select></label>
        <label><span>Test date and time</span><input type="datetime-local" value={workflowForm.test_scheduled_at} onChange={(event) => setWorkflowForm((current) => ({ ...current, test_scheduled_at: event.target.value }))} /></label>
        <label><span>Test venue</span><input value={workflowForm.test_venue} onChange={(event) => setWorkflowForm((current) => ({ ...current, test_venue: event.target.value }))} /></label>
        <label><span>Test score</span><input type="number" min="0" value={workflowForm.test_score} onChange={(event) => setWorkflowForm((current) => ({ ...current, test_score: event.target.value }))} /></label>
        <label><span>Test result</span><input value={workflowForm.test_result} onChange={(event) => setWorkflowForm((current) => ({ ...current, test_result: event.target.value }))} /></label>
        <label><span>Interview date and time</span><input type="datetime-local" value={workflowForm.interview_scheduled_at} onChange={(event) => setWorkflowForm((current) => ({ ...current, interview_scheduled_at: event.target.value }))} /></label>
        <label><span>Interviewer</span><input value={workflowForm.interviewer} onChange={(event) => setWorkflowForm((current) => ({ ...current, interviewer: event.target.value }))} /></label>
        <label><span>Interview result</span><input value={workflowForm.interview_result} onChange={(event) => setWorkflowForm((current) => ({ ...current, interview_result: event.target.value }))} /></label>
        <SelectField label="Assigned class" name="school_class_id" value={workflowForm.school_class_id} onChange={(event) => setWorkflowForm((current) => ({ ...current, school_class_id: event.target.value, school_section_id: "" }))} options={classesFor(workflowApplication.campus_id, workflowApplication.academic_session_id)} />
        <SelectField label="Assigned section" name="school_section_id" value={workflowForm.school_section_id} onChange={(event) => setWorkflowForm((current) => ({ ...current, school_section_id: event.target.value }))} options={sectionsFor(workflowForm.school_class_id)} />
        <label className="is-wide"><span>Review notes</span><textarea rows="3" value={workflowForm.review_notes} onChange={(event) => setWorkflowForm((current) => ({ ...current, review_notes: event.target.value }))} /></label>
        {workflowForm.status === "Rejected" && <label className="is-wide"><span>Rejection reason</span><textarea rows="2" value={workflowForm.rejection_reason} onChange={(event) => setWorkflowForm((current) => ({ ...current, rejection_reason: event.target.value }))} required /></label>}
      </div><ModalActions cancel={() => setWorkflowApplication(null)} busy={busy} label={workflowForm.status === "Admitted" ? "Admit and create student" : "Save workflow"} /></form></div>}

      {formBuilderOpen && <div className="school-modal-backdrop"><section className="school-student-modal school-wide-modal"><ModalHeader eyebrow="Online admissions" title="Configure application form" close={() => setFormBuilderOpen(false)} /><div className="school-form-builder"><div className="school-form-field-list">{admissions.form_fields.map((field) => <article key={field.id}><div><strong>{field.label}</strong><small>{field.field_key} · {field.input_type}{field.is_required ? " · Required" : ""}</small></div><button className={field.is_active ? "is-on" : ""} onClick={() => toggleFormField(field)} disabled={busy} type="button">{field.is_active ? "Enabled" : "Disabled"}</button></article>)}</div><form onSubmit={saveFormField}><h3>Add a custom field</h3><div className="school-student-form-grid"><label><span>Field key *</span><input value={newField.field_key} onChange={(event) => setNewField((current) => ({ ...current, field_key: event.target.value }))} placeholder="e.g. transport_required" required /></label><label><span>English label *</span><input value={newField.label} onChange={(event) => setNewField((current) => ({ ...current, label: event.target.value }))} required /></label><label><span>Urdu label</span><input dir="rtl" value={newField.label_ur} onChange={(event) => setNewField((current) => ({ ...current, label_ur: event.target.value }))} /></label><label><span>Input type</span><select value={newField.input_type} onChange={(event) => setNewField((current) => ({ ...current, input_type: event.target.value }))}><option>text</option><option>textarea</option><option>select</option><option>date</option><option>number</option><option>tel</option><option>email</option></select></label>{newField.input_type === "select" && <label className="is-wide"><span>Options separated by commas</span><input value={newField.options} onChange={(event) => setNewField((current) => ({ ...current, options: event.target.value }))} /></label>}<label className="school-checkbox"><input type="checkbox" checked={newField.is_required} onChange={(event) => setNewField((current) => ({ ...current, is_required: event.target.checked }))} /><span>Required</span></label></div><div className="school-modal-actions"><button className="school-primary-button" disabled={busy} type="submit">Add field</button></div></form></div></section></div>}

      {profile && <div className="school-modal-backdrop school-profile-backdrop"><article className="school-profile-modal school-sis-profile"><ModalHeader eyebrow={profile.student.admission_no} title={profile.student.student_name} close={() => setProfile(null)} /><div className="school-profile-hero">{profile.student.photo_url ? <img src={getStaticUrl(profile.student.photo_url)} alt="" /> : <span>{profile.student.student_name.slice(0, 1)}</span>}<div><strong>{profile.student.class_name}{profile.student.section ? ` · ${profile.student.section}` : ""}</strong><small>{profile.student.campus_name} · Roll {profile.student.roll_number || "—"}</small></div><span className={`school-status-pill is-${statusClass(profile.student.status)}`}>{profile.student.status}</span></div><nav className="school-profile-tabs">{[["overview", "Overview"], ["family", "Family"], ["medical", "Medical"], ["documents", "Documents"], ["history", "History"], ["cards", "ID & certificates"]].map(([key, label]) => <button className={profileTab === key ? "is-active" : ""} onClick={() => setProfileTab(key)} type="button" key={key}>{label}</button>)}</nav>{profileLoading ? <div className="school-profile-loading">Refreshing profile...</div> : <div className="school-profile-content">
        {profileTab === "overview" && <form onSubmit={saveProfile}><div className="school-student-form-grid school-profile-form">{[["student_name", "Student name"], ["father_name", "Father name"], ["mother_name", "Mother name"], ["guardian_name", "Primary guardian"], ["guardian_phone", "Guardian phone", "tel"], ["date_of_birth", "Date of birth", "date"], ["b_form_no", "B-form number"], ["birth_certificate_no", "Birth certificate number"], ["previous_school", "Previous school"], ["family_discount_percent", "Family discount %", "number"]].map(([name, label, type]) => <label key={name}><span>{label}</span><input name={name} type={type || "text"} value={profileForm[name] ?? ""} onChange={(event) => setProfileForm((current) => ({ ...current, [name]: event.target.value }))} /></label>)}<label><span>Gender</span><select value={profileForm.gender || ""} onChange={(event) => setProfileForm((current) => ({ ...current, gender: event.target.value }))}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></label><label><span>Preferred language</span><select value={profileForm.preferred_language || "en"} onChange={(event) => setProfileForm((current) => ({ ...current, preferred_language: event.target.value }))}><option value="en">English</option><option value="ur">Urdu</option></select></label><label className="is-wide"><span>Address</span><textarea rows="2" value={profileForm.address || ""} onChange={(event) => setProfileForm((current) => ({ ...current, address: event.target.value }))} /></label><label className="is-wide"><span>Notes</span><textarea rows="2" value={profileForm.notes || ""} onChange={(event) => setProfileForm((current) => ({ ...current, notes: event.target.value }))} /></label></div><div className="school-modal-actions"><button className="school-secondary-button" onClick={openLifecycle} type="button">Promotion / transfer</button><button className="school-primary-button" disabled={busy} type="submit">Save profile</button></div></form>}

        {profileTab === "family" && <div className="school-profile-sections"><ProfileSection title="Parents and guardians" count={profile.guardians.length}><div className="school-record-cards">{profile.guardians.map((item) => <article key={item.id}><div><strong>{item.full_name}{item.is_primary ? " · Primary" : ""}</strong><small>{item.relationship_type} · {item.phone || "No phone"}</small><small>{item.cnic || item.email || "No CNIC/email"}</small></div><button onClick={() => removeItem(`/school/student-information/${profile.student.id}/guardians/${item.id}`, "family")} type="button">Remove</button></article>)}</div><form className="school-inline-form" onSubmit={addGuardian}><input placeholder="Full name" value={guardianForm.full_name} onChange={(event) => setGuardianForm((current) => ({ ...current, full_name: event.target.value }))} required /><select value={guardianForm.relationship_type} onChange={(event) => setGuardianForm((current) => ({ ...current, relationship_type: event.target.value }))}><option>Father</option><option>Mother</option><option>Guardian</option><option>Grandparent</option><option>Other</option></select><input placeholder="Phone" value={guardianForm.phone} onChange={(event) => setGuardianForm((current) => ({ ...current, phone: event.target.value }))} /><input placeholder="CNIC" value={guardianForm.cnic} onChange={(event) => setGuardianForm((current) => ({ ...current, cnic: event.target.value }))} /><label className="school-checkbox"><input type="checkbox" checked={guardianForm.is_primary} onChange={(event) => setGuardianForm((current) => ({ ...current, is_primary: event.target.checked }))} /><span>Primary</span></label><button disabled={busy}>Add guardian</button></form></ProfileSection>
        <ProfileSection title="Emergency contacts" count={profile.emergency_contacts.length}><div className="school-record-cards">{profile.emergency_contacts.map((item) => <article key={item.id}><div><strong>{item.full_name}</strong><small>{item.relationship_type || "Emergency contact"} · {item.phone}</small></div><button onClick={() => removeItem(`/school/student-information/${profile.student.id}/emergency-contacts/${item.id}`, "family")} type="button">Remove</button></article>)}</div><form className="school-inline-form" onSubmit={addEmergency}><input placeholder="Full name" value={emergencyForm.full_name} onChange={(event) => setEmergencyForm((current) => ({ ...current, full_name: event.target.value }))} required /><input placeholder="Relationship" value={emergencyForm.relationship_type} onChange={(event) => setEmergencyForm((current) => ({ ...current, relationship_type: event.target.value }))} /><input placeholder="Phone" value={emergencyForm.phone} onChange={(event) => setEmergencyForm((current) => ({ ...current, phone: event.target.value }))} required /><button disabled={busy}>Add contact</button></form></ProfileSection>
        <ProfileSection title="Siblings and family discount" count={profile.siblings.length}><div className="school-record-cards">{profile.siblings.map((item) => <article key={item.link_id}><div><strong>{item.student_name}</strong><small>{item.class_name} · {item.admission_no} · {item.family_discount_percent || 0}% discount</small></div><button onClick={() => removeItem(`/school/student-information/${profile.student.id}/siblings/${item.link_id}`, "family")} type="button">Unlink</button></article>)}</div><form className="school-inline-form" onSubmit={linkSibling}><select value={siblingForm.sibling_student_id} onChange={(event) => setSiblingForm((current) => ({ ...current, sibling_student_id: event.target.value }))} required><option value="">Select student</option>{students.filter((item) => item.id !== profile.student.id && !profile.siblings.some((sibling) => sibling.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.student_name} · {item.admission_no}</option>)}</select><input type="number" min="0" max="100" placeholder="Discount %" value={siblingForm.family_discount_percent} onChange={(event) => setSiblingForm((current) => ({ ...current, family_discount_percent: event.target.value }))} /><button disabled={busy}>Link sibling</button></form></ProfileSection></div>}

        {profileTab === "medical" && <form onSubmit={saveMedical}><div className="school-student-form-grid school-profile-form"><label><span>Blood group</span><select value={medicalForm.blood_group || ""} onChange={(event) => setMedicalForm((current) => ({ ...current, blood_group: event.target.value }))}><option value="">Unknown</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((item) => <option key={item}>{item}</option>)}</select></label>{[["doctor_name", "Doctor name"], ["doctor_phone", "Doctor phone"]].map(([name, label]) => <label key={name}><span>{label}</span><input value={medicalForm[name] || ""} onChange={(event) => setMedicalForm((current) => ({ ...current, [name]: event.target.value }))} /></label>)}{[["medical_conditions", "Medical conditions"], ["allergies", "Allergies"], ["medications", "Medications"], ["disabilities", "Disabilities"], ["special_requirements", "Special requirements"], ["health_notes", "Health notes"]].map(([name, label]) => <label className="is-wide" key={name}><span>{label}</span><textarea rows="2" value={medicalForm[name] || ""} onChange={(event) => setMedicalForm((current) => ({ ...current, [name]: event.target.value }))} /></label>)}</div><div className="school-modal-actions"><button className="school-primary-button" disabled={busy}>Save medical profile</button></div></form>}

        {profileTab === "documents" && <div className="school-profile-sections"><ProfileSection title="Document vault" count={profile.documents.length}><div className="school-document-grid">{profile.documents.map((item) => <article key={item.id}><span>{item.category}</span><strong>{item.title}</strong><small>{item.original_filename} · {Math.max(1, Math.round(item.file_size / 1024))} KB</small><div><a href={getStaticUrl(item.file_url)} target="_blank" rel="noreferrer">Open</a><button onClick={() => removeItem(`/school/student-information/${profile.student.id}/documents/${item.id}`, "documents")} type="button">Remove</button></div></article>)}</div><form className="school-document-upload" onSubmit={uploadDocument}><select name="category" required><option>Photograph</option><option>Birth Certificate</option><option>B-Form</option><option>Previous School Record</option><option>Medical Record</option><option>Other</option></select><input name="title" placeholder="Document title" /><input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp" required /><button disabled={busy}>Upload document</button></form></ProfileSection></div>}

        {profileTab === "history" && <div className="school-profile-sections"><div className="school-history-header"><div><h3>Permanent student history</h3><p>Previous records are never deleted when the student moves.</p></div><button className="school-primary-button" onClick={openLifecycle} type="button">Add lifecycle action</button></div><div className="school-timeline">{profile.history.map((item) => <article key={item.id}><span></span><div><strong>{item.event_type}</strong><small>{item.event_date}</small><p>{item.reason || item.notes || `${item.from_class_name || ""} → ${item.to_class_name || ""}`}</p></div></article>)}</div><h3>Enrollment history</h3><div className="school-enrollment-list">{profile.enrollments.map((item) => <article key={item.id}><strong>{item.class_name}{item.section_name ? ` · ${item.section_name}` : ""}</strong><span>{item.status}</span><small>{item.start_date} {item.end_date ? `to ${item.end_date}` : "to present"} · Roll {item.roll_number || "—"}</small></article>)}</div></div>}

        {profileTab === "cards" && <div className="school-profile-sections"><ProfileSection title="Student ID card"><div className="school-id-preview"><div className="school-id-brand"><img src={logo} alt="" /><span>{settings?.school_name || "Dar-e-Arqam"}<small>STUDENT IDENTITY CARD</small></span></div><div className="school-id-body">{profile.student.photo_url ? <img src={getStaticUrl(profile.student.photo_url)} alt="" /> : <b>{profile.student.student_name.slice(0, 1)}</b>}<div><strong>{profile.student.student_name}</strong><span>{profile.student.admission_no}</span><span>{profile.student.class_name} {profile.student.section || ""} · Roll {profile.student.roll_number || "—"}</span></div></div></div><button className="school-primary-button" onClick={printIdCard} type="button">Print ID card</button></ProfileSection><ProfileSection title="Certificates" count={profile.certificates.length}><form className="school-certificate-form" onSubmit={issueCertificate}><select value={certificateForm.certificate_type} onChange={(event) => setCertificateForm((current) => ({ ...current, certificate_type: event.target.value }))}><option>Transfer Certificate</option><option>Character Certificate</option></select><input type="date" value={certificateForm.issue_date} onChange={(event) => setCertificateForm((current) => ({ ...current, issue_date: event.target.value }))} /><input placeholder="Purpose" value={certificateForm.purpose} onChange={(event) => setCertificateForm((current) => ({ ...current, purpose: event.target.value }))} /><input placeholder="Conduct" value={certificateForm.conduct} onChange={(event) => setCertificateForm((current) => ({ ...current, conduct: event.target.value }))} /><button disabled={busy}>Generate and print</button></form><div className="school-record-cards">{profile.certificates.map((item) => <article key={item.id}><div><strong>{item.certificate_type}</strong><small>{item.certificate_no} · {item.issue_date}</small></div><button onClick={() => printCertificate(item)} type="button">Print</button></article>)}</div></ProfileSection></div>}
      </div>}</article></div>}

      {lifecycleOpen && profile && <div className="school-modal-backdrop"><form className="school-student-modal" onSubmit={saveLifecycle}><ModalHeader eyebrow="Permanent history" title="Promotion, transfer or exit" close={() => setLifecycleOpen(false)} /><div className="school-student-form-grid"><label><span>Action *</span><select value={lifecycleForm.event_type} onChange={(event) => setLifecycleForm((current) => ({ ...current, event_type: event.target.value }))}>{["Promotion", "Campus Transfer", "Section Transfer", "Class Transfer", "Withdrawal", "Graduation", "Reactivation"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Effective date *</span><input type="date" value={lifecycleForm.event_date} onChange={(event) => setLifecycleForm((current) => ({ ...current, event_date: event.target.value }))} required /></label>{!["Withdrawal", "Graduation"].includes(lifecycleForm.event_type) && <><SelectField label="Destination campus" name="campus_id" value={lifecycleForm.campus_id} onChange={(event) => setLifecycleForm((current) => ({ ...current, campus_id: event.target.value, school_class_id: "", school_section_id: "" }))} options={foundation.campuses} required /><SelectField label="Academic session" name="academic_session_id" value={lifecycleForm.academic_session_id} onChange={(event) => setLifecycleForm((current) => ({ ...current, academic_session_id: event.target.value }))} options={foundation.sessions.filter((item) => !item.campus_id || item.campus_id === Number(lifecycleForm.campus_id))} required /><SelectField label="Destination class" name="school_class_id" value={lifecycleForm.school_class_id} onChange={(event) => setLifecycleForm((current) => ({ ...current, school_class_id: event.target.value, school_section_id: "" }))} options={classesFor(lifecycleForm.campus_id, lifecycleForm.academic_session_id)} required /><SelectField label="Destination section" name="school_section_id" value={lifecycleForm.school_section_id} onChange={(event) => setLifecycleForm((current) => ({ ...current, school_section_id: event.target.value }))} options={sectionsFor(lifecycleForm.school_class_id)} /></>}<label className="is-wide"><span>Reason</span><input value={lifecycleForm.reason} onChange={(event) => setLifecycleForm((current) => ({ ...current, reason: event.target.value }))} /></label><label className="is-wide"><span>Notes</span><textarea rows="3" value={lifecycleForm.notes} onChange={(event) => setLifecycleForm((current) => ({ ...current, notes: event.target.value }))} /></label></div><ModalActions cancel={() => setLifecycleOpen(false)} busy={busy} label={`Record ${lifecycleForm.event_type}`} /></form></div>}
    </section>
  );
}

function ModalHeader({ eyebrow, title, close }) { return <div className="school-modal-header"><div><p>{eyebrow}</p><h2>{title}</h2></div><button onClick={close} type="button" aria-label="Close">×</button></div>; }
function ModalActions({ cancel, busy, label }) { return <div className="school-modal-actions"><button className="school-secondary-button" onClick={cancel} type="button">Cancel</button><button className="school-primary-button" disabled={busy} type="submit">{busy ? "Saving..." : label}</button></div>; }
function SelectField({ label, name, value, onChange, options, required = false }) { return <label><span>{label}</span><select name={name} value={value ?? ""} onChange={onChange} required={required}><option value="">Select</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>; }
function ProfileSection({ title, count, children }) { return <section className="school-profile-section"><header><h3>{title}</h3>{count != null && <span>{count}</span>}</header>{children}</section>; }

export default SchoolStudents;
