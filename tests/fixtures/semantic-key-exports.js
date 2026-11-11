const observe = value => !value;
const invoke = value => value();

// eslint-disable-next-line resilient/no-falsifiable-property-key -- This adversarial module verifies that unknown lookup cannot borrow an explicitly empty export.
export { observe as '', invoke };
