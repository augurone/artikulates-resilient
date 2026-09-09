# Resilient Migration Playbook

Use this playbook to migrate existing code or repair a reported Resilient
violation. For your first task in the dialect, read
[Writing Resilient from first principles](../ai/writing-resilient.md) before
choosing a repair. [Grammar](../reference/grammar.md),
[Policy](../reference/policy.md), and [Semantics](../reference/semantics.md)
define the agreement; individual rule pages own exact triggers and exceptions.

## Work from the first broken agreement

1. Trace the finding to the producer, its input, and the consuming operation.
   Identify which boundary disagrees with the intended behavior. The reported
   line is not necessarily the line that needs changing.
2. State the input owner, promised result, absence behavior, and failure owner.
   Inspect the closest reference implementation and the owning rule's tests.
3. Repair the earliest incorrect boundary. Keep valid producer behavior intact
   when the consumer is wrong. Normalize only where an owner deliberately
   translates external or alternate representations into an application value.
4. Preserve evaluation order, receivers, identity, effects, and failure paths.
   If the ordinary form changes the agreement, inspect the rule's supported
   exceptions and explain the narrow boundary that requires one.
5. Check representative behavior and run the applicable diagnostics. Fixing
   one boundary may resolve downstream findings. Passing lint does not prove
   that a rewrite preserved behavior.

Unknown evidence is not a known contradiction or permission to bypass policy.
An analyzer non-finding, a built-in accepted form, and a local rule exception
are different things. Each entry below keeps those decisions separate.

## Find the relevant repair

