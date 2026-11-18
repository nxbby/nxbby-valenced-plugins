// Packages every plugin into build/dist/<id>@<version>.zip (manifest.json + built index.js).
// Run `bun run build` first.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'build', 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

for (const name of readdirSync(join(root, 'plugins'))) {
	const dir = join(root, 'plugins', name)
	const manifestPath = join(dir, 'manifest.json')
	if (!existsSync(manifestPath)) continue

	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
	const script = manifest.dist?.script
	const bundle = join(dir, 'build', 'js', 'index.js')
	if (script && !existsSync(bundle)) {
		throw new Error(`Missing bundle for ${manifest.id}: run "bun run build" first`)
	}

	const stage = join(root, 'build', 'stage', name)
	rmSync(stage, { recursive: true, force: true })
	mkdirSync(stage, { recursive: true })
	cpSync(manifestPath, join(stage, 'manifest.json'))
	if (script) cpSync(bundle, join(stage, script))
	if (existsSync(join(dir, 'assets'))) cpSync(join(dir, 'assets'), join(stage, 'assets'), { recursive: true })

	const zip = join(dist, `${manifest.id}@${manifest.version}.zip`)
	execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: stage })
	console.log(`Packaged ${manifest.id}@${manifest.version}`)
}
