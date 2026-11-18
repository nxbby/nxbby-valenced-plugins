import { getModules, lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'

import type { Command } from '../../../types/nxbby-command-lib'

// ApplicationCommandType.CHAT
const CHAT = 1
// Ids just need to be unique, numeric strings that don't clash with Discord's
const ID_BASE = -48_200_000

interface CommandsModule {
	getBuiltInCommands(...args: unknown[]): unknown
}

type RawCommand = Record<string, unknown> & { id: string }

const registered: Command[] = []
// Built command objects are cached so React sees stable references
const built = new Map<Command, RawCommand>()
let seq = 0

function enumValue(name: string, key: string, fallback: number): number {
	try {
		const [mod] = lookupModule(
			withProps<Record<string, Record<string, number>>>(name),
		)
		return mod?.[name]?.[key] ?? fallback
	} catch {
		return fallback
	}
}

function register(command: Command) {
	registered.push(command)
	return () => {
		const i = registered.indexOf(command)
		if (i !== -1) registered.splice(i, 1)
		built.delete(command)
	}
}

function build(command: Command): RawCommand {
	const cached = built.get(command)
	if (cached) return cached

	const result: RawCommand = {
		id: String(ID_BASE - seq++),
		untranslatedName: command.name,
		displayName: command.name,
		untranslatedDescription: command.description,
		displayDescription: command.description,
		type: CHAT,
		inputType: enumValue('ApplicationCommandInputType', 'BUILT_IN_TEXT', 1),
		applicationId: '-1',
		options: (command.options ?? []).map(o => ({
			name: o.name,
			displayName: o.displayName ?? o.name,
			description: o.description,
			displayDescription: o.displayDescription ?? o.description,
			type: o.type,
			required: o.required ?? false,
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
						instead(commands, 'getBuiltInCommands', (args, orig, self) => {
							const result = (orig as (...a: unknown[]) => unknown).apply(
								self,
								args as unknown[],
							)
							try {
								// Only add to lists that include chat (slash) commands
								const types = (args as unknown[])[0]
								const wantsChat = Array.isArray(types)
									? types.includes(CHAT)
									: types == null || types === CHAT
								if (!wantsChat || !Array.isArray(result) || !registered.length)
									return result

								const mine = registered
									.map(build)
									.filter(c => !result.some(r => r?.id === c.id))
								return mine.length ? [...result, ...mine] : result
							} catch (e) {
								// Never break the chat input over a bad command
								logger.error('Failed to add commands', e)
								return result
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
