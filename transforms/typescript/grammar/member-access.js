import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, markGuardedNode } from '../../utils/ast-boundary.js';
import {
    annotateAgreementException,
    getBindingAgreement,
    getBindingDecision,
    getAgreementDefaultInitializer
} from '../policy/defaults.js';

const isStaticMemberRead = ({ typescript = {}, node = {}, parent: customParent = undefined } = {}) => {
    const kinds = getSyntaxKinds(typescript);
    const {
        PropertyAccessExpression = -1, Identifier = -1,
        ElementAccessExpression = -1, NumericLiteral = -1,
        StringLiteral = -1, CallExpression = -1,
        BinaryExpression = -1, PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1, DeleteExpression = -1
    } = kinds;
    const { kind: nodeKind = 0, questionDotToken = false, name = {}, argumentExpression: argument = {}, expression = {}, parent: nodeParent = {} } = node;
    const parent = customParent || nodeParent || {};
    const {
        name: parentName = {},
        operatorToken = {},
        kind: parentKind = 0,
        expression: parentExpression = {},
        left = {}
    } = parent;
    const { text: parentPropertyName = '' } = parentName;
    const { text: nameText = '', kind: nameKind = 0 } = name;
    const { text: argumentText = '', kind: argumentKind = 0 } = argument;
    const { kind: expressionKind = 0 } = expression;
    const { kind: operatorKind = 0 } = operatorToken;
    const propertyName = nameText || argumentText;
    const isProperty = nodeKind === PropertyAccessExpression && nameKind === Identifier;
    const isElement = nodeKind === ElementAccessExpression && [NumericLiteral, StringLiteral].includes(argumentKind);

    if ((!isProperty && !isElement) || ['length', 'size'].includes(propertyName) || questionDotToken) return false;

    // A method invocation `receiver.method(...)` is a behavior call, not a data property access.
    if (parentKind === CallExpression && parentExpression === node) return false;

    if (parentKind === PropertyAccessExpression && parentExpression === node && !['length', 'size'].includes(parentPropertyName)) return false;

    if (parentKind === ElementAccessExpression && parentExpression === node) return false;

    const assignmentOperators = [
        'EqualsToken', 'PlusEqualsToken', 'MinusEqualsToken',
        'AsteriskEqualsToken', 'AsteriskAsteriskEqualsToken',
        'SlashEqualsToken', 'PercentEqualsToken', 'AmpersandEqualsToken',
        'BarEqualsToken', 'CaretEqualsToken', 'LessThanLessThanEqualsToken',
        'GreaterThanGreaterThanEqualsToken',
        'GreaterThanGreaterThanGreaterThanEqualsToken',
        'AmpersandAmpersandEqualsToken', 'BarBarEqualsToken',
        'QuestionQuestionEqualsToken'
    ].map((name = '') => {
        const { [name]: kind = -1 } = kinds;

        return kind;
    });

    if (parentKind === BinaryExpression && left === node && assignmentOperators.includes(operatorKind)) return false;

    if ([PrefixUnaryExpression, PostfixUnaryExpression, DeleteExpression].includes(parentKind)) return false;

    return expressionKind === Identifier;
};

const getMemberAlias = ({ objectName = '', propertyName = '', occupied = new Set() } = {}) => {
    const identifierName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName) ? propertyName : `${objectName}${propertyName}`;

    if (!occupied.has(identifierName)) return identifierName;

    const first = identifierName.charAt(0);
    const rest = identifierName.slice(1);
    const base = `${objectName}${first.toUpperCase()}${rest}`;
    const getAvailableAlias = (candidate = base, suffix = 2) => occupied.has(candidate)
        ? getAvailableAlias(`${base}${suffix}`, suffix + 1)
        : candidate;

    return getAvailableAlias();
};

const getTupleIndex = ({ typescript = {}, node = {} } = {}) => {
    const { ElementAccessExpression = -1, NumericLiteral = -1 } = getSyntaxKinds(typescript);
    const { argumentExpression: argument = {}, kind = 0 } = node;

    const { kind: argumentKind = 0, text = '' } = argument;

    if (kind !== ElementAccessExpression || argumentKind !== NumericLiteral) return -1;

    const index = Number(text);

    return Number.isInteger(index) && index >= 0 && index < 32 ? index : -1;
};

