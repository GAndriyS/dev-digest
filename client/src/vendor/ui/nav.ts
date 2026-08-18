/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

/* DECLARED VENDOR UPDATE (L02, Skills Lab; extended L03, Conventions; L05,
   Project Context).
   `src/vendor/ui` is normally fixed upstream and re-vendored; this NAV table is
   edited in place on purpose, because the Skills entry has no other home and
   everything downstream already expects it (`activeKeyFor('/skills')`,
   `shell.json` `nav.skills`, and both the command palette and the g-chord, which
   derive from NAV). The edit is DATA ONLY — no structural change to this module
   — and it is declared to the reviewer by a `Vendor-update:` line in the PR
   body, which is what lets `scripts/pr-gate-ci.mjs` accept it.

   L03 adds the Conventions entry on the same terms: `activeKeyFor` already maps
   `/conventions` and `shell.json` already carries `nav.conventions`, so the NAV
   row is the only thing that was missing.

   L05 adds Project Context the same way: `activeKeyFor` already maps `/context`
   and `shell.json` already carries `nav.context` — again, the NAV row is the
   only thing that was missing. It goes in WORKSPACE next to Pull Requests
   (repo-scoped, `:repoId`-templated), not SKILLS LAB. */
export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      { key: "context", label: "Project Context", icon: "FileText", href: "/repos/:repoId/context", gKey: "x" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g x", label: "Go to Project Context", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
