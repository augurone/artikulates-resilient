import { getBindingElementCanonical, getBindingAgreementReason, getBindingRuntimeGuardKind } from './binding-evidence.js';
import { isTypeOnlyImportBinding } from './imports.js';
import { createSourceCensus } from './source-census.js';
import {
    getCheckerContract,
    getDeclaration,
    getIdentifierName,
    getMembers,
    getSelectedModelPredicateFact,
    getTypeInfo,
    getTypeText
} from './type-evidence.js';
import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { hasTypeChecker } from '../../utils/compiler-shape.js';
import { hasObservedAbsenceFor } from '../policy/guards.js';

// These facts belong to the original compiler tree. Placement receives the
// completed snapshot, never a checker or a cache capable of querying one.
const collectPlacementEvidence = ({
    typescript = {}, sourceFile = {}, checker = {}, declarations = {},
    resolvers = {}, reservedNames = new Set(),
    census = createSourceCensus({ typescript, sourceFile })
} = {}) => {
    const kinds = getSyntaxKinds(typescript);
    const { Identifier = -1, PropertyAccessExpression = -1, ElementAccessExpression = -1,
        CallExpression = -1, Parameter = -1, BindingElement = -1, VariableDeclaration = -1 } = kinds;
    const { getSymbolAtLocation = false, getTypeAtLocation = false,
        isTupleType = false, isArrayType = false, typeToString = false } = checker;
    const checked = hasTypeChecker(checker);
    const { TypeFlags: { TypeParameter = 0, Any = 0, Unknown = 0, Undefined = 0 } = {} } = typescript;
    const expressions = census.select(Identifier, PropertyAccessExpression, ElementAccessExpression);
    const expressionFacts = expressions.map((node) => {
        const type = checked ? getTypeAtLocation.call(checker, node) : {};
        const { types = [], isUnion = false, flags = 0 } = getObject(type);
        const tuple = typeof isTupleType === 'function' && isTupleType.call(checker, type);
        const typeText = checked && typeof typeToString === 'function' ? typeToString.call(checker, type, node) : '';
        const arrayLike = checked && Boolean(tuple ||
            typeof isArrayType === 'function' && isArrayType.call(checker, type) ||
            /(?:^|\s)(?:ReadonlyArray|Array|NonEmptyArray|ReadonlyNonEmptyArray)<.*>$/.test(typeText) ||
            /\[\]$/.test(typeText) || /^\s*\[.*\]\s*$/.test(typeText));
        const contract = getCheckerContract({ typescript, node, checker, declarations,
            typeText: getTypeText({ node, sourceFile }) });
        const [firstType = {}] = types;
        const unionProperties = Array.isArray(types) && types.length > 1
            ? firstType.getProperties().map(property => property.getName())
                .filter(property => types.every(part => Boolean(part.getProperty(property))))
            : [];

        return [node, Object.freeze({ contract: Object.freeze(contract), opaque: Boolean(flags & (TypeParameter | Any | Unknown)), tuple, arrayLike, typeText,
            union: typeof isUnion === 'function' && isUnion.call(type), unionProperties,
            symbol: typeof getSymbolAtLocation === 'function' ? getSymbolAtLocation.call(checker, node) : false })];
    });
    const parameters = census.select(Parameter);
    const annotations = census.select(...new Set(Object.values(kinds).filter(Number.isInteger)))
        .filter(node => typescript.isTypeNode(node));
    const bindingNames = census.select(BindingElement).map(({ name = {} } = {}) => name);
    const memberTypes = parameters.flatMap(({ type = {} } = {}) => {
        const declaration = getDeclaration({ declarations, name: getIdentifierName({ typescript, node: type }), fallback: { type } });

        return getMembers({ typescript, declaration, declarations, node: type })
            .map(({ type: memberType = {} } = {}) => memberType);
    });
    const typeInfos = new Map([...new Set([...annotations, ...bindingNames, ...memberTypes])]
        .map(node => [node, Object.freeze(getTypeInfo({ typescript, node, sourceFile, checker,
            declarations, resolvers, reservedNames }))]));
    const absence = new Map(parameters.map((parameter) => {
        const { parent = {} } = parameter;
        const { body = false } = getObject(parent);

        return [parameter, Boolean(body && hasObservedAbsenceFor({ typescript, node: body, parameter, checker }))];
    }));
    const predicates = new Map(census.select(CallExpression).map(expression => [expression,
        Object.freeze(getSelectedModelPredicateFact({ typescript, checker, expression }))]));
    const namedBindings = new Map([...new Set(census.select(Parameter, VariableDeclaration, BindingElement)
        .map(({ name = {} } = {}) => name))].map((name) => {
        const options = { typescript, element: { name }, sourceFile, checker, declarations, resolvers };

        return [name, Object.freeze({ canonical: getBindingElementCanonical(options),
            reason: getBindingAgreementReason(options), guardKind: getBindingRuntimeGuardKind(options) })];
    }));
    const bindings = new Map(census.select(BindingElement).map((element) => {
        const { name = {} } = element;

        return [element, namedBindings.get(name)];
    }));

    const { ImportClause = -1, ImportSpecifier = -1, NamespaceImport = -1 } = kinds;
    const typeOnlyImports = new Set(census.select(ImportClause, ImportSpecifier, NamespaceImport)
        .filter(node => isTypeOnlyImportBinding({ typescript, sourceFile, checker, census, node })));
    const { BinaryExpression = -1, EqualsEqualsEqualsToken = -1, ExclamationEqualsEqualsToken = -1 } = kinds;
    const exactUndefined = new Set(census.select(BinaryExpression).filter(({ left = {}, right = {}, operatorToken: { kind = 0 } = {} } = {}) => {
        if (!checked || ![EqualsEqualsEqualsToken, ExclamationEqualsEqualsToken].includes(kind)) return false;

        return [[left, right], [right, left]].some(([absence = {}, value = {}] = []) => {
            const { kind: absenceKind = 0, text = '' } = absence;

            if (absenceKind !== Identifier || text !== 'undefined') return false;

            const { flags = 0 } = checker.getTypeAtLocation(absence);
            const { types = [] } = checker.getTypeAtLocation(value);

            return Boolean(flags & Undefined) && types.some(({ flags: partFlags = 0 } = {}) => partFlags & Undefined);
        });
    }));

    return Object.freeze({ exactUndefined, typeOnlyImports, facts: new Map(expressionFacts), typeInfos, absence, predicates, bindings, namedBindings,
        checked, symbols: typeof getSymbolAtLocation === 'function' });
};

export { collectPlacementEvidence };
