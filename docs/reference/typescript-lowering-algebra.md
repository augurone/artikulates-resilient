# TypeScript lowering contracts

This reference describes the obligations behind current lowering recipes. It
does not add a dialect, promise arbitrary TypeScript equivalence, or turn an
implementation example into a universal rewrite law. [Grammar](grammar.md),
[Policy](policy.md), and [Semantics S-11](semantics.md#s-11-typescript-lowering-contracts)
govern the target. The [project guide](../engineering/typescript.md) documents
public interfaces and supported compiler modes; the [pattern taxonomy](typescript-lowering-patterns.md)
identifies current recipe owners and their bounds.

## Evidence, decisions and grammar

The responsibility sequence is:

```text
original source + owning Program + binding identity
    -> source evidence and independently declared requirements
    -> completed policy decision with its source boundary
    -> grammar construction and source-equivalent placement
    -> JavaScript, behavioral observations and complete lint observations
```

The checker can establish declaration identity, requirements and a finite source
partition. It does not establish the contents of an arbitrary incoming value,
successful initialization, an inert getter, or a native iterator. Assertions and
non-null syntax erase; they do not validate values.

Decisions belong to original source occurrences and bindings. Equal names,
matching spans in another AST, helper spelling and generated syntax cannot
transfer proof. Several obligations may concern one source operation, but later
passes must preserve their completed decisions rather than independently choose
another extraction, default, guard or exemption. Missing evidence remains
unknown; a compiler/read failure remains an operational failure.

Current owners are [source evidence](../../transforms/typescript/understand/type-evidence.js),
[compiler acquisition](../../transforms/typescript/understand/source-analysis.js),
[policy assembly](../../transforms/typescript/policy/source-agreements.js),
[decision consumption](../../transforms/typescript/policy/destructuring-agreements.js),
and [pipeline composition](../../transforms/typescript/index.js). The compiler
adapter feeds shared analysis; grammar is not another evaluator.

## Native preservation and deliberate normalization

A native-preserving rewrite must retain the relevant observations below.

| Observation | Obligation |
| --- | --- |
| Reads and calls | Preserve count, source order, receiver binding, callee lookup, argument evaluation and exact failure phase. |
| Binding and copying | Preserve computed keys, defaults, rest/copy order, selected properties, alias relationships and initialization failure. A possible binding operation is not proof that its Gets or copying succeed. |
| Deferred execution | Keep function creation separate from invocation. A later callback Get cannot move into an enclosing signature merely because its receiver is a parameter. |
| Control flow | Preserve skipped branches, short circuiting, return/throw ownership and cleanup. Equal final values do not establish equivalent effects or completion. |
| Callable identity | Preserve observable arity, hoisting, construction, prototype, dynamic `this`, `arguments` and `new.target` unless the completed admission proves the chosen conversion lawful. |
| Collection protocols | Preserve holes, iteration/lookup timing, live visitation, callback arguments, equality rules, mutation/result identity and iterator closing. A type name alone does not establish those properties. |
| Modules | Preserve actual namespace objects, binding/reexport identity, initialization order and resolution/evaluation failures. An empty namespace is not a plain empty object. |

Model normalization is a separate executable policy. For example, an optional
numeric binding may select `0` for missing/undefined input. It does not coerce
`null` or `NaN`, prove runtime validity, or justify changing a required source
binding's failure contract. Models must keep intended passthrough attributes.
Union resolvers must not present an ambiguous object branch as a proved model.

There is no canonical no-op callback default. Required/optional callability,
forwarding and invocation guards have different owners. Introducing a guard
that returns instead of throwing is a behavior change, not mere type erasure.
Any deliberate disagreement/default policy must be explicit and independently
accepted; do not describe it as native equivalence for every possible input.

Exact source absence can be preserved by an admitted `void 0` leaf. That does
not authorize converting unknown evidence into undefined or inventing a
value-family fallback. [Defaults and agreements](../../transforms/typescript/policy/defaults.js)
own this distinction.
Exact nullish/undefined selection is also distinct from truthiness: `0`, `false`
and `''` may belong to a source's supplied-value channel.

## Composition rules

- A later discriminator or guard cannot authorize an earlier Get. Static,
  literal-indexed and wrapped reads must retain their actual receiver identity
  and phase across authored bindings, stable const aliases, calls and effects.
  Two reads of the same field need not be interchangeable.
- A tuple annotation declares positions; it does not prove supplied slots or
  successful iteration. Keep the native container/iterator initialization
  boundary. Admitted opaque/callable required-position retention also preserves
  exact missing values and consumer failure. Scalar slot normalization is a
  separate policy and supplies no replacement iterable. Numeric object selection
  belongs only to an admitted source indexed-read recipe, not general array
  destructuring.
- Supplied argument count, an optional formal and a default initializer are
  different facts. Preserve source `.length` and live `arguments` behavior.
  A callable/value overload exception needs the actual source selector,
  declaration identity and result partition; unrelated mixed returns cannot
  borrow it.
- A materialized traversal and a live collection are different operations.
  Do not introduce a snapshot, split effectful guard/value evaluation into
  separate passes, or repeatedly copy an increasing prefix without a lawful
  source-owned reconstruction decision.
- Resolved factories and providers can supply bounded required-field or
  forwarding decisions. Preserve payload/callable identity and the source Get;
  do not manufacture a model, callback or early return from a familiar name.

[Algebra constructors](../../transforms/typescript/grammar/algebra.js) assemble
these already-selected operations. Their presence does not approve arbitrary
uses of the same target syntax.

## Retained boundaries, layout and acceptance

When preferred grammar would change an owned contract, retain the operation or
report the existing unsupported boundary. A necessary Policy P-03 exception
names its exact rule, operation and semantic reason. It must respect authored
directives and end before unrelated operands or mutations; lint counts never
create permission. The [exception owner](../../transforms/typescript/policy/exceptions.js)
and [final grammar](../../transforms/typescript/grammar/final.js) consume completed
source decisions.

[Layout](../../transforms/typescript/grammar/emission-layout.js) follows semantic
placement. It preserves literal/comment payloads, directive scope and expression
grammar, including return operands across line-terminating comments. Formatting
cannot establish availability, choose a branch or validate a value.

Accept a recipe through the public compiler/project boundary with an independent
native result and actual raw/fixed execution. Separate intentional normalization
from supplied-value parity; assert identity and failures inside each variant.
Keep full lint phases, suppressions and output/configuration identity visible.
State work/storage assumptions for the changed mechanism, including traversal
and copying costs. No universal linear bound or successful whole-project proof
follows from a small accepted recipe. See [verification](../engineering/README.md).
