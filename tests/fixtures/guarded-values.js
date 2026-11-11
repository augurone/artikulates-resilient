const Page = ({
    studioUtils,
    pageComponents = []
}) => (
    <body>
        {pageComponents.map(({
            fields = {},
            ...metaProps
        } = {}, i) => (
            <RenderComponents
                key={i}
                {...(studioUtils && { studioUtils })}
                {...metaProps}
                {...fields} />
        ))}
    </body>
);
