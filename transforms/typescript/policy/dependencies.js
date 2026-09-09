import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { isReferenceIdentifier } from '../understand/imports.js';

const getFunctionDependencies = ({
    typescript = {}, node = {}, names = new Set(), checker = false,
    bindingIdentities = new Map(), eagerOnly = false
} = {}) => {
    const { getOriginalNode = false } = typescript;
    const { getSymbolAtLocation = false } = getObject(checker);
    const {
        ArrowFunction = -1,
        CallExpression = -1,
        Constructor = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        GetAccessor = -1,
        Identifier = -1,
        MethodDeclaration = -1,
        ParenthesizedExpression = -1,
        SetAccessor = -1
    } = getSyntaxKinds(typescript);
    const deferredKinds = new Set([
        ArrowFunction,
        Constructor,
        FunctionDeclaration,
        FunctionExpression,
        GetAccessor,
        MethodDeclaration,
        SetAccessor
    ]);
    const dependencies = new Set();

    if (eagerOnly && deferredKinds.has(getObject(node).kind)) return dependencies;

    const visit = (child) => {
        const { kind: childKind = 0, text: childText = '' } = getObject(child);

        const { arguments: callArguments = [], expression = {} } = childKind === CallExpression
            ? getObject(child)
            : {};
        const unwrap = value => getObject(value).kind === ParenthesizedExpression
            ? unwrap(getObject(value).expression)
            : value;
        const callee = unwrap(expression);
        const { body: calleeBody = false, kind: calleeKind = 0, parameters = [] } = getObject(callee);
        const immediatelyInvoked = eagerOnly && childKind === CallExpression && deferredKinds.has(calleeKind);

        if (immediatelyInvoked) {
            callArguments.forEach(visit);
            parameters.flatMap(({ initializer = false } = {}) => initializer ? [initializer] : []).forEach(visit);
            [calleeBody].filter(Boolean).forEach(visit);

            return;
        }

        if (eagerOnly && child !== node && deferredKinds.has(childKind)) return;

        if (childKind === Identifier && names.has(childText) && isReferenceIdentifier({ typescript, node: child })) {
            const original = typeof getOriginalNode === 'function'
                ? getOriginalNode(child)
                : child;
            const identity = checker && typeof getSymbolAtLocation === 'function'
                ? getSymbolAtLocation(original)
                : false;
            const dependency = identity && bindingIdentities.size
                ? bindingIdentities.get(identity)
                : childText;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Call-local dependency buffer; no AST mutation or prefix copy.
            dependency && dependencies.add(dependency);
        }

        typescript.forEachChild(child, visit);
    };

    const { body: nodeBody = undefined } = getObject(node);
    visit(nodeBody || node);

    return dependencies;
};

const isRuntimeBindingStatement = ({ typescript = {}, node = {} } = {}) => {
    const {
        ClassDeclaration = -1,
        VariableStatement = -1,
        FunctionDeclaration = -1
    } = getSyntaxKinds(typescript);
    const { kind: nodeKind = 0 } = node;

    return nodeKind === VariableStatement || nodeKind === FunctionDeclaration || nodeKind === ClassDeclaration;
};

const getRuntimeBindingNames = ({ typescript = {}, node = {} } = {}) => {
    const {
        ArrayBindingPattern = -1,
        BindingElement = -1,
        ClassDeclaration = -1,
        FunctionDeclaration = -1,
        Identifier = -1,
        ObjectBindingPattern = -1,
        Parameter = -1,
        VariableDeclaration = -1
    } = getSyntaxKinds(typescript);
    const getPatternNames = (pattern) => {
        if (!pattern) return [];

        const { kind: patternKind = 0, elements = [], text = '' } = getObject(pattern);

        if (patternKind === Identifier) return [text].filter(Boolean);

        if ([ArrayBindingPattern, ObjectBindingPattern].includes(patternKind)) return elements.flatMap((element = {}) => {
            const { kind: elemKind = 0, name: elemName = {} } = getObject(element);

            return getPatternNames(elemKind === BindingElement ? elemName : element);
        });

        return [];
    };

    const {
        kind: nodeKind = 0,
        name: nodeName = {},
        declarationList = {}
    } = getObject(node);
    const { text: nodeNameText = '' } = getObject(nodeName);
    const { declarations = [] } = getObject(declarationList);

    if ([ClassDeclaration, FunctionDeclaration].includes(nodeKind) && nodeNameText) return [nodeNameText];

    if ([Parameter, VariableDeclaration].includes(nodeKind)) return getPatternNames(nodeName);

    return declarations.flatMap((declaration = {}) => {
        const { name = {} } = getObject(declaration);

        return getPatternNames(name);
    });
};

