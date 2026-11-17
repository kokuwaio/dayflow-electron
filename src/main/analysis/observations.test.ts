import { describe, expect, it } from 'vitest'
import { parseSegments } from './observations'

const start = new Date(2026, 10, 17, 14, 0).getTime() / 1000
const recording = { start, durationSec: 15 * 60 }
const seg = (startTimestamp: string, endTimestamp: string, description: string) => ({ startTimestamp, endTimestamp, description })

describe('parseSegments', () => {
  it('reads the segments object out of surrounding text and turns offsets into times', () => {
    const reply =
      'Sure! ' +
      JSON.stringify({ reasoning: 'two phases', segments: [seg('00:00', '09:30', 'Edited pipeline.ts'), seg('09:30', '15:00', 'Ran the tests')] }) +
      ' Hope that helps.'
    expect(parseSegments(reply, recording)).toEqual({
      ok: true,
      observations: [
        { start, end: start + 570, text: 'Edited pipeline.ts' },
        { start: start + 570, end: start + 900, text: 'Ran the tests' }
      ]
    })
  })

  it('accepts a bare array and HH:MM:SS timestamps', () => {
    const reply = JSON.stringify([seg('00:00:00', '00:08:00', 'A'), seg('00:08:00', '00:15:00', 'B')])
    expect(parseSegments(reply, recording)).toMatchObject({ ok: true, observations: [{ end: start + 480 }, { start: start + 480 }] })
  })

  it('drops segments outside the recording and clamps the ones just past its end', () => {
    const reply = JSON.stringify({
      segments: [seg('00:00', '14:00', 'Main work'), seg('14:00', '15:20', 'Wrap-up'), seg('20:00', '25:00', 'Invented')]
    })
    expect(parseSegments(reply, recording)).toMatchObject({
      ok: true,
      observations: [{ text: 'Main work' }, { text: 'Wrap-up', end: start + 900 }]
    })
  })

  it.each([
    ['no JSON at all', 'I could not see anything.', /no segments/i],
    ['only invented time', JSON.stringify({ segments: [seg('30:00', '40:00', 'x')] }), /no segments/i],
    ['too many segments', JSON.stringify({ segments: ['00:00', '03:00', '06:00', '09:00', '12:00', '14:00'].map((t, i, a) => seg(t, a[i + 1] ?? '15:00', `s${i}`)) }), /at most 5/i],
    ['too little coverage', JSON.stringify({ segments: [seg('00:00', '05:00', 'a'), seg('05:00', '10:00', 'b')] }), /67%/]
  ])('rejects %s', (_name, reply, issue) => {
    const result = parseSegments(reply, recording)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issue).toMatch(issue)
  })
})
