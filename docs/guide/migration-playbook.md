# Repairing code in the Resilient dialect

Start with the agreement at the changed boundary: who supplies the value, what
the consumer needs, what absence means, and who owns failure. Repair that
agreement while preserving observable behavior. The [language references](../reference/README.md)
define the dialect; [rule pages](../rules/) identify individual checks.

## Work from the finding to its owner

1. Read the actual rule, location, and message using the
   [diagnostic workflow](diagnostic-explanations.md).
2. Follow the relevant signature, supplied argument, default, guard, return,
   alias, or imported producer. The highlighted use may be correct while its
   producer is wrong, or the producer may be correct while the consumer is wrong.
3. State the intended input, result, absence behavior, and failure policy.
   Preserve any boundary that remains unknown to static analysis.
4. Choose the smallest change that expresses those decisions. Identify required
   getters, receivers, identity, effects, iteration, and cleanup before moving work.
5. Check representative behavior and the configured diagnostics. A lower finding
   count alone does not establish a correct repair.

An unresolved product decision needs an explicit owner. A default, guard, or wider
shape introduced only to clear a diagnostic supplies a new behavior that the
original program may never have promised.

## Signatures, defaults, and supplied values

[Signature destructuring](../rules/prefer-signature-destructuring.md) exposes
the fields an application-owned function consumes. Move a body binding into its
signature only when its Get and default evaluation belong at invocation time.
Conditional reads, earlier effects, repeated Gets, full-object forwarding, dynamic
keys, and external callback signatures can require their existing boundary.

[Member destructuring](../rules/prefer-destructured-member-access.md) has the same
ownership obligation. Extracting a method can lose its receiver; reading a getter
once can change a program that reads it twice. Destructure at the appropriate
phase rather than assuming every static property belongs in a parameter.

For already established application-owned records:

```javascript
export const getEnabledLabels = ({ records = [] } = {}) => records
    .filter(({ enabled = false } = {}) => enabled)
    .map(({ label = '' } = {}) => label.trim());
```

This states selection, transformation, and missing-value behavior. It does not
validate an arbitrary API response or make a supplied number into a collection.
Whether empty labels should be removed is a separate consumer requirement.

[Destructuring defaults](../rules/prefer-safe-destructuring-defaults.md) apply to
missing or undefined values, including each applicable nested boundary:

```javascript
const getItems = ({ data: { items = [] } = {} } = {}) => items;
```

They do not replace supplied `null`, `NaN`, or a wrong-family value. Preserve
required arguments and opaque payloads; an invented no-op callback claims that an
implementation exists. Rest, invoked callbacks, and documented tuple exceptions
have specific meanings rather than permission to default every binding.

Replacing a [destructuring `||` fallback](../rules/no-destructuring-fallback.md)
with a default changes the inputs selected: `||` covers all falsey values, while
a default selects undefined. Establish the intended distinction first.

## Absence, content, and external normalization

| Decision | Representation and boundary |
| --- | --- |
| Missing text or collection has an agreed empty result | Use `''` or `[]` at the owned default/return boundary. |
| Empty content controls continuation | Use array cardinality or an object-content helper. Objects and arrays are truthy even when empty. |
| A lookup needs a missing sentinel | Preserve a falsey absence result; `{}` cannot represent absence in a boolean test. |
| A supplied falsey value is meaningful | Preserve the exact absence test and explain any necessary local exception. |
| Arbitrary data needs a local model | Validate or normalize once where the application owns that handoff. |
| Distinct outcomes need different interpretation | Design an explicit result shape or resolver; keep error and absence information. |

For example, assume this provider deliberately converts unusable input to an
empty name, keeps only string names, and discards additional fields:

```javascript
import { getObject } from 'eslint-plugin-resilient/standard/object';

export const normalizeProfile = payload => {
    const { name = '' } = getObject(payload);

    return { name: typeof name === 'string' ? name : '' };
};

export const getProfileLabel = ({ name = '' } = {}) => name.trim();
```

The outer helper and field check have different jobs. An application can use its
own shared utility with the required behavior; ordinary JavaScript does not need
an analyzer runtime to implement this boundary. Rejection, passthrough, or distinct
invalid/missing states would require a different normalization policy.

[Falsey returns](../rules/prefer-falsey-returns.md) should preserve the producer's
agreed family. `0` and `false` can be successful answers; an empty collection can
be a valid result. A bare return remains meaningful for an effect/control exit.
Do not discard externally meaningful absence or failure information.

[Null](../rules/no-null-assignment.md) and
[undefined assignments](../rules/no-undefined-assignment.md) can also change
property presence, clearing, or withdrawal of an implementation. Removing a write
is safe only when its observable effect is unnecessary. Natural absence requires
no replacement value. `const` prevents rebinding, not mutation of the object.

For [undefined comparisons](../rules/no-undefined-comparison.md), truthiness is
appropriate only when `0`, `false`, `''`, `null`, and `NaN` have the same intended
consequence. A `typeof` check can also preserve a non-throwing read of an undeclared
identifier. Retain a necessary exact test with its named exception under P-03.

