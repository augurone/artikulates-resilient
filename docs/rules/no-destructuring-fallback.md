# no-destructuring-fallback

Disallows using `||` to provide a fallback object in an object destructuring
declaration.

## What this finding means

Destructuring through `data || {}` hides the boundary's expected shape and
mixes value selection with contract definition. The rule keeps fallback
semantics at the destructured signature or declaration, where the expected
value family is visible.

```javascript
// Incorrect
const {items = []} = data || {};

// Correct
const process = ({data: {items = []} = {}} = {}) => items;
```

The rule does not prohibit `||` for ordinary value selection.

## Boundaries and non-goals

Only destructuring fallbacks are covered; ordinary value selection is not.

## Repair recipes

Move the object and property defaults to the declaration or signature. See the
[migration playbook](../guide/migration-playbook.md) for boundary refactoring.
