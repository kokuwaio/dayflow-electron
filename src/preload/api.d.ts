import type { GoalPlan } from '../shared/day-summary'
import type { FrameRef } from '../shared/media'
import type { DayCards, Week } from '../shared/week'
import type { AppStatus, CardEdit, CliName, ProviderKind, Rating, Settings, TimelineCard } from '../shared/types'

/** The API the preload script exposes to the renderer as window.dayflow. */
export interface DayflowApi {
  getWeek(day: string): Promise<Week & { columns: DayCards[]; ratings: Rating[] }>
  getGoals(day: string): Promise<GoalPlan>
  setGoals(day: string, plan: GoalPlan): Promise<void>
  copyTimeline(mode: 'day' | 'week', day: string): Promise<void>
  exportMarkdown(from: string, to: string): Promise<{ ok: boolean; message: string }>
  getFrames(span: { start: number; end: number }): Promise<FrameRef[]>
  completeOnboarding(): Promise<void>
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
  runAnalysis(): Promise<void>
  checkCli(cli: CliName): Promise<{ ok: boolean; message: string }>
  onCardsChanged(cb: () => void): () => void
  onStatus(cb: (status: AppStatus) => void): () => void
}

declare global {
  interface Window {
    dayflow: DayflowApi
  }
}
