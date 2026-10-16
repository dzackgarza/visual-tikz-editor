#!/usr/bin/env node
/** Reconstruct the vendored tikz-editor embed from its pinned upstream commit. */

import { createRequire } from 'node:module'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { materialize, pinnedUpstream, root, run, vendor } from './tikz-editor-checkout.mjs'

const { commit } = await pinnedUpstream()
const temporary = await mkdtemp(path.join(os.tmpdir(), 'zettlr-tikz-editor-vendor-'))
try {
  const upstream = path.join(temporary, 'upstream')
  await materialize(upstream)
  const embedApp = path.join(upstream, 'apps', 'zettlr-embed')
  for (const name of [ 'lezer-tikz', 'lang-tikz', 'core' ]) {
    // The upstream workspace has no root TypeScript binary. Without an explicit
    // package, bunx can select an unrelated system tsc (4.8 on this host).
    run('bunx', [ '--package', 'typescript@5.9.3', 'tsc', '-p', path.join(upstream, `packages/${name}/tsconfig.json`) ], upstream)
  }
  run('bunx', [ '--package', 'typescript@5.9.3', 'tsc', '--noEmit', '-p', path.join(embedApp, 'tsconfig.json') ], upstream)
  run('bun', [ 'run', 'build' ], embedApp)

  const staged = path.join(temporary, 'src')
  await cp(path.join(embedApp, 'dist'), staged, { recursive: true })

  // tikz-editor's browser text engine normally bootstraps MathJax from a CDN.
  // The Zettlr fork points that loader at ./mathjax instead, so ship the exact
  // component package selected by the pinned upstream lockfile. The default
  // NewCM SVG font lives under MathJax's expected output/fonts component path.
  const coreRequire = createRequire(path.join(upstream, 'packages/core/package.json'))
  const appRequire = createRequire(path.join(upstream, 'packages/app/package.json'))
  const mathjax = path.dirname(coreRequire.resolve('mathjax/package.json'))
  const newcm = path.dirname(appRequire.resolve('@mathjax/mathjax-newcm-font/package.json'))
  const mathjaxPackage = JSON.parse(await readFile(path.join(mathjax, 'package.json'), 'utf8'))
  const newcmPackage = JSON.parse(await readFile(path.join(newcm, 'package.json'), 'utf8'))
  if (mathjaxPackage.version !== '4.1.1' || newcmPackage.version !== '4.1.1') {
    throw new Error(
      `Unexpected MathJax runtime versions: mathjax=${mathjaxPackage.version}, ` +
      `mathjax-newcm-font=${newcmPackage.version}`
    )
  }
  await cp(mathjax, path.join(staged, 'mathjax'), { recursive: true })
  const fontTarget = path.join(staged, 'mathjax', 'output', 'fonts', 'mathjax-newcm-font')
  await cp(path.join(newcm, 'svg.js'), path.join(fontTarget, 'svg.js'))
  await cp(path.join(newcm, 'svg'), path.join(fontTarget, 'svg'), { recursive: true })

  run('trash', [ path.join(vendor, 'src') ], root)
  await cp(staged, path.join(vendor, 'src'), { recursive: true })
  await cp(path.join(upstream, 'LICENSE'), path.join(vendor, 'LICENSE'))
  await cp(path.join(mathjax, 'LICENSE'), path.join(vendor, 'MATHJAX-LICENSE.txt'))
  // The NewCM npm package declares Apache-2.0 but does not ship a separate
  // LICENSE file; retain the same Apache-2.0 text beside the vendored assets.
  await cp(path.join(mathjax, 'LICENSE'), path.join(vendor, 'MATHJAX-NEWCM-LICENSE.txt'))
  console.log(`Rebuilt vendor/tikz-editor from ${commit}`)
} finally {
  // The build directory is this script's own scratch space (a clone plus a full
  // dependency install). Trashing it only moved it within the same filesystem,
  // which filled the disk after a few dozen rebuilds.
  await rm(temporary, { recursive: true })
}
