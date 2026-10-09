import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { hasTypeChecker } from '../../utils/compiler-shape.js';
import { hasGuardFor, hasObservedAbsenceFor } from '../policy/guards.js';
import { getBindingElementCanonical, getBindingAgreementReason, getBindingRuntimeGuardKind } from './binding-evidence.js';
import { isTypeOnlyImportBinding } from './imports.js';
import { createSourceCensus } from './source-census.js';
import {
    getCheckerContract,
    getDeclaration,
    getIdentifierName,
    getMembers,
    getSelectedModelPredicateFact,
    getVariantPartitions,
    getTypeInfo,
    getTypeText,
    isStandardArrayType
} from './type-evidence.js';

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
    const { getSymbolAtLocation, getTypeAtLocation = false,
        isTupleType, typeToString, resolveName } = checker;
    const checked = hasTypeChecker(checker);
    const { TypeFlags: { TypeParameter = 0, Any = 0, Unknown = 0, Undefined = 0 } = {}, SymbolFlags: { Value = 0 } = {} } = typescript;
    const expressions = census.select(Identifier, PropertyAccessExpression, ElementAccessExpression);
    const expressionFacts = expressions.map((node) => {
        const type = checked ? getTypeAtLocation.call(checker, node) : {};
        const { isUnion, flags = 0 } = getObject(type);
        const tuple = isFunction(isTupleType) && isTupleType.call(checker, type);
        const typeText = checked && isFunction(typeToString) ? typeToString.call(checker, type, node) : '';
        const arrayLike = checked && isStandardArrayType({ typescript, checker, candidate: node });
        const contract = getCheckerContract({ typescript, node, checker, declarations,
            typeText: getTypeText({ node, sourceFile }) });
        const partitions = checked ? getVariantPartitions({ typescript, checker, type, node }) : [];
        const unionProperties = partitions.map(({ property = '' } = {}) => property);

        return [node, Object.freeze({ contract: Object.freeze(contract), opaque: Boolean(flags & (TypeParameter | Any | Unknown)), tuple, arrayLike, typeText,
            partitions, union: isFunction(isUnion) && isUnion.call(type), unionProperties,
            symbol: isFunction(getSymbolAtLocation) ? getSymbolAtLocation.call(checker, node) : false })];
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
    const observedBindings = new Set(census.select(Parameter, BindingElement).filter((binding = {}) => {
        const { name = {} } = binding;
        const owner = census.ancestors(binding).find(candidate => typescript.isFunctionLike(candidate));
        const { body = false } = getObject(owner);

        return body && hasGuardFor({ typescript, node: body, binding: name, checker });
    }).map(({ name = {} } = {}) => name));
    const typeOnlyImports = new Set(census.select(ImportClause, ImportSpecifier, NamespaceImport)
        .filter(node => isTypeOnlyImportBinding({ typescript, sourceFile, checker, census, node })));
    const { BinaryExpression = -1, EqualsEqualsEqualsToken = -1, ExclamationEqualsEqualsToken = -1 } = kinds;
    const exactUndefined = new Set(census.select(BinaryExpression).filter(({ left = {}, right = {}, operatorToken: { kind = 0 } = {} } = {}) => {
        if (!checked || ![EqualsEqualsEqualsToken, ExclamationEqualsEqualsToken].includes(kind)) return false;

        return [[left, right], [right, left]].some(([absence = {}, value = {}] = []) => {
            const { kind: absenceKind = 0, text = '' } = absence;

            if (absenceKind !== Identifier || text !== 'undefined') return false;

            const { flags = 0 } = getTypeAtLocation.call(checker, absence);
            const symbol = isFunction(getSymbolAtLocation) ? getSymbolAtLocation.call(checker, absence) : false;
            const native = isFunction(resolveName) ? resolveName.call(checker, 'undefined', undefined, Value, false) : false;

            if (!symbol || symbol !== native || !(flags & Undefined)) return false;

            const { types = [], flags: valueFlags = 0 } = getTypeAtLocation.call(checker, value);
            const valueSymbol = getSymbolAtLocation.call(checker, value);
            const { valueDeclaration = {} } = getObject(valueSymbol);
            const { kind: declarationKind = 0, questionToken = false, initializer = false } = getObject(valueDeclaration);
            // With strictNullChecks disabled the checker erases undefined from
            // optional parameter types. Its resolved source declaration still
            // owns that absence; generated names and unknown values do not.
            const optionalParameter = getObject(value).kind === Identifier && declarationKind === Parameter &&
                !!questionToken && !initializer && !(valueFlags & (Any | Unknown));

            return optionalParameter || types.some(({ flags: partFlags = 0 } = {}) => partFlags & Undefined);
        });
    }));

    return Object.freeze({ observedBindings, exactUndefined, typeOnlyImports, facts: new Map(expressionFacts), typeInfos, absence, predicates, bindings, namedBindings,
        checked, symbols: isFunction(getSymbolAtLocation) });
};

export { collectPlacementEvidence };
