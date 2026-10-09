# TypeScript lowering pattern catalog

This catalog turns recurring TypeScript and JavaScript shapes into executable
Resilient forms. It is an implementation aid for the adapter, not a second
dialect specification. Decisions remain governed by [Grammar](grammar.md),
[Policy](policy.md), [Semantics](semantics.md), and the TypeScript adapter
[reference](typescript.md).

Use the pipeline for every entry:

```text
TypeScript AST/checker → Understand → Policy → Grammar → Lowering → Resilient output
```

The lowerer must establish the value's evidence, owner, absence behavior, and
required operation before choosing a target form. A lower lint count never
establishes those facts.

## Authored global console effects

A direct static call on the checker-proven standard global `console` owns
observable I/O. Policy selects `console-effect` at the original call range;
placement retains the receiver, arguments, call count, and return value. An
expression-bodied arrow may become a block with the same direct return to
place one adjacent `no-console` directive with the concrete authored-I/O
reason. Shadowed identifiers, computed members, and optional calls do not
inherit this agreement. This is a narrow operational boundary, not a claim
that console I/O is a pure transformation.

## Direct-call composition

When a source closure returns nested stage calls, including erased TypeScript
non-null assertions, retain the call expression. A source form such as
`return next!(first.apply(this, arguments))` emits
`return next(first.apply(this, arguments))`. Missing `next` throws only after
`first` runs; missing `first` throws before `next` is invoked. A guard that
returns undefined would change the failure contract. No special composition
classifier, callback, staged alias, or return default is necessary.

## Agreement ownership across lowering passes

One original TypeScript static read or binding has one lowering agreement. The
adapter collects checker-backed producer and consumer facts before member
lowering, Policy selects the grammar, and the placement pass emits it at the
source-equivalent scope. Later generic, residual, and final-binding passes may
preserve that completed agreement; they may not choose a second default,
extraction, guard, or exception for the same source read.

```text
original TypeScript range + checker symbol
  → producer and consumer facts
  → one agreement / grammar owner
  → source-time placement
  → later passes preserve the completed decision
```

This is adapter architecture, not a new dialect value model. It prevents
traversal order or cloned AST identity from becoming a semantic decision. A
missing agreement remains visible for the next adapter law; it does not become
an invented default.

## Binding and agreement patterns

