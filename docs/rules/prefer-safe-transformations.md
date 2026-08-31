# prefer-safe-transformations

Prefer creating a new value for object and array transformations. Resilient
uses explicit transformation syntax rather than a sequence of hidden writes.
The rule is intentionally syntactic: it does not infer ownership from whether
the binding was created locally.

## Smell

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
`filter`, `map`, or `reduce` expresses the transformation. An ordinary
imperative loop is owned by `prefer-prototype-methods`; this rule does not add a
second mutation diagnostic for that same loop. Mutation inside an excepted loop
is still reported here.

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
