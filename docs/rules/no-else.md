# no-else

Disallows every `else` and `else if` branch. Use an early return or separate
guard clause instead.

## Smell

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
