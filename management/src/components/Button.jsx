import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

/** DK / Button — primary (court green), secondary (paper + fine rule), danger, ghost. */
export default function Button({ to, href, variant = 'secondary', size = 'md', icon = true, className = '', children, ...rest }) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ');
  const content = (
    <>
      <span>{children}</span>
      {icon && <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={classes} target="_blank" rel="noreferrer" {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {content}
    </button>
  );
}
