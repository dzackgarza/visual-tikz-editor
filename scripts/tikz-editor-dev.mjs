#!/usr/bin/env node
/**
 * The fast edit loop for the tikz-editor fork, in one persistent checkout under .cache/tikz-editor:
 *   checkout  materialize the pinned commit with ZETTLR.patch applied (once)
 *   watch     rebuild the embed into vendor/tikz-editor/src on every save
 *   patch     typecheck, then write the checkout's changes to ZETTLR.patch
 * `just update-tikz-editor-vendor` still rebuilds from scratch to prove the patch reproduces the assets.
 */

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { forkPatch, materialize, patchFile, root, run, syncEmbed, vendor } from './tikz-editor-checkout.mjs'

const checkout = path.join(root, '.cache', 'tikz-editor')
const command = process.argv[2]

if (command === 'checkout') {
  if (existsSync(checkout)) throw new Error(`${checkout} already exists; it holds fork edits, so it is never replaced`)
  await materialize(checkout)
} else if (command === 'watch') {
  if (!existsSync(checkout)) throw new Error(`No fork checkout at ${checkout}; run \`just tikz-editor-checkout\``)
  const embedApp = await syncEmbed(checkout)
  // The assets keep vendor/tikz-editor/src/mathjax, which the full rebuild ships beside them.
  run('bunx', [ 'vite', 'build', '--watch', '--outDir', path.join(vendor, 'src'), '--emptyOutDir', 'false' ], embedApp)
} else if (command === 'patch') {
  if (!existsSync(checkout)) throw new Error(`No fork checkout at ${checkout}; run \`just tikz-editor-checkout\``)
  const embedApp = await syncEmbed(checkout)
  run('bunx', [ '--package', 'typescript@5.9.3', 'tsc', '--noEmit', '-p', path.join(embedApp, 'tsconfig.json') ], checkout)
  await writeFile(patchFile, await forkPatch(checkout))
} else {
  throw new Error(`Usage: tikz-editor-dev.mjs checkout | watch | patch (got ${command})`)
}
