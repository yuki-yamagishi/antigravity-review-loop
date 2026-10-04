/**
 * Review Loop Configuration Layer (config/reviewLoopConfig.js)
 *
 * Every key below is consumed by a hook:
 * - allowedTestCommands -> hooks/safetyGuard.js
 * - issuesDir           -> hooks/branchDoRGate.js, hooks/prePrAuditGate.js
 * - readyLabels         -> hooks/branchDoRGate.js
 * - requiredAxisDocs    -> hooks/prePrAuditGate.js
 * - adrDir, ssotFile    -> hooks/prePrAuditGate.js
 *
 * Invalid values are rejected (fallback to the default for that key) and a warning is
 * written to stderr so misconfiguration is observable.
 */

import fs from 'fs';
import path from 'path';

const DEFAULTS = {
  allowedTestCommands: [],
  issuesDir: 'docs/issues',
  readyLabels: ['status: ready', 'status: in-progress'],
  adrDir: 'docs/adr',
  ssotFile: 'docs/architecture_overview.md',
  requiredAxisDocs: ['issue.md', 'pre_verification.md', 'plan.md', 'walkthrough.md'],
};

function cloneDefaults() {
  return {
    ...DEFAULTS,
    allowedTestCommands: [...DEFAULTS.allowedTestCommands],
    readyLabels: [...DEFAULTS.readyLabels],
    requiredAxisDocs: [...DEFAULTS.requiredAxisDocs],
  };
}

export const DEFAULT_CONFIG = Object.freeze(cloneDefaults());

const CONFIG_CANDIDATE_PATHS = [
  'review-loop.config.json',
  path.join('.agents', 'review-loop.config.json'),
  '.review-loop.json',
];

export const CONFIG_FILE_NAMES = Object.freeze(['review-loop.config.json', '.review-loop.json']);

function warn(message) {
  try {
    process.stderr.write(`[review-loop config] ${message}\n`);
  } catch {}
}

function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).includes('..')
  );
}

function isStringArray(value, { allowEmpty }) {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((v) => typeof v === 'string' && v.trim().length > 0)
  );
}

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
 * Validates a parsed config object and merges it over the defaults.
 * Unknown keys are ignored with a warning.
 */
export function mergeConfig(parsed) {
  const config = cloneDefaults();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warn('config root must be a JSON object; using defaults.');
    return config;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '$schema') continue;
    if (!(key in DEFAULTS)) {
      warn(`unknown key "${key}" ignored.`);
      continue;
    }
    let valid = false;
    if (key === 'allowedTestCommands') valid = isStringArray(value, { allowEmpty: true });
    else if (key === 'readyLabels' || key === 'requiredAxisDocs') valid = isStringArray(value, { allowEmpty: false });
    else valid = isSafeRelativePath(value);
    if (valid) {
      config[key] = Array.isArray(value) ? [...value] : value;
    } else {
      warn(`invalid value for "${key}"; using default.`);
    }
  }
  return config;
}

export function loadConfig(projectRoot) {
  const configPath = resolveConfigPath(projectRoot);
  if (!configPath) return cloneDefaults();
  try {
    return mergeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch (err) {
    warn(`failed to parse ${configPath}: ${err.message}; using defaults.`);
    return cloneDefaults();
  }
}
