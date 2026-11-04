/** DK / KPI tile. */
export default function KpiTile({ label, value, caption }) {
  return (
    <section className="kpi-tile">
      <h2 className="kpi-tile__label">{label}</h2>
      <p className="kpi-tile__value">{value}</p>
      {caption && <p className="kpi-tile__caption">{caption}</p>}
    </section>
  );
}

export function KpiRow({ children, columns }) {
  return (
    <div className="kpi-row" style={columns ? { '--kpi-columns': columns } : undefined}>
      {children}
    </div>
  );
}
