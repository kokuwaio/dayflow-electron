// Playing a card's saved frames as a timelapse: shared by the inline player
// in the card inspector and the full-window player.

import { useEffect, useState } from 'react'
import { type FrameRef, type TimelapseSpeed, frameDelayMs } from '@shared/media'

/** The frames of a time range; null while they load. */
export function useFrames(start: number, end: number): FrameRef[] | null {
  const [frames, setFrames] = useState<FrameRef[] | null>(null)
  useEffect(() => {
    let current = true
    setFrames(null)
    void window.dayflow.getFrames({ start, end }).then((f) => current && setFrames(f))
    return () => {
      current = false
    }
  }, [start, end])
  return frames
}

/** Frame position, speed and play state; playing stops at the last frame and starts over from there. */
export function useTimelapse(frames: FrameRef[], initial: { index?: number; speed?: TimelapseSpeed; playing?: boolean } = {}) {
  const [index, setIndex] = useState(initial.index ?? 0)
  const [speed, setSpeed] = useState<TimelapseSpeed>(initial.speed ?? 20)
  const [playing, setPlaying] = useState(initial.playing ?? false)
  const last = Math.max(0, frames.length - 1)
  const at = Math.min(index, last)

  useEffect(() => {
    if (!playing) return
    const current = frames[at]
    const next = frames[at + 1]
    if (!current || !next) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setIndex(at + 1), frameDelayMs(current, next, speed))
    return () => clearTimeout(timer)
  }, [playing, at, speed, frames])

  return {
    index: at,
    setIndex,
    speed,
    setSpeed,
    playing,
    play: (s?: TimelapseSpeed) => {
      if (s) setSpeed(s)
      if (at >= last) setIndex(0)
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (playing) return setPlaying(false)
      if (at >= last) setIndex(0)
      setPlaying(true)
    }
  }
}