| Source or bad output | Evidence and decision | Resilient target | Never emit |
| --- | --- | --- | --- |
| `user.name` from an owned input | `user` is an application-owned object and `name` is a known static member. | `({ name = '' } = {}) => name`, or a body binding when signature placement changes behavior. | Repeated `user.name` reads. |
| `value[key]` | `key` is runtime data. The property is dynamic rather than a static shape. | Keep `value[key]` explicit; attach a local dynamic-key boundary only when the rule reports. | A computed-binding IIFE fabricated solely to avoid member access. |
| `out[key] = source[key]`, `delete out[key]`, or `out[key]++` | The checker records the original indexed operation and Policy chooses a retained read or update. The assignment statement owns its write boundary; the RHS read remains independent if later grammar rebuilds the assignment. | Preserve the source indexed operation, key timing, mutation phase, postfix result, and narrow local boundary. | A generated-tree read/write classifier, an eager key binding, or treating the RHS as consumed by a statement that may be replaced. |
| `receiver.method()` | The method call depends on its receiver or is a prototype protocol. | Preserve `receiver.method()` or use a provider adapter that preserves the receiver. | `const { method } = receiver; method()` when it changes `this`. |
| `export const map = Namespace.map` | Namespace member is a statically resolved module export. | Emit a named import or direct named ESM re-export. | `export const { map } = Namespace` without an established member agreement. |
| `const map = factory(F, G).map` or `const { map } = factory(F, G)` | The checker proves a required callable result property; callee spelling is irrelevant. | Keep the native selected binding and its exact required boundary. Direct projections use `provider-edge`; source object bindings use `factory-required-binding`. | A synthetic resolver, early-return guard, default callback, or ownership inferred from a factory name. |
| `const { callback } = options` followed by invocation | Callback may be absent, and absence is meaningful. | Preserve absence and guard before invocation: `if (!isFunction(callback)) return {}; return callback();` | A synthetic no-op function default. |
| `const { payload } = branch` after a discriminant guard | Guard proves selected-property presence; payload family can remain generic. | Bind inside the guarded branch. Carry caller-owned/unknown payload evidence. | Signature extraction before the guard, or a primitive/object default invented for generic payload. |
| `switch (value._tag) { case 'Left': return onLeft(value.left) }` with a stable direct callee | Only the selected branch reads its payload; a function-signature binding would read it before the tag and can trigger an unselected getter or throw. | Checker-backed `selected-model-read` records the payload range and keeps the branch-local binding, with one exact signature-timing boundary. | Computed payloads, receiver-method calls, unknown callees, eager signature extraction, or invented generic defaults. |
| `const len = items.length` on a checker-proven standard array or tuple | Cardinality is a native array property Get at the declaration; an object binding claims the wrong input family. | `retain-array-cardinality-read` keeps `items.length` and attaches one exact core-rule boundary if reported. | `{ length: len = 0 } = items`, a changed getter phase, or assuming a custom object's `length` is an array. |
| `const { left } = value` before checking `value._tag` | No branch has established which union shape applies. | First resolve or guard the discriminator, then bind the selected payload. | Destructuring both possible payloads or using an empty object to choose a branch. |
| `const [value, state] = run(input)` | Tuple container is known; each member needs independent evidence. | Give each member its own canonical default, resolver, guard, or preserved unknown state. | A container default treated as agreement for all tuple positions. |
| `... [next, rest]` in an overload implementation | Supplied argument count controls overload dispatch. | Preserve the variadic tail and dispatch only on positions supplied by the caller. | Required defaults on omitted overload positions. |
| Direct `return f(args[1], args[0])` from a checker-proven fresh rest parameter | Numeric property reads occur at the return, in argument order; array destructuring would additionally acquire an iterator. | Bind numeric properties locally with exact `void 0` absence and preserve call order. The exact signature-destructuring boundary names the iterator reason on that binding. | Signature-time extraction, array iterator acquisition, a fabricated callback, or a family default. |
| Captured `f(a)(args[0])` where `args` is a checker-proven rest array | `f(a)` runs before the later index read; earlier extraction can change calls, throws, and inherited-index lookup. | Stage the produced callee once, bind numeric position `0` from the rest array with `void 0` absence, then call the staged result. This source-derived staging binding preserves the evaluation sequence. | A pre-call binding, iterable array destructuring, invented value-family default, callback, or blanket rest-array exception. |
| `while` over a checker-proven `.next()` result, guarded by `.done`, with an admitted `f(entry.value)` | The loop remains live; the payload exists only after admission. | Bind `value` in the admitted body immediately before the original call. | Hoisting `value` outside the body, materializing the iterator, or changing `.next()` count. |
| The same admitted loop starts its body with `const v = entry.value` | The source reads `value` once after `.done` and before the following statements. | Replace only that declaration with `const { value: v = void 0 } = entry`; keep the live loop. | Binding before admission, an alias result, a guessed payload default, or materialized traversal. |
| `n => combine(ta.left, n)` where `ta` is a checker-narrowed tagged union and `combine` is a stable parameter or function declaration | The callback may run later; its first-argument payload read occurs at invocation time. | Use a callback-local binding, then call `combine` with the bound payload. | Binding `left` in the enclosing branch, adding another callback, or treating a later operand as the first read. |
| `return () => f(M.empty)` with a required generic field on an outer parameter | The field Get occurs when the returned callback runs; its value is opaque. | Bind the field in that callback at the first-argument read, with exact `void 0` absence. | Hoisting into the outer signature or inventing a value-family default. |
| `return wa => wa(f(wa(M.empty)))` with the same required generic field | Earlier callback calls precede the field Get; a callback-entry binding changes their order. | Retain the nested read at its original phase with one exact member-access boundary on the owning return. | Eager extraction, replayed calls, or a guessed default. |
| `guard ? fallback : f(a)(selected.tuple[1])` with a checker-narrowed selected tuple | The first call produces a callee before the tuple getter and numeric property read. | Stage that source call inside the admitted branch, bind the numeric position with `void 0` absence, then invoke the staged result. | Hoisting the tuple read ahead of the call, acquiring its iterator, or treating a computed index as static. |
| `arrayLike.reduce(provider.method)` with checker-proven static callable projection | The `reduce` getter is evaluated before `provider.method`; a binding statement moves the latter too early. | Retain the expression with one exact local member-rule boundary and preserve its source receiver call. | Hoisted destructuring, a callback wrapper, a changed `this`, or a fabricated fallback when the method is non-callable. |
| `!method(prefix, selected.value[0]) || !other(next, selected.value[1])` with checker-proven tuple positions | Each method lookup and earlier argument precedes its own tuple read; `||` may skip the second call entirely. | Retain the source calls and reads with one exact local member-rule boundary on the guard, backed by the original checker facts. | Eager tuple binding, a combined payload read, changed receiver, or evaluating the skipped branch. |
| `receiver.method(selected.value[0], f(selected.value[1]))` with one checker-proven tuple-valued property | Receiver method lookup, two separate property Gets, and intervening argument work have distinct source phases. | Record both source read ranges and the owning statement; retain the call with one fact-backed member boundary. | One eager binding, array-iterator acquisition, computed positions, a spread argument, or rediscovery from emitted syntax. |
| Fresh returned record built by `for (const entry of entries) output[entry[0]] = entry[1]` | The live iterator, two numeric property reads, key coercion, inherited setter, and returned object identity belong to the source update. | Checker-proven operational object-builder agreement retains the exact loop, assignment, and direct return. | Indexed-read IIFE/default, object-spread rebind, array destructuring of `entry`, or callback reduction. |
| Fresh returned record built by `for (const [key, value] of entries) output[key] = value` | Entry destructuring acquires its iterator and may throw; the live indexed write can invoke an inherited setter or change the prototype. Adjacent statements do not change ownership of the consecutive builder unit. | The same operational object-builder agreement retains the original loop and write; no `Object.fromEntries` replacement. | Skipping entry iteration, converting `__proto__` into an own field, or moving the write to a new object. |
| `const output = Object.assign({}, record); output[key] = value; return output` | Copy and assignment are separate source phases; inherited setter and `__proto__` behavior belong to the indexed write. | Original-range `retain-indexed-update` fact keeps the write after the copy; no returned-object syntax lowerer. | `{ ...record, [key]: value }`, which defines an own field instead of performing the original assignment. |
| `const output = new Map(source); output.set(found.value[0], f(found.value[1])); return output` | Copy, `set` lookup, key read, `f`, value read, and update have distinct observable phases. Numeric property reads do not acquire the tuple iterator. | Checker-proven operational collection agreement retains the update. Any necessary lint boundaries name one exact rule per directive at the update. | Eager array binding, fabricated tuple default, immutable rebind, or a second key/value lookup. |
| `while (s._tag === 'Left')` with checker-proven `s` replacement and direct `return [s.right, ...]` | The mutable result's tag is read again each iteration; its payload and exit read have distinct source phases. | Keep the loop live; bind `_tag` at its head, `left` after preceding body effects, and `right` immediately before exit return. | A pre-loop tag snapshot, early payload read, reduction, or invented callback. |
| Indexed array element assigned to a function-local working value, then two static fields consumed in ordered additive updates | The field getters occur in different phases of each live iteration, after their own prefix and call-argument work. | Stage each prior accumulator value and preceding operands, bind each field at its source phase, then perform the original addition/call once. | Hoisting both fields to loop entry, reducing the live loop, reading a getter twice, or adding a member-access suppression. |
| `any`, `unknown`, or generic forwarding | The consumer has no family evidence yet. | Preserve the value; guard or resolve only at the consuming scope. | `''`, `0`, `{}`, `[]`, or no-op-function defaults used to quiet lint. |
| External SDK object | Third party owns the runtime shape. | Reshape it in one provider/boundary adapter into an owned Resilient model. | Leaking SDK member reads and optional defaults across application code. |

