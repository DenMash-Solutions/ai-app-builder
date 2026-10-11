import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  REVISION_LABELS,
  canRedo,
  canUndo,
  commitRevision,
  createEntry,
  normalizeEntry,
  redoRevision,
  undoRevision,
} from "./history";
import type { HistoryEntry } from "./history";

const MAX_KEPT_REVISIONS = 10;

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: {
      root: {
        type: "Card",
        props: { title: heading },
        children: ["heading"],
      },
      heading: { type: "Heading", props: { text: heading } },
    },
  };
}

describe("createEntry", () => {
  test("creates a single-generation entry at head 0", () => {
    const entry = createEntry("draw a dashboard", makeSpec("v0"));

    expect(entry.head).toBe(0);
    expect(entry.revisions).toHaveLength(1);
    expect(entry.revisions[0].label).toBe(REVISION_LABELS.generate);
    expect(entry.prompt).toBe("draw a dashboard");
  });

  test("seeds the display name from the prompt and a unique slug", () => {
    const entry = createEntry("Clínica Dental Sonrisas", makeSpec("v0"));

    expect(entry.name).toBe("Clínica Dental Sonrisas");
    expect(entry.slug).toBe(
      `clinica-dental-sonrisas-${entry.id.replaceAll("-", "").slice(0, 8)}`,
    );
  });

  test("two entries from the same prompt get distinct slugs", () => {
    const first = createEntry("build a form", makeSpec("v0"));
    const second = createEntry("build a form", makeSpec("v0"));

    expect(first.slug).not.toBe(second.slug);
  });

  test("stores value-cloned snapshots immune to later mutation", () => {
    const source = makeSpec("Original");
    const entry = createEntry("prompt", source);

    source.elements.heading.props.text = "Mutated";

    expect(entry.spec.elements.heading.props.text).toBe("Original");
    expect(entry.revisions[0].spec.elements.heading.props.text).toBe(
      "Original",
    );
    expect(entry.revisions[0].spec).not.toBe(source);
  });
});

describe("commitRevision", () => {
  test("appends a snapshot after the head", () => {
    const first = createEntry("prompt", makeSpec("v0"));
    const second = commitRevision(first, makeSpec("v1"), "property:text");

    expect(second.revisions).toHaveLength(2);
    expect(second.head).toBe(1);
    expect(second.spec.elements.heading.props.text).toBe("v1");
    expect(second.revisions[1].label).toBe("property:text");
  });

  test("drops the redo tail when committing after an undo", () => {
    const base = commitRevision(
      createEntry("prompt", makeSpec("v0")),
      makeSpec("v1"),
      "label-1",
    );
    const undone = undoRevision(base);
    const branched = commitRevision(undone, makeSpec("v2"), "label-2");

    expect(branched.revisions).toHaveLength(2);
    expect(branched.head).toBe(1);
    expect(branched.spec.elements.heading.props.text).toBe("v2");
    expect(canRedo(branched)).toBe(false);
  });

  test(`keeps at most ${MAX_KEPT_REVISIONS} revisions, dropping the oldest`, () => {
    let entry = createEntry("prompt", makeSpec("v0"));
    for (let i = 1; i <= 12; i += 1) {
      entry = commitRevision(entry, makeSpec(`v${i}`), `label-${i}`);
    }

    expect(entry.revisions).toHaveLength(MAX_KEPT_REVISIONS);
    expect(entry.head).toBe(MAX_KEPT_REVISIONS - 1);
    expect(entry.spec.elements.heading.props.text).toBe("v12");
    expect(entry.revisions[0].spec.elements.heading.props.text).toBe("v3");
  });

  test("clones the committed spec so later mutations cannot rewrite history", () => {
    const source = makeSpec("Original");
    const entry = commitRevision(
      createEntry("prompt", makeSpec("v0")),
      source,
      "label",
    );

    source.elements.heading.props.text = "Mutated";

    expect(entry.revisions[1].spec.elements.heading.props.text).toBe(
      "Original",
    );
    expect(entry.spec.elements.heading.props.text).toBe("Original");
  });
});

describe("undo/redo", () => {
  test("walks the head back and forward through revision specs", () => {
    const entry = commitRevision(
      commitRevision(
        createEntry("prompt", makeSpec("v0")),
        makeSpec("v1"),
        "a",
      ),
      makeSpec("v2"),
      "b",
    );

    const oneBack = undoRevision(entry);
    expect(oneBack.head).toBe(1);
    expect(oneBack.spec.elements.heading.props.text).toBe("v1");

    const twoBack = undoRevision(oneBack);
    expect(twoBack.head).toBe(0);
    expect(twoBack.spec.elements.heading.props.text).toBe("v0");
    expect(canUndo(twoBack)).toBe(false);

    const redone = redoRevision(twoBack);
    expect(redone.head).toBe(1);
    expect(redone.spec.elements.heading.props.text).toBe("v1");
  });

  test("returns the entry unchanged at the history boundaries", () => {
    const oldest = createEntry("prompt", makeSpec("v0"));
    expect(undoRevision(oldest)).toBe(oldest);

    const newest = commitRevision(oldest, makeSpec("v1"), "label");
    expect(redoRevision(newest)).toBe(newest);
  });
});

describe("normalizeEntry", () => {
  test("back-fills name from prompt and slug from id for legacy entries", () => {
    const spec = makeSpec("v0");
    const legacy = {
      id: "00000000-0000-4000-8000-000000000000",
      prompt: "draw a dashboard",
      spec,
      head: 0,
      createdAt: 1,
    } as unknown as HistoryEntry;

    const normalized = normalizeEntry(legacy);

    expect(normalized.name).toBe("draw a dashboard");
    expect(normalized.slug).toBe(legacy.id);
  });

  test("keeps an existing custom name and slug", () => {
    const entry = {
      ...createEntry("prompt", makeSpec("v0")),
      name: "Clinical Dental Sonrisas",
      slug: "dental-sonrisas",
    };

    const normalized = normalizeEntry(entry);

    expect(normalized.name).toBe("Clinical Dental Sonrisas");
    expect(normalized.slug).toBe("dental-sonrisas");
  });
});
