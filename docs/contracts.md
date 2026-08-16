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
index and returns `getContractAtOffset` and `getSignatureAtOffset` methods for
queries at a source position.

The caller supplies an ESTree-compatible program. Parsing, file watching,
diagnostic presentation, and editor protocol integration remain separate from
the core.

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
Contract call-site and operation diagnostics are opt-in through
`resilient.configs.contracts`. Return-family consistency is a standalone rule
because functions may intentionally return unions such as `string | boolean`
or `object | null`.

## Current limits

The core does not perform runtime validation, infer arbitrary cross-module
contracts, or provide a complete LSP server. Those are adapter and graph
layers that can build on this contract model without adding TypeScript-style
annotations to application source.
