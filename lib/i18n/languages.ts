import { canonicalizeTag } from "@/lib/i18n/spec-languages";

/**
 * The language picker catalog (plan: spec-languages, decision 6): every
 * ISO 639-1 code (all substantial world languages) plus commonly requested
 * region/script variants and a few 639-2/3 codes for popular languages that
 * never got a two-letter code. The list stores TAGS ONLY — display names are
 * derived per render via `Intl.DisplayNames` in the app locale, so they
 * follow the en/es selector with nothing to translate or keep in sync.
 * Any other BCP-47 tag still reaches a spec through the dialog's free-text
 * escape hatch; this list only decides what the picker offers.
 */
export const LANGUAGE_TAGS: readonly string[] = [
  // ISO 639-1 (complete registry).
  "aa",
  "ab",
  "ae",
  "af",
  "ak",
  "am",
  "an",
  "ar",
  "as",
  "av",
  "ay",
  "az",
  "ba",
  "be",
  "bg",
  "bh",
  "bi",
  "bm",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "ce",
  "ch",
  "co",
  "cr",
  "cs",
  "cu",
  "cv",
  "cy",
  "da",
  "de",
  "dv",
  "dz",
  "ee",
  "el",
  "en",
  "eo",
  "es",
  "et",
  "eu",
  "fa",
  "ff",
  "fi",
  "fj",
  "fo",
  "fr",
  "fy",
  "ga",
  "gd",
  "gl",
  "gn",
  "gu",
  "gv",
  "ha",
  "he",
  "hi",
  "ho",
  "hr",
  "ht",
  "hu",
  "hy",
  "hz",
  "ia",
  "id",
  "ie",
  "ig",
  "ii",
  "ik",
  "io",
  "is",
  "it",
  "iu",
  "ja",
  "jv",
  "ka",
  "kg",
  "ki",
  "kj",
  "kk",
  "kl",
  "km",
  "kn",
  "ko",
  "kr",
  "ks",
  "ku",
  "kv",
  "kw",
  "ky",
  "la",
  "lb",
  "lg",
  "li",
  "ln",
  "lo",
  "lt",
  "lu",
  "lv",
  "mg",
  "mh",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "na",
  "nb",
  "nd",
  "ne",
  "ng",
  "nl",
  "nn",
  "no",
  "nr",
  "nv",
  "ny",
  "oc",
  "oj",
  "om",
  "or",
  "os",
  "pa",
  "pi",
  "pl",
  "ps",
  "pt",
  "qu",
  "rm",
  "rn",
  "ro",
  "ru",
  "rw",
  "sa",
  "sc",
  "sd",
  "se",
  "sg",
  "si",
  "sk",
  "sl",
  "sm",
  "sn",
  "so",
  "sq",
  "sr",
  "ss",
  "st",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "ti",
  "tk",
  "tl",
  "tn",
  "to",
  "tr",
  "ts",
  "tt",
  "tw",
  "ty",
  "ug",
  "uk",
  "ur",
  "uz",
  "ve",
  "vi",
  "vo",
  "wa",
  "wo",
  "xh",
  "yi",
  "yo",
  "za",
  "zh",
  "zu",
  // Common region/script variants.
  "pt-BR",
  "pt-PT",
  "zh-Hans",
  "zh-Hant",
  "en-GB",
  "en-AU",
  "es-MX",
  "es-AR",
  "es-CL",
  "es-CO",
  "fr-CA",
  "de-AT",
  "de-CH",
  "nl-BE",
  "ar-EG",
  "ar-MA",
  "sr-Latn",
  // Popular languages without an ISO 639-1 code.
  "yue",
  "ceb",
];

export interface LanguageOption {
  /** Canonical BCP-47 tag — the only thing stored or steered with. */
  tag: string;
  /** Display name in the given locale (falls back to the raw tag). */
  name: string;
}

const DISPLAY_NAMES_CACHE = new Map<string, Intl.DisplayNames>();

function displayNames(locale: string): Intl.DisplayNames | null {
  const cached = DISPLAY_NAMES_CACHE.get(locale);
  if (cached) return cached;
  try {
    // `fallback: "none"` → unknown tags yield undefined instead of the tag,
    // so callers can decide the fallback explicitly.
    const display = new Intl.DisplayNames([locale], {
      type: "language",
      fallback: "none",
    });
    DISPLAY_NAMES_CACHE.set(locale, display);
    return display;
  } catch {
    return null;
  }
}

/** Localized name for a tag in `locale`, or null when it can't be derived. */
export function languageName(tag: string, locale: string): string | null {
  try {
    return displayNames(locale)?.of(tag) ?? null;
  } catch {
    return null;
  }
}

/** Accent/case-folded text for localized matching ("francés" ~ "frances"). */
function foldForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

/** Every catalog language, named and sorted in `locale`. */
export function listLanguages(locale: string): LanguageOption[] {
  return LANGUAGE_TAGS.map((tag) => ({
    tag,
    name: languageName(tag, locale) ?? tag,
  })).sort((a, b) => a.name.localeCompare(b.name, locale));
}

/**
 * Catalog languages matching a typed query — against the LOCALE-SPECIFIC
 * name (typing "chino" finds zh in the Spanish UI) or the tag ("zh",
 * "pt-BR"). An empty query returns the whole list.
 */
export function filterLanguages(
  query: string,
  locale: string,
): LanguageOption[] {
  const options = listLanguages(locale);
  const needle = foldForMatch(query);
  if (!needle) return options;
  return options.filter(
    (option) =>
      foldForMatch(option.name).includes(needle) ||
      option.tag.toLowerCase().includes(needle),
  );
}

/**
 * Whether a query is a usable language code (the escape-hatch path).
 * BCP-47 grammar allows bare 5–8 letter primaries ("chino", "french") —
 * syntactically legal but reserved and practically never a real language —
 * so only codes whose canonical first subtag is 2–3 letters, or any
 * hyphenated form (pt-BR, zh-Hans), qualify as "the user typed a code".
 */
export function customLanguageTag(query: string): string | null {
  const canonical = canonicalizeTag(query.trim());
  if (!canonical) return null;
  const first = canonical.split("-")[0];
  if (first.length > 3 && !query.includes("-")) return null;
  return canonical;
}