const getRuntimeBindingIdentityEntries = ({ typescript = {}, node = {}, checker = false } = {}) => {
    const { getOriginalNode = false } = typescript;
    const { getSymbolAtLocation = false } = getObject(checker);

    if (!checker || typeof getSymbolAtLocation !== 'function') return [];

    const {
        ArrayBindingPattern = -1,
        BindingElement = -1,
        ClassDeclaration = -1,
        FunctionDeclaration = -1,
        Identifier = -1,
        ObjectBindingPattern = -1
    } = getSyntaxKinds(typescript);
    const getPatternEntries = (pattern) => {
        if (!pattern) return [];

        const { kind: patternKind = 0, elements = [], text = '' } = getObject(pattern);

        if (patternKind === Identifier) {
            const original = typeof getOriginalNode === 'function'
                ? getOriginalNode(pattern)
                : pattern;
            const identity = getSymbolAtLocation(original);

            return identity && text ? [[identity, text]] : [];
        }

        if ([ArrayBindingPattern, ObjectBindingPattern].includes(patternKind)) return elements.flatMap((element = {}) => {
            const { kind: elemKind = 0, name: elemName = {} } = getObject(element);

            return getPatternEntries(elemKind === BindingElement ? elemName : element);
        });

        return [];
    };
    const { kind: nodeKind = 0, name: nodeName = {}, declarationList = {} } = getObject(node);
    const { declarations = [] } = getObject(declarationList);

    if ([ClassDeclaration, FunctionDeclaration].includes(nodeKind)) return getPatternEntries(nodeName);

    return declarations.flatMap(({ name = {} } = {}) => getPatternEntries(name));
};

const getRuntimeBindingIdentities = ({ typescript = {}, statements = [], checker = false } = {}) => new Map(
    statements.flatMap(node => getRuntimeBindingIdentityEntries({ typescript, node, checker }))
);

const getRuntimeBindingDependencies = ({
    typescript = {}, node = {}, names = new Set(), checker = false,
    bindingIdentities = new Map(), eagerOnly = false
} = {}) => {
    const {
        ClassDeclaration = -1,
        FunctionDeclaration = -1
    } = getSyntaxKinds(typescript);
    const dependencies = new Set();
    const collect = value => getFunctionDependencies({
        typescript,
        node: value,
        names,
        checker,
        bindingIdentities,
        eagerOnly
    }).forEach((name) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This call-local dependency set accumulates eager facts without changing TypeScript input.
        dependencies.add(name);
    });

    const {
        kind: nodeKind = 0,
        declarationList = {},
        body: nodeBody = false,
        members = []
    } = getObject(node);
    const { declarations = [] } = getObject(declarationList);

    if (nodeKind !== FunctionDeclaration && nodeKind !== ClassDeclaration) {
        declarations.forEach(({ initializer = undefined } = {}) => {
            if (initializer) collect(initializer);
        });

        getRuntimeBindingNames({ typescript, node }).forEach((name) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- The private dependency set removes a declaration's own binding without copying its prefix.
            dependencies.delete(name);
        });

        return dependencies;
    }

    if (nodeKind === FunctionDeclaration && !eagerOnly) collect(nodeBody || node);

    if (nodeKind === ClassDeclaration && eagerOnly) collect(node);

    if (nodeKind === ClassDeclaration && !eagerOnly) {
        members.forEach((member = {}) => {
            const { body = false, initializer = false } = getObject(member);

            return collect(body || initializer || member);
        });
    }

    getRuntimeBindingNames({ typescript, node }).forEach((name) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The private dependency set removes a declaration's own binding without copying its prefix.
        dependencies.delete(name);
    });

    return dependencies;
};

