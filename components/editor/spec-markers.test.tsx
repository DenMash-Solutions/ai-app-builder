import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/lib/i18n/locale/en.json";
import { SpecMarkers } from "@/components/editor/spec-markers";
import { ELEMENT_MARKERS } from "@/lib/editor/markers";

function renderMarkers(
  markers: Parameters<typeof SpecMarkers>[0]["markers"],
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SpecMarkers markers={markers} />
    </NextIntlClientProvider>,
  );
}

describe("SpecMarkers", () => {
  test("renders nothing without markers", () => {
    expect(renderMarkers([])).toBe("");
  });

  test("one chip per marker with stable data-marker attributes", () => {
    const html = renderMarkers([
      ELEMENT_MARKERS.visible,
      ELEMENT_MARKERS.watch,
      ELEMENT_MARKERS.repeat,
    ]);
    expect(html).toContain('data-marker="visible"');
    expect(html).toContain('data-marker="watch"');
    expect(html).toContain('data-marker="repeat"');
    // localized copy from en.json
    expect(html).toContain(en.editor.markers.visible);
    expect(html).toContain(en.editor.markers.watch);
    expect(html).toContain(en.editor.markers.repeat);
  });

  test("chips carry their tooltip (a11y label)", () => {
    const html = renderMarkers([ELEMENT_MARKERS.visible]);
    expect(html).toContain(en.editor.markers.tipVisible);
  });
});
