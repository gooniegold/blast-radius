/**
 * Clean ASCII Radar Visualizer and Terminal UI.
 * Zero emojis, zero corporate buzzwords. Factual, high-density developer formatting.
 */

/**
 * Format a numeric score into a fixed-width ASCII meter.
 * @param {number} score 0-100
 * @param {number} width Default 30 chars
 * @returns {string} e.g. "[====================..........]"
 */
export function formatAsciiMeter(score, width = 30) {
  const clamped = Math.max(0, Math.min(100, score));
  const filledCount = Math.round((clamped / 100) * width);
  const emptyCount = width - filledCount;
  return `[${'='.repeat(filledCount)}${'.'.repeat(emptyCount)}]`;
}

/**
 * Recursively render tree node into ASCII lines.
 * @param {object} node
 * @param {string} prefix
 * @param {boolean} isLast
 * @returns {string[]}
 */
export function renderTreeNodeLines(node, prefix = '', isLast = true) {
  const lines = [];
  const marker = node.depth === 0 ? '' : (isLast ? '+-- ' : '|-- ');
  const indent = node.depth === 0 ? '' : prefix + marker;
  
  let label = `[${node.type}] ${node.file}`;
  if (node.isTest) {
    label += ' (test)';
  }

  lines.push(indent + label);

  const nextPrefix = node.depth === 0 ? '' : prefix + (isLast ? '    ' : '|   ');
  const count = node.children.length;

  node.children.forEach((child, index) => {
    const lastChild = index === count - 1;
    lines.push(...renderTreeNodeLines(child, nextPrefix, lastChild));
  });

  return lines;
}

/**
 * Format full human-readable terminal report.
 * @param {object} radarResult
 * @param {object} [options]
 * @returns {string}
 */
export function renderTerminalReport(radarResult, options = {}) {
  const divider = '='.repeat(72);
  const thinDivider = '-'.repeat(72);
  const out = [];

  out.push(divider);
  out.push('BLAST RADIUS :: DEPENDENCY RADAR & IMPACT ANALYZER');
  out.push(divider);

  const meter = formatAsciiMeter(radarResult.score, 28);
  const pct = (radarResult.impactRatio * 100).toFixed(1);

  out.push(`Target(s):             ${radarResult.targets.join(', ')}`);
  out.push(`Blast Risk Score:      ${meter} ${radarResult.score}/100 [${radarResult.level}]`);
  out.push(`Direct Dependents:     ${radarResult.directCount} files`);
  out.push(`Transitive Dependents: ${radarResult.transitiveCount} files`);
  out.push(`Total Codebase Impact: ${radarResult.totalImpacted} / ${radarResult.codebaseTotal} files (${pct}%)`);
  out.push(`Max Ripple Depth:      ${radarResult.maxDepth} levels`);
  out.push(`Core Exports Modified: ${radarResult.exportsModified ? 'YES (Signature/Interface changed)' : 'NO'}`);

  if (radarResult.cycles && radarResult.cycles.length > 0) {
    out.push(`Cycles Detected:       ${radarResult.cycles.length} circular references contained safely`);
  }

  out.push(thinDivider);
  out.push('IMPACT RIPPLE MAP');
  out.push(thinDivider);

  if (radarResult.trees && radarResult.trees.length > 0) {
    for (const tree of radarResult.trees) {
      const treeLines = renderTreeNodeLines(tree);
      out.push(treeLines.join('\n'));
    }
  } else {
    out.push('No dependents impacted.');
  }

  out.push(thinDivider);
  out.push('SURGICAL VERIFICATION PLAN');
  out.push(thinDivider);

  if (radarResult.affectedTests.length > 0) {
    out.push(`Impacted Test Suites (${radarResult.affectedTests.length}):`);
    for (const testFile of radarResult.affectedTests) {
      out.push(`  * ${testFile}`);
    }
    out.push('');
    out.push('Recommended verification command:');
    const testArg = radarResult.affectedTests.slice(0, 5).join(' ');
    out.push(`  npm test -- ${testArg}`);
  } else {
    out.push('WARNING: 0 automated test suites cover the impacted dependents directly.');
    out.push('Manual regression verification is strongly recommended for:');
    const sampleTargets = radarResult.affectedSourceFiles.slice(0, 4);
    for (const f of sampleTargets) {
      out.push(`  * ${f}`);
    }
  }

  if (radarResult.affectedSourceFiles.length > 0 && radarResult.affectedTests.length > 0) {
    const untested = radarResult.affectedSourceFiles.filter(f => {
      const base = f.replace(/\.[^.]+$/, '');
      return !radarResult.affectedTests.some(t => t.includes(base));
    });
    if (untested.length > 0) {
      out.push('');
      out.push(`Downstream Consumers Lacking Direct Tests (${untested.length}):`);
      for (const u of untested.slice(0, 5)) {
        out.push(`  * ${u}`);
      }
    }
  }

  out.push(divider);

  return out.join('\n');
}

/**
 * Format report as JSON string.
 * @param {object} radarResult
 * @returns {string}
 */
export function renderJson(radarResult) {
  return JSON.stringify(radarResult, null, 2);
}
