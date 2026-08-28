export interface BlastRow {
  id: string;
  score: number;
}

export function summarize(rows: BlastRow[]) {
  return rows.map((r) => ({ id: r.id, score: r.score }));
}
