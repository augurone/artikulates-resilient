# Explaining Resilient diagnostics

Resilient's normal ESLint messages are intentionally concise. A finding says
what authored source contract is contradicted, where the contradiction is,
and what operation or boundary is involved. It does not claim to have
evaluated runtime data.

## The three-step workflow

Start with the ordinary lint result:

```bash
npm run lint
```

Read the finding as a source contradiction. For example:

```text
items is array-like, but .toUpperCase() requires a string-like.
```

Then inspect the source evidence at the highlighted location. From this
repository, use:

```bash
node scripts/inspect-stack.js src/page.js \
    --find "items.toUpperCase" \
    --diagnostics \
    --evidence
```

After installing the package, the same inspector is available as:

```bash
npx resilient-inspect src/page.js \
    --find "items.toUpperCase" \
    --diagnostics \
    --evidence
```

The evidence output identifies the contract fact, its source range, scope,
status, and `derivesFrom` records. Follow those IDs from the finding toward
the source declaration. A typical path is:

```text
destructuring default
  -> known array value
  -> incompatible operation
  -> function return path
```

Use the direct API when an editor, review tool, or agent needs structured
access:

```javascript
const diagnostic = document.getDiagnosticsAtOffset(offset)[0];
const evidence = document.getEvidenceAtOffset(offset);
const explanation = document.getEvidenceForContract(contract);
```

Diagnostics carry `evidenceIds`; the evidence registry contains the stable
records those IDs reference. Raw AST nodes remain available to diagnostic
adapters, but are not part of the evidence records.

## Automatic compact hints in ESLint output

Contract rules add one short explanation to relevant findings automatically.
The contracts preset enables the rules together:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [resilient.configs.contracts];
```

The message may end with:

```text
(static evidence: default at line 1)
```

This is a navigation hint, not a second diagnosis. The full derivation chain
stays in the structured evidence output so the highlight does not become a
paragraph. To keep only the original lint wording, place this after the
contracts preset:

```javascript
export default [
    resilient.configs.contracts,
    {
        settings: {
            resilient: {
                evidenceMessages: false
            }
        }
    }
];
```

## How to classify the result

When explaining a finding, use this order:

1. Find the highlighted operation, call site, destructuring pattern, or
   property access.
2. Follow `evidenceIds` and `derivesFrom` toward the authored declaration,
   guard, alias, local return, or module source.
3. Decide whether the chain ends in a known source contradiction, a guard or
   propagation fact, or an unknown external boundary.
4. Repair the authored contradiction when the source is wrong.
5. If the chain ends at external data or an SDK call, identify the owning
   boundary. Do not turn that case into a Resilient runtime dependency or
   pretend the payload was validated.

An unknown external result is not a weaker form of a known fact. It remains
unknown. A known local value with incompatible evidence is a contradiction.

## Agent guidance

An agent working on a Resilient finding should report:

```text
Finding: what operation or boundary was highlighted.
Static fact: what contract the source establishes.
Evidence path: the relevant source records, in derivation order.
Contradiction: which known source facts disagree.
Boundary: what remains external or unknown.
Repair: the smallest source change, or the owner of the external data.
```

Agents must not respond to an external-data boundary by adding a Resilient
runtime package, inventing a schema annotation, or claiming runtime success.
