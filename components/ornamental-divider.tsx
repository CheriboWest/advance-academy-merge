export function OrnamentalDivider() {
  return (
    <div className="flex items-center justify-center gap-4 my-12">
      <div className="flex-1 h-px bg-secondary opacity-30"></div>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="8" stroke="#D4AF37" strokeWidth="1.5" fill="none" />
        <circle cx="12" cy="12" r="4" fill="#D4AF37" />
      </svg>
      <div className="flex-1 h-px bg-secondary opacity-30"></div>
    </div>
  )
}
