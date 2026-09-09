import { getObject } from '../../../rules/support/object.js';
import { getSourceRange, markGuardedNode, updateFunction } from '../../utils/ast-boundary.js';
import { getDestructuringDecision } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

const getTupleName = ({ typescript = {}, node = {}, reservedNames = new Set() } = {}) => {
    const names = new Set([...reservedNames, ...getBindingNames({ typescript, node })]);
    const candidates = ['tuple', '_resilientTuple', '_resilientTuple2'];
    const [name = '_resilientTuple'] = candidates.filter(candidate => !names.has(candidate));

    return name;
};

const getContainerName = ({ occupied = new Set() } = {}) => {
    const candidates = ['_resilientTuplePart', '_resilientTuplePart2', '_resilientTuplePart3'];
    const [name = '_resilientTuplePart'] = candidates.filter(candidate => !occupied.has(candidate));

    return name;
};

const getTupleFallback = ({ factory = {}, canonical = '', fallback = {} } = {}) => {
    const { kind = '', name = '', constructor = '', innerCanonical = '' } = getObject(fallback);

    if (kind === 'accumulator' && name) return { bare: false, expression: factory.createIdentifier(name) };

    // An effect fallback is emitted only after Understand proved the inner
    // callback result is array-like.  An opaque M<A> never reaches here.
    if (kind === 'effect' && innerCanonical === '[]' && /^[A-Za-z_$][A-Za-z0-9_$]*\.of$/.test(constructor)) {
        const [receiver = ''] = constructor.split('.');

        return {
            bare: false,
            expression: factory.createCallExpression(
                factory.createPropertyAccessExpression(factory.createIdentifier(receiver), 'of'),
                undefined,
                [factory.createArrayLiteralExpression([], false)]
            )
        };
    }

    if (canonical === '[]') return { bare: false, expression: factory.createArrayLiteralExpression([], false) };

    if (canonical === '{}') return { bare: false, expression: factory.createObjectLiteralExpression([], false) };

    if (canonical === "''") return { bare: false, expression: factory.createStringLiteral('', true) };

    if (canonical === '0') return { bare: false, expression: factory.createNumericLiteral('0') };

    if (canonical === 'false') return { bare: false, expression: factory.createFalse() };

    return { bare: false, expression: undefined };
};

const lowerExactTupleParameter = ({
    typescript = {}, node = {}, tupleParameterIndex = -1, pattern = {}, elements = [],
    parameters = [], arity = 0, evidence = [], agreements = new Set()
} = {}) => {
    const { factory = {}, SyntaxKind: { Identifier = -1 } = {} } = typescript;
    const isStaticPosition = elements.every(({ dotDotDotToken = false, initializer = false, name = {} } = {}) => (
        !dotDotDotToken && !initializer && getObject(name).kind === Identifier
    ));

    if (!isStaticPosition || elements.length !== arity) return node;

    const exactElements = elements.map((element = {}) => {
        const { name = {} } = getObject(element);

        return markGuardedNode(factory.updateBindingElement(
            element,
            undefined,
            undefined,
            name,
            factory.createIdentifier('undefined')
        ));
    });
    const exactPattern = markGuardedNode(factory.updateArrayBindingPattern(pattern, exactElements));
    const exactParameters = parameters.map((candidate = {}, index = 0) => {
        if (index !== tupleParameterIndex) return candidate;

        const {
            modifiers = undefined, dotDotDotToken = undefined, questionToken = undefined,
            type = undefined, initializer = undefined
        } = getObject(candidate);

        return factory.updateParameterDeclaration(
            candidate,
            modifiers,
            dotDotDotToken,
            exactPattern,
            questionToken,
            type,
            initializer
        );
    });

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before function update; copying loses caller-visible records.
    if (agreements instanceof Set) agreements.add({
        action: 'exact-tuple-position',
        canonical: 'undefined',
        arity,
        sourceRange: getSourceRange({ typescript, node }),
        evidence
    });

    return updateFunction({ typescript, node, parameters: exactParameters, body: getObject(node).body });
};

