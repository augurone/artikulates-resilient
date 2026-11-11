# TypeScript lowering pattern taxonomy

Use this catalog to find the current semantic owner before adding a rewrite.
The [lowering contracts](typescript-lowering-algebra.md) define preservation
obligations; the [project guide](../engineering/typescript.md) defines public
configuration and compiler support. Grammar, Policy and Semantics remain
authoritative. These categories are not exhaustive compiler coverage.

## Reading a status

- **Supported:** a current path implements the stated operation. It still obeys
  its documented input and policy boundary.
- **Bounded:** a current recipe needs particular source/ownership evidence.
  Similar-looking source outside that admission gains no equivalence proof.
  Its owner may retain native syntax, leave a finding or report unsupported
  lowering; it must not invent evidence to force a target form.
- **Future/general case:** no general contract is established. A supported
  special case does not authorize an automatic extension or implementation.

## Current families

| Family | Status and source contract | Current owner and functional evidence |
| --- | --- | --- |
| Defaults and model normalization | **Supported** within current optional-binding/model grammar. Undefined may select the declared canonical empty family; null/NaN and required source failures are separate. Generic/unknown payloads gain no fabricated default, and a callable gains no no-op. | [Default policy](../../transforms/typescript/policy/defaults.js), [resolver grammar](../../transforms/typescript/grammar/resolvers.js); [compiler output](../../tests/compiler-output.test.js). |
| Function, declaration and class capabilities | **Bounded.** Convert declarations only with completed lifetime/reference evidence. Otherwise retain necessary hoisting, TDZ, construction, prototype, receiver and arity behavior, or report unsupported lowering. Native classes do not become plain factories by appearance. | [Functions](../../transforms/typescript/lowering/functions.js), [declarations](../../transforms/typescript/lowering/declarations.js), [class boundaries](../../transforms/typescript/lowering/native-class-boundary.js); [class behavior](../../tests/typescript-native-class-boundary.test.js). |
| Static member selection and repeated Gets | **Bounded.** Signature/body extraction needs source phase and binding ownership. Preserve later Gets across authored bindings and const-source aliases, including literal-indexed/wrapped receivers; receiver protocols and unknown accesses need their own decision. | [Member lowering](../../transforms/typescript/members/index.js), [source facts](../../transforms/typescript/understand/type-evidence.js); [public output contracts](../../tests/typescript-output-contracts.test.js). |
| Required tuples, rest positions and unused bindings | **Bounded.** Preserve container/iterator initialization failure; admitted opaque/callable required positions also preserve source absence and consumer failure. Scalar slot normalization is separate. Fixed indexed rest reads may use numeric-property binding without adding an iterator. Elision cannot remove advancement, defaults, effects or observable formals. | [Member grammar](../../transforms/typescript/members/index.js), [final grammar](../../transforms/typescript/grammar/final.js); [compiler behavior cases](../../tests/typescript-transform.test.js), [output contracts](../../tests/typescript-output-contracts.test.js). |
| Optional arity and overload result channels | **Bounded.** Actual source count/presence selectors and declaration/result evidence may retain callable-versus-value channels. Private carrier conversion has separate lifetime and arguments rules; no general arity reconstruction from erased signatures is allowed. | [Arity lowering](../../transforms/typescript/lowering/arity.js), [return boundaries](../../transforms/typescript/lowering/arity-returns.js); [dynamic arguments](../../tests/typescript-dynamic-arguments.test.js). |
| Provider/factory forwarding and callable dispatch | **Bounded.** Resolve the actual producer, required field and consumer. Keep source property timing, receiver/payload identity and failure ownership; optional/opaque siblings cannot borrow a proved field. | [Provider forwarding](../../transforms/typescript/members/provider-forwarding.js), [exact forwarding](../../transforms/typescript/members/exact-provider-forwarding.js); [provider provenance](../../tests/typescript-provider-provenance.test.js), [dispatch](../../tests/typescript-provider-dispatch.test.js). |
| Selected union fields and ordered branches | **Bounded.** Complete finite alternatives and the actual discriminator/selector may admit branch-local selection. Preserve guard, operand, callback and repeated-read phases; do not manufacture a discriminant or default for an opaque payload. | [Selected models](../../transforms/typescript/members/selected-models.js), [ordered decisions](../../transforms/typescript/lowering/ordered-decisions.js); [selection](../../tests/typescript-general-selection.test.js), [terminal fields](../../tests/typescript-general-terminal-field.test.js). |
| Live collections, mutation and deletion | **Bounded.** Preserve native method lookup, live visitation, equality, mutation identity, callback/argument order and closing. A copied Map's delete cannot generally become a filtering predicate; an object literal alone does not prove immutable reconstruction. | [Collection placement](../../transforms/typescript/lowering/collection-reconstruction.js), [capability consumers](../../transforms/typescript/members/capability-consumers.js); [collection observables](../../tests/typescript-collection-observables.test.js), [deletion](../../tests/typescript-general-deletion.test.js). |
| Materialized collection reduction | **Bounded.** An actual source-owned snapshot can admit one bounded traversal and one final collection construction. Keep guard/value effects together; do not snapshot a live input or copy the growing accumulator per visit. | [Algebra grammar](../../transforms/typescript/grammar/algebra.js), [collection placement](../../transforms/typescript/lowering/collection-reconstruction.js); [materialized collections](../../tests/typescript-materialized-collection.test.js). |
| Type/module namespace identity | **Bounded.** Resolve qualified declarations and helper dependencies. Preserve genuine empty runtime namespaces and module failures; only closed owned erased-module evidence, including owned type-only augmentations, can justify the exact namespace boundary. Unknown/external/value-bearing modules remain ungranted. | [Type resolution](../../transforms/typescript/understand/type-resolution.js), [module evidence](../../transforms/typescript/understand/imports.js), [import placement](../../transforms/typescript/grammar/imports.js); [compiler output](../../tests/compiler-output.test.js), [project completion](../../tests/typescript-project-completion.test.js). |
| Authored async, calls and effects | **Bounded.** Retain native operations within admitted compiler/grammar modes. Keep call order, receiver, returned carrier, scheduling and rejection ownership. Explicit void can mark already-discarded fulfillment forwarding; it does not install a rejection handler. No blanket then-to-await conversion or parallelization is implied. | [Detached forwarding](../../transforms/typescript/lowering/detached-promise-work.js), [resolved calls](../../transforms/typescript/lowering/resolved-source-calls.js); [compiler behavior](../../tests/typescript-transform.test.js), [promise policy](../../tests/promise-ownership.test.js). |
| Layout and retained-rule placement | **Supported** after semantic decisions. Preserve token meaning, return operands, comment payloads and exact directive scope. Source formatting or a generated guard is not new semantic evidence. | [Emission layout](../../transforms/typescript/grammar/emission-layout.js), [exceptions](../../transforms/typescript/policy/exceptions.js); [emission behavior](../../tests/typescript-emission-layout.test.js), [import effects](../../tests/typescript-emission-import-order.test.js). |

