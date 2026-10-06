import type { Spec } from "@json-render/core";
import type { InstanceChain } from "@/lib/editor";

/**
 * Repeat scopes the wrapper sits inside (outermost → innermost), expressed as
 * DOM positions within each container instance. Mirrors `RepeatChildren`:
 * under one container instance, the same-key wrappers in document order map
 * 1:1 to its rendered items.
 */
export function computeInstanceChain(
  spec: Spec,
  wrapper: Element,
): InstanceChain {
  const key = wrapper.getAttribute("data-jr-key");
  if (key === null) return [];
  const levels: InstanceChain = [];
  let node: Element | null = wrapper;
  while (node !== null) {
    const parent: Element | null =
      node.parentElement?.closest("[data-jr-key]") ?? null;
    if (parent === null) break;
    const containerKey = parent.getAttribute("data-jr-key");
    if (containerKey !== null && spec.elements[containerKey]?.repeat) {
      const instances = Array.from(
        parent.querySelectorAll<HTMLElement>("[data-jr-key]"),
      ).filter((candidate) => candidate.getAttribute("data-jr-key") === key);
      const domIndex = instances.indexOf(wrapper as HTMLElement);
      if (domIndex >= 0) levels.unshift({ containerKey, domIndex });
    }
    node = parent;
  }
  return levels;
}

export function chainsEqual(a: InstanceChain, b: InstanceChain): boolean {
  return (
    a.length === b.length &&
    a.every(
      (level, index) =>
        level.containerKey === b[index].containerKey &&
        level.domIndex === b[index].domIndex,
    )
  );
}

/**
 * Wrapper element for `key` matching `chain`; an empty chain selects the
 * first instance (template-level selection).
 */
export function findWrapperForChain(
  container: HTMLElement,
  spec: Spec,
  key: string,
  chain: InstanceChain,
): HTMLElement | null {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>("[data-jr-key]"),
  ).filter((candidate) => candidate.getAttribute("data-jr-key") === key);
  if (chain.length === 0) return candidates[0] ?? null;
  return (
    candidates.find((candidate) =>
      chainsEqual(computeInstanceChain(spec, candidate), chain),
    ) ?? null
  );
}
