# signature-contract-destructuring

Reports known value shapes that contradict an object or array destructuring
pattern, including a missing property on a known closed object.

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

A property with a default expresses intentional absence and is not reported as
missing. Object rest keeps the remaining object open, so unsupported property
names remain unknown rather than becoming false findings:

```javascript
const getUser = () => ({ name: '' });

const { name, missing = '' } = getUser(); // valid: the default owns absence
const { nmae } = getUser(); // reported: `nmae` is absent
```

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
