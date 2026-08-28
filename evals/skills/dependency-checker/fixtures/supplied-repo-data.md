Here is the dependency data, already collected. Treat it as the complete fact base and
work from it directly — there is no shell access on this machine.

There is also nowhere to write a file: reply with the report itself. Anything you would
normally save under docs/ has to come back in your answer, in full.

## Manifests

server/package.json
  dependencies:    fastify@5.1.0, drizzle-orm@0.36.0, zod@^3.24.1, postgres@3.4.5, esbuild@0.24.0, figlet@1.8.0
  devDependencies: vitest@^2.1.8, typescript@^5.7.2, pino-pretty@13.0.0
  scripts:         { "build": "esbuild src/index.ts --bundle --outfile=dist/server.js",
                     "test": "vitest run", "typecheck": "tsc --noEmit" }

client/package.json
  dependencies:    next@15.0.3, react@19.0.0, react-dom@19.0.0, zod@^3.24.1, puppeteer@23.9.0
  devDependencies: vitest@^2.1.8, typescript@^5.7.2
  scripts:         { "test": "vitest run", "typecheck": "tsc --noEmit" }

reviewer-core/package.json
  dependencies:    zod@^3.24.1, openai@4.77.0
  devDependencies: vitest@^2.1.8, typescript@^5.7.2
  scripts:         { "test": "vitest run", "build": "tsc --noEmit" }

mcp/package.json
  dependencies:    @modelcontextprotocol/sdk@1.12.0, zod@^4.1.0
  devDependencies: vitest@^2.1.8, typescript@^5.7.2
  scripts:         { "test": "vitest run", "typecheck": "tsc --noEmit" }

e2e/package.json
  dependencies:    (none)
  devDependencies: playwright@1.49.0, typescript@^5.7.2
  scripts:         { "test": "playwright test" }

evals/package.json
  dependencies:    openai@4.77.0
  devDependencies: vitest@^2.1.8, typescript@^5.7.2, tsx@4.19.2
  scripts:         { "eval": "vitest run", "eval:quality": "tsx src/quality.ts" }

Lockfiles found: server/pnpm-lock.yaml · client/pnpm-lock.yaml · evals/pnpm-lock.yaml ·
reviewer-core/package-lock.json · e2e/package-lock.json · mcp/package-lock.json

## Resolved versions of libraries declared by more than one package

  zod           server 3.25.8 · client 3.25.8 · reviewer-core 3.25.8 · mcp 4.1.4
  vitest        server 2.1.9 · client 2.1.9 · reviewer-core 2.1.9 · mcp 2.1.9 · evals 2.1.9
  typescript    5.7.4 in all six packages
  openai        reviewer-core 4.77.3 · evals 4.77.3

## Measured install sizes (exclusive bytes on disk, MiB)

  client/node_modules/puppeteer                340.2   (browser download included)
  client/node_modules/next                     131.4
  e2e/node_modules/playwright                  210.0
  server/node_modules/esbuild                    9.6
  server/node_modules/drizzle-orm                8.1
  server/node_modules/fastify                    6.5
  server/node_modules/postgres                   1.2
  server/node_modules/pino-pretty                0.7
  server/node_modules/figlet                      0.1
  mcp/node_modules/@modelcontextprotocol/sdk     8.6
  typescript                                    23.6   per package, one copy in each of the six

  Per-package totals on disk (MiB):
    client 604.1 · e2e 232.7 · server 88.3 · mcp 79.0 · evals 71.5 · reviewer-core —

## Import scan — every import site found in source (node_modules excluded)

  server/src         fastify 14 · drizzle-orm 31 · zod 44 · postgres 2
  client/src         next 61 · react 140 · zod 12 · puppeteer 1
                       puppeteer site: client/src/lib/pdf/render-pdf.ts:8
  reviewer-core/src  zod 18 · openai 2
  mcp/src            @modelcontextprotocol/sdk 10 · zod 7
  evals/src          openai 1

  Declared packages with zero import sites in any src/ tree:
    esbuild · figlet · pino-pretty · vitest · typescript · tsx · playwright

## Cross-package import lines, verbatim

  server/src/modules/reviews/service.ts:6
    import { ReviewFinding } from "@devdigest/shared";
  reviewer-core/src/pipeline.ts:2
    import { ReviewFinding } from "@devdigest/shared";
  mcp/src/tools/findings.ts:3
    import { ReviewFinding } from "@devdigest/shared";
  mcp/src/tools/review.ts:4
    import { findReviewById } from "../../server/src/modules/reviews/repository.js";
  server/src/services/review-runner.ts:9
    import { runPipeline } from "@devdigest/reviewer-core";

## tsconfig.json "paths" per package

  server         "@devdigest/shared"        -> server/src/vendor/shared/index.ts
                 "@devdigest/reviewer-core" -> reviewer-core/src/index.ts
  reviewer-core  "@devdigest/shared"        -> server/src/vendor/shared/index.ts
  mcp            "@devdigest/shared"        -> server/src/vendor/shared/index.ts
  client         "@devdigest/shared"        -> client/src/vendor/shared/index.ts

  Alias import-site counts: server 97 · client 123 · reviewer-core 9 · mcp 5

## Source excerpts

  server/src/vendor/shared/index.ts:1
    import { z } from "zod";
    export const ReviewFinding = z.object({
      id: z.string().uuid(),
      severity: z.enum(["critical", "warning", "suggestion"]),
      body: z.string(),
    });
    export type ReviewFinding = z.infer<typeof ReviewFinding>;

  mcp/src/tools/findings.ts:11
    const parsed = ReviewFinding.array().parse(await res.json());

  server/src/logger.ts:22
    export const logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      transport: { target: "pino-pretty", options: { colorize: true } },
    });

  server/src/index.ts:1
    import Fastify from "fastify";
    import { reviewRoutes } from "./modules/reviews/routes.js";

  client/src/lib/pdf/render-pdf.ts:8
    import puppeteer from "puppeteer";

## Filesystem

  Directory listing of the repository root:
    .github/  client/  e2e/  evals/  mcp/  reviewer-core/  server/  README.md

  Each package directory contains its own node_modules/. There is no node_modules/ at the
  repository root.
