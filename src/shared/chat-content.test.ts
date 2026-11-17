import { describe, expect, it } from 'vitest'
import { chatBlocks, chatMetadata, visibleStreamingText } from './chat-content'

describe('chatMetadata (upstream ChatService.parseAssistantMetadata)', () => {
  it('takes the suggestions and memory blocks out of the answer', () => {
    const reply = [
      'You spent 3h on code review.',
      '',
      '```suggestions',
      '["What slowed me down?", "Compare with last week"]',
      '```',
      '```memory',
      'Profile: Backend engineer on payments',
      'Style: short answers',
      '```'
    ].join('\n')
    expect(chatMetadata(reply)).toEqual({
      text: 'You spent 3h on code review.',
      suggestions: ['What slowed me down?', 'Compare with last week'],
      memory: 'Profile: Backend engineer on payments\nStyle: short answers'
    })
  })

  it('reads loose "Suggestions:" and "Memory:" sections too, and drops leftover headings', () => {
    const reply = 'Done.\n\n## Suggestions\n["Next?"]\n\nMemory:\nProfile: PM\nStyle: bullets'
    expect(chatMetadata(reply)).toEqual({ text: 'Done.', suggestions: ['Next?'], memory: 'Profile: PM\nStyle: bullets' })
  })

  it('ignores memory that is not in the Profile/Style format', () => {
    expect(chatMetadata('Hi\n```memory\nlikes cats\n```')).toEqual({ text: 'Hi', suggestions: [], memory: null })
  })
})

describe('visibleStreamingText (upstream ChatMetadataParser)', () => {
  it('hides metadata fences while they stream in, even half-typed ones', () => {
    expect(visibleStreamingText('Answer\n```suggestions\n["a"')).toBe('Answer')
    expect(visibleStreamingText('Answer\n```sugg')).toBe('Answer')
    expect(visibleStreamingText('Answer\n```')).toBe('Answer')
    expect(visibleStreamingText('Answer\n```chart type=bar')).toBe('Answer\n```chart type=bar')
  })
})

describe('chatBlocks (upstream ChatContentParser)', () => {
  it('splits text and valid chart blocks, keeping invalid charts as text', () => {
    const bar = '```chart type=bar\n{"title":"Hours","x":["Mon","Tue"],"y":[3,4.5],"color":"#ff5950"}\n```'
    const broken = '```chart type=bar\n{"title":"Bad","x":["Mon"],"y":[1,2]}\n```'
    expect(chatBlocks(`Intro\n${bar}\nMiddle\n${broken}`)).toEqual([
      { kind: 'text', text: 'Intro\n' },
      { kind: 'chart', chart: { type: 'bar', title: 'Hours', labels: ['Mon', 'Tue'], values: [3, 4.5], color: '#FF5950' } },
      { kind: 'text', text: '\nMiddle\n' },
      { kind: 'text', text: broken }
    ])
  })

  it('reads every upstream chart type and checks their shapes', () => {
    const chart = (type: string, json: object) => chatBlocks('```chart type=' + type + '\n' + JSON.stringify(json) + '\n```')[0]
    expect(chart('pie', { title: 'Split', labels: ['A', 'B'], values: [1, 2], colors: ['#000000'] })).toEqual({
      kind: 'chart',
      chart: { type: 'donut', title: 'Split', labels: ['A', 'B'], values: [1, 2], colors: [null, null] }
    })
    expect(chart('stacked_bar', { title: 'S', x: ['Mon'], series: [{ name: 'Work', values: [2] }, { name: 'Bad', values: [1, 2] }] })).toEqual({
      kind: 'chart',
      chart: { type: 'stacked_bar', title: 'S', categories: ['Mon'], series: [{ name: 'Work', values: [2], color: null }] }
    })
    expect(chart('heatmap', { title: 'H', x: ['9'], y: ['Mon', 'Tue'], values: [[1]] })).toMatchObject({ kind: 'text' })
    expect(chart('gantt', { title: 'G', items: [{ label: 'a', start: 9, end: 10 }, { label: 'b', start: 11, end: 11 }] })).toEqual({
      kind: 'chart',
      chart: { type: 'gantt', title: 'G', items: [{ label: 'a', start: 9, end: 10, color: null }] }
    })
    expect(chart('radar', { title: 'R' })).toMatchObject({ kind: 'text' })
  })
})
