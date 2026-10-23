import { useState } from "react";
import api from "../api/api";
import { errorDetailText } from "../utils/apiError";
import "./ServiceAccountSettings.css";

const profileValues = (client) => ({ contact_name: client?.contact_name || "", email: client?.email || "", phone: client?.phone || "", billing_address: client?.billing_address || "" });
const emptyPin = { current_pin: "", new_pin: "", confirm_pin: "" };

export default function ServiceAccountSettings({ client, authenticatedUser, load, onLogout }) {
  const [saved, setSaved] = useState(() => profileValues(client));
  const [profile, setProfile] = useState(() => profileValues(client));
  const [pin, setPin] = useState(emptyPin);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState("");
  const [profileResult, setProfileResult] = useState(null);
  const [pinResult, setPinResult] = useState(null);
  const dirty = Object.keys(profile).some((key) => profile[key] !== saved[key]);
  const username = client?.username || authenticatedUser?.username || "Not set";
  const displayName = saved.contact_name || authenticatedUser?.name || username;
  const message = (error) => errorDetailText(error?.response?.data?.detail) || "Could not save changes. Please try again.";

  const saveProfile = async (event) => {
    event.preventDefault();
    setBusy("profile");
    setProfileResult(null);
    try {
      const { data } = await api.patch("/service-takers/portal/profile", profile);
      const next = profileValues(data);
      setSaved(next);
      setProfile(next);
      setProfileResult({ text: "Your contact details have been saved." });
      await load({ quiet: true });
    } catch (error) { setProfileResult({ error: true, text: message(error) }); }
    finally { setBusy(""); }
  };

  const savePin = async (event) => {
    event.preventDefault();
    setPinResult(null);
    if (pin.new_pin !== pin.confirm_pin) { setPinResult({ error: true, text: "New PIN and confirmation do not match." }); return; }
    setBusy("pin");
    try {
      const { data } = await api.post("/service-takers/portal/change-pin", pin);
      setPin(emptyPin);
      setShowPin(false);
      setPinResult({ text: data.message });
    } catch (error) { setPinResult({ error: true, text: message(error) }); }
    finally { setBusy(""); }
  };

  const feedback = (result) => result && <p className={`account-feedback ${result.error ? "is-error" : ""}`} role={result.error ? "alert" : "status"}>{result.text}</p>;
  return <div className="portal-account-settings">
    <section className="account-profile-banner" aria-label="Your profile">
      <span className="account-profile-avatar" aria-hidden="true">{displayName.trim().slice(0, 1).toUpperCase()}</span>
      <div className="account-profile-title"><h2>{displayName}</h2><p>{client?.company_name}</p></div>
      <span className="account-active-badge">{client?.is_active === false ? "Account paused" : "Active account"}</span>
    </section>
    <div className="account-settings-layout">
      <div className="account-settings-main">
        <section className="account-settings-card" aria-labelledby="account-contact-title">
          <header><h2 id="account-contact-title">Contact details</h2></header>
          <form onSubmit={saveProfile}>
            <fieldset disabled={Boolean(busy)} className="account-form-fields">
              <label>Contact name<input autoComplete="name" required maxLength={200} value={profile.contact_name} onChange={(event) => setProfile({ ...profile, contact_name: event.target.value })} /></label>
              <label>Email address<input autoComplete="email" type="email" maxLength={200} placeholder="you@example.com" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></label>
              <label>Phone number<input autoComplete="tel" type="tel" maxLength={100} placeholder="Add a contact number" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
            </fieldset>
            {feedback(profileResult)}
            <footer className="account-form-footer"><span>{dirty ? "Unsaved changes" : ""}</span><div><button type="button" disabled={!dirty || Boolean(busy)} onClick={() => { setProfile(saved); setProfileResult(null); }}>Discard</button><button className="account-primary" disabled={!dirty || Boolean(busy)} type="submit">{busy === "profile" ? "Saving…" : "Save changes"}</button></div></footer>
          </form>
        </section>
        <details className="account-settings-card account-security-compact">
          <summary>Change PIN <span>4-digit sign-in PIN</span></summary>
          <form onSubmit={savePin}>
            <fieldset disabled={Boolean(busy)} className="account-pin-fields">
              {[['current_pin', 'Current PIN'], ['new_pin', 'New PIN'], ['confirm_pin', 'Confirm new PIN']].map(([key, label]) => <label key={key}>{label}<input type={showPin ? "text" : "password"} inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete={key === "current_pin" ? "current-password" : "new-password"} value={pin[key]} onChange={(event) => setPin({ ...pin, [key]: event.target.value.replace(/[^0-9]/g, "") })} /></label>)}
            </fieldset>
            <label className="account-show-pin"><input type="checkbox" checked={showPin} onChange={(event) => setShowPin(event.target.checked)} /> Show PINs</label>
            {feedback(pinResult)}
            <footer className="account-form-footer"><button className="account-primary" disabled={Boolean(busy)} type="submit">{busy === "pin" ? "Updating…" : "Update PIN"}</button></footer>
          </form>
        </details>
      </div>
      <div className="account-compact-footer"><span>Username: <strong>{username}</strong> · {client?.currency || "PKR"}</span><button disabled={Boolean(busy)} onClick={onLogout} type="button">Log out</button></div>
    </div>
  </div>;
}
