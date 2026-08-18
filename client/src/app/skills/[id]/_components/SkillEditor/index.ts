export { SkillEditor } from "./SkillEditor";
// The shell needs the same "current tab" fallback the editor itself falls
// back to, so a freshly-selected skill (no ?tab= yet) opens on the same tab
// the editor would default to — one source of truth, not a duplicated literal.
export { DEFAULT_TAB } from "./constants";
