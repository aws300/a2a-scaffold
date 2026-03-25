/**
 * A2A Scaffold — Standalone A2A Agent Server with chat UI.
 * 
 * Features:
 * - Single-page chat connected to A2A backend
 * - Image paste/upload (via ChatPanel)
 * - Single file upload to agent workspace
 * - Agent configuration editor (name, description, provider)
 * - /.well-known/agent-card.json auto-generated from config + skills
 */
import { render } from 'solid-js/web';
import { Component, createSignal, Show, For, onMount } from 'solid-js';
import { setGuestMode, _lfA2aClient } from '@/api/client';
import { Role, TaskState } from '@/gen/lf/a2a/v1/a2a_pb';
import { ChatPanel, type ChatMessage } from '@/components/chat/ChatPanel';
import type { ImageAttachment } from '@/components/chat/ChatPanel';
import { buildRequestParts, resizeImages } from '@/lib/image-utils';
import { parseStreamResponse } from '@/lib/agui-adapter';
import { EventType } from '@/lib/useAgentStream';
import '@/styles/index.css';

setGuestMode(true);

// ============================================================================
// Types
// ============================================================================

interface AgentConfig {
  name: string;
  system_prompt: string;
  description?: string;
  version: string;
  provider?: { organization: string; url?: string };
  iconUrl?: string;
  documentationUrl?: string;
  skills?: Array<{ id: string; name: string; description: string; tags: string[] }>;
  _scannedSkills?: Array<{ id: string; name: string; description: string; tags: string[] }>;
  _agentMd?: string;
}

interface UploadedFile {
  name: string;
  path: string;
  size: number;
}

// ============================================================================
// Agent Editor Dialog
// ============================================================================

const AgentEditor: Component<{
  config: AgentConfig;
  onSave: (cfg: AgentConfig) => void;
  onClose: () => void;
}> = (props) => {
  const [name, setName] = createSignal(props.config.name || '');
  const [systemPrompt, setSystemPrompt] = createSignal(props.config.system_prompt || '');
  const [version, setVersion] = createSignal(props.config.version || '1.0.0');
  const [org, setOrg] = createSignal(props.config.provider?.organization || '');
  const [orgUrl, setOrgUrl] = createSignal(props.config.provider?.url || '');

  const handleSave = () => {
    props.onSave({
      ...props.config,
      name: name(),
      system_prompt: systemPrompt(),
      version: version(),
      provider: { organization: org(), url: orgUrl() || undefined },
    });
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={props.onClose} />
      <div class="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px] text-blue-600">smart_toy</span>
            <h2 class="text-base font-bold text-gray-900">Agent Configuration</h2>
          </div>
          <button class="p-1 rounded-md hover:bg-gray-100" onClick={props.onClose}>
            <span class="material-symbols-outlined text-[18px] text-gray-400">close</span>
          </button>
        </div>
        {/* Form */}
        <div class="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Agent Name *</label>
            <input class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-blue-400 focus:outline-none" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="My A2A Agent" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">System Prompt</label>
            <p class="text-xs text-gray-400 mb-1.5">The body of AGENT.md — defines this agent's behavior and capabilities.</p>
            <textarea class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:border-blue-400 focus:outline-none resize-none" rows={6} value={systemPrompt()} onInput={(e) => setSystemPrompt(e.currentTarget.value)} placeholder="You are a helpful coding assistant..." />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Version</label>
              <input class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-blue-400 focus:outline-none" value={version()} onInput={(e) => setVersion(e.currentTarget.value)} placeholder="1.0.0" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Organization</label>
              <input class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-blue-400 focus:outline-none" value={org()} onInput={(e) => setOrg(e.currentTarget.value)} placeholder="My Company" />
            </div>
          </div>
          {/* Scanned skills info */}
          <Show when={props.config._scannedSkills && props.config._scannedSkills.length > 0}>
            <div>
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Detected Skills ({props.config._scannedSkills?.length})</label>
              <div class="flex flex-wrap gap-1.5">
                <For each={props.config._scannedSkills}>
                  {(skill) => (
                    <span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs border border-blue-100">{skill.name}</span>
                  )}
                </For>
              </div>
              <p class="text-xs text-gray-400 mt-1">Skills are auto-detected from .md files in /agent/config/skills/</p>
            </div>
          </Show>
        </div>
        {/* Footer */}
        <div class="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <a href="/.well-known/agent-card.json" target="_blank" class="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            <span class="material-symbols-outlined text-[14px]">link</span>
            agent-card.json
          </a>
          <div class="flex items-center gap-2">
            <button class="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100" onClick={props.onClose}>Cancel</button>
            <button class="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all" onClick={handleSave} disabled={!name().trim()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// File upload bar
// ============================================================================

const FileUploadBar: Component<{ onUploaded: (files: UploadedFile[]) => void }> = (props) => {
  const [uploading, setUploading] = createSignal(false);
  const [lastUploaded, setLastUploaded] = createSignal<UploadedFile[]>([]);
  let fileInputRef: HTMLInputElement | undefined;

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('files', file, file.name);
      const resp = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.files) { setLastUploaded(data.files); props.onUploaded(data.files); }
    } catch (err) { console.error('Upload failed:', err); }
    finally { setUploading(false); }
  };

  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) uploadFile(input.files[0]);
    input.value = '';
  };

  return (
    <div class="flex items-center gap-2">
      <input ref={fileInputRef} type="file" class="hidden" onChange={handleFileChange} />
      <button class="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors" onClick={() => fileInputRef?.click()} disabled={uploading()}>
        <span class="material-symbols-outlined text-[16px]">upload_file</span>
        Upload
      </button>
      <Show when={uploading()}>
        <div class="flex items-center gap-1 text-xs text-gray-400">
          <div class="animate-spin w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full" />
        </div>
      </Show>
      <Show when={!uploading() && lastUploaded().length > 0}>
        <span class="text-xs text-green-600 flex items-center gap-0.5">
          <span class="material-symbols-outlined text-[13px]">check</span>
          {lastUploaded()[0].name}
        </span>
      </Show>
    </div>
  );
};

