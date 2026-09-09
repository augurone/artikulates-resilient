# signature-contract-return-consistency

Reports functions whose known return paths produce incompatible value
families.

## What this finding means

Returning incompatible value families from known paths forces every caller to
guess which contract applies. The rule preserves unknown paths while reporting
contradictions visible in executable returns.

```javascript
const getValue = (enabled) => {
    if (enabled) return [];
    return ''; // reported
};
```

An explicit bare return and reachable function-end fallthrough both produce
`undefined`. They conflict with a known value family, including when the bare
return follows a callback guard. A function whose normal paths are all absent
has no mixed-family finding. Throws and async rejection are failure paths, not
normal absence results.

Return paths involving unknown values do not create a diagnostic. Known return
paths must agree on one value family; the rule does not widen incompatible
paths into a union or require a separate return annotation. Resilient has no
return-annotation syntax: when an expected return contract is not supplied by
a known consumer boundary, direct assignability cannot be established. In
that case, the dialect strengthens the executable evidence by checking return
family consistency and known downstream operations against the returned value.
The `function-like` family participates in the same rule, so a function may be
returned and checked as a callable value without introducing a separate type
annotation.

## Boundaries and non-goals

Unknown return paths do not create a contradiction. The rule compares known
families; it does not add annotations or widen incompatible paths into a union.

The same finding is available from the portable contracts API through document
and graph `getDiagnostics()` calls, or directly through
`getReturnDiagnostics()`. These surfaces and the ESLint rule consume the same
completed-flow reader and report original expression or bare-return locations.
Function-end absence is reported at the original function body. Conditional
branch locations and result families are captured when
the return expression evaluates, so a later normally completing `finally`
block cannot change an already returned value. A finalizer that returns or
throws replaces the pending return. Async returns compare fulfilled values.

A callable guard establishes whether invocation is safe; it does not permit a
mixed result family. An effect-only callback function with a guarded bare exit
and normal fallthrough is consistent because both paths return `undefined`.
An empty `forEach` result is also `undefined` and cannot stand in for a known
string, array, or callable result.

## Repair recipes

Choose one return family and normalize every known path to it. Use the
[diagnostic guide](../guide/diagnostic-explanations.md) to trace the evidence.
