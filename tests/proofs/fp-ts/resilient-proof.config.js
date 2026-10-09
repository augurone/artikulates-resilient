// eslint-disable-next-line resilient/prefer-safe-transformations -- CommonJS loads the proof profile through this module-owned export slot.
module.exports = {
    run: async options => (await import('eslint-plugin-resilient/fp-ts-proof')).default.run(options)
};
