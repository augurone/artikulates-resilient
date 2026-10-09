# TypeScript lowering algebra

This catalog records proven TypeScript-to-Resilient translation laws. It is an
adapter reference, not a second dialect specification and not an executable
test input. Grammar, Policy, and Semantics remain authoritative for the target
language. `rules/contracts/` remains an independent reference implementation.

Every entry follows the adapter sequence:

```text
TypeScript AST/checker → Understand → Policy → Grammar → Lowering → output
```

The adapter records a source range and checker symbol for the binding it
understands. Later passes consume that completed agreement; they do not infer a
new one from a cloned generated node.

## Native function capability preservation

An ordinary function declaration owns callable capabilities that arrow syntax
does not: construction, an own `prototype`, dynamic `this`, `arguments`, and
`new.target`. Understand resolves the declaration symbol and all of its source
references, and recognizes `new.target` as a `MetaProperty` whose keyword is
`NewKeyword`. Nested arrows stay in the declaration's lexical capability
region; nested ordinary functions do not.

Policy chooses exactly one completed outcome. A declaration may change syntax
only with one body-bearing declaration directly in its module or function body,
complete checker references in that same owner after the declaration ends, and
no export, write, capture, self reference, redeclaration, or direct `eval`
exposure. An arrow also requires direct ordinary calls, simple identifier
parameters, and no lexical receiver, `arguments`, or `new.target` capability.
Otherwise an admitted conversion uses a named native function expression.
Failed or missing lifetime evidence retains the native declaration with an
exact `func-style` boundary; absence of sensitive body syntax is never
equivalence proof.

The proof covers construction, own-prototype observation, dynamic receivers,
`arguments`, direct and nested-arrow `new.target`, escaping/exported functions,
early calls, ordinary-call admission, raw/fixed lint, and runtime parity.

## Declaration lifetime and initialization

Declaration syntax is chosen only after Understand records the checker symbol,
owning function or module scope, lexical declaration region, initialization
phase, reads, writes, early references, captures, and redeclarations. Equal
names in sibling or nested scopes never share this evidence.

An ordinary function declaration remains hoisted whenever the bounded lifetime
proof fails, including a writable, captured, recursive, exported, or
eval-exposed binding. The local `no-use-before-define` boundary belongs to an
actual early-reference statement, while the `func-style` boundary belongs to
the retained declaration. A direct-eval-observable name with no static read
also needs an exact `no-unused-vars` boundary.

A source `var` first uses in-place `const` or `let` when its complete checker
references stay in one direct owner body after each binding's own initializer,
with no export, capture, redeclaration, or eval exposure. Writes select `let`;
their absence selects `const`. Otherwise a proved function-local or bounded
module binding receives one uninitialized scope-entry `let`, after directives,
while each initializer remains an assignment at its original statement or loop
phase. Repeated declarations share the checker-identified binding; a simple
parameter redeclaration reuses the proved parameter binding. Eval-exposed,
script-global, exported, captured-module, destructured, conflicting, and
missing-evidence bindings report unsupported lowering. Successful output has
no `var` declaration nodes. Authored `let` and `const` keep their native
temporal dead zone.

The proof covers nested early calls, sibling scopes, nested declaration cycles,
block escape, reads before `var` assignment, safe and reassigned `var`, writable
function bindings, native TDZ failure, raw/fixed lint, and runtime parity.

## Authored evaluation order and generated placement

Top-level authored runtime statements keep their source order. Understand uses
checker symbol identity to distinguish a reference to a candidate binding from
an equal spelling in a nested scope, and records whether the reference is read
while an initializer runs or only when a created closure is later invoked.
Neither kind licenses moving an authored initializer: an eager forward read may
own a native temporal-dead-zone failure, while moving a deferred closure can
change which bindings are initialized during circular module evaluation.

Generated helpers are scheduled separately. An eager dependency is a hard
placement constraint. A deferred helper dependency may guide lint-clean
placement only while the helper still precedes its first eager authored
consumer. Arity metadata is generated work that depends eagerly on its lowered
function binding, so it is placed after that binding and before later authored
observation. A forward reference is evidence to inspect, not proof of
recursion: graph membership selects the recursion-specific boundary, while an
acyclic forward reference receives an authored-order boundary. Both retain the
authored statement position.

The proof compares source, raw output and fixed output for effect traces,
throwing getters, shadowed equal names, deferred captures, circular module
initialization, native TDZ failure, generated helper placement and existing
hoisted cycles. Equal final values are not sufficient evidence because
evaluation order and failure phase are observable.

## Fresh rest-array fixed-position selection

The checker must identify the indexed receiver as the actual rest parameter,
not an alias or generic array. A direct return call is eligible only when its
callee is a checker-proven parameter identifier and every argument is a fixed
numeric read of that rest array. Understand records the return range and
positions in source argument order; Policy selects one source-time selection.

Grammar binds those numeric properties immediately before the return call,
using an object binding so it does not acquire `Symbol.iterator`. A missing
position has the exact `void 0` result. Placement attaches the one local
`signature-contract-destructuring` boundary because array destructuring would
change observable iterator behavior. Captured reads in a returned closure
retain their later evaluation point. Dynamic indices, aliases, receiver-member
callees, and generic arrays do not satisfy this law.

The proof includes omitted positions, getter order, a poisoned array iterator,
rejected shapes, raw/fixed lint, and source/generated runtime parity. It does
not authorize the same binding for iterator payloads or discriminated models.

## Checker-backed optional arity carrier

