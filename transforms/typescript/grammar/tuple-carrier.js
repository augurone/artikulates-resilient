// A tuple carrier owns only the existence and evaluation of the container.
// Each position carries separate evidence: a required container never makes an
// arbitrary generic member required.
const TUPLE_CARRIER_VALUE = 'values';

const createTupleCarrier = ({ source = {} } = {}) => ({ source });

// The emitted carrier is an ordinary value with one stable field.  It gives
// the rule a falsifiable, local proof that `values` exists without claiming
// that the array's generic members have defaults.
const createTupleCarrierExpression = ({ factory = {}, carrier = {} } = {}) => {
    const { source = {} } = carrier;

    return factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(TUPLE_CARRIER_VALUE, source)
    ], false);
};

const createTupleCarrierPattern = ({ factory = {}, elements = [] } = {}) => factory.createObjectBindingPattern([
    factory.createBindingElement(
        undefined,
        factory.createIdentifier(TUPLE_CARRIER_VALUE),
        factory.createArrayBindingPattern(elements),
        undefined
    )
]);

export {
    createTupleCarrier,
    createTupleCarrierExpression,
    createTupleCarrierPattern
};
