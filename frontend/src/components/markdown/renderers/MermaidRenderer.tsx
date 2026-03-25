import { Component, createSignal, onMount } from 'solid-js';

interface MermaidRendererProps {
  code: string;
  id: string;
  /** Called when mermaid rendering fails — used to feed error back to agent */
  onError?: (error: string, code: string) => void;
}

// Module-level singleton: mermaid is loaded once and reused
let mermaidModule: any = null;
let mermaidInitialized = false;
let renderCounter = 0;
// Version tag — bump to force re-initialization when theme changes
const MERMAID_CONFIG_VERSION = 2; // v2: light theme
let mermaidConfigVersion = 0;

async function getMermaid() {
  if (mermaidModule) return mermaidModule;
  const mod = await import('mermaid');
  mermaidModule = mod.default;
  if (!mermaidInitialized || mermaidConfigVersion !== MERMAID_CONFIG_VERSION) {
    mermaidModule.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      themeVariables: {
        primaryColor: '#e3f2fd',
        primaryTextColor: '#1a1a1a',
        primaryBorderColor: '#90caf9',
        lineColor: '#666',
        secondaryColor: '#f3e5f5',
        tertiaryColor: '#e8f5e9',
        noteBkgColor: '#fff9c4',
        noteTextColor: '#333',
        actorBkg: '#e3f2fd',
        actorTextColor: '#1a1a1a',
        actorBorder: '#90caf9',
        signalColor: '#333',
        signalTextColor: '#333',
      },
    });
    mermaidInitialized = true;
    mermaidConfigVersion = MERMAID_CONFIG_VERSION;
  }
  return mermaidModule;
}

/**
 * Renders a Mermaid diagram from source code.
 * Mermaid.js is lazy-loaded on first use (~2MB, code-split by Vite).
 * If rendering fails, calls onError with the error message to allow agent self-correction.
 */
export const MermaidRenderer: Component<MermaidRendererProps> = (props) => {
  const [svg, setSvg] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const mermaid = await getMermaid();
      // Unique ID to avoid DOM collisions
      const renderId = `mermaid-${props.id}-${++renderCounter}`;
      const { svg: renderedSvg } = await mermaid.render(renderId, props.code);
      setSvg(renderedSvg);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to render Mermaid diagram';
      console.warn('[MermaidRenderer] Render failed:', errorMsg);
      setError(errorMsg);
      // Feed error back to agent for self-correction
      props.onError?.(errorMsg, props.code);
    } finally {
      setLoading(false);
    }
  });

  return (
    <div class="mermaid-render-area min-h-[80px]">
      {loading() && (
        <div class="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
          <div class="animate-spin w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
          Loading diagram...
        </div>
      )}
      {error() && (
        <div class="text-xs text-red-400 p-3 bg-red-500/10 rounded-lg border border-red-500/20 m-2">
          <div class="flex items-center gap-1.5 mb-1">
            <span class="material-symbols-outlined" style="font-size: 14px">error</span>
            <span class="font-medium">Mermaid Syntax Error</span>
          </div>
          <pre class="whitespace-pre-wrap text-red-300/80 mt-1">{error()}</pre>
        </div>
      )}
      {svg() && (
        <div
          class="w-full overflow-x-auto p-4 bg-white rounded-lg [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
          innerHTML={svg()}
        />
      )}
    </div>
  );
};
