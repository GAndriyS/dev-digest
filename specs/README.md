# Specs — DevDigest

Cross-cutting specs: what we are building and what "done" means. Specs scoped to
a single package live in `<package>/specs/`.

One file per feature, named after the lesson that introduces it:
`L01-run-cost-badge.md`. `CLAUDE.md` links this directory, never individual
files — otherwise the map grows with every lesson and blows its line budget.

## Template

```markdown
# <Feature>

## Goal
One paragraph: what changes for the user, and why now.

## Acceptance criteria
- [ ] Observable, checkable statements — not implementation steps.

## Out of scope
What a reader might reasonably assume is included but is not.

## Touched surfaces
Packages and modules this reaches. Name the seams, not every file.
```

## Backlog

The starter deliberately omits these; each lesson adds one back.

| Lesson | Feature | Spec |
|--------|---------|------|
| L01 | Run cost badge · severity filter on findings | — |
| L02 | Skills in the product · conventions extractor | — |
| L03 | Intent layer · Smart Diff | — |
| L04 | `devdigest-mcp` server · Blast Radius | — |
| L05 | Project Context Folder · onboarding generator · PR Brief | — |
| L06 | Eval pipeline · secret/phantom gates · plan verifier · export to CI | — |
| L07 | Multi-agent review · run trace / live log · persistent memory | — |
| L08 | Plugin export/import · agent performance dashboard · weekly digest | — |

Fill the Spec column with a link when you write one.
