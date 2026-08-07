import { useEffect, useMemo, useState } from "react";
import api from "../../api/api";
import defaultSchoolLogo from "../../assets/dar-e-arqam-logo.svg";
import "./SchoolDashboard.css";

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

function SchoolDashboard({ authenticatedUser, settings }) {
  const userName =
    authenticatedUser?.name || authenticatedUser?.username || "Welcome";
  const [students, setStudents] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/school/students")
      .then((response) => {
        if (!cancelled) setStudents(Array.isArray(response.data) ? response.data : []);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(
    () => ({
      total: students.length,
      active: students.filter((student) => student.status === "Active").length,
      classes: new Set(students.map((student) => student.class_name).filter(Boolean)).size,
    }),
    [students]
  );
  const logoSource = settings?.logo_data_url || defaultSchoolLogo;

  return (
    <section className="school-dashboard" aria-labelledby="school-greeting-title">
      <div className="school-dashboard-pattern" aria-hidden="true" />

      <div className="school-welcome-card">
        <img className="school-emblem" src={logoSource} alt={`${settings?.school_name || "Dar-e-Arqam"} logo`} />
        <p className="school-eyebrow">{settings?.school_name || "Dar-e-Arqam"} · {settings?.academic_session || "School ERP"}</p>
        <h1 id="school-greeting-title">
          {getGreeting()}, <span>{userName}</span>
        </h1>
        <p className="school-welcome-copy">
          Welcome to your school workspace.
        </p>
        <div className="school-dashboard-summary" aria-label="Student summary">
          <article><strong>{summary.total}</strong><span>Total students</span></article>
          <article><strong>{summary.active}</strong><span>Active students</span></article>
          <article><strong>{summary.classes}</strong><span>Classes</span></article>
        </div>
      </div>
    </section>
  );
}

export default SchoolDashboard;
