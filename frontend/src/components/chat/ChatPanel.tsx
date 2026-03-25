/**
 * ChatPanel — Shared chat panel component for all test pages and playground.
 *
 * Features:
 * - Markdown rendering for assistant messages (via marked + DOMPurify)
 * - Image paste, upload, drag-and-drop (matches Chat page ChatArea)
 * - Pill-shaped glass input matching the main Chat page style
 * - Glassmorphism bubble styles (glass-bubble-user / glass-bubble-agent)
 * - Typing indicator (bouncing dots)
 * - Auto-scroll, clear chat, empty state
 *
 * Used by: DocumentTest, SkillTest, ConnectorTest, KnowledgeTest,
 *          AgentPlayground, PlaygroundAgents, A2A Scaffold
 */
import { Component, createSignal, createEffect, For, Show, type JSX, onCleanup } from 'solid-js';
import { Icon, Card, Badge, Button } from '@/components/ui';
import type { AGUIRunState } from '@/lib/useAgentStream';
import { Markdown } from '@/components/opencode/Markdown';

// ============================================================================
// Types
// ============================================================================

export interface ImageAttachment {
  id: string;
  url: string;       // base64 data URL
  filename?: string;
  mime: string;       // image/png, image/jpeg, etc.
  width?: number;
  height?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  images?: ImageAttachment[];
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  isSending: boolean;
  placeholder?: string;
  onSend: (text: string, images?: ImageAttachment[]) => void;
  onClear: () => void;
  onStop?: () => void;
  headerTitle: string;
  headerBadge?: string;
  backLabel?: string;
  onBack?: () => void;
  emptyTitle?: string;
  emptyDescription?: JSX.Element;
  renderExtra?: (msg: ChatMessage) => JSX.Element | undefined;
  agentRunState?: AGUIRunState;
}

// ============================================================================
// Helpers
// ============================================================================

let _idCounter = 0;
const generateId = () => `img-${Date.now()}-${++_idCounter}`;

async function processImageFile(file: File): Promise<ImageAttachment | null> {
  if (!file.type.startsWith('image/')) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      const img = new Image();
      img.onload = () => resolve({ id: generateId(), url, filename: file.name, mime: file.type, width: img.width, height: img.height });
      img.onerror = () => resolve({ id: generateId(), url, filename: file.name, mime: file.type });
      img.src = url;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// ImagePreviewModal — click-to-zoom overlay
// ============================================================================

const ImagePreviewModal: Component<{ url: string; onClose: () => void }> = (props) => {
  const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
  window.addEventListener('keydown', handleKey);
  onCleanup(() => window.removeEventListener('keydown', handleKey));

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
         onClick={props.onClose}>
      <img src={props.url} alt="Preview"
           class="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
           onClick={(e) => e.stopPropagation()} />
    </div>
  );
};

// ============================================================================
// ChatPanel Component
// ============================================================================

