import { Component, createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { render as solidRender } from 'solid-js/web';
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';
import { isRenderableLanguage, RenderableCodeBlock, HighlightedCodeBlock } from '@/components/markdown';

// ============================================================================
// Types
// ============================================================================

interface MarkdownProps {
  text: string;
  class?: string;
  /** Whether the text is still being streamed (growing) */
  isStreaming?: boolean;
  /** Called when a renderable block (mermaid/vega-lite) fails to render */
  onRenderError?: (error: string, lang: string, code: string) => void;
}

// ============================================================================
// Shared marked + shiki instance (lazy init, singleton)
// ============================================================================

let markedInstance: Marked | null = null;
let shikiHighlighter: any = null;

const parseCache = new Map<string, string>();
const MAX_CACHE_SIZE = 100;

const SHIKI_LANGS = [
  'javascript', 'typescript', 'python', 'go', 'rust', 'bash', 'shell',
  'json', 'yaml', 'html', 'css', 'jsx', 'tsx', 'markdown', 'sql',
  'dockerfile', 'java', 'kotlin', 'swift', 'ruby', 'php', 'c', 'cpp',
  'csharp', 'scala', 'r', 'lua', 'toml',
];

async function getHighlighter() {
  if (shikiHighlighter) return shikiHighlighter;
  const { createHighlighter } = await import('shiki');
  shikiHighlighter = await createHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: SHIKI_LANGS,
  });
  return shikiHighlighter;
}

