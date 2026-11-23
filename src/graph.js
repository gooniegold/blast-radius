import fs from 'node:fs';
import path from 'node:path';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Remove single-line and multi-line comments from source text while preserving line counts.
 * @param {string} code
 * @returns {string}
 */
export function stripComments(code) {
  let result = '';
  let inString = false;
  let stringChar = '';
  let inRegex = false;
  let inSingleComment = false;
  let inMultiComment = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = code[i + 1] || '';

    if (inSingleComment) {
      if (char === '\n') {
        inSingleComment = false;
        result += '\n';
      }
      continue;
    }

    if (inMultiComment) {
      if (char === '*' && nextChar === '/') {
        inMultiComment = false;
        i++;
      } else if (char === '\n') {
        result += '\n';
      }
      continue;
    }

    if (inString) {
      result += char;
      if (char === '\\') {
        if (i + 1 < code.length) {
          result += code[i + 1];
          i++;
        }
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      inSingleComment = true;
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inMultiComment = true;
      i++;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      inString = true;
      stringChar = char;
      result += char;
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Extract imported paths and specifiers from source code.
 * @param {string} sourceCode
 * @returns {{ specifier: string, type: 'static' | 'dynamic' | 'require' | 're-export' }[]}
 */
export function extractImportSpecifiers(sourceCode) {
  const cleanCode = stripComments(sourceCode);
  const imports = [];
  const seen = new Set();

  const addSpecifier = (specifier, type) => {
    if (!specifier) return;
    const clean = specifier.trim().replace(/^['"`]|['"`]$/g, '');
    const key = `${type}:${clean}`;
    if (clean && !seen.has(key)) {
      seen.add(key);
      imports.push({ specifier: clean, type });
    }
  };

  // 1. Static imports: import ... from '...' or import '...'
  const staticImportRegex = /(?:import\s+(?:type\s+)?(?:[\w*\s{},$]+from\s+)?|import\s+)['"]([^'"]+)['"]/g;
  let match;
  while ((match = staticImportRegex.exec(cleanCode)) !== null) {
    addSpecifier(match[1], 'static');
  }

  // 2. Re-exports: export ... from '...'
  const reExportRegex = /export\s+(?:type\s+)?(?:[\w*\s{},$]+from\s+)['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(cleanCode)) !== null) {
    addSpecifier(match[1], 're-export');
  }

  // 3. Dynamic imports: import('...')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(cleanCode)) !== null) {
    addSpecifier(match[1], 'dynamic');
  }

  // 4. CommonJS require: require('...')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(cleanCode)) !== null) {
    addSpecifier(match[1], 'require');
  }

  return imports;
}

/**
 * Extract exported symbols from source code.
 * @param {string} sourceCode
 * @returns {string[]}
 */
export function extractExportedSymbols(sourceCode) {
  const cleanCode = stripComments(sourceCode);
  const exports = new Set();

  // export const/let/var/function/class/interface/type/enum [name]
  const declRegex = /export\s+(?:async\s+)?(?:default\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g;
  let match;
  while ((match = declRegex.exec(cleanCode)) !== null) {
    exports.add(match[1]);
  }

  // export default ...
  if (/export\s+default\b/.test(cleanCode)) {
    exports.add('default');
  }

  // export { foo, bar as baz }
  const namedExportsRegex = /export\s*\{([^}]+)\}(?!\s*from)/g;
  while ((match = namedExportsRegex.exec(cleanCode)) !== null) {
    const list = match[1].split(',');
    for (const item of list) {
      const parts = item.trim().split(/\s+as\s+/);
      const name = parts[parts.length - 1]?.trim();
      if (name && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(name)) {
        exports.add(name);
      }
    }
  }

  // CommonJS exports.foo = ... or module.exports = ...
  const cjsExportsRegex = /(?:module\.)?exports\.([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=/g;
  while ((match = cjsExportsRegex.exec(cleanCode)) !== null) {
    exports.add(match[1]);
  }
  if (/module\.exports\s*=/.test(cleanCode)) {
    exports.add('default');
  }

  return Array.from(exports);
}

/**
 * Load tsconfig.json or jsconfig.json path mappings if available.
 * @param {string} rootDir
 * @returns {{ baseUrl: string, paths: Record<string, string[]> } | null}
 */
export function loadPathConfig(rootDir) {
  for (const filename of ['tsconfig.json', 'jsconfig.json']) {
    const configPath = path.join(rootDir, filename);
    if (fs.existsSync(configPath)) {
      try {
        let content = fs.readFileSync(configPath, 'utf8');
        // Clean basic JSON comments
        content = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
        const parsed = JSON.parse(content);
        const compilerOptions = parsed.compilerOptions || {};
        return {
          baseUrl: compilerOptions.baseUrl ? path.resolve(rootDir, compilerOptions.baseUrl) : rootDir,
          paths: compilerOptions.paths || {}
        };
      } catch {
        // Fall back gracefully if unparseable
      }
    }
  }
  return null;
}

/**
 * Resolve an import specifier to a concrete file path on disk.
 * @param {string} specifier
 * @param {string} importerFile
 * @param {string} rootDir
 * @param {{ baseUrl: string, paths: Record<string, string[]> } | null} pathConfig
 * @returns {string | null} Normalized relative path (e.g. "src/auth.ts") or null if external/unresolved
 */
export function resolveImportPath(specifier, importerFile, rootDir, pathConfig = null) {
  let candidateBasePaths = [];

  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const isAbsolute = path.isAbsolute(specifier);

  if (isRelative) {
    const importerDir = path.dirname(path.resolve(rootDir, importerFile));
    candidateBasePaths.push(path.resolve(importerDir, specifier));
  } else if (isAbsolute) {
    candidateBasePaths.push(path.resolve(specifier));
  } else if (pathConfig && pathConfig.paths) {
    // Check tsconfig/jsconfig path aliases
    for (const [aliasPattern, targetPatterns] of Object.entries(pathConfig.paths)) {
      const regexPattern = new RegExp('^' + aliasPattern.replace(/\*/g, '(.*)') + '$');
      const match = specifier.match(regexPattern);
      if (match) {
        const starReplacement = match[1] || '';
        for (const targetPattern of targetPatterns) {
          const resolvedTarget = targetPattern.replace(/\*/g, starReplacement);
          candidateBasePaths.push(path.resolve(pathConfig.baseUrl, resolvedTarget));
        }
      }
    }
  }

  // Also probe if specifier can resolve directly from rootDir
  if (!isRelative && !isAbsolute) {
    candidateBasePaths.push(path.resolve(rootDir, specifier));
  }

  const probeExtensions = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '/index.ts',
    '/index.tsx',
    '/index.js',
    '/index.jsx',
    '/index.mjs',
    '/index.cjs'
  ];

  for (const candidate of candidateBasePaths) {
    // If importing with extension e.g. './foo.js' when actual file is './foo.ts'
    const parsed = path.parse(candidate);
    const candidateWithoutExt = path.join(parsed.dir, parsed.name);

    const tryList = [candidate];
    if (parsed.ext) {
      tryList.push(candidateWithoutExt);
    }

    for (const basePath of tryList) {
      for (const ext of probeExtensions) {
        const testPath = basePath + ext;
        if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
          const relative = path.relative(rootDir, testPath).replace(/\\/g, '/');
          return relative;
        }
      }
    }
  }

  return null;
}

/**
 * Scan a directory for all JS/TS files.
 * @param {string} dir
 * @param {string} rootDir
 * @param {string[]} ignoredDirs
 * @returns {string[]} List of relative file paths
 */
export function scanFiles(dir, rootDir, ignoredDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'out', '.cache']) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (!ignoredDirs.includes(entry.name)) {
        results.push(...scanFiles(fullPath, rootDir, ignoredDirs));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        results.push(relativePath);
      }
    }
  }

  return results;
}

