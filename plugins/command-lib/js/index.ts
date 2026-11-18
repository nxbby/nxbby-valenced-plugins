import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'

import type { Command } from '../../../types/nxbby-command-lib'

interface CommandsModule {
	getBuiltInCommands(...args: unknown[]): unknown
}

type RawCommand = Record<string, unknown> & { id?: string }

const registered: Command[] = []
// Built command objects are cached so React sees stable references
const built = new Map<Command, RawCommand>()
let loggedTemplate = false

function register(command: Command) {
	registered.push(command)
	return () => {
		const i = registered.indexOf(command)
		if (i !== -1) registered.splice(i, 1)
		built.delete(command)
	}
}

/**
 * Builds a command by copying a real built-in command first, so every field
 * Discord's command list and search index expect is present.
 */
function build(
	command: Command,
	builtIns: RawCommand[],
	index: number,
): RawCommand {
	const cached = built.get(command)
	if (cached) return cached

	const template =
		builtIns.find(c => c.applicationId === '-1') ?? builtIns[0] ?? {}

	const ids = builtIns
		.map(c => Number.parseInt(c.id ?? '', 10))
		.filter(Number.isFinite)
	// Take ids just below the lowest built-in command id
	const id = String((ids.length ? Math.min(...ids) : 0) - 1 - index)

	const result: RawCommand = {
		...template,
		id,
		name: command.name,
		displayName: command.name,
		untranslatedName: command.name,
		description: command.description,
		displayDescription: command.description,
		untranslatedDescription: command.description,
		type: 1, // CHAT
		inputType: 1, // BUILT_IN
		applicationId: '-1',
		options: (command.options ?? []).map(o => ({
			...o,
			displayName: o.displayName ?? o.name,
			displayDescription: o.displayDescription ?? o.description,
		})),
		execute: command.execute,
	}

	built.set(command, result)
	return result
}

export default plugin({
	start({ cleanup, decorate, logger }) {
		cleanup(
			getModules(withProps<CommandsModule>('getBuiltInCommands'), commands => {
				try {
					cleanup(
						after(commands, 'getBuiltInCommands', (args, ret) => {
							if (!Array.isArray(ret) || !registered.length) return ret
							try {
								const extra = registered.map((c, i) =>
									build(c, ret as RawCommand[], i),
								)
								if (!loggedTemplate) {
									loggedTemplate = true
									// Diagnostic: shows what Discord's own commands look like
									const dump = (v: unknown) =>
										JSON.stringify(v, (_, x) =>
											typeof x === 'function' ? '[fn]' : x,
										)?.slice(0, 1500)
									logger.log(`args: ${dump(args)} | built-ins: ${ret.length}`)
									logger.log(`built-in[0]: ${dump(ret[0])}`)
									logger.log(`ours[0]: ${dump(extra[0])}`)
								}
								return [...ret, ...extra]
							} catch (e) {
								// Never break the chat input over a bad command
								logger.error('Failed to build commands', e)
								return ret
							}
						}),
					)
				} catch (e) {
					logger.error('Failed to hook getBuiltInCommands', e)
				}
			}),
		)

		// Gives every dependent plugin `api.commands`, removed when it stops
		decorate(plugin => {
			const mine = new Set<() => void>()

			plugin.api.commands = {
				register(command) {
					const off = register(command)
					const remove = () => {
						mine.delete(remove)
						off()
					}
					mine.add(remove)
					return remove
				},
			}

			return () => {
				for (const remove of [...mine]) remove()
			}
		})
	},
})