| Observed smell | Start here |
| --- | --- |
| Hidden shape, missing defaults, or repeated property reads | [Signatures and defaults](#signatures-and-defaults) |
| Nullish fallback or an ambiguous presence test | [Absence and content](#absence-and-content) |
| Nested branching or stateful collection work | [Control flow and transformations](#control-flow-and-transformations) |
| Optional callback, silent catch, or unowned promise | [Callbacks and failure](#callbacks-and-failure) |
| Known incompatible argument, property, operation, or return | [Contract contradictions](#contract-contradictions) |

## Signatures and defaults

### prefer-signature-destructuring

[Rule](../rules/prefer-signature-destructuring.md)

- **Observed smell:** an owned object parameter is unpacked inside the body.
- **Establish:** which fields the function consumes and whether it owns their
  read timing and defaults.
- **Repair:** put those fields in the signature, with the appropriate nested
  defaults and rest path where passthrough is intentional.
- **Preserve:** getter execution, conditional reads, receiver binding, and
  full-object forwarding. Moving a read into a signature makes it happen at
  invocation, before body guards.
- **Boundary:** retain external callback signatures, opaque forwarding, and
  dynamic/platform boundaries when destructuring changes their agreement.
  Use the owning rule's supported exception if needed.

For an owned record with unconditional reads:

```javascript
// Before
const getLabel = (record = {}) => {
    const { label = '' } = record;

    return label.trim();
};

// After: alternative implementation of the same function
const getLabel = ({ label = '' } = {}) => label.trim();
```

### prefer-safe-destructuring-defaults

[Rule](../rules/prefer-safe-destructuring-defaults.md)

- **Observed smell:** a destructured level leaves its missing-value behavior
  unstated.
- **Establish:** what absence means for that field. The rule requires a
  declaration; it does not choose the value for you.
- **Repair:** supply the agreement's default at each applicable level. For
  example, `{ data: { items = [] } = {} } = {}` states three boundaries.
- **Preserve:** required arguments and callee-owned opaque payloads. Defaults
  handle missing or `undefined` values, not arbitrary wrong-family inputs.
- **Boundary:** rest elements, directly invoked function-valued bindings, and
  `useState` tuples have documented exceptions. Optional callback invocation
  still needs a callability guard. Do not invent a no-op to satisfy this rule.

### no-destructuring-fallback

[Rule](../rules/no-destructuring-fallback.md)

- **Observed smell:** `const { items = [] } = data || {};` hides the input
  decision in a truthiness fallback.
- **Establish:** whether the function expects an owned record with optional
  absence, or receives arbitrary data needing a runtime boundary.
- **Repair:** expose an owned shape with defaults in the signature. At an
  external boundary, use the existing object utility or explicit resolver
  according to the intended handling of invalid input.
- **Preserve:** the values previously handled by the fallback. `||` handles
  every falsey value; a default handles only `undefined`. Replacing one with
  the other is not automatically equivalent.
- **Boundary:** ordinary `||` value selection is a separate use. If the
  original fallback encodes a necessary external distinction, preserve that
  distinction explicitly rather than discarding it during migration.

### prefer-destructured-member-access

[Rule](../rules/prefer-destructured-member-access.md)

- **Observed smell:** static consumption of owned fields is hidden in member
  reads such as `user.name`.
- **Establish:** the consumed shape and the point where each read must occur.
- **Repair:** expose application-owned fields in the signature where possible;
  otherwise destructure at the appropriate established boundary.
- **Preserve:** receivers, getters, dynamic keys, and reads whose value can
  change between operations. Extracting a method can lose its receiver.
- **Boundary:** platform objects, dynamic APIs, and documented accumulator
  forms may retain member access. Inspect the specific rule before adding an
  exception; a familiar object name alone does not establish ownership.

## Absence and content

### prefer-falsey-returns

[Rule](../rules/prefer-falsey-returns.md)

- **Observed smell:** an internal value-producing function returns a nullish
  sentinel on a path that promises another family.
- **Establish:** the producer's result agreement and the consumer's use of its
  empty representation.
- **Repair:** return the appropriate `''`, `[]`, `{}`, `0`, or `false`, including
  the required record structure where that is promised.
- **Preserve:** meaningful distinctions between an empty success, absence,
  and an error. A resolver or explicit result shape may be needed when those
  distinctions belong to the contract.
- **Boundary:** bare `return;` remains valid for an effect/control-flow exit.
  External absence belongs to its declared boundary and applicable exception;
  do not silently normalize it everywhere.

An empty collection still fulfills a collection agreement. Its consumer tests
cardinality to decide whether work proceeds. A producer returning `0` does
not owe every caller one universal interpretation of zero.

### no-null-assignment / no-undefined-assignment

[Null rule](../rules/no-null-assignment.md) ·
[Undefined rule](../rules/no-undefined-assignment.md)

- **Observed smell:** explicit nullish assignment stands in for an unstated
  internal application value.
- **Establish:** whether this is initialization, clearing a value, withdrawal
  of an implementation, or an external protocol requirement.
- **Repair:** express the known action and use the agreement's value. Remove
  an assignment only when it has no required observable effect.
- **Preserve:** property presence, clearing behavior, and externally meaningful
  nullish states. Removing `object.key = undefined` changes whether the key is
  created and whether an earlier value is replaced.
- **Boundary:** external APIs can require explicit absence. Preserve their
  behavior with a narrow supported exception. Naturally absent callbacks and
  bare returns do not require synthetic replacement values.

`const` is the default binding discipline. Explicit `let` permits a changing
binding; its initializer does not permanently constrain its family. That
exception does not exempt assignments from the nullish or mutation policies.

### no-undefined-comparison

[Rule](../rules/no-undefined-comparison.md)

- **Observed smell:** an exact absence comparison is used to express a broader
  presence decision.
- **Establish:** whether `0`, `false`, `''`, or `null` must be distinguished
  from `undefined` at this boundary.
- **Repair:** use truthiness only when all falsey values have the same intended
  consequence. Otherwise retain the precise condition or move the decision
  into the appropriate boundary utility.
- **Preserve:** valid falsey results. `value === undefined` and `!value` select
  different inputs.
- **Boundary:** exact absence checks required by an external contract need the
  rule's supported exception when reported.

### no-length-comparison

[Rule](../rules/no-length-comparison.md)

- **Observed smell:** a collection's zero/non-zero length is expressed as an
  unnecessary comparison.
- **Establish:** that this is a cardinality decision on a collection, not an
  arbitrary numeric field or a required boolean result.
- **Repair:** use `!items.length` for empty and `items.length` in a conditional
  for non-empty. Use `!!items.length` when returning a boolean.
- **Preserve:** the result family and exact cardinality. Returning a raw length
  in place of a boolean changes the producer's agreement.
- **Boundary:** retain comparisons such as `items.length === 1` when the exact
  count matters.

```javascript
const hasItems = (items = []) => !!items.length;
```

Object and array truthiness does not test their content. Use the existing
object content helper or array cardinality, and remember that neither proves
nested payload validity.

## Control flow and transformations

### no-else

[Rule](../rules/no-else.md)

- **Observed smell:** alternate branches obscure a guard exit and the main path.
- **Establish:** what each branch returns or changes and where execution
  continues afterward.
- **Repair:** flatten a terminal branch into a guard. For branches that rejoin,
  express the selected value or extract a function without skipping later work.
- **Preserve:** shared continuation, effects, and all return paths. Inserting
  an early return into a nonterminal branch changes behavior.
- **Boundary:** the rule has no built-in `else` exception; use the dialect's
  ordinary guard and composition forms.

### no-nested-if

[Rule](../rules/no-nested-if.md)

- **Observed smell:** nested `if` statements inside one function hide its
  decision sequence.
- **Establish:** which work belongs only to the branch and which work follows
  it regardless of the condition.
- **Repair:** use guards where a path terminates, or extract the branch-owned
  operation into a function with its own agreement.
- **Preserve:** condition evaluation order and shared continuation. Do not
  stop an outer function merely to flatten an inner branch.
- **Boundary:** an `if` in a separate callback or function is a separate scope,
  not a same-function nested `if`.

### prefer-prototype-methods

[Rule](../rules/prefer-prototype-methods.md)

- **Observed smell:** loop state conceals selection, transformation, or
  aggregation of a collection.
- **Establish:** the operation, result family, traversal semantics, and effects.
- **Repair:** choose `filter`, `map`, `reduce`, `some`, or another method that
  actually expresses the operation. Account for the absence result of `find`.
- **Preserve:** sparse elements, order, callback arguments, termination, and
  sequential async work. `forEach(async ...)` does not await the callbacks.
- **Boundary:** loops with native `await` or direct loop control can already
  express the correct agreement. Other necessary loops require the current
  exception mechanism in [P-03](../reference/policy.md#p-03-exceptions-and-precedence).

### prefer-safe-transformations

[Rule](../rules/prefer-safe-transformations.md)

- **Observed smell:** a property write, mutating method, or `Object.assign`
  hides a state transition, including on local working objects.
- **Establish:** who owns identity and who can observe the mutation.
- **Repair:** return a new object or collection when replacement is the
  intended transition, and update the caller to consume that result.
- **Preserve:** aliases, nested references, order, and identity-sensitive
  behavior. Spread makes a shallow copy, not a deep clone.
- **Boundary:** drafts, caches, refs, and DOM objects can require mutation.
  Identify the actual mutable boundary and use a narrow explained exception;
  merely naming a variable `cache` does not approve its writes.

For replacement-owned state:

```javascript
const updateCount = ({ count = 0, ...state } = {}) => ({
    ...state,
    count: count + 1
});
```

Allowing a loop does not also approve its mutation. Each applicable rule
retains its own boundary and exception.

## Callbacks and failure

### no-unguarded-callback-invocation

[Rule](../rules/no-unguarded-callback-invocation.md)

- **Observed smell:** a callback that may be omitted is invoked directly.
- **Establish:** whether an implementation is required or optional and what
  should happen when it is absent.
- **Repair:** guard optional invocation with `isFunction(callback)` or
  `typeof callback === 'function'`.
- **Preserve:** observable absence. A no-op is a supplied implementation and
  must not be invented as a repair. Truthiness alone does not prove callability.
- **Boundary:** an existing intentional callable default may satisfy the rule,
  but that non-finding does not justify introducing one. Required and forwarded
  callbacks retain their own contracts.

```javascript
const notify = ({ onDone, message = '' } = {}) => {
    if (typeof onDone !== 'function') return;

    onDone(message);
};
```

### no-silent-catch

[Rule](../rules/no-silent-catch.md)

- **Observed smell:** an empty or comment-only catch discards failure.
- **Establish:** who owns the error and whether the operation may recover.
- **Repair:** handle, translate, rethrow, log with useful context, or return the
  agreed fallback. Choose based on failure policy, not which edit is shortest.
- **Preserve:** error context, cleanup, cancellation, and the producer's normal
  return agreement. A log alone can still leave an unintended fallthrough.
- **Boundary:** an empty catch has no built-in exemption. Explain and execute
  the actual failure behavior.

### no-unhandled-promise-chain

[Rule](../rules/no-unhandled-promise-chain.md)

- **Observed smell:** a promise chain is dropped without visible ownership.
- **Establish:** who waits for completion and who handles rejection.
- **Repair:** return or await the promise when the caller owns completion;
  attach meaningful rejection handling where this scope owns recovery.
- **Preserve:** completion timing and error propagation. Assignment retains
  a promise and `void` marks deliberate detachment; neither installs a
  rejection handler. Do not use either merely to clear the diagnostic.
- **Boundary:** another API may own completion or deliberate detachment.
  Establish that ownership explicitly and retain the actual failure policy.

### prefer-async-await

[Rule](../rules/prefer-async-await.md)

- **Observed smell:** promise callbacks obscure ordinary sequential work.
- **Establish:** dependencies, return values, rejection handling, and timing.
- **Repair:** use async/await when it preserves those relationships. Use
  `Promise.all` only when starting independent work together is appropriate;
  use `Promise.allSettled` when every outcome belongs to the agreement.
- **Preserve:** rate limits, retries, cancellation, cleanup, and receiver
  behavior. Sequential awaits are not automatically a concurrency defect.
- **Boundary:** retain required chains with the current narrow exception
  mechanism. This preference is warning-level in the safety preset; rejection
  ownership remains separate.

## Contract contradictions

These rules report known disagreements. Unknown, dynamic, or unsupported
values can remain unknown without a contract finding. That describes the
analyzer's evidence limit, not an exemption from other rules or a proof that
runtime input is valid.

### signature-contract-call-site

[Rule](../rules/signature-contract-call-site.md)

- **Observed smell:** known arguments, arity, or excess properties disagree
  with a callable's signature.
- **Establish:** whether the caller supplied the wrong value or the producer
  declares the wrong boundary for the intended API.
- **Repair:** correct the responsible side. Supply required arguments, remove
  accidental extras, or expose intentional passthrough in the producer when
  that is genuinely its agreement.
- **Preserve:** required versus optional arguments, callback arity, and
  externally owned signatures. Do not add defaults solely to accept a bad call.
- **Evidence limit:** unknown arguments or unresolved spread information may
  prevent a conclusion. Keep their ownership visible; do not manufacture a
  contract for them.

### signature-contract-destructuring

[Rule](../rules/signature-contract-destructuring.md)

- **Observed smell:** a known family conflicts with a pattern, or a named
  property is absent from a known closed object.
- **Establish:** the producer's actual shape and the consumer's intended field.
- **Repair:** correct the pattern, typo, or producer omission. Normalize only
  if a declared boundary is responsible for translating representations.
- **Preserve:** defaults for intentional absence, nested shapes, and rest
  exclusions. A default added to a misspelled property hides the mistake.
- **Evidence limit:** unknown input is not a contradiction. Dynamic properties
  and open residual objects need their own evidence; they do not authorize
  weakening a known shape to remove a finding.

### signature-contract-operation

[Rule](../rules/signature-contract-operation.md)

- **Observed smell:** an operation conflicts with the known receiver family.
- **Establish:** whether the receiver or the consuming operation is wrong.
- **Repair:** use the operation that expresses the intended behavior, or fix
  the responsible producer. Convert representations only at an explicitly
  owned conversion boundary.
- **Preserve:** the producer's valid result. Do not replace a collection with
  text merely because a caller tries to trim it.
- **Evidence limit:** an unsupported method or unknown receiver may prevent
  inference. It does not establish operation compatibility.

```javascript
const getLabels = () => [' ready '];

// Incorrect consumer: the producer promises a collection.
getLabels().trim();

// Correct when the task is to trim each label.
const labels = getLabels().map((label = '') => label.trim());
```

### signature-contract-property

[Rule](../rules/signature-contract-property.md)

- **Observed smell:** a statically named property is absent from a known
  closed object.
- **Establish:** whether the name is wrong, the producer omitted a promised
  property, or the lookup is intentionally data-driven.
- **Repair:** correct the name or implement the actual promised field. Use
  an explicit dynamic lookup only when the key is genuinely data.
- **Preserve:** closed-shape evidence. Do not add rest, a default, or a wider
  model solely to conceal a typo.
- **Evidence limit:** open, external, or platform boundaries can remain
  unknown. Consult the rule for computed access and inherited members.

### signature-contract-return-consistency

[Rule](../rules/signature-contract-return-consistency.md)

- **Observed smell:** known normal return paths produce incompatible families.
- **Establish:** the producer's promised result and whether the branches
  represent ordinary falsifiable outcomes or distinct alternatives.
- **Repair:** use the agreement's falsifiable response for ordinary absence;
  use a deliberate resolver or result model when alternatives need distinct
  interpretation.
- **Preserve:** meaningful failure information and normal-return behavior,
  including fallthrough. Throws and async rejection have separate failure
  contracts; agreement on returns does not prove termination.
- **Evidence limit:** unknown paths are not widened into invented certainty.
  Resolve runtime uncertainty at its owner when the application requires it.

## Verify the repair, not just the diagnostic count

For the boundary changed, compare relevant cases before and after:

- ordinary valid input and its promised result;
- omitted input and meaningful empty values, including `0` and `false`;
- known wrong-family input and the intended diagnostic or runtime response;
- callbacks absent and present, including a truthy non-callable when relevant;
- observable ordering, receivers, identity, and error paths affected by a rewrite.

Use [diagnostic evidence](diagnostic-explanations.md) to confirm the source of
an agreement. For repository code changes, follow the applicable tests,
fixtures, lint, and suppression review in [AGENTS.md](https://github.com/augurone/artikulates-resilient/blob/main/AGENTS.md).
Do not make intentionally invalid fixtures pass.

If a repair cannot be selected without guessing product intent, state the
specific unresolved boundary and seek that decision. Do not select a new
meaning simply because it produces fewer diagnostics.

## Information an assisted repair must carry

A repair proposal should identify:

- the observed smell and supporting source evidence;
- the intended agreement and its owner;
- the proposed edit and why it restores that agreement;
- behavior that must remain observable;
- any accepted boundary or narrow exception;
- the cases used to verify the result and any remaining unknowns.

Automation may apply a repair only when those decisions are established.
Short syntax is not evidence of a safe automatic transformation.
