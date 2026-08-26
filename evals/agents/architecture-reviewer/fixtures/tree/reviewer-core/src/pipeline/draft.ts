import type { Finding, LLMCall, PipelineInput } from "./types.js";

export async function draftFindings(input: PipelineInput, llm: LLMCall): Promise<Finding[]> {
  const text = await llm.complete(input.diff);
  return parseFindings(text);
}

function parseFindings(text: string): Finding[] {
  try {
    return JSON.parse(text) as Finding[];
  } catch {
    return [];
  }
}
