import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../shared/categories'
import { buildCardRequest } from './prompt'
import { titlePrompt, summaryPrompt } from './two-step-prompts'

const promptText = (overrides?: Parameters<typeof buildCardRequest>[0]['overrides']) => {
  const req = buildCardRequest({
    frames: [],
    previousCards: [],
    window: { start: 0, end: 60 },
    categories: DEFAULT_CATEGORIES,
    ...(overrides ? { overrides } : {})
  })
  const first = req.turns[0]!.parts[0]!
  return first.type === 'text' ? first.text : ''
}

describe('prompt overrides', () => {
  it('replaces only the overridden section of the one-step prompt', () => {
    const text = promptText({ title: 'TITLES\nThree words, German.', summary: '', detailedSummary: '' })
    expect(text).toContain('TITLES\nThree words, German.')
    expect(text).not.toContain('Core principle: If you read this title next week')
    expect(text).toContain('SUMMARIES\n\n2-3 sentences max.')
    expect(text).toContain('DETAILED SUMMARY\n\nGranular activity log.')
  })

  it('leaves the prompt as upstream wrote it without overrides', () => {
    expect(promptText()).toContain('Core principle: If you read this title next week')
  })

  it('uses the overrides in the two-step title and summary prompts too', () => {
    expect(titlePrompt('- obs', '', 'Short titles only.')).toMatch(/^Short titles only\./)
    expect(summaryPrompt('obs', 'cats', '"Work"', '', 'One sentence.')).toContain('\nOne sentence.\n')
  })

  it('inserts overrides as written, even when they contain section headings or placeholders', () => {
    const text = promptText({ title: 'My titles. Not like SUMMARIES\nsays.', summary: 'Use {{CATEGORIES}} words.', detailedSummary: '' })
    expect(text).toContain('My titles. Not like SUMMARIES\nsays.')
    expect(text).toContain('Use {{CATEGORIES}} words.')
    expect(text).toContain('USER CATEGORIES (choose exactly one label):')
    expect(text).toContain('DETAILED SUMMARY\n\nGranular activity log.')
  })

  it('keeps the plain-text answer rule after a two-step title override', () => {
    expect(titlePrompt('- obs', '', 'Short titles only.')).toContain('Return only the title text')
  })
})
