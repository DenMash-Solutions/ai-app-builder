import type { Spec, UIElement } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";
import { isContainerType } from "@/lib/playground/catalog";

export const STRUCTURE_OPS = {
  insert: "insert",
  remove: "remove",
  group: "group",
  ungroup: "ungroup",
  move: "move",
  duplicate: "duplicate",
} as const;

export const DROP_ZONES = {
  before: "before",
  after: "after",
  inside: "inside",
} as const;

export type DropZone = (typeof DROP_ZONES)[keyof typeof DROP_ZONES];

export interface MoveTarget {
  key: string;
  targetParentKey: string;
  index: number;
}

export type StructureOp = (typeof STRUCTURE_OPS)[keyof typeof STRUCTURE_OPS];

export const MOVE_DIRECTIONS = {
  up: -1,
  down: 1,
} as const;

export type MoveDirection =
  (typeof MOVE_DIRECTIONS)[keyof typeof MOVE_DIRECTIONS];

export interface StructureResult {
  spec: Spec;
  key: string;
}

/**
 * All primitives are immutable local structural edits — no LLM round trip.
 * `children` arrays are always replaced wholesale (never appended via JSON
 * pointer index ops) so parent links stay consistent; `null` means the op is
 * not applicable (missing element, root protection, boundary reached).
 */

function kebabCase(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function uniqueKey(spec: Spec, type: string): string {
  const base = kebabCase(type) || "element";
  for (let index = 1; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!spec.elements[candidate]) return candidate;
  }
}

function subtreeKeys(spec: Spec, key: string): string[] {
  const collected: string[] = [];
  const visit = (currentKey: string) => {
    collected.push(currentKey);
    const element = spec.elements[currentKey];
    if (!element) return;
    for (const child of element.children ?? []) visit(child);
    for (const slotKeys of Object.values(element.slots ?? {})) {
      for (const child of slotKeys) visit(child);
    }
  };
  visit(key);
  return collected;
}

export function findParentKey(spec: Spec, key: string): string | null {
  for (const [candidateKey, element] of Object.entries(spec.elements)) {
    if ((element.children ?? []).includes(key)) return candidateKey;
    for (const slotKeys of Object.values(element.slots ?? {})) {
      if (slotKeys.includes(key)) return candidateKey;
    }
  }
  return null;
}

/** Path of keys from spec.root down to and including `key`; [] if unknown. */
export function getAncestorPath(spec: Spec, key: string): string[] {
  if (!spec.elements[key]) return [];
  const path: string[] = [];
  let cursor: string | null = key;
  const guard = new Set<string>();
  while (cursor !== null && !guard.has(cursor)) {
    guard.add(cursor);
    path.unshift(cursor);
    if (cursor === spec.root) break;
    cursor = findParentKey(spec, cursor);
  }
  return path;
}

/** Index of `key` inside its parent's children array, or -1. */
export function childIndexOf(spec: Spec, key: string): number {
  const parentKey = findParentKey(spec, key);
  if (!parentKey) return -1;
  return (spec.elements[parentKey]?.children ?? []).indexOf(key);
}

export function insertElement(
  spec: Spec,
  request: {
    parentKey: string;
    type: string;
    props?: Record<string, unknown>;
    index?: number;
  },
): StructureResult | null {
  const parent = spec.elements[request.parentKey];
  if (!parent) return null;

  const key = uniqueKey(spec, request.type);
  const element: UIElement = {
    type: request.type,
    props: request.props ?? {},
    children: [],
  };
  const children = [...(parent.children ?? [])];
  const index =
    request.index === undefined
      ? children.length
      : Math.max(0, Math.min(request.index, children.length));
  children.splice(index, 0, key);

  return {
    key,
    spec: {
      ...spec,
      elements: {
        ...spec.elements,
        [key]: element,
        [request.parentKey]: { ...parent, children },
      },
    },
  };
}

/** Removes `key` and its whole subtree, unlinking it from the parent. */
export function removeElement(spec: Spec, key: string): Spec | null {
  if (key === spec.root || !spec.elements[key]) return null;
  const parentKey = findParentKey(spec, key);
  if (!parentKey) return null;

  const parent = spec.elements[parentKey];
  const elements: Spec["elements"] = { ...spec.elements };
  // The subtree may live in children or a slot — rebuild whichever holds it.
  if ((parent.children ?? []).includes(key)) {
    elements[parentKey] = {
      ...parent,
      children: (parent.children ?? []).filter((child) => child !== key),
    };
  } else {
    const slots: NonNullable<UIElement["slots"]> = { ...(parent.slots ?? {}) };
    for (const [name, slotKeys] of Object.entries(slots)) {
      slots[name] = slotKeys.filter((child) => child !== key);
    }
    elements[parentKey] = { ...parent, slots };
  }
  for (const deadKey of subtreeKeys(spec, key)) delete elements[deadKey];

  return { ...spec, elements };
}

