/** Viral Hit identity: an original inline mark, with no upstream brand asset. */
export function LogoMark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="viral-hit-flame" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff6a3d" />
          <stop offset="0.52" stopColor="#ff3d71" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#viral-hit-flame)" />
      <path d="M8 9.5 14.05 23h3.9L24 9.5h-4.3l-3.72 8.86-3.7-8.86H8Z" fill="white" />
      <path d="m22.8 5.2.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" fill="white" fillOpacity=".92" />
    </svg>
  );
}

export function LogoWordmark({ zh = false }: { zh?: boolean }): React.JSX.Element {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap" aria-label="Viral Hit">
      <span className="text-[15px] font-extrabold tracking-[-0.035em] text-fg">Viral Hit</span>
      {zh && <span className="text-[10px] font-medium tracking-wide text-mut">爆款工坊</span>}
    </span>
  );
}
