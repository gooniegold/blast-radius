# blast-radius

Lightweight, zero-dependency Node.js CLI tool that runs on any JavaScript or TypeScript codebase. Inspects staged git diffs or file paths, extracts the directed dependency graph, and maps out the exact blast radius of impacted callers, downstream dependents, and exported interfaces.

## Overview

When developers or AI coding agents modify core utility functions or types, changes frequently ripple into unvisited files, causing silent build failures, runtime errors, and broken integration tests.

`blast-radius` analyzes code modifications before commit:
- Parses import and export graphs across `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, and `.cjs` files without external dependencies.
- Calculates a quantitative Blast Score (0-100 risk rating) factoring depth, caller counts, and export interface modifications.
- Renders a clean ASCII radar visualizer displaying the ripple effect from root modifications to downstream consumers.
- Outputs an actionable Surgical Verification Plan recommending targeted test commands and highlighting untested downstream leaves.

## Key Features

- Zero runtime dependencies: Runs instantly via `npx` without downloading megabytes of parser dependencies.
- Git diff integration: Automatically detects `--staged` or `--diff` modified files.
- Circular dependency safety: Traverses cyclic imports cleanly with cycle containment.
- Path alias resolution: Supports `tsconfig.json` and `jsconfig.json` path mappings (e.g. `@/*`).
- CI/CD gating: Pass `--threshold <score>` to fail CI builds on excessively risky or unverified changes.
- Machine-readable output: Pass `--json` for integration into automation workflows and IDE extensions.

## Installation

Run directly with `npx`:

```bash
npx blast-radius demo
```

Or install globally:

```bash
npm install -g blast-radius
```

Or add to project devDependencies:

```bash
npm install --save-dev blast-radius
```

## CLI Usage

### 1. Run Interactive Demo

Simulate a realistic microservice architecture modification to inspect the radar and ripple map:

```bash
npx blast-radius demo
```

### 2. Inspect Specific Files

Analyze the downstream impact of one or more source files:

```bash
npx blast-radius src/auth/jwt.ts
npx blast-radius src/db/client.ts src/models/user.ts
```

### 3. Inspect Staged Git Changes

Inspect all files currently staged in git before creating a commit:

```bash
npx blast-radius --staged
```

### 4. Inspect Unstaged Working Tree Changes

```bash
npx blast-radius --diff
```

### 5. CI/CD Gate via Blast Score Threshold

Exit with status code 1 if the risk score meets or exceeds a specified limit:

```bash
npx blast-radius --staged --threshold 75
```

### 6. Machine-Readable JSON Output

```bash
npx blast-radius --staged --json
```

## Example Radar Output

```text
========================================================================
BLAST RADIUS :: DEPENDENCY RADAR & IMPACT ANALYZER
========================================================================
Target(s):             src/auth/jwt.ts
Blast Risk Score:      [=====================.........] 74/100 [HIGH]
Direct Dependents:     3 files
Transitive Dependents: 5 files
Total Codebase Impact: 8 / 20 files (40.0%)
Max Ripple Depth:      4 levels
Core Exports Modified: YES (Signature/Interface changed)
------------------------------------------------------------------------
IMPACT RIPPLE MAP
------------------------------------------------------------------------
[ROOT] src/auth/jwt.ts
|-- [DIRECT] src/middleware/authGuard.ts
|   |-- [TRANSITIVE] src/controllers/userController.ts
|   |   +-- [TRANSITIVE] src/routes/api.ts
|   |       +-- [TRANSITIVE] src/app.ts
|   |           |-- [TRANSITIVE] tests/integration/api.test.ts (test)
|   |           +-- [TRANSITIVE] src/server.ts
|   +-- [TRANSITIVE] src/controllers/billingController.ts
|-- [DIRECT] src/services/userService.ts
+-- [DIRECT] tests/unit/jwt.test.ts (test)
------------------------------------------------------------------------
SURGICAL VERIFICATION PLAN
------------------------------------------------------------------------
Impacted Test Suites (2):
  * tests/unit/jwt.test.ts
  * tests/integration/api.test.ts

Recommended verification command:
  npm test -- tests/unit/jwt.test.ts tests/integration/api.test.ts

Downstream Consumers Lacking Direct Tests (4):
  * src/middleware/authGuard.ts
  * src/services/userService.ts
  * src/controllers/userController.ts
  * src/controllers/billingController.ts
========================================================================
```

## Architecture

- `bin/blastradius.js`: CLI entry point, argument parsing, git diff orchestration, and demo runner.
- `src/graph.js`: Dependency extractor and in-memory directed dependency graph builder. Handles ES Modules, CommonJS, dynamic imports, re-exports, and TypeScript path aliases.
- `src/radar.js`: Traversal engine using BFS to calculate depth, ripple propagation, and Blast Risk Score (0-100).
- `src/terminal_ui.js`: Clean ASCII radar visualizer and surgical verification plan formatter.
- `src/diff.js`: Git diff parser for staged/unstaged file lists and export signature inspection.
- `tests/test.js`: Comprehensive unit test suite covering comment stripping, import/export parsing, circular graph traversal, score bounds, and UI rendering.

## Testing

Run the test suite using Node.js:

```bash
npm test
```

## License

MIT - syn <ccoreyadam@gmail.com>
