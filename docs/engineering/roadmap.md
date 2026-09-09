# Product roadmap

These are uncommitted product possibilities, not release promises or an active
work order. Current behavior belongs to the [package README](../../README.md),
[contracts API](../reference/contracts.md), rule pages and normative references.
The six rearchitecture packets are complete; their accepted baseline and
remaining semantic limits are in [REARCHITECTURE.md](REARCHITECTURE.md).

Native JavaScript expresses contract intent. Findings require source evidence
of contradiction; unknown remains unknown. The core stays independent of
frameworks, editors and runtime validation. Every extension must preserve
these boundaries and demonstrate a useful consumer result before expanding
its inference or configuration surface.

## Diagnostic quality and adoption

- Build project-wide lint and exception measurement using the
  [measurement execution plan](MEASUREMENT_EXECUTION_PLAN_2026-10-05.md), while
  retaining Resilient's own source audit and keeping consumer results distinct.
- Maintain a small corpus of real bugs, near-misses and intentional non-findings,
  naming source evidence, failure ownership, useful locations and repair paths.
- Publish a support matrix for value, control-flow, effect and failure contracts,
  distinguishing known, unknown and contradictory outcomes.
- Measure false positives, stable ordering, explainability and repair usefulness
  on at least two representative projects. Keep fixture measurements separate
  from real-project claims.
- Evaluate cold, standards-assisted and playbook-assisted adoption with the
  [agent evaluation protocol](agent-learning-evaluation.md). Keep representative
  failures as focused regressions; avoid counting discomfort as a semantic defect.
- Use consumer feedback to assess mutation findings, boundary exception ergonomics
  and migration examples. The existing guides and fixture gate are the starting
  point, not features awaiting first implementation.

Acceptance needs reviewable bug/non-finding cases, a support matrix and measured
results. Performance work starts with an observed bottleneck and reports fresh
and reused workloads separately; operation counts alone are not throughput.

## Evidence and review

Contract documents already expose evidence lookup; diagnostics carry evidence
IDs and project snapshots aggregate evidence. Extend those existing owners only
when a concrete case exposes missing path, identity, mutation or boundary detail.

Potential work includes:

- richer explanations of external, dynamic, unresolved and unsupported boundaries,
  keeping boundary markers unknown and preserving the owner of runtime failure;
- contract-aware hovers and constrained repairs over the existing offset API,
  including derivative bindings and reassignment;
- precondition, postcondition, refinement and resource-lifecycle views derived
  from executable guards, defaults, operations and returns;
- clearer ownership of mutation, cleanup, cancellation, side effects and async
  failure across aggregation, retries, catches, finally blocks and rethrows;
- review explanations showing why a provider change invalidated evidence or
  changed a diagnostic.

Acceptance requires that the explanation matches direct API and ESLint results,
that unknown calls/mutation/escaping references weaken facts correctly, and that
no annotation language, runtime validator or client dependency is introduced.

## Thin integrations

The shipped inspector already loads source and produces structured stack output.
Possible additions include a first-run configuration workflow, broader package
and workspace resolver adapters, parser-backed loading with explicit identity,
CI/review presentation, and a thin editor adapter. A general-purpose language
server requires a demonstrated workflow; it is not a prerequisite.

Adapters consume the same graph, snapshots and diagnostics. They must preserve
parser/config identity, scope, conservative invalidation and unknown dynamic or
external edges. Framework routing and application architecture remain consumer
responsibilities.

## Scope limits and historical proposals

TypeScript parity, whole-program proof, arbitrary dynamic prediction, runtime
data validation, framework ownership and a client runtime package remain outside
the current product boundary. Cross-language ideas require their own native
semantics and evidence before becoming a product commitment.

The [earlier product plans](https://github.com/augurone/artikulates-resilient/blob/d34d388387304d17a6e2b3f9751272e300b14b9b/docs/archive/engineering/product-planning.md)
retain release-specific history and the original evidence-model design. The
[research record](../reference/research.md) retains architectural and
cross-language proposals. Their unchecked lists and version headings do not
establish current priority or imply missing functionality.
