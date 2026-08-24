# no-silent-catch

Disallow empty `catch` blocks that discard a failure without an explanation or
an intentional outcome.

## Smell

An empty catch block severs failure ownership: the caller cannot tell whether
the failure was handled, expected, translated, or forgotten. The barrier keeps
error context and the intended fallback, propagation, or cleanup visible.

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

The rule does not ban `try`, `catch`, `finally`, or `throw`. Those are
legitimate tools for API failure, cancellation, parsing, cleanup, and error
boundaries. A handler that logs with context, returns an explicit fallback,
translates an error, rethrows it, or performs cleanup is not considered silent.

Enable it through the opt-in safety preset:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [resilient.configs.safety];
```

The safety preset lets ESLint's core `no-empty` rule continue checking other
empty blocks while allowing this rule to own empty `catch` diagnostics.
