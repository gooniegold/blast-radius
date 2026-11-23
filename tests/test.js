import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import {
  stripComments,
  extractImportSpecifiers,
  extractExportedSymbols,
  resolveImportPath,
  DependencyGraph
} from '../src/graph.js';
import {
  calculateBlastScore,
  analyzeBlastRadius,
  isTestFile
} from '../src/radar.js';
import {
  formatAsciiMeter,
  renderTreeNodeLines,
  renderTerminalReport,
  renderJson
} from '../src/terminal_ui.js';

console.log('Running blast-radius test suite...\n');

async function runAllTests() {
  // Test 1: Comment Stripping
  console.log('Test 1: Comment stripping');
  {
    const sample = `
      // Single line comment
      import { a } from './a';
      /* Multi-line
         comment with import { b } from './b' */
      const url = "http://example.com//test";
      import { c } from './c';
    `;
    const clean = stripComments(sample);
    assert.ok(!clean.includes('Single line comment'));
    assert.ok(!clean.includes('Multi-line'));
    assert.ok(clean.includes('import { a } from \'./a\';'));
    assert.ok(clean.includes('http://example.com//test'));
    assert.ok(clean.includes('import { c } from \'./c\';'));
    console.log('Passed Test 1: Comments stripped accurately without breaking code or URLs.');
  }

  // Test 2: Import & Re-export Specifier Extraction
  console.log('Test 2: Import and re-export extraction');
  {
    const sample = `
      import React, { useState } from 'react';
      import type { UserProfile } from './types/user';
      import * as utils from './utils';
      export { authMiddleware } from './middleware/auth';
      export * from './constants';
      const helper = require('./cjsHelper');
      const lazyModule = await import('./routes/lazy');
    `;
    const extracted = extractImportSpecifiers(sample);
    const specifiers = extracted.map(i => i.specifier);

    assert.ok(specifiers.includes('react'));
    assert.ok(specifiers.includes('./types/user'));
    assert.ok(specifiers.includes('./utils'));
    assert.ok(specifiers.includes('./middleware/auth'));
    assert.ok(specifiers.includes('./constants'));
    assert.ok(specifiers.includes('./cjsHelper'));
    assert.ok(specifiers.includes('./routes/lazy'));
    assert.strictEqual(extracted.length, 7);
    console.log('Passed Test 2: All ES static, re-export, dynamic, and CJS imports extracted.');
  }

  // Test 3: Export Symbol Extraction
  console.log('Test 3: Export symbol extraction');
  {
    const sample = `
      export const API_KEY = 'secret';
      export let counter = 0;
      export function authenticateUser(token: string) {}
      export async function fetchUserData() {}
      export class AuthService {}
      export interface SessionToken {}
      export type Role = 'admin' | 'user';
      export enum Status { Active, Inactive }
      export default function main() {}
      export { helperOne, helperTwo as aliasTwo };
      module.exports.legacyUtil = function() {};
    `;
    const exports = extractExportedSymbols(sample);
    assert.ok(exports.includes('API_KEY'));
    assert.ok(exports.includes('counter'));
    assert.ok(exports.includes('authenticateUser'));
    assert.ok(exports.includes('fetchUserData'));
    assert.ok(exports.includes('AuthService'));
    assert.ok(exports.includes('SessionToken'));
    assert.ok(exports.includes('Role'));
    assert.ok(exports.includes('Status'));
    assert.ok(exports.includes('default'));
    assert.ok(exports.includes('helperOne'));
    assert.ok(exports.includes('aliasTwo'));
    assert.ok(exports.includes('legacyUtil'));
    console.log('Passed Test 3: Named, default, interface, type, and CJS exports extracted.');
  }

  // Test 4: Path & Extension Resolution
  console.log('Test 4: Path and extension resolution');
  {
    // Create temporary files in a scratch dir to test concrete filesystem resolution
    const tempDir = path.resolve('./tests/.temp_resolve_test');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'sub'), { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'fileA.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(tempDir, 'sub', 'index.js'), 'export const b = 2;');
    fs.writeFileSync(path.join(tempDir, 'component.tsx'), 'export const c = 3;');

    const resA = resolveImportPath('./fileA', 'entry.js', tempDir);
    assert.strictEqual(resA, 'fileA.ts');

    const resB = resolveImportPath('./sub', 'entry.js', tempDir);
    assert.strictEqual(resB, 'sub/index.js');

    const resC = resolveImportPath('./component', 'entry.js', tempDir);
    assert.strictEqual(resC, 'component.tsx');

    // Clean up temp test files
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('Passed Test 4: Extensions, index files, and relative paths resolved.');
  }

  // Test 5: Circular Dependency Safety
  console.log('Test 5: Circular dependency safety and cycle detection');
  {
    const graph = new DependencyGraph(process.cwd());
    // Create cycle: A -> B -> C -> A
    graph.addSimulatedNode('src/moduleA.ts', ['src/moduleB.ts'], ['funcA']);
    graph.addSimulatedNode('src/moduleB.ts', ['src/moduleC.ts'], ['funcB']);
    graph.addSimulatedNode('src/moduleC.ts', ['src/moduleA.ts'], ['funcC']);

    // Calling moduleC as target (moduleB and moduleA depend on it directly/transitively)
    const result = analyzeBlastRadius(graph, ['src/moduleC.ts'], { maxDepthLimit: 10 });

    assert.ok(result.allImpacted.includes('src/moduleB.ts'));
    assert.ok(result.allImpacted.includes('src/moduleA.ts'));
    assert.ok(result.cycles.length > 0, 'Should detect circular dependency cycle without crashing');
    console.log('Passed Test 5: Traversal handled circular dependencies safely with cycle reporting.');
  }

  // Test 6: Blast Score Calculation & Bounds
  console.log('Test 6: Blast score calculation and classification');
  {
    // Minimal impact
    const min = calculateBlastScore({
      directCount: 0,
      transitiveCount: 0,
      maxDepth: 0,
      totalImpacted: 0,
      codebaseTotal: 50,
      exportsModified: false
    });
    assert.strictEqual(min.score, 0);
    assert.strictEqual(min.level, 'MINIMAL');

    // Low impact
    const low = calculateBlastScore({
      directCount: 2,
      transitiveCount: 2,
      maxDepth: 2,
      totalImpacted: 4,
      codebaseTotal: 40,
      exportsModified: false
    });
    assert.ok(low.score >= 16 && low.score <= 35, `Expected LOW score, got ${low.score}`);
    assert.strictEqual(low.level, 'LOW');

    // High impact
    const high = calculateBlastScore({
      directCount: 4,
      transitiveCount: 6,
      maxDepth: 4,
      totalImpacted: 10,
      codebaseTotal: 40,
      exportsModified: true
    });
    assert.ok(high.score >= 61 && high.score <= 80, `Expected HIGH score, got ${high.score}`);
    assert.strictEqual(high.level, 'HIGH');

    // Extreme impact (clamped to 100)
    const extreme = calculateBlastScore({
      directCount: 20,
      transitiveCount: 50,
      maxDepth: 10,
      totalImpacted: 70,
      codebaseTotal: 70,
      exportsModified: true
    });
    assert.strictEqual(extreme.score, 100);
    assert.strictEqual(extreme.level, 'CRITICAL');
    console.log('Passed Test 6: Blast score correctly weighted, bounded [0, 100], and classified.');
  }

  // Test 7: Radar Ripple Tree & Categorization
  console.log('Test 7: Ripple tree generation and test file detection');
  {
    const graph = new DependencyGraph(process.cwd());
    graph.addSimulatedNode('src/core/auth.ts', [], ['login']);
    graph.addSimulatedNode('src/services/session.ts', ['src/core/auth.ts'], ['createSession']);
    graph.addSimulatedNode('src/routes/login.ts', ['src/services/session.ts'], ['router']);
    graph.addSimulatedNode('tests/auth.test.ts', ['src/core/auth.ts'], []);
    graph.addSimulatedNode('tests/e2e/login.spec.ts', ['src/routes/login.ts'], []);

    const result = analyzeBlastRadius(graph, ['src/core/auth.ts']);

    assert.strictEqual(result.directCount, 2); // session.ts and auth.test.ts
    assert.strictEqual(result.transitiveCount, 2); // login.ts and login.spec.ts
    assert.strictEqual(result.totalImpacted, 4);
    assert.strictEqual(result.affectedTests.length, 2);
    assert.ok(result.affectedTests.includes('tests/auth.test.ts'));
    assert.ok(result.affectedTests.includes('tests/e2e/login.spec.ts'));

    assert.strictEqual(result.trees.length, 1);
    const rootTree = result.trees[0];
    assert.strictEqual(rootTree.file, 'src/core/auth.ts');
    assert.strictEqual(rootTree.children.length, 2);
    console.log('Passed Test 7: Direct/transitive dependents, test files, and tree hierarchy mapped.');
  }

  // Test 8: Terminal UI ASCII Visualizer & Formatting
  console.log('Test 8: ASCII visualizer and zero-emoji verification');
  {
    const meter = formatAsciiMeter(75, 20);
    assert.strictEqual(meter, '[===============.....]');

    const mockResult = {
      targets: ['src/auth.ts'],
      score: 72,
      level: 'HIGH',
      directCount: 2,
      transitiveCount: 3,
      totalImpacted: 5,
      codebaseTotal: 25,
      impactRatio: 0.20,
      maxDepth: 3,
      exportsModified: true,
      affectedTests: ['tests/auth.test.ts'],
      affectedSourceFiles: ['src/services/session.ts', 'src/routes/login.ts'],
      trees: [
        {
          file: 'src/auth.ts',
          type: 'ROOT',
          depth: 0,
          isTest: false,
          children: [
            {
              file: 'src/services/session.ts',
              type: 'DIRECT',
              depth: 1,
              isTest: false,
              children: [
                {
                  file: 'src/routes/login.ts',
                  type: 'TRANSITIVE',
                  depth: 2,
                  isTest: false,
                  children: []
                }
              ]
            },
            {
              file: 'tests/auth.test.ts',
              type: 'DIRECT',
              depth: 1,
              isTest: true,
              children: []
            }
          ]
        }
      ]
    };

    const output = renderTerminalReport(mockResult);

    // Verify factual, clean ASCII output
    assert.ok(output.includes('BLAST RADIUS :: DEPENDENCY RADAR'));
    assert.ok(output.includes('Target(s):             src/auth.ts'));
    assert.ok(output.includes('Blast Risk Score:'));
    assert.ok(output.includes('[HIGH]'));
    assert.ok(output.includes('IMPACT RIPPLE MAP'));
    assert.ok(output.includes('[ROOT] src/auth.ts'));
    assert.ok(output.includes('|-- [DIRECT] src/services/session.ts'));
    assert.ok(output.includes('+-- [DIRECT] tests/auth.test.ts (test)'));
    assert.ok(output.includes('SURGICAL VERIFICATION PLAN'));
    assert.ok(output.includes('npm test -- tests/auth.test.ts'));

    // Verify STRICT 0 emojis rule: no emoji characters in terminal output
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.ok(!emojiRegex.test(output), 'Terminal report must strictly contain 0 emojis');

    const json = renderJson(mockResult);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.score, 72);
    assert.strictEqual(parsed.level, 'HIGH');
    console.log('Passed Test 8: ASCII radar formatting verified with 0 emojis and valid JSON.');
  }

  // Test 9: isTestFile helper
  console.log('Test 9: Test file detection patterns');
  {
    assert.strictEqual(isTestFile('src/auth.test.ts'), true);
    assert.strictEqual(isTestFile('src/auth.spec.js'), true);
    assert.strictEqual(isTestFile('tests/unit/login.ts'), true);
    assert.strictEqual(isTestFile('src/__tests__/api.tsx'), true);
    assert.strictEqual(isTestFile('src/models/user.ts'), false);
    assert.strictEqual(isTestFile('src/controllers/testRunner.ts'), false);
    console.log('Passed Test 9: Test file detection matches unit, spec, and test directories.');
  }

  // Test 10: Demo graph architecture analysis
  console.log('Test 10: Demo graph architecture and risk verification');
  {
    const graph = new DependencyGraph(process.cwd());
    graph.addSimulatedNode('src/auth/jwt.ts', ['src/utils/crypto.ts'], ['signToken', 'verifyToken']);
    graph.addSimulatedNode('src/middleware/authGuard.ts', ['src/auth/jwt.ts'], ['requireAuth']);
    graph.addSimulatedNode('src/services/userService.ts', ['src/auth/jwt.ts'], ['getUserById']);
    graph.addSimulatedNode('tests/unit/jwt.test.ts', ['src/auth/jwt.ts'], []);
    graph.addSimulatedNode('src/controllers/userController.ts', ['src/services/userService.ts'], ['handleLogin']);
    graph.addSimulatedNode('src/routes/api.ts', ['src/controllers/userController.ts'], ['router']);

    for (const f of ['src/utils/crypto.ts', 'src/db/client.ts', 'src/models/user.ts']) {
      graph.ensureNode(f);
    }

    const result = analyzeBlastRadius(graph, ['src/auth/jwt.ts'], { exportsModified: true });
    assert.strictEqual(result.directCount, 3);
    assert.strictEqual(result.transitiveCount, 2);
    assert.strictEqual(result.totalImpacted, 5);
    assert.ok(result.score >= 60, 'Demo risk score should reflect high impact');
    console.log('Passed Test 10: Demo architecture graph analysis matches expected depth and counts.');
  }

  // Test 11: Real directory scan and graph build on blast-radius self codebase
  console.log('Test 11: Real filesystem graph scanning on blast-radius repository');
  {
    const selfGraph = new DependencyGraph(path.resolve('.'));
    selfGraph.build();

    assert.ok(selfGraph.size >= 5, `Expected self codebase to have >= 5 files, got ${selfGraph.size}`);
    assert.ok(selfGraph.nodes.has('src/graph.js'));
    assert.ok(selfGraph.nodes.has('src/radar.js'));
    assert.ok(selfGraph.nodes.has('src/terminal_ui.js'));

    const radarNode = selfGraph.nodes.get('src/radar.js');
    assert.ok(radarNode.exports.includes('calculateBlastScore'));
    assert.ok(radarNode.exports.includes('analyzeBlastRadius'));

    const graphCallers = selfGraph.getDirectDependents('src/radar.js');
    assert.ok(graphCallers.includes('src/terminal_ui.js') || graphCallers.includes('bin/blastradius.js') || graphCallers.includes('tests/test.js'),
      'src/radar.js should be depended on by bin/blastradius.js or tests/test.js');

    console.log('Passed Test 11: Self-codebase scanned, imports extracted, and graph built from disk.');
  }

  console.log('\nALL 11 UNIT TESTS PASSED SUCCESSFULLY.\n');
}

runAllTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
