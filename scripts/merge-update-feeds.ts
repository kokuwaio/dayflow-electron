// Merges the latest.yml files of the per-architecture Windows builds into one.
// electron-builder builds one NSIS installer per run (x64, then arm64) and
// each run overwrites dist/latest.yml with only its own installer.
// electron-updater picks the file whose name contains its architecture, so
// the feed must list both. Node 24 runs this file directly (type stripping):
//
//   node scripts/merge-update-feeds.ts <out.yml> <in.yml>...
//
// The feeds are electron-builder's own YAML (js-yaml dump): top-level keys
// at column 0, the "files" list indented below. Keeps the first feed and
// appends the other feeds' "files" entries.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Splits a feed into its top-level keys, each with its lines. */
function blocks(text: string): Array<{ key: string; lines: string[] }> {
  const out: Array<{ key: string; lines: string[] }> = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const top = /^([A-Za-z0-9_]+):/.exec(line)
    if (top?.[1]) out.push({ key: top[1], lines: [line] })
    else if (out.length) out[out.length - 1]?.lines.push(line)
    else throw new Error(`Unexpected line before the first key: ${line}`)
  }
  return out
}

export function mergeFeeds(texts: string[]): string {
  const feeds = texts.map(blocks)
  const first = feeds[0]
  if (!first) throw new Error('No feeds given.')
  const version = (f: typeof first) => f.find((b) => b.key === 'version')?.lines[0]
  const entries = feeds.map((f) => f.find((b) => b.key === 'files')?.lines.slice(1) ?? [])
  if (feeds.some((f) => version(f) !== version(first))) throw new Error('The feeds\' versions differ.')
  if (entries.some((e) => e.length === 0)) throw new Error('A feed lists no files.')
  return `${first
    .flatMap((b) => (b.key === 'files' ? [b.lines[0] ?? 'files:', ...entries.flat()] : b.lines))
    .join('\n')}\n`
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [out, ...inputs] = process.argv.slice(2)
  if (!out || inputs.length === 0) {
    console.error('usage: node scripts/merge-update-feeds.ts <out.yml> <in.yml>...')
    process.exit(2)
  }
  // Read everything first: the output may be one of the inputs.
  const merged = mergeFeeds(inputs.map((file) => readFileSync(file, 'utf8')))
  writeFileSync(out, merged)
}
