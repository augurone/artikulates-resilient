# Resilient Migration Playbook

This playbook turns the rule set into an adoption guide. Start here when you
are introducing Resilient into an existing codebase or when you want a
consistent remediation path for repeated lint failures.

The playbook is organized by first failure shape rather than by implementation
detail. Each entry points back to the rule documentation for the full smell,
examples, and exceptions.

## How To Use This Guide

1. Fix the earliest boundary failure first.
2. Prefer the smallest edit that makes the contract visible.
3. Keep legitimate boundary exceptions explicit rather than hidden.
4. Re-run lint after each cluster of changes so downstream diagnostics stay
   meaningful.

## Rule Map

| Rule | First Failure | Low-Friction Remediation | Fix Potential |
| --- | --- | --- | --- |
| [no-destructuring-fallback](../rules/no-destructuring-fallback.md) | `pattern || {}` around object destructuring | move the default into the signature or declaration | high |
| [no-else](../rules/no-else.md) | alternate branch after an early return | flatten to an early return | high |
| [no-length-comparison](../rules/no-length-comparison.md) | `.length === 0` / `.length !== 0` / `.length > 0` | use `!length` or `length` | high |
| [no-null-assignment](../rules/no-null-assignment.md) | explicit `null` assignment | use the contract’s empty value or remove the assignment | medium |
| [no-undefined-assignment](../rules/no-undefined-assignment.md) | explicit `undefined` assignment | use the contract’s empty value or remove the assignment | medium |
| [no-silent-catch](../rules/no-silent-catch.md) | empty or comment-only `catch` | handle, translate, rethrow, or return a fallback | high |
| [no-unguarded-callback-invocation](../rules/no-unguarded-callback-invocation.md) | direct invocation of an optional callback | guard with `isFunction` or `typeof === 'function'` | high |
| [no-unhandled-promise-chain](../rules/no-unhandled-promise-chain.md) | dropped `.then` / `.finally` chain | `await`, `return`, assign, `void`, or `.catch` | high |
| [no-undefined-comparison](../rules/no-undefined-comparison.md) | equality test against `undefined` | use `!value` or `!!value` | medium |
| [no-nested-if](../rules/no-nested-if.md) | nested `if` in the same function | split into guard clauses | high |
| [prefer-async-await](../rules/prefer-async-await.md) | handled `.then` chain that is only sequencing work | convert to `async` / `await` when timing stays equivalent | medium |
| [prefer-destructured-member-access](../rules/prefer-destructured-member-access.md) | repeated static member access on owned parameter data | destructure once near the boundary | medium |
| [prefer-falsey-returns](../rules/prefer-falsey-returns.md) | `null` / `undefined` in a value-producing return | return `''`, `[]`, `{}`, `0`, or `false` | medium |
| [prefer-prototype-methods](../rules/prefer-prototype-methods.md) | imperative collection loop | use `map`, `filter`, `reduce`, `some`, `find`, or `forEach` | medium |
| [prefer-safe-destructuring-defaults](../rules/prefer-safe-destructuring-defaults.md) | destructured binding without a default | add the explicit default at the boundary | high |
| [prefer-safe-transformations](../rules/prefer-safe-transformations.md) | mutating a binding, property, collection, or `Object.assign` target | return a new object or array | medium |
| [prefer-signature-destructuring](../rules/prefer-signature-destructuring.md) | body destructuring from a simple parameter | move destructuring into the function signature when the parameter is owned | medium |
| [signature-contract-call-site](../rules/signature-contract-call-site.md) | known invalid argument, arity, or excess property | align the call with the provider contract | medium |
| [signature-contract-destructuring](../rules/signature-contract-destructuring.md) | known shape contradicts destructuring or a named property is absent | normalize first, change the pattern, or restore the property | medium |
| [signature-contract-operation](../rules/signature-contract-operation.md) | known wrong native method for a value family | use the correct operation or normalize first | medium |
| [signature-contract-property](../rules/signature-contract-property.md) | known missing property on a closed object | rename, remove, or widen the source contract | medium |
| [signature-contract-return-consistency](../rules/signature-contract-return-consistency.md) | mixed known return families | make all known return paths agree | medium |

## Rule-by-Rule Migration Notes

### no-destructuring-fallback

- First failure: `const { items = [] } = data || {};`
- Low-friction remediation: move the default into the destructuring site,
  usually the function signature or declaration.
- Keep if: the `||` is doing ordinary value selection, not contract setup.
- Future fix shape: simple rewrite. 

### no-else

- First failure: `else` or `else if` after a returnable guard.
- Low-friction remediation: return early and keep the main path unindented.
- Keep if: none; the rule is intentionally absolute.
- Future fix shape: simple rewrite.

### no-length-comparison

- First failure: `items.length === 0`, `0 !== items.length`, or `items.length > 0`.
- Low-friction remediation: use `!items.length` for empty and `items.length` for
  non-empty.
- Keep if: exact cardinality matters, such as `length === 1`.
- Future fix shape: simple rewrite plus suggestion.

### no-null-assignment

- First failure: assigning `null` as a generic value.
- Low-friction remediation: use the contract-appropriate empty value, or remove
  the assignment entirely.
- Keep if: the boundary explicitly owns `null` as an incoming state.
- Future fix shape: medium, because replacement depends on surrounding intent.

### no-undefined-assignment

- First failure: assigning `undefined` as a generic value.
- Low-friction remediation: use the contract-appropriate empty value, or remove
  the assignment entirely.
- Keep if: the boundary explicitly owns `undefined` as a meaningful input state.
- Future fix shape: medium, because replacement depends on surrounding intent.

### no-silent-catch

