import { SkillsLabShell } from "./_components/SkillsLabShell";

/* Route: /skills and /skills/:id (Skills Lab, L05 master-detail). This layout
   persists across navigation between the two — the left column's list and its
   scroll position survive a selection instead of remounting with it. Thin
   entry — chrome, breadcrumbs, search, the add menu and the two-column split
   are colocated under _components/SkillsLabShell. */
export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return <SkillsLabShell>{children}</SkillsLabShell>;
}
