import { Component, createSignal } from 'solid-js';

interface HighlightedCodeBlockProps {
  code: string;
  lang: string;
  /** Pre-rendered shiki HTML (optional — if not provided, renders as plain text) */
  highlightedHtml?: string;
}

/**
 * Code block with syntax highlighting (shiki), language badge, and copy button.
 * Used for all non-renderable languages (go, java, python, typescript, etc.)
 */
export const HighlightedCodeBlock: Component<HighlightedCodeBlockProps> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="code-block-container rounded-xl overflow-hidden border border-black/10 bg-[#f6f8fa] my-3">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-2 bg-black/[0.03] border-b border-black/10">
        <span class="text-xs font-mono text-gray-500">{props.lang || 'text'}</span>
        <button
          class={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs transition-all ${
            copied() ? 'text-green-600 bg-green-500/10' : 'text-gray-400 hover:text-gray-600 hover:bg-black/5'
          }`}
          onClick={handleCopy}
          title={copied() ? 'Copied!' : 'Copy code'}
        >
          <span class="material-symbols-outlined" style="font-size: 14px">
            {copied() ? 'check' : 'content_copy'}
          </span>
          <span>{copied() ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Code body */}
      <div class="overflow-x-auto p-2 [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!bg-transparent [&_code]:!text-[13px] [&_code]:!leading-relaxed">
        {props.highlightedHtml ? (
          <div innerHTML={props.highlightedHtml} />
        ) : (
          <pre class="p-4"><code class={`language-${props.lang}`}>{props.code}</code></pre>
        )}
      </div>
    </div>
  );
};
