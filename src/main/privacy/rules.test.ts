import { describe, expect, it } from 'vitest'
import { maskLabels, maskedRuns } from './rules'

/** The masked text of each line, e.g. [[], ['sk-proj-...']]. */
function masked(lines: string[]): string[][] {
  const labels = maskLabels(lines)
  return lines.map((text, n) => maskedRuns(labels[n]!).map(([start, end]) => text.slice(start, end)))
}

/** Every masked piece of text, flattened. */
const hidden = (lines: string[]) => masked(lines).flat()

describe('setup keys', () => {
  it('masks a line that is a base32 authenticator setup key', () => {
    expect(hidden(['Can’t scan? Enter this key', 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP'])).toEqual([
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP'
    ])
    expect(hidden(['  JBSWY3DPEHPK3PXPJBSWY3DP '])).toEqual(['JBSWY3DPEHPK3PXPJBSWY3DP'])
  })

  it('leaves capitals without two digits and short groups alone', () => {
    expect(hidden(['ABCD EFGH IJKL MNOP', 'JBSW Y3DP EHPK', 'JBSW Y3DP EHPK 3PXP and more'])).toEqual([])
  })
})

describe('password managers', () => {
  const vault = ['Bitwarden', 'GitHub', 'octocat', 'Tr0ub4dor&3x', 'notes.txt', 'https://github.com/login', 'Summer24']

  it('masks password-like lines on a password manager screen', () => {
    expect(hidden(vault)).toEqual(['Tr0ub4dor&3x'])
  })

  it('needs the password manager name in a short line', () => {
    expect(hidden(vault.slice(1))).toEqual([])
    expect(hidden(['I read a review of Bitwarden and other tools today', ...vault.slice(1)])).toEqual([])
  })

  it('unmasks plain words with punctuation unless password wording is near', () => {
    expect(hidden(['Bitwarden', 'a', 'b', 'c', 'really?'])).toEqual([])
    expect(hidden(['Bitwarden', 'Password', 'really?'])).toEqual(['really?'])
  })
})

describe('labeled passwords', () => {
  it('masks a password handed to a command-line tool, not its port', () => {
    expect(hidden(['$ redis-cli -h cache.local -p 6379 -a S3cr3tPassw0rd! ping'])).toEqual(['S3cr3tPassw0rd!'])
    expect(hidden(['mysql -u root --password=hunter2hunter shop'])).toEqual(['hunter2hunter'])
    expect(hidden(['psql -p 5432 -U admin'])).toEqual([])
  })

  it('masks the password of curl -u and of a "user:pass https://" pair', () => {
    expect(hidden(['curl -u admin:s3cr3tpass https://api.example.com/v1'])).toEqual(['s3cr3tpass'])
    expect(hidden(['deploy:Pa55w0rd! https://ci.example.com'])).toEqual(['Pa55w0rd!'])
  })

  it('masks a revealed value next to its Hide button', () => {
    expect(hidden(['Xk9#mP2$vL Hide Copy'])).toEqual(['Xk9#mP2$vL'])
    expect(hidden(['Show more Hide'])).toEqual([])
  })

  it('masks the last word of a short line that starts with Password', () => {
    expect(hidden(['Password   Tr0ub4dor&3x'])).toEqual(['Tr0ub4dor&3x'])
    expect(hidden(['Wi-Fi password: c0rrect-h0rse'])).toEqual(['c0rrect-h0rse'])
    expect(hidden(['Password: hello', 'Password Manager Settings', 'Password reset link sent to you@example.com'])).toEqual([])
  })
})

describe('private key blocks', () => {
  it('masks base64 lines after a BEGIN PRIVATE KEY line, until END', () => {
    const lines = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
      'QyNTUxOQAAACBzZWNyZXRrZXlzZWNyZXRrZXlzZWNyZXRrZXk=',
      '-----END OPENSSH PRIVATE KEY-----',
      'aGVsbG8gd29ybGQxMjM0NQ'
    ]
    expect(masked(lines)).toEqual([[], [lines[1]], [lines[2]], [], []])
  })

  it('treats a key file title as the start, but not a shell command naming it', () => {
    expect(hidden(['id_ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIGkey123'])).toEqual(['AAAAC3NzaC1lZDI1NTE5AAAAIGkey123'])
    expect(hidden(['$ cat ~/.ssh/id_rsa', 'AAAAC3NzaC1lZDI1NTE5AAAAIGkey123'])).toEqual([])
  })
})