An authored module function whose optional tail is spelled with the native
global `Function` type may enter rest-carrier grammar only after Understand
records the function identity, native `Function` identity, one direct
`arguments.length` dispatch, every optional parameter read and write, strict
unmapped arguments, and the absence of direct `eval`. Its binding and inner
name must be private: every reference is a direct ordinary call after lawful
initialization, with no export, capture, alias, metadata observation or
construction. A declaration additionally needs the completed native-expression
decision. A shadowed or aliased `Function`, a script with mapped arguments, an
explicit strict directive, or an optional use outside its admitted arity branch
retains source arity.

Policy selects either `lower-arity-from-source-facts` or
`retain-source-arity`. Grammar replaces a proved private optional tail with one
fresh rest carrier and emits no metadata restoration. Observable functions
keep their original signature and `.length`. Each removed formal is declared
once. Immediately in the source dispatch expression, a private-carrier length
guard admits a numeric object
assignment from the corresponding rest position. The guard is required: an
omitted position must remain `undefined` without reading an inherited numeric
getter, while an explicitly supplied `undefined` still owns an array position.
The original `arguments.length` remains the one source dispatch read, even if
the source changes that property. Object selection must not acquire
`Symbol.iterator`. One pre-dispatch
selection also lets source reassignment survive case fallthrough without a
generated `const` assignment or per-case rebinding.

The proof covers mutable and immutable optional formals, live `arguments`,
source `.length` retention, case fallthrough, omitted and explicitly undefined
arguments, inherited numeric getters, a poisoned array iterator, raw/fixed
lint, runtime parity, and shadowed/aliased type rejections. The lowerer consumes
the completed source decision and recorded parameter facts; it does not
rediscover type spelling, mutability, dispatch ownership, or global identity
from rewritten syntax.

A captured numeric rest read in `f(a)(args[0])` has a different finite
outcome. The checker proves the rest receiver, the parameter call producing
the callee, and the later indexed argument in an expression-bodied callback.
Policy selects `rest-array-staged-selection`. Grammar evaluates `f(a)` once
into a source-derived staging binding, reads numeric position `0` from the
rest array with an object binding, and calls the staged result. `void 0`
preserves meaningful absence; it is not a fabricated value-family fallback.
Array binding is not equivalent because it acquires `Symbol.iterator` rather
than performing the source indexed property read. The staging binding is
required to keep the read after `f(a)`, including when that call changes an
inherited index getter or throws. Dynamic positions, receiver-member callees,
and block-bodied callbacks remain outside this finite law.

## Required factory-result binding

For a source object binding directly initialized by a call, the checker must
resolve the call signature and prove each selected field is a declared,
non-optional callable property of its object result. Understand records the
original call range and the required property names. Policy selects
`preserve-required-factory-binding`; final binding grammar publishes
`typeclass-factory` ownership only for those fields and suppresses a later
synthetic early-return guard for them. The source call, property Gets, explicit
defaults, missing value, and native container/getter/call failures remain at
source phase. Callee spelling supplies no evidence. Optional, opaque, any,
unknown, and unproved results reject this fact; siblings cannot borrow a
proved field's ownership. Direct member projections retain their existing
`provider-edge` route rather than acquiring this binding fact.

## Exact callable-provider forwarding

A required callable field passed as a value is distinct from an invocation
of that field. For a static property of a checker-resolved parameter, the
existing `exact-provider-forward` agreement covers both identifier and static
member callees, plus identity returns in block and expression-bodied functions.
It does not require the consumer to guard or even invoke the value. The source
consumer owns its interpretation and any later call failure.

Understand records the original property range, receiver, member and callable
family. Optional, `any`, unknown, computed and direct-invocation forms do not
acquire this fact. All these forms require the intrinsic `undefined` binding:
a shadowed name cannot supply exact absence. Existing
direct-capability, sort-consumer and callback-projection decisions retain
precedence, including their proved placement and report-publication timing.

Policy reuses the exact `undefined` outcome. Grammar realizes the existing
identity-only extraction at the original argument or returned-value position,
including within a returned function or selected branch. This is the source missing-property
value, not a function-family fallback. No no-op, invocation guard or early
return is synthesized. Callee evaluation, preceding arguments, provider Get,
consumer invocation and later stage invocation keep their source order.

`tests/typescript-provider-provenance.test.js` proves aliases, parameter
consumers, rejection shapes, missing and non-callable stages, native receiver
failure, getter and preceding-argument failure identity, deferred repeated
reads, returned-record closures, generic identity returns, selected-branch
non-execution, and raw/fixed runtime parity.

## Deferred collection callback ownership

Standard Set/ReadonlySet `forEach` receiver evidence does not make an async or
generator callback synchronous. A callback capturing a returned collection
across such a boundary rejects reconstruction and selects the existing
`retain-collection-boundary` outcome. Grammar and mutation-comment placement
retain the native update on that same instance. Proof compares returned
contents before and after microtasks and preserves callback rejection
identity; synchronous admitted callbacks retain their reconstruction outcome.

## Live iterator payload admission

The checker identifies the exact result of `.next()` and a `.done` guard on
that result. If the admitted loop body immediately calls a bound consumer
with that result's `value`, Understand records the loop and read ranges and
Policy selects `iterator-payload-local-binding`. Grammar binds `value` inside
the admitted body, immediately before the call. It does not materialize the
iterator, move `.next()`, or read `value` on the done branch. Aliased results
and other traversal forms retain their source boundary.

