# prefer-signature-destructuring

Require object destructuring to happen in the function signature instead of the function body when that signature is part of the function’s contract.

## Why

This rule supports a style where function boundaries carry meaningful information.

Benefits:

- the reader sees the expected shape immediately
- defaults can be applied at the boundary
- the body contains less extraction and bookkeeping
- review discussions shift from style policing to actual design questions

## Rule Details

This rule reports cases where a function receives a simple identifier parameter and then destructures that parameter inside the function body.

### Incorrect

```javascript
const processUser = (user) => {
    const { name, age } = user;
    return `${name} (${age})`;
};

const getItems = (response) => {
    const {
        data: {
            items = []
        } = {}
    } = response;

    return items;
};
```

### Correct

```javascript
const processUser = ({
    name = '',
    age = 0
} = {}) => `${name} (${age})`;

const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

## When Not To Use

This rule is not a good fit for every function.

Examples where you may want to disable or avoid it:

- callbacks that must match an external signature
- functions that intentionally pass the full object through unchanged
- cases where dynamic property access is the real contract

## Relationship To Larger Standards

This rule works best as part of a broader style system that also prefers:

- predictable return types
- defensive defaults
- truthy/falsy emptiness checks
- early returns
- functional transformations over imperative loops
