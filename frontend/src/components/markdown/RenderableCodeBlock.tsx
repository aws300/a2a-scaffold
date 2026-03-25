import { Component, createSignal, Show } from 'solid-js';
import { HighlightedCodeBlock } from './HighlightedCodeBlock';
import { MermaidRenderer } from './renderers/MermaidRenderer';
import { VegaLiteRenderer } from './renderers/VegaLiteRenderer';

type RenderableLanguage = 'mermaid' | 'vega-lite';
type TabMode = 'render' | 'code';

interface RenderableCodeBlockProps {
  code: string;
  lang: RenderableLanguage;
  id: string;
  /** shiki-highlighted HTML for the code tab */
  highlightedHtml?: string;
  /** Whether the code block is still being streamed (incomplete) */
  isStreaming?: boolean;
  /** Called when renderable block has an error (e.g. mermaid syntax error) */
  onRenderError?: (error: string, lang: string, code: string) => void;
}

const LANG_LABELS: Record<RenderableLanguage, { renderIcon: string; renderLabel: string }> = {
  'mermaid': { renderIcon: 'account_tree', renderLabel: 'Diagram' },
  'vega-lite': { renderIcon: 'bar_chart', renderLabel: 'Chart' },
};

/**
 * A code block that can be rendered as a diagram/chart OR viewed as source code.
 * Provides tab switching between "Render" and "Code" modes.
 * 
 * During streaming (isStreaming=true), only shows Code mode to avoid
 * rendering incomplete mermaid/vega-lite syntax.
 */
export const RenderableCodeBlock: Component<RenderableCodeBlockProps> = (props) => {
  // Default to render mode unless streaming (incomplete blocks should show code)
  const [activeTab, setActiveTab] = createSignal<TabMode>(props.isStreaming ? 'code' : 'render');
  const [copied, setCopied] = createSignal(false);
  const [renderFailed, setRenderFailed] = createSignal(false);

  const labels = () => LANG_LABELS[props.lang] || LANG_LABELS['mermaid'];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenderError = (error: string, code: string) => {
    setRenderFailed(true);
    // Auto-switch to code tab on error so user sees the source
    setActiveTab('code');
    props.onRenderError?.(error, props.lang, code);
  };

  return (
    <div class="renderable-block rounded-xl overflow-hidden border border-black/10 bg-[#f6f8fa] my-3">
      {/* Header with tabs */}
      <div class="flex items-center justify-between px-3 py-1.5 bg-black/[0.03] border-b border-black/10">
        <div class="flex items-center gap-1">
          {/* Render tab */}
          <button
            class={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab() === 'render'
                ? 'bg-primary/15 text-primary'
                : 'text-gray-400 hover:text-gray-600 hover:bg-black/5'
            } ${props.isStreaming ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => !props.isStreaming && setActiveTab('render')}
            disabled={props.isStreaming}
            title={props.isStreaming ? 'Waiting for complete code block...' : `View as ${labels().renderLabel}`}
          >
            <span class="material-symbols-outlined" style="font-size: 14px">{labels().renderIcon}</span>
            {labels().renderLabel}
            {renderFailed() && (
              <span class="material-symbols-outlined text-red-500" style="font-size: 12px">error</span>
            )}
          </button>
          {/* Code tab */}
          <button
            class={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              activeTab() === 'code'
                ? 'bg-primary/15 text-primary'
                : 'text-gray-400 hover:text-gray-600 hover:bg-black/5'
            }`}
            onClick={() => setActiveTab('code')}
          >
            <span class="material-symbols-outlined" style="font-size: 14px">code</span>
            Code
          </button>
        </div>

        <div class="flex items-center gap-2">
          {/* Language badge */}
          <span class="text-xs font-mono text-gray-400">{props.lang}</span>
          {/* Streaming indicator */}
          <Show when={props.isStreaming}>
            <div class="flex items-center gap-1 text-xs text-amber-500">
              <div class="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              streaming
            </div>
          </Show>
          {/* Copy button */}
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
          </button>
        </div>
      </div>

      {/* Content area */}
      <div class="relative">
        {/* Render mode */}
        <Show when={activeTab() === 'render'}>
          <Show
            when={props.lang === 'mermaid'}
            fallback={<VegaLiteRenderer spec={props.code} id={props.id} />}
          >
            <MermaidRenderer code={props.code} id={props.id} onError={handleRenderError} />
          </Show>
        </Show>

        {/* Code mode */}
        <Show when={activeTab() === 'code'}>
          <div class="overflow-x-auto p-2 [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!bg-transparent [&_code]:!text-[13px] [&_code]:!leading-relaxed">
            {props.highlightedHtml ? (
              <div innerHTML={props.highlightedHtml} />
            ) : (
              <pre class="p-4"><code class={`language-${props.lang}`}>{props.code}</code></pre>
            )}
          </div>
        </Show>
      </div>
    </div>
  );
};
