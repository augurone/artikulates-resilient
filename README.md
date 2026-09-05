# eslint-plugin-resilient

Resilient is a native-JavaScript discipline for explicit value, control-flow,
transformation, and failure contracts. It treats executable JavaScript as the
place where contracts live: signatures, defaults, operations, callable values,
and return paths make the program's expectations visible. It provides build-time
diagnostics and a portable contract model from executable code. The analyzer
reads parsed JavaScript at function, call, return, object, operation, control-
flow, callback, and local module boundaries.

The ESLint rules are the foundation. The contract analyzer extends them by
following evidence across expressions, control flow, and local module
boundaries.

The opt-in contract rules extend across local relative imports. The graph is
available in live ESLint analysis, and the contracts API now exposes a
caller-supplied Project Tree with explicit Active Tree activation and analysis
snapshots. Filesystem discovery and an editor protocol are not included in
this package.

The distinction between the project-wide source index and the dependency
closure that is actually analyzed is defined in
[`docs/reference/tree-resolution.md`](docs/reference/tree-resolution.md). Unused indexed files do
not become part of an Active Tree automatically.

Resilient is not a runtime validator and it does not own framework concerns.
Import policy and application architecture remain project rules layered on top
of Resilient.

Resilient is best understood as a build-time contract and architecture layer
for functional, flow-oriented native ECMAScript. The medium may be plain
JavaScript, React, or Next.js; what matters is whether code preserves the
discipline's explicit boundaries. It does not require a parallel type language,
union algebra, or compiler. Values that enter through unknown boundaries remain
unknown and are owned by the runtime boundary that can validate or normalize
them.

For the practical workflow for explaining a highlighted finding, see
[`docs/guide/diagnostic-explanations.md`](docs/guide/diagnostic-explanations.md). The
contract diagnostics add one concise static evidence hint by default when
evidence is available; projects that want only the original wording can opt
out, while the full derivation chain remains available through the inspector
and contracts API.

## Documentation map

The [documentation index](docs/) organizes the project by audience:

- [Guides](docs/guide/) cover adoption, migration, diagnostic explanations,
  and objections.
- [Reference](docs/reference/) defines the dialect, analyzer API, and tree
  behavior; [rule pages](docs/rules/) remain a stable top-level namespace.
- [AI material](docs/ai/) contains the concise standards and learning
  evaluation protocol.
- [Engineering material](docs/engineering/) contains evidence design, corpus,
  benchmarks, and roadmap documents.
- The technical [Code Is the Contract](docs/engineering/the-code-is-the-contract.md)
  model is separate from the readable [blog version](docs/blogs/blog-the-code-is-the-contract.md).

## Why Resilient?

[The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1)
explains the reasoning behind Resilient: using standard JavaScript's executable
boundaries as evidence for static analysis instead of maintaining a second,
granular annotation system. For Resilient, annotations that merely restate
those boundaries are an anti-pattern; the executable JavaScript remains the
runtime contract.

Resilient's design description is:

> **A source-derived Agreement Engine for functional native ECMAScript.**

The engine checks whether the executable boundaries of a program continue to
agree about values, control flow, transformations, effects, failures, and
module consumers. It reports known disagreement, accepts unknown information,
and leaves runtime ownership at the boundary that can establish more evidence.

## Static contracts from executable code

Resilient performs static contract analysis on executable JavaScript. A
function's destructured parameters and defaults, operations, control flow, and
return paths provide the contract evidence. The same source that runs is the
source that gets checked.

The guarantee is specific and observable:

- known value and shape contradictions are reported;
- defaults and return behavior are checked as executable evidence;
- imported consumers are checked against the provider's actual implementation;
- a provider change invalidates affected dependents and recomputes their result;
- ESLint and the direct contracts API consume the same analysis snapshot;
- unused indexed files remain inactive unless a selected root reaches them.

Runtime API data, database records, configuration, third-party implementations,
dynamic imports and properties, unresolved modules, unsupported effects, and
incomplete evidence remain unknown. Runtime data handling belongs to the
owning application boundary and is outside Resilient.

## Install

```bash
npm install --save-dev eslint eslint-plugin-resilient
```

