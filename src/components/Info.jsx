import { GLOSSARY } from '../lib/bet'

// Info icon; hovering (or focusing) shows the explanation.
// content can be a raw string or a glossary key lookup via `term`.
export default function Info({ term, children, className = '' }) {
  const text = children ?? GLOSSARY[term] ?? term
  return (
    <span className={`group relative inline-flex ${className}`} tabIndex={0}>
      <span
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-500 text-[10px] font-bold leading-none text-slate-400 transition group-hover:border-grass group-hover:text-grass"
        aria-label="What does this mean?"
      >
        ?
      </span>
      <span
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-lg border border-line bg-pitch-2 p-3 text-xs font-normal leading-relaxed text-slate-200 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
        role="tooltip"
      >
        {text}
      </span>
    </span>
  )
}
