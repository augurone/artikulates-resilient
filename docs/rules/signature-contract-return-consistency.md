# signature-contract-return-consistency

Reports functions whose known return paths produce incompatible value
families.

## Smell

Returning incompatible value families from known paths forces every caller to
guess which contract applies. The rule keeps intentional unknowns and unions
possible while reporting contradictions visible in executable returns.

```javascript
const getValue = (enabled) => {
    if (enabled) return [];
    return ''; // reported
};
```

Return paths involving unknown values do not create a diagnostic. Known return
paths must agree on one value family; the rule does not widen incompatible
paths into a union or require a separate return annotation.