## Defaults, absence, and resolvers

| Agreement | Resilient form | Reason |
| --- | --- | --- |
| Known string | `{ label = '' } = {}` | `''` falsifies content while preserving string family. |
| Known number | `{ count = 0 } = {}` | `0` preserves numeric family. |
| Known boolean | `{ enabled = false } = {}` | `false` preserves boolean family. |
| Known object | `{ config = {} } = {}` | `{}` establishes a known object container. It is not an absence sentinel in a boolean test. |
| Known array | `[item = {}] = []` or `{ items = [] } = {}` | `[]` establishes the collection family. |
| Required known property with no canonical family | `{ map = requiredResolver('map') } = factory` | Resolver makes failure ownership explicit. |
| Optional callback | `{ callback } = {}` plus `isFunction(callback)` | `undefined` remains absence until capability is proved. |
| Generic payload | `{ value } = {}` within proven shape, with caller-owned evidence | Generic forwarding has no falsifiable default. |
| Unknown external value | Preserve or pass through a boundary resolver | The external owner supplies validation/normalization. |

`undefined` is absence. It is not a value-producing default. A function family
has no synthetic canonical default: it is required by a known agreement or
guarded as a capability.

## Union and control-flow patterns

### Discriminated branch

```ts
const read = (value: Either<E, A>) => {
    if (isLeft(value)) return value.left
    return value.right
}
```