const getRuntimeStatementDependencies = ({
    typescript = {}, statement = {}, names = new Set(), checker = false,
    bindingIdentities = new Map(), eagerOnly = false
} = {}) => (
    isRuntimeBindingStatement({ typescript, node: statement })
        ? getRuntimeBindingDependencies({
            typescript, node: statement, names, checker, bindingIdentities, eagerOnly
        })
        : getFunctionDependencies({
            typescript, node: statement, names, checker, bindingIdentities, eagerOnly
        })
);

const orderRuntimeBindingStatements = ({
    typescript = {}, statements = [], checker = false, eagerOnly = false
} = {}) => {
    const candidates = statements.filter(statement => isRuntimeBindingStatement({ typescript, node: statement }));

    if (candidates.length < 2) return statements;

    const names = new Set(candidates.flatMap(statement => getRuntimeBindingNames({ typescript, node: statement })));
    const bindingIdentities = getRuntimeBindingIdentities({ typescript, statements: candidates, checker });
    const byName = new Map();

    candidates.forEach(statement => getRuntimeBindingNames({ typescript, node: statement }).forEach((name) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private binding index keeps the first source statement per name.
        if (!byName.has(name)) byName.set(name, statement);
    }));

    const dependencies = new Map(candidates.map(statement => [
        statement,
        getRuntimeBindingDependencies({
            typescript,
            node: statement,
            names,
            checker,
            bindingIdentities,
            eagerOnly
        })
    ]));
    const dependents = new Map(candidates.map(statement => [statement, new Set()]));
    const dependencyStatements = new Map(candidates.map(statement => [
        statement,
        new Set([...dependencies.get(statement)]
            .map(name => byName.get(name))
            .filter(dependency => dependency && dependency !== statement))
    ]));
    const remaining = new Map(candidates.map(statement => [statement, dependencyStatements.get(statement).size]));

    dependencies.forEach((values, statement) => values.forEach((name) => {
        const dependency = byName.get(name);

        if (dependency && dependency !== statement) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private dependency index records reverse edges without copying each set.
            dependents.get(dependency).add(statement);
        }
    }));

    const positions = new Map(candidates.map((statement, index) => [statement, index]));
    const queue = candidates.filter(statement => remaining.get(statement) === 0);
    const queued = new Set(queue);
    const ordered = [];
    let next = 0;

    // eslint-disable-next-line resilient/prefer-prototype-methods -- This private ordered queue consumes one ready statement at a time without recursive prefix copies.
    while (next < queue.length) {
        const { [next]: statement = {} } = queue;

        next += 1;
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Call-local topological result buffer preserves statement identity.
        ordered.push(statement);
        dependents.get(statement).forEach((dependent) => {
            const count = remaining.get(dependent) - 1;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private remaining-count table; no ordering-state copy.
            remaining.set(dependent, count);

            if (count !== 0 || queued.has(dependent)) return;

            const insertion = queue.findIndex((candidate, index) => (
                index >= next && positions.get(candidate) > positions.get(dependent)
            ));
            const position = insertion === -1 ? queue.length : insertion;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private ordered queue inserts at the prior source-order position.
            queue.splice(position, 0, dependent);
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private queued set prevents duplicate dependency entries.
            queued.add(dependent);
        });
    }
    const orderedSet = new Set(ordered);

    candidates.forEach((statement) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private result buffer retains cyclic statements in source order.
        if (!orderedSet.has(statement)) ordered.push(statement);
    });

    let bindingIndex = 0;

    return statements.map((statement) => {
        if (!isRuntimeBindingStatement({ typescript, node: statement })) return statement;

        const [orderedStatement = {}] = ordered.slice(bindingIndex, bindingIndex + 1);

        bindingIndex += 1;

        return orderedStatement;
    });
};

