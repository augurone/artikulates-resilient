# Contract analysis

Resilient's contract analyzer is a portable build-time analysis layer over
ESTree-compatible JavaScript with an editor-facing document API. It infers
value families and selected object shapes from executable code. It requires no
annotations and no second source language.

The product dialect that gives those facts meaning is defined in
[`semantics.md`](semantics.md). This document describes the analyzer's evidence
model and implementation boundary; it does not replace the dialect's policy
rules.

The analyzer is independent of ESLint. ESLint rules consume it for diagnostics,
while CLI and editor adapters can consume the same structured results.

## Static boundary

The analyzer reports known contradictions:

- a known string used with an incompatible operation is a finding;
- a known object passed a number where a string-shaped property is declared is
  a finding;
- a signature default can absorb an `undefined` property;
- an explicitly rest-destructured object remains an open object bag and
  preserves passthrough keys;
- a known closed object property access can be checked for absence;
- a named property destructured from a known closed object can be checked for
  absence, while defaults and object rest preserve intentional unknowns;
- known local call sites can be checked for excess literal properties and
  function arity;
- known callable values can carry signatures through aliases, object
  properties, and returned functions;
- unknown expressions remain unknown;
- runtime validation, normalization, and behavioral tests remain executable
  concerns.

This boundary is deliberate. JavaScript receives dynamic data, and a useful
static tool must distinguish “proved incompatible” from “not enough evidence.”

## Public API

The package exposes the contract helpers from a separate subpath:

```javascript
import {
    createContractDocument,
    inferExpression,
    getSignature,
    isCompatible
} from 'eslint-plugin-resilient/contracts';
```

`inferExpression` produces a contract for an expression. `getSignature`
extracts all formal parameter contracts and their bindings; `contract` remains
the first-parameter compatibility field. `isCompatible` compares known
contracts. `createContractDocument` builds a lightweight source-offset index
and returns `getContractAtOffset`, `getSignatureAtOffset`, and
`getStackAtOffset` methods for queries at a source position.

`getStackAtOffset` returns a static source stack: file, enclosing functions,
and the smallest known expression at the offset. Function frames include their
signature and return contract; expression frames include their inferred
contract. This is the portable primitive an IDE adapter can use for hover,
signature help, and context-aware diagnostics.

`getDiagnostics` returns the current contract findings for the document.
`getDiagnosticsAtOffset` narrows them to the source range under the cursor.
Each finding includes a rule id, message, range, location, and source stack.

## Module graph

Tree selection is defined separately from contract meaning in
[`tree-resolution.md`](tree-resolution.md). The Project Tree may index unused
files. The Active Tree supplies the selected roots and their statically
resolvable local dependency closure to this graph and its analyzer.

`createContractGraph` connects parsed programs for local relative imports. It
currently carries named exports, named imports, default imports, and local
re-export barrels into the consumer document. Named `export { ... } from` and
`export * from` edges are followed transitively to a stable point, including
through finite re-export cycles. That includes both the imported call
signature and the imported return contract, so the analyzer can follow a
chain such as:

```javascript
// provider.js
export const getItems = ({ items = [] } = {}) => items;

// consumer.js
import { getItems } from './provider.js';

getItems({}).toUpperCase(); // array-like value, string-like operation
```

Returned object properties are followed as well:

```javascript
import { getConfig } from './provider.js';

getConfig().items.toUpperCase();
```

The graph reports these as consumer-side operation diagnostics. It also
carries imported signatures into calls:

```javascript
import { createContractGraph } from 'eslint-plugin-resilient/contracts';

const graph = createContractGraph({
    programs: {
        'provider.js': providerProgram,
        'consumer.js': consumerProgram
    }
});

const findings = graph.getDiagnostics();
```

`graph.getAgreements()` exposes the import-tree result for adapters and editor
integrations. Each local import is classified as `resolved`, `missing`,
`ambiguous`, or `unknown`; unresolved external or unsupported module forms stay
`unknown`. A missing local export and an ambiguous `export *` are therefore
visible to tooling without being converted into a guessed contract.