The proof observes `.next()` count, `.done` then `value` getter order, falsey
payloads, early exit, and raw/fixed lint. It does not authorize extracting a
selected payload before a deferred callback executes.

A first body declaration `const v = result.value` after the same checker-proven
`.done` admission is a second outcome of this agreement:
`iterator-payload-local-declaration`. Grammar replaces that declaration in
place with a numeric-free object binding, `const { value: v = void 0 } = result`.
`void 0` is the exact result of an absent or undefined property, not a guessed
payload family. The loop, native `.next()` and `.done` effects, local binding
scope, and following statements remain unchanged. Aliased results, an early
read, and unknown iterator protocols are rejected.

## Deferred selected union payload

When a callback closes over a tagged-union parameter, the checker must prove
that the member is selected at the original read and absent from at least one
other variant. A first call argument to a stable parameter or function
declaration callee may be bound inside the expression-bodied callback, just
before the call. Policy selects `deferred-selected-payload-binding` from the
immutable callback and read ranges. Grammar changes that callback to a block
with one local object binding and the original call; it does not hoist the
payload into the enclosing branch or change callback identity or count.

The proof includes a getter whose value changes after callback creation but
before invocation, raw and fixed lint, and rejection of a later call argument.

## Deferred required opaque field

When a returned callback reads a required static field of an outer parameter
and the checker identifies its value as a type parameter, the value remains
opaque and the Get belongs to callback execution. Understand records the
original callback and read ranges. A direct first call argument to a stable
parameter callee selects `deferred-opaque-field-binding`: Grammar binds the
field inside that callback with exact `void 0` absence, then performs the
original call. A field nested behind earlier calls selects
`retain-deferred-opaque-field-read`: placement keeps the original expression
and one exact member-access boundary on its owning return. Earlier calls
must not be replayed or moved to make destructuring convenient.

The proof covers getter timing, falsey and undefined values, call order,
native getter failure, raw/fixed lint, and computed-read rejection. Neither
outcome extracts the field in the outer signature or assigns a guessed
canonical default to the generic value.

## Branch-selected switch payload signature timing

For a checker-proven discriminated union switched on its static tag, a payload
read used as a direct argument to a stable parameter, function declaration,
or initialized preceding `const` callee belongs to that selected branch.
Understand records each original payload range and the callee's checker
symbol. Policy selects `selected-model-read` with a branch-local signature
boundary. Grammar keeps the existing branch-local binding after the tag Get;
placement attaches one exact `prefer-signature-destructuring` reason to that
binding. Moving payload extraction into the function signature would read
unselected getters and change failure timing. Computed payloads and
receiver-method calls do not satisfy this finite fact. No generic payload
default or callback is synthesized.

## Standard array cardinality

For `const len = array.length` where the checker proves a standard array,
readonly array, or tuple receiver, Understand records the original initializer
range. Policy selects `retain-array-cardinality-read`. Grammar keeps the
native property Get at that phase; object binding with a numeric default
would declare the wrong family and alter an absent value. Placement may give
the retained declaration one exact `prefer-destructuring` boundary. A custom
object with a `length` property is outside this law; its shape must be
established separately. The proof counts getter reads, preserves native
throws, and checks raw/fixed lint.

## Curried selected tuple argument

When a checker-narrowed tagged union supplies a static tuple position as the
sole argument of a curried call, the preceding call must produce the callee
before the tuple position is read. Understand records both original ranges,
the selected property, and the exact position only when the call lies on a
direct return or guarded false-branch evaluation spine. Policy selects
`curried-selected-tuple-binding`. Grammar stages the source callee call,
then uses numeric object binding to read the position without acquiring an
iterator, and invokes the staged result once. A computed position, another
argument, or a preceding observable operand is outside the law.

## Callable provider dispatch with mutator-shaped names

For a direct `provider.add(x, y)` or `operations.reverse(value)`, the
spelling alone does not establish standard collection mutation. Understand
records the original call and receiver ranges only when the checker resolves
the member to a callable property signature or a module-namespace export.
Policy selects `retain-provider-dispatch`; grammar preserves the call,
receiver, arguments, and getter phase. Placement gives an expression arrow a
return-statement owner when needed and attaches one exact
`prefer-safe-transformations` boundary to the statement or object property
containing the call. Standard prototype methods, computed/optional calls,
and unrelated collection updates remain outside this law. The proof compares
receiver identity, getter/call order, guarded non-execution, raw/fixed lint,
and source/generated runtime behavior.

## Live standard-array work queue

For a fresh local array used by a live `while (queue.length)` or
`while (queue.length > 0)` loop that shifts its next item, Understand records
the binding, loop, and static `shift`/`unshift`/`push` call ranges. The checker
must prove the standard array family; queue identity cannot escape as a value.
Nested updates are admitted only in a directly called local function or an
immediate standard-array `forEach` callback. Policy selects
`operational-work-queue`. Grammar retains the same array and source method
calls; placement adds exact update boundaries and co-locates a pre-existing
resolved-call boundary on the same statement. An immutable rebind would
change queue visibility and traversal order. Custom queues, async owners,
and escaped callbacks reject this law.

## Live Set visitation into a sorted array

For a checker-proven standard `Set`/`ReadonlySet` direct `forEach` over a
fresh array whose callback performs one static `push`, Understand records
the visitation, update, and direct `return output.sort(compare)` ranges.
Policy selects `operational-collection-builder`. Grammar retains `forEach`
rather than acquiring `Symbol.iterator`, and retains native `sort` rather than
replacing it with `toSorted`: the sorted result must be the same array that
the callback populated. Exact update and return boundaries name this
identity/liveness obligation. Custom protocols, output aliases, async owners,
or missing direct sort returns do not enter the law. The proof observes
overridden `forEach`, additions during visitation, a poisoned iterator,
comparator calls, output order, and raw/fixed lint.

