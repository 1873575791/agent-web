import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/** Markdown 渲染（含代码高亮），返回 formatContent 函数 */
export function useMarkdownContent() {
  const copyToClipboard = useCallback((text) => {
    void navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const formatContent = useCallback(
    (content) => {
      if (!content) return null;

      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const codeString = String(children).replace(/\n$/, "");

              if (!inline && (match || codeString.includes("\n"))) {
                return (
                  <div className="code-block-wrapper">
                    <div className="code-block-header">
                      <span className="code-block-lang">
                        {match ? match[1] : "code"}
                      </span>
                      <button
                        type="button"
                        className="code-block-copy"
                        onClick={() => copyToClipboard(codeString)}
                      >
                        复制
                      </button>
                    </div>
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match ? match[1] : "text"}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        borderRadius: "0 0 8px 8px",
                        fontSize: "13px",
                      }}
                      {...props}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  </div>
                );
              }

              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            },
            a({ children, href, ...props }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              );
            },
            table({ children, ...props }) {
              return (
                <div className="table-wrapper">
                  <table {...props}>{children}</table>
                </div>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      );
    },
    [copyToClipboard],
  );

  return formatContent;
}
