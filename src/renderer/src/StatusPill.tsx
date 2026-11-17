import { useState } from 'react'
import { PAUSE_PRESETS, describeRecorder } from '@shared/status'
import type { AppStatus } from '@shared/types'

export function StatusPill({ status, onChange }: { status: AppStatus; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const { state, until } = status.recorder
  const run = (p: Promise<unknown>) => void p.then(() => (setOpen(false), onChange()))
  return (
    <div className="status">
      <button className={`pill ${state}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="dot" />
        {status.recorder.blockedBy && state === 'recording' ? 'Hidden: blocked app in front' : describeRecorder(state, until)}
      </button>
      {open && (
        <div className="menu" role="menu">
          {state === 'paused' ? (
            <button onClick={() => run(window.dayflow.resume())}>Resume recording</button>
          ) : (
            PAUSE_PRESETS.map((p) => (
              <button key={p.label} onClick={() => run(window.dayflow.pause(p.seconds))}>
                Pause {p.label.toLowerCase()}
              </button>
            ))
          )}
          <button onClick={() => run(window.dayflow.openRecordings())}>Open recordings folder</button>
        </div>
      )}
    </div>
  )
}
