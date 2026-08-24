# no-null-assignment

Disallows explicitly assigning `null` as a generic application value. Nullish
values may describe absence at an external boundary, but contract values use
the type-safe falsey value appropriate to their shape instead.

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
`{}`, `0`, `false`, or whether the assignment should not exist. The rule reports
explicit `null` literals even when they occur at an external boundary; use a
local rule override when `null` is part of that boundary's contract.
