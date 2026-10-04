import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, DEFAULT_CONFIG, resolveConfigPath } from '../config/reviewLoopConfig.js';

describe('Review Loop Config Layer (config/reviewLoopConfig.js)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-config-test-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('returns default configuration when no config file exists', () => {
    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.issuesDir).toBe('docs/issues');
    expect(config.readyLabels).toContain('status: ready');
  });

  it('loads and merges configuration from .agents/review-loop.config.json', () => {
    const agentsDir = path.join(tempDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const configPath = path.join(agentsDir, 'review-loop.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      allowedTestCommands: ['npm test', 'pnpm test:run'],
      issuesDir: 'spec/issues',
    }), 'utf8');

    const config = loadConfig(tempDir);
    expect(config.allowedTestCommands).toEqual(['npm test', 'pnpm test:run']);
    expect(config.issuesDir).toBe('spec/issues');
    // Default values are preserved for unspecified fields
    expect(config.readyLabels).toEqual(DEFAULT_CONFIG.readyLabels);
  });

  it('loads configuration from root review-loop.config.json with priority', () => {
    const rootConfig = path.join(tempDir, 'review-loop.config.json');
    fs.writeFileSync(rootConfig, JSON.stringify({
      issuesDir: 'my-issues',
    }), 'utf8');

    const config = loadConfig(tempDir);
    expect(config.issuesDir).toBe('my-issues');
  });

  it('handles malformed config JSON gracefully by falling back to default', () => {
    const rootConfig = path.join(tempDir, 'review-loop.config.json');
    fs.writeFileSync(rootConfig, '{ invalid json ', 'utf8');

    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('resolves config file path accurately', () => {
    expect(resolveConfigPath(tempDir)).toBeNull();

    const configPath = path.join(tempDir, 'review-loop.config.json');
    fs.writeFileSync(configPath, '{}', 'utf8');
    expect(resolveConfigPath(tempDir)).toBe(configPath);
  });
});
