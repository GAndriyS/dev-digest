import { SkillSelectPrompt } from "./_components/SkillSelectPrompt";

/* Route: /skills (Skills Lab, L05). The left column (list) and chrome live in
   the layout — this is only the right column's content until a skill is
   chosen. Selecting a card navigates to /skills/:id, which the [id] route's
   own page.tsx renders into the same slot. */
export default function SkillsPage() {
  return <SkillSelectPrompt />;
}
