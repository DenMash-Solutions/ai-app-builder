import {
  evaluateVisibility,
  getByPath,
  resolvePropValue,
  resolveRepeatItemStatePath,
  resolveRepeatStatePath,
  splitRepeatVisibility,
} from "@json-render/core";
import type {
  PropResolutionContext,
  Spec,
  StateModel,
  VisibilityCondition,
} from "@json-render/core";
import { getAncestorPath } from "./structure";

/** One repeat scope a picked instance passes through. */
export interface InstanceLevel {
  /** Key of the repeated container element. */
  containerKey: string;
  /** Position among the container's rendered instances, in DOM order. */
  domIndex: number;
}

/** Outermost → innermost repeat scopes of the picked instance. */
export type InstanceChain = InstanceLevel[];

export const PROP_TARGET_KINDS = {
  template: "template",
  state: "state",
  item: "item",
  readonly: "readonly",
} as const;

export type PropTarget =
  | { kind: typeof PROP_TARGET_KINDS.template }
  | { kind: typeof PROP_TARGET_KINDS.state; path: string }
  | { kind: typeof PROP_TARGET_KINDS.item; field: string }
  | { kind: typeof PROP_TARGET_KINDS.readonly };

/** Per-prop write target under the current instance chain. */
export interface PropBinding {
  target: PropTarget;
  /** Absolute state path a commit should write, or null when not writable. */
  dataPath: string | null;
  displayValue: unknown;
  readonly: boolean;
}

/** Resolved instance scope shown as the panel's chip. */
export interface InstanceScope {
  /** Absolute state path of the picked repeat item, e.g. "/images/2". */
  basePath: string;
  /** Source array index of the picked item (after visibility filtering). */
  itemIndex: number;
  /** Visible instances of the innermost repeat container. */
  count: number;
}

const EXPRESSION_PREFIX = "$";

/**
 * Classifies a raw prop value: primitives and literal objects are template
 * edits; single-expression `$state`/`$bindState`/`$item`/`$bindItem` objects
 * are state-data edits; every other expression ($cond, $template, $computed,
 * multi-key objects) is read-only — we cannot round-trip it safely.
 */
export function analyzePropValue(value: unknown): PropTarget {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: PROP_TARGET_KINDS.template };
  }
  const expression = value as Record<string, unknown>;
  const keys = Object.keys(expression);
  if (!keys.every((key) => key.startsWith(EXPRESSION_PREFIX))) {
    return { kind: PROP_TARGET_KINDS.template };
  }
  if (keys.length === 1) {
    const key = keys[0];
    const entry = expression[key];
    if (typeof entry === "string") {
      if (key === "$item" || key === "$bindItem") {
        return { kind: PROP_TARGET_KINDS.item, field: entry };
      }
      if (key === "$state" || key === "$bindState") {
        return { kind: PROP_TARGET_KINDS.state, path: entry };
      }
    }
  }
  return { kind: PROP_TARGET_KINDS.readonly };
}

/**
 * Maps a DOM position within one repeat container to the source array index,
 * skipping items hidden by the repeat's item filter. Mirrors how
 * `RepeatChildren` renders: k-th visible item → k-th wrapper in document order.
 */
export function mapDomIndexToIndex(
  items: readonly unknown[],
  itemFilter: VisibilityCondition | undefined,
  domIndex: number,
  state: StateModel,
): number | null {
  if (domIndex < 0) return null;
  if (!itemFilter) {
    return domIndex < items.length ? domIndex : null;
  }
  let visibleSeen = 0;
  for (let index = 0; index < items.length; index += 1) {
    const visible = evaluateVisibility(itemFilter, {
      stateModel: state,
      repeatItem: items[index],
      repeatIndex: index,
    });
    if (!visible) continue;
    if (visibleSeen === domIndex) return index;
    visibleSeen += 1;
  }
  return null;
}

interface ChainWalk {
  base: string | null;
  innermost: {
    items: unknown[];
    itemFilter: VisibilityCondition | undefined;
    index: number;
  } | null;
}

/**
 * Resolves the chain level by level: each container's `repeat.statePath`
 * (absolute, or `{$item}` relative to the outer item path) → source array →
 * DOM index remapped through the item filter → item path.
 */
function walkChain(
  spec: Spec,
  state: StateModel,
  chain: InstanceChain,
): ChainWalk {
  let base: string | null = null;
  let innermost: ChainWalk["innermost"] = null;
  for (let position = 0; position < chain.length; position += 1) {
    const level = chain[position];
    const container = spec.elements[level.containerKey];
    const repeat = container?.repeat;
    if (!container || !repeat) return { base: null, innermost: null };
    const arrayPath = resolveRepeatStatePath(repeat.statePath, base);
    if (arrayPath === undefined) return { base: null, innermost: null };
    const items = getByPath(state, arrayPath);
    if (!Array.isArray(items)) return { base: null, innermost: null };
    // The renderer splits item-level visibility only for the outermost
    // repeat; nested repeats render every item of each container instance.
    const { itemFilter } =
      position === 0
        ? splitRepeatVisibility(container.visible)
        : { itemFilter: undefined };
    const index = mapDomIndexToIndex(items, itemFilter, level.domIndex, state);
    if (index === null) return { base: null, innermost: null };
    base = resolveRepeatItemStatePath(arrayPath, index);
    innermost = { items, itemFilter, index };
  }
  return { base, innermost };
}

/** Absolute state path of the repeat item the chain scopes into, or null. */
export function resolveChainBasePath(
  spec: Spec,
  state: StateModel,
  chain: InstanceChain,
): string | null {
  if (chain.length === 0) return null;
  return walkChain(spec, state, chain).base;
}

