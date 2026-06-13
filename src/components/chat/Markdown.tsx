import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant messages as formatted Markdown (headings, bold, lists,
 * tables, links) with TII-themed styling. Web links open in a new tab; tel:
 * links are click-to-call (react-markdown strips tel: by default, so we allow
 * it through urlTransform).
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-headings:text-tii-navy prose-strong:text-tii-navy prose-a:text-tii-blue prose-a:font-medium">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          /^tel:/i.test(url) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, ...props }) => {
            const isTel = typeof href === "string" && /^tel:/i.test(href);
            return isTel ? (
              <a href={href} {...props} />
            ) : (
              <a href={href} {...props} target="_blank" rel="noopener noreferrer" />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
