/**
 * Review Loop Configuration Layer (config/reviewLoopConfig.js)
 * 
 * Provides customizable configuration for host projects with safe defaults.
 * Allows decoupling project-specific conventions (test commands, documentation paths,
 * label names, template locations) from the plugin engine.
 */

import fs from 'fs';
import path from 'path';

export const DEFAULT_CONFIG = Object.freeze({
  /**
   * Additional test commands that are explicitly declared as non-interactive
   * (e.g. ['npm test', 'pnpm test:run', 'cargo test', 'pytest']).
   */
  allowedTestCommands: [],

  /**
   * Directory where issue specification documents are stored.
   */
  issuesDir: 'docs/issues',

  /**
   * Directory where standard templates are stored relative to plugin or project.
   */
  templatesDir: 'templates',

  /**
   * GitHub Issue labels that indicate Definition of Ready (DoR).
   */
  readyLabels: ['status: ready', 'status: in-progress'],

  /**
   * Directory where Architecture Decision Records (ADRs) are stored.
   */
  adrDir: 'docs/adr',

  /**
   * File path of the single-source-of-truth architecture overview.
   */
  ssotFile: 'docs/architecture_overview.md',

  /**
   * Required specification documents for the 4-axis documentation standard.
   */
  requiredAxisDocs: ['issue.md', 'pre_verification.md', 'plan.md', 'walkthrough.md'],
});

const CONFIG_CANDIDATE_PATHS = [
  'review-loop.config.json',
  path.join('.agents', 'review-loop.config.json'),
  '.review-loop.json',
];

/**
 * Resolves the configuration file path if it exists in the project root.
 */
export function resolveConfigPath(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') return null;

  for (const relPath of CONFIG_CANDIDATE_PATHS) {
    const fullPath = path.resolve(projectRoot, relPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Loads configuration for the given project root, merging it with DEFAULT_CONFIG.
 */
export function loadConfig(projectRoot) {
  const configPath = resolveConfigPath(projectRoot);
  if (!configPath) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_CONFIG };
    }

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      allowedTestCommands: Array.isArray(parsed.allowedTestCommands)
        ? parsed.allowedTestCommands
        : DEFAULT_CONFIG.allowedTestCommands,
      readyLabels: Array.isArray(parsed.readyLabels)
        ? parsed.readyLabels
        : DEFAULT_CONFIG.readyLabels,
      requiredAxisDocs: Array.isArray(parsed.requiredAxisDocs)
        ? parsed.requiredAxisDocs
        : DEFAULT_CONFIG.requiredAxisDocs,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