/** Chip data for a picked instance: item path, array index, visible count. */
export function resolveInstanceScope(
  spec: Spec,
  state: StateModel,
  chain: InstanceChain,
): InstanceScope | null {
  if (chain.length === 0) return null;
  const { base, innermost } = walkChain(spec, state, chain);
  if (base === null || innermost === null) return null;
  const { itemFilter } = innermost;
  let count = innermost.items.length;
  if (itemFilter) {
    count = 0;
    for (let index = 0; index < innermost.items.length; index += 1) {
      const visible = evaluateVisibility(itemFilter, {
        stateModel: state,
        repeatItem: innermost.items[index],
        repeatIndex: index,
      });
      if (visible) count += 1;
    }
  }
  return { basePath: base, itemIndex: innermost.index, count };
}

/**
 * Number of rendered instances of `key` for the current spec+state. Walks
 * from the root through repeats, multiplying nested repeats and applying the
 * item filter to the outermost repeat only — mirroring `walkChain`/the
 * renderer.
 */
export function countKeyInstances(spec: Spec, key: string): number {
  const state = spec.state ?? {};
  let total = 0;
  const visit = (
    elementKey: string,
    env: {
      multiplier: number;
      base: string | null;
      outermost: boolean;
    },
  ): void => {
    const element = spec.elements[elementKey];
    if (!element) return;
    const children = element.children ?? [];
    if (!element.repeat) {
      if (elementKey === key) total += env.multiplier;
      for (const child of children) visit(child, env);
      return;
    }
    const arrayPath = resolveRepeatStatePath(
      element.repeat.statePath,
      env.base,
    );
    if (arrayPath === undefined) return;
    const items = getByPath(state, arrayPath);
    if (!Array.isArray(items)) return;
    const { itemFilter } = env.outermost
      ? splitRepeatVisibility(element.visible)
      : { itemFilter: undefined };
    for (let index = 0; index < items.length; index += 1) {
      if (
        itemFilter &&
        !evaluateVisibility(itemFilter, {
          stateModel: state,
          repeatItem: items[index],
          repeatIndex: index,
        })
      ) {
        continue;
      }
      // The repeated container itself renders once per visible item.
      if (elementKey === key) total += env.multiplier;
      for (const child of children) {
        visit(child, {
          multiplier: env.multiplier,
          base: resolveRepeatItemStatePath(arrayPath, index),
          outermost: false,
        });
      }
    }
  };
  visit(spec.root, { multiplier: 1, base: null, outermost: true });
  return total;
}

/** Absolute state path a prop writes to under this chain, or null. */
export function resolveDataPath(
  spec: Spec,
  state: StateModel,
  chain: InstanceChain,
  target: PropTarget,
): string | null {
  if (target.kind === PROP_TARGET_KINDS.state) return target.path;
  if (target.kind === PROP_TARGET_KINDS.item) {
    const base = resolveChainBasePath(spec, state, chain);
    if (base === null) return null;
    return `${base}/${escapePointer(target.field)}`;
  }
  return null;
}

/**
 * Best-effort resolved value for display: data bindings read the state path;
 * other expressions resolve through core; anything unresolvable falls back to
 * the raw value (rendered as JSON by the form).
 */
export function resolvePropDisplay(
  spec: Spec,
  state: StateModel,
  chain: InstanceChain,
  value: unknown,
): unknown {
  const target = analyzePropValue(value);
  if (target.kind === PROP_TARGET_KINDS.template) return value;
  if (target.kind === PROP_TARGET_KINDS.state) {
    return getByPath(state, target.path);
  }
  const base = chain.length > 0 ? walkChain(spec, state, chain).base : null;
  if (target.kind === PROP_TARGET_KINDS.item) {
    if (base === null) return value;
    return getByPath(state, `${base}/${escapePointer(target.field)}`);
  }
  try {
    const context: PropResolutionContext = {
      stateModel: state,
      ...(base !== null ? { repeatBasePath: base } : {}),
    };
    return resolvePropValue(value, context);
  } catch {
    return value;
  }
}

/** Full per-prop analysis for the edit panel: write target + display value. */
export function analyzePropBinding(
  spec: Spec,
  state: StateModel,
  chain: InstanceChain,
  value: unknown,
): PropBinding {
  const target = analyzePropValue(value);
  const displayValue = resolvePropDisplay(spec, state, chain, value);
  if (target.kind === PROP_TARGET_KINDS.template) {
    return { target, dataPath: null, displayValue, readonly: false };
  }
  if (target.kind === PROP_TARGET_KINDS.state) {
    return { target, dataPath: target.path, displayValue, readonly: false };
  }
  if (target.kind === PROP_TARGET_KINDS.item) {
    const dataPath = resolveDataPath(spec, state, chain, target);
    if (dataPath === null) {
      return { target, dataPath: null, displayValue, readonly: true };
    }
    return { target, dataPath, displayValue, readonly: false };
  }
  return { target, dataPath: null, displayValue, readonly: true };
}

/**
 * Chain to keep when the selection moves to another key (breadcrumb or
 * structure list): a level applies only while the target sits strictly below
 * its repeat container.
 */
export function chainForKey(
  spec: Spec,
  chain: InstanceChain,
  targetKey: string,
): InstanceChain | null {
  if (chain.length === 0) return null;
  const path = getAncestorPath(spec, targetKey);
  const kept = chain.filter(
    (level) =>
      level.containerKey !== targetKey && path.includes(level.containerKey),
  );
  return kept.length > 0 ? kept : null;
}

/** RFC 6901 escaping for a path segment. */
function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
