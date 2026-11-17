// Timeline categories: name, color and the description sent to the model.
// Defaults and role presets from upstream Dayflow (Models/TimelineCategory.swift).

export interface Category {
  /** Stable across renames, so cards can follow a renamed category. */
  id: string
  name: string
  /** "#RRGGBB" */
  color: string
  /** Sent to the model so it knows what belongs here. */
  description: string
  /** The one category for time without activity; the idle shortcut uses it. */
  isIdle?: boolean
}

const IDLE: Category = {
  id: 'idle',
  name: 'Idle',
  color: '#A0AEC0',
  description: 'For when the user is idle for most of the time.',
  isIdle: true
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'work', name: 'Work', color: '#B984FF', description: 'Career, school, or productivity-focused activities (projects, emails, assignments, video calls, learning skills, etc.)' },
  { id: 'personal', name: 'Personal', color: '#6AADFF', description: 'Purposeful non-work activities or life tasks (paying bills, fitness tracking, meal planning, personal research, creative hobbies, etc.)' },
  { id: 'distraction', name: 'Distraction', color: '#FF5950', description: 'Passive consumption or aimless browsing (scrolling feeds, watching random videos, clicking through news, mindless games, etc.)' },
  IDLE
]

const COMMUNICATION = (d: string): [string, string, string] => ['Communication', '#FFAE8C', d]
const DISTRACTION: [string, string, string] = [
  'Distraction',
  '#FF4721',
  'Unfocused browsing and passive content consumption: social media feeds, random videos, idle scrolling, entertainment with no clear intent, and gaming'
]
const PERSONAL: [string, string, string] = [
  'Personal',
  '#ADE3E3',
  'Intentional non-work activity with a purpose: messaging friends and family, managing finances, booking travel, errands, life admin, and hobbies'
]

/** Role presets, as offered during upstream's onboarding. Idle is added by presetCategories(). */
export const CATEGORY_PRESETS: Record<string, Array<[name: string, color: string, description: string]>> = {
  'Software Engineer': [
    ['Coding / Debugging', '#6A7EFF', 'Writing, refactoring, and fixing code in an IDE or terminal'],
    ['Code Review', '#56CFEE', 'Reviewing PRs, reading diffs, and leaving comments'],
    ['Research', '#C787F7', 'Reading docs, Stack Overflow, exploring tools and APIs, and writing design docs or technical specs'],
    COMMUNICATION('Meetings, standups, Slack, email, video calls, messaging, and syncs'),
    DISTRACTION,
    PERSONAL
  ],
  'Founder / Executive': [
    ['Engineering / Product', '#6A7EFF', 'Coding, design work, shipping features, and hands-on building'],
    ['Research & Strategy', '#56CFEE', 'Competitive research, positioning, long-form thinking, and investor prep'],
    ['Data & Insights', '#C787F7', 'Dashboards, retention data, funnels, and financials'],
    COMMUNICATION('Team syncs, investor calls, user demos, and hiring'),
    DISTRACTION,
    PERSONAL
  ],
  Designer: [
    ['Design', '#6A7EFF', 'Prototyping, UI components, user flows, visual design, and handoff specs'],
    ['Research', '#56CFEE', 'Browsing patterns, competitive audits, user studies, and reviewing metrics'],
    COMMUNICATION('Design reviews, standups, critique sessions, and presenting concepts'),
    DISTRACTION,
    PERSONAL
  ],
  Student: [
    ['Studying', '#6A7EFF', 'Lectures, reading, reviewing slides, flashcards, and course material'],
    ['Assignments', '#56CFEE', 'Papers, problem sets, coding projects, and lab reports'],
    COMMUNICATION('Study groups, office hours, group chats, and emailing professors'),
    DISTRACTION,
    PERSONAL
  ],
  'Product Manager': [
    ['Specs & Planning', '#6A7EFF', 'PRDs, roadmaps, backlog grooming, sprint planning, and tickets'],
    ['Research & Analysis', '#56CFEE', 'User research, metrics review, competitive analysis, and A/B tests'],
    COMMUNICATION('Standups, stakeholder syncs, design reviews, and engineering check-ins'),
    DISTRACTION,
    PERSONAL
  ],
  'Data Scientist': [
    ['Analysis & Modeling', '#6A7EFF', 'Notebooks, statistical analysis, ML training, and data exploration'],
    ['Data Engineering', '#56CFEE', 'SQL queries, pipelines, data cleaning, and ETL scripts'],
    ['Research', '#C787F7', 'Reading papers, docs, and exploring new methods and tools'],
    COMMUNICATION('Presenting findings, stakeholder syncs, and team discussions'),
    DISTRACTION,
    PERSONAL
  ],
  Other: [
    ['Work', '#6A7EFF', 'Focused work tasks and professional responsibilities that do not fit a more specific category'],
    COMMUNICATION('Meetings, standups, Slack, email, video calls, messaging, and syncs'),
    DISTRACTION,
    PERSONAL
  ]
}

export function presetCategories(role: string): Category[] {
  const preset = CATEGORY_PRESETS[role] ?? CATEGORY_PRESETS.Other!
  return [...preset.map(([name, color, description]) => ({ id: slug(name), name, color, description })), { ...IDLE }]
}

const FALLBACK_COLOR = '#E5E7EB'
const MAX_CATEGORIES = 20

/** Trims, drops empty and duplicate names, fixes colors, keeps exactly one Idle category last. */
export function sanitizeCategories(raw: unknown): Category[] {
  if (!Array.isArray(raw)) return defaults()
  const seen = new Set<string>()
  const ids = new Set<string>()
  const idOf = (c: Partial<Category>, name: string) => {
    let id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : slug(name)
    while (ids.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`
    ids.add(id)
    return id
  }
  const regular: Category[] = []
  let idle: Category | null = null
  for (const item of raw) {
    const c = (item ?? {}) as Partial<Category>
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, 40) : ''
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const color = typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color.trim()) ? c.color.trim().toUpperCase() : FALLBACK_COLOR
    const description = typeof c.description === 'string' ? c.description.trim().slice(0, 300) : ''
    if (c.isIdle) idle ??= { id: idOf(c, name), name, color, description, isIdle: true }
    else regular.push({ id: idOf(c, name), name, color, description })
  }
  if (regular.length === 0) return defaults()
  return [...regular.slice(0, MAX_CATEGORIES - 1), idle ?? { ...IDLE, id: ids.has(IDLE.id) ? idOf(IDLE, IDLE.name) : IDLE.id }]
}

const defaults = () => DEFAULT_CATEGORIES.map((c) => ({ ...c }))

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'

/** Categories whose name changed, matched by id. */
export function renamedCategories(before: Category[], after: Category[]): Array<{ from: string; to: string }> {
  return after.flatMap((c) => {
    const old = before.find((b) => b.id === c.id)
    return old && old.name !== c.name ? [{ from: old.name, to: c.name }] : []
  })
}

/** The category for time away; found by its flag, whatever it is called. */
export const idleCategory = (categories: Category[]): Category | undefined => categories.find((c) => c.isIdle)

/** Categories the app writes itself, outside the user's list. */
export const SYSTEM_CATEGORY = 'System'
export const PRIVATE_CATEGORY = 'Private'
