# Writing Resilient from first principles

Use this guide when you can write JavaScript but have not yet learned the
Resilient dialect. It teaches how to make an implementation decision using the
repository's documentation and code. The [coding standards](CODING_STANDARDS.md)
remain the compact rule map; [Grammar](../reference/grammar.md),
[Policy](../reference/policy.md), and [Semantics](../reference/semantics.md)
remain the normative specification.

## Start with the agreement

Before choosing syntax, state what the function receives, what it promises,
and who owns disagreement. For example: “This function receives application
records and returns their enabled labels. Missing records produce an empty
collection. The provider owns validation of external records.” That statement
already determines the signature, return family, collection operations, and
location of runtime checks.

The central discipline, explained in
[Software as an Agreement Engine](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog-software-as-agreement.md), is:

> Agree wherever possible. Disagree gracefully. Allow the unknown to remain unknown.

A producer owns the agreement at its boundary. The consumer interprets the
received value within its own scope. A numeric producer can return `0` without
explaining whether each caller should interpret it as a count, an identity,
or an absence-like result. A collection producer can return `[]` and still
fulfill its collection agreement. The consuming guard decides whether there
is work to do.

The [Code Is the Contract](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog-the-code-is-the-contract.md) explains
why signatures, defaults, operations, and returns carry these facts. Read code
for those facts before adding a model or an annotation that repeats them.
Models are useful where ownership, persistence, compatibility, or runtime data
requires an independent boundary.

## Use the repository as a working vocabulary

Read the normative trio first, then use this guide and the coding standards to
apply it. Find the closest implementation and its tests before inventing a
new pattern. These sources answer different questions:

| Question | Source |
| --- | --- |
| What forms and meanings belong to the dialect? | [Grammar](../reference/grammar.md), [Policy](../reference/policy.md), [Semantics](../reference/semantics.md) |
| Why make these choices? | [The Code Is the Contract](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog-the-code-is-the-contract.md), [Undefined](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog_lets_define_undefined.md), [Unknown Cliff](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog-fallacy-of-the-unknown-cliff.md) |
| What exactly triggers a rule or qualifies for an exception? | The owning [rule page](../rules) and corresponding tests |
| How are agreements constructed and uncertainty retained? | [Contract model](../../rules/contracts/model.js) and [flow analysis](../../rules/contracts/flow.js) |
| Which shared predicates already exist? | [Object](../../rules/support/object.js), [array](../../rules/support/array.js), and [function](../../rules/support/function.js) utilities |
| How does application code compose external shapes? | The sibling Artikulates project's `src/providers/`, especially Sanity's `shared-utils.js` and the Contentful GraphQL provider |
| What can the analyzer currently prove? | [Contracts reference](../reference/contracts.md) |

