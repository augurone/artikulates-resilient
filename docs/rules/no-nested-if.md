# no-nested-if

Disallows an `if` statement nested inside another `if` in the same function.
Flatten conditions with guard clauses and early returns.

## What this finding means

Nested conditions make the reader and runtime carry multiple gates before the
useful path can proceed. Guard clauses reject an inapplicable path early and
keep branching, recursion, and loop work from accumulating unnecessary state.

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
boundary and is allowed.

## Boundaries and non-goals

Nested functions establish new control-flow boundaries. Preserve returns,
throws, and effects while moving an outer condition into a guard.

## Repair recipes

Reject the inapplicable path first and leave the useful path unindented. See
the [migration playbook](../guide/migration-playbook.md) for staged repairs.
