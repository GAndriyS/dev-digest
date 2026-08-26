/** Locale-neutral placeholder for a metric or cost the API reported as `null`
    (e.g. `citation_accuracy` when a batch produced zero raw findings, or a
    `cost_usd` recorded before cost tracking existed) — never "0%"/"$0",
    which would read as a real, bad result. Mirrors `NO_VALUE` in the agent
    editor's EvalsTab (`agents/[id]/_components/AgentEditor/_components/
    EvalsTab/constants.ts`) — duplicated locally rather than shared across
    route trees, per `frontend-ui-architecture`. */
export const NO_VALUE = "—";