describe('seed phrases', () => {
  const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  it('masks 12 BIP39 words that pass the checksum', () => {
    expect(hidden([valid])).toEqual(valid.split(' '))
  })

  it('masks numbered words that count up from 1, without a checksum', () => {
    const lines = ['1. ocean 2. river 3. table 4. window', '5. garden 6. pencil 7. rocket 8. silver', '9. tunnel 10. vacuum 11. wagon 12. yellow']
    expect(hidden(lines)).toHaveLength(12)
    expect(hidden(lines)).toContain('ocean')
  })

  it('masks words under a recovery phrase heading', () => {
    const words = 'ocean river table window garden pencil rocket silver tunnel vacuum wagon yellow'
    expect(hidden([words])).toEqual([])
    expect(hidden(['Write down your recovery phrase', words])).toHaveLength(12)
  })

  it('needs 12 words and lines holding nothing else', () => {
    expect(hidden(['Write down your recovery phrase', 'ocean river table'])).toEqual([])
    expect(hidden(['recovery phrase', `${valid} is the test vector`])).toEqual([])
  })
})

describe('recovery codes', () => {
  it('masks codes under a recovery or backup code heading', () => {
    expect(hidden(['Your recovery codes', '1. a1b2c-3d4e5    2. f6g7h-8i9j0', '1234 5678'])).toEqual([
      'a1b2c-3d4e5',
      'f6g7h-8i9j0',
      '1234',
      '5678'
    ])
  })

  it('leaves codes alone without the heading, or more than eight lines below it', () => {
    expect(hidden(['Build a1b2c-3d4e5 passed'])).toEqual([])
    const far = ['Backup codes', ...Array.from({ length: 8 }, () => 'text'), 'a1b2c-3d4e5']
    expect(hidden(far)).toEqual([])
    expect(hidden(['Backup codes', ...Array.from({ length: 7 }, () => 'text'), 'a1b2c-3d4e5'])).toEqual(['a1b2c-3d4e5'])
  })
})

describe('key prefixes', () => {
  it('masks tokens with a well-known key prefix', () => {
    // Upstream's own example (PrivacyShieldUpgradeModal.swift).
    expect(hidden(['API key sk-proj-7Fq2xL9mWc4RbT'])).toEqual(['sk-proj-7Fq2xL9mWc4RbT'])
    expect(hidden(['export OPENAI_API_KEY=sk-proj-7Fq2xL9mWc4RbTzq81Hk'])).toEqual(['sk-proj-7Fq2xL9mWc4RbTzq81Hk'])
    expect(hidden(['token: ghp_16C7e42F292c6912E7710c838347Ae178B4a'])).toEqual(['ghp_16C7e42F292c6912E7710c838347Ae178B4a'])
    expect(hidden(['aws_access_key_id = AKIAIOSFODNN7EXAMPLE'])).toEqual(['AKIAIOSFODNN7EXAMPLE'])
    expect(hidden(['SLACK=xoxb-1234567890-abcdefghij'])).toEqual(['xoxb-1234567890-abcdefghij'])
  })

  it('needs the prefix at the start of a token and enough characters after it', () => {
    expect(hidden(['the task-management-tool sk-short', 'ghp_short'])).toEqual([])
  })
})

describe('ordinary screen text', () => {
  it('masks nothing', () => {
    expect(
      hidden([
        'Meeting notes: ship the release on Friday at 4:30 PM',
        'Password reset',
        'git commit -m "fix: login"',
        'npm install --save-exact tesseract.js@7.0.0'
      ])
    ).toEqual([])
  })
})