The target keeps the property binding after the guard because the guard owns
the selected shape:

```js
const read = value => {
    const { _tag = '' } = value;

    if (_tag === 'Left') {
        const { left } = value;
        return left;
    }

    const { right } = value;
    return right;
};
```

When `left` or `right` is generic, no default is valid. The lowerer records a
branch-local, caller-owned agreement. If a target rule requires an exception,
the exception names that exact ordering and payload boundary; it is never a
file-wide union exception.

### Functional resolution of incompatible unions

```ts
const render = (value: string | User) => typeof value === 'string'
    ? value
    : value.name
```

Resolve incompatible representations into one explicit shape before later
consumption:

```js
const resolveStringOrUser = value => typeof value === 'string'
    ? { kind: 'string', value }
    : { kind: 'object', value: User(value) };
```

Do not choose `{}` or `''` merely because one branch is uncertain. A resolver
adds evidence; it does not erase disagreement.

### Branches without `else`

Use an early return when a branch terminates. When both branches contribute a
value, return a functional resolver result with one stable shape. Retain a
local branch boundary only when the source needs the lexical scope created by
the discriminant guard and cannot be represented as a resolver input.

The completed ordered-decision agreement distinguishes three source shapes:

```ts
if (first()) { return a() } else if (second()) { return b() }
return c()
```

The first arm terminates, so `else if` becomes a subsequent `if` at the same
phase. A callback-local guarded branch with a terminating simple alternate
suffix can use a negated guard, preserving the selected arm as a lexical block.
If both variant arms contain nested decisions and delayed payload reads, retain
the original decision and place one exact `no-nested-if` boundary from its
original-range fact. Never flatten by hoisting a payload Get or replaying a
predicate. Nonterminal arms do not enter the terminal-guard law.

Repeated checker-proven scalar parameter fields have a separate source-phase
recipe. For `value.x + effect() + value.x`, retain both Gets at their authored
positions with an exact member-access boundary; a shared signature or local
binding would merge the getter calls and move the second read before
`effect()`. The same fact protects repeated discriminator tests after
conditional-return reconstruction. A single read and a collection-valued
property do not enter this law; the latter still needs a distinct
default/phase agreement.

## Collections, access, and construction

