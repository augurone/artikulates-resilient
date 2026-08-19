# Contract analysis

Resilient's contract analyzer is a portable build-time and IDE-time layer over
ESTree-compatible JavaScript. It infers value families and selected object
shapes from executable code. It requires no annotations and no second source
language.

The analyzer is independent of ESLint. ESLint rules consume it for diagnostics,
while CLI and editor adapters can consume the same structured results.

## Static boundary

The analyzer reports known contradictions:

- a known string used with an incompatible operation is a finding;
- a known object passed a number where a string-shaped property is declared is
  a finding;
- a signature default can absorb an `undefined` property;
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
extracts a function's parameter and return contracts. `isCompatible` compares
known contracts. `createContractDocument` builds a lightweight source-offset
index and returns `getContractAtOffset`, `getSignatureAtOffset`, and
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

`createContractGraph` connects parsed programs for local relative imports. It
currently carries named exports, named imports, and default imports into the
consumer document. That includes both the imported call signature and the
imported return contract, so the analyzer can follow a chain such as:

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

The graph is an active implementation path, not only a public helper. When
`resilient.configs.contracts` is enabled, the call-site and operation ESLint
rules build the local graph for the file being linted and report findings on
the consumer's AST nodes. This is what makes imported violations visible in
the build and through the ESLint IDE extension.

This keeps module resolution outside the inference model. Callers can provide
their own resolver; the default handles relative `.js`, `.jsx`, and
`index.js` paths. Package aliases, dynamic imports, re-exports, and filesystem
parsing remain adapter work.

The caller supplies an ESTree-compatible program. Parsing, file watching,
diagnostic presentation, and editor protocol integration remain separate from
the core.

The bundled `inspect:stack` command is a one-shot adapter around this API. It
loads the root file's local relative imports, then prints a static stack and
contract findings at `--find` or `--offset`. It is intended for inspection and
debugging; it does not replace the full ESLint run and does not watch files.

## Inference and flow

The first release tracks:

- primitive and collection value families;
- nested destructuring and defaults;
- object construction and direct returns;
- aliases and reassignment;
- branch guards such as `Array.isArray(value)`;
- known property updates;
- bounded loop effects;
- normal paths through `try`, `catch`, and `finally`.

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

Dynamic properties, unsupported effects, and incomplete external information
stay unknown.

## ESLint presets

The standard remains available through `resilient.configs.recommended`.
Contract call-site, destructuring-shape, and operation diagnostics are opt-in
through `resilient.configs.contracts`. Return-family consistency is a standalone rule
because functions may intentionally return unions such as `string | boolean`
or `object | null`.

## Current limits

The core does not perform runtime validation, resolve arbitrary package or
dynamic imports, or provide a complete LSP server. The current graph adapter
handles local relative `.js`, `.jsx`, and `index.js` paths; package aliases,
filesystem-wide project discovery, and richer re-export resolution remain
future adapter work. These layers can build on the contract model without
adding TypeScript-style annotations to application source.
