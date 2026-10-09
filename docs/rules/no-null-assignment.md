# no-null-assignment

Disallows explicitly assigning `null` as a generic application value. Nullish
values may describe absence at an external boundary, but contract values use
the type-appropriate falsey value appropriate to their shape instead.

## What this finding means

Assigning `null` as a generic application value introduces a second absence
representation beside the contract's shape-specific falsey value. That makes
callers handle an avoidable value family and can let an external boundary's
nullish representation leak into normalized code.

```javascript
// Incorrect
const value = null;
value = null;

// Correct
const getValue = ({ value = '' } = {}) => value;
const hasValue = !!value;
```

The rule does not provide an automatic fix or suggestion because only the
surrounding contract can determine whether the correct value is `''`, `[]`,
`{}`, `0`, `false`, or whether the assignment should not exist. It reports
explicit `null` literals inside assigned expressions as well as direct
assignments, even when they occur at an external boundary; use a local rule
override when `null` is part of that boundary's contract.

## Boundaries and non-goals

An owned external boundary may genuinely use `null`; normalize it there or
retain a narrow, reasoned exception. The rule does not invent a replacement.

## Repair recipes

Choose the falsey value required by the executable boundary, or remove the
assignment. Use [diagnostic explanations](../guide/diagnostic-explanations.md)
to classify an external boundary.
