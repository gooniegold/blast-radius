/**
 * Radar & Blast Score Calculator
 * Analyzes impact cascades, risk levels, and surgical verification plans.
 */

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /(?:^|[\\/])tests?(?:[\\/]|$)/,
  /(?:^|[\\/])__tests__(?:[\\/]|$)/
];

/**
 * Check if a file path is a test file.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isTestFile(filePath) {
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Calculate the Blast Score (0-100) based on impact metrics.
 * @param {object} params
 * @param {number} params.directCount
 * @param {number} params.transitiveCount
 * @param {number} params.maxDepth
 * @param {number} params.totalImpacted
 * @param {number} params.codebaseTotal
 * @param {boolean} params.exportsModified
 * @returns {{ score: number, level: 'MINIMAL' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' }}
 */
export function calculateBlastScore({
  directCount,
  transitiveCount,
  maxDepth,
  totalImpacted,
  codebaseTotal,
  exportsModified = false
}) {
  if (totalImpacted === 0) {
    return { score: 0, level: 'MINIMAL' };
  }

  // Factor 1: Direct dependents weight (up to 25 pts)
  const directWeight = Math.min(directCount * 5, 25);

  // Factor 2: Transitive dependents weight (up to 25 pts)
  const transitiveWeight = Math.min(transitiveCount * 2.5, 25);

  // Factor 3: Depth of ripple propagation (up to 20 pts)
  const depthWeight = Math.min(maxDepth * 4, 20);

  // Factor 4: Codebase proportion (up to 15 pts)
  const ratio = codebaseTotal > 0 ? totalImpacted / codebaseTotal : 0;
  const ratioWeight = Math.min(Math.round(ratio * 30), 15);

  // Factor 5: Export signature modification penalty (+15 pts)
  const exportPenalty = exportsModified ? 15 : 0;

  // Raw score summation
  let rawScore = directWeight + transitiveWeight + depthWeight + ratioWeight + exportPenalty;

  // Minimum baseline if files are impacted
  if (rawScore < 5 && totalImpacted > 0) {
    rawScore = 5;
  }

  // Clamp strictly between 0 and 100
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let level = 'MINIMAL';
  if (score >= 81) {
    level = 'CRITICAL';
  } else if (score >= 61) {
    level = 'HIGH';
  } else if (score >= 36) {
    level = 'MODERATE';
  } else if (score >= 16) {
    level = 'LOW';
  } else {
    level = 'MINIMAL';
  }

  return { score, level };
}

/**
 * Traverse dependency graph from given root files and map blast radius.
 * @param {import('./graph.js').DependencyGraph} graph
 * @param {string[]} targetFiles
 * @param {object} [options]
 * @param {boolean} [options.exportsModified]
 * @param {number} [options.maxDepthLimit]
 * @returns {object} Radar analysis result
 */
export function analyzeBlastRadius(graph, targetFiles, options = {}) {
  const normalizedTargets = targetFiles.map(f => f.replace(/\\/g, '/'));
  const exportsModified = options.exportsModified ?? false;
  const maxDepthLimit = options.maxDepthLimit ?? 20;

  // Track depth and discovered order
  const visitedDepth = new Map(); // filePath -> shortest depth
  const parentMap = new Map();    // filePath -> parent that reached it first
  const childrenMap = new Map();  // parent -> Set of child files
  const cycles = [];

  // Initialize targets at depth 0
  for (const target of normalizedTargets) {
    visitedDepth.set(target, 0);
  }

  // Queue for BFS traversal: { file, depth, pathFromRoot }
  const queue = normalizedTargets.map(file => ({
    file,
    depth: 0,
    pathHistory: [file]
  }));

  const directDependents = new Set();
  const transitiveDependents = new Set();

  while (queue.length > 0) {
    const { file, depth, pathHistory } = queue.shift();

    if (depth >= maxDepthLimit) continue;

    const callers = graph.getDirectDependents(file);

    for (const caller of callers) {
      if (pathHistory.includes(caller)) {
        // Cycle detected
        cycles.push({ from: file, to: caller, path: [...pathHistory, caller] });
        continue;
      }

      const nextDepth = depth + 1;

      if (!visitedDepth.has(caller)) {
        visitedDepth.set(caller, nextDepth);
        parentMap.set(caller, file);

        if (!childrenMap.has(file)) {
          childrenMap.set(file, new Set());
        }
        childrenMap.get(file).add(caller);

        if (nextDepth === 1) {
          directDependents.add(caller);
        } else {
          transitiveDependents.add(caller);
        }

        queue.push({
          file: caller,
          depth: nextDepth,
          pathHistory: [...pathHistory, caller]
        });
      }
    }
  }

  const directList = Array.from(directDependents);
  const transitiveList = Array.from(transitiveDependents);
  const allImpacted = [...directList, ...transitiveList];

  let maxDepth = 0;
  for (const file of allImpacted) {
    const d = visitedDepth.get(file) || 0;
    if (d > maxDepth) maxDepth = d;
  }

  const codebaseTotal = graph.size;
  const totalImpacted = allImpacted.length;
  const impactRatio = codebaseTotal > 0 ? totalImpacted / codebaseTotal : 0;

  const { score, level } = calculateBlastScore({
    directCount: directList.length,
    transitiveCount: transitiveList.length,
    maxDepth,
    totalImpacted,
    codebaseTotal,
    exportsModified
  });

  // Identify tests and untested files
  const affectedTests = allImpacted.filter(isTestFile);
  const affectedSourceFiles = allImpacted.filter(f => !isTestFile(f));

  // Build recursive tree representation
  function buildSubtree(file, currentDepth) {
    const rawChildren = childrenMap.get(file) ? Array.from(childrenMap.get(file)) : [];
    return {
      file,
      type: currentDepth === 0 ? 'ROOT' : currentDepth === 1 ? 'DIRECT' : 'TRANSITIVE',
      depth: currentDepth,
      isTest: isTestFile(file),
      children: rawChildren.map(child => buildSubtree(child, currentDepth + 1))
    };
  }

  const trees = normalizedTargets.map(target => buildSubtree(target, 0));

  return {
    targets: normalizedTargets,
    score,
    level,
    directCount: directList.length,
    transitiveCount: transitiveList.length,
    totalImpacted,
    codebaseTotal,
    impactRatio: parseFloat(impactRatio.toFixed(3)),
    maxDepth,
    exportsModified,
    direct: directList,
    transitive: transitiveList,
    allImpacted,
    affectedTests,
    affectedSourceFiles,
    cycles,
    trees
  };
}
