# no-length-comparison

This rule is implemented in [the current package](../../analysis/eslint/no-length-comparison.js).
Its implementation uses syntax and lexical ownership.

For native nonnegative collection counts, the rule recognizes presence/absence
comparisons `> 0`, `>= 1`, `!== 0`, `< 1`, `<= 0` and `=== 0`, including mirrored
operands. It retains the existing dot-`length`, numeric-literal scope. Exact
cardinality and other bounds, such as `=== 1`, `!== 1`, `> 1` and `<= 1`, keep
their meaning. Loose equality and coercive operands are not added.

The property name does not establish a native count. Custom lengths may be
negative, fractional, nullish, BigInt or NaN, so this policy finding supplies no
automatic rewrite or suggestion. Authored reads and evaluation remain unchanged.

The current supported behavior and boundary cases are verified by:

- [rule-contracts.test.js](../../tests/rule-contracts.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
