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

  it('resolves config file path accurately and follows candidate priority order', () => {
    expect(resolveConfigPath(tempDir)).toBeNull();

    const dotConfigPath = path.join(tempDir, '.review-loop.json');
    const agentsDir = path.join(tempDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentsConfigPath = path.join(agentsDir, 'review-loop.config.json');
    const rootConfigPath = path.join(tempDir, 'review-loop.config.json');

    // 1. Only .review-loop.json exists
    fs.writeFileSync(dotConfigPath, JSON.stringify({ issuesDir: 'dot-issues' }), 'utf8');
    expect(resolveConfigPath(tempDir)).toBe(dotConfigPath);
    expect(loadConfig(tempDir).issuesDir).toBe('dot-issues');

    // 2. Both .agents/review-loop.config.json and .review-loop.json exist -> .agents wins
    fs.writeFileSync(agentsConfigPath, JSON.stringify({ issuesDir: 'agents-issues' }), 'utf8');
    expect(resolveConfigPath(tempDir)).toBe(agentsConfigPath);
    expect(loadConfig(tempDir).issuesDir).toBe('agents-issues');

    // 3. Root review-loop.config.json exists -> root wins over all
    fs.writeFileSync(rootConfigPath, JSON.stringify({ issuesDir: 'root-issues' }), 'utf8');
    expect(resolveConfigPath(tempDir)).toBe(rootConfigPath);
    expect(loadConfig(tempDir).issuesDir).toBe('root-issues');
  });

  it('rejects dangerous relative paths with .. or absolute paths and falls back to default', () => {
    const rootConfig = path.join(tempDir, 'review-loop.config.json');
    fs.writeFileSync(rootConfig, JSON.stringify({
      issuesDir: '../dangerous/issues',
      adrDir: path.resolve(tempDir, 'abs/adr'),
      ssotFile: 'sub/../../secret.md',
    }), 'utf8');

    const config = loadConfig(tempDir);
    expect(config.issuesDir).toBe(DEFAULT_CONFIG.issuesDir);
    expect(config.adrDir).toBe(DEFAULT_CONFIG.adrDir);
    expect(config.ssotFile).toBe(DEFAULT_CONFIG.ssotFile);
  });

  it('rejects empty array for readyLabels and requiredAxisDocs and falls back to default', () => {
    const rootConfig = path.join(tempDir, 'review-loop.config.json');
    fs.writeFileSync(rootConfig, JSON.stringify({
      readyLabels: [],
      requiredAxisDocs: [],
    }), 'utf8');

    const config = loadConfig(tempDir);
    expect(config.readyLabels).toEqual(DEFAULT_CONFIG.readyLabels);
    expect(config.requiredAxisDocs).toEqual(DEFAULT_CONFIG.requiredAxisDocs);
  });
});