/** Inserts a new container around `key`; the container inherits its slot. */
export function wrapElement(
  spec: Spec,
  key: string,
  containerType: string,
  props?: Record<string, unknown>,
): StructureResult | null {
  const element = spec.elements[key];
  if (!element) return null;

  const containerKey = uniqueKey(spec, containerType);
  const container: UIElement = {
    type: containerType,
    props: props ?? {},
    children: [key],
  };

  if (key === spec.root) {
    return {
      key: containerKey,
      spec: {
        root: containerKey,
        elements: { ...spec.elements, [containerKey]: container },
      },
    };
  }

  const parentKey = findParentKey(spec, key);
  if (!parentKey) return null;
  const parent = spec.elements[parentKey];
  const elements: Spec["elements"] = {
    ...spec.elements,
    [containerKey]: container,
  };

  if ((parent.children ?? []).includes(key)) {
    const children = [...(parent.children ?? [])];
    children[children.indexOf(key)] = containerKey;
    elements[parentKey] = { ...parent, children };
  } else {
    const slots: NonNullable<UIElement["slots"]> = { ...(parent.slots ?? {}) };
    for (const [name, slotKeys] of Object.entries(slots)) {
      const index = slotKeys.indexOf(key);
      if (index !== -1) {
        slots[name] = [...slotKeys];
        slots[name][index] = containerKey;
      }
    }
    elements[parentKey] = { ...parent, slots };
  }

  return { key: containerKey, spec: { ...spec, elements } };
}

/**
 * Dissolves a container, splicing its children into the parent's slot at the
 * container's position. Root unwrap requires exactly one child (a Spec has a
 * single root). Containers that route content through slots are flattened too.
 */
export function unwrapElement(spec: Spec, key: string): Spec | null {
  const element = spec.elements[key];
  if (!element) return null;
  const inner = [...(element.children ?? []), ...flattenSlots(element)];

  if (key === spec.root) {
    if (inner.length !== 1) return null;
    const nextRoot = inner[0];
    const elements: Spec["elements"] = { ...spec.elements };
    delete elements[key];
    return { ...spec, root: nextRoot, elements };
  }

  const parentKey = findParentKey(spec, key);
  if (!parentKey) return null;
  const parent = spec.elements[parentKey];
  const elements: Spec["elements"] = { ...spec.elements };
  delete elements[key];

  if ((parent.children ?? []).includes(key)) {
    const children = [...(parent.children ?? [])];
    children.splice(children.indexOf(key), 1, ...inner);
    elements[parentKey] = { ...parent, children };
  } else {
    const slots: NonNullable<UIElement["slots"]> = { ...(parent.slots ?? {}) };
    for (const [name, slotKeys] of Object.entries(slots)) {
      const index = slotKeys.indexOf(key);
      if (index !== -1) {
        slots[name] = [...slotKeys];
        slots[name].splice(index, 1, ...inner);
      }
    }
    elements[parentKey] = { ...parent, slots };
  }

  return { ...spec, elements };
}

function flattenSlots(element: UIElement): string[] {
  return Object.values(element.slots ?? {}).flat();
}

/** Reorders `key` among its siblings; returns null at the boundary. */
export function moveSibling(
  spec: Spec,
  key: string,
  direction: MoveDirection,
): Spec | null {
  const parentKey = findParentKey(spec, key);
  if (!parentKey) return null;
  const parent = spec.elements[parentKey];
  const children = [...(parent.children ?? [])];
  const index = children.indexOf(key);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= children.length) return null;
  children[index] = children[target];
  children[target] = key;
  return {
    ...spec,
    elements: {
      ...spec.elements,
      [parentKey]: { ...parent, children },
    },
  };
}

/**
 * Maps a hover zone (from canvas hit-testing) to a concrete move request.
 * `index` is expressed against the target's `children` as currently rendered;
 * `moveElement` corrects it when the source and target share a parent.
 * Returns null for: unknown keys, non-container "inside", slot children as
 * before/after anchors, and any target inside the dragged subtree (cycle).
 */
export function resolveMoveTarget(
  spec: Spec,
  request: { key: string; hoverKey: string; zone: DropZone },
): MoveTarget | null {
  const dragged = spec.elements[request.key];
  const hover = spec.elements[request.hoverKey];
  if (!dragged || !hover) return null;

  let targetParentKey: string;
  let index: number;

  if (request.zone === DROP_ZONES.inside) {
    if (!isContainerType(hover.type)) return null;
    targetParentKey = request.hoverKey;
    index = (hover.children ?? []).length;
  } else {
    const parentKey = findParentKey(spec, request.hoverKey);
    if (!parentKey) return null;
    const siblings = spec.elements[parentKey]?.children ?? [];
    const hoverIndex = siblings.indexOf(request.hoverKey);
    // Slot children have no sibling position in `children` — no before/after.
    if (hoverIndex === -1) return null;
    targetParentKey = parentKey;
    index = request.zone === DROP_ZONES.before ? hoverIndex : hoverIndex + 1;
  }

  if (getAncestorPath(spec, targetParentKey).includes(request.key)) return null;
  return { key: request.key, targetParentKey, index };
}

