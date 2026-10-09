import { getObject } from '../../../rules/support/object.js';
import { updateFunction } from '../../utils/ast-boundary.js';
import { getChildren } from '../../utils/ast-traversal.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

const containsIdentifier = ({ typescript = {}, node = {}, name = '' } = {}) => {
    const { text = '' } = node;

    if (typescript.isIdentifier(node) && text === name) return true;

    return getChildren({ typescript, node }).some(child => containsIdentifier({ typescript, node: child, name }));
};

const getRestCarrierName = ({ typescript = {}, node = {} } = {}) => {
    const getCandidate = (suffix = '') => `_resilientArgs${suffix}`;
    const choose = (suffix = '') => {
        const candidate = getCandidate(suffix);

        return containsIdentifier({ typescript, node, name: candidate })
            ? choose(`_${Number(suffix.replace('_', '')) + 1}`)
            : candidate;
    };

    return choose();
};

const getDirectiveCount = ({ typescript = {}, statements = [] } = {}) => {
    const index = statements.findIndex(({ expression = {} } = {}) => !typescript.isStringLiteral(expression));

    return index < 0 ? statements.length : index;
};

// Optional source parameters are initialized before the body without acquiring
// an iterator. The rest carrier is fresh, so a guarded numeric object selection
// is equivalent only while the private rest carrier proves that own position
// exists. The guard also preserves omitted arguments in the presence of an
// inherited numeric getter, and one dispatch-time selection preserves case
// fallthrough without rebinding at each case label.
const createCarrierBindings = ({ typescript = {}, carrierName = '', parameters = [] } = {}) => {
    const {
        factory = {},
        NodeFlags: { Let = 0 } = {},
        SyntaxKind: { AmpersandAmpersandToken = 0, EqualsToken = 0, GreaterThanToken = 0 } = {}
    } = typescript;
    const facts = parameters.filter(({ name = '', sourceIndex = -1, restIndex = -1, mutable = false } = {}) => (
        Boolean(name) && Number.isInteger(sourceIndex) && sourceIndex >= 0 &&
        Number.isInteger(restIndex) && restIndex >= 0 && typeof mutable === 'boolean'
    ));
    const declaration = factory.createVariableStatement(undefined, factory.createVariableDeclarationList(
        facts.map(({ name = '' } = {}) => factory.createVariableDeclaration(
            factory.createIdentifier(name), undefined, undefined, undefined
        )), Let
    ));
    const selections = facts.map(({ name = '', restIndex = -1 } = {}) => {
        const pattern = factory.createObjectLiteralExpression([
            factory.createPropertyAssignment(
                factory.createNumericLiteral(restIndex),
                factory.createBinaryExpression(
                    factory.createIdentifier(name),
                    factory.createToken(EqualsToken),
                    factory.createVoidExpression(factory.createNumericLiteral(0))
                )
            )
        ]);
        const selection = factory.createBinaryExpression(
            pattern,
            factory.createToken(EqualsToken),
            factory.createIdentifier(carrierName)
        );
        const supplied = factory.createBinaryExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier(carrierName), 'length'),
            factory.createToken(GreaterThanToken),
            factory.createNumericLiteral(restIndex)
        );

        return factory.createBinaryExpression(
            supplied,
            factory.createToken(AmpersandAmpersandToken),
            selection
        );
    });

    return { declaration, selections };
};