// ============================================================================
// Main
// ============================================================================

const ScaffoldChat: Component = () => {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [isSending, setIsSending] = createSignal(false);
  const [sessionId] = createSignal(`scaffold-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const [showEditor, setShowEditor] = createSignal(false);
  const [agentConfig, setAgentConfig] = createSignal<AgentConfig>({ name: 'A2A Agent', system_prompt: '', version: '1.0.0' });
  const [agentName, setAgentName] = createSignal('A2A Scaffold');
  let abortController: AbortController | null = null;

  // Load agent config on mount
  onMount(async () => {
    try {
      const resp = await fetch('/api/agent');
      if (resp.ok) {
        const cfg = await resp.json();
        setAgentConfig(cfg);
        setAgentName(cfg.name || 'A2A Scaffold');
      }
    } catch {}
  });

  const handleSaveConfig = async (cfg: AgentConfig) => {
    try {
      await fetch('/api/agent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
      setAgentConfig(cfg);
      setAgentName(cfg.name || 'A2A Scaffold');
      setShowEditor(false);
    } catch (err) { console.error('Save failed:', err); }
  };

  const handleSend = async (text: string, images?: ImageAttachment[]) => {
    setIsSending(true);
    abortController = new AbortController();
    const processedImages = images ? await resizeImages(images) : undefined;
    const assistantMsgId = `assistant-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date(), images: processedImages },
      { id: assistantMsgId, role: 'assistant', content: '', timestamp: new Date() },
    ]);
    let accumulatedText = '';
    try {
      for await (const event of _lfA2aClient.sendStreamingMessage({
        message: { contextId: sessionId(), taskId: sessionId(), role: Role.USER, parts: buildRequestParts(text, processedImages), metadata: { project_id: '' } },
      }, { signal: abortController.signal })) {
        const { events: aguiEvents, textChunks } = parseStreamResponse(event);
        let runEnded = false;
        for (const e of aguiEvents) { if (e.type === EventType.RUN_FINISHED || e.type === EventType.RUN_ERROR) runEnded = true; }
        if (runEnded) break;
        for (const chunk of textChunks) { accumulatedText += chunk; setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: accumulatedText } : m)); }
        if (event.payload.case === 'statusUpdate' && event.payload.value.status?.state === TaskState.FAILED) throw new Error('Agent failure');
      }
    } catch (err: any) {
      if (!abortController?.signal.aborted) setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: m.content || `Error: ${err.message}` } : m));
    } finally { abortController = null; setIsSending(false); }
  };

  const handleStop = () => { abortController?.abort(); setIsSending(false); };
  const clearChat = () => setMessages([]);
  const handleFilesUploaded = (files: UploadedFile[]) => {
    setMessages(prev => [...prev, {
      id: `sys-${Date.now()}`, role: 'assistant', timestamp: new Date(),
      content: `📁 **File uploaded:** \`${files[0].name}\` (${formatSize(files[0].size)})\n_Available at ${files[0].path}_`,
    }]);
  };

  return (
    <div class="h-screen flex flex-col bg-gradient-to-br from-blue-50/30 via-white to-purple-50/20">
      {/* Top bar */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100 shrink-0">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[20px] text-blue-600">smart_toy</span>
          <span class="text-sm font-semibold text-gray-800">{agentName()}</span>
        </div>
        <div class="flex items-center gap-2">
          <FileUploadBar onUploaded={handleFilesUploaded} />
          <div class="w-px h-4 bg-gray-200" />
          <a href="/.well-known/agent-card.json" target="_blank" class="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors" title="View agent-card.json">
            <span class="material-symbols-outlined text-[18px]">link</span>
          </a>
          <button class="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors" onClick={() => setShowEditor(true)} title="Edit Agent">
            <span class="material-symbols-outlined text-[18px]">settings</span>
          </button>
        </div>
      </div>
      {/* Chat */}
      <ChatPanel
        messages={messages()}
        isSending={isSending()}
        onSend={handleSend}
        onStop={handleStop}
        onClear={clearChat}
        headerTitle={agentName()}
        placeholder="Type a message..."
        emptyTitle={agentName()}
        emptyDescription={<>A standalone A2A agent. Upload files or type a message to start.</>}
      />
      {/* Agent editor dialog */}
      <Show when={showEditor()}>
        <AgentEditor config={agentConfig()} onSave={handleSaveConfig} onClose={() => setShowEditor(false)} />
      </Show>
    </div>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const root = document.getElementById('root');
if (root) render(() => <ScaffoldChat />, root);
