const getChildren = ({ typescript = {}, node = {} } = {}) => {
    const children = [];
    typescript.forEachChild(node, (child) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This call-local buffer preserves compiler child order without copying its growing prefix or mutating the parser-owned node.
        children.push(child);
    });

    return children;
};

export { getChildren };