For [length checks](../rules/no-length-comparison.md), use `!items.length` for empty
and `items.length` in a condition for non-empty. Use `!!items.length` when the result
must be boolean. Preserve exact cardinality tests such as `items.length === 1`.

## Control flow, traversal, and identity

[Guard clauses](../rules/no-else.md) and
[separate branch-owned functions](../rules/no-nested-if.md) can make continuation
explicit. An early return is correct only when that path should stop the enclosing
function. Preserve condition evaluation and work shared after a branch.

Choose a [collection method](../rules/prefer-prototype-methods.md) that states the
operation: selection, mapping, aggregation, search, or an effect. Compare sparse
slots, callback arguments, order, early termination, and the absence result of
`find`. `forEach(async ...)` does not wait for its callbacks. Sequential work can
be required for dependencies, polling, retry, or rate limits. Native `await`,
`break`, or `return` does not automatically grant a loop-policy exception.
Every loop that must remain requires its applicable narrow, named exception with
a concrete semantic reason, including any completed retained-boundary annotation.

[Returned transformations](../rules/prefer-safe-transformations.md) make
replacement-owned state changes visible:

```javascript
export const updateLabel = (
    { count = 0, ...state } = {},
    { label = '' } = {}
) => ({ ...state, count: count + 1, label });
```

This creates a new outer object and keeps nested references shared. Preserve
alias observations and identity-sensitive cache, ref, DOM, or draft behavior when
replacement is not the intended transition. Naming a value `cache` does not
establish permission to mutate it. The rule's configured ignore options and a
necessary source exception have different scopes; follow the project's policy.

## Callbacks and failure ownership

An [optional callback](../rules/no-unguarded-callback-invocation.md) remains absent
until supplied. Test callability before invocation:

```javascript
export const notify = ({ onDone, message = '' } = {}) => {
    if (typeof onDone !== 'function') return;

    onDone(message);
};
```

Truthiness admits truthy non-callables. A no-op is an implementation, and both
paths above return no value. If the caller needs to know whether notification
occurred, design that result explicitly.

A [catch](../rules/no-silent-catch.md) must execute the chosen recovery,
translation, propagation, or reporting behavior. Preserve error identity/context,
cleanup, cancellation, and normal-return agreements.

For [promises](../rules/no-unhandled-promise-chain.md), identify who owns completion
and rejection. Return or await when responsibility passes to the caller; handle
rejection where the scope owns recovery. Assignment retains a promise and `void`
marks deliberate detachment; neither installs a rejection handler.
[Async/await](../rules/prefer-async-await.md) is a warning-level preference in the
safety preset. Start independent work together with `Promise.all` when appropriate;
use `Promise.allSettled` when every outcome belongs to the result. Preserve required
sequencing, cleanup, and failure timing.

## Known contradictions

| Finding | Repair decision |
| --- | --- |
| [Call-site contract](../rules/signature-contract-call-site.md) | Correct the supplied value, arity, or producer signature. Required arguments and contextual passthrough need intentional ownership. |
| [Destructuring contract](../rules/signature-contract-destructuring.md) | Correct a wrong root family, misspelled field, missing producer field, or binding shape. Defaults must not conceal a typo. |
| [Operation contract](../rules/signature-contract-operation.md) | Correct the receiver or operation. Preserve a valid producer result when its consumer is wrong. |
| [Property contract](../rules/signature-contract-property.md) | Correct the static name or promised shape. Dynamic access is appropriate only when the key is genuinely data. |
| [Return consistency](../rules/signature-contract-return-consistency.md) | Preserve one agreed normal-result family or use an explicit result model for meaningful alternatives. Throws and rejection retain their separate failure contracts. |

Unknown inputs do not become known contradictions, and unknown paths cannot
erase a known conflict. Unsupported analysis is not evidence of runtime validity.

## Verify the changed boundary

Exercise the behavior affected by the repair: valid input, omitted input, supplied
falsey values, wrong-family input, optional callbacks, relevant identities, Get and
iterator order, cleanup, and failure propagation. Select cases that establish the
actual requirement rather than a cross-product of spellings.

Run configured ESLint and `resilient-check` where installed; the latter also audits
exceptions. For changes to this repository, run the acceptance command in
[AGENTS.md](../../AGENTS.md). Preserve intentionally invalid canary inputs.
TypeScript project lowering has its own [guide](../engineering/typescript.md).

A necessary [P-03 exception](../reference/policy.md#p-03-exceptions-and-precedence)
names the exact rule, narrow scope, and concrete semantic reason. The reason is a
claim for review and behavioral checks. Exempting a loop does not also exempt
mutation; exempting an async preference does not settle rejection ownership.
Avoid blanket disables and inline severity overrides. Report the changed boundary,
the evidence behind the repair, the behavior checked, and any remaining unknowns.
