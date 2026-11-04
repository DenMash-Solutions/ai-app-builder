"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { checkUsername, type UsernameIssue } from "@/lib/usernames";
import { claimUsername, fetchUsernameAvailable } from "@/lib/usernames-rpc";

/** Advisory check while typing (decision 3). The claim is the authority, so a
 *  debounce only needs to be long enough to avoid a request per keystroke. */
const CHECK_DEBOUNCE_MS = 350;

const AVAILABILITY = {
  idle: "idle",
  checking: "checking",
  available: "available",
  taken: "taken",
} as const;

type Availability = (typeof AVAILABILITY)[keyof typeof AVAILABILITY];

const BANNER_DISMISSED_FLAG = "genui-username-banner-dismissed";

function readBannerDismissed(): boolean {
  try {
    return window.localStorage.getItem(BANNER_DISMISSED_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Claim dialog (plan 068). Shared by the account menus and the shell banner —
 * the handle is written by the `claim_username` RPC because `profiles` has no
 * UPDATE policy (a self-update policy would let a user grant themselves admin).
 *
 * `ClaimForm` lives inside `DialogContent` on purpose: Radix unmounts the
 * content when closed, so every open starts from a clean form without a
 * reset effect.
 */
export function UsernameClaimDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <ClaimForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ClaimForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations();
  const { username: current, refreshProfile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [value, setValue] = useState(current ?? "");
  const [availability, setAvailability] = useState<Availability>(
    AVAILABILITY.idle,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const { username, issue } = checkUsername(value);
  const isCurrent = current !== null && username === current;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const issueText = (which: UsernameIssue) => t(`username.issues.${which}`);

  // The check runs from the change handler, not an effect: a handle that is
  // already the caller's own name needs no round trip, and a shape issue
  // never reaches the server.
  const onValueChange = (next: string) => {
    setValue(next);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    const mine = seq.current;

    const parsed = checkUsername(next);
    if (parsed.issue || parsed.username === current) {
      setAvailability(AVAILABILITY.idle);
      return;
    }

    setAvailability(AVAILABILITY.checking);
    timer.current = setTimeout(() => {
      void fetchUsernameAvailable(supabase, parsed.username).then(
        (available) => {
          if (seq.current !== mine) return;
          setAvailability(
            available === null
              ? AVAILABILITY.idle
              : available
                ? AVAILABILITY.available
                : AVAILABILITY.taken,
          );
        },
      );
    }, CHECK_DEBOUNCE_MS);
  };

  const message = issue
    ? issueText(issue)
    : availability === AVAILABILITY.taken
      ? issueText("taken")
      : availability === AVAILABILITY.available || isCurrent
        ? t("username.available")
        : null;
  const canSubmit =
    !submitting &&
    !issue &&
    (availability === AVAILABILITY.available || isCurrent);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await claimUsername(supabase, username);
    if (result.ok) {
      await refreshProfile();
      setSubmitting(false);
      onDone();
      return;
    }
    setError(
      result.issue ? issueText(result.issue) : t("username.errors.generic"),
    );
    setSubmitting(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {current ? t("username.claim.change") : t("username.claim.title")}
        </DialogTitle>
        <DialogDescription>{t("username.claim.description")}</DialogDescription>
      </DialogHeader>

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="username-claim-input" className="text-sm font-medium">
          {t("username.label")}
        </label>
        <Input
          id="username-claim-input"
          name="username"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("username.placeholder")}
          aria-invalid={issue !== null || availability === AVAILABILITY.taken}
          aria-describedby="username-claim-hint username-claim-status"
          onChange={(event) => onValueChange(event.target.value)}
        />
        <p id="username-claim-hint" className="text-xs text-muted-foreground">
          {t("username.hint")}
        </p>
        <p
          id="username-claim-status"
          aria-live="polite"
          className={
            issue || availability === AVAILABILITY.taken
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {error ?? message ?? ""}
        </p>

        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("username.cancel")}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {t("username.claim.submit")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/**
 * Dismissible prompt for signed-in accounts that have not claimed a handle.
 * Dismissal is remembered in this browser; the account menu keeps the entry
 * point either way.
 */
export function UsernameBanner() {
  const t = useTranslations();
  const { user, username, loading } = useAuth();
  const [dismissed, setDismissed] = useState(readBannerDismissed);
  const [open, setOpen] = useState(false);

  if (loading || !user || username !== null || dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(BANNER_DISMISSED_FLAG, "1");
    } catch {
      // Storage unavailable — dismissal lasts this session only.
    }
    setDismissed(true);
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2">
        <span className="text-sm font-medium">
          {t("username.claim.bannerTitle")}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {t("username.claim.bannerText")}
        </span>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t("username.claim.bannerCta")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("username.claim.bannerDismiss")}
          onClick={dismiss}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <UsernameClaimDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
