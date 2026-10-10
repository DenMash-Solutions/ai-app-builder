/** Per-family chip/dot colors. Static strings so Tailwind compiles them;
 *  outline colors mirror these in globals.css (`data-jr-type` rules). */
export const TYPE_FAMILIES: Record<
  string,
  { label: string; dot: string; chip: string; outline: string }
> = {
  Stack: {
    label: "text-emerald-300",
    dot: "bg-emerald-400",
    chip: "border-emerald-500/60",
    outline: "outline-emerald-500/60",
  },
  Card: {
    label: "text-violet-300",
    dot: "bg-violet-400",
    chip: "border-violet-500/60",
    outline: "outline-violet-500/60",
  },
  Text: {
    label: "text-sky-300",
    dot: "bg-sky-400",
    chip: "border-sky-500/60",
    outline: "outline-sky-500/60",
  },
  Heading: {
    label: "text-sky-300",
    dot: "bg-sky-400",
    chip: "border-sky-500/60",
    outline: "outline-sky-500/60",
  },
  Badge: {
    label: "text-amber-300",
    dot: "bg-amber-400",
    chip: "border-amber-500/60",
    outline: "outline-amber-500/60",
  },
  Image: {
    label: "text-pink-300",
    dot: "bg-pink-400",
    chip: "border-pink-500/60",
    outline: "outline-pink-500/60",
  },
  Button: {
    label: "text-rose-300",
    dot: "bg-rose-400",
    chip: "border-rose-500/60",
    outline: "outline-rose-500/60",
  },
};

export const DEFAULT_FAMILY = {
  label: "text-zinc-300",
  dot: "bg-zinc-400",
  chip: "border-zinc-500/60",
  outline: "outline-zinc-500/60",
};

export interface TypeFamily {
  label: string;
  dot: string;
  chip: string;
  outline: string;
}

/** Family classes for an element type (unknown types get the default). */
export function familyFor(type: string): TypeFamily {
  return TYPE_FAMILIES[type] ?? DEFAULT_FAMILY;
}
