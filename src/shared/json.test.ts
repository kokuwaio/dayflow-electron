import { describe, expect, it } from 'vitest'
import { jsonArray, jsonObject } from './json'

describe('JSON in model replies', () => {
  it('finds an array despite brackets inside its strings', () => {
    expect(jsonArray('Here: [{"title":"Fixed ] parsing"}]', 'cards')).toEqual([{ title: 'Fixed ] parsing' }])
    expect(jsonArray('Note [1] first.\n```json\n[{"title":"a [b"}]\n```', 'cards')).toEqual([{ title: 'a [b' }])
    expect(jsonArray('Cards: [{"tags":["a"]}] done', 'cards')).toEqual([{ tags: ['a'] }])
  })

  it('reads an array under the given key and plain objects', () => {
    expect(jsonArray('{"cards":[1,2]}', 'cards')).toEqual([1, 2])
    expect(jsonObject('Sure! {"done":["x"]} hope that helps')).toEqual({ done: ['x'] })
    expect(jsonArray('no json here', 'cards')).toBeNull()
  })

  it('leaves backticks inside JSON strings alone and still reads fenced replies', () => {
    expect(jsonArray('[{"summary":"Documented ```json fences"}]', 'cards')).toEqual([{ summary: 'Documented ```json fences' }])
    expect(jsonArray('Here you go:\n```json\n[{"summary":"a ```json b"}]\n```', 'cards')).toEqual([{ summary: 'a ```json b' }])
  })
})
