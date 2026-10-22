import ServiceTakerWorkspace from "./ServiceTakerWorkspace";

export default function ServiceTakerPortal({ section = "dashboard", authenticatedUser, onLogout }) {
  return (
    <ServiceTakerWorkspace
      initialTab={section}
      authenticatedUser={authenticatedUser}
      onLogout={onLogout}
      key={section}
      mode="portal"
    />
  );
}
