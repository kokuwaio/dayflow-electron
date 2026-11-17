// Secret masking rules, ported from upstream Core/PrivacyShield/PIIMaskRules.swift
// (and the Python helpers of PIIText.swift). Upstream runs these passes over the
// per-character labels of its privacy model; that model is served from upstream's
// paid backend, so here every line starts unlabeled and only the passes that add
// masks on their own do anything: setup keys, password manager screens, labeled
// passwords, private key blocks, seed phrases, recovery codes and key prefixes.
// The passes that only remove model guesses still run in upstream's order where a
// rule's mask can reach them (plain guesses, OAuth noise, bare numbers); the
// others (orphan domains, plain URLs, token fill, edge trim) only touch model
// labels and are left out.
//
// Positions are UTF-16 indices into each line (upstream uses code points; they
// differ only for characters outside the BMP). Lengths that upstream compares
// with thresholds are counted in code points.

import { createHash } from 'node:crypto'
import { BIP39_ENGLISH } from './bip39-english'

/** The privacy model's labels, in upstream's order (`PIILabel`). */
export const LABEL = {
  none: 0,
  secret: 1,
  privateKey: 2,
  password: 3,
  oneTimeCode: 4,
  secretURL: 5,
  crypto: 6,
  card: 7,
  bank: 8,
  amount: 9,
  govID: 10,
  email: 11,
  phone: 12
} as const

/** What gets hidden: keys and tokens, private keys, passwords, cards, bank details and government IDs. */
const MASKED = new Set<number>([LABEL.secret, LABEL.privateKey, LABEL.password, LABEL.card, LABEL.bank, LABEL.govID])

type Labels = number[]

/**
 * One label per UTF-16 unit of each line (0 = keep), after upstream's rule
 * passes in upstream's order. `bip39` is the seed phrase word list.
 */
export function maskLabels(texts: readonly string[], bip39: readonly string[] = BIP39_ENGLISH): Labels[] {
  const preds = texts.map((t) => new Array<number>(t.length).fill(0))
  maskSetupKeys(texts, preds)
  maskVaultPasswords(texts, preds)
  unmaskPlainGuesses(texts, preds)
  maskLabeledPasswords(texts, preds)
  maskKeyBlocks(texts, preds)
  unmaskOAuthNoise(texts, preds)
  unmaskBareNumbers(texts, preds)
  maskSeedPhrases(texts, preds, bip39)
  labelCodes(texts, preds)
  maskRecoveryCodes(texts, preds)
  // The stand-in code labels have done their job; key prefixes only fill unlabeled text.
  for (const pred of preds) for (let k = 0; k < pred.length; k++) if (pred[k] === LABEL.oneTimeCode) pred[k] = 0
  maskKeyPrefixes(texts, preds)
  return preds
}

/** [start, end) of each run of masked labels (upstream PrivacyShieldFrameMasker.maskedRuns). */
export function maskedRuns(pred: readonly number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let i = 0
  while (i < pred.length) {
    if (!MASKED.has(pred[i]!)) {
      i++
      continue
    }
    let j = i
    while (j < pred.length && MASKED.has(pred[j]!)) j++
    runs.push([i, j])
    i = j
  }
  return runs
}

// ---- Python str and re helpers (upstream PIIPython, PIIRegex)

const isSpace = (c: string) => /\s/u.test(c)
const isAlpha = (c: string) => /\p{L}/u.test(c)
const isDigit = (c: string) => /\p{Nd}/u.test(c)
const isAlnum = (c: string) => /[\p{L}\p{N}]/u.test(c)
const isUpper = (c: string) => /\p{Uppercase}/u.test(c)
const isLower = (c: string) => /\p{Lowercase}/u.test(c)
const chars = (s: string) => [...s]
const count = (s: string) => chars(s).length
const isAllDigits = (s: string) => s !== '' && chars(s).every(isDigit)

