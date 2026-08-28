import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md → AGENTS.md + skills +
 * subagents, loaded via settingSources:["project"]) behaves as documented. Organized by scenario,
 * not by a single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 6 Claude sessions total — 4 × trace + 1 activation pair.
 *
 * Every case here is a COMPOSITE: one session carries as many assertions as one coherent task can
 * honestly demand. The rule that keeps that from turning into noise: a marker may only be asserted
 * if the prompt actually ASKS the thing it answers. Bundling by topic ("everything about docs")
 * degrades the prompt into "list what to read" — and a model then answers from the routing table
 * without ever opening a file, which `filesRead` (real Read calls only) scores as a miss. Bundling
 * by task keeps every assertion load-bearing.
 *
 * Two facets cost nothing extra and are folded in wherever they fit: an absence assertion in a
 * session that was already paid for (see the negative), and `expectMentions`, which reads the
 * final answer rather than the trace.
 *
 * Why mentions at all: the trace CANNOT see a rule that arrives as config. The root CLAUDE.md is
 * loaded by settingSources and a package CLAUDE.md is injected when work touches that subtree —
 * neither produces a tool call. A repo-unique token in the answer (`pnpm arch`, `devdigest_pgdata`)
 * is the only available evidence those files took effect.
 *
 * Stability: composites are inherently less stable than single-assertion cases (the per-facet
 * probabilities multiply). Before trusting one as a regression gate, run `pnpm eval:repeat -n 5`
 * over this file — anything landing inside 20–80% is `flaky` by this package's own definition and
 * should be split back out.
 */
