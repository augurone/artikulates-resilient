# The Fallacy of the “Unknown Cliff” in Modern Web Applications

[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)
[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

---

## What dynamic data does—and does not—take away

Modern web applications are built at the meeting point of two kinds of knowledge.

Inside the application, the source can tell us a great deal. A function tells us what it accepts and what it returns. Defaults describe what absence means. Operations reveal what a value is expected to do. Those agreements can be followed through functions, modules, components, and transformations.

Then the application meets something it does not own.

An API returns a payload. A user submits a form. A database provides a record written by an earlier version of the application. A browser API, cache, feature flag, or third-party service introduces a value whose runtime contents are not established by the local source.

Something important has changed.

It is tempting to imagine this transition as an **unknown cliff**. On one side, the program is understandable. On the other, the evidence disappears, and with it our ability to say anything useful. The external value is unknown, therefore everything that depends on it becomes unknowable.

That conclusion asks uncertainty to do far more work than it deserves.

Unknown data marks the point where one source of evidence ends. It does not erase the contracts surrounding that value, the operations performed upon it, or the agreements established after it enters application ownership.

> Unknown is a boundary marker, not a collapse of meaning.

That distinction matters because modern applications live at boundaries. The interesting question is not whether those boundaries can be made statically certain.

They cannot.

The question is what we can still know when certainty ends.

## The cliff is an attractive story

Consider a fairly ordinary API path:

```js
const response = await fetch('/api/profile');

if (!response.ok) {
    return { name: '' };
}

const profile = await response.json();

return profile.name.trim();
```

There is nothing especially reckless here.

`response.ok` establishes that the request succeeded. `json()` establishes that the response body could be decoded into a JavaScript value.

Neither establishes that the value is a profile.

The agreement may be real. The API is expected to return a profile. The application was written against that expectation. Tests, documentation, schemas, and the implementation on the other side may all reinforce it.

The local source cannot establish whether that agreement is being fulfilled now.

That is where the cliff becomes attractive.

One response is to call the payload unknowable and stop reasoning at the network boundary. Another is to let a local description stand in for the external agreement and continue as though the value has been proven.

Both claim too much.

The first throws away evidence the application still has. The second invents evidence it does not.

The boundary is smaller than either suggests:

```text
external system → unknown value → owned boundary → application value
```

The unknown belongs exactly where the evidence ends.

The application can then take responsibility for the value and establish the agreement its own code needs.

But calling something a parser does not make it a boundary:

```js
const parseProfile = ({ name = '' } = {}) => ({ name });
```

That establishes what absence means. It does not establish that `name` is usable as the application expects. `42` still becomes `{ name: 42 }`.

> Ownership requires more than moving the value through a conveniently named function. [The boundary has to produce the contract it claims to establish.](https://dev.to/augurone/the-code-is-the-contract-mk1)

```js
const normalizeProfile = ({ name = '' } = {}) => ({
    ...(!!name && !!(name.trim) && {
        name: name.trim()
    })
});

const response = await fetch('/api/profile');

if (!response.ok) {
    return renderProfile({});
}

const data = await response.json();

const { name = '' } = normalizeProfile(data);

return renderProfile({ heading: name.toUpperCase() });
```

Nothing here proves more about the API. A successful response means the request succeeded. Decoding JSON means the body became a JavaScript value. Neither tells us that `data` is a profile.

`normalizeProfile` is where this application makes its own, narrower decision. For this path, a profile is something from which the application can produce a usable name, or an absent name. That is the handoff.

After that handoff, `name.toUpperCase()` is ordinary code. It is not checking the API again. It is using the limited string agreement that the boundary has already established.

The remote system remains responsible for what it sends. The local boundary is responsible for the promise it makes to the rest of this application. That is where uncertainty stops being an excuse to stop reasoning and becomes a specific responsibility in the code.

## Unknown is not contradiction

Unknown means that the available evidence has not answered a question. It does not mean that the value has failed. It means the program has reached the limit of what this source can honestly say.

Contradiction is different. It is the moment the available evidence reveals that two claims cannot both hold. A contradiction gives us a path to graceful degradation; the expected shape is not available and will not continue through the stack. An unknown gives us a question that remains open.

That distinction keeps uncertainty in proportion. An unresolved value does not spread outward and erase the [contracts, operations, and consequences](https://dev.to/augurone/software-as-an-agreement-engine-3b6a) the rest of the application still exposes. It remains at the point where the evidence ran out.

And because it remains contained, it has an owner. The boundary that receives it can reject it, interpret it, normalize it, or deliberately carry it forward. The unknown is not a cliff beyond which reasoning stops. It is a responsibility with a location.

## The agreement keeps moving

The important consequence of a local boundary is not that it has made the outside world predictable. It is that the rest of the application no longer has to act as though the outside world is the only fact that matters.

The profile has crossed a line. On one side is a value whose contents the application cannot establish from its own source. On the other is a small, ordinary agreement that local code can use. That agreement can be passed to a component, returned from a function, stored in state, or transformed again. Each new use has its own responsibility, but it does not begin at unpredictable shapes each time.

This is what lets an application grow without making every function an integration layer. The boundary contains the question that belongs to the external system. The rest of the program can remain about the work it was written to do.

## The integration boundary

The boundary has another side. The normalizer can make an honest promise to the application, but it cannot establish that the remote service is continuing to keep its promise. That agreement has to be exercised where it exists: between the application and the service.

This is what an integration check is for. Send the request. Inspect the status and the response. Confirm that the service still produces the behavior the application depends on. A tool such as Postman is useful here not because it makes the response statically knowable, but because it crosses the boundary and asks the system itself.

That evidence belongs beside the executable agreement, not in competition with it. The local code tells us what the application will do. An integration check tells us whether the profile service is still supplying the kind of response that made that choice sensible. One follows the agreement inside the program. The other tests the agreement between programs.

Together, they give a web application a more realistic kind of confidence. The code remains legible when the network is not present. The integration boundary remains testable when the network is. Neither has to pretend to do
the other's work.

## There is no cliff

The web is full of values that arrive from somewhere else. That fact does not divide an application into a small island of reason and an ocean of mystery. It gives the application edges.

At an edge, source evidence ends and runtime observation begins. The boundary inside the application answers for the agreement it makes next. The integration boundary answers for whether two independently running systems are still
meeting each other where they actually meet.

That is not a retreat from certainty. It is a refusal to counterfeit it. The application can know what its code says, can make disagreement visible when the source reveals it, can establish a usable local agreement when an external
value arrives, and can test the external promise against the system making it.

That is the work. Not to eliminate the unknown, but to keep it from becoming an excuse for either fantasy or paralysis.

> Preserve the known. Name the boundary. Test agreement.