/** `s.strip()`, or `s.strip(set)` with a set of characters. */
function strip(s: string, set?: string): string {
  const drop = set === undefined ? isSpace : (c: string) => set.includes(c)
  const cs = chars(s)
  let lo = 0
  let hi = cs.length
  while (lo < hi && drop(cs[lo]!)) lo++
  while (hi > lo && drop(cs[hi - 1]!)) hi--
  return cs.slice(lo, hi).join('')
}

const split = (s: string) => s.split(/\s+/u).filter((w) => w !== '')

/** `pattern.search(s)`. */
const search = (re: RegExp, s: string) => re.test(s)

/** `pattern.match(s)`: a match that starts at 0. */
function matchesStart(re: RegExp, s: string): boolean {
  return new RegExp(re.source, `${re.flags}y`).test(s)
}

/** `pattern.fullmatch(s)`. */
function fullMatch(re: RegExp, s: string): boolean {
  return new RegExp(`^(?:${re.source})$`, re.flags).test(s)
}

interface Match {
  start: number
  end: number
  groups: Record<string, [number, number] | undefined>
}

function toMatch(m: RegExpExecArray): Match {
  const groups: Match['groups'] = {}
  for (const [name, span] of Object.entries(m.indices?.groups ?? {})) groups[name] = span
  return { start: m.index, end: m.index + m[0].length, groups }
}

/** `pattern.finditer(s, from)`: earlier text stays visible to lookbehinds, `^` no longer matches. */
function matches(re: RegExp, s: string, from = 0): Match[] {
  const g = new RegExp(re.source, `${re.flags}gd`)
  g.lastIndex = from
  const out: Match[] = []
  let m: RegExpExecArray | null
  while ((m = g.exec(s))) {
    out.push(toMatch(m))
    if (m[0] === '') g.lastIndex++
  }
  return out
}

/** `pattern.search(s[:to])`. */
function firstMatch(re: RegExp, s: string, to = s.length): Match | null {
  const m = new RegExp(re.source, `${re.flags}d`).exec(s.slice(0, to))
  return m ? toMatch(m) : null
}

/** `pattern.match(s)`, with its groups. */
function matchAtStart(re: RegExp, s: string): Match | null {
  const m = new RegExp(re.source, `${re.flags}yd`).exec(s)
  return m ? toMatch(m) : null
}

function set(pred: Labels, start: number, end: number, label: number): void {
  for (let k = start; k < Math.min(end, pred.length); k++) pred[k] = label
}

/** (start, end, label) of each run of one nonzero label. */
function runs(pred: Labels): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  let i = 0
  while (i < pred.length) {
    if (pred[i] === 0) {
      i++
      continue
    }
    let j = i
    while (j < pred.length && pred[j] === pred[i]) j++
    out.push([i, j, pred[i]!])
    i = j
  }
  return out
}

const anyLabel = (pred: Labels, start = 0, end = pred.length) => pred.slice(start, end).some((l) => l !== 0)
const nearby = (texts: readonly string[], from: number, to: number, sep: string) =>
  texts.slice(Math.max(0, from), to + 1).join(sep)

// ---- Setup keys

const SETUP_KEY = /[A-Z2-7]{4}(?: ?[A-Z2-7]{4}){3,}/

/** A line that is only an authenticator setup key (base32 in groups of four, with two digits). */
function maskSetupKeys(texts: readonly string[], preds: Labels[]): void {
  texts.forEach((text, n) => {
    const value = strip(text)
    if (fullMatch(SETUP_KEY, value) && chars(value).filter(isDigit).length >= 2) {
      const start = text.indexOf(value)
      set(preds[n]!, start, start + value.length, LABEL.secret)
    }
  })
}

// ---- Password managers

const VAULT_SCREEN =
  /bitwarden|1password|lastpass|keepass|dashlane|proton pass|password manager|password generator|generate password|keychain access|passwords app/i
const VAULT_TITLE_WORDS = 5
const NOT_A_PASSWORD = /@|\/|\.\w{2,4}$|^www\.|^(?:ctr[il1]|cmd|shift|alt|option)\W/i
const WORD_AND_NUMBER = /[A-Z]?[a-z]+[_-]?\d{1,2}/
const EDGE_PUNCTUATION = '.,;:|()[]-_…\'"'

