export { HighlightedCodeBlock } from './HighlightedCodeBlock';
export { RenderableCodeBlock } from './RenderableCodeBlock';
export { MermaidRenderer } from './renderers/MermaidRenderer';
export { VegaLiteRenderer } from './renderers/VegaLiteRenderer';

/** Languages that support visual rendering (diagram/chart mode + code mode) */
export const RENDERABLE_LANGUAGES = new Set(['mermaid', 'vega-lite']);

/** Check if a language should be rendered as a diagram/chart */
export function isRenderableLanguage(lang: string): boolean {
  return RENDERABLE_LANGUAGES.has(lang.toLowerCase());
}
