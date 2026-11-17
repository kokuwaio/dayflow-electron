export interface StoredFrame {
  id: number
  /** Unix seconds. */
  capturedAt: number
  bytes: number
}

/** Ids of the oldest frames to delete so the rest fits within capBytes. */
export function selectFramesToPurge(frames: readonly StoredFrame[], capBytes: number): number[] {
  let total = frames.reduce((sum, f) => sum + f.bytes, 0)
  const purge: number[] = []
  for (const f of [...frames].sort((a, b) => a.capturedAt - b.capturedAt)) {
    if (total <= capBytes) break
    purge.push(f.id)
    total -= f.bytes
  }
  return purge
}