/**
 * One 6-40 character token with a letter and a digit or symbol, that isn't an
 * email, link, file, shortcut, sentence end or a word with a short number on the end.
 */
function passwordLike(value: string): boolean {
  const core = strip(value, EDGE_PUNCTUATION)
  const length = count(core)
  if (length < 6 || length > 40 || core.includes(' ') || search(NOT_A_PASSWORD, core) || fullMatch(WORD_AND_NUMBER, core)) {
    return false
  }
  const cs = chars(core)
  const hasLetter = cs.some(isAlpha)
  const hasDigit = cs.some(isDigit)
  const hasSymbol = cs.some((c) => !isAlnum(c) && !'-_.'.includes(c))
  return hasLetter && (hasDigit || hasSymbol)
}

/** On a password manager screen, every line that is one password-like token. */
function maskVaultPasswords(texts: readonly string[], preds: Labels[]): void {
  const isVault = texts.some((t) => search(VAULT_SCREEN, t) && split(t).length <= VAULT_TITLE_WORDS)
  if (!isVault) return
  texts.forEach((text, n) => {
    const value = strip(text)
    // Upstream's passphrase_like needs zxcvbn and is left out there too.
    if (passwordLike(value) && !anyLabel(preds[n]!)) {
      const start = text.indexOf(value)
      set(preds[n]!, start, start + value.length, LABEL.password)
    }
  })
}

// ---- Plain guesses

