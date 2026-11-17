import type { AppStatus, CardEdit, CliName, ProviderKind, Rating, Settings, TimelineCard } from '../shared/types'

/** The API the preload script exposes to the renderer as window.dayflow. */
export interface DayflowApi {
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
