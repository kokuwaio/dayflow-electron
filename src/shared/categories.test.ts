import { describe, expect, it } from 'vitest'
import { CATEGORY_PRESETS, DEFAULT_CATEGORIES, idleCategory, isIdleName, presetCategories, renamedCategories, sanitizeCategories } from './categories'

describe('categories', () => {
  it('starts with upstream\'s defaults: Work, Personal, Distraction and Idle', () => {
    expect(DEFAULT_CATEGORIES.map((c) => [c.name, c.color])).toEqual([
      ['Work', '#B984FF'],
      ['Personal', '#6AADFF'],
      ['Distraction', '#FF5950'],
      ['Idle', '#A0AEC0']
    ])
  })

  it('offers upstream\'s role presets, each ending with Idle', () => {
    expect(Object.keys(CATEGORY_PRESETS)).toEqual([
      'Software Engineer', 'Founder / Executive', 'Designer', 'Student', 'Product Manager', 'Data Scientist', 'Other'
    ])
    const engineer = presetCategories('Software Engineer')
    expect(engineer.map((c) => c.name)).toEqual(['Coding / Debugging', 'Code Review', 'Research', 'Communication', 'Distraction', 'Personal', 'Idle'])
    expect(engineer[0]).toMatchObject({ color: '#6A7EFF', description: 'Writing, refactoring, and fixing code in an IDE or terminal' })
    expect(engineer.filter((c) => c.isIdle)).toHaveLength(1)
  })

  it('cleans up edited categories: names, duplicates, colors and exactly one Idle at the end', () => {
    const cleaned = sanitizeCategories([
      { name: '  Deep work ', color: '#123abc', description: ' focus ' },
      { name: 'deep WORK', color: '#000000', description: 'duplicate' },
      { name: '', color: '#ffffff', description: 'no name' },
      { name: 'Idle', color: '#A0AEC0', description: '', isIdle: true },
      { name: 'Meetings', color: 'red', description: '' }
    ])
    expect(cleaned).toMatchObject([
      { name: 'Deep work', color: '#123ABC', description: 'focus' },
      { name: 'Meetings', color: '#E5E7EB', description: '' },
      { name: 'Idle', color: '#A0AEC0', description: '', isIdle: true }
    ])
    expect(new Set(cleaned.map((c) => c.id)).size).toBe(3)
  })

  it('adds Idle back when it was removed and falls back to the defaults when nothing usable is left', () => {
    expect(sanitizeCategories([{ name: 'Work', color: '#6A7EFF', description: '' }]).at(-1)).toMatchObject({ name: 'Idle', isIdle: true })
    expect(sanitizeCategories([])).toEqual(DEFAULT_CATEGORIES)
    expect(sanitizeCategories('nonsense')).toEqual(DEFAULT_CATEGORIES)
  })

  it('keeps category ids, so renames are found by id and not by position', () => {
    const before = sanitizeCategories(DEFAULT_CATEGORIES)
    const added = [...before.slice(0, 3), { name: 'Category 4', color: '#6A7EFF', description: '' }, before[3]!]
    const after = sanitizeCategories(added.map((c) => (c.name === 'Idle' ? { ...c, name: 'Away' } : c)))
    expect(after.map((c) => c.id).slice(0, 3)).toEqual(before.map((c) => c.id).slice(0, 3))
    expect(renamedCategories(before, after)).toEqual([{ from: 'Idle', to: 'Away' }])
    expect(idleCategory(after)?.name).toBe('Away')
  })
})

describe('isIdleName', () => {
  it('knows "Idle" and the name the user gave the idle category', () => {
    const renamed = [{ id: 'w', name: 'Work', color: '#000', description: '' }, { id: 'i', name: 'Away', color: '#000', description: '', isIdle: true }]
    expect(isIdleName('idle', renamed)).toBe(true)
    expect(isIdleName(' Away ', renamed)).toBe(true)
    expect(isIdleName('Work', renamed)).toBe(false)
  })
})
