# signature-contract-return-consistency

Reports functions whose known return paths produce incompatible value
families.

```javascript
const getValue = (enabled) => {
    if (enabled) return [];
    return ''; // reported
};
```

Return paths involving unknown values do not create a diagnostic. The rule is
intended to catch contradictions in executable behavior, not to require every
function to have an explicit return annotation.
