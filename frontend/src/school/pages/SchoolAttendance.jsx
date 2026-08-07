import { useCallback, useEffect, useRef, useState } from "react";
import api, { getStaticUrl } from "../../api/api";
import defaultSchoolLogo from "../../assets/dar-e-arqam-logo.svg";
import "./SchoolAttendance.css";

const isoToday = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const statusOptions = ["Present", "Absent", "Late", "Leave", "Excused", "Half Day"];
const emptyRegister = () => ({ campus_id: "", academic_session_id: "", school_class_id: "", school_section_id: "", subject_id: "", attendance_date: isoToday(), attendance_type: "Daily", period_label: "", notes: "" });
const emptyLeave = () => ({ campus_id: "", applicant_type: "Student", student_id: "", staff_user_id: "", leave_type: "Casual", start_date: isoToday(), end_date: isoToday(), reason: "" });
const emptyCorrection = () => ({ target_type: "Student", student_attendance_id: null, staff_attendance_id: null, requested_status: "Present", requested_check_in_time: "", requested_check_out_time: "", reason: "" });
const getError = (error, fallback = "The attendance request could not be completed.") => error?.response?.data?.detail || error?.message || fallback;
const statusClass = (value) => String(value || "unknown").toLowerCase().replaceAll(" ", "-");

