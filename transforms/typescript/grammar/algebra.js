// Algebra grammar assembles agreements that have already been proven by
// Understand. It never selects a fallback: it only preserves a source-owned
// identity at the source property-evaluation point.
const markProviderForwardBinding = (pattern = {}) => {
    Object.defineProperty(pattern, '__resilientProviderForward', {
        configurable: true,
        enumerable: false,
        value: true
    });

    return pattern;
};

const createProviderForwardExpression = ({
    typescript = {},
    receiver = {},
    member = '',
    alias = '',
    canonical = ''
} = {}) => {
    const { factory = {}, SyntaxKind: { EqualsGreaterThanToken = -1 } = {} } = typescript;

    if (!receiver || !member || !alias) return receiver;

    const binding = factory.createBindingElement(
        undefined,
        member === alias ? undefined : factory.createIdentifier(member),
        factory.createIdentifier(alias),
        canonical === 'undefined' ? factory.createIdentifier('undefined') : undefined
    );
    const parameter = factory.createParameterDeclaration(
        undefined,
        undefined,
        markProviderForwardBinding(factory.createObjectBindingPattern([binding])),
        undefined,
        undefined,
        undefined
    );
    const extractor = factory.createArrowFunction(
        undefined,
        undefined,
        [parameter],
        undefined,
        factory.createToken(EqualsGreaterThanToken),
        factory.createIdentifier(alias)
    );

    return factory.createCallExpression(
        factory.createParenthesizedExpression(extractor),
        undefined,
        [receiver]
    );
};

// A completed collection agreement changes only its own fresh local binding.
// Placement supplies the original receiver and arguments, so this constructor
// cannot hoist reads, choose defaults, or infer collection ownership.
const createCollectionAccumulatorRebind = ({
    typescript = {}, collection = '', receiver = {}, arguments: args = []
} = {}) => {
    const { factory = {}, SyntaxKind: { EqualsToken = -1 } = {} } = typescript;
    const isMap = collection === 'Map' && args.length === 2;
    const isSet = collection === 'Set' && args.length === 1;

    if (!(isMap || isSet)) return false;

    const entries = isMap
        ? [factory.createSpreadElement(receiver), factory.createArrayLiteralExpression(args, false)]
        : [factory.createSpreadElement(receiver), ...args];
    const replacement = factory.createNewExpression(
        factory.createIdentifier(collection),
        undefined,
        [factory.createArrayLiteralExpression(entries, true)]
    );

    return factory.createExpressionStatement(factory.createBinaryExpression(
        receiver,
        factory.createToken(EqualsToken),
        replacement
    ));
};

// A completed fresh-copy agreement owns one source traversal followed by one
// static update. Grammar receives the already-ordered expressions and merely
// forms the returned collection; it cannot approve a constructor or invent a
// collection family.
const createFreshCollectionReconstruction = ({
    typescript = {}, collection = '', source = {}, arguments: args = [], method = ''
} = {}) => {
    const {
        factory = {},
        SyntaxKind: {
            EqualsGreaterThanToken = -1,
            EqualsEqualsEqualsToken = -1,
            ExclamationEqualsEqualsToken = -1,
            AmpersandAmpersandToken = -1,
            BarBarToken = -1,
            ExclamationToken = -1
        } = {}
    } = typescript;
    const isMap = collection === 'Map' && args.length === 2;
    const isSet = collection === 'Set' && args.length === 1;
    const isMapDelete = collection === 'Map' && method === 'delete' && args.length === 1;

    if (!(isMap || isSet || isMapDelete)) return false;

    if (isMapDelete) {
        const [key = {}] = args;
        const entryKey = factory.createIdentifier('entryKey');
        const sameValueZero = factory.createBinaryExpression(
            factory.createBinaryExpression(entryKey, factory.createToken(EqualsEqualsEqualsToken), key),
            factory.createToken(BarBarToken),
            factory.createBinaryExpression(
                factory.createBinaryExpression(entryKey, factory.createToken(ExclamationEqualsEqualsToken), entryKey),
                factory.createToken(AmpersandAmpersandToken),
                factory.createBinaryExpression(key, factory.createToken(ExclamationEqualsEqualsToken), key)
            )
        );
        const entry = factory.createArrayBindingPattern([
            factory.createBindingElement(undefined, undefined, entryKey, factory.createIdentifier('undefined'))
        ]);
        const predicate = factory.createArrowFunction(
            undefined,
            undefined,
            [factory.createParameterDeclaration(undefined, undefined, entry)],
            undefined,
            factory.createToken(EqualsGreaterThanToken),
            factory.createPrefixUnaryExpression(ExclamationToken, factory.createParenthesizedExpression(sameValueZero))
        );
        const entries = factory.createCallExpression(
            factory.createPropertyAccessExpression(
                factory.createArrayLiteralExpression([factory.createSpreadElement(source)], false),
                factory.createIdentifier('filter')
            ),
            undefined,
            [predicate]
        );

        return factory.createNewExpression(factory.createIdentifier('Map'), undefined, [entries]);
    }

    const entries = isMap
        ? [factory.createSpreadElement(source), factory.createArrayLiteralExpression(args, false)]
        : [factory.createSpreadElement(source), ...args];

    return factory.createNewExpression(
        factory.createIdentifier(collection),
        undefined,
        [factory.createArrayLiteralExpression(entries, false)]
    );
};