/**
 * Dependency Graph class managing nodes, edges, and reverse lookup.
 */
export class DependencyGraph {
  constructor(rootDir = process.cwd()) {
    this.rootDir = path.resolve(rootDir);
    this.pathConfig = loadPathConfig(this.rootDir);
    /**
     * Map of filePath -> {
     *   file: string,
     *   imports: Set<string>,
     *   importedBy: Set<string>,
     *   exports: string[],
     *   rawImports: { specifier: string, type: string }[]
     * }
     */
    this.nodes = new Map();
  }

  /**
   * Add or get an existing node in graph.
   * @param {string} filePath
   */
  ensureNode(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    if (!this.nodes.has(normalized)) {
      this.nodes.set(normalized, {
        file: normalized,
        imports: new Set(),
        importedBy: new Set(),
        exports: [],
        rawImports: []
      });
    }
    return this.nodes.get(normalized);
  }

  /**
   * Build the complete graph by scanning root directory or given list of files.
   * @param {string[]} [files]
   */
  build(files = null) {
    const targetFiles = files || scanFiles(this.rootDir, this.rootDir);

    // First pass: register all nodes
    for (const file of targetFiles) {
      this.ensureNode(file);
    }

    // Second pass: parse file contents and link edges
    for (const file of targetFiles) {
      const absPath = path.resolve(this.rootDir, file);
      if (!fs.existsSync(absPath)) continue;

      let sourceCode = '';
      try {
        sourceCode = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      const node = this.ensureNode(file);
      node.exports = extractExportedSymbols(sourceCode);
      node.rawImports = extractImportSpecifiers(sourceCode);

      for (const item of node.rawImports) {
        const resolved = resolveImportPath(item.specifier, file, this.rootDir, this.pathConfig);
        if (resolved) {
          const targetNode = this.ensureNode(resolved);
          node.imports.add(resolved);
          targetNode.importedBy.add(file);
        }
      }
    }

    return this;
  }

  /**
   * Directly inject a simulated node (useful for unit testing and demo mode).
   * @param {string} file
   * @param {string[]} imports
   * @param {string[]} exportsList
   */
  addSimulatedNode(file, imports = [], exportsList = []) {
    const node = this.ensureNode(file);
    node.exports = exportsList;
    for (const imp of imports) {
      const targetNode = this.ensureNode(imp);
      node.imports.add(imp);
      targetNode.importedBy.add(file);
    }
  }

  /**
   * Get direct dependents of a file.
   * @param {string} filePath
   * @returns {string[]}
   */
  getDirectDependents(filePath) {
    const node = this.nodes.get(filePath.replace(/\\/g, '/'));
    if (!node) return [];
    return Array.from(node.importedBy);
  }

  /**
   * Get total file count in the graph.
   * @returns {number}
   */
  get size() {
    return this.nodes.size;
  }
}
