/** Small hand-drawn stroke icons — kept to the handful this app actually
 * needs instead of pulling in a generic icon set. 1.6px stroke, 16-18px box. */

type IconProps = { className?: string; style?: React.CSSProperties };

export function IconSearch({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.7" cy="8.7" r="5.7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 13.5 17.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The logomark: a ranked list — the best match lit, the rest trailing off.
 *  Same geometry as app/icon.svg. */
export function IconBrand({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3.6" width="12" height="2.6" rx="1.3" fill="#86d4ae" />
      <rect x="3" y="7.7" width="8.4" height="2.6" rx="1.3" fill="#eef1ea" fillOpacity="0.78" />
      <rect x="3" y="11.8" width="4.8" height="2.6" rx="1.3" fill="#eef1ea" fillOpacity="0.4" />
    </svg>
  );
}

export function IconChevronDown({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6.2 8 10l4-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCheck({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowRight({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlus({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconBuilding({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5h1M9.5 5h1M5.5 7.5h1M9.5 7.5h1M5.5 10h1M9.5 10h1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconLink({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 9.5 9.5 6.5M6 4.5 7 3.5a2.4 2.4 0 0 1 3.4 3.4l-1 1M10 11.5l-1 1a2.4 2.4 0 0 1-3.4-3.4l1-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSpark({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5c.4 2.1 1.4 3.1 3.5 3.5-2.1.4-3.1 1.4-3.5 3.5-.4-2.1-1.4-3.1-3.5-3.5 2.1-.4 3.1-1.4 3.5-3.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M12.5 10.5c.2 1 .7 1.5 1.7 1.7-1 .2-1.5.7-1.7 1.7-.2-1-.7-1.5-1.7-1.7 1-.2 1.5-.7 1.7-1.7Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

/* Navigation set: 1.4px stroke on a 16px grid, drawn to match each other. */

export function IconOffers({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconPipeline({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.1 4H9a2.5 2.5 0 0 1 2.5 2.5v3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconBoard({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="3.2" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6.4" y="3" width="3.2" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.3" y="3" width="3.2" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function IconBell({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 11.2V7.5a4 4 0 0 1 8 0v3.7l1 1.3H3l1-1.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.6 14h2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconFile({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5l3 3v8H4v-11Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9 2.5v3h3M6 8.5h4M6 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconQuote({ className, style }: IconProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.2a1.7 1.7 0 0 1 1.7-1.7h7.6a1.7 1.7 0 0 1 1.7 1.7v5a1.7 1.7 0 0 1-1.7 1.7H7L4.2 13.5v-2.6a1.7 1.7 0 0 1-1.7-1.7v-5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
