export function getChatMarkdownComponents({
  compactParagraphs = false,
}: {
  compactParagraphs?: boolean;
} = {}) {
  const paragraphClass = compactParagraphs
    ? "mb-0 last:mb-0 break-words"
    : "mb-3 last:mb-0 break-words";
  const listClass = compactParagraphs
    ? "my-1 pl-5 space-y-0.5"
    : "my-2 pl-5 space-y-1";
  const headingClass =
    "text-sm leading-relaxed font-semibold mb-2 mt-3 first:mt-0";

  return {
    p: ({ children }: any) => <p className={paragraphClass}>{children}</p>,
    h1: ({ children }: any) => <h1 className={headingClass}>{children}</h1>,
    h2: ({ children }: any) => <h2 className={headingClass}>{children}</h2>,
    h3: ({ children }: any) => <h3 className={headingClass}>{children}</h3>,
    h4: ({ children }: any) => <h4 className={headingClass}>{children}</h4>,
    h5: ({ children }: any) => <h5 className={headingClass}>{children}</h5>,
    h6: ({ children }: any) => <h6 className={headingClass}>{children}</h6>,
    ul: ({ children }: any) => <ul className={`${listClass} list-disc`}>{children}</ul>,
    ol: ({ children }: any) => (
      <ol className={`${listClass} list-decimal`}>{children}</ol>
    ),
    li: ({ children }: any) => <li className="break-words">{children}</li>,
    a: ({ children, href }: any) => (
      <a
        href={href}
        className="text-primary underline underline-offset-2 break-all"
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    ),
    code: ({ inline, children }: any) =>
      inline ? (
        <code className="rounded bg-muted/50 px-1 py-0.5 text-[0.92em] break-words">
          {children}
        </code>
      ) : (
        <code className="text-xs leading-relaxed">{children}</code>
      ),
    pre: ({ children }: any) => (
      <pre className="my-2 overflow-x-auto rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed">
        {children}
      </pre>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="my-2 border-l-2 border-border/70 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
  };
}