/**
 * Moves `key` (with its subtree) from wherever it currently lives — `children`
 * or a named slot — into `targetParentKey.children` at `index`. A same-parent
 * `index` refers to the array before removal and is corrected internally;
 * a no-op landing position and every guard failure return null.
 */
export function moveElement(spec: Spec, request: MoveTarget): Spec | null {
  const { key, targetParentKey } = request;
  if (key === spec.root) return null;
  if (!spec.elements[key] || !spec.elements[targetParentKey]) return null;
  if (getAncestorPath(spec, targetParentKey).includes(key)) return null;

  const sourceParentKey = findParentKey(spec, key);
  if (!sourceParentKey) return null;
  const sourceParent = spec.elements[sourceParentKey];
  if (!sourceParent) return null;

  const sourceSlot = Object.entries(sourceParent.slots ?? {}).find(
    ([, slotKeys]) => slotKeys.includes(key),
  )?.[0];
  const inChildren = (sourceParent.children ?? []).includes(key);
  if (!inChildren && sourceSlot === undefined) return null;

  const removalIndex = inChildren
    ? (sourceParent.children ?? []).indexOf(key)
    : -1;
  let index = request.index;
  if (
    sourceParentKey === targetParentKey &&
    inChildren &&
    removalIndex < index
  ) {
    index -= 1;
  }

  const elements: Spec["elements"] = { ...spec.elements };
  if (inChildren) {
    elements[sourceParentKey] = {
      ...sourceParent,
      children: (sourceParent.children ?? []).filter((child) => child !== key),
    };
  } else {
    const slots: NonNullable<UIElement["slots"]> = {
      ...(sourceParent.slots ?? {}),
    };
    slots[sourceSlot as string] = (slots[sourceSlot as string] ?? []).filter(
      (child) => child !== key,
    );
    elements[sourceParentKey] = { ...sourceParent, slots };
  }

  if (
    sourceParentKey === targetParentKey &&
    inChildren &&
    index === removalIndex
  ) {
    return null;
  }

  // Re-read the target: source and target may be the same element.
  const nextTarget = elements[targetParentKey];
  if (!nextTarget) return null;
  const children = [...(nextTarget.children ?? [])];
  children.splice(Math.max(0, Math.min(index, children.length)), 0, key);
  elements[targetParentKey] = { ...nextTarget, children };

  return { ...spec, elements };
}

/**
 * Copies `key` and its subtree with fresh keys, placed right after the
 * original. Duplicating the root is not supported (no parent to attach to).
 */
export function duplicateElement(
  spec: Spec,
  key: string,
): StructureResult | null {
  if (key === spec.root || !spec.elements[key]) return null;
  const parentKey = findParentKey(spec, key);
  if (!parentKey) return null;

  const keyMap = new Map<string, string>();
  for (const member of subtreeKeys(spec, key)) {
    keyMap.set(member, uniqueKeyFor(spec, spec.elements[member].type, keyMap));
  }

  const elements: Spec["elements"] = { ...spec.elements };
  for (const member of subtreeKeys(spec, key)) {
    const source = spec.elements[member];
    const clone: UIElement = {
      ...source,
      children: (source.children ?? []).map(
        (child) => keyMap.get(child) ?? child,
      ),
      ...(source.slots
        ? {
            slots: Object.fromEntries(
              Object.entries(source.slots).map(([name, slotKeys]) => [
                name,
                slotKeys.map((child) => keyMap.get(child) ?? child),
              ]),
            ),
          }
        : {}),
    };
    elements[keyMap.get(member) ?? member] = clone;
  }

  const parent = spec.elements[parentKey];
  const newKey = keyMap.get(key) ?? key;
  if ((parent.children ?? []).includes(key)) {
    const children = [...(parent.children ?? [])];
    children.splice(children.indexOf(key) + 1, 0, newKey);
    elements[parentKey] = { ...parent, children };
  } else {
    const slots: NonNullable<UIElement["slots"]> = { ...(parent.slots ?? {}) };
    for (const [name, slotKeys] of Object.entries(slots)) {
      const index = slotKeys.indexOf(key);
      if (index !== -1) {
        slots[name] = [...slotKeys];
        slots[name].splice(index + 1, 0, newKey);
      }
    }
    elements[parentKey] = { ...parent, slots };
  }

  return { key: newKey, spec: { ...spec, elements } };
}

function uniqueKeyFor(
  spec: Spec,
  type: string,
  reserved: Map<string, string>,
): string {
  const base = kebabCase(type) || "element";
  for (let index = 1; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (
      !spec.elements[candidate] &&
      ![...reserved.values()].includes(candidate)
    ) {
      return candidate;
    }
  }
}

export function structureRevisionLabel(
  op: StructureOp,
  detail?: string,
): string {
  const suffix = detail ? `:${op}:${detail}` : `:${op}`;
  return `${REVISION_LABELS.structure}${suffix}`;
}
