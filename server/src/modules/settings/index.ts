/**
 * settings module barrel — its published surface for other modules.
 *
 * Per-feature model selection is the one thing settings owns that another module
 * legitimately needs: a feature that calls an LLM must ask which provider+model
 * this workspace picked for it, and that answer lives in the settings table.
 * `feature-models.ts` itself stays private (it reaches into the settings rows);
 * what is published is the resolution, not the storage.
 *
 * The conventions extractor is the first caller — see
 * `modules/conventions/service.ts`.
 */
export {
  defaultFeatureModel,
  getFeatureModelOverride,
  resolveFeatureModel,
} from './feature-models.js';