Resilient uses ESLint flat config. The 0.7.0 line requires ESLint 10.9.1 or
later within ESLint 10 and supports Node.js 22.13+ or 24+.

Compatibility lines are intentionally visible:

| Release line | ESLint | Node.js |
| --- | --- | --- |
| 0.6.2 (eat lunch) | 9.x | 18.x |
| 0.7.0+ (eat greens) | 10.9.1–10.x | 22.13+ or 24+ |

## Configure

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended
];
```

The recommended preset puts the discipline into ESLint. Its commitments are:

- function expressions and `const` by default; reserve `let` for one value at
  the top of a function body when conditional control flow is necessary and no
  function, prototype method, or conditional expression states the result;
- destructured signatures with explicit, type-shaped defaults;
- contract-specific falsey values: strings return `''`, collections `[]`,
  objects `{}`, numbers `0`, and booleans `false`;
- early returns instead of `else` branches or nested conditionals;
- prototype methods for collection transformations;

Rules are boundary-aware. They do not reshape externally defined callback
signatures, full objects being forwarded, reducer callback parameters, or
sequential `await` loops when doing so would change their meaning or hide their
intent.

Resilient provides suggestions where a safe rewrite is clear. Structural and
contract rules report diagnostics without silently rewriting code.

## Contract analysis

The opt-in contract preset adds static analysis for known contradictions in
ordinary JavaScript:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts
];
```

```javascript
const render = ({
    title = ''
} = {}) => title.trim();

render({ title: 42 }); // reported by signature-contract-call-site
```

The analyzer tracks value families and selected shapes through signatures,
defaults, aliases, guards, reassignment, property updates, bounded loops, and
`try`/`catch`/`finally` paths. It checks all known formal parameters against
corresponding known call arguments and resolves direct local function returns
to a stable point. Program-scope declarations and destructured bindings retain
known returned shapes for later top-level operations. It understands known
native operations such as string methods and collection methods. Object-rest
bindings are represented as open residual object contracts with excluded keys;
known remaining properties can be recovered through aliases, calls, returns,
imports, and spreads while unsupported properties remain unknown. Known closed
objects also receive property-existence checks, including named properties
destructured from known closed objects, and known local calls receive
arity checks plus direct-literal excess-property checks. Local higher-order
calls carry known callback signatures through the invocation stack, including
callback arity and callback rest parameters. Regular-expression literals and
native `.test()` results are also inferred directly.
This residual behavior applies to object `RestElement` patterns; array rest
elements retain array contracts.

TypeScript-only syntax—such as generic parameters, literal unions, and
discriminated-union annotations—is outside the Resilient JavaScript grammar.
Resilient does not consume annotations as contract evidence; the executable
boundary is the source of truth. If another consumer independently requires
that syntax, use that consumer's own tool at its boundary.

The dialect semantics behind those rules are defined in
[`docs/reference/semantics.md`](docs/reference/semantics.md). The analyzer remains conservative:
it reports contradictions supported by evidence and leaves unknown values
unknown.

When `resilient.configs.contracts` is enabled, the contract rules automatically
load local relative imports and named re-export barrels before analyzing
consumer calls and returned values. They can report both an imported argument
mismatch and an invalid operation on the imported function's known return
value. The standalone `createContractGraph` API and inspector use the same
propagation model.

Consumers do not manage project activation. On the first contract-rule
invocation in an ESLint run, Resilient activates its internal project analysis
for that root and its statically resolvable local dependency closure. Subsequent
contract rules in the same run reuse that analysis state; changed source or
resolver identity causes the cached analysis to be rebuilt. A separate
workspace activation hook is not required.

For reusable project-aware analysis, supply parsed programs and selected roots
to `createProjectTree`:

```javascript
import {
    createProjectTree
} from 'eslint-plugin-resilient/contracts';

const tree = createProjectTree({ programs, roots: ['src/page.js'] });
const snapshot = tree.analyze();
```

The snapshot contains the indexed Project Tree, the exact Active Tree,
resolved and unknown edges, contracts, agreements, and diagnostics. `tree`
also exposes dependent invalidation for changed files and parser, config, or
resolver identities. Dynamic and unresolved edges remain unknown and do not
activate their targets. A subsequent tree can pass its prior snapshot to
`analyze({ previousSnapshot })`; files outside the invalidation closure reuse
their prior contract documents, while changed files and affected dependents
are recomputed.

