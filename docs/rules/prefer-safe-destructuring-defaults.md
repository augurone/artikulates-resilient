# prefer-safe-destructuring-defaults

Requires destructured values to declare explicit defaults. The rule does not
choose the default value; the author chooses the expected contract value.

## Smell

A destructured binding without a default leaves the missing-value contract
implicit and can produce an unstable value family downstream. The rule requires
each destructured level to state the value that absence should produce.

```javascript
// Incorrect
const timAllen = ({ timBurton } = {}) => timBurton;

// Correct
const timAllen = ({ timBurton = '' } = {}) => timBurton;
const getItem = ([item = {}] = []) => item;
```

Rest elements are exempt because they always produce an array or object value.
Directly invoked function-valued destructured bindings are also exempt; their
absence contract belongs to `no-unguarded-callback-invocation`, which requires
an `isFunction` or `typeof ... === 'function'` guard. `useState` tuple
destructuring is also exempt: the setter is an external function and does not
have a meaningful destructuring fallback.
