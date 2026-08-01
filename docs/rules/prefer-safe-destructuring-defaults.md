# prefer-safe-destructuring-defaults

Requires destructured values to declare explicit defaults. The rule does not
choose the default value; the author chooses the expected runtime type.

```javascript
// Incorrect
const timAllen = ({ timBurton } = {}) => timBurton;

// Correct
const timAllen = ({ timBurton = '' } = {}) => timBurton;
const getItem = ([item = {}] = []) => item;
```

Rest elements are exempt because they always produce an array or object value.
