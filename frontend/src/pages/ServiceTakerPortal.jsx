import ServiceTakerWorkspace from "./ServiceTakerWorkspace";

export default function ServiceTakerPortal({ section = "dashboard", authenticatedUser }) {
  return (
    <ServiceTakerWorkspace
      initialTab={section}
      authenticatedUser={authenticatedUser}
      key={section}
      mode="portal"
    />
  );
}
