import "./nav-gold.css";

export function GoldIcon() {
  return (
    <div className="nav-gold-icon" title="App Contable">
      <div className="nav-icon-grid">
        <span style={{ gridArea: "1 / 1" }} />
        <span style={{ gridArea: "1 / 2" }} />
        <span style={{ gridArea: "2 / 1" }} />
        <span style={{ gridArea: "2 / 2" }} />
      </div>
    </div>
  );
}

export function PlainIcon({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="nav-icon-plain" title={title}>
      {children}
    </div>
  );
}