## Applying a recipe

1. Identify the original operation and its binding/declaration owner, including
   defaults, aliases, captures and source revision.
2. Separate static requirements from established execution facts and incomplete
   evidence. Decide whether normalization or native preservation is intended.
3. Find the existing fact/decision and grammar consumer. Reuse it when its
   semantics fit; names, target syntax and lint counts are not admission evidence.
4. Challenge order, skipped work, identity, receiver, iteration, callable metadata
   and exact failures. Check the negative boundary as well as the admitted case.
5. Compare native/raw/fixed execution and complete production lint independently.
   Keep visible findings when the recipe cannot lawfully remove them.

For example, `return next!(first.apply(this, arguments))` needs no new guard
merely because assertions erase. A missing `next` fails after `first` runs; a
guard that returns early would change the source contract. Conversely, moving
`input.value` into a signature can be wrong when an earlier authored binding
or callback owns an observable Get. The existing source-phase owner decides
that case; it is not a new exception for every similar-looking expression.

## General cases and separate feature gaps

General automatic reconstruction of arbitrary loops, mutable captured state,
custom iterators, effectful providers or ambiguous structural unions remains
unestablished. Current finite recipes do not prove those general cases. Native
retention, incomplete analysis and explicit unsupported diagnostics have distinct
meanings; none is permission to fabricate a model or silence another rule.

Compiler acquisition has its own bounded syntax and execution support; it does
not define the entire emitter's support. Likewise, successful lowering does not
establish direct TS/TSX ESLint parsing, framework behavior or generic external
test discovery. The [feature review](../engineering/feature-review.md) records
those separate gaps. Extending any boundary requires a source-owned contract
and functional acceptance, not a corpus-specific pattern or historical packet.
