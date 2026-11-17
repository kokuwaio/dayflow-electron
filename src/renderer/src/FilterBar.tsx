import { useState } from 'react'
import type { Category } from '@shared/categories'

/** How muted categories are remembered: by name, any case (like upstream). */
export const muteKey = (category: string) => category.trim().toLowerCase()

/**
 * Category chips above the timeline (upstream TabFilterBar): click mutes a
 * category (its cards dim; summaries are unaffected), drag reorders. Idle
 * stays last and cannot be moved.
 */
export function FilterBar(props: {
  categories: Category[]
  muted: Set<string>
  onToggle: (name: string) => void
  onReorder: (next: Category[]) => void
}) {
  const { categories, muted } = props
  const [dragging, setDragging] = useState<number | null>(null)
  const regular = categories.filter((c) => !c.isIdle)
  const idle = categories.filter((c) => c.isIdle)

  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...regular]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    props.onReorder([...next, ...idle])
  }

  return (
    <div className="filterbar" role="toolbar" aria-label="Categories">
      {[...regular, ...idle].map((c, i) => (
        <button
          key={c.id}
          className={`chip ${muted.has(muteKey(c.name)) ? 'muted' : ''}`}
          draggable={!c.isIdle}
          aria-pressed={!muted.has(muteKey(c.name))}
          title={muted.has(muteKey(c.name)) ? `Show ${c.name}` : `Dim ${c.name}`}
          onClick={() => props.onToggle(muteKey(c.name))}
          onDragStart={() => setDragging(i)}
          onDragOver={(e) => !c.isIdle && e.preventDefault()}
          onDrop={() => {
            if (dragging !== null && !c.isIdle) move(dragging, i)
            setDragging(null)
          }}
        >
          <span className="dot" style={{ background: c.color }} />
          {c.name}
        </button>
      ))}
    </div>
  )
}