const placeGeneratedRuntimeStatements = ({
    typescript = {}, authoredStatements = [], generatedStatements = [], checker = false
} = {}) => {
    if (!generatedStatements.length) return authoredStatements;

    const orderedGenerated = orderRuntimeBindingStatements({
        typescript,
        statements: generatedStatements,
        checker
    });
    const authoredNames = new Set(authoredStatements.flatMap(statement => (
        getRuntimeBindingNames({ typescript, node: statement })
    )));
    const generatedNames = new Set(orderedGenerated.flatMap(statement => (
        getRuntimeBindingNames({ typescript, node: statement })
    )));
    const names = new Set([...authoredNames, ...generatedNames]);
    const getStatementDependencies = ({ statement = {}, eagerOnly = false } = {}) => getRuntimeStatementDependencies({
        typescript,
        statement,
        names,
        eagerOnly
    });
    const authoredPositions = new Map();

    authoredStatements.forEach((statement, index) => getRuntimeBindingNames({ typescript, node: statement })
        .forEach((name) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private index retains the authored anchor without copying its growing prefix.
            authoredPositions.set(name, index);
        }));

    const generatedPositions = new Map();
    const placements = new Map();
    const firstEagerConsumers = new Map();

    authoredStatements.forEach((statement, index) => getStatementDependencies({ statement, eagerOnly: true })
        .forEach((name) => {
            if (generatedNames.has(name) && !firstEagerConsumers.has(name)) {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- This private index retains the first eager consumer without copying its prefix.
                firstEagerConsumers.set(name, index);
            }
        }));

    orderedGenerated.forEach((statement) => {
        const eagerDependencies = getStatementDependencies({ statement, eagerOnly: true });
        const dependencies = getStatementDependencies({ statement });
        const eagerAuthoredAnchors = [...eagerDependencies]
            .filter(name => authoredPositions.has(name))
            .map(name => authoredPositions.get(name) + 1);
        const authoredAnchors = [...dependencies]
            .filter(name => authoredPositions.has(name))
            .map(name => authoredPositions.get(name) + 1);
        const generatedAnchors = [...dependencies]
            .filter(name => generatedPositions.has(name))
            .map(name => generatedPositions.get(name));
        const hardPlacement = Math.max(0, ...eagerAuthoredAnchors, ...generatedAnchors);
        const preferredPlacement = Math.max(hardPlacement, ...authoredAnchors);
        const firstConsumer = Math.min(
            authoredStatements.length,
            ...getRuntimeBindingNames({ typescript, node: statement })
                .filter(name => firstEagerConsumers.has(name))
                .map(name => firstEagerConsumers.get(name))
        );
        const placement = preferredPlacement <= firstConsumer ? preferredPlacement : hardPlacement;
        const atPlacement = placements.get(placement) || [];

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private placement buffer retains generated statement order without copying a growing prefix.
        atPlacement.push(statement);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private placement map publishes its completed local buffer for the final merge.
        placements.set(placement, atPlacement);
        getRuntimeBindingNames({ typescript, node: statement }).forEach((name) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private index records the generated placement without copying its prefix.
            generatedPositions.set(name, placement);
        });
    });

    const result = [];

    authoredStatements.forEach((statement, index) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This call-local result buffer keeps authored and generated statement identities in placement order.
        result.push(...(placements.get(index) || []), statement);
    });
    // eslint-disable-next-line resilient/prefer-safe-transformations -- This call-local result buffer appends only the terminal placement bucket.
    result.push(...(placements.get(authoredStatements.length) || []));

    return result;
};

const getCyclicRuntimeBindingNames = ({ typescript = {}, statements = [] } = {}) => {
    const candidates = statements.filter(statement => isRuntimeBindingStatement({ typescript, node: statement }));
    const names = new Set(candidates.flatMap(statement => getRuntimeBindingNames({ typescript, node: statement })));
    const byName = new Map();

    candidates.forEach(statement => getRuntimeBindingNames({ typescript, node: statement }).forEach((name) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private first-binding index avoids copying its growing prefix.
        if (!byName.has(name)) byName.set(name, statement);
    }));

    const dependencies = new Map(candidates.map(statement => [
        statement,
        [...getRuntimeBindingDependencies({ typescript, node: statement, names })].filter(name => byName.has(name))
    ]));

    return new Set([...byName.keys()].filter(name => (
        (dependencies.get(byName.get(name)) || []).some(dependency => (
            (dependencies.get(byName.get(dependency)) || []).includes(name)
        ))
    )));
};

export {
    getCyclicRuntimeBindingNames,
    getFunctionDependencies,
    getRuntimeBindingDependencies,
    getRuntimeBindingIdentities,
    getRuntimeBindingNames,
    isRuntimeBindingStatement,
    orderRuntimeBindingStatements,
    placeGeneratedRuntimeStatements
};
