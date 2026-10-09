namespace Sanity {
    export interface Span {
        _type: 'span';
        text?: string;
        marks?: string[];
    }

    export type Image = {
        _type: 'image';
        asset: { _ref: string; _type?: 'reference' };
        crop?: { top?: number; bottom?: number };
    };

    export type Block = Span | Image | {
        _type: 'break';
    };
}

type Mode = 'preview' | 'published';
type Renderable = Sanity.Block | string;
type GenericOptions<T> = {
    value: T;
    fallback?: string;
};
type RendererConfig = {
    mode?: Mode;
    cache?: boolean;
    retries?: number;
    options?: GenericOptions<Renderable>;
};
type Component = typeof Button | typeof Link;
type RenderProps = RendererConfig & {
    value: Renderable;
    component?: Component;
    onError?: (error: unknown) => void;
    children?: string[];
};

const Button = props => ({ component: 'Button', ...props });
const Link = props => ({ component: 'Link', ...props });

const normalizeSpan = (span: Sanity.Span) => resolveSanitySpan(span);

export function Renderer({
    value,
    mode,
    cache,
    retries,
    options,
    component = Button,
    onError,
    children,
    ...standardArgs
}: RenderProps = {}) {
    if (!hasContent(options)) return {};
    if (typeof component !== 'function') return {};

    return component({
        ...standardArgs,
        value,
        mode,
        cache,
        retries,
        options,
        children,
        onError
    });
}

export const renderValue = (value: Renderable, config?: RendererConfig) => ({
    ...config,
    value
});

export const renderSpan = (span: Sanity.Span) => normalizeSpan(span);