## Observable copied-Set union

For `const result = new Set(left); right.forEach(value => {
if (!member(value, result)) result.add(value); }); return result`, Understand
records the standard copied Set, live standard Set/ReadonlySet visitation,
membership call, guarded update, and direct return at original ranges. Policy
selects `operational-collection-builder`. The membership provider can inspect
the working Set before each add, so grammar retains the same instance and
source call order. An immutable rebind would break identity even if final
members matched. The proof checks duplicate and falsey members, insertion
order, live additions, copy-iterator acquisition, native copy throws,
comparator calls, and alias/computed-update rejection.

## Receiver-ordered method projection

For `arrayLike.reduce(provider.method)`, JavaScript gets `arrayLike.reduce`
before it gets `provider.method`. A declaration that destructures the method
before the call reverses those observable Gets. Understand may record the
static projection only when the checker proves a callable provider field and
a numeric-indexed receiver with `length` and `reduce`. Policy selects
`retain-receiver-ordered-projection`; grammar retains the source call, and
placement attaches one exact member-access boundary to its owning statement.
The later local/generic/residual passes must preserve this completed outcome,
not reclassify the emitted member or invent a failed-call fallback.

## Receiver-ordered tuple arguments

For `!method(prefix, selected.value[0]) || !other(next, selected.value[1])`,
each receiver method lookup and preceding argument occurs before its tuple
read. The second call may never run. Understand records the checker-proven
static tuple positions and the owning short-circuit guard at original ranges;
Policy selects `retain-receiver-ordered-tuple-argument`. Placement preserves
the source calls and attaches one exact statement boundary. An eager tuple
binding can preserve the boolean answer yet change getter order or throw phase.

## Ordered nested tuple reads in call arguments

For `receiver.method(selected.value[0], f(selected.value[1]))`, Understand
records the source call and owning statement ranges plus both original numeric
read ranges only when the checker proves the same tuple-valued property at
both reads. Policy selects `retain-ordered-nested-tuple-read`. Final placement
consumes that completed fact and attaches one exact member boundary to the
statement. The receiver method lookup precedes the first property Get;
intervening argument work separates it from the second Get. One eager binding
would change getter count or timing, and array binding would additionally
acquire `Symbol.iterator`. Single reads, computed positions, different
properties, spread arguments, aliases, deferred callbacks, and non-tuple
protocols do not inherit this law. The final pass must not reconstruct the
decision from emitted `identifier.property[n]` syntax.

## Source-owned indexed operations

For a checker-observed `record[key]`, `output[key] = source[key]`,
`delete output[key]`, or `output[key]++`, Understand records each original
indexed expression, its read/update operation, and the assignment statement
range when present. Policy selects `retain-indexed-read` or
`retain-indexed-update`; final placement consumes that decision without
classifying the generated expression. The assignment boundary owns the write,
not a separate RHS read: a later owned-builder lowerer may replace the
assignment with object-spread grammar while preserving `source[key]`. That
surviving read retains its own source fact and boundary. Delete and postfix
forms remain expression-local, preserving native result, key evaluation, and
throw behavior. A static numeric tuple comparison is a separate law, not a
dynamic-key fact.

## Direct-live owned record builder

For a fresh string-indexed record with one direct `for…of` over a checker-proven
array of tuples, one `output[entry[0]] = entry[1]` or
`output[key] = value` with `[key, value]` bound by the loop, and a direct
owning return, Understand records the exact loop and assignment ranges.
The consecutive declaration/loop/return unit may have adjacent statements.
Policy selects `operational-object-builder`. Grammar preserves the live loop
and assignment: indexed property reads do not acquire the tuple iterator,
whereas destructured entries do; the assignment's value read precedes
key-object coercion, and a `__proto__` write may affect the prototype rather
than create an own field. `Object.fromEntries`, an indexed-read
callback/default, or an object-spread rebind is not equivalent. Aliases,
computed positions, escaped output, extra updates, and unknown input
protocols are not admitted by this finite law. A copied object followed by
an indexed update remains under its original-range `retain-indexed-update`
fact; object spread cannot replace its assignment because inherited setters
and `__proto__` are observable.

## Ordered copied-Map update

For a directly returned `new Map(source)` followed by one static `set` whose
key and value are separate numeric reads of the same checker-proven tuple,
Understand records the copied collection, update, and both original read
ranges. Policy selects `operational-collection-builder`. The copy and method
lookup precede the key read; the value read remains inside its original
argument expression, after any preceding call. Grammar retains `set` and the
numeric property Gets. Eager array binding would acquire `Symbol.iterator`
and move the reads; an immutable rebind would alter builder identity. Later
member lowering consumes the completed operational fact and cannot restage
the reads. Boundary directives name only the exact rules justified at each
operation, with concrete semantic reasons. Multiple rules justified on the same
next line share one directive; different operation owners remain separate.

## Copied collection under a live synchronous loop