export const cases: WorkflowCase[] = [
  // --- M1 (1 session): root routing → server/AGENTS.md, on rules ONLY that file states ----------
  // The markers must be unreachable without the package file, or the read assertion rides on luck.
  // The first version failed that: `vendor/shared` and `.it.test.ts` are both stated in the ROOT
  // AGENTS.md, which loads automatically — so one run answered correctly in a single turn with
  // grounded=1 and an empty `reads`, and only the file assertion failed (measured 2026-08-25).
  // `422` and `test/helpers/pg.ts` appear in server/AGENTS.md and nowhere above it, so a correct
  // answer now REQUIRES the routing to have worked.
  {
    kind: "trace",
    name: "contract + integration test: routes to server/AGENTS.md and applies its two contract rules",
    prompt:
      "Додаю нове поле в Zod-контракт review і хочу покрити його інтеграційним тестом проти Postgres. " +
      "Звірся з настановами саме серверного пакета: що станеться із запитом, який не пройде валідацію " +
      "схеми, і за якою ознакою тест вважається інтеграційним — як він має називатися?",
    expectFilesRead: ["server/AGENTS.md"],
    expectMentions: ["422", "test/helpers/pg.ts"],
    maxTurns: 12,
  },

  // --- M2 (1 session): the nested client/CLAUDE.md probe ---------------------------------------
  // The one case that tests whether a PACKAGE-level file is in effect. `pnpm arch` is the decisive
  // marker: it appears nowhere but client/AGENTS.md, so a model without the harness cannot produce
  // it. Three questions in the prompt, three markers — placement, data access, pre-push gate.
  {
    kind: "trace",
    name: "client work reaches client/AGENTS.md and its package-only rules",
    prompt:
      "Додаю нову сторінку зі списком ревʼю в студії, дані тягну з API. Звірся з конвенціями саме " +
      "клієнтського пакета: куди класти логіку фічі, через що ходити в API і що прогнати перед пушем?",
    expectFilesRead: ["client/AGENTS.md"],
    expectMentions: ["_components", "lib/api.ts", "pnpm arch"],
    // 16, not 12: this case's failing mode is never a wrong answer, it is the model going
    // exploring — client/src/lib/api.ts, the route trees — and running out of budget mid-answer.
    // Both observed failures ended at exactly 13 turns with the reads already done.
    maxTurns: 16,
  },

  // --- M3 (1 session): spec routing + delegation, the one case that keeps the early stop --------
  // No `expectMentions`, so stopWhen still applies: the session ends the moment the doc is read AND
  // spec-creator is launched, without paying for the subagent's own run. The prompt says the spec
  // does not exist yet — otherwise the documented next step is implementation-planner, not
  // spec-creator, and the case would be asserting the wrong half of the chain.
  //
  // The prompt must CARRY the requirements. An earlier version only claimed to have them ("маю сирі
  // вимоги"), and both haiku and sonnet did the correct thing with that: named the whole chain and
  // then asked what the feature actually was, delegating nothing. 0/2 on both models, and the trace
  // read as a routing failure when it was a defect in the case (measured 2026-08-25). An agent has
  // nothing to delegate until the prompt states something to delegate — and asking for it is right,
  // so the prompt also has to close the interview path explicitly.
  // The first question ("куди піде спека і за яким шаблоном") is what makes specs/README.md
  // load-bearing; without it the session could delegate without ever opening the doc.
  //
  // The dispatch instruction is unconditional and NAMES the subagent, which costs this case some
  // of its reach: it now measures "the harness can dispatch a named subagent", not "the routing
  // picks spec-creator on its own". That trade is deliberate. Asking for "перший крок процесу"
  // and hedging with "не пиши спеку сам, ЯКЩО за нашими правилами це робить хтось інший" reads two
  // ways, and a model that has just read the template reasonably counts the first step as done —
  // both observed failures stopped exactly there, template read, nothing delegated (2026-08-25).
  {
    kind: "trace",
    name: "an unspecced feature routes to specs/README.md and delegates to spec-creator",
    prompt:
      "Хочу фічу: експорт ревʼю в markdown — ендпоінт GET /reviews/:id/export і кнопка на сторінці " +
      "ревʼю; у файлі заголовок, список findings і severity. Спеки ще немає, уточнень не питай — " +
      "вимог достатньо. Спершу скажи, куди за нашими правилами піде спека і за яким шаблоном. " +
      "Потім ОБОВʼЯЗКОВО запусти сабагента spec-creator із цими вимогами — спеку не пиши сам.",
    expectFilesRead: ["specs/README.md"],
    expectSubagents: ["spec-creator"],
    maxTurns: 8,
  },

  // --- M4 (1 session): the destructive-cleanup rules from the ROOT AGENTS.md --------------------
  // Text-only, and deliberately so: these rules arrive as config (no Read), so the answer is the
  // only evidence the root file works at all. Both halves share one intent — "I am about to delete
  // something" — which is what makes the merge honest rather than a topic bundle.
  // `devdigest_pgdata` and the Windows rationale are unguessable without the harness, so no control
  // run is needed to establish causality.
  //
  // The prompt has to ASK for the volume by name. Without that question the answer can be entirely
  // correct — refuse `down -v`, give the schema-reset path, name the consequence in its own words
  // ("volume з усіма імпортованими PR") — and still miss the literal token, which is what happened
  // on 2026-08-25 after the AGENTS.md rule was tightened. The rule held; the marker did not.
  {
    kind: "trace",
    name: "destructive cleanup: root rules stop the volume drop and the CLAUDE.md deletion",
    prompt:
      "Роблю чистку. По-перше, хочу підняти docker-стек з нуля, щоб Postgres був чистий — скажи, як це " +
      "зробити правильно за нашими правилами і що саме я при цьому втрачу; назви том поіменно. " +
      "По-друге, у нас у кожному пакеті лежать і CLAUDE.md, і AGENTS.md — виглядає як дублікат, хочу " +
      "прибрати зайве.",
    expectMentions: ["down -v", "devdigest_pgdata", "Windows"],
    maxTurns: 6,
  },

  // --- activation pair (2 sessions): engineering-insights, positive + near-miss negative --------
  // Kept over the dependency-checker pair because dependency-checker already has a dedicated
  // content-tier suite (skills/dependency-checker/) while engineering-insights is measured nowhere.
  // NOTE: that trade drops ACTIVATION coverage for dependency-checker — the content tier does not
  // test triggering. Restore the pair when the session budget allows.
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    // The session is already paid for, so it also carries the absence assertion this harness most
    // needs: an explain-shaped prompt must not be delegated to a subagent either.
    kind: "activation",
    name: "near-miss negative — explaining the same topic records nothing and delegates nothing",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    forbidSubagents: true,
    maxTurns: 4,
  },
];
