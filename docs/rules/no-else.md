# no-else

Disallows every `else` and `else if` branch. Use an early return or separate
guard clause instead.

## What this finding means

An alternate branch keeps the main path nested and makes later work depend on
more active conditions than necessary. Guard clauses and early exits expose
the decision, avoid work on rejected paths, and keep loop or recursive bodies
from carrying avoidable state.

```javascript
// Incorrect
if (condition) {
    return valueA;
} else {
    return valueB;
}

// Correct
if (condition) return valueA;
return valueB;
```

## Boundaries and non-goals

The rule changes branch shape, not the decision itself. Preserve the original
return, throw, and side-effect ownership when moving the rejected path first.

## Repair recipes

Turn the alternate condition into an early return, then leave the successful
path unindented. See [Writing Resilient](../ai/writing-resilient.md) for
boundary-first control flow.
