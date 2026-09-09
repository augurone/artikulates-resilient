# Resilient policy

Policy defines what is permitted, required, or discouraged in valid syntax.
[Grammar](grammar.md) defines forms; [Semantics](semantics.md) defines meaning.
Together they are the normative dialect specification. The
[AI guide](../ai/CODING_STANDARDS.md) presents the same rules compactly.
IDs here identify policy groups; ESLint rule IDs identify actual diagnostics.

## P-01: Rules

Individual rule pages own exact triggers, options, exceptions, and smell
explanations. This map covers every public Resilient rule without replacing
those definitions. Bare rule names have the `resilient/` namespace.

| Policy | Enforcement and detailed definition |
| --- | --- |
| Expose application-owned shapes in signatures. | [prefer-signature-destructuring](../rules/prefer-signature-destructuring.md) |
| Declare defaults at destructured levels; avoid `||` destructuring fallbacks. | [prefer-safe-destructuring-defaults](../rules/prefer-safe-destructuring-defaults.md), [no-destructuring-fallback](../rules/no-destructuring-fallback.md) |
| Destructure static property consumption. | [prefer-destructured-member-access](../rules/prefer-destructured-member-access.md) |
| Use the intended family's empty value on normalized value-producing paths. | [prefer-falsey-returns](../rules/prefer-falsey-returns.md), [no-null-assignment](../rules/no-null-assignment.md), [no-undefined-assignment](../rules/no-undefined-assignment.md) |
| Express falsey presence and zero/non-zero checks directly; preserve exact cardinality and boundary-specific distinctions. | [no-undefined-comparison](../rules/no-undefined-comparison.md), [no-length-comparison](../rules/no-length-comparison.md) |
| Use guards; avoid `else` and nested `if` in one function. | [no-else](../rules/no-else.md), [no-nested-if](../rules/no-nested-if.md) |
| Express collection operations with prototype methods. | [prefer-prototype-methods](../rules/prefer-prototype-methods.md) |
| Return transformations; make mutable boundaries explicit, including local working values. | [prefer-safe-transformations](../rules/prefer-safe-transformations.md) |
| Make failure and rejection ownership visible; guard optional callbacks. | [no-silent-catch](../rules/no-silent-catch.md), [no-unhandled-promise-chain](../rules/no-unhandled-promise-chain.md), [no-unguarded-callback-invocation](../rules/no-unguarded-callback-invocation.md) |
| Prefer async/await where conversion preserves the contract. | [prefer-async-await](../rules/prefer-async-await.md) |
| Reject known contradictions at calls, patterns, operations, properties, and returns. | [signature-contract-call-site](../rules/signature-contract-call-site.md), [signature-contract-destructuring](../rules/signature-contract-destructuring.md), [signature-contract-operation](../rules/signature-contract-operation.md), [signature-contract-property](../rules/signature-contract-property.md), [signature-contract-return-consistency](../rules/signature-contract-return-consistency.md) |

Use `Promise.all` for independent work, sequential `await` for dependencies,
ordering, rate limits, retries, polling, or early termination, and
`Promise.allSettled` when every outcome belongs to the contract. This is a
semantic review obligation, not a claim that a rule proves independence.
A bare return remains valid as a meaningful effect/control-flow exit.

## P-02: Presets and severity

The executable configuration is in [`index.js`](../../index.js):

- `configs.recommended` enables the core discipline at error severity, plus
  core ESLint rules for function expressions, `const`, strict equality,
  destructuring, binding use, return consistency, and whitespace. It rejects
  classes and optional chaining through `no-restricted-syntax`.
- `configs.contracts` enables the five contract rules at error severity.
- `configs.safety` enables transformation, callback, catch, and promise
  ownership rules at error severity. `prefer-async-await` is a warning with
  no autofix and does not fail lint by itself.
- `configs.typescript({ parser })` composes recommended, contracts, and safety
  for TS/TSX with a supplied parser and optional rule overrides.
- `configs.imports` supplies module checks through `eslint-plugin-import-x`.

