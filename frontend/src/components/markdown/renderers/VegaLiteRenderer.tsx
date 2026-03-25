import { Component, createSignal, onMount, onCleanup } from 'solid-js';

interface VegaLiteRendererProps {
  spec: string;
  id: string;
}

/**
 * Vega official example data CDN base URL.
 * Relative data URLs like "data/unemployment-across-industries.json"
 * are resolved against this base so Vega examples work out-of-the-box.
 */
const VEGA_DATA_CDN = 'https://cdn.jsdelivr.net/npm/vega-datasets@2/';

/**
 * Renders a Vega-Lite visualization from a JSON spec.
 * vega-embed is lazy-loaded on first use (~3MB, code-split by Vite).
 */
export const VegaLiteRenderer: Component<VegaLiteRendererProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  let vegaView: any = null;

  onMount(async () => {
    if (!containerRef) return;

    try {
      let spec: any;
      try {
        spec = JSON.parse(props.spec);
      } catch {
        throw new Error('Invalid JSON in vega-lite spec');
      }

      // Resolve relative data URLs to Vega CDN
      // e.g. "data/unemployment-across-industries.json" → full CDN URL
      if (spec.data?.url && !spec.data.url.startsWith('http')) {
        spec.data.url = VEGA_DATA_CDN + spec.data.url;
      }
      // Also resolve for layer / concat specs
      for (const sub of (spec.layer || spec.concat || spec.hconcat || spec.vconcat || [])) {
        if (sub?.data?.url && !sub.data.url.startsWith('http')) {
          sub.data.url = VEGA_DATA_CDN + sub.data.url;
        }
      }

      const vegaEmbed = await import('vega-embed');
      const result = await vegaEmbed.default(containerRef, spec, {
        actions: false,
        renderer: 'svg',
      });
      vegaView = result.view;
    } catch (err: any) {
      console.warn('[VegaLiteRenderer] Failed to render:', err);
      setError(err.message || 'Failed to render Vega-Lite chart');
    } finally {
      setLoading(false);
    }
  });

  onCleanup(() => {
    if (vegaView) {
      vegaView.finalize();
      vegaView = null;
    }
  });

  return (
    <div class="vega-render-area min-h-[80px] p-4 bg-white rounded-lg flex items-center justify-center">
      {loading() && (
        <div class="flex items-center gap-2 text-sm text-gray-400">
          <div class="animate-spin w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
          Loading chart...
        </div>
      )}
      {error() && (
        <div class="text-sm text-red-400 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <span class="font-medium">Vega-Lite Error:</span> {error()}
        </div>
      )}
      <div ref={containerRef} class="w-full [&_.vega-embed]:w-full" />
    </div>
  );
};
