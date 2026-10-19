import { DATA_ERROR_CODES, DataError } from "./types";
import type { NamedResourceDef } from "./types";

/**
 * Record validation against a resource's declared `schema` (D3: schema is
 * validated before any write, and returned records are trusted only after
 * this check). Shared by every adapter — the localStorage and database
 * providers enforce exactly the same shape rules.
 */
export function validateRecord(
  resource: NamedResourceDef,
  record: Record<string, unknown>,
): void {
  if (!resource.schema) return;
  for (const [field, expected] of Object.entries(resource.schema)) {
    const value = record[field];
    if (value === undefined) {
      throw new DataError(
        DATA_ERROR_CODES.invalidRecord,
        `Record is missing schema field "${field}" (expected ${expected}).`,
      );
    }
    if (typeof value !== expected) {
      throw new DataError(
        DATA_ERROR_CODES.invalidRecord,
        `Record field "${field}" must be ${expected}, got ${typeof value}.`,
      );
    }
  }
}
