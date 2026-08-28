export interface Finding {
  file: string;
  line: number;
  message: string;
  score: number;
}

/** The one permitted side effect: an injected LLM call. */
export interface LLMCall {
  complete(prompt: string): Promise<string>;
}

export interface PipelineInput {
  diff: string;
  promptPath: string;
  llm: LLMCall;
}
