"use client";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { HistoryEntry } from "@/lib/history";
import { formatRelativeTime } from "@/lib/history";

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: HistoryEntry[];
  activeId: string | null;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function HistoryDrawer({
  open,
  onOpenChange,
  entries,
  activeId,
  onSelect,
  onDelete,
  onClear,
}: HistoryDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="max-w-md">
        <DrawerHeader>
          <DrawerTitle>History</DrawerTitle>
          <DrawerDescription>
            Your last {entries.length} generations, stored in this browser.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No generations yet — create one to build your history.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <div
                    className={`group flex items-start gap-2 rounded-md border p-3 transition-colors ${
                      entry.id === activeId
                        ? "border-foreground bg-accent"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(entry)}
                      className="flex-1 cursor-pointer text-left"
                    >
                      <p className="line-clamp-2 text-sm font-medium">
                        {entry.prompt}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRelativeTime(entry.createdAt)}
                      </p>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Delete entry"
                      className="h-7 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => onDelete(entry.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DrawerClose>
          {entries.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onClear}
            >
              Clear all
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