Blogs explain intent and may contain illustrative counterexamples. Do not copy
every snippet as approved target code. For
example, a truthiness check of a callback does not prove callability, and a
guard does not by itself supply an optional parameter default. The current
rule references settle those details. The
[exceptions essay](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog-swearing-and-slang-making-a-dialect-measurable-and-responsive.md)
explains the migration; current marker and exception behavior
belongs to [Policy P-03](../reference/policy.md#p-03-exceptions-and-precedence).

Existing code is evidence to inspect in context. A local suppression protects
its stated boundary; it is not general permission to repeat the suppressed
form elsewhere. An implementation limitation does not redefine the dialect.

## Make the boundary decision before writing the body

For each function, work through these questions in order:

1. **Who owns the input?** An application-owned record can expose its consumed
   fields in the signature. An SDK object, callback argument, dynamic record,
   or opaque forwarded value may need to retain its original boundary.
2. **What evidence exists?** Separate known facts, known contradictions, and
   unknown data. A property name alone does not establish its value family.
3. **What does absence mean here?** Choose the agreement's empty value where
   a default is valid. Preserve a required or externally owned boundary when
   inventing a value would change it.
4. **What must the consumer test?** Test callability for invocation, cardinality
   for collection content, or the particular domain condition required. Give
   a predicate only the meaning it actually establishes.
5. **What does every normal return promise?** Include guard exits and implicit
   fallthrough. Handle throws and async rejection according to their own
   failure contract.
6. **What behavior must survive?** Preserve property-read timing, receivers,
   identity, ordering, effects, cleanup, and failure ownership when rewriting.

Then select the executable form. Consult the relevant rule's exception only
when the ordinary form cannot preserve the actual boundary.

## Example: express an owned collection contract directly

Assume these are application-owned records whose supplied fields already
honor the declared families. Missing values have the defaults shown:

```javascript
export const getEnabledLabels = ({
    records = []
} = {}) => records
    .filter(({ enabled = false } = {}) => enabled)
    .map(({ label = '' } = {}) => label.trim());
```

The signature declares the consumed shape. `filter` expresses selection;
`map` expresses production of labels. Missing records produce `[]`; a missing
label produces `''`. There is no accumulator to mutate or mixed-family
failure return to explain.

A known call supplying `{ records: 42 }` contradicts this boundary. A default
does not excuse it. An external payload remains unknown to static analysis;
this function does not validate it merely by declaring defaults.

Do not automatically remove empty labels. Whether `''` belongs in the result
is a consumer requirement, and filtering it would be a new behavior.

## Choose defaults, guards, and resolvers for their actual jobs

| Need | Executable decision |
| --- | --- |
| Missing or `undefined` text means empty text | A default of `''` |
| Missing collection means no elements | A default of `[]` |
| A record needs named fields and passthrough | Nested destructuring with defaults and object rest |
| Arbitrary input needs an object-family boundary | The existing `isObject` or `getObject` utility, according to the chosen failure behavior |
| Array content controls whether work proceeds | Its length or `hasArrayContent`; validate elements separately if required |
| A callback may be absent | Leave it absent and guard invocation with `isFunction` or `typeof` |
| Distinct alternatives need a decision | A resolver whose branches preserve their agreements |
| An opaque argument belongs to an external callee | Preserve the callee's required/default behavior |

`{}` and `[]` are truthy. `hasContent({})` and array length provide the
respective content tests. The shared object helper checks own enumerable
string-key content, not nested validity. `hasContent({ name: '' })` succeeds.
An existence lookup tested as a boolean therefore needs a falsey missing
sentinel, not `{}`.

For numeric agreements, `0` is the canonical falsifiable response. Runtime
`NaN` needs an explicit numeric boundary decision; a default does not replace
an incoming `NaN`. Do not coerce an invalid value merely to silence a known
contradiction. Likewise, `false` can be a correct boolean answer. Neither
value is universally a failure.

### Example: establish an external record once

Suppose a provider explicitly owns this normalization policy: unusable input
produces `{ name: '' }`, only string names survive, and additional fields are
not part of the returned application model. Using the repository's existing
object utility, the boundary can be written as follows. In an application,
use its corresponding shared utility; this example does not require adding
the analyzer package as a client runtime dependency.

```javascript
import { getObject } from '../../rules/support/object.js';

export const normalizeProfile = payload => {
    const { name = '' } = getObject(payload);

    return {
        name: typeof name === 'string' ? name : ''
    };
};

export const getProfileLabel = ({ name = '' } = {}) => name.trim();
```

`getObject` establishes the outer record boundary; the field check establishes
text. The next function consumes that agreement without repeating the runtime
validation. An API requiring rejection, passthrough, or distinct invalid and
missing states needs a different explicit policy. This normalizer is correct
for the stated handoff, not a universal rewrite for every payload.

The [Unknown Cliff essay](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog-fallacy-of-the-unknown-cliff.md)
explains the ownership decision: uncertainty at one boundary does not erase
known behavior throughout the application.

## Example: absence of a callback remains observable

```javascript
export const notify = ({ onDone, message = '' } = {}) => {
    if (typeof onDone !== 'function') return;

    onDone(message);
};
```

This function performs an effect and may exit without a value. It tests the
capability it uses. Replacing a missing callback with `() => {}` would claim
that an implementation exists. `onDone && onDone(message)` would accept a
truthy non-function. Neither expresses the same agreement.

The result of `notify` does not tell the caller whether the callback ran:
both paths return no value. If the caller needs that information, explicitly
design a result agreement. The
[Undefined essay](https://github.com/augurone/artikulates-resilient/blob/main/docs/blogs/blog_lets_define_undefined.md)
explains why naturally absent values and invented implementations differ.

## Example: return a transformation with explicit passthrough

```javascript
export const updateLabel = (
    { count = 0, ...state } = {},
    { label = '' } = {}
) => ({
    ...state,
    count: count + 1,
    label
});
```

The signature exposes the consumed count and preserves the remaining keys.
The result is a new outer object with the updated fields. Nested references
are shared. Use this when replacement is the intended state transition; do
not substitute it for an identity-sensitive cache, ref, DOM object, or draft
update without inspecting that boundary.

Use `const` for the ordinary binding discipline. `let` is the explicit
changing-binding exception: its initializer does not impose a permanent value
family. Check each use against the value established at that point. `const`
prevents rebinding but does not freeze the referenced object; mutation policy
still has its own job.

## Preserve control flow and failure ownership

Use guards to stop irrelevant work, and collection methods to state selection,
transformation, or aggregation. A loop with sequential `await` or direct
termination can already be the correct form. Read
[S-07 through S-09](../reference/semantics.md#s-07-control-flow-contracts)
before replacing traversal: sparse arrays, callback arguments, evaluation
order, and early exits can make similar-looking forms behave differently.

Group async operations only when their work is independent and starting them
together preserves the agreement. Keep dependencies, rate limits, retries,
and meaningful ordering sequential. A catch must handle, translate, rethrow,
or explicitly supply the agreed fallback. Returning or awaiting a promise
propagates failure responsibility; assignment and `void` alone install no
rejection handler.

If ordinary syntax cannot preserve the boundary, use the owning rule's
supported, narrow exception and explain the specific behavior protected.
Exempting a loop does not grant permission to mutate its inputs. Exempting a
promise preference does not remove rejection ownership. Follow current
[P-03](../reference/policy.md#p-03-exceptions-and-precedence) for the mechanism.

## Read a contradiction back toward its source

When a diagnostic appears, inspect the producer's signature and returns, the
call arguments, intervening transformations, and the operation that consumes
the value. Decide which boundary contradicts the intended agreement before
changing either side. Do not change `[]` to `''` just because a downstream
caller incorrectly uses `trim()` on a collection.

The [diagnostic guide](../guide/diagnostic-explanations.md) explains evidence
inspection. The [migration playbook](../guide/migration-playbook.md) helps
locate repeated patterns; its short remediation entries still require the
boundary decisions above. Missing evidence is not a reason to invent a type,
add a blanket suppression, or weaken a producer's known agreement.

## Check that the implementation says what you intended

Review the result against the agreement you stated before coding:

- Do signatures expose the application-owned fields actually consumed?
- Do defaults state absence behavior without inventing input validity?
- Do guard exits and other normal returns preserve the promised agreement?
- Does unknown data retain a clear owner until a real boundary handles it?
- Are receivers, identity, effects, and failure paths preserved?
- Does each exception protect a concrete boundary and only its named rule?

For code changes, use the repository's applicable tests, fixtures, and lint
requirements in [AGENTS.md](https://github.com/augurone/artikulates-resilient/blob/main/AGENTS.md). Behavioral cases should include
missing values, meaningful empty values, known contradictory inputs, and the
external or exceptional boundary being protected. A passing lint result is
one check; explaining why the resulting behavior honors the agreement is the
measure of fluency.
