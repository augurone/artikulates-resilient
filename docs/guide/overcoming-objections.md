# Questions about the agreement model

Executable source establishes evidence; signatures, defaults and operations
express independently owned requirements. Resilient compares them within its
supported analysis boundary. Grammar and policy also select permitted forms.
Read the [language references](../reference/README.md) for requirements and the
[feature review](../engineering/feature-review.md) for current support limits.

## Do defaults validate data?

A JavaScript default runs for undefined, including an omitted argument or field.
It preserves other provided values. It does not make null into a record or a
number into an array. Destructuring and property access can still fail. Runtime
validation or deliberate normalization belongs to the boundary that owns it;
an analyzer may not invent that work.

For example, `({ items = [] } = {}) => items` supplies an empty array for missing
items and retains a provided array's identity. It also passes through a provided
string. The [boundary reference](../reference/resilient-boundary-agreement-contractual-totality.md)
explains why absence handling and total input validation are different claims.

## What does unknown mean?

The requested evidence is incomplete. Unknown does not erase an established
contradiction, validate an external value or exempt source from syntax/safety
policy. Known absence, an unknown normal value, no normal completion and
operational failure remain distinct. See the [contract reference](../reference/contracts.md).

## Can evidence cross calls and modules?

Supported local signatures, arguments, returns, fields, callbacks and static
module edges contribute source-owned evidence. Producer summaries and actual
invocation conditions stay distinct. A cycle cannot supply its own missing
premise. External or unsupported work remains incomplete unless a supported
adapter establishes more evidence.

[Source selection](../reference/tree-resolution.md) defines the active closure,
resolver contract and parser limits. Inventory is not activation; the root's
custom parser does not make dependency parsing TypeScript-aware.

## Are annotations or native method names enough?

An annotation states intent or a requirement, not a runtime value or successful
execution. A method spelling alone does not establish native receiver identity.
Actual supported source and execution relationships must justify an agreement.
The [TypeScript lowering contracts](../reference/typescript-lowering-algebra.md)
keep compiler requirements separate from those facts.

## Does a clean lint prove behavior?

It establishes the configured diagnostics for the files analyzed. It does not
prove arbitrary external inputs, termination, complete analysis or that a rewrite
preserved behavior. Functional tests must exercise the relevant producer/consumer
boundary and actual artifacts. The package's self-lint and compatibility POCs
are evidence for their covered jobs, not universal project compatibility.

## How should I repair a finding?

Read its rule page, trace producer evidence and consumer requirements, then repair
the responsible boundary while preserving valid inputs, effects and failures.
Use the [diagnostic guide](diagnostic-explanations.md) and
[migration playbook](migration-playbook.md). A necessary exception identifies
its exact rule, scope and concrete semantic reason under Policy P-03.