A checker-proven standard `new Map(source)` or `new Set(source)` is fresh but
not an immutable reduction target merely because it was copied. If an owned
static update lies inside a synchronous live loop and the copied output is
directly returned without escaping, Understand records the original update
and loop ranges in the existing collection reconstruction fact. Policy selects
`operational-collection-builder`; placement retains the copy, live loop,
guarded updates, and direct return. It uses the existing exact mutation
boundary where needed, not an immutable rebind or new callback. Duplicate
keys, falsey values, source collection identity, iterator advances, and native
entry failure stay observable. A loop with no update of that copy, `for await`,
computed update call, output escape, and mixed mutators do not acquire this
outcome. The direct adjacent copy/update/return law remains separate.

## Opaque-provider callback-owned accumulator

When a checker-proven provider exposes a `reduce` property rather than the
standard array prototype method, it receives both the fresh seed and its
callback. The provider may retain the seed, compare it with every callback
result, or observe updates between calls. For a direct `[]` or standard
`new Map()` seed, same-family accumulator parameter, direct static `push` or
`set`, and direct callback return, Understand records the original call,
callback, and update-statement ranges in the existing collection fact. Policy
selects `operational-collection-builder`. Grammar keeps the original seed,
callback, update, and return; placement adds only an exact local mutation
boundary. A separate ordered-member boundary may share that statement via a
trailing directive. Replacing the update with spread or a new container is
not lawful: callback result identity would differ from the seed. Native
array reduction, passed seeds, aliases, computed updates, and nested callback
capture do not receive this fact. This law does not classify every property
named `reduce` as pure or mutable; the checker-backed provider boundary and
ownership shape are required together.

## Provider-owned callback parameter update

A provider callback parameter is not a fresh local accumulator. For a
checker-proven standard Array or Map, including a type whose checker base
chain reaches standard Array, one direct static `push` or `set` on that
parameter (or on a static field/numeric position selected from it) remains
operational: the provider may share or inspect the collection across callback
calls. Understand records the original callback, provider, update, alias-read,
and static receiver-selection ranges in the collection fact; Policy selects
`operational-collection-builder`. Grammar retains the update and its identity.
An admitted local field selection binds at its original declaration with no
invented fallback; an exact required-field boundary preserves meaningful
`undefined`. A nested numeric Get remains a Get: member/final passes cannot
acquire an iterator or manufacture a default for it. Computed updates,
dynamic positions, local-only ownership, unknown collection protocols, and
non-static aliases do not acquire this fact.

## Mutable selected loop result

A checker-proven mutable tagged union in a direct `while` loop cannot bind its
discriminator before the loop: the result is replaced on each iteration.
Understand records the loop, selected `left` read, and direct exit `right`
read as one fact. Policy selects `mutable-selected-loop-binding` only for the
finite update shape. Grammar keeps a live loop, binds `_tag` at each admission,
breaks on the original false branch, binds `left` after preceding body effects,
and binds `right` only at exit. No iteration materialization or callback is
introduced. Computed tags and other loop shapes retain their prior outcome.

## Indexed local source-order selection

For a checker-proven array index assigned to a function-local working value,
two static fields may be selected in distinct additive updates of the same
local accumulator. Understand records the exact loop and read ranges,
checker symbols for both locals, and the two property names. Policy selects
`indexed-local-staged-selection` only for the finite four-statement loop body:
a first additive suffix read and a second bare-identifier call whose final
argument is the later field read.

Grammar keeps the live indexed loop. For each update it stages the prior
accumulator value before the source right-hand work, stages preceding
operands in order, binds the selected field with `void 0` absence, and
performs the original addition or call once. This preserves compound-
assignment read timing even if a getter mutates the accumulator, and keeps
callee lookup and earlier argument evaluation before the second getter. No
iterator, callback, container, or field read is added. Computed fields,
other loop shapes, and unproved protocols retain their existing outcome.

## Callable capability at a static sort consumer

### Source shape

```ts
const sort = (O: Ord<A>) => values => values.length <= 1
    ? values.slice()
    : values.slice().sort(O.compare)
```

### Required evidence

- the provider member is a required callable field;
- the checker proves a static `sort` or `toSorted` call with an array-like receiver;
- the capability has one static consumer;
- the call is an expression body, one branch of a conditional body, or a
  direct return in a block body.

### Target agreement

The callable remains absent until its consumer requires it. Its disagreement
value is the consumer's natural bare return. The adapter must preserve all
work that source evaluates before `toSorted`:

```js
const sort = O => values => {
    if (values.length <= 1) return values.slice();

    const sorted = values.slice();
    const { compare: OCompare } = O;

    if (!isFunction(OCompare)) return;

    return sorted.toSorted(OCompare);
};
```

The staging declaration is required only when the original receiver is not an
identifier. It evaluates `Array.from(...)`, `slice()`, or equivalent
source-owned receiver work once before the provider getter and callability
disagreement exit. A
short-array branch remains before the guard because source never consumes the
comparator on that branch.

### Rejections

Do not apply this law to computed members, optional fields, multiple or escaped
uses, writes, custom/dynamic receivers, receiver-dependent capability calls, or
consumers whose disagreement result is not a natural bare return. Those shapes
need their own proven agreement.

## Binding use, effects, and source arity

A checker-declared tuple is a static shape, not a runtime witness that each
position exists. For an ordinary declaration or callback parameter whose
required tuple contains an opaque or callable position, Understand records
the original binding owner and every position. Policy selects
`retain-required-tuple-binding`. Grammar preserves native iteration and
the source's missing-position value or failure; it cannot add `0`, `''`, a
callable, or an empty container merely because a type names that family.
Final placement may explain the exact required-position boundary to lint.
Live iterator loops keep their operational agreement, and pure generic
ignored-slot callbacks keep binding-use/elision grammar. This is a
source-range decision, not emitted-syntax classification.

