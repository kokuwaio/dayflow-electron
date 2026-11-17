import { describe, expect, it } from 'vitest'
import type { TimelineCard } from '../../shared/types'
import { CONTEXT_HEADING, chatContextBlock, chatSystemPrompt } from './prompt'

// Tuesday, November 17, 2026, 2:05 PM in Europe/Berlin.
const now = new Date(2026, 10, 17, 14, 5)
const base = {
  now,
  language: '',
  memory: null,
  recentSuggestions: [],
  categories: [
    { name: 'Work', color: '#1F6FEB' },
    { name: 'Personal', color: '#F96E00' }
  ]
}

describe('chatSystemPrompt (upstream ChatPromptBuilder)', () => {
  it.each(['tools', 'context'] as const)('puts upstream date, time and day boundary lines in %s mode', (mode) => {
    const prompt = chatSystemPrompt({ ...base, mode })
    expect(prompt).toContain('Current date: Tuesday, November 17, 2026\nCurrent time: 2:05 PM\nDay boundary: Days start at 4:00 AM (not midnight)')
  })

  it('formats morning times with AM and noon hour as 12', () => {
    expect(chatSystemPrompt({ ...base, mode: 'tools', now: new Date(2026, 0, 5, 9, 7) })).toContain(
      'Current date: Monday, January 5, 2026\nCurrent time: 9:07 AM'
    )
    expect(chatSystemPrompt({ ...base, mode: 'tools', now: new Date(2026, 0, 5, 12, 30) })).toContain('Current time: 12:30 PM')
  })

  it('tools mode is the upstream Gemini prompt with tool instructions', () => {
    const prompt = chatSystemPrompt({ ...base, mode: 'tools' })
    expect(prompt.startsWith('You are the AI assistant inside Dayflow')).toBe(true)
    expect(prompt).toContain('"Yesterday" means the previous 4 AM–4 AM window.')
    expect(prompt).toContain('1. **fetchTimeline**')
    expect(prompt).toContain('```suggestions\n["Question 1?", "Question 2?", "Question 3?"]\n```')
    expect(prompt).toContain('- Emit only the fenced `suggestions` block and fenced `memory` block after the main answer.')
    // Not in upstream's Gemini prompt: API providers get the chart instructions too.
    expect(prompt).toContain('## INLINE CHARTS (OPTIONAL)')
    expect(prompt).not.toContain('## LANGUAGE')
  })

  it('appends memory, then the last 9 recent suggestions, after the prompt', () => {
    const recentSuggestions = Array.from({ length: 12 }, (_, i) => `Question ${i + 1}?`)
    for (const mode of ['tools', 'context'] as const) {
      const prompt = chatSystemPrompt({ ...base, mode, memory: 'Profile: dev\nStyle: brief', recentSuggestions })
      const memoryAt = prompt.indexOf('\n\n## User Memory\nProfile: dev\nStyle: brief')
      const recentAt = prompt.indexOf('\n\n## Recent Suggestions To Avoid\n- Question 4?\n')
      expect(memoryAt).toBeGreaterThan(prompt.indexOf(mode === 'tools' ? 'Emit only the fenced' : 'Do not mention the memory block'))
      expect(recentAt).toBeGreaterThan(memoryAt)
      expect(prompt.endsWith('- Question 12?')).toBe(true)
      expect(prompt).not.toContain('- Question 3?')
    }
  })

  it('leaves memory and suggestions out when there are none', () => {
    const prompt = chatSystemPrompt({ ...base, mode: 'tools', memory: '  ' })
    expect(prompt).not.toContain('\n## User Memory\n')
    expect(prompt).not.toContain('## Recent Suggestions To Avoid')
  })

  it('puts the language section after the response style in tools mode', () => {
    const prompt = chatSystemPrompt({ ...base, mode: 'tools', language: 'German' })
    expect(prompt).toContain(
      'Update the Style memory field accordingly.\n\n## LANGUAGE\n\nThe user only speaks German. Respond in German.'
    )
  })

  it('context mode keeps upstream charts, chart colors, style, language and memory contract', () => {
    const prompt = chatSystemPrompt({ ...base, mode: 'context', language: 'German' })
    expect(prompt.startsWith('You are a friendly assistant in Dayflow')).toBe(true)
    const charts = prompt.indexOf('## INLINE CHARTS (OPTIONAL)')
    const colors = prompt.indexOf(
      '## CHART COLORS\n\nWhen creating charts based on activity categories, use these exact colors:\n- Work: #1F6FEB\n- Personal: #F96E00\n'
    )
    const style = prompt.indexOf('## RESPONSE STYLE')
    const language = prompt.indexOf('## LANGUAGE\n\nThe user only speaks German.')
    const contract = prompt.indexOf('## MEMORY CONTRACT (REQUIRED)')
    expect(charts).toBeGreaterThan(0)
    expect(colors).toBeGreaterThan(charts)
    expect(style).toBeGreaterThan(colors)
    expect(language).toBeGreaterThan(style)
    expect(contract).toBeGreaterThan(language)
    expect(prompt).toContain('- Allowed chart types: bar, line, stacked_bar, donut, heatmap, gantt')
  })

  it('context mode has no database, sqlite or tool instructions and points to the data heading', () => {
    const prompt = chatSystemPrompt({ ...base, mode: 'context' })
    expect(prompt).not.toMatch(/sqlite|database|Bash|chunks|SELECT|fetchTimeline/i)
    expect(prompt).toContain(`included below under the heading "${CONTEXT_HEADING}"`)
    expect(prompt).toContain('say so clearly')
  })

  it('leaves chart colors out without categories', () => {
    expect(chatSystemPrompt({ ...base, mode: 'context', categories: [] })).not.toContain('## CHART COLORS')
  })
})

describe('chatContextBlock (upstream ChatToolExecutor formatting)', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 17, h, m).getTime() / 1000
  const card: TimelineCard = {
    id: 1, batchId: 1, startTime: '9:00 AM', endTime: '10:30 AM', start: at(9), end: at(10, 30), day: '2026-11-17',
    title: 'Chat prompt port', summary: 'Ported the prompts.', category: 'Work', subcategory: 'Coding', detailedSummary: 'Long',
    distractions: [{ startTime: '9:40 AM', endTime: '9:45 AM', title: 'Hacker News', summary: '' }],
    appSites: { primary: 'VS Code', secondary: 'github.com' }
  }

  it('formats one card with a distraction and one observation per day', () => {
    expect(chatContextBlock([card], [{ start: at(9, 5), end: at(9, 10), text: 'Editing prompt.ts' }])).toBe(
      [
        '## TIMELINE DATA',
        '',
        'Timeline activities for 2026-11-17:',
        '',
        '- 9:00 AM to 10:30 AM: Chat prompt port',
        '  Category: Work (Coding)',
        '  Summary: Ported the prompts.',
        '  Apps: VS Code, github.com',
        '  Distractions: 1 noted',
        '    - 9:40 AM-9:45 AM: Hacker News',
        '',
        'Detailed observations for 2026-11-17:',
        '',
        '[9:05 AM - 9:10 AM]',
        'Editing prompt.ts'
      ].join('\n')
    )
  })

  it('groups observations before 4 AM into the previous day', () => {
    const block = chatContextBlock([], [{ start: at(2), end: at(2, 5), text: 'Late night' }])
    expect(block).toContain('Detailed observations for 2026-11-16:\n\n[2:00 AM - 2:05 AM]\nLate night')
  })

  it('says when there is no data', () => {
    expect(chatContextBlock([], [])).toBe('## TIMELINE DATA\n\nNo timeline cards or observations found for the requested period.')
  })
})