const lowerTupleConsumerBindings = ({
    typescript = {},
    node = {},
    destructuringAgreements = {},
    reservedNames = new Set(),
    agreements = new Set()
} = {}) => {
    const {
        SyntaxKind: {
            ArrowFunction = -1,
            FunctionExpression = -1,
            FunctionDeclaration = -1,
            ArrayBindingPattern = -1,
            Block = -1,
            Identifier = -1,
            ExclamationToken = -1,
            BarBarToken = -1,
            LessThanToken = -1
        } = {},
        NodeFlags: { Const = 0 } = {},
        factory = {}
    } = typescript;
    const { kind = 0, parameters = [], body = {} } = getObject(node);
    const tupleParameterIndex = parameters.findIndex(({ name = {} } = {}) => getObject(name).kind === ArrayBindingPattern);
    const [parameter = {}] = tupleParameterIndex >= 0 ? parameters.slice(tupleParameterIndex, tupleParameterIndex + 1) : [];
    const { name: pattern = {} } = getObject(parameter);
    const { kind: patternKind = 0, elements = [] } = getObject(pattern);
    const nodeKey = getConsumerContractKey(node);
    const { contract: normalizedConsumer = {}, agreement: recordedAgreement = {} } = getDestructuringDecision({
        destructuringAgreements,
        key: nodeKey,
        kinds: ['consumer-callback', 'consumer']
    });
    const agreement = ['tuple-callback', 'tuple-function'].includes(getObject(normalizedConsumer).consumer)
        ? recordedAgreement
        : {};
    const { action = '', canonical = '', fallback: fallbackAgreement = {}, arity = 0, positions = [], evidence = [] } = agreement;
    const accepted = ['guard-tuple-content', 'guard-tuple-arity'].includes(action);
    const exactPosition = action === 'exact-tuple-position';
    const { kind: fallbackKind = '', name: fallbackName = '' } = getObject(fallbackAgreement);

    if (![ArrowFunction, FunctionExpression, FunctionDeclaration].includes(kind) || (!accepted && !exactPosition) || (!exactPosition && !canonical && !fallbackKind && !fallbackName) ||
        patternKind !== ArrayBindingPattern || !elements.length || elements.length !== arity) return node;

    // A standalone typed tuple parameter retains native non-array failure
    // ownership. `= undefined` makes only source's short-tuple result explicit.
    if (exactPosition) return lowerExactTupleParameter({
        typescript, node, tupleParameterIndex, pattern, elements,
        parameters, arity, evidence, agreements
    });

    const tupleName = getTupleName({ typescript, node, reservedNames });
    const tupleIdentifier = factory.createIdentifier(tupleName);
    const fallback = getTupleFallback({ factory, canonical, fallback: fallbackAgreement });
    const { bare: bareFallback = false, expression: fallbackExpression = undefined } = getObject(fallback);

    if (!bareFallback && !fallbackExpression) return node;

    const getFallbackReturn = () => factory.createReturnStatement(bareFallback ? undefined : fallbackExpression);

    const occupied = new Set([...reservedNames, ...getBindingNames({ typescript, node }), tupleName]);
    const getTupleGuard = (source = {}, containerArity = 0) => {
        const contentGuard = containerArity === 1;
        const check = contentGuard
            ? factory.createPrefixUnaryExpression(
                ExclamationToken,
                factory.createCallExpression(factory.createIdentifier('hasArrayContent'), undefined, [source])
            )
            : factory.createBinaryExpression(
                factory.createPrefixUnaryExpression(
                    ExclamationToken,
                    factory.createCallExpression(factory.createIdentifier('isArray'), undefined, [source])
                ),
                factory.createToken(BarBarToken),
                factory.createBinaryExpression(
                    factory.createPropertyAccessExpression(source, 'length'),
                    factory.createToken(LessThanToken),
                    factory.createNumericLiteral(containerArity)
                )
            );

        return factory.createIfStatement(
            check,
            factory.createBlock([getFallbackReturn()], true),
            undefined
        );
    };
    const supportsTuplePattern = (candidate = {}) => {
        const { elements: candidateElements = [] } = getObject(candidate);

        return candidateElements.every((element = {}) => {
            const { dotDotDotToken = false, name = {} } = getObject(element);
            const { kind: nameKind = 0 } = getObject(name);

            return !dotDotDotToken && [Identifier, ArrayBindingPattern].includes(nameKind) &&
                (nameKind !== ArrayBindingPattern || supportsTuplePattern(name));
        });
    };

    if (!supportsTuplePattern(pattern)) return node;

    let generatedStatements = [];
    const lowerPattern = (currentPattern = {}, source = {}) => {
        const { elements: currentElements = [] } = getObject(currentPattern);
        const stagedElements = currentElements.map((element = {}) => {
            const { name = {} } = getObject(element);
            const { kind: nameKind = 0 } = getObject(name);

            if (nameKind !== ArrayBindingPattern) return { element: markGuardedNode(element) };

            const containerName = getContainerName({ occupied });
            const containerIdentifier = factory.createIdentifier(containerName);

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared lexical reservations precede sibling naming and recursive descent; copies lose collisions.
            occupied.add(containerName);

            return {
                element: markGuardedNode(factory.updateBindingElement(
                    element,
                    undefined,
                    undefined,
                    containerIdentifier,
                    undefined
                )),
                nested: [{ pattern: name, source: containerIdentifier }]
            };
        });

        generatedStatements = [...generatedStatements,
            getTupleGuard(source, currentElements.length),
            factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList([
                    factory.createVariableDeclaration(
                        markGuardedNode(factory.updateArrayBindingPattern(
                            currentPattern,
                            stagedElements.map(({ element = {} } = {}) => element)
                        )),
                        undefined,
                        undefined,
                        source
                    )
                ], Const)
            )
        ];
        stagedElements.forEach(({ nested = [] } = {}) => nested.forEach(({
            pattern: nestedPattern = {}, source: nestedSource = {}
        } = {}) => lowerPattern(nestedPattern, nestedSource)));
    };

    lowerPattern(pattern, tupleIdentifier);
    const functionGuards = positions
        .filter(({ kind = '', invoked = false, name = '' } = {}) => kind === 'function' && invoked && Boolean(name))
        .map(({ name = '' } = {}) => factory.createIfStatement(
            factory.createPrefixUnaryExpression(
                ExclamationToken,
                factory.createCallExpression(factory.createIdentifier('isFunction'), undefined, [factory.createIdentifier(name)])
            ),
            factory.createBlock([getFallbackReturn()], true),
            undefined
        ));
    const { kind: bodyKind = 0, statements: bodyStatements = [] } = getObject(body);
    const nextBody = bodyKind === Block
        ? factory.updateBlock(body, [...generatedStatements, ...functionGuards, ...bodyStatements])
        : factory.createBlock([...generatedStatements, ...functionGuards, factory.createReturnStatement(body)], true);

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before parameter updates; copying hides records on compiler failure.
    if (agreements instanceof Set) agreements.add({
        action: 'guarded-tuple',
        canonical,
        arity,
        sourceRange: getSourceRange({ typescript, node }),
        evidence
    });

    const nextParameters = parameters.map((candidate = {}, index = 0) => index === tupleParameterIndex
        ? factory.createParameterDeclaration(
            undefined,
            undefined,
            tupleIdentifier,
            undefined,
            undefined,
            undefined
        )
        : candidate);

    return updateFunction({
        typescript,
        node,
        parameters: nextParameters,
        body: nextBody
    });
};

export { lowerTupleConsumerBindings };
