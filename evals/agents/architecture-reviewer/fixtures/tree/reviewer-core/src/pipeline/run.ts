import type { PipelineInput, Finding } from "./types.js";
import { draftFindings } from "./draft.js";
import { dedupe } from "./dedupe.js";
import { groundFindings } from "./ground.js";

export async function runPipeline(input: PipelineInput): Promise<Finding[]> {
  const llm = input.llm;
  const drafted = await draftFindings(input, llm);
  const deduped = dedupe(drafted);
  const grounded = await groundFindings(deduped, input.diff);
  return grounded;
}
