import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatBlocks, visibleStreamingText } from '@shared/chat-content'
import { historyGroups } from '@shared/chat-history'
import type { FeatureAccess } from '@shared/daily'
import { formatClock, todayKey } from '@shared/day'
import type { ChatConversation, ChatStoredMessage, ProviderKind } from '@shared/types'
import {
  ArrowUp,
  ArrowUpRight,
  BadgeCheck,
  Brain,
  Check,
  CircleCheck,
  Copy,
  FileText,
  History as HistoryIcon,
  type LucideIcon,
  MessageSquareText,
  MessageSquareWarning,
  MessagesSquare,
  Sparkles,
  Trash2,
  Wrench,
  Zap
} from 'lucide-react'
import { ChatChart } from './ChatChart'
import { ProgressBar } from './LockedFeature'
import { PROVIDER_CHOICES } from './providers'

/** Upstream's welcome prompts and their icons (Views/UI/ChatView+State.swift). */
const WELCOME_PROMPTS: Array<{ text: string; icon: LucideIcon }> = [
  { text: 'Generate standup notes for yesterday', icon: FileText },
  { text: 'What did I get done last week?', icon: BadgeCheck },
  { text: 'When was I most focused this week', icon: MessageSquareWarning },
  { text: 'Compare this week to last week', icon: Sparkles }
]

type Status = 'thinking' | 'tools' | 'answering'
const STATUS_TEXT: Record<Status, string> = { thinking: 'Thinking', tools: 'Running tools', answering: 'Answering' }
const STATUS_ICON: Record<Status, LucideIcon> = { thinking: Sparkles, tools: Wrench, answering: MessageSquareText }
type Panel = 'history' | 'memory' | null
const MEMORY_MAX = 10_000
const providerLabel = (kind: string) => PROVIDER_CHOICES.find((p) => p.kind === kind)?.label ?? kind

