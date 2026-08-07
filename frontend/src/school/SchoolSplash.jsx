import defaultSchoolLogo from "../assets/dar-e-arqam-logo.svg";
import "./SchoolSplash.css";

function SchoolSplash({ settings }) {
  const logoSource = settings?.logo_data_url || defaultSchoolLogo;

  return (
    <div className="school-splash" role="status" aria-label="Opening school ERP">
      <div className="school-splash-inner">
        <div className="school-splash-logo-wrap">
          <img src={logoSource} alt="" className="school-splash-logo" />
          <span className="school-splash-orbit" aria-hidden="true" />
        </div>
        <strong>{settings?.school_name || "Dar-e-Arqam"}</strong>
        <span>{settings?.campus_name || "School ERP"}</span>
        <div className="school-splash-progress" aria-hidden="true">
          <i />
        </div>
      </div>
    </div>
  );
}

export default SchoolSplash;