A recommendation, an enabled rule, and a proven contradiction are different
things. Selected presets determine enforcement; unknown external data is not
itself a contract finding. Repository enforcement additionally follows
[`AGENTS.md`](https://github.com/augurone/artikulates-resilient/blob/main/AGENTS.md).

## P-03: Exceptions and precedence

An exception relaxes a named barrier at a specific boundary. It does not
change behavior, validate data, or resolve contradictions. Check the owning
rule's built-in exceptions and options first. Exemption from one rule does not
exempt the code from another.

| Boundary | Existing mechanism |
| --- | --- |
| Sequential or terminating loop | An observable constraint recorded by analysis; native `await` or direct loop `break`/`continue`/`return`/`throw` does not itself relax a rule. |
| Retained loop or required `.then` chain | A completed analyzer/Policy retained-boundary outcome with exact placement, or one of the repository's limited human ESLint exceptions below with a concrete reason. Rejection ownership still applies. |
| Destructuring rest, invoked callback, or `useState` tuple | Documented default-rule exceptions; optional callbacks still require invocation guards. |
| External callback, forwarding, dynamic API, receiver, or platform boundary | Preserve the actual contract and use the owning rule's supported exception if it reports. |
| Draft, cache, ref, DOM, or other mutable boundary | Consumers can configure `ignoredParameters`, `ignoredBindings`, and `ignoredProperties` on the transformation rule. Repository source requires the narrower local policy below. |

In this repository, first consider a complete destructured signature, shared
`isObject`, `getObject`, or `hasObjectValue` utilities, a returned transformation,
or an explicit boundary model. Existence lookups need falsey missing-value
sentinels; `{}` is truthy and cannot represent absence in a boolean test.

If repair changes the boundary, ordinary exceptions have exactly two permitted
forms:

```js
// eslint-disable-next-line rule-a, rule-b -- Concrete semantic reason for both exceptions.
statement();

/* eslint-disable rule/name -- Concrete semantic reason. */
const value = statement();
/* eslint-enable */
```

Rules justified on the same next line share one comma-separated directive;
stacked next-line directives target comments instead of the intended statement.
Keep each rule's concrete reason, omit duplicate rule names, and do not combine
different operation owners. Distinct rule-specific explanations may appear as
ordinary comments directly above the grouped directive; its final reason stays
on the directive line. Grouping does not establish necessity: each listed
rule must require its exception at that location. Authored directives and paired
boundaries retain their own scope.

The repository's line-length rule exempts lines beginning with the canonical
grouped next-line directive form above. The 200-column limit still applies to
ordinary comments and executable lines, including trailing directives. This
layout exception does not disable unused-directive reporting or justify any
rule listed in a directive.

The block form must contain exactly one syntactic statement or declaration.
Bare, unexplained, `eslint-disable-line`, legacy `resilient-allow` markers,
convenience file-wide, and config-wide suppressions are invalid under
AGENTS.md. Consumer-facing options do not authorize weakening repository
enforcement globally. Existing suppressions are not automatically precedents
or evidence of compliance.

Analyzer-private traversal stores and bounded caches have narrow exceptions
documented on the transformation rule page. They do not authorize mutation of
AST inputs, returned contract data, or consumer-owned values.

## P-04: TypeScript downleveling

Annotations do not bypass target policy. The adapter separates missing or
unsupported lowering evidence (`analyze`/`transform` diagnostics) from ESLint
findings. Generated helpers and authored JavaScript need the same target checks.

The current adapter emits local explanations for retained stateful loops,
dynamic member access, writes, and callee-owned or opaque defaults. These
comments identify retained boundaries; they do not prove that all rules pass
or that runtime behavior is preserved. Review exceptions against P-03 and
meaning against [S-11](semantics.md#s-11-typescript-lowering-contracts).

Do not mechanically parallelize sequential work, replace exact absence checks
with truthiness when falsey values matter, or turn receiver-dependent functions
into arrows to satisfy style. Repair the contract or retain an explained boundary.

## P-05: Verification and authority

When documentation and implementation disagree, inspect implementation and
tests and determine whether behavior is intentional before changing the spec.
The roadmap describes proposals, not current guarantees. Rule changes need
valid, invalid, and boundary tests and fixture coverage; see AGENTS.md.

Run repository tests, fixture checks, and full lint. Inspect suppressed
findings as well as ordinary errors. Report warnings and unresolved exception
issues accurately; passing fixture subsets or exception comments do not
establish overall compliance.

### Declaration comments and operator placement

The recommended [operator-linebreak](../rules/operator-linebreak.md) policy
retains `=` on the binding line when comments lead a later-line initializer.
Keep those comments after `=` and before their next executable token. Ordinary
operators retain the configured ESLint placement; comments inside initializer
parentheses do not create this exception. This is formatting policy, with no
change to lowering decisions or declaration-owned exception selection.
