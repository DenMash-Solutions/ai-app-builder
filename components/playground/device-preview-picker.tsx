"use client";

import { useSyncExternalStore, useState } from "react";
import {
  Expand,
  Monitor,
  MonitorSmartphone,
  Ruler,
  Smartphone,
  Tablet,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEVICE_PRESET_ORDER,
  ZOOM_STEPS,
  clampDeviceSize,
  getDevicePreview,
  getServerDevicePreview,
  setDevicePreview,
  subscribeDevicePreview,
} from "@/lib/playground/device-preview";
import type { DevicePresetKey } from "@/lib/playground/device-preview";

const PRESET_ICONS: Record<DevicePresetKey, LucideIcon> = {
  responsive: Expand,
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  custom: Ruler,
};

/**
 * TopBar preset picker (plan 059 step 1): native radios (free keyboard
 * support) + custom W×H inputs. Custom inputs keep a draft while typing and
 * commit on blur/Enter — `draft ?? serialized` per the controlled-input-drafts
 * lesson, so re-renders never eat keystrokes.
 */
export function DevicePreviewPicker() {
  const t = useTranslations();
  const state = useSyncExternalStore(
    subscribeDevicePreview,
    getDevicePreview,
    getServerDevicePreview,
  );
  const [widthDraft, setWidthDraft] = useState<string | null>(null);
  const [heightDraft, setHeightDraft] = useState<string | null>(null);

  const widthValue = widthDraft ?? String(state.customWidth);
  const heightValue = heightDraft ?? String(state.customHeight);

  const commitWidth = () => {
    if (widthDraft === null) return;
    setDevicePreview({
      customWidth: clampDeviceSize(Number(widthDraft), state.customWidth),
    });
    setWidthDraft(null);
  };
  const commitHeight = () => {
    if (heightDraft === null) return;
    setDevicePreview({
      customHeight: clampDeviceSize(Number(heightDraft), state.customHeight),
    });
    setHeightDraft(null);
  };

  const isActive = state.preset !== "responsive";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("playground.devicePreview.open")}
          title={t("playground.devicePreview.open")}
          data-active={isActive || undefined}
          className="size-7 data-[active]:bg-accent data-[active]:text-accent-foreground"
        >
          <MonitorSmartphone aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <div
          role="radiogroup"
          aria-label={t("playground.devicePreview.label")}
          className="grid gap-0.5"
        >
          {DEVICE_PRESET_ORDER.map((key) => {
            const Icon = PRESET_ICONS[key];
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <input
                  type="radio"
                  name="device-preset"
                  className="accent-primary"
                  checked={state.preset === key}
                  onChange={() => setDevicePreview({ preset: key })}
                />
                <Icon
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                <span className="text-sm">
                  {t(`playground.devicePreview.${key}`)}
                </span>
              </label>
            );
          })}
        </div>
        {/* Zoom (step 2): fit (default) or a fixed percent — only while a
            frame is mounted; inline Responsive fills the window. */}
        {isActive && (
          <div className="mt-2 border-t pt-2">
            <div
              role="radiogroup"
              aria-label={t("playground.devicePreview.zoom")}
              className="flex flex-wrap gap-0.5"
            >
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent">
                <input
                  type="radio"
                  name="device-zoom"
                  className="accent-primary"
                  checked={state.zoom === null}
                  onChange={() => setDevicePreview({ zoom: null })}
                />
                <span className="text-sm">
                  {t("playground.devicePreview.zoomFit")}
                </span>
              </label>
              {ZOOM_STEPS.map((step) => (
                <label
                  key={step}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
                >
                  <input
                    type="radio"
                    name="device-zoom"
                    className="accent-primary"
                    checked={state.zoom === step}
                    onChange={() => setDevicePreview({ zoom: step })}
                  />
                  <span className="text-sm">{step}%</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {state.preset === "custom" && (
          <div className="mt-2 flex items-center gap-2 border-t pt-2">
            <label className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t("playground.devicePreview.customWidth")}
              </span>
              <Input
                type="number"
                name="device-width"
                inputMode="numeric"
                min={320}
                max={4096}
                value={widthValue}
                onChange={(event) => setWidthDraft(event.target.value)}
                onBlur={commitWidth}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitWidth();
                  }
                }}
                className="h-7 px-2 text-sm"
              />
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t("playground.devicePreview.customHeight")}
              </span>
              <Input
                type="number"
                name="device-height"
                inputMode="numeric"
                min={320}
                max={4096}
                value={heightValue}
                onChange={(event) => setHeightDraft(event.target.value)}
                onBlur={commitHeight}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitHeight();
                  }
                }}
                className="h-7 px-2 text-sm"
              />
            </label>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
