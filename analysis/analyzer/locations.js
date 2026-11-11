export const validRange = range => Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range.at(0) >= 0 && range.at(1) >= range.at(0);

// Locations are owned metadata; a session never retains the host node or range.
export const locationOf = ({ range = [], loc: { start: { line = 0, column = -1 } = {} } = {} } = {}) => Object.freeze({
    range: Object.freeze([...range]), line, column: column + 1
});