| Bad output | Shape decision | Resilient remedy |
| --- | --- | --- |
| `out[i] = transform(items[i])` | Dynamic index and local array construction. | Lower proven traversal to `map`, `reduce`, `reduceRight`, `Array.from`, scan, or zip grammar. Keep dynamic reads explicit. |
| `next.push(value); return next` | Returned array is a transformation. | Return `[...items, value]`, or return the next accumulator from `reduce`. |
| `Object.assign(result, { [key]: value })` | Object update with known output ownership. | Return `{ ...result, [key]: value }`. |
| `delete result[key]` | Object reconstruction is required. | Rebuild from entries or a proven omission helper; keep dynamic key evidence explicit. |
| `const next = new Map(source); next.set(key, value)` | One immutable map update. | `new Map([...source, [key, value]])`. |
| Callback-local map accumulation | Keyed iteration requires mutable working state. | Use a fresh lexical `Map` boundary, return it from the callback, and prove it is not exposed before return. |
| `operations.reverse(value)` or `provider.add(left, right)` with a checker-resolved module export or typed callable property | A mutator-shaped name does not prove a standard mutable receiver, and a wrapper could change `this`, getter timing, or callback effects. | Retain the exact provider call with one source-fact-backed `prefer-safe-transformations` boundary on its statement or object property. Native prototype methods and computed calls reject this law. |
| `F.reduce(values, [], (acc, value) => { acc.push(value); return acc; })` with a checker-proven opaque provider property | Provider receives the seed and can observe whether the callback returns that same array. | Retain `push` and direct callback return under the operational collection agreement; place one exact mutation boundary on the update. Do not replace `acc` with a spread array. The same law covers a fresh standard Map seed and static `set`. |
| `const next = new Set(source); next.add(value)` | One immutable set update. | `new Set([...source, value])`. |
| Fresh standard-array `shift`/`unshift`/`push` queue under a live length-and-shift loop | Checker proves local queue identity, exact loop/update ranges, and non-escaping uses; nested updates remain directly owned. | Retain the live queue and source calls with exact local mutation boundaries. An immutable rebind, precomputed traversal, or iterator substitution changes visitation; custom, async, and escaped queues reject the law. |
| `set.forEach(value => output.push(value)); return output.sort(compare)` with standard Set and fresh output | `forEach` may be overridden or observe additions; `sort` returns the same callback-populated array. | Retain the callback update and native sort under one operational collection agreement. Do not materialize `set` or substitute `toSorted`; reject custom protocols and output aliases. |
| Copied `Set` visited by another Set's `forEach` with `member(value, result)` before guarded `result.add(value)` | The membership provider may observe working Set identity, and `forEach` remains live. | Retain one copied Set and its source-ordered membership/update calls with an exact local update boundary. No immutable rebind or iterator substitution; reject aliases, custom protocols, and computed updates. |
| Ordinary `for` loop | Classify map, filter, reduce, scan, zip, sparse traversal, early exit, and effects. | Lower only the classified equivalent. A retained loop states the specific observable property. |
| `for (const item of values) visit(item)` over a checker-proven standard array | The direct `for…of` acquires `values[Symbol.iterator]`; `values.forEach` can be overridden or visit sparse positions differently. | Retain the exact loop through its completed live-array fact. Do not create a new callback or replace it with `forEach`. |
| `for (const [key, value] of pairs) visit(key, value)` | Required entry binding acquires each entry's iterator and may throw on malformed input; synthetic position defaults change missing values. | Preserve native entry destructuring at the loop, with one exact default-rule boundary on that statement. No fabricated `''`/`0` defaults. |
| `for (let i = 1; i < limit; i++) output.push(f(i))` after a fresh first result | The checker proves a numeric counter, numeric bound, callback-fed update, fresh standard-array output, and direct owning return. There is no source collection whose prototype can perform the same traversal. | Retain the exact numeric-range loop and callback phase under `retain-numeric-range-builder`; reject indexed array-copy loops and unproved outputs. |
| `for (const key in value)` where `value` is a type parameter | The authored operation is native key enumeration; a type parameter supplies no runtime object-family claim. | Retain `for…in` at its source range and its native conversion/enumeration behavior. Do not invent `Object.keys(value)` or infer an object family from the generic type. |

Map and Set are valid mutable collection boundaries when keyed or membership
state is essential. Their mutability must remain lexical, fresh, explicit, and
returned or consumed within the owning algorithm. They do not authorize
mutation of input, external, or already-published values.

