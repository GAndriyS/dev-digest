# Docs — server

Deep dives scoped to the API. Cross-cutting docs live in `../docs/`.

**What belongs here:** design rationale for a module, adapter contracts and how
to add one, migration and indexing walkthroughs, performance notes — material
worth reading on demand but not worth carrying in every session.

**What does not:** the API map and DI flow (already in `README.md`), invariants
and rules (`AGENTS.md`), and anything the route schemas already state.

## Contents

_Empty for now._ First candidates:

- How to add an adapter behind the DI container
- The run lifecycle: queue → executor → SSE → persisted trace
- Working with the pgvector-backed tables