/** The Chat tab (upstream ChatView): questions about your timeline, answered with the timeline tools. */
export function Chat() {
  const [access, setAccess] = useState<FeatureAccess | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatStoredMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [panel, setPanel] = useState<Panel>(null)
  const [history, setHistory] = useState<ChatConversation[]>([])
  const [toolNote, setToolNote] = useState<string | null>(null)
  const [providers, setProviders] = useState<ProviderKind[]>([])
  const [provider, setProvider] = useState<ProviderKind | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => void window.dayflow.getAccess().then((a) => setAccess(a.chat)), [])
  useEffect(
    () =>
      void window.dayflow.getChatProviders().then((kinds) => {
        setProviders(kinds)
        setProvider((p) => p ?? kinds[0] ?? null)
      }),
    []
  )
  const loadHistory = useCallback(() => void window.dayflow.getConversations().then(setHistory), [])
  useEffect(loadHistory, [loadHistory])
  useEffect(
    () =>
      window.dayflow.onChatEvent((event) => {
        if (event.type === 'reset') {
          // A fallback provider starts over.
          setStreaming('')
          setToolNote(null)
          setStatus('thinking')
        } else if (event.type === 'text') {
          setStatus('answering')
          setStreaming((s) => s + event.delta)
        } else if (event.type === 'tool-start') {
          setStatus('tools')
        } else {
          setToolNote(event.summary)
          setStatus('thinking')
        }
      }),
    []
  )
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages, streaming, status, toolNote])

  const open = async (id: string | null) => {
    setConversationId(id)
    setSuggestions([])
    setError(null)
    setMessages(id ? await window.dayflow.getChatMessages(id) : [])
  }

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || status) return
    setInput('')
    setError(null)
    setSuggestions([])
    setStreaming('')
    setToolNote(null)
    setStatus('thinking')
    setMessages((m) => [...m, { id: `pending-${m.length}`, role: 'user', content: question, createdAt: Date.now() / 1000 }])
    const result = await window.dayflow.sendChat(conversationId, question, provider ?? undefined)
    setStatus(null)
    setStreaming('')
    setToolNote(null)
    if (!result.ok) {
      // A failed answer is kept in the conversation like upstream ("I encountered an error: …").
      if (result.conversationId) {
        setConversationId(result.conversationId)
        setMessages(await window.dayflow.getChatMessages(result.conversationId))
        loadHistory()
      } else setError(result.message)
      return
    }
    setConversationId(result.reply.conversationId)
    setMessages(await window.dayflow.getChatMessages(result.reply.conversationId))
    setSuggestions(result.reply.suggestions)
    loadHistory()
  }

  if (!access) return null
  if (!access.unlocked) {
    return (
      <div className="locked-page">
        <div className="locked-card">
          <h2>
            Unlock Beta<span className="beta">BETA</span>
          </h2>
          <p>Chat lets you ask questions about your Dayflow activity and get summaries, comparisons, and insights.</p>
          <ul className="requirements">
            <li>
              <Zap size={18} color="var(--accent-icon)" />
              <div>
                <strong>10 hours of timeline data required</strong>
                <span className="note">Chat unlocks after Dayflow has analyzed enough activity. {access.label}</span>
              </div>
            </li>
            <li>
              {providers.length ? <CircleCheck size={18} color="#34C759" /> : <Zap size={18} color="var(--accent-icon)" />}
              <div>
                <strong>{providers.length ? 'AI provider configured' : 'AI provider required'}</strong>
                {!providers.length && <span className="note">Unlock chat by adding an AI provider in Settings.</span>}
              </div>
            </li>
          </ul>
          <ProgressBar value={access.progress} label="Chat unlock progress" text={access.label} />
          <button className="btn-primary" disabled>
            Keep recording to unlock
          </button>
          <p className="note">
            <strong>Privacy note:</strong> your questions and the answers stay on this computer; only the provider you chose sees them.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat">
      <div className="chat-main">
        <div className="chat-header">
          <button className="soft" onClick={() => void open(null)} disabled={!!status}>
            New chat
          </button>
          <button className={`icon ${panel === 'history' ? 'on' : ''}`} aria-label="History" title="History" onClick={() => setPanel(panel === 'history' ? null : 'history')}>
            <HistoryIcon size={14} />
          </button>
          <button className={`icon ${panel === 'memory' ? 'on' : ''}`} aria-label="Memory" title="Memory" onClick={() => setPanel(panel === 'memory' ? null : 'memory')}>
            <Brain size={14} />
          </button>
        </div>
        <div className="chat-scroll">
          {messages.length === 0 && !status ? (
            <Welcome onPick={(p) => void send(p)} />
          ) : (
            <div className="chat-messages">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
              {streaming && <AssistantText text={visibleStreamingText(streaming)} />}
              {status && (
                <div className="chat-status">
                  {(() => {
                    const Icon = STATUS_ICON[status]
                    return <Icon size={13} color="var(--accent)" />
                  })()}
                  {STATUS_TEXT[status]}
                  <span className="dots" />
                  {toolNote && <div className="note">{toolNote}</div>}
                </div>
              )}
              {error && <p className="error">{error}</p>}
              {suggestions.length > 0 && (
                <div className="chat-suggestions">
                  <span className="note">Follow up</span>
                  {suggestions.map((s) => (
                    // Upstream fills the composer instead of sending, so the question can be edited.
                    <button key={s} className="chip" onClick={() => setInput(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={bottom} />
            </div>
          )}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <textarea
            value={input}
            rows={2}
            placeholder="Ask about your Dayflow data..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
          />
          <div className="chat-composer-tools">
            {providers.length > 1 && (
              <div className="pills" role="radiogroup" aria-label="Provider">
                {providers.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={provider === kind}
                    className={provider === kind ? 'on' : ''}
                    onClick={() => setProvider(kind)}
                  >
                    {providerLabel(kind)}
                  </button>
                ))}
              </div>
            )}
            <button type="submit" className="send" aria-label="Send" disabled={!input.trim() || !!status}>
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          </div>
        </form>
      </div>
      {panel === 'history' && (
        <History
          conversations={history}
          current={conversationId}
          onOpen={(id) => void open(id)}
          onDelete={async (id) => {
            await window.dayflow.deleteConversation(id)
            if (id === conversationId) void open(null)
            loadHistory()
          }}
        />
      )}
      {panel === 'memory' && <Memory />}
    </div>
  )
}

function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-head">
        <span className="bubble-icon">
          <MessagesSquare size={18} />
        </span>
        <div>
          <h2>Ask about your Dayflow data</h2>
          <p>Ask questions, analyze your timeline, and generate charts/graphs.</p>
          <p className="note">I remember your response preferences, so feel free to teach me your style.</p>
        </div>
      </div>
      <p className="note">Try one of these</p>
      {WELCOME_PROMPTS.map(({ text, icon: Icon }) => (
        <button key={text} className="chat-prompt" onClick={() => onPick(text)}>
          <span className="lead">
            <Icon size={13} />
          </span>
          <span className="text">{text}</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

function Message({ message }: { message: ChatStoredMessage }) {
  if (message.role === 'user') return <div className="chat-bubble user">{message.content}</div>
  if (message.role === 'toolCall')
    return (
      <div className="chat-tool">
        <Wrench size={12} aria-hidden="true" />
        {message.content}
      </div>
    )
  return <AssistantText text={message.content} copyable />
}

/** Markdown with chart blocks; raw HTML in answers is shown as text, never rendered. */
function AssistantText({ text, copyable }: { text: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="chat-bubble assistant">
      {chatBlocks(text).map((block, i) =>
        block.kind === 'chart' ? (
          <ChatChart key={i} spec={block.chart} />
        ) : (
          <Markdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}
          >
            {block.text}
          </Markdown>
        )
      )}
      {copyable && (
        <div className="chat-bubble-footer">
          <button
            aria-label="Copy answer"
            title="Copy"
            onClick={() =>
              void window.dayflow.copyText(text).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      )}
    </div>
  )
}

/** Conversations grouped like upstream: today, yesterday, this week, earlier. */
function History(props: { conversations: ChatConversation[]; current: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const groups = historyGroups(props.conversations, todayKey())
  return (
    <aside className="chat-side">
      <h3>History</h3>
      {groups.length === 0 && <p className="note">No saved chats yet</p>}
      {groups.map((g) => (
        <section key={g.name}>
          <h4>{g.name}</h4>
          {g.items.map((c) => (
            <div key={c.id} className={`chat-history-row ${c.id === props.current ? 'current' : ''}`}>
              <button className="link" onClick={() => props.onOpen(c.id)} title={c.title}>
                <span className="title">{c.title}</span>
                <span className="note">
                  {formatClock(c.updatedAt)} · {providerLabel(c.provider)}
                </span>
              </button>
              <button className="delete" aria-label={`Delete ${c.title}`} onClick={() => props.onDelete(c.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
      ))}
    </aside>
  )
}

/** What the assistant remembers about you; it updates this itself from its memory blocks. */
function Memory() {
  const [memory, setMemory] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => void window.dayflow.getChatMemory().then(setMemory), [])
  if (memory === null) return null
  const save = async (next: string) => {
    await window.dayflow.saveChatMemory(next)
    setMemory(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <aside className="chat-side memory">
      <h3>Memory</h3>
      <p className="note">Auto-updated from assistant replies. You can edit this manually.</p>
      <textarea rows={8} maxLength={MEMORY_MAX} value={memory} placeholder="Profile: …&#10;Style: …" onChange={(e) => setMemory(e.target.value)} />
      <p className="note">
        {memory.length}/{MEMORY_MAX}
      </p>
      <div className="row">
        <button onClick={() => void save(memory)}>{saved ? 'Saved' : 'Save'}</button>
        <button className="link" onClick={() => void save('')}>
          Clear memory
        </button>
      </div>
    </aside>
  )
}
