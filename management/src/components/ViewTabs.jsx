import { NavLink } from 'react-router-dom';
import { useCan } from '../auth/AuthContext';

/** DK / Tabs as route links (e.g. Schedule / Table). Tabs with a `permission` the staff member lacks are hidden. */
export default function ViewTabs({ tabs, label }) {
  const can = useCan();
  const shown = tabs.filter((tab) => !tab.permission || can(tab.permission));
  // One tab left (e.g. a role that can see enquiries but not messages): nothing to switch between.
  if (shown.length < 2) return null;
  return (
    <nav className="view-tabs" aria-label={label}>
      {shown.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="view-tabs__tab" end={tab.end}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
