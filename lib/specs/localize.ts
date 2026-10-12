import type { Spec } from "@json-render/core";

type StateBag = Record<string, unknown>;

function getByPath(state: StateBag, path: string): unknown {
  return path
    .replace(/^\//, "")
    .split("/")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      state,
    );
}

/**
 * The engine resolves dynamic expressions in top-level props only — nested
 * `checks[].message` strings pass through opaque, so this pre-pass resolves
 * `{$state}` copy expressions inside each check's `message` against the
 * injected state before rendering. (A candidate upstream feature: deep
 * expression resolution in props — tracked as an engine-hardening idea.)
 *
 * Deliberately NOT resolved: `checks[].args` (and `enabled`). The engine
 * resolves those lazily at validation time against the LIVE state store —
 * eagerly freezing them here would pin cross-field references like
 * `args.other: {$state: "/auth/password"}` to their initial value.
 */
function resolveMessage(value: unknown, state: StateBag): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveMessage(item, state));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const expr = record["$state"];
    if (typeof expr === "string") {
      const resolved = getByPath(state, expr);
      return resolved === undefined ? value : resolved;
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        resolveMessage(entry, state),
      ]),
    );
  }
  return value;
}

export function localizeSpec(spec: Spec, state: StateBag): Spec {
  const elements = Object.fromEntries(
    Object.entries(spec.elements ?? {}).map(([id, element]) => {
      const props = element.props as Record<string, unknown> | undefined;
      if (!Array.isArray(props?.checks)) return [id, element];
      const checks = props.checks.map((check) => {
        if (!check || typeof check !== "object") return check;
        const record = check as Record<string, unknown>;
        if (!("message" in record)) return check;
        return { ...record, message: resolveMessage(record.message, state) };
      });
      return [id, { ...element, props: { ...props, checks } }];
    }),
  );
  return { ...spec, elements } as Spec;
}