const ChatPanel: Component<ChatPanelProps> = (props) => {
  const [inputValue, setInputValue] = createSignal('');
  const [images, setImages] = createSignal<ImageAttachment[]>([]);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [isDragOver, setIsDragOver] = createSignal(false);
  let chatContainerRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  // Auto-scroll on new messages
  createEffect(() => {
    props.messages;
    if (chatContainerRef) {
      setTimeout(() => { chatContainerRef!.scrollTop = chatContainerRef!.scrollHeight; }, 50);
    }
  });

  // ── Image handlers ──

  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const att = await processImageFile(file);
          if (att) setImages(prev => [...prev, att]);
        }
      }
    }
  };

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const att = await processImageFile(files[i]);
      if (att) setImages(prev => [...prev, att]);
    }
    input.value = '';
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) {
        const att = await processImageFile(files[i]);
        if (att) setImages(prev => [...prev, att]);
      }
    }
  };

  const removeImage = (id: string) => setImages(prev => prev.filter(img => img.id !== id));
  const openFilePicker = () => fileInputRef?.click();

  // ── Send ──

  const handleSend = () => {
    const text = inputValue().trim();
    const attachedImages = images();
    if (!text && attachedImages.length === 0) return;
    setInputValue('');
    setImages([]);
    if (textareaRef) textareaRef.style.height = 'auto';
    props.onSend(text, attachedImages.length > 0 ? attachedImages : undefined);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.isSending && props.onStop) {
      e.preventDefault();
      props.onStop();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    setInputValue(e.currentTarget.value);
    e.currentTarget.style.height = 'auto';
    e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 160) + 'px';
  };

  const canSend = () => inputValue().trim().length > 0 || images().length > 0;
  const showStop = () => props.isSending && !!props.onStop;

  return (
    <Card variant="glass" padding="none" class="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Header ── */}
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/30 shrink-0">
        <div class="flex items-center gap-3">
          <div class="size-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon name="science" size="sm" class="text-primary" />
          </div>
          <div>
            <span class="text-sm font-semibold text-text-primary">{props.headerTitle}</span>
            <Show when={props.headerBadge}>
              <Badge variant="primary" size="sm" class="ml-2">{props.headerBadge}</Badge>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Show when={props.messages.length > 0}>
            <Button variant="ghost" icon="delete_sweep" size="sm" onClick={props.onClear}>Clear</Button>
          </Show>
          <Show when={props.onBack}>
            <Button variant="ghost" icon="arrow_back" size="sm" onClick={props.onBack}>
              {props.backLabel || 'Back'}
            </Button>
          </Show>
        </div>
      </div>

      {/* ── Messages ── */}
      <div ref={chatContainerRef} class="flex-1 overflow-y-auto no-scrollbar px-6 py-5 space-y-5">
        {/* Empty state */}
        <Show when={props.messages.length === 0}>
          <div class="flex flex-col items-center justify-center h-full text-text-muted">
            <div class="size-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
              <Icon name="chat_bubble_outline" size="xl" class="text-primary/30" />
            </div>
            <p class="text-base font-semibold text-text-primary mb-1">{props.emptyTitle || 'Start chatting'}</p>
            <Show when={props.emptyDescription}>
              <p class="text-sm text-text-muted text-center max-w-sm leading-relaxed">
                {props.emptyDescription}
              </p>
            </Show>
          </div>
        </Show>

        {/* Message list */}
        <For each={props.messages}>
          {(msg) => (
            <div class={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div class="max-w-[85%]">
                <div
                  class={`rounded-3xl px-5 py-3.5 leading-relaxed ${
                    msg.role === 'user'
                      ? 'glass-bubble-user rounded-br-lg'
                      : 'glass-bubble-agent rounded-bl-lg'
                  }`}
                >
                  {/* Image attachments */}
                  <Show when={msg.images && msg.images.length > 0}>
                    <div class="flex flex-wrap gap-2 mb-2">
                      <For each={msg.images}>
                        {(img) => (
                          <img
                            src={img.url}
                            alt={img.filename || 'Image'}
                            class="max-w-[200px] max-h-[200px] object-cover rounded-xl border border-white/20 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setPreviewUrl(img.url)}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                  {/* Text content */}
                  <Show when={msg.content}>
                    <Show
                      when={msg.role === 'assistant'}
                      fallback={<p class="whitespace-pre-wrap text-sm text-text-primary">{msg.content}</p>}
                    >
                      <Markdown text={msg.content} class="text-sm text-text-primary" isStreaming={props.isSending} />
                    </Show>
                  </Show>
                </div>
                {props.renderExtra?.(msg)}
              </div>
            </div>
          )}
        </For>

        {/* AG-UI status indicator */}
        <Show when={props.agentRunState && props.agentRunState.isRunning && props.agentRunState.status !== 'completed'}>
          <div class="flex justify-start">
            <div class="flex items-center gap-2 px-4 py-2 rounded-2xl bg-primary/5 border border-primary/10">
              <div class="size-2 bg-primary/60 rounded-full animate-pulse" />
              <span class="text-xs text-text-secondary">
                {props.agentRunState!.status === 'tool_use' && props.agentRunState!.currentTool
                  ? `Using tool: ${props.agentRunState!.currentTool}`
                  : props.agentRunState!.currentStep?.startsWith('tool:')
                    ? `Running: ${props.agentRunState!.currentStep.slice(5)}`
                    : props.agentRunState!.status === 'working'
                      ? 'Thinking...'
                      : 'Processing...'}
              </span>
              <Show when={props.agentRunState!.toolCalls.length > 0}>
                <span class="text-xs text-text-muted">
                  ({props.agentRunState!.toolCalls.filter(tc => tc.status === 'result').length}/{props.agentRunState!.toolCalls.length} tools)
                </span>
              </Show>
            </div>
          </div>
        </Show>

        {/* Typing indicator */}
        <Show when={props.isSending}>
          <div class="flex justify-start">
            <div class="glass-bubble-agent rounded-3xl rounded-bl-lg px-5 py-4">
              <div class="flex items-center gap-1.5">
                <div class="size-2 bg-primary/40 rounded-full animate-bounce" style={{ 'animation-delay': '0ms' }} />
                <div class="size-2 bg-primary/40 rounded-full animate-bounce" style={{ 'animation-delay': '150ms' }} />
                <div class="size-2 bg-primary/40 rounded-full animate-bounce" style={{ 'animation-delay': '300ms' }} />
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* ── Input area (pill shape matching Chat page) ── */}
      <div class="border-t border-white/30 px-5 py-4 shrink-0">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={handleFileChange}
        />

        <div
          class={`glass-input input-container-focus transition-all p-1.5 rounded-[32px] ${
            isDragOver() ? 'ring-2 ring-primary/50 bg-primary/5' : ''
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Image thumbnails preview */}
          <Show when={images().length > 0}>
            <div class="flex flex-wrap gap-2 px-3 pt-2 pb-1">
              <For each={images()}>
                {(img) => (
                  <div class="relative group">
                    <img
                      src={img.url}
                      alt={img.filename || 'Attachment'}
                      class="w-16 h-16 object-cover rounded-xl border border-white/30 shadow-sm"
                    />
                    <button
                      class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                      onClick={() => removeImage(img.id)}
                      title="Remove image"
                    >
                      <span class="material-symbols-outlined" style="font-size: 12px">close</span>
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="flex items-center gap-1">
            {/* Image upload button */}
            <button
              class="size-10 rounded-full flex items-center justify-center shrink-0 text-text-muted/60 hover:text-text-muted hover:bg-white/10 transition-colors"
              onClick={openFilePicker}
              title="Attach image"
            >
              <span class="material-symbols-outlined text-[20px]">add_photo_alternate</span>
            </button>

            <textarea
              ref={textareaRef}
              value={inputValue()}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={props.placeholder || 'Send a message...'}
              rows={1}
              class="bg-transparent border-none focus:ring-0 focus:outline-none text-text-primary placeholder-text-muted/70 text-[15px] resize-none overflow-y-auto leading-normal p-0 m-0 flex-1 min-w-0 self-center"
              style={{ "max-height": "160px", padding: "4px 12px" }}
            />

            {/* Stop button */}
            <Show when={showStop()}>
              <button
                class="size-10 rounded-full transition-all shadow-md flex items-center justify-center shrink-0 bg-red-500/20 text-red-400 hover:bg-red-500/30 active:scale-95"
                onClick={() => props.onStop?.()}
                title="Stop generating (Esc)"
              >
                <span class="material-symbols-outlined text-[18px]">stop</span>
              </button>
            </Show>

            {/* Send button */}
            <button
              class={`text-white size-10 rounded-full transition-all shadow-md flex items-center justify-center shrink-0 ${
                canSend()
                  ? 'bg-primary shadow-primary/30 hover:bg-primary/90 active:scale-95'
                  : 'bg-secondary shadow-secondary/30'
              }`}
              onClick={handleSend}
              disabled={!canSend()}
              title="Send message"
            >
              <Icon name="arrow_upward" size="md" />
            </button>
          </div>
        </div>
      </div>

      {/* Image preview modal */}
      <Show when={previewUrl()}>
        <ImagePreviewModal url={previewUrl()!} onClose={() => setPreviewUrl(null)} />
      </Show>
    </Card>
  );
};

export default ChatPanel;
export { ChatPanel };
