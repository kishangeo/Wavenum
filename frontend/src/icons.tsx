// Inline SVG icons: Unicode symbols (✕ ↑ ↓ ☀ …) are missing from some system fonts and showed as boxes.
// Author: Kishan Tiwari
type P = { className?: string }
const S = ({ className = 'h-3.5 w-3.5', children }: P & { children: any }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 ${className}`} aria-hidden="true">{children}</svg>
)
export const XIcon = (p: P) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>
export const UpIcon = (p: P) => <S {...p}><path d="M12 19V5M5 12l7-7 7 7" /></S>
export const DownIcon = (p: P) => <S {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></S>
export const ChevronDown = (p: P) => <S {...p}><path d="m6 9 6 6 6-6" /></S>
export const CheckIcon = (p: P) => <S {...p}><path d="M20 6 9 17l-5-5" /></S>
export const CircleIcon = (p: P) => <S {...p}><circle cx="12" cy="12" r="8" /></S>
export const SunIcon = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>
export const MoonIcon = (p: P) => <S {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></S>
export const LayersIcon = (p: P) => <S {...p}><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></S>