Understand asks the checker whether an original binding symbol is used at
runtime, excluding erased type-only references. Policy admits three finite
outcomes: omit an unread catch binding; elide an unread plain tuple position
only when iterator advancement is unchanged; or retain an unused formal
parameter and place a `void parameter` read in its body. Effectful binding
defaults and initializers remain at their original evaluation phase. Grammar
does not infer runtime arity from an erased signature or add parameters to an
implementation: `.length` is observable source behavior.

A call may still type-check with an argument that the implementation ignores.
When checker evidence traces that typed contract through local or imported
forwarding to a zero-parameter implementation, Understand records the source
call range. Policy selects a retained typed-ignored-argument outcome; placement
marks only that call with its exact contract boundary. No argument evaluation,
callee lookup, receiver binding, or function arity is changed.

The same source owner can prove a nonzero implementation with fewer formal
parameters than the authored callable signature. Understand follows the actual
typed declaration/forwarding chain, resolves the selected call signature and
checks its argument count and argument assignability. A rest implementation,
spread or optional call, unresolved implementation, ordinary arity mismatch or
known argument contradiction rejects this added domain. Policy selects
`retain-typed-extra-argument-call`; existing final placement consumes the exact
source/original-node fact. No parameter, argument, callback or default is added
or removed. A returned callable and `.length` keep their source meaning. Names
such as a recursive helper or curried operation do not establish this law.

## Output layout after completed grammar

Printer layout is not a new semantic decision. The completed emitted grammar
may format a named import across lines, parenthesize an expression-bodied
arrow's body before line wrapping, and move an export-list closing brace to
its own line. These forms preserve module bindings, expression evaluation,
and automatic-semicolon behavior. An exact retained-boundary reason can be
shortened only while still naming the source operation or failure timing.

## Materialized collection reduction ownership

For a fresh standard Map or Set, one direct or guarded static update over a
checker-proven array-like or direct materialization, and a direct owning
return, Understand records the original loop and return ranges, item binding,
update arguments, condition, materialization form, and finite reduction
operation. Policy selects `materialized-collection-reduce`. Collection
placement consumes that fact before descendant lowering and asks grammar for
one immutable array reduction and one final Map/Set construction. The former
generic array/scalar accumulator routes are removed; a checker-proven direct
standard-array or tuple `for…of` retains its live visitation fact. In
particular, a guarded per-item update cannot become a filter followed by a
map: that separates guard effects from result effects and may change throws.

Explicit `Array.from(...)` and spread materializations reduce the already
materialized array, without another `Array.from`. A live Map/Set loop remains
an operational builder. Computed updates, captures, unknown protocols,
observable loop control, and mismatched output families do not acquire this
reduction fact.
## Authored console effect boundary

For a direct static call on the checker-proven standard global `console`,
Understand records the original call and owning statement or arrow range.
Policy selects `console-effect`. Grammar retains the original call and
result; an expression arrow may become a block with a direct return so
placement can attach one adjacent exact `no-console` directive explaining
authored I/O. Shadowed or computed access rejects this agreement. No
callback, container, or fallback result is constructed.

## Native composition and failure ownership

An arity-dispatching function may return a normal function that composes
captured stages by direct nested calls. TypeScript non-null assertions on the
stages erase; they do not authorize an `isFunction` guard or a bare return.
Ordinary TypeScript emission already preserves `this`, `arguments`, stage
order, return value, and the native TypeError at the first missing stage's
invocation. No composition-specific Understand fact or placement is needed.
The former guard-inserting classifier and lowerer were deleted after focused
failure-phase proof and corpus parity. A computed or receiver-dependent call
likewise retains its authored form rather than entering a composition route.

## Resolved source-call ownership

An identifier call that selects a one-argument overload returning a callable
is not missing the implementation's optional later parameter. Understand
records the original call range only when the checker resolves that overload,
the result has a call signature, and the same declaration group has an
implementation whose remaining parameters are optional or initialized.
Policy selects `retain-overloaded-partial-call`; placement retains the exact
call and arguments with a local call-contract explanation. If the call is in
an expression-bodied arrow, grammar first gives that expression a direct
return statement so the boundary has an exact statement owner. The final
annotation is attached only after other reconstruction passes, which can
discard earlier synthetic comments. No wrapper, default, or second argument
is emitted. A plain missing-argument call does not qualify.

A second source form has distinct same-named function symbols in lexical
blocks with different arities. The checker-resolved signature, not the emitted
name, owns each call. Understand records only direct identifier calls with
the resolved local declaration and its exact argument count; Policy selects
`retain-resolved-local-call`. The generated call remains unchanged. A
computed/member call, unresolved symbol, or actual arity mismatch rejects
this fact. Both forms preserve argument evaluation and native failure timing.

## Overloaded arity-return partition

An overload with an optional final argument may deliberately have two result
channels: `argument === undefined` returns a callable for partial application;
the supplied-argument path returns the completed value. An omitted argument
and an explicit `undefined` select the same branch, but `null` does not.
Neither a truthiness test nor a fabricated common result is equivalent.

Understand records overload syntax, checker-known optional parameter, exact
selector and return ranges, and the callable/value distinction. Policy selects
`retain-arity-return-partition` and `retain-exact-undefined-selector`. Grammar
keeps the authored return expressions and strict selector. Final placement
consumes those facts and attaches only exact, locally reasoned return-contract
and undefined-comparison boundaries where the dialect cannot encode both
channels in one declaration. No generated-tree return-kind classifier or
fallback result is permitted. A function without the proved overload and
selector does not acquire this outcome.

