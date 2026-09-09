const createIdentityIndex = () => {
    const identities = new WeakMap();
    let nextIdentity = 0;

    return (value) => {
        const existingIdentity = identities.get(value);

        if (existingIdentity) return existingIdentity;

        nextIdentity += 1;
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private WeakMap retains first-seen numeric identity without copying or mutating analyzer inputs.
        identities.set(value, nextIdentity);

        return nextIdentity;
    };
};

export { createIdentityIndex };
