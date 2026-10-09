# prefer-safe-transformations

Prefer creating a new value for object and array transformations. Resilient
uses explicit transformation syntax rather than a sequence of hidden writes.
The rule is intentionally syntactic: it does not infer ownership from whether
the binding was created locally.

## What this finding means

In-place writes hide whether a value is being transformed, shared, or used as
an external boundary. Returning a new object or array makes the state
transition visible; deliberate mutable boundaries must be named explicitly.

```javascript
// Preferred: transform reducer state into a new value
const update = (
    { count = 0, ...state } = {},
    { value = '' } = {}
) => ({
    ...state,
    count: count + 1,
    value
});

// Incorrect: mutate data returned from an external boundary
const updateResponse = async (resp) => {
    const response = await resp.json();
    response.fields.red = 'blue';
    return response;
};
```

The rule reports direct assignments, updates, `delete`, common mutating methods
such as `push`, `sort`, `splice`, `set`, `add`, `clear`, and `delete`, and
`Object.assign` on object and array bindings. This includes locally created
working values:

```javascript
// Incorrect
const update = (
    { count = 0, ...state } = {},
    { value = '' } = {}
) => {
    const next = { ...state };
    next.count += 1;
    next.value = value;
    return next;
};
```

The same syntactic operations are reported when the receiver has no root
binding, such as `map.get(key).add(value)` or `getTarget().field = value`.
Their diagnostic says "this value" instead of inventing a binding name.
`ignoredParameters` and `ignoredBindings` match only a named root identifier;
`ignoredProperties` still matches the static property or method name on an
unnamed receiver. A dynamic property name has no property exception. The rule
does not infer the receiver's type or ownership from a method's spelling.

Return the transformed value directly instead:

```javascript
const update = (
    { count = 0, ...state } = {},
    { value = '' } = {}
) => ({
    ...state,
    count: count + 1,
    value
});

const collect = (items = []) => items.filter(({ enabled = false } = {}) => enabled);
```

Closure-owned accumulators and callback-local mutations are also rejected when
`filter`, `map`, or `reduce` expresses the transformation. Loop syntax is checked
by `prefer-prototype-methods`; mutation is checked independently by this rule.
A loop exception does not suppress mutation findings inside that loop.

Descriptor APIs need an ownership decision that method spelling alone cannot
provide. The public rule therefore does not classify every call named
`defineProperty` as mutation. Resilient's repository proof separately resolves
the native `Object.defineProperty`, `Object.defineProperties`, and
`Reflect.defineProperty` globals and rejects writes to parameter, imported, or
captured targets in the original-AST placement owner. Shadowed globals and
same-boundary private targets do not borrow that finding.

Draft-based reducers, caches, DOM objects, refs, and other explicitly mutable
boundaries can use narrow exceptions:

```javascript
export default [{
    rules: {
        'resilient/prefer-safe-transformations': ['error', {
            ignoredParameters: ['draft'],
            ignoredBindings: ['cache'],
            ignoredProperties: ['current']
        }]
    }
}];
```

Resilient's own analyzer has a separate internal exception policy. Its source
may use function-local `push`, keyed assignment, `Map#set`, `WeakMap#set`, or
`Set#add` for private traversal indexes and identity stores when replacing
values would create avoidable copying. A bounded cache may additionally use
`Map#delete` only for explicit LRU promotion or eviction. These exceptions are
kept at the smallest helper scope, state why the store is private, and do not
authorize mutation of AST nodes, inputs, returned contract data, or
consumer-owned objects. Fresh computed-key objects such as `{ [key]: value }`
remain the preferred non-mutating construction form.

The rule does not prevent a reducer from returning a changed state. It rejects
the in-place writes used to construct that state, unless the reducer is an
explicit draft-based boundary. The contract analyzer separately models
property updates so later reads can be analyzed.

## Boundaries and non-goals

The rule does not infer ownership. Drafts, caches, DOM objects, refs, and other
explicit mutable boundaries must be configured or isolated deliberately.

## Repair recipes

Build and return a new object or array with spread, `map`, `filter`, or `reduce`.
Use the documented configuration only for a real owned mutable boundary.
