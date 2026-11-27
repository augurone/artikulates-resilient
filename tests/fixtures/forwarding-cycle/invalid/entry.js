// eslint-disable-next-line import/no-cycle -- The fixture exercises mutation through a live ESM cycle.
import { replace } from './peer.js';

export const sink = { map: payload => !payload };

replace();

const run = ({ func } = {}) => {
    if (func) sink.map(func);
};

run({ func: 42 });
