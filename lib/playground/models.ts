export interface PlaygroundModel {
  id: string;
  label: string;
  shortLabel: string;
  /** Requests per day in the current quota tier. */
  rpd: number;
}

export const AVAILABLE_MODELS = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    shortLabel: "3.8 Flash",
    rpd: 20,
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    shortLabel: "3.7 Flash",
    rpd: 20,
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    shortLabel: "3.6 Flash",
    rpd: 20,
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    shortLabel: "3.5 Flash",
    rpd: 20,
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    shortLabel: "3.5 Lite",
    rpd: 500,
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    shortLabel: "3.1 Lite",
    rpd: 500,
  },
  {
    id: "gemini-3-flash",
    label: "Gemini 3 Flash",
    shortLabel: "3 Flash",
    rpd: 20,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    shortLabel: "2.5 Flash",
    rpd: 20,
  },
] as const satisfies readonly PlaygroundModel[];

export type ModelId = (typeof AVAILABLE_MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = "gemini-3.1-flash-lite";

/** Matches quota/rate-limit failures from the Gemini API, by status or text. */
export const RATE_LIMIT_PATTERN =
  /quota|rate.?limit|resource_exhausted|\b429\b/i;

/**
 * Matches unavailable-service failures by message: empty completions
 * ("Service unavailable: … no response"), upstream 5xx, gateway 503, and
 * browser fetch failures. Checked after RATE_LIMIT_PATTERN, which wins ties.
 */
export const SERVICE_UNAVAILABLE_PATTERN =
  /service unavailable|no response|failed to fetch|networkerror|load failed|\b503\b/i;

export function isAvailableModel(value: unknown): value is ModelId {
  return AVAILABLE_MODELS.some((model) => model.id === value);
}

/** Validate a requested model id; unknown values fall back to the default. */
export function resolveModel(value: unknown): ModelId {
  return isAvailableModel(value) ? value : DEFAULT_MODEL_ID;
}

export function findModel(id: ModelId): PlaygroundModel {
  return (
    AVAILABLE_MODELS.find((model) => model.id === id) ?? AVAILABLE_MODELS[0]
  );
}