A fresh standard Map/Set *copy* updated within a synchronous live loop follows
the same operational collection agreement as an empty owned builder. A copy
alone does not authorize immutable rebinding: the loop must contain its static
update, ownership must stay local through direct return, and async, computed,
escaped, and mixed-update forms are rejected. The original iterator and copy
phases remain explicit.

For checker-proven materialized Map/Set traversal with a fresh directly
returned output, the collection agreement owns the complete reduction recipe
and its original loop/return range. Placement emits the immutable reduction.
The former array/scalar accumulator lowerers are removed: on direct live
standard-array loops they overrode the completed visitation outcome, and a
guarded filter/map split changed per-item effect order. Direct live traversal retains its
operational-builder agreement, including iterator timing and native entry
failure. This separation prevents a later syntax lowerer from choosing a
second Map/Set outcome.

## Factories, overloads, and callable contracts

| Source shape | Resilient remedy |
| --- | --- |
| Typeclass factory returns `{ map, ap, alt }` | Emit direct object construction for known factory output, or bind required selected properties with resolvers. |
| Curried operation supports one or two supplied arguments | Emit an arity resolver whose branches each have a stable callable/value contract. |
| Overloaded `f(a, b?)` returns `(b) => value` when `b === undefined`, otherwise returns `value` | Checker-backed arity partition retains both authored result channels and the strict selector. An explicit `null` stays on the supplied-value path. Place one exact declaration boundary and one exact selector boundary when the dialect cannot express the mixed return family. |
| Direct identifier call selects a callable-result overload with fewer arguments than its implementation's optional tail | Retain the exact source call and argument list under a checker-resolved call fact. The omitted optional implementation parameter is not a missing source-contract argument. No wrapper or default is emitted. |
| Direct call resolves to a lexical function declaration despite another same-named declaration with different arity | Retain the call under its resolved symbol and exact source range. A generated-name arity inference cannot replace the checker decision; actual missing arguments and member/computed calls do not enter this agreement. |
| Private module function with a checker-proven native `Function` optional tail and one protected `arguments.length` dispatch | Replace the optional tail with one fresh rest carrier only after the completed function-kind and privacy decisions. Declare removed formals once and guard each numeric object assignment by the private carrier's length at the source dispatch. Read the original `arguments.length` once for case selection. Emit no metadata call. Exported, escaped, captured, reflected, hoisted, mapped-arguments, direct-`eval`, shadowed/aliased `Function`, and unprotected cases retain source arity. |
| Ordinary function declaration | Preserve construction, own `prototype`, dynamic `this`, `arguments`, `new.target`, and required hoisting. Retain the native declaration if lifetime admission fails; otherwise use an arrow only with direct-call-only and simple-parameter proof, or a named native function expression. |
| Source `var` binding | Use in-place `const` or `let` only after each initializer completes before every observation. Otherwise a proved binding receives one scope-entry `let` and source-position assignments, including loop targets and repeated declarations. Reject unsupported eval, global, exported, captured-module, pattern, or conflicting bindings; successful output is var-free. |
| Finite `switch (tag)` has direct value returns for all typed literal cases, or a terminal bare return after its cases | Retain the switch and unmatched-selector no-value channel. A terminal `return;` may normalize to equivalent fallthrough. One exact `consistent-return` declaration boundary records why no default value is invented. Unknown selectors, defaults, and intervening control flow reject this outcome. |
| Direct `value == null` or `value != null` | Retain the one null-or-undefined abstract-equality operation under an original-range fact and one exact `eqeqeq` statement boundary. Do not replace it with strict comparison or reevaluate an arbitrary operand. Other loose equalities do not enter this agreement. |
| `flow` uses `arguments` and returned function `this` | Retain the named normal function expression with a local reason. An arrow changes semantics. |
| Function parameter is present but unused | Preserve its source position and observable `.length`; a checker-proven unread formal may be explicitly discarded with `void parameter` in the body. Do not synthesize parameters from an erased type signature. |
| Optional function-valued property | Guard callability at the receiving scope; do not replace it with an empty function. |
| Required callable parameter field forwarded to an identifier/static member consumer or returned by a block/expression-bodied function | Use the shared exact-provider-forward agreement at the original read position. Preserve exact `undefined` absence and consumer-owned invocation failure; do not synthesize a guard or callable fallback. |