Resilient does not duplicate generic module-lint policy. Its `imports` preset
packages the established `eslint-plugin-import` rules for syntax and resolver
agreement:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [resilient.configs.imports];
```

Projects may still configure the underlying rules directly when they need a
different resolver or severity policy.

The ESLint contract adapter accepts the project resolver through settings. It
receives `{ source, from, context }` and returns an absolute source file path,
or an empty string when the import is outside the resolver's scope:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [{
    settings: {
        resilient: {
            resolver: ({ source = '' } = {}) => source === '@app/pages'
                ? '/project/src/pages.js'
                : ''
        }
    }
}, resilient.configs.contracts];
```

The same resolver is used for filesystem loading and graph agreement. A
resolver that throws or returns no path leaves the import unknown.

The graph is an active implementation path, not only a public helper. When
`resilient.configs.contracts` is enabled, the call-site and operation ESLint
rules build the local graph for the file being linted and report findings on
the consumer's AST nodes. This is what makes imported violations visible in
the build and through the ESLint IDE extension.

Consumers do not manage project activation. On the first contract-rule
invocation in an ESLint run, the adapter activates its internal project
analysis for that root and its statically resolvable local dependency closure. Subsequent
contract rules in the same run reuse the graph; changed source or resolver
identity causes a rebuild. This activation is lazy and transparent to the
consumer because ESLint does not provide a separate workspace-activation hook.

The ESLint adapter uses a project-graph manager shared by the contract rules.
It reuses a graph when the root source, parser options, resolver identity, and
all loaded dependency file states are unchanged. A changed provider or barrel
therefore invalidates the dependent graph, while a second contract rule in the
same lint run reuses the first build. `getProjectGraphCacheStats()` exposes
hit, miss, build, and entry counts for integration measurements; callers that
own a project boundary can create an isolated manager with
`createProjectGraphManager()`.

The default adapter caches are bounded LRU caches: at most 256 parsed programs
and 16 complete project graphs are retained. `getProgramCacheSize()` and
`getProjectGraphCacheStats()` expose the current retained sizes. A host that
owns a project or watch-session boundary should call `clearContractCaches()`
when that boundary ends or changes; it clears both AST and graph retention in
one operation. `clearProjectGraphCache()` remains available when a caller needs
to invalidate only the default graph manager.

This keeps module resolution outside the inference model. Callers can provide
their own resolver; the default handles relative `.js`, `.jsx`, and
`index.js` paths. Package aliases, dynamic imports, and filesystem parsing are
not handled by this package; proposed adapter work is listed in
[`roadmap.md`](roadmap.md).

The caller supplies an ESTree-compatible program. Parsing, file watching,
diagnostic presentation, and editor protocol integration remain separate from
the core.

The bundled `inspect:stack` command is a one-shot adapter around this API. It
loads the root file's local relative imports, then prints a static stack and
contract findings at `--find` or `--offset`. It is intended for inspection and
debugging; it does not replace the full ESLint run and does not watch files.

The graph remains an Active Tree analyzer, not a project-wide semantic index.
For a reusable project boundary, `createProjectTree` indexes caller-supplied
programs, records forward and reverse edges, activates only selected roots and
their resolved closure, and exposes `analyze()` snapshots. Its
`getInvalidatedFiles()` result includes dependent files and identity changes;
unused indexed files remain outside the Active Tree. Passing a prior result as
`analyze({ previousSnapshot })` reuses unchanged files outside the invalidation
closure and recomputes changed files plus affected dependents. Filesystem
discovery and parser-backed loading remain adapter concerns.

## Inference and flow

Current inference tracks:

- primitive and collection value families;
- implicit regular-expression literals and `RegExp.prototype.test` results;
- nested destructuring and defaults;
- object construction and direct returns;
- function-valued expressions and returned function signatures;
- all known formal parameters and corresponding call arguments;
- aliases and reassignment;
- callable identifier aliases;
- inline callback signatures at known array-operation boundaries;
- known `map`, `filter`, `some`, `reduce`, and `forEach` result contracts;
- promise-shaped async returns and `await` unwrapping;
- `Promise.resolve` and `Promise.all` element propagation;
- explicit native primitive-producing calls such as `String`, `Number`, and
  `Boolean`;
- branch guards such as `Array.isArray(value)`;
- known property updates;
- known closed-object property access and destructuring checks, plus
  direct-literal excess-property checks;
- local call arity for known function signatures, including callback
  invocations through local higher-order call stacks;
- call-site checks for known function-valued object properties;
- program/module-level bindings for declarations, aliases, and destructured
  returned properties;
- bounded loop effects;
- normal paths through `try`, `catch`, and `finally`.

