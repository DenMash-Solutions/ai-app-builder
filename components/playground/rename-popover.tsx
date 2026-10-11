"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isReservedSlug, isValidSlug, slugify } from "@/lib/slug";

interface RenamePopoverProps {
  entryId: string;
  name: string;
  slug: string;
  /** Slugs used by other entries — a hit here blocks the save. */
  takenSlugs: ReadonlySet<string>;
  onRename: (name: string, slug: string) => void;
  children: ReactNode;
}

/**
 * Name + slug editor for the active entry, anchored on the top-bar title.
 * The slug field auto-follows the name (slugified on each keystroke) until
 * the user edits it by hand, then stays decoupled — the classic CMS pattern.
 */
export function RenamePopover({
  entryId,
  name,
  slug,
  takenSlugs,
  onRename,
  children,
}: RenamePopoverProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [slugDraft, setSlugDraft] = useState(slug);
  const [slugDirty, setSlugDirty] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setNameDraft(name);
      setSlugDraft(slug);
      setSlugDirty(false);
    }
    setOpen(next);
  };

  const trimmedSlug = slugDraft.trim();
  const slugError =
    trimmedSlug === ""
      ? t("rename.errors.slugRequired")
      : isReservedSlug(trimmedSlug)
        ? t("rename.errors.slugReserved")
        : !isValidSlug(trimmedSlug)
          ? t("rename.errors.slugInvalid")
          : takenSlugs.has(trimmedSlug)
            ? t("rename.errors.slugTaken")
            : null;
  const canSave = nameDraft.trim() !== "" && slugError === null;

  const handleSave = () => {
    if (!canSave) return;
    onRename(nameDraft.trim(), trimmedSlug);
    setOpen(false);
  };

  const idSuffix = entryId.replaceAll("-", "").slice(0, 8);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        aria-label={t("rename.title")}
        className="w-80 space-y-3"
      >
        <div className="space-y-1.5">
          <label
            htmlFor={`rename-name-${idSuffix}`}
            className="text-sm font-medium"
          >
            {t("rename.name")}
          </label>
          <Input
            id={`rename-name-${idSuffix}`}
            value={nameDraft}
            onChange={(event) => {
              const value = event.target.value;
              setNameDraft(value);
              if (!slugDirty) setSlugDraft(slugify(value));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={`rename-slug-${idSuffix}`}
            className="text-sm font-medium"
          >
            {t("rename.slug")}
          </label>
          <Input
            id={`rename-slug-${idSuffix}`}
            value={slugDraft}
            aria-invalid={slugError !== null}
            onChange={(event) => {
              setSlugDraft(event.target.value);
              setSlugDirty(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
            }}
          />
          {slugError !== null && (
            <p role="alert" className="text-xs text-destructive">
              {slugError}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            {t("rename.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSave}
            onClick={handleSave}
          >
            {t("rename.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