## Async, effects, and return contracts

| Source shape | Resilient remedy |
| --- | --- |
| Independent promises | `await Promise.all([...])`. |
| Ordered or stateful promises | Sequential `await` in source order. |
| Deferred task thunk `() => Promise.resolve().then(run)` | Use an `async` thunk that preserves the initial asynchronous boundary before calling `run`. |
| Required protocol promise chain | Retain the chain with a local reason that names the API contract and rejection owner. |
| Dropped `.then(resolve)` inside the owning native Promise executor | If checker evidence proves the static Promise chain and resolver symbol, emit `void chain;` to expose existing detachment. Preserve fulfillment-only forwarding and pending-on-rejection behavior; do not add a catch or return the chain. Keep one exact async-style reason because `await` changes rejection ownership. |
| Intentional never-settling task | `new Promise(() => {})`. |
| Effectful no-value path | Bare `return;` or an explicit effect boundary. |
| Value-producing return | Return the known family's canonical empty value only when source agreement establishes that family. |

Never return `undefined` to make a value-producing function appear complete.
Never replace a required function with a no-op function. Return agreement is a
property of every executable path, not a formatter concern.

## Binding-use and typed-call patterns

Required tuple binding with an opaque or callable slot retains the source
binding and its native iterator and missing-slot behavior:

```tsx
const run = <A, B>(pairs: ReadonlyArray<[(value: A) => B, A]>) =>
    pairs.map(([f, value]) => f(value));
```

The checker proves the declared tuple positions, not runtime validity.
`[f, value = 0]` would change an omitted argument; an invented callable
would change the native failure. Local direct and nested tuple declarations
follow the same owner/position agreement. A final exact boundary is allowed
only for surviving required positions, while a lawful explicit source default
remains untouched.

An unread catch binding can become `catch {}`. An unread plain tuple slot can
be elided only if its iterator advancement and surrounding defaults stay
unchanged. An unused formal stays in place because removing it—or adding a
formal from an erased signature—changes `.length`. The source checker fact,
not emitted syntax, chooses the outcome. A typed call that supplies an
argument ignored by a zero-parameter implementation retains both the argument
evaluation and the zero-parameter function; an exact call-site boundary is
permitted only when checker evidence traces that relationship. Effectful
initializers or defaults are never removed to satisfy unused-binding lint.

## Printer/layout patterns

After semantic placement, long named imports may split at import specifiers;
expression-bodied arrows may parenthesize and wrap their body; and export-list
closing braces may move below the last specifier. These are layout laws, not
new source classifiers. Exact-rule comments should state the shortest concrete
source timing or failure reason that remains accurate. No generated artifact
is edited by hand.

## Provider-owned callback parameter

```tsx
provider.map(values, values => {
    values.push(next);
    return values;
});
```

When the checker proves a standard Array callback parameter or a type whose
base chain reaches standard Array, the provider
owns that value and may observe its identity across calls. The completed
collection agreement retains the direct update and places only an exact
mutation boundary. The same operation law covers standard Map `set` and a
source-time static field selection such as `const selected = box.values;`;
the latter may become a same-statement binding but never receives an invented
`[]` default. A static numeric selection such as `box.pair[0].push(value)`
retains its native Get rather than becoming an iterator-based binding with a
new default. A computed mutator, dynamic index, unknown protocol, or fresh
local value is not admitted by this fact.

## Declared nullish-result pattern

```tsx
const unit: { run: () => void } = { run: () => undefined };
const optional = (enabled: boolean): number | undefined => {
    if (enabled) return 7;
    return undefined;
};
```

