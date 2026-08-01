# prefer-falsey-returns

Disallows returning `null` or `undefined` as a function result. Bare
`return;` statements are allowed for side effects and logical exits.

```javascript
// Incorrect
const getValue = () => null;
const getItems = (found) => found ? items : undefined;
const getUser = (id) => users[id] || null;

// Correct
const getValue = () => '';
const getItems = (found) => found ? items : [];
const getUser = (id) => users[id] || {};

// Correct control flow
const send = (payload) => {
    if (!payload) return;
    sendPayload(payload);
};
```

The rule checks direct return values and return-producing conditional or
logical expressions. It does not reject `null` nested inside a returned object,
such as `{ error: null }`.
