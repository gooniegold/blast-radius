#!/usr/bin/env node

import path from 'node:path';
import { DependencyGraph } from '../src/graph.js';
import { analyzeBlastRadius } from '../src/radar.js';
import { renderTerminalReport, renderJson } from '../src/terminal_ui.js';
import { getStagedFiles, getUnstagedFiles, checkExportsModified } from '../src/diff.js';

const VERSION = '1.0.0';

function showHelp() {
  console.log(`
BLAST RADIUS (v${VERSION})
Zero-dependency dependency radar and change impact analyzer for JS/TS codebases.

USAGE:
  npx blast-radius [options] [file...]
  npx blast-radius demo

COMMANDS:
  demo                      Run simulated realistic microservice radar demo

OPTIONS:
  --staged                  Analyze files currently staged in git diff
  --diff                    Analyze unstaged modified files in git diff
  --json                    Output results in machine-readable JSON format
  --threshold <score>       Exit with status code 1 if Blast Score >= threshold
  --max-depth <depth>       Maximum traversal depth for ripple analysis (default: 20)
  --cwd <path>              Specify target codebase root directory (default: current dir)
  -v, --version             Display version information
  -h, --help                Display this help screen

EXAMPLES:
  npx blast-radius src/auth.ts
  npx blast-radius --staged
  npx blast-radius --threshold 70 --staged
  npx blast-radius demo
`);
}

/**
 * Execute demo mode using an in-memory simulated architecture.
 */
function runDemo(isJson = false, threshold = null) {
  const graph = new DependencyGraph(process.cwd());

  // Set up realistic microservice dependency network
  graph.addSimulatedNode('src/auth/jwt.ts', ['src/utils/crypto.ts'], ['signToken', 'verifyToken', 'decodeToken']);
  graph.addSimulatedNode('src/middleware/authGuard.ts', ['src/auth/jwt.ts'], ['requireAuth', 'optionalAuth']);
  graph.addSimulatedNode('src/services/userService.ts', ['src/auth/jwt.ts', 'src/db/client.ts'], ['getUserById', 'createUserSession']);
  graph.addSimulatedNode('tests/unit/jwt.test.ts', ['src/auth/jwt.ts'], []);
  graph.addSimulatedNode('src/controllers/userController.ts', ['src/services/userService.ts', 'src/middleware/authGuard.ts'], ['handleGetUser', 'handleLogin']);
  graph.addSimulatedNode('src/controllers/billingController.ts', ['src/middleware/authGuard.ts', 'src/services/stripe.ts'], ['handleCheckout', 'handleWebhook']);
  graph.addSimulatedNode('src/routes/api.ts', ['src/controllers/userController.ts', 'src/controllers/billingController.ts'], ['router']);
  graph.addSimulatedNode('src/app.ts', ['src/routes/api.ts', 'src/middleware/logging.ts'], ['app']);
  graph.addSimulatedNode('tests/integration/api.test.ts', ['src/app.ts'], []);
  graph.addSimulatedNode('src/server.ts', ['src/app.ts', 'src/config/env.ts'], ['server']);

  // Add surrounding unimpacted codebase nodes for realistic baseline
  const otherFiles = [
    'src/utils/crypto.ts',
    'src/db/client.ts',
    'src/services/stripe.ts',
    'src/middleware/logging.ts',
    'src/config/env.ts',
    'src/models/user.ts',
    'src/models/order.ts',
    'src/utils/formatters.ts',
    'tests/unit/crypto.test.ts',
    'tests/unit/formatters.test.ts'
  ];
  for (const f of otherFiles) {
    graph.ensureNode(f);
  }

  const result = analyzeBlastRadius(graph, ['src/auth/jwt.ts'], {
    exportsModified: true,
    maxDepthLimit: 10
  });

  if (isJson) {
    console.log(renderJson(result));
  } else {
    console.log(renderTerminalReport(result));
  }

  if (threshold !== null && !isNaN(threshold)) {
    if (result.score >= threshold) {
      if (!isJson) {
        console.error(`\nFAILURE: Blast Score (${result.score}) meets or exceeds threshold (${threshold}).`);
      }
      process.exit(1);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`blast-radius v${VERSION}`);
    process.exit(0);
  }

  const isJson = args.includes('--json');
  const isDemo = args.includes('demo');

  let threshold = null;
  const threshIndex = args.indexOf('--threshold');
  if (threshIndex !== -1 && args[threshIndex + 1]) {
    threshold = parseInt(args[threshIndex + 1], 10);
  }

  if (isDemo) {
    runDemo(isJson, threshold);
    process.exit(0);
  }

  let cwd = process.cwd();
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = path.resolve(args[cwdIndex + 1]);
  }

  let maxDepth = 20;
  const depthIndex = args.indexOf('--max-depth');
  if (depthIndex !== -1 && args[depthIndex + 1]) {
    maxDepth = parseInt(args[depthIndex + 1], 10);
  }

  const stagedFlag = args.includes('--staged');
  const diffFlag = args.includes('--diff');

  // Positional file targets
  const targetFiles = args.filter(a => !a.startsWith('-') && a !== 'demo' && args[args.indexOf(a) - 1] !== '--cwd' && args[args.indexOf(a) - 1] !== '--threshold' && args[args.indexOf(a) - 1] !== '--max-depth');

  let resolvedTargets = [];

  if (targetFiles.length > 0) {
    resolvedTargets = targetFiles.map(f => path.relative(cwd, path.resolve(cwd, f)).replace(/\\/g, '/'));
  } else if (stagedFlag) {
    resolvedTargets = getStagedFiles(cwd);
    if (resolvedTargets.length === 0) {
      if (!isJson) {
        console.log('No staged JS/TS files detected in git.');
      }
      process.exit(0);
    }
  } else if (diffFlag) {
    resolvedTargets = getUnstagedFiles(cwd);
    if (resolvedTargets.length === 0) {
      if (!isJson) {
        console.log('No modified JS/TS files detected in git working tree.');
      }
      process.exit(0);
    }
  } else {
    // Automatic fallback: check staged first, then unstaged
    const staged = getStagedFiles(cwd);
    if (staged.length > 0) {
      resolvedTargets = staged;
    } else {
      const unstaged = getUnstagedFiles(cwd);
      if (unstaged.length > 0) {
        resolvedTargets = unstaged;
      }
    }
  }

  if (resolvedTargets.length === 0) {
    showHelp();
    console.log('NOTE: No target files specified and no git diff detected.');
    console.log('Run "npx blast-radius demo" to view an impact radar simulation.\n');
    process.exit(1);
  }

  // Check if export definitions changed in targets
  let exportsModified = false;
  for (const target of resolvedTargets) {
    if (checkExportsModified(target, stagedFlag, cwd)) {
      exportsModified = true;
      break;
    }
  }

  const graph = new DependencyGraph(cwd);
  graph.build();

  const result = analyzeBlastRadius(graph, resolvedTargets, {
    exportsModified,
    maxDepthLimit: maxDepth
  });

  if (isJson) {
    console.log(renderJson(result));
  } else {
    console.log(renderTerminalReport(result));
  }

  if (threshold !== null && !isNaN(threshold)) {
    if (result.score >= threshold) {
      if (!isJson) {
        console.error(`\nFAILURE: Blast Score (${result.score}) meets or exceeds threshold (${threshold}).`);
      }
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
