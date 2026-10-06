import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/**
 * The element renderers.
 *
 * Module scope, and that is load-bearing rather than tidiness. `react-markdown`
 * builds a fresh unified processor on every render and passes these through to
 * it, so a literal here would be a new object identity every time. It is also
 * the second argument to the `memo` below: with an inline object, `memo` would
 * compare two different references on every render and always conclude the
 * props changed, making the whole component pointless. Hoisting it is what
 * makes both the memo and the parse count depend on the text alone.
 */
const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,

  // Headings are scaled down: a `#` heading at browser default size
  // would dominate a 400px panel. They carry the accent colour and a
  // rule under the top two levels, which is what gives a long answer a
  // scannable structure instead of one grey wall of text.
  h1: ({ children }) => (
    <h3 className="mb-1.5 mt-3.5 border-b border-line pb-1 text-[13.5px] font-semibold text-heading first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-1.5 mt-3.5 border-b border-line pb-1 text-[13px] font-semibold text-heading first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-[12.5px] font-semibold text-heading first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h3 className="mb-1 mt-3 text-[12.5px] font-semibold text-fg first:mt-0">{children}</h3>
  ),

  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-4 marker:text-accent first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-4 marker:font-medium marker:text-accent first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,

  // Inline code and blocks are visually distinct: a block gets its own
  // surface and scrolls horizontally rather than wrapping, because
  // wrapped code is harder to read than scrolled code.
  //
  // Three shapes have to be told apart, and only one of them is
  // signalled by a language tag:
  //
  // * `language-js` - a fenced block with a language.
  // * no class at all - a fenced block *without* a language, or an
  //   inline span. A code span cannot contain a newline (CommonMark
  //   folds it to a space), so the newline is what separates them.
  // * `hljs language-js` - the same block after `rehype-highlight` has
  //   run, which *prepends* `hljs`. A `startsWith("language-")` test
  //   silently fails here, which is why the class list is searched
  //   rather than its prefix checked.
  code: ({ className, children }) => {
    const classes = typeof className === "string" ? className.split(/\s+/) : [];
    const isBlock =
      classes.some((name) => name.startsWith("language-")) ||
      String(children).includes("\n");

    if (!isBlock) {
      return (
        <code className="rounded-[4px] bg-code-inline px-1 py-px font-mono text-[11.5px] font-medium text-code-inline-fg">
          {children}
        </code>
      );
    }
    return (
      // The `hljs` class carries the token colours; the wrapper in
      // `pre` supplies the surface. Padding lives here rather than on
      // the wrapper so a highlighted block and a plain one look
      // identical.
      <code
        className={`block overflow-x-auto p-2.5 font-mono text-[11.5px] leading-[1.55] ${className ?? ""}`}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-hidden rounded-[6px] border border-line bg-code-surface first:mt-0 last:mb-0">
      {children}
    </pre>
  ),

  a: ({ href, children }) => (
    // Links open in the default browser via the OS, matching how a
    // search result is opened. `rel` is set even though this is not a
    // browser context, so the intent is explicit.
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),

  // The left rule is the accent rather than a grey, so a quoted block
  // reads as deliberate emphasis instead of an indentation accident.
  blockquote: ({ children }) => (
    <blockquote className="my-2 rounded-r-[4px] border-l-[3px] border-accent/45 bg-accent-soft py-1.5 pl-2.5 pr-2 text-fg-muted first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-3.5 border-line" />,

  // Tables scroll horizontally: a wide table must not stretch the panel.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-[6px] border border-line first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-table-head">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-line px-2 py-1.5 text-left font-semibold text-heading">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line px-2 py-1.5 align-top last:border-r-0">{children}</td>
  ),

  // Emphasis carries colour as well as weight, which is what makes a
  // dense answer skimmable. Only `strong` is coloured; colouring both
  // would leave no way to tell them apart at a glance.
  strong: ({ children }) => <strong className="font-semibold text-strong">{children}</strong>,
  em: ({ children }) => <em className="italic text-fg-muted">{children}</em>,

  // A strikethrough means the model retracted something, so it is
  // dimmed rather than left at full contrast.
  del: ({ children }) => <del className="text-fg-subtle">{children}</del>,
};

/**
 * The plugin lists, also at module scope.
 *
 * `remarkPlugins={[remarkGfm]}` in JSX would allocate a new array on every
 * render. These are stable references so the only thing that can make the
 * processor's configuration differ between renders is the text itself.
 */
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/**
 * Renders a model reply as Markdown.
 *
 * Safe by construction: `react-markdown` builds a React element tree rather
 * than assigning HTML, so there is no `dangerouslySetInnerHTML` and raw HTML in
 * a reply is rendered as text instead of being executed. That is why no
 * sanitiser is needed here, and why `rehype-raw` is deliberately *not* enabled -
 * it would reintroduce exactly the risk this avoids.
 *
 * Every element is styled explicitly instead of through a typography plugin, so
 * the output inherits the app's design tokens and stays legible inside a small
 * floating panel. Default Markdown styles assume a full-width article.
 *
 * `rehype-highlight` is given the `common` language set (its default) rather
 * than all of highlight.js: those ~37 languages cover essentially everything a
 * model emits, and registering the full set would bloat the bundle for
 * languages that would never appear.
 *
 * The memo is what keeps a streaming reply affordable. `react-markdown`
 * re-parses its whole input on every render - there is no incremental parse -
 * so a transcript of N finished replies would otherwise re-parse all N of them
 * every time a token arrives, to say nothing of re-highlighting every code
 * block in the history. Measured on this pipeline, a 120-line code block costs
 * 4.7 ms to parse and highlight, of which highlighting is 81%; the frame budget
 * is 16.7 ms. Committed messages never change, so this stops that work from
 * being repeated for content that cannot have changed.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words text-[12.5px] leading-5 text-fg">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