Known contradictions are reported. Unknown values remain unknown, so external
data remains outside Resilient's runtime analysis. Known
return paths must agree on one value family; incompatible paths are reported by
`signature-contract-return-consistency` rather than widened into a union.

The contract core is independent of ESLint:

```javascript
import {
    createContractDocument
} from 'eslint-plugin-resilient/contracts';

const document = createContractDocument(program);
const contract = document.getContractAtOffset(offset);
const signature = document.getSignatureAtOffset(offset);
const stack = document.getStackAtOffset(offset);
const evidence = document.getEvidenceAtOffset(offset);
```

`createContractDocument` builds an offset index for editor or CLI adapters.
Its flow model includes both function scopes and the module's top-level scope,
so a returned object remains visible through declarations and destructuring:

```javascript
const page = normalizePage({});
const { items = [] } = page;

items.toUpperCase(); // reported when items is array-like
```

`getStackAtOffset` exposes the file, enclosing functions, and expression under
the offset, with inferred contracts on the relevant frames. The package does
not include an LSP protocol adapter or a built-in resolver for package aliases
or dynamic imports. `getEvidence()` exposes stable, AST-free provenance for
static source facts; it can show how a default, guard, operation, alias, or
return path supports a contract. External SDK calls remain unknown boundary
records and are never evaluated at runtime. Proposed extensions are listed in the
[`roadmap`](docs/engineering/roadmap.md).

The offset-aware contract surface is also the basis for a future repair
adapter. A conventional editor hover can lose Resilient's rule context when a
value is carried through derivative assignments or later reassignment. A
Resilient-aware editor surface should show the contract valid at the cursor,
its evidence path, and any contradiction or loss of evidence, then offer only
behavior-preserving transforms where the project rules make the repair clear.

The same analysis surface is available as the published `resilient-inspect`
binary after installing the package:

```bash
npx resilient-inspect src/page.js --find "items.toUpperCase" --diagnostics --evidence
```

It is a one-shot source inspection tool, not a runtime evaluator or a second
lint engine.

For generic import-tree correctness, Resilient also exposes an `imports`
preset backed by `eslint-plugin-import`:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.imports
];
```

That preset delegates unresolved paths, missing named exports, invalid
namespace members, and duplicate exports to the established import rules.
Resilient's contract graph remains responsible for propagating executable
signatures and return shapes across the same local tree.

The contracts adapter accepts a project resolver through ESLint settings. The
resolver receives `{ source, from, context }` and returns an absolute source
file path, or an empty string when the project cannot resolve the import:

```javascript
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

Resolver failures remain unknown; they do not become guessed contracts.

## Safety rules

The safety preset adds explicit boundaries for mutation, failure handling, and
promise sequencing. It is opt-in because these rules encode project policy and can
require deliberate exceptions at platform boundaries:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.safety
];
```

The preset:

- prefers new values for object and array transformations through
  `prefer-safe-transformations`, including locally created working values;
  draft reducers, caches, DOM objects, refs, and other deliberately mutable
  boundaries use its explicit binding or property options;
- rejects empty `catch` blocks through `no-silent-catch`, while allowing
  `try`, `catch`, `finally`, and `throw` when they preserve error behavior;
- requires an `isFunction` or equivalent `typeof ... === 'function'` guard
  before invoking an optional destructured callback through
  `no-unguarded-callback-invocation`;
- reports expression-statement promise chains using `.then` or `.finally`
  without a `.catch` through `no-unhandled-promise-chain`;
- warns on handled or explicitly owned `.then` chains through
  `prefer-async-await`; an unowned expression-statement chain is owned by the
  stronger `no-unhandled-promise-chain` error instead.

Use `Promise.all` for independent work, a sequential `await` loop when
ordering, polling, retries, or rate limits matter, and `Promise.allSettled` when
partial failure is part of the contract. Loops with direct
`break`/`continue`/`return`/`throw` are also native exceptions because their
control flow is explicit. Other necessary loop forms require
`// resilient-allow-loop: reason`; a required promise chain can be documented with
`// resilient-allow-promise-chain: reason`.