## Finite switch no-value exits

A switch whose admitted cases return values may still complete without a
value for an unmatched runtime selector. Understand records the original
owning declaration and switch ranges only when every case is a direct value
return and the checker proves either all literal members of a discriminant
union are covered or the source has a terminal bare return after the switch.
Unknown selectors, default clauses, and intervening control flow reject this
fact. A declared TypeScript union does not validate arbitrary runtime input.

Policy selects `retain-switch-no-value-exit`. Grammar preserves the switch and
may remove an explicit terminal `return;` because normal completion at that
same function boundary produces the same `undefined` without evaluating
another expression. Placement consumes the original fact and marks one exact
`consistent-return` boundary on the owning declaration. It must not invent a
default case, empty value, throw, callback, or return expression. The proof
includes admitted and unmatched selectors in both source and generated code.

## Authored nullish abstract equality

`operand == null` and `operand != null` are one authored abstract-equality
operation that tests null and undefined. Replacing either with strict equality
changes its branch, while splitting an arbitrary operand into two strict
comparisons can duplicate its evaluation. Understand records the checker-seen
operand, original comparison range, and nearest owning statement. Policy
selects `retain-nullish-abstract-equality`; placement preserves the operation
and attaches one exact local `eqeqeq` boundary explaining nullish semantics.
The fact rejects non-null loose equality and strict comparisons. It does not
infer a value family or authorize a broader loose-equality exception.

## Checker-declared nullish producer result

An explicit return signature or contextual call signature may prove that an
authored `undefined` or `null` is a normal result of the producer. Understand
records the direct result expression and function ranges; inference from the
expression alone, `any`, unknown, and a shadowed non-undefined binding reject
the fact. Policy selects one of `normalize-empty-result`,
`retain-declared-undefined-result`, or `retain-declared-null-result`.

`(): void => undefined` can become `() => {}` because normal completion has
the same value, arity, and call phase. A block consisting solely of
`return undefined;` can likewise complete normally. A mixed value/undefined
branch keeps its explicit result, and a nullable producer keeps `null`; each
gets only the exact falsey-return boundary. Grammar must not replace either
with a guessed falsey family or introduce a return that changes control flow.

## Detached fulfillment-only promise forwarding

A Promise executor can contain a dropped static chain whose terminal
`.then(resolve)` forwards fulfillment to that executor's own resolver. Its
rejection is not forwarded: the inner chain rejects separately and the outer
Promise remains pending. Understand records original statement, chain, and
executor ranges only when the checker proves a Promise-valued chain, the
native Promise constructor, and resolver symbol identity. Computed calls,
unrelated callbacks, unknown promise results, and non-native constructors
reject the fact.

Policy selects `explicit-detached-promise-forwarding`. Grammar emits
`void chain;` at the original statement. Since the expression-statement
result was already discarded, `void` adds no callback, catch, return, or
settlement edge. Awaiting would move rejection into a different owner, so
placement adds one exact async-style boundary with that reason. Proof must
observe fulfillment, rejected inner work, the pending outer Promise, guard
non-execution, and callback count.

## Same-phase static selected binding

For a checker-resolved direct declaration `let state = namespace.none`, the
original declaration owns the Get and its writable binding. Understand records
the source declaration, receiver, static property path, and symbol evidence;
Policy selects `bind-at-source-phase`. Grammar emits
`let { none: state = void 0 } = namespace` at that same phase. `void 0` retains
the authored absent-field result even when `undefined` is shadowed. Nested
static chains bind without a fabricated alias: an intermediate binding has no
default, so a missing intermediate receiver still throws natively. A root
parameter that another completed signature pass may replace rejects nested
selection until those agreements are jointly owned. The final annotation pass
must not add a safe-default directive when the completed leaf already has its
`void 0` default.

## Deferred signature selection and live arguments indexing

An ordered variant comparison can inspect a second parameter only after an
identity check and a checker-resolved predicate on the first parameter.
Understand records both preceding ranges and the later predicate call ranges
on the original function. Policy selects `retain-deferred-signature-selection`;
placement retains the local tag binding at its original phase with one exact
signature-rule reason. Moving it to the signature would run its Get on the
identity path and before the first parameter's predicate. A plain boolean
helper without a checker type predicate does not establish this agreement.

For the native `IArguments` object, a static `arguments[0]` and dynamic
`arguments[i]` are direct, live indexed Gets. The indexed-operation fact uses
checker `IArguments` evidence and rejects an ordinary array index. Policy
selects `retain-dynamic-arguments-read`; only the static position needs an
exact core `prefer-destructuring` boundary. A binding pattern or materialized
copy would acquire an iterator and can change aliasing, arity, and read phase.

## Ordered terminal decisions

An original `if (guard) { ... return value } else if (next) ...` owns one
guard evaluation, a terminating first arm, and a second guard evaluated only
after the first arm rejects. Understand records both guard ranges, the
terminating arm, and the continuation, with checker evidence for the first
condition. Policy selects `flatten-terminal-guards`; Grammar makes the `else`
arm the next statement without moving either guard or any payload read.
Nonterminal first arms reject this law.

A source `if (isSelected(value)) { effects; return choice ? a : b }` followed
by a terminating alternate suffix may instead select
`flatten-terminated-nested-decision`. This requires a checker-resolved guarded
argument, a terminating selected arm, and an alternate suffix without another
`if`. Grammar evaluates the same guard once, returns through the negated
alternate first, and keeps the selected arm's lexical block and effect order.
The moved block's source-owned payload bindings retain their post-guard
signature boundary; the transform cannot move them into the callback
signature.

