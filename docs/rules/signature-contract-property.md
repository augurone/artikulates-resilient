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
returns. A statically named access such as `user.nmae` is a source-code
contract violation when the known object contains `name` but not `nmae`.

Computed member keys are data, not statically named properties. The rule does
not guess that `user[propertyName]` is a misspelling. For a data-driven read,
prefer computed destructuring with an explicit default:

```javascript
const { [propertyName]: name = '' } = knownUser;
```

Open residual objects, unknown external values, and platform objects remain
unknown rather than producing a guessed finding. Inherited `Object.prototype`
members are allowed.

This is an opt-in contract rule enabled by `resilient.configs.contracts`.