See the individual [safety rule documentation](docs/rules/) for the supported
options and the limits of each syntactic check.

## IDE use

Use the ESLint extension for live diagnostics. The extension resolves the local
ESLint and Resilient installation from the opened workspace. With the contracts
preset enabled, local relative import findings are reported in the consumer
file. The existing editor remains the presentation layer; a future thin
Resilient adapter may add contract-aware hovers and code actions without
replacing the editor's JavaScript service or requiring a general-purpose LSP.

## Rule documentation

Individual rule behavior and examples are in [docs/rules](docs/rules/).
The migration playbook is in [docs/guide/migration-playbook.md](docs/guide/migration-playbook.md)
and gives a rule-by-rule adoption path plus a future fix backbone.
The diagnostic corpus and test classification are in
[docs/engineering/diagnostic-corpus.md](docs/engineering/diagnostic-corpus.md).
The agent-learning evaluation protocol is in
[docs/ai/agent-learning-evaluation.md](docs/ai/agent-learning-evaluation.md).
The concise discipline is in [docs/ai/CODING_STANDARDS.md](docs/ai/CODING_STANDARDS.md).
The contract model is described in [docs/reference/contracts.md](docs/reference/contracts.md), and
the dialect semantics are in [docs/reference/semantics.md](docs/reference/semantics.md). The design
rationale is in [docs/engineering/the-code-is-the-contract.md](docs/engineering/the-code-is-the-contract.md),
objections are addressed in [docs/guide/overcoming-objections.md](docs/guide/overcoming-objections.md),
and release history is recorded in [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm test
npm run lint
npm run fixtures:check
npm run release:check
npm run consumer:check
npm run benchmark
npx eslint tests/fixtures/bad.js --no-ignore --no-warn-ignored
npm run inspect:stack -- tests/fixtures/bad.js --find "getItems({}).toUpperCase" --diagnostics
npx resilient-inspect tests/fixtures/bad.js --find "getItems({}).toUpperCase" --diagnostics --evidence
```

`npm run lint` prints the dependency freshness report after the lint pass. The
post-lint `npm outdated --long` report is informational: stale dependencies
remain visible without turning an otherwise successful lint run red. The report
also runs during `npm run release:check`, because release verification invokes
the lint script.
`npm run consumer:check` packs the repository, installs the generated tarball
into a temporary consumer with the supported ESLint peer, verifies the direct
contracts export, checks both a clean and a diagnostic-producing lint run, and
executes the published inspector entry point. Release verification runs this
packed-consumer check as well.

The aggregate lint command excludes the deliberately invalid
`tests/fixtures` directory; run `npx eslint tests/fixtures/bad.js --no-ignore
--no-warn-ignored` to see its diagnostics directly. `tests/fixtures/manifest.json`
is the machine-checkable agent fixture contract: `bad.js` contains one highlighted
section for every public rule, and `npm run fixtures:check` verifies that each
section produces its matching diagnostic against a real ESLint run. The fixture
checker promotes all rules to error severity for coverage; the safety preset's
`prefer-async-await` rule remains an intentional warning.
`tests/fixtures/integration/` contains real engine
boundary scenarios. The fixture enables the standalone
`signature-contract-return-consistency` rule so every Resilient rule is
represented without changing the contracts preset.

The stack inspector is a one-shot contract probe. It loads local relative
imports, prints the file/function/expression stack, and adds contract findings
at the requested root-file position with `--diagnostics`. It does not run every
ESLint rule, watch files, resolve package aliases or dynamic imports, or provide
an LSP server. Use `--offset` instead of `--find` when you have a character
position.

To prepare a release, add the next changes under `## Unreleased`, then run
`npm run release`. It automatically prepares the next patch version. Use
`npm run release -- minor`, `npm run release -- major`, or an explicit version
when needed. The script updates the package,
lockfile, plugin metadata, and changelog, then verifies tests, lint, fixture
coverage, and package contents. It only manages npm version metadata; commits
and publishing remain separate decisions.

## License

MIT
