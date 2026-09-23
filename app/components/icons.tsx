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
