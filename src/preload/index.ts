import { contextBridge, ipcRenderer } from 'electron'
import type { DayflowApi } from './api'

const api: DayflowApi = {
  getDay: (day) => ipcRenderer.invoke('day:get', day),
  getWeekly: (day) => ipcRenderer.invoke('weekly:get', day),
  getWeeklyDefaultDay: () => ipcRenderer.invoke('weekly:defaultDay'),
  getAccess: () => ipcRenderer.invoke('access:get'),
  getStandup: (day) => ipcRenderer.invoke('daily:get', day),
  generateStandup: (day) => ipcRenderer.invoke('daily:generate', day),
  saveStandup: (day, draft) => ipcRenderer.invoke('daily:save', day, draft),
  onNavigate: (cb) => {
    const listener = (_e: unknown, tab: Parameters<typeof cb>[0]) => cb(tab)
    ipcRenderer.on('navigate', listener)
    return () => ipcRenderer.off('navigate', listener)
  },
  onDailyChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('daily:changed', listener)
    return () => ipcRenderer.off('daily:changed', listener)
  },
  getVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateSupport: () => ipcRenderer.invoke('updates:support'),
  getConversations: () => ipcRenderer.invoke('chat:conversations'),
  getChatMessages: (id) => ipcRenderer.invoke('chat:messages', id),
  deleteConversation: (id) => ipcRenderer.invoke('chat:delete', id),
  sendChat: (conversationId, text, preferred) => ipcRenderer.invoke('chat:send', conversationId, text, preferred),
  getChatProviders: () => ipcRenderer.invoke('chat:providers'),
  getChatMemory: () => ipcRenderer.invoke('chat:memory'),
  saveChatMemory: (memory) => ipcRenderer.invoke('chat:memory:save', memory),
  onChatEvent: (cb) => {
    const listener = (_e: unknown, event: Parameters<typeof cb>[0]) => cb(event)
    ipcRenderer.on('chat:event', listener)
    return () => ipcRenderer.off('chat:event', listener)
  },
  getFrames: (span) => ipcRenderer.invoke('frames:get', span),
  completeOnboarding: () => ipcRenderer.invoke('onboarding:complete'),
  getScreenPermission: () => ipcRenderer.invoke('permissions:get'),
  requestScreenPermission: () => ipcRenderer.invoke('permissions:requestScreen'),
  relaunch: () => ipcRenderer.invoke('permissions:relaunch'),
  checkWindowDetection: () => ipcRenderer.invoke('permissions:window'),
  getWeek: (day) => ipcRenderer.invoke('week:get', day),
  getGoals: (day) => ipcRenderer.invoke('goals:get', day),
  setGoals: (day, plan) => ipcRenderer.invoke('goals:set', day, plan),
  getGoalContext: (day) => ipcRenderer.invoke('goals:context', day),
  getReview: (day) => ipcRenderer.invoke('review:get', day),
  rateReview: (span, rating) => ipcRenderer.invoke('review:rate', span, rating),
  copyTimeline: (mode, day) => ipcRenderer.invoke('timeline:copy', mode, day),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
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
  checkStorage: (run) => ipcRenderer.invoke('storage:check', run),
  getInstalledApps: () => ipcRenderer.invoke('apps:installed'),
  runAnalysis: () => ipcRenderer.invoke('analysis:run'),
  checkCli: (cli) => ipcRenderer.invoke('cli:check', cli),
  getAgentAccess: () => ipcRenderer.invoke('agent:info'),
  agentClient: (cli, action) => ipcRenderer.invoke('agent:client', cli, action),
  onCardsChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('cards:changed', listener)
    return () => ipcRenderer.off('cards:changed', listener)
  },
  onLanguage: (cb) => {
    const listener = (_e: unknown, language: Parameters<typeof cb>[0]) => cb(language)
    ipcRenderer.on('language:changed', listener)
    return () => ipcRenderer.off('language:changed', listener)
  },
  onStatus: (cb) => {
    const listener = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('status:changed', listener)
    return () => ipcRenderer.off('status:changed', listener)
  }
}

contextBridge.exposeInMainWorld('dayflow', api)
