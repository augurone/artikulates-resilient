# The Code Is the Contract

Resilient starts from a simple premise: JavaScript already contains executable
contracts, and those contracts can remain in JavaScript. Function signatures,
defaults, object construction, native
operations, and return paths describe what the program expects and produces.
Static tooling should read that evidence where it already exists.

## Runtime behavior and static evidence

JavaScript still runs dynamically. A signature default supplies a runtime
fallback, but it does not validate arbitrary external input. A static analyzer
can say that a literal number contradicts a string-shaped property; it cannot
pretend that an API response is known merely because the signature expects a
string.

Resilient therefore separates two responsibilities:

```text
source JavaScript
      │
      ├── build-time / editor-facing inference ── known contradictions
      │                                      unknown stays unknown
      │
      └── runtime execution ─────────────── defaults, guards, normalization,
                                             validation, side effects
```

The useful static boundary is:

> Known contradiction means diagnostic. Unknown means more runtime evidence is
> needed.

This keeps diagnostics actionable without turning incomplete information into
false certainty.

## Signatures are executable contracts

Destructured signatures make the expected shape visible at the function
boundary and provide real JavaScript defaults:

```javascript
const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

The analyzer can infer that `data` is object-like and `items` is array-like.
The same code also survives a missing argument or missing nested property.
Defaults should describe the expected empty value, not merely suppress a
diagnostic.

The contract model is intentionally structural rather than an annotation
system. It records evidence such as string-like, array-like, object-like,
boolean-like, number-like, nullish, unknown, and selected nested properties.

## Operations provide evidence

Native operations reinforce or contradict an inferred value:

```javascript
const render = ({
    title = ''
} = {}) => title.trim();

render({ title: 42 }); // known contradiction
```

The operation analyzer knows a focused table of common string and collection
methods. It does not claim that every method or library API is understood.
Unsupported operations and unknown receivers remain unknown.

## Flow is context, not a global guess

Facts change as code executes. Resilient tracks the local binding environment
through the useful control-flow cases without pretending to be a complete
program verifier:

- guards narrow only the branch they protect;
- aliases follow their source binding;
- reassignment replaces the prior fact;
- known property updates affect later reads;
- bounded loops join zero-or-more-iteration outcomes;
- `try`, `catch`, and `finally` retain only facts valid on the path being
  analyzed.

```javascript
const mapItems = ({ value = {} } = {}) => {
    const items = value;
    if (Array.isArray(value)) return items.map(Boolean);
    return [];
};
```

Inside the guarded branch, `items` is array-like. After the branch, the
analyzer does not promote the value to an array just because one path proved
it. Dynamic properties, unsupported effects, and external values remain
unknown.

## Return paths

Return analysis can identify incompatible known families:

```javascript
const getValue = (enabled) => {
    if (enabled) return [];
    return ''; // a deliberate finding for the strict return rule
};
```

This is a stricter policy, not a universal JavaScript law. Intentional unions
such as `string | boolean` or `object | null` are valid in some applications,
so `signature-contract-return-consistency` is available as a standalone rule
and is not enabled by the contracts preset.

## Functional-first respects boundaries

Resilient prefers functions as expressions and `const` because they make data
movement easier to inspect. Reserve `let` for one value declared at the top of a
function body when conditional control flow is necessary and no function,
prototype method, or conditional expression states the result. Reducer
accumulators and state-machine values belong inside a function or prototype
operation, not in a `let` binding in the surrounding scope. External mutable
state is a design signal, not an automatic error; one value may be clearer when
it is owned by the surrounding process.

Collection transformations should use `map`, `filter`, `reduce`, `some`,
`find`, or `forEach` when those methods express the operation. A loop remains
appropriate for detailed control flow or sequential asynchronous work, such as
awaited polling. The analyzer and rules must understand those boundaries or
they are not useful.

Early returns and flat guards are preferred to `else` branches and nested
conditionals. The goal is visible control flow, not mechanically flattened
code that hides a real decision.

## The current architecture

```text
ESTree program
      │
      ├── contract model ── value families, shapes, compatibility
      ├── inference ─────── expressions, signatures, returns
      ├── flow ───────────── guards, aliases, updates, loops, exceptions
      ├── module graph ───── local relative imports and returned contracts
      └── document index ─── source offsets → contract/signature facts
                │
                ├── ESLint contract rules and live import diagnostics
                ├── inspect:stack CLI probe
                └── future editor protocol adapter
```

The core is exported independently from `eslint-plugin-resilient/contracts`.
`createContractDocument` indexes a parsed program, while
`getContractAtOffset` and `getSignatureAtOffset` expose facts for an editor or
CLI. ESLint is one consumer, not the owner of the model.

## What exists now

The current implementation provides:

- the portable contract model and inference core;
- local flow-sensitive analysis for the supported cases above;
- offset-based document introspection;
- local module-graph propagation for named and default imports;
- imported call-site, returned-value, and returned-property diagnostics in the
  live ESLint rules;
- opt-in call-site and native-operation diagnostics;
- the `inspect:stack` one-shot contract inspector;
- dogfood coverage in `bad.js` for local import violations;
- existing Resilient rules hardened around `useState` tuples, reducer callbacks,
  and awaited loops;
- build-time ESLint diagnostics and live diagnostics through an ESLint IDE
  extension.

`getStackAtOffset` returns a static source stack—file, enclosing functions, and
the expression under the cursor—so an editor or CLI adapter can show the
relevant contract in context.

## Current boundary

The core stops at source-level evidence. Runtime validation, external data, and
framework-specific analysis remain outside it. The current adapters cover local
relative modules; broader resolution and editor protocol support remain separate
adapter work. See [contracts.md](contracts.md) for the implementation limits.

## Design principles

1. Read contracts from executable ECMAScript.
2. Report contradictions, not lack of omniscience.
3. Preserve unknown when evidence is incomplete.
4. Keep runtime fallback and static intent aligned.
5. Use explicit shapes and contract-specific, type-safe falsey values.
6. Prefer function expressions and `const`; reserve `let` for top-level
   conditional values that cannot be expressed otherwise.
7. Use collection methods when they express the operation.
8. Respect legitimate external callback signatures and sequential asynchronous
   control-flow boundaries.
9. Keep the core independent of ESLint and editors.
10. Use runtime validation and tests where static syntax cannot prove behavior.