const getMemberBindingPattern = ({
    typescript = {},
    factory = {},
    members = [],
    sourceName = ''
} = {}) => {
    const arrayMembers = members.filter(({ kind = '' } = {}) => kind === 'array');
    const nestedArrayMembers = members.filter(({ kind = '' } = {}) => kind === 'nested-array');
    // A directive on a binding element prints between the braces. Carry the reason
    // so the statement pass can place it where ESLint can act on it.
    const markAgreement = (element, reason = '') => {
        if (!reason) return element;

        Object.defineProperty(element, '__resilientAgreement', {
            configurable: true,
            enumerable: false,
            value: reason
        });

        return element;
    };
    const markGuarded = (element, guarded = false) => {
        if (!guarded) return element;

        return markAgreement(markGuardedNode(element), 'capability is probed before invocation');
    };

    const buildElement = ({ member = {}, propertyKey = undefined, propertyName = '' } = {}) => {
        const {
            alias = '',
            canonical = '',
            defaultInitializer = false,
            guarded = false,
            family = '',
            agreementReason = '',
            sourceNode = false,
            agreement: memberAgreement = {}
        } = getObject(member);
        const agreement = Object.keys(memberAgreement).length
            ? memberAgreement
            : getBindingAgreement({
                canonical,
                guarded: guarded || Boolean(agreementReason),
                kind: family,
                owner: agreementReason ? 'type-evidence' : 'caller',
                evidence: agreementReason ? [agreementReason] : []
            });
        const { evidence: agreementEvidence = [] } = agreement;
        const [contractReason = agreementReason] = agreementEvidence;
        const initializer = defaultInitializer || (guarded ? undefined : getAgreementDefaultInitializer({
            typescript,
            factory,
            decision: getBindingDecision({ agreement: agreement }),
            name: alias,
            sourceName,
            propertyName
        }));
        const element = factory.createBindingElement(
            undefined,
            propertyKey,
            factory.createIdentifier(alias),
            initializer
        );
        const { setOriginalNode = false } = typescript;
        const ownedElement = sourceNode && typeof setOriginalNode === 'function'
            ? setOriginalNode(element, sourceNode) : element;

        // Retained absence is only honest when its owner is named on the binding.
        if (initializer || guarded) return markGuarded(ownedElement, guarded);

        return markAgreement(ownedElement, contractReason);
    };

    if (arrayMembers.length) {
        const maxIndex = Math.max(...arrayMembers.map(({ propertyName = '-1' } = {}) => Number(propertyName)));
        const byIndex = new Map(arrayMembers.map((member = {}) => {
            const { propertyName = '-1' } = getObject(member);

            return [Number(propertyName), member];
        }));
        const elements = Array.from({ length: maxIndex + 1 }, (_, index) => {
            const member = byIndex.get(index);

            if (!member) return factory.createOmittedExpression();

            return buildElement({ member, propertyName: String(index) });
        });

        return factory.createArrayBindingPattern(elements);
    }

    // A checker-proven `record.field[n]` is one nested selection agreement,
    // not two independent reads.  Keep the outer property and exact tuple
    // positions together so grammar does not invent a carrier or detach a
    // receiver-dependent lookup.
    if (nestedArrayMembers.length) {
        const nestedByProperty = nestedArrayMembers.reduce((byProperty, member = {}) => {
            const { outerPropertyName = '' } = getObject(member);
            const current = byProperty.get(outerPropertyName) || [];

            return new Map([...byProperty, [outerPropertyName, [...current, member]]]);
        }, new Map());

        const nestedElements = [...nestedByProperty.keys()].map((propertyName) => {
            const propertyMembers = nestedByProperty.get(propertyName) || [];
            const maxIndex = Math.max(...propertyMembers.map(({ propertyName: index = '-1' } = {}) => Number(index)));
            const byIndex = new Map(propertyMembers.map((member = {}) => [Number(getObject(member).propertyName), member]));
            const elements = Array.from({ length: maxIndex + 1 }, (_, index) => {
                const member = byIndex.get(index);

                return member
                    ? buildElement({ member, propertyName: String(index) })
                    : factory.createOmittedExpression();
            });

            return factory.createBindingElement(
                undefined,
                factory.createIdentifier(propertyName),
                factory.createArrayBindingPattern(elements),
                undefined
            );
        });
        const objectMembers = members
            .filter(({ kind = '' } = {}) => kind === 'object')
            .map((member = {}) => {
                const { propertyName = '', alias = '' } = getObject(member);

                return buildElement({
                    member,
                    propertyKey: propertyName === alias ? undefined : factory.createIdentifier(propertyName),
                    propertyName
                });
            });

        return factory.createObjectBindingPattern([...objectMembers, ...nestedElements]);
    }

    return factory.createObjectBindingPattern(members.map((member = {}) => {
        const { propertyName = '', alias = '' } = getObject(member);

        return buildElement({
            member,
            propertyKey: propertyName === alias ? undefined : factory.createIdentifier(propertyName),
            propertyName
        });
    }));
};

const getMemberBindingStatement = ({
    typescript = {},
    factory = {},
    objectName = '',
    members = []
} = {}) => {
    const {
        NodeFlags: {
            Const: ConstKind3 = 0
        } = {}
    } = typescript;

    const statement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
                getMemberBindingPattern({
                    typescript,
                    factory,
                    members,
                    sourceName: objectName
                }),
                undefined,
                undefined,
                factory.createIdentifier(objectName)
            )
        ], ConstKind3)
    );
    const reason = members
        .map(({ agreementReason = '' } = {}) => agreementReason)
        .find(Boolean);

    return annotateAgreementException({
        typescript,
        node: statement,
        reason
    });
};

export {
    getMemberAlias,
    getMemberBindingPattern,
    getMemberBindingStatement,
    getTupleIndex,
    isStaticMemberRead
};
