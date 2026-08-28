# eslint-plugin-resilient

Resilient is a native-JavaScript discipline for explicit value, control-flow,
transformation, and failure contracts. It treats executable JavaScript as the
place where contracts live: signatures, defaults, operations, and return paths
make the program's expectations visible. It provides build-time diagnostics
and a portable contract model without requiring a parallel type language or
annotation layer.

The ESLint rules are the foundation. The contract analyzer extends them by
following evidence across expressions, control flow, and local module
boundaries.

The opt-in contract rules extend across local relative imports. The graph is
available in live ESLint analysis; full project resolution and an editor
protocol are not included in this package.

Resilient is not a runtime validator and it does not own framework concerns.
React, Next.js, import policy, and application architecture remain project
rules layered on top of Resilient.

## Install

```bash
npm install --save-dev eslint eslint-plugin-resilient
```

Resilient uses ESLint flat config, requires ESLint 9 or later, and supports
Node.js 18.18 or later.

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
native operations such as string methods and collection methods.

The dialect semantics behind those rules are defined in
[`docs/semantics.md`](docs/semantics.md). The analyzer remains conservative:
it reports contradictions supported by evidence and leaves unknown values
unknown.

When `resilient.configs.contracts` is enabled, the contract rules automatically
load local relative imports and named re-export barrels before analyzing
consumer calls and returned values. They can report both an imported argument
mismatch and an invalid operation on the imported function's known return
value. The standalone `createContractGraph` API and inspector use the same
propagation model.

Known contradictions are reported. Unknown values remain unknown, so external
data still belongs to runtime validation, normalization, and tests. Known
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
or dynamic imports. Proposed extensions are listed in the
[`roadmap`](docs/roadmap.md).

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
- reports expression-statement promise chains using `.then` or `.finally`
  without a `.catch` through `no-unhandled-promise-chain`;
- warns on handled or explicitly owned `.then` chains through
  `prefer-async-await`; an unowned expression-statement chain is owned by the
  stronger `no-unhandled-promise-chain` error instead.

Use `Promise.all` for independent work, a sequential loop when ordering,
polling, retries, rate limits, or early termination matter, and
`Promise.allSettled` when partial failure is part of the contract. A necessary
loop can be documented with `// resilient-allow-loop: reason`; a required
promise chain can be documented with
`// resilient-allow-promise-chain: reason`.

See the individual [safety rule documentation](docs/rules/) for the supported
options and the limits of each syntactic check.

## IDE use

Use the ESLint extension for live diagnostics. The extension resolves the local
ESLint and Resilient installation from the opened workspace. With the contracts
preset enabled, local relative import findings are reported in the consumer
file. An editor adapter can consume the contract document API without coupling
the core to an editor or to ESLint; no such adapter is included here.

## Rule documentation

Individual rule behavior and examples are in [docs/rules](docs/rules/).
The concise discipline is in [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md).
The contract model is described in [docs/contracts.md](docs/contracts.md), and
the dialect semantics are in [docs/semantics.md](docs/semantics.md). The design
rationale is in [docs/the-code-is-the-contract.md](docs/the-code-is-the-contract.md),
and release history is recorded in [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm test
npm run lint
npm run fixtures:check
npm run release:check
npx eslint tests/fixtures/bad.js --no-ignore --no-warn-ignored
npm run inspect:stack -- tests/fixtures/bad.js --find "getItems({}).toUpperCase" --diagnostics
```

The aggregate lint command excludes the deliberately invalid
`tests/fixtures` directory; run `npx eslint tests/fixtures/bad.js --no-ignore
--no-warn-ignored` to see its diagnostics directly. `tests/fixtures/manifest.json`
is the machine-checkable agent fixture contract: `bad.js` contains one highlighted
section for every public rule, and `npm run fixtures:check` verifies that each
section produces its matching diagnostic against a real ESLint run.
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
such as `npm run release -- 0.4.4` when needed. The script updates the package,
lockfile, plugin metadata, and changelog, then verifies tests, lint, fixture
coverage, and package contents. It only manages npm version metadata; commits
and publishing remain separate decisions.

## License

MIT
