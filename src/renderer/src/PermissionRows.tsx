// The live permission rows (upstream SystemPermissionRow.swift with
// SystemPermissionsMonitor), shared by the onboarding's Permissions step and
// Settings → Permissions (upstream SettingsPermissionsTabView.swift). Which
// rows show and what they say comes from permissionsView (src/shared/permissions.ts).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type PermissionRow, type PermissionsView, type ScreenPermission, type WindowCheck, permissionsView } from '@shared/permissions'
import { CommandBlock, StatusDot } from './SettingsLayout'

const CHECKING_WINDOW: WindowCheck = { state: 'checking', reason: null, command: null }

/** The permission state, polled on macOS, with Grant, Quit and Reopen and the Linux window check. */
export function usePermissions(platform: string, beforeRelaunch?: () => void): PermissionsView & { grant: () => void; relaunch: () => void; recheck: () => void } {
  const [screen, setScreen] = useState<ScreenPermission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [windowCheck, setWindowCheck] = useState<WindowCheck>(CHECKING_WINDOW)
  const [windowRun, setWindowRun] = useState(0)

  // macOS: re-check twice a second while the user is in System Settings (upstream SystemPermissionsMonitor).
  useEffect(() => {
    let live = true
    const load = () => void window.dayflow.getScreenPermission().then((p) => live && setScreen(p))
    load()
    const timer = platform === 'darwin' ? setInterval(load, 500) : undefined
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [platform])

  useEffect(() => {
    if (platform !== 'linux') return
    let live = true
    setWindowCheck(CHECKING_WINDOW)
    let retry: ReturnType<typeof setTimeout> | undefined
    // While recording, the main process reports the recorder's detection, which may still be starting.
    const load = () =>
      void window.dayflow.checkWindowDetection().then((c) => {
        if (!live) return
        setWindowCheck(c)
        if (c.state === 'checking') retry = setTimeout(load, 2_000)
      })
    load()
    return () => {
      live = false
      clearTimeout(retry)
    }
  }, [platform, windowRun])

  const grant = async () => {
    setBusy(true)
    setError(null)
    const result = await window.dayflow.requestScreenPermission()
    setBusy(false)
    if (!result.ok) setError(result.message)
    setScreen(await window.dayflow.getScreenPermission())
  }

  const view = permissionsView({ platform, screen: screen?.screen ?? null, requested: screen?.requested ?? false, busy, error, window: windowCheck })
  return {
    ...view,
    grant: () => void grant(),
    relaunch: () => {
      beforeRelaunch?.()
      void window.dayflow.relaunch()
    },
    recheck: () => setWindowRun((n) => n + 1)
  }
}

/** One permission: title, detail and state, with Grant (and Quit and Reopen) on the right (upstream SystemPermissionRow). */
export function PermissionCard({ row, onGrant, onRelaunch, onRecheck }: { row: PermissionRow; onGrant: () => void; onRelaunch: () => void; onRecheck: () => void }) {
  const { t } = useTranslation()
  const hasControls = !!row.status || row.actions.length > 0
  return (
    <div className="perm-row">
      <div className="perm-text">
        <b>{row.title}</b>
        <span>{row.detail}</span>
        {row.note && <span className="perm-note">{row.note}</span>}
      </div>
      {hasControls && (
        <div className="perm-controls">
          {row.status && <StatusDot kind={row.status.kind}>{row.status.label}</StatusDot>}
          {row.actions.includes('grant') && (
            <button className="perm-grant" disabled={row.busy} onClick={onGrant}>
              {row.busy ? t('onboarding.permissions.waiting') : t('onboarding.permissions.grant')}
            </button>
          )}
          {row.actions.includes('recheck') && (
            <button className="perm-grant" onClick={onRecheck}>
              {t('onboarding.permissions.checkAgain')}
            </button>
          )}
          {row.actions.includes('relaunch') && (
            <button className="perm-link" onClick={onRelaunch}>
              {t('onboarding.permissions.quitReopen')}
            </button>
          )}
        </div>
      )}
      {row.command && <CommandBlock text={row.command} />}
    </div>
  )
}

/** The rows of a usePermissions state. */
export function PermissionCards({ permissions }: { permissions: ReturnType<typeof usePermissions> }) {
  return (
    <>
      {permissions.rows.map((r) => (
        <PermissionCard key={r.id} row={r} onGrant={permissions.grant} onRelaunch={permissions.relaunch} onRecheck={permissions.recheck} />
      ))}
    </>
  )
}
