import {
  Activity,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  IndianRupee,
  TrendingUp,
} from 'lucide-react';

/**
 * Modern floating KPI tile matching the user's design.
 * Supports auto-detection by label or explicit props.
 */
export default function KpiTile({
  label,
  value,
  caption,
  variant,
  icon: customIcon,
  subtext,
  badge,
  badgeTone,
  badgeIcon,
}) {
  // Infer variant if not explicitly provided
  const inferredVariant =
    variant ||
    (label.toLowerCase().includes('booking')
      ? 'bookings'
      : label.toLowerCase().includes('billed')
        ? 'billed'
        : label.toLowerCase().includes('collected')
          ? 'collected'
          : label.toLowerCase().includes('due') || label.toLowerCase().includes('outstanding')
            ? 'dues'
            : 'default');

  const variantConfigs = {
    bookings: {
      icon: Calendar,
      tileClass: 'kpi-tile--green',
      iconBoxClass: 'kpi-icon-box--green',
      iconColor: '#16a34a',
      waveColor: 'rgba(187, 247, 208, 0.45)',
      defaultBadge: caption || badge,
      defaultBadgeTone: 'green',
      badgeIcon: Activity,
    },
    billed: {
      icon: IndianRupee,
      tileClass: 'kpi-tile--blue',
      iconBoxClass: 'kpi-icon-box--blue',
      iconColor: '#2563eb',
      waveColor: 'rgba(191, 219, 254, 0.45)',
      subtext: subtext || caption || 'Active bookings on this day',
      subIcon: TrendingUp,
      subColor: '#2563eb',
    },
    collected: {
      icon: CheckCircle2,
      tileClass: 'kpi-tile--emerald',
      iconBoxClass: 'kpi-icon-box--green',
      iconColor: '#16a34a',
      waveColor: 'rgba(187, 247, 208, 0.45)',
      subtext: subtext || caption,
      subIcon: Check,
      subColor: '#16a34a',
    },
    dues: {
      icon: AlertTriangle,
      tileClass: 'kpi-tile--orange',
      iconBoxClass: 'kpi-icon-box--orange',
      iconColor: '#ea580c',
      waveColor: 'rgba(254, 215, 170, 0.45)',
      subtext: subtext || caption,
      subIcon: Clock,
      subColor: '#ea580c',
    },
    default: {
      icon: Calendar,
      tileClass: 'kpi-tile--default',
      iconBoxClass: 'kpi-icon-box--green',
      iconColor: '#16a34a',
      waveColor: 'rgba(226, 232, 240, 0.4)',
      subtext: subtext || caption,
    },
  };

  const config = variantConfigs[inferredVariant] || variantConfigs.default;
  const IconComponent = customIcon || config.icon;

  return (
    <section className={`kpi-tile ${config.tileClass}`}>
      {/* Top row: Icon squircle + Label + 4-dot menu */}
      <div className="kpi-tile__top">
        <div className="kpi-tile__header-left">
          <div className={`kpi-icon-box ${config.iconBoxClass}`}>
            <IconComponent size={20} strokeWidth={2} color={config.iconColor} />
          </div>
          <h2 className="kpi-tile__label">{label}</h2>
        </div>

        {/* 4-dot indicator */}
        <div className="kpi-tile__dots" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* Value */}
      <p className="kpi-tile__value">{value}</p>

      {/* Bottom meta row */}
      <div className="kpi-tile__bottom">
        {inferredVariant === 'bookings' && (badge || config.defaultBadge) ? (
          <span className="kpi-tile__pill-badge">
            <Activity size={12} strokeWidth={2.2} />
            <span>{badge || config.defaultBadge}</span>
          </span>
        ) : (
          (subtext || config.subtext) && (
            <div className="kpi-tile__subtext-group">
              {config.subIcon && (
                <config.subIcon size={14} strokeWidth={2.2} color={config.subColor} className="kpi-tile__sub-icon" />
              )}
              <span className="kpi-tile__subtext">{subtext || config.subtext}</span>
            </div>
          )
        )}
      </div>

      {/* Decorative fluid corner wave */}
      <div className="kpi-tile__corner-wave" aria-hidden="true">
        <svg viewBox="0 0 120 70" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0 70 C30 35 65 60 90 20 C105 -5 120 15 120 0 L120 70 Z"
            fill={config.waveColor}
          />
        </svg>
      </div>
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
