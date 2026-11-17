import { contextBridge, ipcRenderer } from 'electron'
import type { DayflowApi } from './api'

const api: DayflowApi = {
  getDay: (day) => ipcRenderer.invoke('day:get', day),
  getFrames: (span) => ipcRenderer.invoke('frames:get', span),
  completeOnboarding: () => ipcRenderer.invoke('onboarding:complete'),
  getWeek: (day) => ipcRenderer.invoke('week:get', day),
  getGoals: (day) => ipcRenderer.invoke('goals:get', day),
  setGoals: (day, plan) => ipcRenderer.invoke('goals:set', day, plan),
  copyTimeline: (mode, day) => ipcRenderer.invoke('timeline:copy', mode, day),
  exportMarkdown: (from, to) => ipcRenderer.invoke('timeline:export', from, to),
  updateCard: (id, change) => ipcRenderer.invoke('card:update', id, change),
  deleteCard: (id) => ipcRenderer.invoke('card:delete', id),
  rateCard: (span, rating, feedback) => ipcRenderer.invoke('card:rate', span, rating, feedback),
  reprocessBatch: (batchId) => ipcRenderer.invoke('batch:reprocess', batchId),
  reprocessDay: (day) => ipcRenderer.invoke('day:reprocess', day),
  getStatus: () => ipcRenderer.invoke('status:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (next) => ipcRenderer.invoke('settings:save', next),
  setApiKey: (kind, key) => ipcRenderer.invoke('key:set', kind, key),
  testProvider: () => ipcRenderer.invoke('provider:test'),
  pause: (seconds) => ipcRenderer.invoke('capture:pause', seconds),
  resume: () => ipcRenderer.invoke('capture:resume'),
  openRecordings: () => ipcRenderer.invoke('recordings:open'),
  runAnalysis: () => ipcRenderer.invoke('analysis:run'),
  checkCli: (cli) => ipcRenderer.invoke('cli:check', cli),
  onCardsChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('cards:changed', listener)
    return () => ipcRenderer.off('cards:changed', listener)
  },
  onStatus: (cb) => {
    const listener = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('status:changed', listener)
    return () => ipcRenderer.off('status:changed', listener)
  }
}

contextBridge.exposeInMainWorld('dayflow', api)
