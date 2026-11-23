import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatBlocks, visibleStreamingText } from '@shared/chat-content'
import { historyGroups } from '@shared/chat-history'
import type { FeatureAccess } from '@shared/daily'
import { todayKey } from '@shared/day'
import { clockLabel } from '@shared/i18n'
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
import { providerChoices } from './providers'

/** Upstream's welcome prompts and their icons (Views/UI/ChatView+State.swift). */
const WELCOME_PROMPTS = [
  { id: 'standup', icon: FileText },
  { id: 'lastWeek', icon: BadgeCheck },
  { id: 'focused', icon: MessageSquareWarning },
  { id: 'compare', icon: Sparkles }
] as const satisfies ReadonlyArray<{ id: string; icon: LucideIcon }>

type Status = 'thinking' | 'tools' | 'answering'
/** The history panel's groups (from historyGroups) and their text keys. */
const GROUP_KEYS = { TODAY: 'today', YESTERDAY: 'yesterday', 'THIS WEEK': 'thisWeek', EARLIER: 'earlier' } as const
const STATUS_ICON: Record<Status, LucideIcon> = { thinking: Sparkles, tools: Wrench, answering: MessageSquareText }
type Panel = 'history' | 'memory' | null
const MEMORY_MAX = 10_000
const providerLabel = (kind: string) => providerChoices().find((p) => p.kind === kind)?.label ?? kind

/** The Chat tab (upstream ChatView): questions about your timeline, answered with the timeline tools. */
export function Chat() {
  const { t } = useTranslation()
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
  // A block body: Chromium's scrollIntoView returns a Promise, which React would call as the cleanup and crash.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming, status, toolNote])

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
            {t('chat.locked.title')}
            <span className="beta">{t('chat.locked.beta')}</span>
          </h2>
          <p>{t('chat.locked.intro')}</p>
          <ul className="requirements">
            <li>
              <Zap size={18} color="var(--accent-icon)" />
              <div>
                <strong>{t('chat.locked.dataRequired')}</strong>
                <span className="note">{t('chat.locked.dataNote', { progress: access.label })}</span>
              </div>
            </li>
            <li>
              {providers.length ? <CircleCheck size={18} color="#34C759" /> : <Zap size={18} color="var(--accent-icon)" />}
              <div>
                <strong>{providers.length ? t('chat.locked.providerConfigured') : t('chat.locked.providerRequired')}</strong>
                {!providers.length && <span className="note">{t('chat.locked.providerNote')}</span>}
              </div>
            </li>
          </ul>
          <ProgressBar value={access.progress} label={t('chat.locked.progress')} text={access.label} />
          <button className="btn-primary" disabled>
            {t('chat.locked.keepRecording')}
          </button>
          <p className="note">
            <Trans i18nKey="chat.locked.privacy" components={{ b: <strong /> }} />
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
            {t('chat.newChat')}
          </button>
          <button className={`icon ${panel === 'history' ? 'on' : ''}`} aria-label={t('chat.history.title')} title={t('chat.history.title')} onClick={() => setPanel(panel === 'history' ? null : 'history')}>
            <HistoryIcon size={14} />
          </button>
          <button className={`icon ${panel === 'memory' ? 'on' : ''}`} aria-label={t('chat.memory.title')} title={t('chat.memory.title')} onClick={() => setPanel(panel === 'memory' ? null : 'memory')}>
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
                  {t(`chat.status.${status}`)}
                  <span className="dots" />
                  {toolNote && <div className="note">{toolNote}</div>}
                </div>
              )}
              {error && <p className="error">{error}</p>}
              {suggestions.length > 0 && (
                <div className="chat-suggestions">
                  <span className="note">{t('chat.followUp')}</span>
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
            placeholder={t('chat.placeholder')}
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
              <div className="pills" role="radiogroup" aria-label={t('chat.provider')}>
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
            <button type="submit" className="send" aria-label={t('chat.send')} disabled={!input.trim() || !!status}>
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
  const { t } = useTranslation()
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-head">
        <span className="bubble-icon">
          <MessagesSquare size={18} />
        </span>
        <div>
          <h2>{t('chat.welcome.title')}</h2>
          <p>{t('chat.welcome.intro')}</p>
          <p className="note">{t('chat.welcome.memory')}</p>
        </div>
      </div>
      <p className="note">{t('chat.welcome.try')}</p>
      {WELCOME_PROMPTS.map(({ id, icon: Icon }) => {
        const text = t(`chat.welcome.prompts.${id}`)
        return (
          <button key={id} className="chat-prompt" onClick={() => onPick(text)}>
            <span className="lead">
              <Icon size={13} />
            </span>
            <span className="text">{text}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        )
      })}
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
  const { t } = useTranslation()
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
            aria-label={t('chat.copyAnswer')}
            title={t('common.copy')}
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
  const { t } = useTranslation()
  const groups = historyGroups(props.conversations, todayKey())
  return (
    <aside className="chat-side">
      <h3>{t('chat.history.title')}</h3>
      {groups.length === 0 && <p className="note">{t('chat.history.empty')}</p>}
      {groups.map((g) => (
        <section key={g.name}>
          <h4>{t(`chat.history.groups.${GROUP_KEYS[g.name]}`)}</h4>
          {g.items.map((c) => (
            <div key={c.id} className={`chat-history-row ${c.id === props.current ? 'current' : ''}`}>
              <button className="link" onClick={() => props.onOpen(c.id)} title={c.title}>
                <span className="title">{c.title}</span>
                <span className="note">
                  {clockLabel(c.updatedAt)} · {providerLabel(c.provider)}
                </span>
              </button>
              <button className="delete" aria-label={t('chat.history.delete', { title: c.title })} onClick={() => props.onDelete(c.id)}>
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
  const { t } = useTranslation()
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
      <h3>{t('chat.memory.title')}</h3>
      <p className="note">{t('chat.memory.note')}</p>
      <textarea rows={8} maxLength={MEMORY_MAX} value={memory} placeholder="Profile: …&#10;Style: …" onChange={(e) => setMemory(e.target.value)} />
      <p className="note">
        {memory.length}/{MEMORY_MAX}
      </p>
      <div className="row">
        <button onClick={() => void save(memory)}>{saved ? t('common.saved') : t('common.save')}</button>
        <button className="link" onClick={() => void save('')}>
          {t('chat.memory.clear')}
        </button>
      </div>
    </aside>
  )
}
