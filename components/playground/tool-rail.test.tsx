import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/lib/i18n/locale/en.json";
import { ToolRail } from "@/components/playground/tool-rail";
import type { ContentLanguageSwitcherProps } from "@/components/content-language-switcher";

const LABEL = en.editor.contentLang.title;

function contentLangProps(
  overrides: Partial<ContentLanguageSwitcherProps> = {},
): ContentLanguageSwitcherProps {
  return {
    languages: ["en", "es"],
    value: "es",
    seed: "en",
    missingByTag: new Map(),
    onChange: () => {},
    onTranslateMissing: () => {},
    onRevertToSource: () => {},
    canRevert: false,
    onAddLanguage: () => {},
    ...overrides,
  };
}

function renderRail(contentLang: ContentLanguageSwitcherProps | null): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <ToolRail
        pickMode={false}
        dndMode={false}
        xrayMode={false}
        onTogglePick={() => {}}
        onToggleDnd={() => {}}
        onToggleXray={() => {}}
        contentLang={contentLang}
        onClear={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

describe("ToolRail — spec language control (plan rev 3)", () => {
  test("shows the current content language on the trigger, not an icon", () => {
    const markup = renderRail(contentLangProps());
    // The trigger reads as the spec's language: current tag as text…
    expect(markup).toContain(">es<");
    // …under the stable accessible name the journeys target.
    expect(markup).toContain(`aria-label="${LABEL}"`);
    // The pre-rev-3 standalone "Add language…" icon button is gone — the
    // action lives inside the popover rows (closed in static markup).
    expect(markup).not.toContain(en.editor.contentLang.add);
    // Rail tools stay put.
    expect(markup).toContain(en.editor.pick);
    expect(markup).toContain(en.playground.clear);
  });

  test("omits the language control when no spec props are wired", () => {
    const markup = renderRail(null);
    expect(markup).not.toContain(`aria-label="${LABEL}"`);
    expect(markup).not.toContain(">es<");
    // The rail itself still renders its tools.
    expect(markup).toContain(en.editor.pick);
  });
});
