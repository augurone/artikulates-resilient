# prefer-safe-destructuring-defaults

Requires destructured values to declare explicit defaults. The rule does not
choose the default value; the author chooses the expected contract value.

## What this finding means

A destructured binding without a default leaves the missing-value contract
implicit and can produce an unstable value family downstream. The rule requires
each destructured level to state the value that absence should produce.

```javascript
// Incorrect
const timAllen = ({ timBurton } = {}) => timBurton;

// Correct
const timAllen = ({ timBurton = '' } = {}) => timBurton;
const getItem = ([item = {}] = []) => item;
```

Rest elements are exempt because they always produce an array or object value.
Guarded function-valued destructured bindings are also exempt; their
absence contract belongs to `no-unguarded-callback-invocation`, which requires
an `isFunction` or `typeof ... === 'function'` guard. `useState` tuple
destructuring is also exempt: the setter is an external function and does not
have a meaningful destructuring fallback.

## Generated model and discriminant boundaries

The TypeScript adapter may emit one direct model boundary where an object-family
stage, a field capability guard, and a structural falsifier occur together:

```javascript
const { _tag = '', value } = isObject(input) ? input : {};

if (!_tag) return { _tag, value };

return { ...input, _tag, value };
```

`value` remains generic and has no invented default. A known callback field
uses `isFunction`; an object or array field uses its own family/content
predicate. The failed path returns the structural model only, while the
positive path preserves supplied attributes.

The rule also accepts a generic payload only inside a static discriminant
branch: `Left/left`, `Right/right`, `Some/value`, or `Both/left/right`.
The guard must dominate the binding, or an opposite `Left`/`Right` branch must
terminate first. Dynamic predicates, arbitrary `isX` helpers, wrong payload
fields, and non-dominating guards remain findings.

## Boundaries and non-goals

Rest bindings, guarded callbacks, `useState` tuples, and documented
model boundaries retain their own absence contracts. The rule never invents a default.

## Repair recipes

Put the chosen falsey default beside each destructured binding. For an optional
callback, use [no-unguarded-callback-invocation](no-unguarded-callback-invocation.md).

## Evidence for callable consumers

A callable binding may omit a synthetic default when its use proves the
capability: a dominating direct-call guard, a guarded static collection
callback, or a resolved consumer whose corresponding parameter is invoked
only under its own guards. Static collection methods are `map`, `filter`,
`some`, `find`, `forEach`, and `reduce` in the binding's function. `sort` and
`toSorted` also admit a captured comparator in a nested function, with exactly
one argument and a guard at consumption.

Local and imported consumers use lexical binding and resolved function-body
evidence. Renaming a module or import, or adding an immutable identifier alias,
does not change the proof. Importing `flow` from `./function` grants nothing
by itself. An unguarded, unresolved, shadowed, reassigned, or escaping consumer
cannot establish the exemption. Fixed identifier parameters are supported;
rest, spread, defaulted and destructured consumer parameters, dynamic scope,
and uses through `arguments` remain outside this admission. Consumer predicates must resolve to synchronous function bodies with direct
`typeof` evidence; local aliases and imported or re-exported predicates retain
that evidence. An unresolved predicate does not prove safety.

A guard for one property never supplies evidence for a sibling property. The
safe-default finding remains a request for an explicit absence contract, not
a contract contradiction or permission to invent a no-op callback.

The finite syntax facts remain distinct: arity-selected rest tuples, tuple
carriers, guarded tuples (including same-receiver lifted failure), structural
model payloads, dominating discriminant payloads, identity-only provider and
selected-payload forwarding, exact map projections, fold-map identity, and
terminating variant loops. Their full grammar and counterexamples are covered
by `tests/prefer-safe-destructuring-defaults.test.js`. Cross-rule callable
fixtures are `tests/fixtures/rule-evidence/consumers.valid.js` and
`consumers.invalid.js`, verified by `tests/rule-evidence.test.js`.
