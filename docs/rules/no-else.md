# no-else

Disallows every `else` and `else if` branch. Use an early return or separate
guard clause instead.

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
