# The Code Is the Contract

This document explains why Resilient reads contracts from executable
JavaScript. The normative dialect is in [`semantics.md`](semantics.md), and
the analyzer's implementation boundary is in [`contracts.md`](contracts.md).

## The premise

Function signatures, defaults, object construction, native operations, and
return paths already contain information about what JavaScript expects and
produces. Resilient makes that information visible without introducing a
parallel annotation language.

The goal is not to pretend that dynamic JavaScript is statically complete. The
goal is to report contradictions where the source provides enough evidence and
leave the rest for runtime validation, normalization, and tests.

```text
source JavaScript
      │
      ├── dialect rules ───────── accepted native contract forms
      ├── static inference ───── known contradictions
      └── runtime behavior ──── defaults, guards, validation, effects
```

## Why native syntax

Destructuring, defaults, guard clauses, returned transformations, prototype
methods, and structured async syntax are executable code. They carry both
runtime behavior and source-level intent. A separate type language would add a
second contract surface that can drift from the program.

This does not make a signature a runtime validator. A default handles a missing
or `undefined` property; it does not prove that arbitrary external input has
the declared shape.

## Why evidence stays local

Facts change as code executes. The analyzer follows the supported local flow of
guards, aliases, reassignment, property updates, loops, and exception paths,
but it does not promote a partial fact into certainty at a branch join.

```javascript
const mapItems = ({ value = {} } = {}) => {
    if (Array.isArray(value)) return value.map(Boolean);
    return [];
};
```

The guarded operation is knowable. An unknown external value remains unknown
outside the evidence that proves otherwise.

## Why boundaries matter

Contracts become actionable at boundaries: function signatures, return paths,
local module imports, external data, mutable platform objects, and async
failure ownership. The dialect rules make those boundaries explicit; the
analyzer checks the facts that can be proven there.

Policy and inference remain separate:

```text
analyzer  -> what the source proves
dialect   -> what the project permits
runtime   -> what external data and effects actually do
```

An analyzer can understand a property update so later reads remain accurate
while the dialect still rejects the update as an unsafe transformation.

## Architecture

```text
ESTree program
      │
      ├── contract model ── value families, shapes, compatibility
      ├── inference ─────── expressions, signatures, returns
      ├── flow ───────────── guards, aliases, updates, loops, exceptions
      ├── module graph ───── local relative imports and returned contracts
      └── document index ─── source offsets → contract/signature facts
                │
                ├── ESLint diagnostics
                ├── inspect:stack CLI probe
                └── future editor protocol adapter
```

The core is exported independently from `eslint-plugin-resilient/contracts`.
ESLint is one consumer of the model, not its owner. See
[`contracts.md`](contracts.md) for the public API, graph behavior, and current
limits.

## Design principles

1. Read contracts from executable ECMAScript.
2. Report contradictions, not lack of omniscience.
3. Preserve unknown when evidence is incomplete.
4. Keep runtime fallback and static intent aligned.
5. Make boundaries, transformations, and failure ownership visible.
6. Respect external APIs and meaningful sequential control flow.
7. Keep the core independent of ESLint and editors.
8. Use runtime validation and tests where static syntax cannot prove behavior.
