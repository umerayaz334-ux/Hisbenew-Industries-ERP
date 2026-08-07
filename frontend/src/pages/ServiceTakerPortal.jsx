import ServiceTakerWorkspace from "./ServiceTakerWorkspace";

export default function ServiceTakerPortal({ section = "dashboard" }) {
  return (
    <ServiceTakerWorkspace
      initialTab={section}
      key={section}
      mode="portal"
    />
  );
}
