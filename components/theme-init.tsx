"use client";

import { THEME_STORAGE_KEY, THEMES } from "@/lib/theme";

// Applies the persisted theme before first paint so dark users never see a
// light flash. Rendered as `text/javascript` on the server (so the browser
// executes it while parsing) and `text/plain` on the client (React never
// executes scripts it creates, and treats data blocks as safe to render).
const THEME_INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})===${JSON.stringify(THEMES.dark)})document.documentElement.classList.add(${JSON.stringify(
  THEMES.dark,
)})}catch{}`;

export function ThemeInit() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