// A materialized traversal has already established its ownership and result
// container in Understand. Grammar only creates the finite array reduction and
// its one final Map/Set construction; it cannot approve a loop itself.
const createMaterializedCollectionReduction = ({
    typescript = {}, collection = '', source = {}, item = {}, accumulator = '',
    operation = '', value = {}, condition = {}, materialized = false
} = {}) => {
    const {
        factory = {},
        SyntaxKind: { EqualsGreaterThanToken = -1, QuestionToken = -1, ColonToken = -1 } = {}
    } = typescript;
    const isMap = collection === 'Map';
    const isSet = collection === 'Set';
    const { kind: sourceKind = 0 } = source;
    const needsValue = ['map', 'filter-map'].includes(operation);
    const needsCondition = ['filter', 'filter-map'].includes(operation);
    const acceptedOperation = ['map', 'filter', 'filter-map'].includes(operation);

    if (!(isMap || isSet) || !source || !sourceKind || !item || !accumulator || !acceptedOperation ||
        needsValue && !value || needsCondition && !condition) return false;

    const arrayFrom = materialized
        ? source
        : factory.createCallExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier('Array'), factory.createIdentifier('from')),
            undefined,
            [source]
        );
    // A filter may carry an explicit entry/value expression when its callback
    // parameter is destructured.  A Set filter can retain its direct item.
    const retainedValue = operation === 'filter' && !value ? item : value;
    const nextValue = factory.createArrayLiteralExpression([
        factory.createSpreadElement(factory.createIdentifier(accumulator)),
        retainedValue
    ], false);
    const body = operation === 'map'
        ? nextValue
        : factory.createConditionalExpression(
            condition,
            factory.createToken(QuestionToken),
            nextValue,
            factory.createToken(ColonToken),
            factory.createIdentifier(accumulator)
        );
    const callback = factory.createArrowFunction(
        undefined,
        undefined,
        [
            factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier(accumulator), undefined, undefined),
            factory.createParameterDeclaration(undefined, undefined, item, undefined, undefined)
        ],
        undefined,
        factory.createToken(EqualsGreaterThanToken),
        body
    );
    const reduced = factory.createCallExpression(
        factory.createPropertyAccessExpression(arrayFrom, factory.createIdentifier('reduce')),
        undefined,
        [callback, factory.createArrayLiteralExpression([], false)]
    );

    return factory.createNewExpression(factory.createIdentifier(collection), undefined, [reduced]);
};

// A callable capability remains absent until its actual consumer requires it.
// The caller's natural bare return is the dialect response for that specific
// consumer; no callback implementation is invented at the provider boundary.
const createCallableCapabilityGuard = ({ typescript = {}, alias = '', useFunctionStandard = false } = {}) => {
    const {
        factory = {},
        SyntaxKind: {
            ExclamationToken = -1,
            SingleLineCommentTrivia = -1,
            EqualsEqualsEqualsToken = -1
        } = {},
        addSyntheticLeadingComment = false
    } = typescript;

    if (!alias) return false;

    const callable = useFunctionStandard
        ? factory.createCallExpression(factory.createIdentifier('isFunction'), undefined, [factory.createIdentifier(alias)])
        : factory.createBinaryExpression(
            factory.createTypeOfExpression(factory.createIdentifier(alias)),
            factory.createToken(EqualsEqualsEqualsToken),
            factory.createStringLiteral('function', true)
        );
    const bareReturn = factory.createReturnStatement();
    const guardedReturn = typeof addSyntheticLeadingComment === 'function'
        ? addSyntheticLeadingComment(
            bareReturn,
            SingleLineCommentTrivia,
            ' eslint-disable-next-line consistent-return -- Checked capability disagreement owns this function\'s natural undefined response.',
            true
        )
        : bareReturn;
    const guard = factory.createIfStatement(
        factory.createPrefixUnaryExpression(
            ExclamationToken,
            callable
        ),
        factory.createBlock([guardedReturn], true)
    );

    return guard;
};

// A direct capability consumer owns only callability. The checker has already
// established that this is a receiver-free capability call, so bind the field
// immediately before that call and return the function's natural undefined
// response when it remains absent.
const createDirectCapabilityStatements = ({
    typescript = {},
    receiver = '',
    member = '',
    alias = '',
    useFunctionStandard = false
} = {}) => {
    const { factory = {}, NodeFlags: { Const = 0 } = {} } = typescript;

    if (!receiver || !member || !alias) return [];

    const binding = factory.createBindingElement(
        undefined,
        member === alias ? undefined : factory.createIdentifier(member),
        factory.createIdentifier(alias),
        // A missing required capability remains the exact falsifiable value
        // for functions: undefined. This neither fabricates a callback nor
        // normalizes a non-object provider.
        factory.createIdentifier('undefined')
    );
    const declaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
                factory.createObjectBindingPattern([binding]),
                undefined,
                undefined,
                factory.createIdentifier(receiver)
            )
        ], Const)
    );
    const guard = createCallableCapabilityGuard({ typescript, alias, useFunctionStandard });

    return guard ? [declaration, guard] : [declaration];
};

export {
    createCallableCapabilityGuard,
    createCollectionAccumulatorRebind,
    createFreshCollectionReconstruction,
    createMaterializedCollectionReduction,
    createDirectCapabilityStatements,
    createProviderForwardExpression
};
