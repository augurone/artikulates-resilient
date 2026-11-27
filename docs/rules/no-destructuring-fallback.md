# no-destructuring-fallback

This rule is implemented in [the current package](../../analysis/eslint/no-destructuring-fallback.js).
Its implementation uses syntax and lexical ownership.

The source owns its shape and absence contract. Destructuring should consume
that agreement, with defaults or guards at the owning boundary, instead of
supplying another local `||` fallback. Such a fallback can conceal a missing
contract or redundantly repeat one already declared; the finding alone does not
prove which case applies.

The rule covers object and array patterns in declarations, parameter or nested
pattern defaults, and assignments. Only an actual pattern/`||` match performs
the existing host lexical lookup to identify a direct parameter source. It
does not trace arbitrary producers, add root-default requirements, or validate
unknown values. Named defaults, ordinary `||` selection and guarded consumption
retain their existing treatment. `||` remains preferred; replacing it with `??`
is not a repair.

Native nullable results and optional private lookup/list results are normalized
at their acquisition boundary before consumers extract fields. Preserve their
present values, failure behavior and raw missing-value sentinels where guards
need them. The rule supplies no automatic rewrite or invented replacement value.

The current supported behavior and boundary cases are verified by:

- [rule-contracts.test.js](../../tests/rule-contracts.test.js)
- [signature-policy.test.js](../../tests/signature-policy.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
