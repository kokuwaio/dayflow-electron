import { describe, expect, it } from 'vitest'
import { iconHost } from './favicon'

describe('iconHost (upstream FaviconService.normalizedHost)', () => {
  it.each([
    ['docs.google.com', 'docs.google.com'],
    ['https://GitHub.com/monotek/dayflow', 'github.com'],
    ['developer.apple.com/xcode', 'developer.apple.com'],
    ['  slack.com  ', 'slack.com'],
    ['www.figma.com', 'www.figma.com']
  ])('reads %s as %s', (site, host) => {
    expect(iconHost(site)).toBe(host)
  })

  it.each([['terminal'], ['VS Code'], [''], [undefined], ['localhost'], ['192.168.1.10'], ['nas.lan'], ['git.corp.internal'], ['router.home.arpa'], ['printer.local'], ['app.localhost']])('has no web icon for %s', (site) => {
    expect(iconHost(site)).toBeNull()
  })
})
