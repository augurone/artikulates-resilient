# signature-contract-property

Reports access to a property that is absent from a known closed object
contract.

## Smell

A misspelled or removed property can remain valid JavaScript while failing only
when the code runs. When an object was constructed locally or returned by a
known function, Resilient can report the access at its source:

```javascript
const getUser = () => ({ name: '' });

getUser().nmae; // reported
```

The rule also checks known object properties carried through local aliases and
returns. Open residual objects, unknown external values, dynamic properties,
and platform objects remain unknown rather than producing a guessed finding.
Inherited `Object.prototype` members are allowed.

This is an opt-in contract rule enabled by `resilient.configs.contracts`.
