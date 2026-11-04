import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

/**
 * DK / Button. Variants follow the Figma component set:
 * primary (court green), lime (rally lime on dark), secondary (paper + fine rule).
 * Renders a router Link (`to`), an external anchor (`href`) or a <button>.
 */
/** A button saved in the admin panel. With no label there's no button. */
export function LinkButton({ link, ...rest }) {
  if (!link?.label) return null;
  return (
    <Button to={link.to} {...rest}>
      {link.label}
    </Button>
  );
}

export default function Button({
  to,
  href,
  variant = 'primary',
  size = 'md',
  icon = true,
  className = '',
  children,
  ...rest
}) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ');
  const content = (
    <>
      <span>{children}</span>
      {icon && <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true" />}
    </>
  );

  // A link saved in the admin panel can point away from the website.
  const external = to && /^[a-z]+:/i.test(to) ? to : href;
  if (to && !external) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }
  if (external) {
    return (
      <a href={external} className={classes} target="_blank" rel="noreferrer" {...rest}>
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
