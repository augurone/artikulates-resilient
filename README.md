# eslint-plugin-resilient

Resilient is a native-JavaScript discipline for explicit, functional-first
JavaScript. It treats executable JavaScript as the place where contracts live:
signatures, defaults, operations, and return paths make the program's
expectations visible. It provides build-time diagnostics and a portable
contract model without requiring a parallel type language or annotation layer.

The ESLint rules are the foundation. The contract analyzer extends them by
following evidence across expressions, control flow, and local module
boundaries.

The opt-in contract rules extend across local relative imports. The graph is
useful in live ESLint analysis, while full project resolution and an editor
protocol remain future layers.

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
  objects `{}`, numbers `0`, and booleans `false`; stack attributes are never
  set to `null` or `undefined`;
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
`try`/`catch`/`finally` paths. It understands known native operations such as
string methods and collection methods.

When `resilient.configs.contracts` is enabled, the contract rules automatically
load local relative imports before analyzing consumer calls and returned
values. They can report both an imported argument mismatch and an invalid
operation on the imported function's known return value. The standalone
`createContractGraph` API and inspector use the same propagation model.

Known contradictions are reported. Unknown values remain unknown, so external
data still belongs to runtime validation, normalization, and tests. The
stricter `signature-contract-return-consistency` rule is available directly
but remains outside the contracts preset because intentional return unions are
valid JavaScript.

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
`getStackAtOffset` exposes the file, enclosing functions, and expression under
the offset, with inferred contracts on the relevant frames. The package does
not yet ship an LSP protocol adapter or a resolver for package aliases and
dynamic imports.

## IDE use

Use the ESLint extension for live diagnostics. The extension resolves the local
ESLint and Resilient installation from the opened workspace. With the contracts
preset enabled, local relative import findings are reported in the consumer
file. The contract document API is available to a future editor adapter without
coupling the core to an editor or to ESLint.

## Rule documentation

Individual rule behavior and examples are in [docs/rules](docs/rules/).
The concise discipline is in [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md).
The contract model is described in [docs/contracts.md](docs/contracts.md), and
the design rationale is in [docs/the-code-is-the-contract.md](docs/the-code-is-the-contract.md).

## Development

```bash
npm test
npm run lint
npx eslint bad.js --no-warn-ignored
npm run inspect:stack -- bad.js --find "getItems({}).toUpperCase" --diagnostics
```

The aggregate lint command excludes the deliberately invalid `bad.js` fixture;
run `npx eslint bad.js` to see its diagnostics directly.

The stack inspector is a one-shot contract probe. It loads local relative
imports, prints the file/function/expression stack, and adds contract findings
at the requested root-file position with `--diagnostics`. It does not run every
ESLint rule, watch files, resolve package aliases or dynamic imports, or provide
an LSP server. Use `--offset` instead of `--find` when you have a character
position.

## License

MIT
