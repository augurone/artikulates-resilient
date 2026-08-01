# no-nested-if

Disallows an `if` statement nested inside another `if` in the same function.
Flatten conditions with guard clauses and early returns.

```javascript
// Incorrect
if (isReady) {
    if (hasContent) return content;
}

// Correct
if (!isReady) return '';
if (!hasContent) return '';
return content;
```

An `if` inside a separate callback or nested function is a new function
boundary and is allowed. This is an enforced error, not a preference.
