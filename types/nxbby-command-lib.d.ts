// Types for dev.nxbby.command-lib. Plugins that depend on it get `api.commands`.

export interface CommandArg {
	name: string
	value: unknown
}

export interface CommandContext {
	channel?: { id?: string; nsfw?: boolean }
}

export interface CommandChoice {
	name: string
	value: string | number
}

export interface CommandOption {
	name: string
	description: string
	/** Discord option type, e.g. 3 = string, 4 = integer, 5 = boolean */
	type: number
	required?: boolean
	/** Pick list shown to the user (string and integer options only) */
	choices?: CommandChoice[]
	displayName?: string
	displayDescription?: string
}

export interface Command {
	name: string
	description: string
	options?: CommandOption[]
	/** Return `{ content }` to send a message, or nothing to send nothing. */
	execute(args: CommandArg[], ctx: CommandContext): unknown
}

export interface CommandsApi {
	/** Registers a slash command. Returns a function that removes it. */
	register(command: Command): () => void
}

declare module '@valenced/plugins/types' {
	interface PluginApi {
		commands: CommandsApi
	}
}
