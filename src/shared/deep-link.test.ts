import { describe, expect, it } from 'vitest'
import { DEEP_LINK_SCHEME, deepLinkAction } from './deep-link'

describe('deep links (upstream AppDeepLinkRouter)', () => {
  it('reads the action from the host, the first path segment or ?action=', () => {
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://start-recording`)).toBe('start')
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://resume`)).toBe('start')
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}:///stop-recording`)).toBe('stop')
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://x/pause`)).toBe('stop')
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://?action=start`)).toBe('start')
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://STOP`)).toBe('stop')
  })

  it('ignores other schemes, unknown actions and referral links', () => {
    expect(deepLinkAction('https://start-recording')).toBeNull()
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://referral?code=1`)).toBeNull()
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://delete-everything`)).toBeNull()
    expect(deepLinkAction('not a url')).toBeNull()
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://constructor`)).toBeNull()
    expect(deepLinkAction(`${DEEP_LINK_SCHEME}://?action=__proto__`)).toBeNull()
  })
})