// A rest signature expresses variable cardinality without manufacturing callable
// defaults. The original dispatch remains responsible for selecting valid uses.
const lowerAritySignatures = ({ typescript = {}, statements = [], destructuringAgreements = {} } = {}) => {
    const { factory = {}, SyntaxKind: { DotDotDotToken = 0 } = {} } = typescript;
    const lower = (node = {}, bindingName = '') => {
        const { name = {}, body = {}, parameters: emittedParameters = [] } = node;
        const { text: declaredName = '' } = name;
        const functionName = bindingName || declaredName;
        const directDecision = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['arity-signature-lowering']
        });
        const { entry: directEntry = {} } = directDecision;
        const { kind: directKind = '' } = directEntry;
        // Earlier source rewrites can reconstruct a top-level declaration shell.
        // The completed, unique source binding index survives that reconstruction.
        const { aritySignatures = new Map() } = destructuringAgreements;
        const decision = directKind ? directDecision : aritySignatures.get(functionName) || {};
        const { agreement = {}, contract = {} } = decision;
        const { action = '' } = agreement;
        const { dispatchRange = '', firstOptional = -1, parameters = [], sourceLength = -1 } = contract;
        const completeParameters = parameters.length === emittedParameters.length - firstOptional &&
            parameters.every(({ mutable = false } = {}) => typeof mutable === 'boolean');

        if (!(typescript.isFunctionDeclaration(node) || typescript.isFunctionExpression(node)) ||
            action !== 'lower-arity-from-source-facts' || !functionName || !typescript.isBlock(body) ||
            firstOptional < 1 || sourceLength !== emittedParameters.length || !completeParameters) return { node };

        const carrierName = getRestCarrierName({ typescript, node });
        const rest = factory.createParameterDeclaration(
            undefined,
            factory.createToken(DotDotDotToken),
            factory.createIdentifier(carrierName),
            undefined,
            undefined,
            undefined
        );
        const nextParameters = [...emittedParameters.slice(0, firstOptional), rest];
        const { statements: bodyStatements = [] } = body;
        const { getOriginalNode = false } = typescript;
        const switchIndex = bodyStatements.findIndex((statement = {}) => {
            const original = typeof getOriginalNode === 'function' ? getOriginalNode(statement) : statement;
            const { pos = -1, end = -1 } = getObject(original);

            return typescript.isSwitchStatement(statement) && `${pos}:${end}` === dispatchRange;
        });

        if (switchIndex < 0) return { node };

        const directiveCount = getDirectiveCount({ typescript, statements: bodyStatements });
        const { declaration: carrierDeclaration = {}, selections = [] } = createCarrierBindings({
            typescript, carrierName, parameters
        });
        const [switchStatement = {}] = bodyStatements.slice(switchIndex, switchIndex + 1);
        const { expression: switchExpression = {}, caseBlock: switchCaseBlock = {} } = switchStatement;
        const nextSwitch = factory.updateSwitchStatement(
            switchStatement,
            factory.createCommaListExpression([...selections, switchExpression]),
            switchCaseBlock
        );
        const sourceStatements = bodyStatements.map((statement, index) => index === switchIndex ? nextSwitch : statement);
        const nextBody = factory.updateBlock(body, [
            ...sourceStatements.slice(0, directiveCount),
            carrierDeclaration,
            ...sourceStatements.slice(directiveCount)
        ]);
        const next = updateFunction({ typescript, node, parameters: nextParameters, body: nextBody });

        return { node: next, lowered: true };
    };
    const lowered = statements.map((statement) => {
        if (!typescript.isVariableStatement(statement)) return lower(statement);

        const { declarationList = {}, modifiers = [] } = statement;
        const { declarations = [] } = declarationList;
        const [declaration = {}] = declarations;
        const { name = {}, initializer = {} } = declaration;
        const { text = '' } = name;

        if (declarations.length !== 1 || !typescript.isIdentifier(name) || !typescript.isFunctionExpression(initializer)) return { node: statement };

        const { node = {}, lowered = false } = lower(initializer, text);

        if (!lowered) return { node: statement };

        return {
            node: factory.updateVariableStatement(statement, modifiers, factory.updateVariableDeclarationList(declarationList, [
                factory.updateVariableDeclaration(declaration, name, undefined, undefined, node)
            ]))
        };
    });

    return {
        statements: lowered.map(({ node = {} } = {}) => node)
    };
};

export { lowerAritySignatures };
