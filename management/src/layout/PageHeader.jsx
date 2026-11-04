import { useEffect } from 'react';

/** Page title, subtitle and primary page action. Also sets the document title. */
export default function PageHeader({ title, subtitle, action }) {
  useEffect(() => {
    document.title = `${title} · DK Operations`;
  }, [title]);

  return (
    <div className="page-header">
      <div className="page-header__intro">
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
