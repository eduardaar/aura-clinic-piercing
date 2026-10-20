/** Platform mark: a calendar and connected panels, distinct from studio jewelry. */
export function PlatformBrandMark({ size = 36, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label="Aura Clinic ERP"
    >
      <rect x="4" y="5" width="32" height="31" rx="8" stroke="currentColor" strokeWidth="2.5" />
      <path d="M5 15H35M13 3V9M27 3V9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="11" y="21" width="7" height="7" rx="2" fill="currentColor" />
      <rect x="23" y="21" width="7" height="7" rx="2" fill="currentColor" opacity=".5" />
    </svg>
  );
}