const GUESS_TIME = new RegExp(
  String.raw`^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+)?(?:[A-Z][a-z]{2}\s+\d{1,2},?\s+)?[0-9OoBSlI]{1,2}[:.][0-9OoBSlI]{2}` +
    String.raw`(?::[0-9OoBSlI]{2})?\s*(?:[AaPp]\.?[Mm]\.?)?$`
)
const GUESS_CLOCK = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|S\w?n)\S*[^\s]{0,8}[AP]M$/
const GUESS_CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/
const GUESS_WORDS = /^(?:[A-Z][a-z]+(?:-[A-Za-z][a-z]+)*\+?|[a-z]+(?:['’][a-z]{1,2}|[?!]))$/
const GUESS_VERSION = /^[A-Za-z]{2,}-\d{1,2}\.\d{1,2}$/
const GUESS_PERCENT = /^\W*\w?\d{1,3}%\W*$/
const GUESS_FILE = /\.(?:mp4|mov|m4a|mp3|wav|jpe?g|png|gif|webp|heic|pdf|docx?|xlsx?|pptx?|zip|txt|csv|json|html?)$/i
const GUESS_ID =
  /^(?:req|dpl|session|sess|msg|evt|cus|ch|pi|sub|prod|price|in|inv|toolu|run|job|org|proj|acct|file|batch)_[A-Za-z0-9]{8,}$/
const GUESS_PARAM = /[?&](?:pl|pp|si|feature|ref|list|v|t|utm_\w+|op)=$/
const GUESS_PASSWORD_CONTEXT = /pass(?:word|code|phrase)?\b|\bpw\b|\bpwd\b|\bpin\b|login|sign.?in|credential/i
const NON_SPACE = /\S+/
const URL_PATH = /\/[A-Za-z]{3,}/

/**
 * Unmasks guesses that are ordinary screen text: clock times, CJK, file names,
 * known non-secret ids, number labels with no digit, and capitalized words or
 * versions guessed as passwords with no password wording near.
 */
function unmaskPlainGuesses(texts: readonly string[], preds: Labels[]): void {
  const numbers = new Set<number>([LABEL.card, LABEL.bank, LABEL.govID])
  const clear = (pred: Labels, start: number, end: number) => {
    for (let k = start; k < end; k++) if (MASKED.has(pred[k]!)) pred[k] = 0
  }
  texts.forEach((text, index) => {
    const pred = preds[index]!
    const nearPassword = texts.slice(Math.max(0, index - 3), index + 1).some((t) => search(GUESS_PASSWORD_CONTEXT, t))

    for (const token of matches(NON_SPACE, text)) {
      const labels = pred.slice(token.start, token.end).filter((l) => MASKED.has(l))
      const raw = text.slice(token.start, token.end)
      const value = strip(raw, '.,;:)')
      if (
        labels.length > 0 &&
        (search(GUESS_CJK, raw) ||
          (labels.includes(LABEL.secret) &&
            (search(GUESS_FILE, value) || (matchesStart(GUESS_ID, value) && !value.toLowerCase().includes('secret')))))
      ) {
        clear(pred, token.start, token.end)
      }
    }

    for (const [start, end] of maskedRuns(pred)) {
      const value = strip(text.slice(start, end))
      const labels = new Set(pred.slice(start, end).filter((l) => MASKED.has(l)))
      const only = (label: number) => labels.size === 1 && labels.has(label)
      if (matchesStart(GUESS_TIME, value) || firstMatch(GUESS_PARAM, text, start)) {
        clear(pred, start, end)
      } else if ([...labels].every((l) => numbers.has(l)) && !chars(value).some(isDigit)) {
        clear(pred, start, end)
      } else if (only(LABEL.card) && search(URL_PATH, value)) {
        clear(pred, start, end)
      } else if (
        only(LABEL.password) &&
        !nearPassword &&
        (matchesStart(GUESS_WORDS, value) ||
          matchesStart(GUESS_VERSION, value) ||
          matchesStart(GUESS_CLOCK, value) ||
          matchesStart(GUESS_PERCENT, value))
      ) {
        clear(pred, start, end)
      }
    }
  })
}

// ---- Labeled passwords

const CLI_TOOL = new RegExp(
  String.raw`\b(?:redis-cl[il1]|mysql\w*|mariadb\w*|sshpass|mongo(?:sh|dump|restore)?|mosquitto_\w+|smbclient|docker login|` +
    String.raw`podman login|helm registry login|rabbitmqadmin|influx|clickhouse-client)\b`,
  'i'
)
const CLI_PASSWORD_FLAG = /\s(?:-a|-p|--pass(?:word)?|--auth)(?:\s+|=)?['"]?(?<value>[^\s'"]{4,})/
const CLI_USER_PASS = /\b(?:curl|http|wget)\b.*?\s(?:-u|--user)\s+['"]?[^\s:'"]+:(?<value>[^\s'"]{4,})/
const BASIC_AUTH_PAIR = /(?:^|\s)[\w.-]{1,32}:(?<value>[^\s:/@'"]{6,40})\s+https?:\/\//
const REVEALED_VALUE = /^\W{0,2}(?<value>[^\s•*]{8,})\s+Hide\b(?:\s+Copy)?\W*$/
const PASSWORD_LINE = /^\W*(?:wi-?fi\s+)?(?:password|passcode|passphrase|pin)\b/i

/**
 * Masks a password handed to a command-line tool, a "user:pass https://" pair,
 * a revealed value next to its Hide button, and the last word of a short line
 * that starts with "Password" when that word looks like one.
 */
function maskLabeledPasswords(texts: readonly string[], preds: Labels[]): void {
  texts.forEach((text, n) => {
    const pred = preds[n]!
    const hits: Array<[number, number]> = []
    const tool = firstMatch(CLI_TOOL, text)
    if (tool) {
      for (const m of matches(CLI_PASSWORD_FLAG, text, tool.end)) if (m.groups.value) hits.push(m.groups.value)
    }
    for (const m of matches(CLI_USER_PASS, text)) if (m.groups.value) hits.push(m.groups.value)
    for (const [start, end] of hits) {
      const value = text.slice(start, end)
      // "-p 6379" is a port.
      if (!value.startsWith('-') && !isAllDigits(value)) set(pred, start, end, LABEL.password)
    }

    const pair = firstMatch(BASIC_AUTH_PAIR, text)?.groups.value
    if (pair && passwordLike(text.slice(...pair))) set(pred, pair[0], pair[1], LABEL.password)

    const revealed = matchAtStart(REVEALED_VALUE, text)?.groups.value
    if (revealed && passwordLike(text.slice(...revealed)) && !anyLabel(pred, ...revealed)) {
      set(pred, revealed[0], revealed[1], LABEL.secret)
    }

    const words = split(text)
    const lastWord = words.at(-1)
    if (matchesStart(PASSWORD_LINE, text) && words.length >= 2 && words.length <= 4 && lastWord) {
      const last = strip(lastWord, EDGE_PUNCTUATION)
      // Upstream's zxcvbn alternative is left out there too.
      if (count(last) >= 6 && !matchesStart(PASSWORD_LINE, last) && passwordLike(last)) {
        const start = text.lastIndexOf(last)
        const end = start + last.length
        if (start >= 0 && !anyLabel(pred, start, end)) set(pred, start, end, LABEL.password)
      }
    }
  })
}

// ---- Private key blocks

const KEY_BLOCK_START = /BEGIN [A-Z ]*PRIVATE KEY/
const KEY_BLOCK_END = /END [A-Z ]*PRIVATE KEY/
const KEY_FILE_TITLE = /(?:\bid_\w+|\w+_(?:rsa|ed25519|ecdsa|dsa)|\.pem|\.key|\.ppk)\W*$/
const SHELL_PROMPT = /[%$#]\s/
const KEY_BLOCK_LINES = 40
const BASE64_RUN = /[A-Za-z0-9+/=]{8,}/

function base64Like(run: string): boolean {
  const cs = chars(run)
  const kinds = [cs.some(isUpper), cs.some(isLower), cs.some(isDigit)].filter(Boolean).length
  return kinds === 3 || (cs.length >= 30 && kinds >= 2)
}

/** Base64 runs in the 40 lines after a BEGIN PRIVATE KEY line or a key file's title, up to the END line. */
function maskKeyBlocks(texts: readonly string[], preds: Labels[]): void {
  let left = 0
  texts.forEach((text, n) => {
    if (search(KEY_BLOCK_END, text)) {
      left = 0
      return
    }
    if (search(KEY_BLOCK_START, text) || (search(KEY_FILE_TITLE, text) && !search(SHELL_PROMPT, text))) {
      left = KEY_BLOCK_LINES
      return
    }
    if (left === 0) return
    left--
    const pred = preds[n]!
    for (const run of matches(BASE64_RUN, text)) {
      if (!base64Like(text.slice(run.start, run.end))) continue
      for (let k = run.start; k < run.end; k++) if (pred[k] === 0) pred[k] = LABEL.privateKey
    }
  })
}

// ---- OAuth noise

const OAUTH_URL = /oauth|authorize|\/auth\b|signin|sign-in|login|reauth|consent|ServiceLogin|accountchooser|\/o\/saml/i
const URL_CREDENTIAL = new RegExp(
  String.raw`access_token|refresh_token|id_token|[?&#](?:token|key|sig|signature|password|pwd|secret|code|authcode|otp|ticket)=|` +
    String.raw`X-Amz-Signature|X-Goog-Signature|reset|magic|verify|confirm`,
  'i'
)
const OAUTH_PARAM_BEFORE = /(?:[?&]|\b)(?:state|nonce|code_challenge|client_id|redirect_uri|login_hint|flowName)=\s*$/i

/** Unmasks OAuth flow values (state, nonce, client_id, ...) that are not credentials. */
function unmaskOAuthNoise(texts: readonly string[], preds: Labels[]): void {
  texts.forEach((text, n) => {
    const pred = preds[n]!
    for (const [i, j, label] of runs(pred)) {
      const value = text.slice(i, j)
      if (label === LABEL.secretURL && search(OAUTH_URL, value) && !search(URL_CREDENTIAL, value)) {
        set(pred, i, j, 0)
      } else if (
        (label === LABEL.secret || label === LABEL.password || label === LABEL.secretURL) &&
        firstMatch(OAUTH_PARAM_BEFORE, text, i)
      ) {
        set(pred, i, j, 0)
      }
    }
  })
}

// ---- Bare numbers

const SECRET_WORDS = new RegExp(
  String.raw`pass|pwd|\bpin\b|code|key|token|secret|api|auth|bearer|credential|login|sign.?in|ssn|account|routing|` +
    String.raw`iban|card|cvv|wi-?fi|combo|combination`,
  'i'
)

/** Unmasks a password or secret of 8 or fewer digits with no password, PIN, code or key word on its line or the two above. */
function unmaskBareNumbers(texts: readonly string[], preds: Labels[]): void {
  texts.forEach((text, index) => {
    if (search(SECRET_WORDS, nearby(texts, index - 2, index, ' '))) return
    const pred = preds[index]!
    for (const [i, j, label] of runs(pred)) {
      const value = strip(text.slice(i, j), ' .,:;()')
      if ((label === LABEL.secret || label === LABEL.password) && isAllDigits(value) && count(value) <= 8) {
        set(pred, i, j, 0)
      }
    }
  })
}

// ---- Seed phrases

const SEED_CONTEXT = /recovery|seed|mnemonic|secret phrase|backup phrase|passphrase|wallet|\bwords?\b/i
const SEED_NUMBER = /\d{1,2}[.):]?/
const SEED_LENGTHS = [12, 15, 18, 21, 24]
const SEED_CONTEXT_LINES = 4

type SeedWord = [start: number, end: number, word: string]

/** The seed words on a line and its slot numbers, or null when the line holds anything else. */
function seedLineWords(text: string, wordlist: ReadonlySet<string>): { words: SeedWord[]; numbers: number[] } | null {
  const words: SeedWord[] = []
  const numbers: number[] = []
  let afterNumber = false
  for (const token of matches(NON_SPACE, text)) {
    const raw = text.slice(token.start, token.end)
    if (fullMatch(SEED_NUMBER, raw)) {
      numbers.push(Number(strip(raw, '.):')))
      afterNumber = true
      continue
    }
    const word = strip(raw, '.,;:()[]"\'').toLowerCase()
    const length = count(word)
    const isWord = wordlist.has(word) || (afterNumber && chars(word).every(isAlpha) && length >= 3 && length <= 8)
    if (word === '' || !isWord) return null
    const offset = raw.toLowerCase().indexOf(word)
    if (offset < 0) return null
    const start = token.start + offset
    words.push([start, start + word.length, word])
    afterNumber = false
  }
  return { words, numbers }
}

/**
 * Masks a wallet recovery phrase: a block of lines holding only 12+ seed words
 * and slot numbers, when the slots count up from 1, a recovery/seed/wallet word
 * is near, or the BIP39 checksum passes.
 */
function maskSeedPhrases(texts: readonly string[], preds: Labels[], bip39: readonly string[]): void {
  if (bip39.length === 0) return
  const wordlist = new Set(bip39)
  const positions = new Map<string, number>()
  bip39.forEach((w, i) => positions.has(w) || positions.set(w, i))
  let block: Array<{ index: number; words: SeedWord[]; numbers: number[] }> = []

  const finish = () => {
    const words = block.flatMap((b) => b.words)
    const numbers = block.flatMap((b) => b.numbers)
    const first = block[0]
    const last = block.at(-1)
    if (words.length >= 12 && first && last) {
      const sorted = [...numbers].sort((a, b) => a - b)
      const counted = sorted.every((x, i) => x === i + 1) && numbers.length >= Math.floor(words.length / 2)
      if (
        counted ||
        search(SEED_CONTEXT, nearby(texts, first.index - SEED_CONTEXT_LINES, last.index, ' ')) ||
        seedChecksumOK(words.map((w) => w[2]), positions)
      ) {
        for (const entry of block) {
          for (const [start, end] of entry.words) set(preds[entry.index]!, start, end, LABEL.secret)
        }
      }
    }
    block = []
  }

  texts.forEach((text, index) => {
    const found = seedLineWords(text, wordlist)
    if (found && found.words.length > 0) block.push({ index, ...found })
    else finish()
  })
  finish()
}

/** True when some 12/15/18/21/24-word stretch passes the BIP39 checksum (python-mnemonic's `check`). */
function seedChecksumOK(words: string[], positions: ReadonlyMap<string, number>): boolean {
  for (const n of SEED_LENGTHS) {
    for (let i = 0; i + n <= words.length; i++) {
      if (bip39Check(words.slice(i, i + n).map((w) => w.normalize('NFKD')), positions)) return true
    }
  }
  return false
}

function bip39Check(words: string[], positions: ReadonlyMap<string, number>): boolean {
  const bits: boolean[] = []
  for (const word of words) {
    const position = positions.get(word)
    if (position === undefined) return false
    for (let shift = 10; shift >= 0; shift--) bits.push(((position >> shift) & 1) === 1)
  }
  const checksumLength = Math.floor(bits.length / 33)
  const entropyLength = checksumLength * 32
  const entropy = new Uint8Array(entropyLength / 8)
  for (let i = 0; i < entropyLength; i++) if (bits[i]) entropy[i >> 3]! |= 1 << (7 - (i % 8))
  const digest = createHash('sha256').update(entropy).digest()
  for (let i = 0; i < checksumLength; i++) {
    const expected = ((digest[i >> 3]! >> (7 - (i % 8))) & 1) === 1
    if (bits[entropyLength + i] !== expected) return false
  }
  return true
}

// ---- Recovery codes

const CODE_TOKEN = /^[A-Za-z0-9]+(?:[-–][A-Za-z0-9]+)*$/
const RECOVERY_CONTEXT = /recovery|backup code|back-up code|scratch code|emergency (?:kit|code)/i
const RECOVERY_CONTEXT_LINES = 8

/**
 * Stands in for the model's one-time code guesses, which maskRecoveryCodes
 * relabels: a token of letter and digit groups (joined by dashes) with at least
 * four letters or digits and at least one digit, like "a1b2c-3d4e5" or "1234".
 * Not upstream code: without the model, nothing else would ever be a code.
 */
function labelCodes(texts: readonly string[], preds: Labels[]): void {
  texts.forEach((text, n) => {
    const pred = preds[n]!
    for (const token of matches(NON_SPACE, text)) {
      const value = strip(text.slice(token.start, token.end), '.,;:()[]"\'')
      if (!fullMatch(CODE_TOKEN, value) || !chars(value).some(isDigit)) continue
      if (chars(value).filter(isAlnum).length < 4) continue
      const start = text.indexOf(value, token.start)
      if (anyLabel(pred, start, start + value.length)) continue
      set(pred, start, start + value.length, LABEL.oneTimeCode)
    }
  })
}

/** Relabels one-time codes as secret under a recovery or backup code heading (on the line or the eight above). */
function maskRecoveryCodes(texts: readonly string[], preds: Labels[]): void {
  preds.forEach((pred, index) => {
    if (!pred.includes(LABEL.oneTimeCode)) return
    if (!search(RECOVERY_CONTEXT, nearby(texts, index - RECOVERY_CONTEXT_LINES, index, ' '))) return
    for (let k = 0; k < pred.length; k++) if (pred[k] === LABEL.oneTimeCode) pred[k] = LABEL.secret
  })
}

// ---- Key prefixes

const KEY_PREFIX = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:sk-(?:proj-|ant-(?:api\d\d-)?)?[A-Za-z0-9_-]{10,}|[sr]k_(?:live|test)_[A-Za-z0-9]{10,}` +
    String.raw`|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|glpat-[\w-]{16,}` +
    String.raw`|whsec_\w{16,}|npm_\w{20,}|hf_\w{20,}|AIza[\w-]{20,}|fw_\w{15,}|figd_[\w-]{16,}|shp(?:at|ss|ca)_\w{16,}` +
    String.raw`|sq0(?:atp|csp)-[\w-]{16,}|dop_v1_\w{20,})`
)

/** Tokens with a well-known secret key prefix (sk-, ghp_, xoxb-, AKIA, ...). Runs last. */
function maskKeyPrefixes(texts: readonly string[], preds: Labels[]): void {
  texts.forEach((text, n) => {
    const pred = preds[n]!
    for (const m of matches(KEY_PREFIX, text)) {
      for (let k = m.start; k < m.end; k++) if (pred[k] === 0) pred[k] = LABEL.secret
    }
  })
}
