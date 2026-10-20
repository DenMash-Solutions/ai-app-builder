import { canonicalizeTag } from "@/lib/i18n/spec-languages";

/** The convenience pair when the prompt names no languages. */
export const DEFAULT_GENERATION_LANGUAGES = ["en", "es"] as const;

/**
 * In-spec language contract for the generator (see
 * `docs/plan/038-spec-languages/convention.md`). The seed language is
 * `state.locale` — passed per request so the copy is written in the route's
 * language; translations live in `state.i18n.<tag>` under the same keys.
 */
export function i18nRules(locale: string | undefined): string {
  const seed = (locale && canonicalizeTag(locale)) || "en";
  const pair = DEFAULT_GENERATION_LANGUAGES.join(", ");

  return `
In-spec language rules:
- Put every user-facing string (headings, labels, button text, placeholders, captions, alt text, descriptions, messages) into state.copy under a stable kebab-case key, and reference it from props as {"$state": "/copy/<key>"} — never a literal string in a copy prop (text, label, title, description, placeholder, caption, message, alt, content). Structural props (href, src, className, variant, …) stay literal.
- Set state.locale to "${seed}". That language is the SEED: write its copy in state.copy only and do not create an i18n entry for it.
- Ship translations as state.i18n = {"<BCP-47 tag>": {"<same copy keys>": "translated text"}}. If the user's prompt names target languages, use exactly those tags (BCP-47, e.g. "es", "fr", "pt-BR"); otherwise translate into ${pair}.
- Translate every copy key you create — no partial overlays — and keep the keys and $state refs identical across languages.
- If the design has a language switcher (a ButtonGroup whose buttons are language tags), keep state.locale bound on its selected prop ({"$bindState": "/locale"}) and bind its change event so switching really works: give the element "on": {"change": [{"action": "switch_language", "params": {"tag": {"$state": "/locale"}}}]}.
`;
}
