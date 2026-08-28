/**
 * Excerpt of server/src/platform/container.ts as it looks after the publisher
 * branch. Unrelated members are elided; everything shown is verbatim from the
 * branch, including the parts that were already there.
 */
import type {
  AuthProvider,
  Blast,
  CodeIndex,
  Embedder,
  GitClient,
  GitHubClient,
  LLMProvider,
  ProjectContext,
  RepoIntel,
  SecretsProvider,
  SlackClient,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SlackWebhookClient } from '../adapters/slack/slack.client.js';
import { ConfigError } from './errors.js';

export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  repoIntel?: RepoIntel;
  projectContext?: ProjectContext;
  blast?: Blast;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;

  private _github?: GitHubClient;
  private _embedder?: Embedder;
  private _slack?: SlackClient;
  private llmCache = new Map<string, LLMProvider>();

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /**
   * Slack client for digest delivery (L06). Lazy like the others: the workspace
   * may never configure Slack at all, and constructing it at boot would make a
   * missing token a startup failure instead of a feature that stays off.
   */
  async slack(): Promise<SlackClient> {
    if (this._slack) return this._slack;
    const token = await this.secrets.get('SLACK_BOT_TOKEN');
    if (!token) throw new ConfigError('SLACK_BOT_TOKEN is not configured');
    this._slack = new SlackWebhookClient(token, this.config.slackDefaultChannel);
    return this._slack;
  }

  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  async embedder(): Promise<Embedder> {
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
