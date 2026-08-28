# no-silent-catch

Disallow `catch` blocks with no executable handling that discard a failure
without an explanation or an intentional outcome.

## Smell

An empty or comment-only catch block severs failure ownership: the caller
cannot tell whether the failure was handled, expected, translated, or
forgotten. The barrier keeps error context and the intended fallback,
propagation, or cleanup visible.

```javascript
// Incorrect
try {
    readConfig();
} catch (error) {}

// Correct: translate the failure at the boundary
try {
    readConfig();
} catch (error) {
    throw new Error('Could not read configuration', { cause: error });
}
```

All of these are silent and are reported:

```javascript
try {
    readConfig();
} catch (error) {}

try {
    readConfig();
} catch {}

try {
    readConfig();
} catch (error) {
    // A comment does not handle the failure.
}
```

The rule does not ban `try`, `catch`, `finally`, or `throw`. Those are
legitimate tools for API failure, cancellation, parsing, cleanup, and error
boundaries. A handler that logs with context, returns an explicit fallback,
translates an error, rethrows it, or performs cleanup is not considered silent.

Enable it through the opt-in safety preset:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [resilient.configs.safety];
```

The safety preset lets [ESLint's core `no-empty` rule](https://eslint.org/docs/latest/rules/no-empty)
continue checking other empty blocks while allowing this rule to own empty
`catch` diagnostics. This rule is intentionally stricter about comment-only
catches: a comment documents intent but does not handle, translate, rethrow, or
return from the failure.
