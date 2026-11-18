import type { Feature, FeatureAccess, StandupDraft } from '../shared/daily'
import type { GoalPlan } from '../shared/day-summary'
import type { GoalContext } from '../shared/goal-flow'
import type { ReviewRating, ReviewSegment } from '../shared/review'
import type { FrameRef } from '../shared/media'
import type { Language } from '../shared/languages'
import type { UpdateMode } from '../shared/updates'
import type { ScreenPermission, WindowCheck } from '../shared/permissions'
import type { RecordingCheck } from '../shared/recording-status'
import type { InstalledApps } from '../shared/installed-apps'
import type { DayCards, Week } from '../shared/week'
import type { DailyProviderOption } from '../shared/daily-provider'
import type { GettingStarted } from '../shared/getting-started'
import type {
  AgentAccessInfo,
  AgentClient,
  AgentClientState,
  AppStatus,
  CardEdit,
  ChatConversation,
  ChatEvent,
  ChatReply,
  ChatStoredMessage,
  CliName,
  ProviderKind,
  Rating,
  Settings,
  StandupEntry,
  Tab,
  TimelineCard
} from '../shared/types'

/** The API the preload script exposes to the renderer as window.dayflow. */
export interface DayflowApi {
  getWeek(day: string): Promise<Week & { columns: DayCards[]; ratings: Rating[] }>
  getGoals(day: string): Promise<GoalPlan>
  setGoals(day: string, plan: GoalPlan): Promise<void>
  getGoalContext(day: string): Promise<GoalContext>
  getReview(day: string): Promise<{ segments: ReviewSegment[]; toReview: number }>
  rateReview(span: { start: number; end: number }, rating: ReviewRating): Promise<void>
  copyTimeline(mode: 'day' | 'week', day: string): Promise<void>
  copyText(text: string): Promise<void>
  exportMarkdown(from: string, to: string): Promise<{ ok: boolean; message: string }>
  getFrames(span: { start: number; end: number }): Promise<FrameRef[]>
  completeOnboarding(): Promise<void>
  /** Whether screen capture may run without asking (macOS permission, Linux restore token). */
  getScreenPermission(): Promise<ScreenPermission>
  /** Asks now: macOS prompt and Screen Recording settings, Linux share dialog. Resolves when done. */
  requestScreenPermission(): Promise<{ ok: boolean; message: string }>
  /** Quits and starts the app again (macOS applies Screen Recording only then). */
  relaunch(): Promise<void>
  /** Runs window detection once (takes up to 10 s). */
  checkWindowDetection(): Promise<WindowCheck>
  getAccess(): Promise<Record<Feature, FeatureAccess>>
  getStandup(day: string): Promise<StandupEntry | null>
  generateStandup(day: string): Promise<{ ok: true; entry: StandupEntry } | { ok: false; message: string }>
  saveStandup(day: string, draft: StandupDraft): Promise<void>
  onNavigate(cb: (tab: Tab) => void): () => void
  onDailyChanged(cb: () => void): () => void
  /** Daily's provider picker: every provider kind and whether it can write a standup now (CLIs are looked up). */
  getDailyProviders(): Promise<DailyProviderOption[]>
  /** Whether a recap the scheduler wrote waits unseen (the dot on the Daily icon). */
  getDailyBadge(): Promise<boolean>
  onDailyBadge(cb: (pending: boolean) => void): () => void
  /** Tells the main process which tab is on screen (the Daily badge clears on Daily). */
  reportView(tab: Tab): void
  /** The first-day guide, and whether the timeline has model-written cards yet. */
  getGettingStarted(): Promise<{ guide: GettingStarted; hasCards: boolean }>
  updateGettingStarted(patch: Partial<Pick<GettingStarted, 'tourPending' | 'openedCard' | 'dismissed' | 'collapsed'>>): Promise<GettingStarted>
  /** Settings → Other → Show again: the tour and a fresh week of the checklist. */
  replayGettingStarted(): Promise<GettingStarted>
  onGettingStarted(cb: (guide: GettingStarted) => void): () => void
  /** Back through onboarding without deleting anything; the window reloads into it. */
  resetOnboarding(): Promise<void>
  /** The app version (1.2.3, or 0.0.0-<branch>.g<sha> for development builds). */
  getVersion(): Promise<string>
  /** Whether this build updates itself: "install", "notify" (unsigned macOS) or "off" (Flatpak, development builds). */
  getUpdateSupport(): Promise<UpdateMode>
  getConversations(): Promise<ChatConversation[]>
  getChatMessages(conversationId: string): Promise<ChatStoredMessage[]>
  deleteConversation(conversationId: string): Promise<void>
  /** Answers in the given conversation, or a new one for null; progress arrives through onChatEvent. */
  sendChat(
    conversationId: string | null,
    text: string,
    preferred?: ProviderKind
  ): Promise<{ ok: true; reply: ChatReply } | { ok: false; message: string; conversationId?: string | null }>
  /** The configured providers, main one first. */
  getChatProviders(): Promise<ProviderKind[]>
  getChatMemory(): Promise<string>
  saveChatMemory(memory: string): Promise<void>
  onChatEvent(cb: (event: ChatEvent) => void): () => void
  getWeekly(day: string): Promise<{ week: Week; cards: TimelineCard[]; previous: TimelineCard[] }>
  getWeeklyDefaultDay(): Promise<string>
  getDay(day?: string): Promise<{ day: string; cards: TimelineCard[]; ratings: Rating[] }>
  updateCard(id: number, change: CardEdit): Promise<TimelineCard | undefined>
  deleteCard(id: number): Promise<void>
  rateCard(span: { start: number; end: number }, rating: Rating['rating'], feedback?: string): Promise<void>
  /** Analyzes a batch again (retries a failed one); false while it is being analyzed. */
  reprocessBatch(batchId: number): Promise<boolean>
  reprocessDay(day: string): Promise<number>
  getStatus(): Promise<AppStatus>
  getSettings(): Promise<Settings>
  saveSettings(next: Partial<Settings>): Promise<Settings>
  setApiKey(kind: ProviderKind, key: string): Promise<void>
  testProvider(): Promise<{ ok: boolean; message: string }>
  pause(seconds: number | null): Promise<void>
  resume(): Promise<void>
  openRecordings(): Promise<string>
  /** Copies the debug report (Settings → Other → Support) to the clipboard. */
  copyDebugLogs(): Promise<void>
  /** Opens logs/ in the data folder; resolves to an error message, or '' on success. */
  openLogFolder(): Promise<string>
  /** Disk use and the recording status check of Settings → Storage; run: purge over the limit first ("Run status check"). */
  checkStorage(run: boolean): Promise<{ check: RecordingCheck; framesBytes: number; observedBytesPerHour: number | null }>
  /** Installed apps to block, and inside the Flatpak the command that shows them. */
  getInstalledApps(): Promise<InstalledApps>
  runAnalysis(): Promise<void>
  checkCli(cli: CliName): Promise<{ ok: boolean; message: string }>
  /** How AI tools and terminals start the bundled CLI. */
  getAgentAccess(): Promise<AgentAccessInfo>
  /** Looks up, adds or removes the "dayflow-electron" MCP server in an AI tool; for Cursor and VS Code "connect" opens their install link. */
  agentClient(client: AgentClient, action: 'status' | 'connect' | 'disconnect'): Promise<AgentClientState>
  onCardsChanged(cb: () => void): () => void
  onStatus(cb: (status: AppStatus) => void): () => void
  /** The app language changed (Settings → Other → App language): the resolved language to show. */
  onLanguage(cb: (language: Language) => void): () => void
}

declare global {
  interface Window {
    dayflow: DayflowApi
  }
}
