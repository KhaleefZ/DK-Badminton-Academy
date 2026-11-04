import { NavLink } from 'react-router-dom';

/** DK / Tabs as route links (e.g. Schedule / Table). */
export default function ViewTabs({ tabs, label }) {
  return (
    <nav className="view-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="view-tabs__tab" end={tab.end}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