Local function return contracts are resolved to a stable point across direct
function calls, callable aliases, function-valued object properties, and
returned functions. Async returns are promise-shaped until `await` unwraps
them. `Promise.resolve` and `Promise.all` preserve known
elements. `map` derives its element contract from an inline or named callback,
`filter` preserves the input element contract, `some` returns a boolean
contract, `reduce` preserves a callback-compatible initial accumulator
contract, and `forEach` returns an explicit undefined contract. `find` and
unsupported promise combinators remain unknown because absence and alternate
completion paths need more evidence. Recursive cycles and unsupported effects
remain unknown.

The analyzer models explicit native primitive-producing calls by their returned
family. That fact describes the result of the call; it does not validate the
input, establish an external contract, or authorize coercion as a substitute
for a project-owned falsification or validation utility. At an external
boundary, establish the contract explicitly before relying on downstream
operations. The guard or utility must match the boundary's actual contract.
Converting an unreliable value does not prove that the value was valid.

Facts are narrowed only inside the branch that proves them. At a branch join,
uncertain facts are preserved as unknown instead of being promoted to a false
certainty:

```javascript
const mapItems = ({ value = {} } = {}) => {
    const items = value;
    if (Array.isArray(value)) return items.map(Boolean);
    return [];
};
```

Known object updates are also carried forward:

```javascript
const mapConfig = ({ config = {} } = {}) => {
    config.items = [];
    return config.items.map(Boolean);
};
```

The flow analyzer also retains known contracts at module scope. This makes a
returned object observable after a top-level declaration or destructuring
operation without requiring annotations:

```javascript
const page = normalizePage({});
const { items = [] } = page;

items.toUpperCase(); // array-like value, string-like operation
```

Object-pattern `RestElement`s are represented as open residual object
contracts. Extracted keys are excluded, and known remaining keys are retained
for later member access and compatibility checks; a key with no evidence stays
unknown. This guarantee applies to object rest (`{ ...rest }`), not array rest,
which remains array-shaped.

At the top level, a retained call result uses the callee's declared return
contract. Argument-sensitive re-evaluation is strongest inside function call
contexts; invalid arguments are still reported at the originating call site.

Statically known computed property keys—including literal numeric keys and
literal-bound keys—are normalized to the same property names as direct member
access. Dynamic properties, unsupported effects, and incomplete external
information stay unknown.

## ESLint presets

The recommended preset carries the Resilient discipline through
`resilient.configs.recommended`.
Contract call-site, destructuring-shape, operation, and return-family
diagnostics are opt-in through `resilient.configs.contracts`. Known return
paths must agree on one value family; incompatible paths are reported rather
than widened into a union.

## Executable fixture contract

The repository's agent-facing fixture contract is recorded in
[`tests/fixtures/manifest.json`](../tests/fixtures/manifest.json) and checked by
`npm run fixtures:check`. The deliberately invalid `bad.js` fixture contains
one labeled section for every public rule; the check executes the fixture and
verifies that each section produces its matching diagnostic. The checker runs
all public rules at error severity for coverage, so this fixture contract does
not redefine a preset's published severity; `prefer-async-await` remains a
warning in `resilient.configs.safety`.
The integration fixtures model real engine boundaries and declare the
diagnostics they must produce. Rule changes must update the relevant fixture,
manifest entry, and test together; the manifest is part of the verification
contract, not an informal inventory.

## Boundary inventory

The analyzer reads parsed JavaScript at function parameters, calls, returns,
object construction and destructuring, object-rest residuals, value
operations, guards and branches, reassignment, property updates,
`try`/`catch`/`finally`, bounded loops, and local module relationships. It
propagates those facts through aliases, callback calls, returned functions,
returned objects, async results, and known native operations.

The graph adapter resolves local relative `.js`, `.jsx`, and `index.js` paths,
named/default/namespace imports, named and star re-export barrels, and finite
re-export cycles. A caller can provide a resolver for additional authored
module layouts.

Runtime API data, database records, configuration, third-party implementations,
dynamic imports and properties, unresolved modules, unsupported effects,
filesystem discovery, parser loading, and LSP behavior belong to runtime
validation or a separate adapter. They remain unknown in the contract model.
Proposed extensions are listed in [`roadmap.md`](roadmap.md); none requires a
parallel type-annotation language in application source.
