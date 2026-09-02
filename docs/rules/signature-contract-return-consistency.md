# signature-contract-return-consistency

Reports functions whose known return paths produce incompatible value
families.

## Smell

Returning incompatible value families from known paths forces every caller to
guess which contract applies. The rule preserves unknown paths while reporting
contradictions visible in executable returns.

```javascript
const getValue = (enabled) => {
    if (enabled) return [];
    return ''; // reported
};
```

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