The checker-backed producer result, not the spelling `undefined` alone,
admits this pattern. A sole direct undefined result becomes an empty body;
mixed results retain the authored return at its branch with one exact
`prefer-falsey-returns` boundary. Nullable `null` is retained likewise.
Inferred, `any`/unknown, and shadowed non-undefined results are rejected.
This is general TS result grammar, not a corpus-name rule.

## Native hoisting and live own-key traversal

```tsx
export function tree(n: number): number {
    return n ? forest(n - 1) : 1;
}
export function forest(n: number): number {
    return n ? tree(n - 1) : 2;
}
```

Checker-resolved mutual declarations stay `function` declarations. A source
forward reference receives one exact local boundary; dependency-graph cycle
membership selects the recursion-specific reason, while an acyclic reference
records authored order. The transform never replaces a cycle with TDZ-prone
arrows or moves an authored initializer to silence it.

For declaration syntax, use the completed `declaration-lifetime` decision.
Direct initialized `var` declarations whose checker identities remain inside
one owner may become `const` or `let` according to resolved writes. Retain
`var` for block escape, loop lifetime, early reads, captures, redeclarations,
script globals, direct evaluation, or missing checker proof. Never move the
initializer to make a lexical declaration appear safe.

Authored top-level runtime statements remain in source order, including
function-valued and literal bindings: circular module evaluation can observe
which otherwise passive bindings have initialized. Generated helpers are placed
separately: eager reads constrain the legal insertion point, while deferred
closure reads may influence placement only before the helper's first eager
authored consumer. Resolve equal spellings by checker binding identity; a
nested shadow never creates an outer dependency.

```tsx
for (const key in source) {
    if (owns(source, key)) output[key] = source[key];
}
```

For a checker-proven object source and guarded indexed write, retain `for…in`
and its guard. Do not snapshot keys or replace the write with a callback. The
source-range agreement supplies the exact loop boundary, not a generated-text
classifier.

## Boundary decision checklist

`let state = namespace.none` with a checker-resolved static property becomes
`let { none: state = void 0 } = namespace` at the original Get. A chain such
as `const has = Object.prototype.hasOwnProperty` becomes a nested binding from
`Object`, with no default on `prototype` because its absence must still throw.
Nested reads from a parameter that signature grammar may replace remain
outside this law; a source-range fact must establish joint ownership first.

An ordered comparison such as `x === y ? 0 : isVariant(x) ?
(isVariant(y) ? compare(x.value, y.value) : 1) : isVariant(y) ? -1 : 0`
keeps the second parameter's tag binding after the identity and first
predicate probes. The checker must resolve the predicates; a boolean helper
is insufficient evidence. `let result = arguments[0]` followed by dynamic
`arguments[i]` reads keeps the real `IArguments` object live, with an exact
core destructuring boundary only on the static position. Neither pattern
licenses a guessed default, a signature hoist, or iterator materialization.

`class Cell { constructor(v) { this.read = this.read.bind(this) } read() { ... } }`
with a checker-resolved `new Cell(...)` retains the native class at the
provider boundary. Its already-authored instance methods are the functional
consumer shape. Replacing the class with a plain factory changes construction,
prototype, and bound-method observables; one exact class-rule boundary names
that reason. An unconstructed or unbound class needs its own agreement, not
this retained outcome.

Before adding a lowerer or exception, answer these questions in order:

1. Who owns the incoming value: application, caller, compiler, or third party?
2. Is evidence known, unknown, or contradictory at this exact use?
3. Is the operation static selection, dynamic access, receiver protocol,
   mutation, forwarding, or invocation?
4. Does the source establish a family and a falsifiable default?
5. If no default exists, does a guard, required resolver, or caller-owned
   forwarding preserve the agreement?
6. Would a grammar rewrite change getter timing, receiver binding, arity,
   identity, evaluation order, failure ownership, or queue semantics?
7. Can a provider or a dedicated grammar resolver contain the boundary?
8. If an exception remains, does its adjacent reason state the exact boundary
   and why the otherwise preferred grammar changes source meaning?

The closest implementation models are `rules/contracts/model.js` for evidence
states, `infer.js` for bindings and residual contracts, and `flow.js` for
guard-established ownership.