function SchoolAttendance({ settings, permissions }) {
  const [tab, setTab] = useState("dashboard");
  const [date, setDate] = useState(isoToday());
  const [campusId, setCampusId] = useState("");
  const [snapshot, setSnapshot] = useState({ stats: {}, sessions: [], staff_records: [], leaves: [], corrections: [], alerts: [], integration_status: {}, policy: {} });
  const [foundation, setFoundation] = useState({ campuses: [], sessions: [], classes: [], sections: [], subjects: [], users: [] });
  const [students, setStudents] = useState([]);
  const [auditHistory, setAuditHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [registerForm, setRegisterForm] = useState(emptyRegister());
  const [register, setRegister] = useState(null);
  const [registerRecords, setRegisterRecords] = useState([]);
  const [staffRecords, setStaffRecords] = useState([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [leaveForm, setLeaveForm] = useState(emptyLeave());
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionForm, setCorrectionForm] = useState(emptyCorrection());
  const [reportMonth, setReportMonth] = useState(currentMonth());
  const [reportClassId, setReportClassId] = useState("");
  const [reportType, setReportType] = useState("Daily");
  const [report, setReport] = useState({ student_summary: [], staff_summary: [], sessions_count: 0, threshold: 75 });
  const [policyForm, setPolicyForm] = useState({ low_attendance_threshold: 75, late_grace_minutes: 10, school_start_time: "08:00", school_end_time: "14:00", automatic_parent_notifications: true, notification_channels: ["In-app"] });
  const leaveFileRef = useRef(null);

  const canTake = permissions ? permissions.includes("take_attendance") : true;
  const canStaff = permissions ? permissions.includes("manage_staff_attendance") : true;
  const canApprove = permissions ? permissions.includes("approve_attendance") : true;
  const canPolicy = permissions ? permissions.includes("manage_attendance_policy") : true;
  const canSubmitLeave = permissions ? permissions.includes("submit_leave") : true;
  const logo = settings?.logo_data_url || defaultSchoolLogo;

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const params = { attendance_date: date, ...(campusId ? { campus_id: Number(campusId) } : {}) };
      const [attendanceResponse, foundationResponse, studentResponse, auditResponse] = await Promise.all([
        api.get("/school/attendance", { params }),
        api.get("/school/foundation"),
        api.get("/school/student-information"),
        api.get("/school/attendance/audit-history", { params: campusId ? { campus_id: Number(campusId) } : {} }),
      ]);
      const attendance = attendanceResponse.data || {};
      const school = foundationResponse.data || {};
      setSnapshot(attendance);
      setFoundation({ campuses: school.campuses || [], sessions: school.sessions || [], classes: school.classes || [], sections: school.sections || [], subjects: school.subjects || [], users: school.users || [] });
      setStudents(studentResponse.data || []);
      setAuditHistory(auditResponse.data || []);
      const effectiveCampusId = campusId || String(school.campuses?.[0]?.id || "");
      const defaultSessionId = school.sessions?.find((item) => item.is_current && (!item.campus_id || item.campus_id === Number(effectiveCampusId)))?.id || school.sessions?.[0]?.id || "";
      setRegisterForm((current) => ({
        ...current,
        campus_id: effectiveCampusId ? Number(effectiveCampusId) : "",
        academic_session_id: current.academic_session_id || defaultSessionId,
        attendance_date: date,
      }));
      setLeaveForm((current) => ({ ...current, campus_id: effectiveCampusId ? Number(effectiveCampusId) : "" }));
      setPolicyForm({
        campus_id: attendance.policy?.campus_id || null,
        low_attendance_threshold: attendance.policy?.low_attendance_threshold ?? 75,
        late_grace_minutes: attendance.policy?.late_grace_minutes ?? 10,
        school_start_time: attendance.policy?.school_start_time || "08:00",
        school_end_time: attendance.policy?.school_end_time || "14:00",
        automatic_parent_notifications: attendance.policy?.automatic_parent_notifications !== false,
        notification_channels: attendance.policy?.notification_channels || ["In-app"],
      });
      if (!campusId && school.campuses?.[0]?.id) setCampusId(String(school.campuses[0].id));
    } catch (error) {
      setNotice({ type: "error", text: getError(error, "Attendance could not be loaded.") });
    } finally { setLoading(false); }
  }, [campusId, date]);

  useEffect(() => { const timer = window.setTimeout(loadBase, 0); return () => window.clearTimeout(timer); }, [loadBase]);

  const campusClasses = foundation.classes.filter((item) => item.campus_id === Number(campusId));
  const registerClasses = campusClasses.filter((item) => !registerForm.academic_session_id || item.academic_session_id === Number(registerForm.academic_session_id));
  const registerSections = foundation.sections.filter((item) => item.school_class_id === Number(registerForm.school_class_id));
  const reportClasses = campusClasses;
  const campusStudents = students.filter((item) => item.campus_id === Number(campusId));
  const campusStaff = foundation.users.filter((item) => ["School owner", "Principal", "Campus administrator", "Admission officer", "Accountant", "Teacher", "Class teacher", "Receptionist", "Librarian", "Transport manager"].includes(item.school_role) && (!item.campus_id || item.campus_id === Number(campusId)));

  const openRegister = async (event) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const response = await api.post("/school/attendance/sessions", {
        ...registerForm,
        campus_id: Number(registerForm.campus_id), academic_session_id: Number(registerForm.academic_session_id),
        school_class_id: Number(registerForm.school_class_id), school_section_id: registerForm.school_section_id ? Number(registerForm.school_section_id) : null,
        subject_id: registerForm.attendance_type === "Subject" && registerForm.subject_id ? Number(registerForm.subject_id) : null,
      });
      setRegister(response.data); setRegisterRecords(response.data.records || []);
      setNotice({ type: "success", text: response.data.status === "Draft" ? "Attendance register is ready." : `Opened ${response.data.status.toLowerCase()} register.` });
    } catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const updateStudentMark = (studentId, key, value) => setRegisterRecords((current) => current.map((item) => item.student_id === studentId ? { ...item, [key]: value } : item));
  const markAll = (status) => setRegisterRecords((current) => current.map((item) => ({ ...item, status, absence_reason: status === "Present" ? "" : item.absence_reason })));

  const saveRegister = async (status) => {
    if (!register) return; setBusy(true);
    try {
      const response = await api.put(`/school/attendance/sessions/${register.id}/records`, {
        status,
        records: registerRecords.map((item) => ({
          student_id: item.student_id, status: item.status, check_in_time: item.check_in_time || null,
          check_out_time: item.check_out_time || null, late_minutes: item.late_minutes == null ? null : Number(item.late_minutes),
          early_departure_minutes: item.early_departure_minutes == null ? null : Number(item.early_departure_minutes),
          absence_reason: item.absence_reason || null, notes: item.notes || null,
          capture_method: item.capture_method || "Manual", external_reference: item.external_reference || null,
        })),
      });
      setRegister(response.data); setRegisterRecords(response.data.records || []); await loadBase();
      setNotice({ type: "success", text: status === "Draft" ? "Draft attendance saved." : "Attendance submitted and parent absence alerts created automatically." });
    } catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const uploadAbsenceDocument = async (record, file) => {
    if (!record.id || !file) return; const data = new FormData(); data.append("file", file); setBusy(true);
    try { await api.post(`/school/attendance/student-records/${record.id}/document`, data); setNotice({ type: "success", text: `Supporting document attached for ${record.student_name}.` }); }
    catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const loadStaffDay = async () => {
    if (!campusId) return; setBusy(true);
    try { const response = await api.get("/school/attendance/staff-day", { params: { campus_id: Number(campusId), attendance_date: date } }); setStaffRecords(response.data.records || []); setStaffLoaded(true); }
    catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const updateStaffMark = (userId, key, value) => setStaffRecords((current) => current.map((item) => item.staff_user_id === userId ? { ...item, [key]: value } : item));
  const saveStaffDay = async () => {
    setBusy(true);
    try {
      const response = await api.put("/school/attendance/staff-day", { campus_id: Number(campusId), attendance_date: date, records: staffRecords.map((item) => ({ staff_user_id: item.staff_user_id, status: item.status, check_in_time: item.check_in_time || null, check_out_time: item.check_out_time || null, late_minutes: item.late_minutes == null ? null : Number(item.late_minutes), early_departure_minutes: item.early_departure_minutes == null ? null : Number(item.early_departure_minutes), absence_reason: item.absence_reason || null, notes: item.notes || null, capture_method: item.capture_method || "Manual", external_reference: item.external_reference || null })) });
      setStaffRecords(response.data.records || []); await loadBase(); setNotice({ type: "success", text: "Staff attendance saved with late and early-departure calculations." });
    } catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const createLeave = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const response = await api.post("/school/attendance/leaves", { ...leaveForm, campus_id: Number(leaveForm.campus_id), student_id: leaveForm.applicant_type === "Student" ? Number(leaveForm.student_id) : null, staff_user_id: leaveForm.applicant_type === "Staff" ? Number(leaveForm.staff_user_id) : null });
      const file = leaveFileRef.current?.files?.[0];
      if (file) { const data = new FormData(); data.append("file", file); await api.post(`/school/attendance/leaves/${response.data.id}/document`, data); }
      setLeaveForm({ ...emptyLeave(), campus_id: Number(campusId) }); if (leaveFileRef.current) leaveFileRef.current.value = "";
      await loadBase(); setNotice({ type: "success", text: "Leave application submitted for approval." });
    } catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const reviewLeave = async (leaveId, status) => {
    setBusy(true);
    try { await api.post(`/school/attendance/leaves/${leaveId}/review`, { status, review_notes: "" }); await loadBase(); setNotice({ type: "success", text: `Leave ${status.toLowerCase()}.` }); }
    catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const openCorrection = (record, type) => {
    setCorrectionForm({ ...emptyCorrection(), target_type: type, student_attendance_id: type === "Student" ? record.id : null, staff_attendance_id: type === "Staff" ? record.id : null, requested_status: record.status, requested_check_in_time: record.check_in_time || "", requested_check_out_time: record.check_out_time || "" });
    setCorrectionOpen(true);
  };

  const submitCorrection = async (event) => {
    event.preventDefault(); setBusy(true);
    try { await api.post("/school/attendance/corrections", correctionForm); setCorrectionOpen(false); await loadBase(); setNotice({ type: "success", text: "Attendance correction submitted for approval." }); }
    catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const reviewCorrection = async (id, status) => {
    setBusy(true);
    try { await api.post(`/school/attendance/corrections/${id}/review`, { status, review_notes: "" }); await loadBase(); setNotice({ type: "success", text: `Correction ${status.toLowerCase()} and audit history updated.` }); }
    catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const loadReport = useCallback(async () => {
    try {
      const response = await api.get("/school/attendance/monthly-summary", { params: { month: reportMonth, ...(campusId ? { campus_id: Number(campusId) } : {}), ...(reportClassId ? { school_class_id: Number(reportClassId) } : {}), attendance_type: reportType } });
      setReport(response.data || { student_summary: [], staff_summary: [] });
    } catch (error) { setNotice({ type: "error", text: getError(error, "Monthly report could not be loaded.") }); }
  }, [campusId, reportClassId, reportMonth, reportType]);

  useEffect(() => { if (tab !== "reports") return; const timer = window.setTimeout(loadReport, 0); return () => window.clearTimeout(timer); }, [loadReport, tab]);

  const savePolicy = async (event) => {
    event.preventDefault(); setBusy(true);
    try { const response = await api.put("/school/attendance/policy", { ...policyForm, campus_id: campusId ? Number(campusId) : null, low_attendance_threshold: Number(policyForm.low_attendance_threshold), late_grace_minutes: Number(policyForm.late_grace_minutes) }); setPolicyForm(response.data); await loadBase(); setNotice({ type: "success", text: "Attendance policy updated." }); }
    catch (error) { setNotice({ type: "error", text: getError(error) }); }
    finally { setBusy(false); }
  };

  const sessionLabel = (item) => `${item.class_name}${item.section_name ? ` · ${item.section_name}` : ""}${item.subject_name ? ` · ${item.subject_name}` : ""}`;
  const lowStudents = report.student_summary?.filter((item) => item.low_attendance) || [];

  return (
    <section className="school-attendance-page">
      <header className="school-page-header attendance-header"><div className="school-page-heading"><img src={logo} alt="" /><div><p>{settings?.school_name || "Dar-e-Arqam"}</p><h1>Attendance</h1><span>Daily, subject, staff, leave and correction management</span></div></div><div className="attendance-date-controls"><label><span>Campus</span><select value={campusId} onChange={(event) => { setCampusId(event.target.value); setRegister(null); setStaffLoaded(false); }}><option value="">All accessible campuses</option>{foundation.campuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Working date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setRegister(null); setStaffLoaded(false); }} /></label></div></header>
      {notice && <div className={`school-notice is-${notice.type}`}><span>{notice.text}</span><button onClick={() => setNotice(null)} type="button">×</button></div>}
      <div className="attendance-kpis"><article><span>Present students</span><strong>{snapshot.stats?.present || 0}</strong><small>Across today’s registers</small></article><article className="is-danger"><span>Absent</span><strong>{snapshot.stats?.absent || 0}</strong><small>Alerts generated on submit</small></article><article className="is-warning"><span>Late arrivals</span><strong>{snapshot.stats?.late || 0}</strong><small>Grace: {snapshot.policy?.late_grace_minutes || 0} minutes</small></article><article><span>Pending approvals</span><strong>{(snapshot.stats?.pending_leave || 0) + (snapshot.stats?.pending_corrections || 0)}</strong><small>Leave and corrections</small></article></div>
      <nav className="attendance-tabs">{[["dashboard", "Overview"], ["register", "Student register"], ["staff", "Staff"], ["leave", "Leave"], ["corrections", "Corrections"], ["reports", "Monthly reports"]].map(([key, label]) => <button key={key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)} type="button">{label}{key === "leave" && snapshot.stats?.pending_leave ? <span>{snapshot.stats.pending_leave}</span> : null}{key === "corrections" && snapshot.stats?.pending_corrections ? <span>{snapshot.stats.pending_corrections}</span> : null}</button>)}</nav>

      {loading ? <div className="attendance-loading">Loading attendance workspace...</div> : <div className="attendance-workspace">
        {tab === "dashboard" && <div className="attendance-overview-grid"><section className="attendance-panel is-wide"><PanelTitle title="Today’s class registers" subtitle={`${date} · Daily and subject attendance`} />{snapshot.sessions?.length ? <div className="attendance-session-grid">{snapshot.sessions.map((item) => <button key={item.id} onClick={async () => { const response = await api.get(`/school/attendance/sessions/${item.id}`); setRegister(response.data); setRegisterRecords(response.data.records || []); setTab("register"); }} type="button"><span className={`attendance-type is-${item.attendance_type.toLowerCase()}`}>{item.attendance_type}</span><strong>{sessionLabel(item)}</strong><small>{item.record_count} students · {item.status}</small><div><b>{item.counts?.Present || 0} present</b><b className="is-absent">{item.counts?.Absent || 0} absent</b></div></button>)}</div> : <Empty title="No attendance registers today" text="Open the student register tab to take daily or subject attendance." />}</section><section className="attendance-panel"><PanelTitle title="Parent absence alerts" subtitle="Automatic notification delivery" />{snapshot.alerts?.length ? <div className="attendance-alert-list">{snapshot.alerts.slice(0, 8).map((item) => <article key={item.id}><span className={`is-${item.status.toLowerCase()}`}></span><div><strong>{item.recipient_name || item.recipient_phone}</strong><small>{item.channel} · {item.status}</small><p>{item.message}</p></div></article>)}</div> : <Empty title="No absence alerts" text="Alerts appear automatically after an absent register is submitted." compact />}</section><section className="attendance-panel"><PanelTitle title="Device integration" subtitle="Prepared for later connection" /><div className="attendance-device-list">{Object.entries(snapshot.integration_status || {}).map(([name, status]) => <article key={name}><b>{name}</b><span>{status}</span></article>)}</div><p className="attendance-panel-note">All records already store capture method and external reference fields.</p></section></div>}

        {tab === "register" && <div className="attendance-register-layout"><section className="attendance-panel"><PanelTitle title="Open attendance register" subtitle="Daily or subject-wise" /><form className="attendance-register-form" onSubmit={openRegister}><Select label="Campus" value={registerForm.campus_id} onChange={(value) => setRegisterForm((current) => ({ ...current, campus_id: value, school_class_id: "", school_section_id: "" }))} options={foundation.campuses} required /><Select label="Academic session" value={registerForm.academic_session_id} onChange={(value) => setRegisterForm((current) => ({ ...current, academic_session_id: value, school_class_id: "", school_section_id: "" }))} options={foundation.sessions.filter((item) => !item.campus_id || item.campus_id === Number(registerForm.campus_id))} required /><Select label="Class" value={registerForm.school_class_id} onChange={(value) => setRegisterForm((current) => ({ ...current, school_class_id: value, school_section_id: "" }))} options={registerClasses} required /><Select label="Section" value={registerForm.school_section_id} onChange={(value) => setRegisterForm((current) => ({ ...current, school_section_id: value }))} options={registerSections} /><label><span>Type</span><select value={registerForm.attendance_type} onChange={(event) => setRegisterForm((current) => ({ ...current, attendance_type: event.target.value }))}><option>Daily</option><option>Subject</option></select></label>{registerForm.attendance_type === "Subject" && <><Select label="Subject" value={registerForm.subject_id} onChange={(value) => setRegisterForm((current) => ({ ...current, subject_id: value }))} options={foundation.subjects.filter((item) => !item.campus_id || item.campus_id === Number(registerForm.campus_id))} required /><label><span>Period</span><input value={registerForm.period_label} onChange={(event) => setRegisterForm((current) => ({ ...current, period_label: event.target.value }))} placeholder="e.g. Period 2" /></label></>}<label><span>Date</span><input type="date" value={registerForm.attendance_date} onChange={(event) => setRegisterForm((current) => ({ ...current, attendance_date: event.target.value }))} required /></label><button disabled={busy || !canTake} type="submit">{busy ? "Opening..." : "Open register"}</button></form></section>{register && <section className="attendance-panel attendance-register-panel"><div className="attendance-register-title"><div><span className={`attendance-type is-${register.attendance_type.toLowerCase()}`}>{register.attendance_type}</span><h2>{sessionLabel(register)}</h2><p>{register.attendance_date} · {register.status} · {registerRecords.length} students</p></div>{register.status === "Draft" && canTake && <div><button onClick={() => markAll("Present")} type="button">Mark all present</button><button onClick={() => markAll("Absent")} type="button">Mark all absent</button></div>}</div>{registerRecords.length ? <div className="attendance-table-wrap"><table className="attendance-table"><thead><tr><th>Student</th><th>Status</th><th>Arrival</th><th>Departure</th><th>Late / early</th><th>Reason and evidence</th><th>Correction</th></tr></thead><tbody>{registerRecords.map((item) => <tr key={item.student_id}><td><div className="attendance-person">{item.photo_url ? <img src={getStaticUrl(item.photo_url)} alt="" /> : <span>{item.student_name?.slice(0, 1)}</span>}<div><strong>{item.student_name}</strong><small>{item.roll_number ? `Roll ${item.roll_number}` : item.admission_no}</small></div></div></td><td><select className={`attendance-status-select is-${statusClass(item.status)}`} value={item.status} onChange={(event) => updateStudentMark(item.student_id, "status", event.target.value)} disabled={register.status !== "Draft" || !canTake}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></td><td><input type="time" value={item.check_in_time || ""} onChange={(event) => updateStudentMark(item.student_id, "check_in_time", event.target.value)} disabled={register.status !== "Draft" || !canTake} /></td><td><input type="time" value={item.check_out_time || ""} onChange={(event) => updateStudentMark(item.student_id, "check_out_time", event.target.value)} disabled={register.status !== "Draft" || !canTake} /></td><td><small>{item.late_minutes || 0}m late<br />{item.early_departure_minutes || 0}m early</small></td><td><input value={item.absence_reason || ""} onChange={(event) => updateStudentMark(item.student_id, "absence_reason", event.target.value)} disabled={register.status !== "Draft" || !canTake} placeholder="Absence / leave reason" />{item.id && register.status === "Draft" && <label className="attendance-file-link"><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={(event) => uploadAbsenceDocument(item, event.target.files?.[0])} />Attach evidence</label>}</td><td>{item.id && <button className="attendance-correction-link" onClick={() => openCorrection(item, "Student")} type="button">Request</button>}</td></tr>)}</tbody></table></div> : <Empty title="No students assigned" text="Assign active students to this class and section first." />}{register.status === "Draft" && canTake && <footer className="attendance-register-actions"><button onClick={() => saveRegister("Draft")} disabled={busy} type="button">Save draft</button><button className="is-primary" onClick={() => saveRegister("Submitted")} disabled={busy} type="button">Submit attendance</button>{canApprove && <button className="is-primary" onClick={() => saveRegister("Approved")} disabled={busy} type="button">Approve now</button>}</footer>}</section>}</div>}

        {tab === "staff" && <section className="attendance-panel"><div className="attendance-staff-header"><PanelTitle title="Staff attendance" subtitle={`${date} · Late arrival and early departure`} /><button onClick={loadStaffDay} disabled={!campusId || busy} type="button">Load staff register</button></div>{staffLoaded ? staffRecords.length ? <><div className="attendance-table-wrap"><table className="attendance-table staff-attendance-table"><thead><tr><th>Staff member</th><th>Status</th><th>Check in</th><th>Check out</th><th>Late</th><th>Early departure</th><th>Reason</th><th>Correction</th></tr></thead><tbody>{staffRecords.map((item) => <tr key={item.staff_user_id}><td><strong>{item.staff_name}</strong><small>{item.school_role || item.username}</small></td><td><select className={`attendance-status-select is-${statusClass(item.status)}`} value={item.status} onChange={(event) => updateStaffMark(item.staff_user_id, "status", event.target.value)} disabled={!canStaff}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></td><td><input type="time" value={item.check_in_time || ""} onChange={(event) => updateStaffMark(item.staff_user_id, "check_in_time", event.target.value)} disabled={!canStaff} /></td><td><input type="time" value={item.check_out_time || ""} onChange={(event) => updateStaffMark(item.staff_user_id, "check_out_time", event.target.value)} disabled={!canStaff} /></td><td>{item.late_minutes || 0} min</td><td>{item.early_departure_minutes || 0} min</td><td><input value={item.absence_reason || ""} onChange={(event) => updateStaffMark(item.staff_user_id, "absence_reason", event.target.value)} disabled={!canStaff} placeholder="Reason" /></td><td>{item.id && canStaff && <button className="attendance-correction-link" onClick={() => openCorrection(item, "Staff")} type="button">Request</button>}</td></tr>)}</tbody></table></div>{canStaff && <footer className="attendance-register-actions"><button className="is-primary" onClick={saveStaffDay} disabled={busy} type="button">Save staff attendance</button></footer>}</> : <Empty title="No staff accounts found" text="Assign school roles and campus access from Foundation." /> : <Empty title="Load a staff register" text="Select a campus and date, then load its active staff accounts." />}</section>}

        {tab === "leave" && <div className="attendance-two-column"><section className="attendance-panel"><PanelTitle title="New leave application" subtitle="Student or staff leave with evidence" />{canSubmitLeave ? <form className="attendance-leave-form" onSubmit={createLeave}><label><span>Applicant type</span><select value={leaveForm.applicant_type} onChange={(event) => setLeaveForm((current) => ({ ...current, applicant_type: event.target.value, student_id: "", staff_user_id: "" }))}><option>Student</option><option>Staff</option></select></label>{leaveForm.applicant_type === "Student" ? <label><span>Student *</span><select value={leaveForm.student_id} onChange={(event) => setLeaveForm((current) => ({ ...current, student_id: event.target.value }))} required><option value="">Select student</option>{campusStudents.map((item) => <option value={item.id} key={item.id}>{item.student_name} · {item.admission_no}</option>)}</select></label> : <label><span>Staff *</span><select value={leaveForm.staff_user_id} onChange={(event) => setLeaveForm((current) => ({ ...current, staff_user_id: event.target.value }))} required><option value="">Select staff</option>{campusStaff.map((item) => <option value={item.user_id} key={item.user_id}>{item.name} · {item.school_role}</option>)}</select></label>}<label><span>Leave type</span><select value={leaveForm.leave_type} onChange={(event) => setLeaveForm((current) => ({ ...current, leave_type: event.target.value }))}><option>Casual</option><option>Sick</option><option>Emergency</option><option>Medical</option><option>Official</option><option>Other</option></select></label><div className="attendance-date-pair"><label><span>From *</span><input type="date" value={leaveForm.start_date} onChange={(event) => setLeaveForm((current) => ({ ...current, start_date: event.target.value }))} required /></label><label><span>To *</span><input type="date" value={leaveForm.end_date} onChange={(event) => setLeaveForm((current) => ({ ...current, end_date: event.target.value }))} required /></label></div><label><span>Reason *</span><textarea rows="4" value={leaveForm.reason} onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))} required /></label><label><span>Supporting document</span><input ref={leaveFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" /></label><button disabled={busy}>Submit leave application</button></form> : <Empty title="Leave submission unavailable" text="Your school role does not include leave submission." />}</section><section className="attendance-panel"><PanelTitle title="Leave applications" subtitle="Approval status and evidence" /><div className="attendance-card-list">{snapshot.leaves?.map((item) => <article key={item.id}><div className="attendance-card-main"><span className={`attendance-status-pill is-${statusClass(item.status)}`}>{item.status}</span><strong>{item.applicant_name}</strong><small>{item.applicant_type} · {item.leave_type} · {item.start_date} to {item.end_date}</small><p>{item.reason}</p>{item.document && <a href={getStaticUrl(item.document.file_url)} target="_blank" rel="noreferrer">Open supporting document</a>}</div>{item.status === "Pending" && canApprove && <div className="attendance-card-actions"><button onClick={() => reviewLeave(item.id, "Approved")} type="button">Approve</button><button className="is-danger" onClick={() => reviewLeave(item.id, "Rejected")} type="button">Reject</button></div>}</article>)}{!snapshot.leaves?.length && <Empty title="No leave applications" text="New applications will appear here." compact />}</div></section></div>}

        {tab === "corrections" && <div className="attendance-two-column"><section className="attendance-panel"><PanelTitle title="Correction approvals" subtitle="Submitted attendance cannot be overwritten" /><div className="attendance-card-list">{snapshot.corrections?.map((item) => <article key={item.id}><div className="attendance-card-main"><span className={`attendance-status-pill is-${statusClass(item.status)}`}>{item.status}</span><strong>{item.person_name}</strong><small>{item.target_type} · {item.attendance_date || ""} · {item.current_status} → {item.requested_status}</small><p>{item.reason}</p></div>{item.status === "Pending" && canApprove && <div className="attendance-card-actions"><button onClick={() => reviewCorrection(item.id, "Approved")} type="button">Approve</button><button className="is-danger" onClick={() => reviewCorrection(item.id, "Rejected")} type="button">Reject</button></div>}</article>)}{!snapshot.corrections?.length && <Empty title="No correction requests" text="Use Request on a student or staff record when a submitted mark needs changing." compact />}</div></section><section className="attendance-panel"><PanelTitle title="Attendance audit history" subtitle="Who changed what and when" /><div className="attendance-audit-list">{auditHistory.slice(0, 100).map((item) => <article key={item.id}><span></span><div><strong>{item.action}</strong><small>{item.target_type} #{item.target_id} · {item.created_at ? new Date(item.created_at).toLocaleString() : ""}</small><p>{item.reason || "Attendance record change"}</p></div></article>)}{!auditHistory.length && <Empty title="No attendance changes yet" text="Marking, approvals and corrections will create an audit trail." compact />}</div></section></div>}

        {tab === "reports" && <div className="attendance-report-layout"><section className="attendance-panel is-wide"><div className="attendance-report-header"><PanelTitle title="Monthly attendance summary" subtitle={`${report.sessions_count || 0} submitted ${reportType.toLowerCase()} registers`} /><div><input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} /><select value={reportClassId} onChange={(event) => setReportClassId(event.target.value)}><option value="">All classes</option>{reportClasses.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option>Daily</option><option>Subject</option></select><button onClick={loadReport} type="button">Refresh</button></div></div>{report.student_summary?.length ? <div className="attendance-table-wrap"><table className="attendance-table attendance-summary-table"><thead><tr><th>Student</th><th>Class</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>Attendance</th></tr></thead><tbody>{report.student_summary.map((item) => <tr className={item.low_attendance ? "is-low" : ""} key={item.student_id}><td><strong>{item.student_name}</strong><small>{item.admission_no}</small></td><td>{item.class_name} {item.section || ""}</td><td>{item.present}</td><td>{item.absent}</td><td>{item.late}</td><td>{item.leave}</td><td><div className="attendance-percent"><span style={{ width: `${Math.min(100, item.percentage)}%` }}></span></div><strong>{item.percentage}%</strong>{item.low_attendance && <small>Low attendance warning</small>}</td></tr>)}</tbody></table></div> : <Empty title="No submitted attendance for this month" text="Submit daily registers to generate monthly summaries." />}</section><section className="attendance-panel"><PanelTitle title="Low-attendance warnings" subtitle={`Below ${report.threshold || 75}%`} />{lowStudents.length ? <div className="attendance-warning-list">{lowStudents.map((item) => <article key={item.student_id}><strong>{item.student_name}</strong><span>{item.percentage}%</span><small>{item.class_name} · {item.absent} absences</small></article>)}</div> : <Empty title="No warnings" text="Students below the policy threshold appear here." compact />}</section><section className="attendance-panel"><PanelTitle title="Staff monthly summary" subtitle="Presence and punctuality" />{report.staff_summary?.length ? <div className="attendance-warning-list">{report.staff_summary.map((item) => <article key={item.staff_user_id}><strong>{item.staff_name}</strong><span>{item.percentage}%</span><small>{item.present} present · {item.late} late · {item.absent} absent</small></article>)}</div> : <Empty title="No staff summary" text="Save staff attendance to build the monthly report." compact />}</section><section className="attendance-panel is-wide"><PanelTitle title="Attendance policy" subtitle="Thresholds, working hours and automatic alerts" />{canPolicy ? <form className="attendance-policy-form" onSubmit={savePolicy}><label><span>Low-attendance threshold %</span><input type="number" min="1" max="100" value={policyForm.low_attendance_threshold} onChange={(event) => setPolicyForm((current) => ({ ...current, low_attendance_threshold: event.target.value }))} /></label><label><span>Late grace minutes</span><input type="number" min="0" max="180" value={policyForm.late_grace_minutes} onChange={(event) => setPolicyForm((current) => ({ ...current, late_grace_minutes: event.target.value }))} /></label><label><span>School starts</span><input type="time" value={policyForm.school_start_time} onChange={(event) => setPolicyForm((current) => ({ ...current, school_start_time: event.target.value }))} /></label><label><span>School ends</span><input type="time" value={policyForm.school_end_time} onChange={(event) => setPolicyForm((current) => ({ ...current, school_end_time: event.target.value }))} /></label><label className="attendance-check"><input type="checkbox" checked={policyForm.automatic_parent_notifications} onChange={(event) => setPolicyForm((current) => ({ ...current, automatic_parent_notifications: event.target.checked }))} /><span>Automatically notify parents when a student is absent</span></label><button disabled={busy}>Save policy</button></form> : <dl className="attendance-policy-readonly"><div><dt>Low attendance</dt><dd>{policyForm.low_attendance_threshold}%</dd></div><div><dt>Grace period</dt><dd>{policyForm.late_grace_minutes} minutes</dd></div><div><dt>Working hours</dt><dd>{policyForm.school_start_time}–{policyForm.school_end_time}</dd></div><div><dt>Parent alerts</dt><dd>{policyForm.automatic_parent_notifications ? "Automatic" : "Disabled"}</dd></div></dl>}</section></div>}
      </div>}

      {correctionOpen && <div className="attendance-modal-backdrop"><form className="attendance-modal" onSubmit={submitCorrection}><header><div><p>Approval required</p><h2>Attendance correction</h2></div><button onClick={() => setCorrectionOpen(false)} type="button">×</button></header><div className="attendance-modal-grid"><label><span>Requested status</span><select value={correctionForm.requested_status} onChange={(event) => setCorrectionForm((current) => ({ ...current, requested_status: event.target.value }))}>{statusOptions.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Correct check-in</span><input type="time" value={correctionForm.requested_check_in_time} onChange={(event) => setCorrectionForm((current) => ({ ...current, requested_check_in_time: event.target.value }))} /></label><label><span>Correct check-out</span><input type="time" value={correctionForm.requested_check_out_time} onChange={(event) => setCorrectionForm((current) => ({ ...current, requested_check_out_time: event.target.value }))} /></label><label className="is-wide"><span>Reason *</span><textarea rows="4" value={correctionForm.reason} onChange={(event) => setCorrectionForm((current) => ({ ...current, reason: event.target.value }))} required /></label></div><footer><button onClick={() => setCorrectionOpen(false)} type="button">Cancel</button><button className="is-primary" disabled={busy}>Submit for approval</button></footer></form></div>}
    </section>
  );
}

function PanelTitle({ title, subtitle }) { return <header className="attendance-panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div></header>; }
function Empty({ title, text, compact = false }) { return <div className={`attendance-empty ${compact ? "is-compact" : ""}`}><strong>{title}</strong><p>{text}</p></div>; }
function Select({ label, value, onChange, options, required = false }) { return <label><span>{label}</span><select value={value ?? ""} onChange={(event) => onChange(event.target.value)} required={required}><option value="">Select</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>; }

export default SchoolAttendance;
