import { useEffect, useMemo, useState } from "react";
import api from "../../api/api";
import defaultSchoolLogo from "../../assets/dar-e-arqam-logo.svg";
import "./SchoolAdmissionApply.css";

const initialForm = {
  campus_id: "",
  academic_session_id: "",
  school_class_id: "",
  school_section_id: "",
  student_name: "",
  date_of_birth: "",
  gender: "",
  b_form_no: "",
  birth_certificate_no: "",
  father_name: "",
  mother_name: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  address: "",
  previous_school: "",
  medical_conditions: "",
  allergies: "",
  special_requirements: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
};

const knownFields = new Set(Object.keys(initialForm));
const messageFrom = (error) => error?.response?.data?.detail || "Your application could not be submitted.";

function SchoolAdmissionApply({ settings }) {
  const [snapshot, setSnapshot] = useState({ campuses: [], sessions: [], classes: [], sections: [], fields: [] });
  const [form, setForm] = useState(initialForm);
  const [customAnswers, setCustomAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    api.get("/school/admissions/public/form")
      .then((response) => {
        if (!active) return;
        const data = response.data || {};
        setSnapshot(data);
        setForm((current) => ({
          ...current,
          campus_id: data.campuses?.[0]?.id || "",
          academic_session_id: data.sessions?.find((item) => item.is_current)?.id || data.sessions?.[0]?.id || "",
        }));
      })
      .catch((error) => active && setNotice({ type: "error", text: messageFrom(error) }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const selectedCampus = snapshot.campuses.find((item) => item.id === Number(form.campus_id));
  const classes = useMemo(
    () => snapshot.classes.filter((item) => item.campus_id === Number(form.campus_id)),
    [form.campus_id, snapshot.classes]
  );
  const sections = useMemo(
    () => snapshot.sections.filter((item) => item.school_class_id === Number(form.school_class_id)),
    [form.school_class_id, snapshot.sections]
  );
  const sessions = snapshot.sessions.filter((item) => !item.campus_id || item.campus_id === Number(form.campus_id));
  const logo = selectedCampus?.logo_data_url || settings?.logo_data_url || defaultSchoolLogo;

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "campus_id" ? { school_class_id: "", school_section_id: "" } : {}),
      ...(name === "school_class_id" ? { school_section_id: "" } : {}),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        ...form,
        campus_id: Number(form.campus_id),
        academic_session_id: Number(form.academic_session_id),
        school_class_id: form.school_class_id ? Number(form.school_class_id) : null,
        school_section_id: form.school_section_id ? Number(form.school_section_id) : null,
        custom_answers: customAnswers,
        source: "Online",
      };
      const response = await api.post("/school/admissions/public/apply", payload);
      setResult(response.data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNotice({ type: "error", text: messageFrom(error) });
    } finally {
      setSaving(false);
    }
  };

  const fieldControl = (field) => {
    const isKnown = knownFields.has(field.field_key);
    const value = isKnown ? form[field.field_key] ?? "" : customAnswers[field.field_key] ?? "";
    const onChange = isKnown
      ? update
      : (event) => setCustomAnswers((current) => ({ ...current, [field.field_key]: event.target.value }));
    const common = { name: field.field_key, value, onChange, required: field.is_required };
    if (field.input_type === "textarea") return <textarea {...common} rows="3" />;
    if (field.input_type === "select") {
      return <select {...common}><option value="">Select</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select>;
    }
    return <input {...common} type={["date", "email", "tel", "number"].includes(field.input_type) ? field.input_type : "text"} />;
  };

  if (result) {
    return (
      <main className="school-apply-page">
        <section className="school-apply-success">
          <img src={logo} alt="" />
          <span aria-hidden="true">✓</span>
          <p>Application submitted</p>
          <h1>Thank you, your application is in review.</h1>
          <div><small>Application number</small><strong>{result.application_no}</strong></div>
          <p>Save this number. The admission office will use it for your test, interview and admission updates.</p>
          <button type="button" onClick={() => window.print()}>Print receipt</button>
        </section>
      </main>
    );
  }

  return (
    <main className="school-apply-page">
      <section className="school-apply-shell">
        <header>
          <img src={logo} alt="" />
          <div><p>{snapshot.workspace?.name || settings?.school_name || "Dar-e-Arqam"}</p><h1>Online admission application</h1><span>Complete the form carefully. Required fields are marked with an asterisk.</span></div>
        </header>
        {notice && <div className={`school-apply-notice is-${notice.type}`}>{notice.text}</div>}
        {loading ? <div className="school-apply-loading">Loading admission form...</div> : (
          <form onSubmit={submit}>
            <fieldset>
              <legend>Applying for</legend>
              <div className="school-apply-grid">
                <label><span>Campus *</span><select name="campus_id" value={form.campus_id} onChange={update} required><option value="">Select campus</option>{snapshot.campuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>Academic session *</span><select name="academic_session_id" value={form.academic_session_id} onChange={update} required><option value="">Select session</option>{sessions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>Class applying for *</span><select name="school_class_id" value={form.school_class_id} onChange={update} required><option value="">Select class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>Preferred section</span><select name="school_section_id" value={form.school_section_id} onChange={update}><option value="">Any section</option>{sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Student and family information</legend>
              <div className="school-apply-grid">
                {snapshot.fields.map((field) => <label className={field.input_type === "textarea" ? "is-wide" : ""} key={field.id}><span>{field.label}{field.is_required ? " *" : ""}<small>{field.label_ur || ""}</small></span>{fieldControl(field)}</label>)}
                <label><span>Guardian name</span><input name="guardian_name" value={form.guardian_name} onChange={update} /></label>
                <label><span>Guardian email</span><input name="guardian_email" type="email" value={form.guardian_email} onChange={update} /></label>
                <label><span>Emergency contact name</span><input name="emergency_contact_name" value={form.emergency_contact_name} onChange={update} /></label>
                <label><span>Emergency contact phone</span><input name="emergency_contact_phone" type="tel" value={form.emergency_contact_phone} onChange={update} /></label>
                <label className="is-wide"><span>Allergies</span><textarea name="allergies" value={form.allergies} onChange={update} rows="2" /></label>
                <label className="is-wide"><span>Special requirements</span><textarea name="special_requirements" value={form.special_requirements} onChange={update} rows="2" /></label>
              </div>
            </fieldset>
            <footer><p>By submitting, you confirm that this information is correct.</p><button disabled={saving} type="submit">{saving ? "Submitting..." : "Submit application"}</button></footer>
          </form>
        )}
      </section>
    </main>
  );
}

export default SchoolAdmissionApply;
