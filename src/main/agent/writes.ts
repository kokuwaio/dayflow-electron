// The write operations the agent bridge accepts, after upstream Dayflow
// (Core/AgentAccess/AgentWriteHandlers.swift): a fixed verb list mapped onto
// the code paths the window uses (the settings save for categories, the
// store for cards and goals), not arbitrary SQL. Every argument is checked
// here, whatever the CLI or MCP server checked before.

import type { Category } from '../../shared/categories'
import { isDayKey } from '../../shared/day'
import { defaultGoalPlan } from '../../shared/day-summary'
import type { Store } from '../db/store'
import type { WriteOperation } from './protocol'

export class AgentWriteError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface WriteDeps {
  store: Pick<Store, 'card' | 'updateCard' | 'deleteCard' | 'countCardsInCategory' | 'goalPlan' | 'setGoalPlan'>
  categories(): Category[]
  /** Saves the list through the window's settings path (sanitizing, renaming cards); returns what was stored. */
  saveCategories(next: Category[]): Promise<Category[]>
  /** Tells the window that cards changed. */
  cardsChanged(): void
  today(): string
}

/** Limits of sanitizeCategories (src/shared/categories.ts), checked up front so nothing is cut silently. */
const MAX_CATEGORIES = 20
const MAX_NAME = 40
const MAX_DESCRIPTION = 300
const MAX_TITLE = 500
const MINUTES_PER_DAY = 1440
/** Upstream's color for a new category without one is a palette pick; the window's "Add category" uses this. */
const NEW_CATEGORY_COLOR = '#6A7EFF'

const invalid = (message: string) => new AgentWriteError('invalid_argument', message)

function text(args: Record<string, unknown>, key: string, max: number, label: string): string | undefined {
  const v = args[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw invalid(`${label} must be text.`)
  const trimmed = v.trim()
  if (trimmed.length > max) throw invalid(`${label} can be at most ${max} characters.`)
  // Single-line text, like the window's inputs; these strings end up in the model's prompt.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw invalid(`${label} must be a single line of text.`)
  return trimmed
}

function hexColor(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  const hex = s.startsWith('#') ? s : `#${s}`
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw invalid(`"${String(value)}" is not a hex color like #F96E00.`)
  return hex.toUpperCase()
}

function recordId(args: Record<string, unknown>): number {
  const id = args.record_id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw invalid('record_id is required.')
  return id
}

function minutes(args: Record<string, unknown>, key: string, min: number): number | undefined {
  const v = args[key]
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > MINUTES_PER_DAY) {
    throw invalid(`${key} must be a whole number from ${min} to ${MINUTES_PER_DAY}.`)
  }
  return v
}