- First failure: empty `catch {}` or comment-only `catch`.
- Low-friction remediation: log with context, translate, rethrow, return a
  fallback, or clean up explicitly.
- Keep if: never; a catch must do something visible.
- Future fix shape: medium, because the right action depends on failure policy.

### no-unguarded-callback-invocation

- First failure: invoking a callback that was destructured as optional.
- Low-friction remediation: guard with `isFunction(callback)` or
  `typeof callback === 'function'` before calling it.
- Keep if: the callback has an explicit default value already.
- Future fix shape: medium, because the guard shape must preserve intent.

### no-unhandled-promise-chain

- First failure: a bare `.then(...)` or `.finally(...)` expression statement.
- Low-friction remediation: `await` it, `return` it, assign it, `void` it, or
  attach `.catch(...)`.
- Keep if: the chain is intentionally owned by another API boundary.
- Future fix shape: medium; ownership form changes with call-site context.

### no-undefined-comparison

- First failure: `value === undefined` or `typeof value === 'undefined'`.
- Low-friction remediation: use truthiness checks when the code is asking about
  presence rather than exact identity.
- Keep if: exact `undefined` identity is part of the external contract.
- Future fix shape: simple rewrite.

### no-nested-if

- First failure: an `if` nested inside another `if` in the same function.
- Low-friction remediation: split the outer condition into an early return.
- Keep if: a nested `if` is in a separate callback or function boundary.
- Future fix shape: medium; usually a structural rewrite.

### prefer-async-await

- First failure: a handled promise chain that could be written sequentially.
- Low-friction remediation: convert to `async` / `await` when timing, returned
  shape, and error behavior stay equivalent.
- Keep if: the API requires a chain or the sequence is intentionally chain-shaped.
- Future fix shape: medium; not always safe to auto-apply.

### prefer-destructured-member-access

- First failure: repeated static access like `user.name` or `user.id` on owned
  parameter data.
- Low-friction remediation: destructure once near the boundary.
- Keep if: the receiver is a platform object, dynamic access is the contract,
  or the member is part of a `.reduce` accumulator.
- Future fix shape: medium; scope and aliasing matter.

### prefer-falsey-returns

- First failure: returning `null` or `undefined` from a value-producing path.
- Low-friction remediation: return the contract’s empty value instead.
- Keep if: the function is side-effect only and uses bare `return;`.
- Future fix shape: medium; the replacement depends on the return family.

### prefer-prototype-methods

- First failure: a loop that is really a collection transform.
- Low-friction remediation: use the native collection method that states the
  operation.
- Keep if: the loop uses `await` for sequential, rate-limited, retrying, or
  polling work, or uses direct loop control for explicit early termination.
  Other necessary loops need `// resilient-allow-loop: reason` explaining the
  retained pattern.
- Future fix shape: medium; not every loop can be rewritten safely.

### prefer-safe-destructuring-defaults

- First failure: destructured binding without an explicit default.
- Low-friction remediation: add the default where the boundary is declared.
- Keep if: the binding is a rest element, an immediately invoked callback, or
  a `useState` tuple.
- Future fix shape: high; many cases are mechanical.

### prefer-safe-transformations

- First failure: mutating a binding, property, collection, or shared value in
  place.
- Low-friction remediation: return a new object or array instead.
- Keep if: the code is inside an explicit mutable boundary like a draft reducer,
  cache, DOM object, or ref.
- Future fix shape: medium; must preserve ownership and sequencing.

### prefer-signature-destructuring

- First failure: destructuring a simple parameter inside the body instead of in
  the signature.
- Low-friction remediation: move the shape to the boundary when the parameter
  is owned and not forwarded later.
- Keep if: the function must preserve an external callback signature, forward
  the whole object, or rely on dynamic property access.
- Future fix shape: medium; scope and forwarding need checks.

### signature-contract-call-site

- First failure: a known bad argument, too many or too few arguments, or excess
  direct properties on a closed object call.
- Low-friction remediation: align the call with the provider’s actual signature
  and return contract.
- Keep if: the argument is unknown, spread, or part of an intentionally open
  residual object.
- Future fix shape: medium; the source of the mismatch must be traced.

### signature-contract-destructuring

- First failure: a known value is destructured as the wrong shape or a named
  property is absent from a known closed object.
- Low-friction remediation: normalize the value first or change the pattern to
  match the evidence.
- Keep if: the value is unknown or the destructuring is intentionally dynamic.
- Future fix shape: medium; depends on upstream normalization.

### signature-contract-operation

- First failure: using a string operation on array-like data, or a collection
  operation on string-like data.
- Low-friction remediation: use the correct operation for the actual family, or
  normalize the value first.
- Keep if: the value is unknown or the operation is outside the known table.
- Future fix shape: medium; mostly mechanical once the family is known.

### signature-contract-property

- First failure: reading a property that is not present on a known closed object.
- Low-friction remediation: fix the property name or return a contract that
  actually exposes it.
- Keep if: the object is open, dynamic, external, or inherited from a platform
  object.
- Future fix shape: medium; needs contract source visibility.

### signature-contract-return-consistency

- First failure: one known return path produces one family while another known
  return path produces a different family.
- Low-friction remediation: converge the return paths on one family.
- Keep if: the branch value is unknown and not statically provable.
- Future fix shape: medium; usually a small flow rewrite.

## Fix Backbone Fields

If this playbook later feeds automated or assisted fixes, these fields are the
right minimum vocabulary:

- `firstFailure`
- `lowFrictionRemediation`
- `keepIf`
- `exceptionBoundary`
- `fixPotential`
- `relatedRules`
- `exampleBefore`
- `exampleAfter`

Those fields are intentionally small. They are enough to drive a useful fix
assistant without turning the playbook into a separate policy language.