function highlightCode(code: string, lang: string): string {
  if (!shikiHighlighter) return '';
  try {
    return shikiHighlighter.codeToHtml(code, { lang, theme: 'github-light' });
  } catch {
    return '';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function getMarked(): Promise<Marked> {
  if (markedInstance) return markedInstance;

  // Ensure shiki is ready before configuring marked
  await getHighlighter();

  const { Marked } = await import('marked');
  markedInstance = new Marked({ gfm: true, breaks: true });

  markedInstance.use({
    renderer: {
      code(token: Tokens.Code) {
        const code = token.text;
        const language = (token.lang || 'text').toLowerCase();

        // ── Renderable languages (mermaid, vega-lite) ──
        // Output a placeholder <div> that will be hydrated by SolidJS post-render.
        // The code is base64-encoded in a data attribute to survive DOMPurify.
        if (isRenderableLanguage(language)) {
          const encodedCode = btoa(unescape(encodeURIComponent(code)));
          return `<div class="renderable-placeholder" data-lang="${escapeHtml(language)}" data-code="${encodedCode}"></div>`;
        }

        // ── Regular code: shiki syntax highlighting ──
        const shikiHtml = highlightCode(code, language);
        if (shikiHtml) {
          const encodedCode = btoa(unescape(encodeURIComponent(code)));
          return `<div class="code-placeholder" data-lang="${escapeHtml(language)}" data-code="${encodedCode}" data-highlighted="${btoa(unescape(encodeURIComponent(shikiHtml)))}""></div>`;
        }

        // Fallback: plain code block
        return `<pre class="code-block-fallback rounded-xl overflow-hidden bg-[#f6f8fa] border border-black/10 p-4 my-3"><code class="language-${escapeHtml(language)} text-[13px] leading-relaxed text-gray-800">${escapeHtml(code)}</code></pre>`;
      },
    },
  });

  return markedInstance;
}

// ============================================================================
// Detect if text has incomplete code blocks (streaming partial)
// ============================================================================

function hasIncompleteCodeBlock(text: string): boolean {
  // Count triple-backtick markers
  const matches = text.match(/```/g);
  if (!matches) return false;
  // Odd number of ``` means an unclosed code block
  return matches.length % 2 !== 0;
}

// ============================================================================
// Markdown Component
// ============================================================================

export const Markdown: Component<MarkdownProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let streamRef: HTMLDivElement | undefined;
  const [html, setHtml] = createSignal('');
  const [isStreamRendering, setIsStreamRendering] = createSignal(false);
  let parseTimeoutId: number | undefined;
  let lastParsedText = '';
  let mountedDisposers: (() => void)[] = [];
  let lastStreamText = '';

  onCleanup(() => {
    if (parseTimeoutId) clearTimeout(parseTimeoutId);
    mountedDisposers.forEach(d => d());
    mountedDisposers = [];
  });

  // ── Parse markdown reactively ──
  // During streaming: use lightweight incremental text rendering (no innerHTML replacement)
  // After streaming ends: full markdown parse + code block hydration
  createEffect(() => {
    const text = props.text;
    const streaming = props.isStreaming ?? false;

    if (!text) {
      setHtml('');
      setIsStreamRendering(false);
      lastParsedText = '';
      lastStreamText = '';
      return;
    }

    // ── Streaming mode: lightweight text rendering ──
    // During active streaming, avoid full innerHTML replacement.
    // Instead, append new text to a plain text node for zero flicker.
    if (streaming && text.length > lastParsedText.length) {
      setIsStreamRendering(true);

      // Throttled markdown parse during streaming (every 300ms instead of 50ms)
      if (parseTimeoutId) clearTimeout(parseTimeoutId);
      parseTimeoutId = window.setTimeout(async () => {
        try {
          const marked = await getMarked();
          const parsed = await marked.parse(text);
          const sanitized = DOMPurify.sanitize(parsed, {
            ADD_ATTR: ['data-lang', 'data-code', 'data-highlighted'],
            ADD_TAGS: ['span'],
          });
          setHtml(sanitized);
          lastParsedText = text;
          setIsStreamRendering(false);
        } catch {
          // On parse error, keep showing raw text
        }
      }, 300) as unknown as number;

      lastStreamText = text;
      return;
    }

    // ── Non-streaming (or stream just ended): full markdown parse ──
    if (text === lastParsedText) return;

    // Check cache
    if (!streaming) {
      const cached = parseCache.get(text);
      if (cached) {
        setHtml(cached);
        lastParsedText = text;
        setIsStreamRendering(false);
        return;
      }
    }

    if (parseTimeoutId) clearTimeout(parseTimeoutId);

    parseTimeoutId = window.setTimeout(async () => {
      try {
        const marked = await getMarked();
        const parsed = await marked.parse(text);
        const sanitized = DOMPurify.sanitize(parsed, {
          ADD_ATTR: ['data-lang', 'data-code', 'data-highlighted'],
          ADD_TAGS: ['span'],
        });

        if (!streaming && sanitized.length > 0) {
          if (parseCache.size >= MAX_CACHE_SIZE) {
            const firstKey = parseCache.keys().next().value;
            if (firstKey) parseCache.delete(firstKey);
          }
          parseCache.set(text, sanitized);
        }

        setHtml(sanitized);
        lastParsedText = text;
        setIsStreamRendering(false);
      } catch (error) {
        console.error('[Markdown] Parse error:', error);
        setHtml(`<p>${escapeHtml(text)}</p>`);
        lastParsedText = text;
        setIsStreamRendering(false);
      }
    }, 0) as unknown as number;
  });

  // ── Post-render: mount SolidJS components into placeholder divs ──
  // Track mounted block signatures to avoid unnecessary re-mounts (prevents flickering)
  let mountedBlockSignatures: string[] = [];

  createEffect(() => {
    const htmlContent = html();
    if (!containerRef || !htmlContent) return;

    // Use requestAnimationFrame to ensure innerHTML has been painted to DOM
    // before we query for placeholder elements and mount SolidJS components
    requestAnimationFrame(() => {
      if (!containerRef) return;

      // Collect current block signatures to detect actual changes
      const currentSignatures: string[] = [];
      const renderablePlaceholders = containerRef.querySelectorAll('.renderable-placeholder');
      const codePlaceholders = containerRef.querySelectorAll('.code-placeholder');

      renderablePlaceholders.forEach((el) => {
        currentSignatures.push(`r:${el.getAttribute('data-lang')}:${el.getAttribute('data-code')?.slice(0, 32)}`);
      });
      codePlaceholders.forEach((el) => {
        currentSignatures.push(`c:${el.getAttribute('data-lang')}:${el.getAttribute('data-code')?.slice(0, 32)}`);
      });

      // If block signatures haven't changed, skip re-mounting (prevents flickering)
      const sigKey = currentSignatures.join('|');
      const prevSigKey = mountedBlockSignatures.join('|');
      if (sigKey === prevSigKey && mountedDisposers.length > 0) {
        return;
      }
      mountedBlockSignatures = currentSignatures;

      // Cleanup previous mounts only when blocks actually changed
      mountedDisposers.forEach(d => d());
      mountedDisposers = [];

    const isStreaming = props.isStreaming ?? false;
    const textHasIncompleteBlock = hasIncompleteCodeBlock(props.text);

    // ── Mount renderable blocks (mermaid, vega-lite) ──
    // (renderablePlaceholders already collected above for signature check)
    renderablePlaceholders.forEach((el, idx) => {
      const lang = el.getAttribute('data-lang') || 'mermaid';
      const encodedCode = el.getAttribute('data-code') || '';
      let code: string;
      try {
        code = decodeURIComponent(escape(atob(encodedCode)));
      } catch {
        code = '';
      }
      if (!code) return;

      // Get shiki-highlighted HTML for the code tab
      const shikiHtml = highlightCode(code, lang === 'vega-lite' ? 'json' : lang);

      // Determine if this specific block is still streaming (incomplete)
      // The LAST renderable block in the text is incomplete if the text has an unclosed code fence
      const isLastBlock = idx === renderablePlaceholders.length - 1;
      const blockIsStreaming = isStreaming && textHasIncompleteBlock && isLastBlock;

      const disposer = solidRender(
        () => (
          <RenderableCodeBlock
            code={code}
            lang={lang as any}
            id={`rb-${idx}-${Date.now()}`}
            highlightedHtml={shikiHtml}
            isStreaming={blockIsStreaming}
            onRenderError={props.onRenderError}
          />
        ),
        el as HTMLElement,
      );
      mountedDisposers.push(disposer);
    });

    // ── Mount highlighted code blocks ──
    // (codePlaceholders already collected above for signature check)
    codePlaceholders.forEach((el, idx) => {
      const lang = el.getAttribute('data-lang') || 'text';
      const encodedCode = el.getAttribute('data-code') || '';
      const encodedHighlighted = el.getAttribute('data-highlighted') || '';
      let code: string;
      let highlightedHtml: string;
      try {
        code = decodeURIComponent(escape(atob(encodedCode)));
        highlightedHtml = encodedHighlighted ? decodeURIComponent(escape(atob(encodedHighlighted))) : '';
      } catch {
        code = '';
        highlightedHtml = '';
      }
      if (!code) return;

      const disposer = solidRender(
        () => <HighlightedCodeBlock code={code} lang={lang} highlightedHtml={highlightedHtml} />,
        el as HTMLElement,
      );
      mountedDisposers.push(disposer);
    });
    }); // end requestAnimationFrame
  });

  return (
    <div class={cn('markdown-content', props.class)}>
      {/* During active streaming: show raw text to avoid flicker from innerHTML replacement.
          The full markdown parse runs on a 300ms throttle in the background. */}
      <Show when={isStreamRendering() && !html()}>
        <div class="whitespace-pre-wrap break-words">{props.text}</div>
      </Show>
      {/* Parsed markdown HTML (shown when parse is complete or during throttled updates) */}
      <Show when={html()}>
        <div ref={containerRef} innerHTML={html()} />
      </Show>
    </div>
  );
};

export default Markdown;
