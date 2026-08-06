import { SkillDetailView } from "./_components/SkillDetailView";

/* Route: /skills/:id (Skill editor, L02). Thin route entry — loading, the
   header and the 5-tab editor are colocated under _components/. */
export default function SkillDetailPage() {
  return <SkillDetailView />;
}
