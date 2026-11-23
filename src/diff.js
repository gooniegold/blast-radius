import { execSync } from 'node:child_process';
import path from 'node:path';

const SUPPORTED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Check if directory is inside a git repository.
 * @param {string} cwd
 * @returns {boolean}
 */
export function isGitRepo(cwd = process.cwd()) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of staged files from git diff.
 * @param {string} cwd
 * @returns {string[]}
 */
export function getStagedFiles(cwd = process.cwd()) {
  if (!isGitRepo(cwd)) return [];
  try {
    const stdout = execSync('git diff --cached --name-only', { cwd, encoding: 'utf8' });
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => Boolean(line) && SUPPORTED_EXTS.some(ext => line.endsWith(ext)))
      .map(line => line.replace(/\\/g, '/'));
  } catch {
    return [];
  }
}

/**
 * Get list of unstaged modified files from git diff.
 * @param {string} cwd
 * @returns {string[]}
 */
export function getUnstagedFiles(cwd = process.cwd()) {
  if (!isGitRepo(cwd)) return [];
  try {
    const stdout = execSync('git diff --name-only', { cwd, encoding: 'utf8' });
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => Boolean(line) && SUPPORTED_EXTS.some(ext => line.endsWith(ext)))
      .map(line => line.replace(/\\/g, '/'));
  } catch {
    return [];
  }
}

/**
 * Check if export declarations were modified in git diff for given file.
 * @param {string} filePath
 * @param {boolean} stagedOnly
 * @param {string} cwd
 * @returns {boolean}
 */
export function checkExportsModified(filePath, stagedOnly = true, cwd = process.cwd()) {
  if (!isGitRepo(cwd)) return false;
  try {
    const diffFlag = stagedOnly ? '--cached' : '';
    const stdout = execSync(`git diff ${diffFlag} -U0 -- "${filePath}"`, { cwd, encoding: 'utf8' });
    const exportRegex = /^[+-]\s*(?:export\b|(?:module\.)?exports\b)/m;
    return exportRegex.test(stdout);
  } catch {
    return false;
  }
}
