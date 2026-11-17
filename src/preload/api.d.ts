import type { AppStatus, CliName, ProviderKind, Settings, TimelineCard } from '../shared/types'

/** The API the preload script exposes to the renderer as window.dayflow. */
export interface DayflowApi {
  getDay(day?: string): Promise<{ day: string; cards: TimelineCard[] }>
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
