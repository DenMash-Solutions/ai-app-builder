export const STYLING_RULES = `
Styling rules:
- Prefer the "className" prop with Tailwind utility classes for visual styling (colors, spacing, layout, typography).
- Put interaction states in className: hover:, focus-visible:, active: (e.g. "hover:bg-blue-300").
- The UI must look correct in BOTH light and dark themes — the user can switch themes at any time.
- Prefer semantic theme tokens for surfaces and text — they adapt to the active theme automatically: bg-background, bg-card, bg-muted, bg-primary, text-foreground, text-muted-foreground, text-primary-foreground, border-border.
- When you use explicit palette colors (bg-white, text-zinc-950, bg-gray-900, …), add a dark: counterpart so the element stays readable: "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100". Colored surfaces with contrasting text (e.g. "bg-blue-600 text-white") work in both themes without a dark: variant.
- Never hardcode colors (hex values, black/white) in the "style" prop — express colors through classes so they follow the theme.
- Prefer named Tailwind tokens over arbitrary bracket values in "className": bg-card/bg-muted instead of bg-[#hex], shadow-sm or shadow-md instead of shadow-[…], aspect-video or aspect-portrait instead of aspect-[…]. Arbitrary values may not exist in the compiled stylesheet; named tokens always do.
- Use the "style" prop only for exact values Tailwind classes cannot express, and never set the same CSS property in both.`;
