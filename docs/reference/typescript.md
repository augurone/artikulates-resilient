# TypeScript boundary

This is local navigation for the consolidated package.

The package exposes `createTypeScriptTransformer` and the installed
`resilient-lower` command. [TypeScript transformation and project lowering](../engineering/typescript.md)
define the bounded source-acquisition contract; transformer lowering has its
own supported syntax and policy. Type annotations supply requirements, never
proof of runtime values, array length or successful initialization.

The [lowering contracts](typescript-lowering-algebra.md) state preservation and
normalization obligations. The [pattern taxonomy](typescript-lowering-patterns.md)
maps recurring families to current source owners and functional evidence, with
supported special cases separated from unestablished general rewrites.

[The feature review](../engineering/feature-review.md) distinguishes implemented
lowering from direct TS/TSX ESLint integration, which is outside the required
scope. Fluency reports describe lint coverage of emitted files;
application execution, observable order, identity and failures require separate
native/raw/fixed proofs. Lowering remains experimental rather than compiler parity.