export function createWriteHandlers(deps: WriteDeps) {
  const resolve = (name: unknown): Category => {
    if (typeof name !== 'string' || !name.trim()) throw invalid('A category name is required.')
    const list = deps.categories()
    const match = list.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
    if (!match) throw new AgentWriteError('not_found', `No category named "${name}". Categories: ${list.map((c) => c.name).join(', ')}`)
    return match
  }
  /** Saves categories and lets the window reload them (it reads categories when cards change). */
  const save = async (next: Category[]) => {
    await deps.saveCategories(next)
    deps.cardsChanged()
  }

  const handlers: Record<WriteOperation, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
    async category_add(args) {
      const name = text(args, 'name', MAX_NAME, 'The name')
      if (!name) throw invalid('A category name is required.')
      const color = args.color === undefined ? NEW_CATEGORY_COLOR : hexColor(args.color)
      const description = text(args, 'description', MAX_DESCRIPTION, 'The description') ?? ''
      const list = deps.categories()
      if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new AgentWriteError('already_exists', `A category named "${name}" already exists.`)
      }
      if (list.length >= MAX_CATEGORIES) throw invalid(`You can have at most ${MAX_CATEGORIES} categories.`)
      const idle = list.findIndex((c) => c.isIdle)
      const next = [...list]
      next.splice(idle < 0 ? next.length : idle, 0, { id: '', name, color, description })
      await save(next)
      return { message: `Created ${name}` }
    },

    async category_update(args) {
      const category = resolve(args.name)
      const newName = text(args, 'new_name', MAX_NAME, 'new_name')
      const color = args.color === undefined ? undefined : hexColor(args.color)
      const description = text(args, 'description', MAX_DESCRIPTION, 'The description')
      const list = deps.categories()
      const changes: string[] = []
      const updated: Category = { ...category }
      if (newName && newName !== category.name) {
        if (list.some((c) => c.id !== category.id && c.name.toLowerCase() === newName.toLowerCase())) {
          throw new AgentWriteError('already_exists', `A category named "${newName}" already exists.`)
        }
        updated.name = newName
        changes.push(`renamed to ${newName}`)
      }
      if (color) {
        updated.color = color
        changes.push(`color ${color}`)
      }
      if (description !== undefined) {
        updated.description = description
        changes.push('description updated')
      }
      if (changes.length === 0) throw invalid('Nothing to change. Pass new_name, color, or description.')
      await save(list.map((c) => (c.id === category.id ? updated : c)))
      return { message: `${category.name}: ${changes.join(', ')}` }
    },

    async category_remove(args) {
      const category = resolve(args.name)
      if (category.isIdle) throw new AgentWriteError('permission_denied', `"${category.name}" is a system category.`)
      const list = deps.categories()
      // Without any regular category the settings fall back to the defaults.
      if (list.filter((c) => !c.isIdle).length <= 1) throw invalid('Keep at least one category besides Idle.')
      const affected = deps.store.countCardsInCategory(category.name)
      await save(list.filter((c) => c.id !== category.id))
      return {
        message: `Removed ${category.name}. ${affected} past activities keep the label but lose the color.`,
        affected_activities: affected
      }
    },

    async activity_update(args) {
      const id = recordId(args)
      const title = text(args, 'title', MAX_TITLE, 'The title') || undefined
      // Resolve every value before the write, so a typo can't partially apply.
      const category = args.category === undefined ? undefined : resolve(args.category).name
      if (title === undefined && category === undefined) throw invalid('Nothing to change. Pass title and/or category.')
      if (!deps.store.card(id)) throw new AgentWriteError('not_found', `No activity with ID ${id}.`)
      deps.store.updateCard(id, { ...(title !== undefined ? { title } : {}), ...(category !== undefined ? { category } : {}) })
      deps.cardsChanged()
      const changes = [...(title !== undefined ? ['title'] : []), ...(category !== undefined ? [`category → ${category}`] : [])]
      return { message: `Updated ${id}: ${changes.join(', ')}` }
    },

    async activity_delete(args) {
      const id = recordId(args)
      if (!deps.store.card(id)) throw new AgentWriteError('not_found', `No activity with ID ${id}.`)
      deps.store.deleteCard(id)
      deps.cardsChanged()
      return { message: `Deleted activity ${id}` }
    },

    async goal_set(args) {
      // Upstream takes any date text; here it must be a real day.
      if (args.date !== undefined && (typeof args.date !== 'string' || !isDayKey(args.date.trim()))) throw invalid('date must be YYYY-MM-DD.')
      const day = typeof args.date === 'string' ? args.date.trim() : deps.today()
      const focus = args.focus_minutes
      if (typeof focus !== 'number' || !Number.isInteger(focus) || focus <= 0) throw invalid('A positive focus_minutes value is required.')
      if (focus > MINUTES_PER_DAY) throw invalid(`focus_minutes can be at most ${MINUTES_PER_DAY}.`)
      const limit = minutes(args, 'distraction_limit_minutes', 0)
      const categories = deps.categories()
      const names = (key: string): string[] | undefined => {
        const v = args[key]
        if (v === undefined) return undefined
        if (!Array.isArray(v) || v.length > MAX_CATEGORIES) throw invalid(`${key} must be a list of category names.`)
        return v.map((name) => resolve(name).name)
      }
      const focusCategories = names('focus_categories')
      const distractionCategories = names('distraction_categories')
      const current = deps.store.goalPlan(day, categories) ?? defaultGoalPlan(categories)
      const plan = {
        focusTargetMinutes: focus,
        distractionLimitMinutes: limit ?? current.distractionLimitMinutes,
        focusCategories: focusCategories ?? current.focusCategories,
        distractionCategories: distractionCategories ?? current.distractionCategories,
        skipped: false
      }
      deps.store.setGoalPlan(day, plan, categories)
      deps.cardsChanged()
      return { message: `${day}: ${plan.focusTargetMinutes}m focus target, ${plan.distractionLimitMinutes}m distraction limit` }
    }
  }

  return (operation: WriteOperation, args: Record<string, unknown>) => handlers[operation](args)
}