When both sides of a nested variant decision own further guards and payload
reads, the finite outcome is `retain-ordered-decision`. A completed original
conditional range travels through selected-model grammar to final placement;
one exact `no-nested-if` boundary follows any other comments on that `if`.
Neither outcome invents a result, default, callback, or second discriminant
read. Focused proof covers guard/callback order, false branches, selected
payload reads, raw/fixed lint, and source/generated runtime behavior for the
admitted decision shapes. Repeated scalar parameter Gets are owned by the
separate source-phase law below, not by branch flattening.

## Repeated scalar parameter Gets

For `value.x + effect() + value.x`, one parameter binding would evaluate the
getter once and before `effect()`. Understand groups direct static reads by
checker-resolved parameter and property symbols within one function. Only a
checker-proven scalar result with two or more reads enters this law. Each
original read range carries the same function, receiver, and property fact;
Policy selects `retain-source-phase-read`. Conditional-return, parameter,
generic-member, and selected-model passes consume that completed decision.
Grammar retains each authored Get and places an exact member-rule boundary on
its statement; another completed tuple or nested-decision boundary keeps its
more specific reason. No default or shared alias is introduced.

Focused proof compares getter count, an intervening call, guarded non-execution,
changing discriminants, and a second-Get throw. A single read and an
array-valued result reject this packet. The collection-valued case requires
its own source-phase/default agreement because the older adapter's accepted
absent-array contract is not equivalent to blanket retention.

## Hoisted cycles and live own-key enumeration

Mutually recursive top-level `function` declarations are a native hoisting
unit, not independent candidates for `const` arrow conversion. Understand
resolves their dependency cycle by checker symbols and records each declaration
and reference at its original range. Policy selects `retain-hoisted-function`
and `retain-hoisted-reference`. Grammar keeps the declarations. After dependency
ordering, placement annotates only an emitted forward reference, including one
inside a returned callback. Early calls, recursive calls, and function identity
remain source-owned; a noncyclic declaration keeps its existing lowering.

A checker-proven object `for…in` with an authored guard and key-indexed write
selects `retain-live-own-key-enumeration`. Grammar retains the original loop,
guard, key Gets, and write. Final placement replaces a generic loop reason with
one exact `prefer-prototype-methods` boundary from the source-range fact.
`Object.keys`/`Object.entries` would change enumeration timing or protocol;
an unguarded key loop does not enter this agreement.

## Analyzer-led operational loop restoration

An analyzer report is a request for a source-operation decision, not proof that
every loop has a collection-prototype equivalent. Understand records the
original loop range and checker evidence; Policy chooses a finite retained
outcome only for the matched operation. Exact-loop placement consumes that
completed decision. It cannot rediscover the outcome from generated syntax.

Standard iterator `.next()`/`.done` traversal remains live. Standard-array
numeric indexed Gets retain sparse-position behavior; direct `for…of` retains
its iterator acquisition and sparse visitation. Array evidence includes
checker-proven tuples, intersections, inherited interfaces, and mapped tuple
forms, not merely a nominal `Array` name. A loop-carried value passed into a
call before its next assignment retains callback and termination phases; when
selected-model grammar creates a `for` node from an authored `while`, that
node must retain the original loop provenance for final placement.

A numeric induction loop that calls `f(i)` and pushes each result into a fresh
directly returned array is a range producer, not traversal of a source
collection. `retain-numeric-range-builder` requires the checker-proven numeric
counter/bound, callback-fed update, fresh standard-array binding, and direct
return. Grammar preserves the original loop and callback count; it does not
fabricate `Array.from`, a source array, or a new callback. Indexed array-copy
loops do not satisfy this law. A generic `for…in` likewise retains native key
enumeration without assuming that its type parameter has an object runtime
family. `any` and `unknown` do not inherit that generic fact.

The former side-effect `for…of` lowerer mapped direct calls to `array.forEach`,
but checker-known array type does not equate those protocols: a source array
can have an overridden iterator, a distinct `forEach`, or sparse positions.
The completed live-array agreement now protects the original loop in initial
and final grammar. A destructured entry stays a native binding so malformed
elements retain native failure rather than gaining synthetic `''` or `0`
defaults. The exact one-statement default-rule boundary is attached only when
that original required binding is present. `resilient-fp-ts-proof-BSdQq3`
proves corpus parity after deleting the duplicate lowerer.

The restoration proof reduced fixed-artifact prototype-method findings from
127 to zero in `resilient-fp-ts-proof-lSh9Om`, with baseline and generated
runtime fully green and the 30 async warnings unchanged. The count is a
measurement of these laws, not a package-specific grammar premise.

## Native class boundary and functional consumer shape

An authored class may be a provider boundary while its instances expose a
method shape to functional consumers. A checker-resolved `new` call and
constructor-bound prototype method prove that replacing the class with a
factory would change `new`, `instanceof`, prototype identity, method ownership,
or calling without `new`. Understand records the class, constructor,
construction, method, and bind ranges. Policy selects
`retain-native-class-boundary`; placement preserves the class and adds one
exact `no-restricted-syntax` reason at that declaration. No facade, alias,
constructor function, or replacement instance is invented. A plain class
without the bound-method evidence does not enter this law. The consumer-facing
shape is the already-authored instance API, not an excuse to change the
provider's runtime protocol.
