/** One way to materialize the patched tikz-editor fork: the pinned upstream commit plus ZETTLR.patch and the embed app. */

import { execFileSync } from 'node:child_process'
import { appendFile, cp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const vendor = path.join(root, 'vendor', 'tikz-editor')
export const patchFile = path.join(vendor, 'ZETTLR.patch')

// Files the checkout holds that are not fork source: the copied embed app and codec, dependencies, generated grammar.
const NOT_FORK_SOURCE = [ 'node_modules/', 'apps/zettlr-embed/', 'packages/app/src/original-ink.ts', 'packages/lezer-tikz/src/grammar/tikz-parser.ts', 'packages/lezer-tikz/src/grammar/tikz-parser.terms.ts' ]

function provenanceValue (text, key) {
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]+)"$`, 'm').exec(text)
  if (match === null) throw new Error(`vendor/tikz-editor/PROVENANCE.toml does not declare ${key}`)
  return match[1]
}

export function run (command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env })
}

export async function pinnedUpstream () {
  const provenance = await readFile(path.join(vendor, 'PROVENANCE.toml'), 'utf8')
  const repository = provenanceValue(provenance, 'upstream_repository')
  const commit = provenanceValue(provenance, 'upstream_commit')
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`Pinned tikz-editor commit is not a full Git object id: ${commit}`)
  return { repository, commit }
}

/** Clone the pinned commit into `upstream` (a path that must not exist) with the fork patch applied, staged, and dependencies installed. */
export async function materialize (upstream) {
  const { repository, commit } = await pinnedUpstream()
  run('git', [ 'clone', '--quiet', '--no-checkout', repository, upstream ], root)
  run('git', [ '-C', upstream, 'checkout', '--quiet', '--detach', commit ], root)
  const observed = execFileSync('git', [ '-C', upstream, 'rev-parse', 'HEAD' ], { encoding: 'utf8' }).trim()
  if (observed !== commit) throw new Error(`tikz-editor checkout drifted: expected ${commit}, observed ${observed}`)
  await appendFile(path.join(upstream, '.git', 'info', 'exclude'), NOT_FORK_SOURCE.map(entry => `/${entry}`).join('\n') + '\n')
  run('git', [ '-C', upstream, 'apply', '--index', patchFile ], root)
  await syncEmbed(upstream)
  run('bun', [ 'install', '--no-save' ], upstream)
  run('bunx', [ 'lezer-generator', '--typeScript', 'src/grammar/tikz.grammar', '-o', 'src/grammar/tikz-parser.ts' ], path.join(upstream, 'packages/lezer-tikz'))
}

/** Copy the repository-owned embed app and the original-ink codec into the checkout. */
export async function syncEmbed (upstream) {
  const embedApp = path.join(upstream, 'apps', 'zettlr-embed')
  await cp(path.join(vendor, 'embed'), embedApp, { recursive: true })
  // The drawing tools and public host boundary use one original-ink codec.
  await cp(path.join(vendor, 'embed/src/original-ink.ts'), path.join(upstream, 'packages/app/src/original-ink.ts'))
  await writeFile(
    path.join(embedApp, 'index.html'),
    '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TikZ Editor</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n'
  )
  return embedApp
}

/** The fork patch: every change in the checkout against the pinned commit. */
export async function forkPatch (upstream) {
  const { commit } = await pinnedUpstream()
  run('git', [ '-C', upstream, 'add', '--all' ], root)
  // bun install rewrites upstream's lockfile; the fork never changes dependencies.
  return execFileSync('git', [ '-C', upstream, 'diff', '--cached', commit, '--', '.', ':(exclude)bun.lock' ], { encoding: 'utf8', maxBuffer: 1 << 28 })
}
