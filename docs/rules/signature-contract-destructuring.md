# signature-contract-destructuring

Reports known value shapes that contradict an object or array destructuring
pattern.

## Smell

Destructuring with the wrong object-or-array shape assumes a runtime contract
that the available evidence has already disproved. The rule catches that
boundary mismatch without treating unknown values as failures.

```javascript
const getValue = ({ value = [] } = {}) => {
    if (!Array.isArray(value)) return {};

    const { attr = '' } = value; // reported: array-like as object-like
    return attr;
};
```

Unknown values remain unknown and are not reported. Nested patterns are checked
by their own shape: an object element inside an array pattern is valid.

```javascript
const [{ attr = '' } = {}] = []; // valid
```

Computed object properties are also valid for array-like values because arrays
are objects at runtime:

```javascript
const getValue = (items = []) => {
    const { [0]: value = {} } = items;
    return value;
};
```

The rule is enabled by `resilient.configs.contracts`.
