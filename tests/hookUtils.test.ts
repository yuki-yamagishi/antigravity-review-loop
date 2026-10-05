import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findProjectRoot, findPluginRoot, findIssueDir } from '../hooks/hookUtils.js';

describe('Hook Utilities (hooks/hookUtils.js)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-utils-test-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('findProjectRoot', () => {
    it('identifies project root when both .git and package.json exist', () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');

      const subDir = path.join(tempDir, 'src/nested/dir');
      fs.mkdirSync(subDir, { recursive: true });

      const resolved = findProjectRoot(subDir);
      expect(resolved.toLowerCase()).toBe(tempDir.toLowerCase());
    });

    it('does not falsely treat a sub-package with only package.json as root in a monorepo', () => {
      // Root has .git and package.json
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"monorepo-root"}', 'utf8');

      // Sub-package has package.json only (no .git)
      const subPackageDir = path.join(tempDir, 'packages/core');
      fs.mkdirSync(subPackageDir, { recursive: true });
      fs.writeFileSync(path.join(subPackageDir, 'package.json'), '{"name":"core"}', 'utf8');

      const deepSubDir = path.join(subPackageDir, 'src/utils');
      fs.mkdirSync(deepSubDir, { recursive: true });

      // Should walk up to tempDir (which has both .git and package.json), not stop at subPackageDir
      const resolved = findProjectRoot(deepSubDir);
      expect(resolved.toLowerCase()).toBe(tempDir.toLowerCase());
    });

    it('skips .agents directory segment when searching upward', () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf8');

      // An .agents directory inside project with its own sub-files
      const agentsHookDir = path.join(tempDir, '.agents/plugins/my-plugin/hooks');
      fs.mkdirSync(agentsHookDir, { recursive: true });

      const resolved = findProjectRoot(agentsHookDir);
      expect(resolved.toLowerCase()).toBe(tempDir.toLowerCase());
    });

    it('identifies project root in non-Node projects (e.g. Python, Go, Rust) having .git without package.json', () => {
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), '[tool.poetry]\nname = "python-project"', 'utf8');

      const subDir = path.join(tempDir, 'src/mypackage/utils');
      fs.mkdirSync(subDir, { recursive: true });

      const resolved = findProjectRoot(subDir);
      expect(resolved.toLowerCase()).toBe(tempDir.toLowerCase());
    });
  });

  describe('findPluginRoot', () => {
    it('locates plugin root containing plugin.json', () => {
      const pluginDir = path.join(tempDir, 'plugins/review-loop');
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, 'plugin.json'), '{"name":"review-loop"}', 'utf8');

      const hooksDir = path.join(pluginDir, 'hooks/nested');
      fs.mkdirSync(hooksDir, { recursive: true });

      const resolved = findPluginRoot(hooksDir);
      expect(resolved.toLowerCase()).toBe(pluginDir.toLowerCase());
    });
  });

  describe('findIssueDir', () => {
    it('finds padded and raw issue directories', () => {
      const issuesDir = path.join(tempDir, 'docs/issues');
      fs.mkdirSync(path.join(issuesDir, 'ISSUE-005_feature_test'), { recursive: true });
      fs.mkdirSync(path.join(issuesDir, 'ISSUE-42_another_fix'), { recursive: true });

      expect(findIssueDir(issuesDir, 5)).toBe('ISSUE-005_feature_test');
      expect(findIssueDir(issuesDir, 42)).toBe('ISSUE-42_another_fix');
      expect(findIssueDir(issuesDir, 999)).toBeNull();
    });

    it('ignores plain files with matching prefix and selects directories only', () => {
      const issuesDir = path.join(tempDir, 'docs/issues');
      fs.mkdirSync(issuesDir, { recursive: true });

      // Create a plain file with matching prefix
      fs.writeFileSync(path.join(issuesDir, 'ISSUE-005.txt'), 'not a dir', 'utf8');
      // Create actual issue directory
      fs.mkdirSync(path.join(issuesDir, 'ISSUE-005_real_issue'), { recursive: true });

      expect(findIssueDir(issuesDir, 5)).toBe('ISSUE-005_real_issue');
    });
  });
});
