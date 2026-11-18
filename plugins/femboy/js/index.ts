import { ToastActionCreators } from '@valenced/discord/actions'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'

const FEED_URL =
	'https://www.reddit.com/r/femboys/hot.json?limit=100&raw_json=1'
const CACHE_MS = 5 * 60 * 1000
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(\?.*)?$/i
const IMAGE_HOSTS = ['i.redd.it', 'i.imgur.com']

interface RedditPost {
	url: string
	over_18: boolean
	is_video: boolean
	is_self: boolean
	stickied: boolean
	spoiler?: boolean
}

interface CommandsModule {
	getBuiltInCommands(...args: unknown[]): unknown
}

interface CommandArg {
	name: string
	value: unknown
}

interface CommandContext {
	channel?: { nsfw?: boolean }
}

let cache: { at: number; posts: RedditPost[] } | undefined
let lastUrl: string | undefined

function toast(text: string) {
	ToastActionCreators.open('femboy-command', { text, variant: 'critical' })
}

async function fetchPosts(): Promise<RedditPost[]> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.posts

	const res = await fetch(FEED_URL)
	if (!res.ok) throw new Error(`Reddit responded with ${res.status}`)

	const json = (await res.json()) as {
		data: { children: { data: RedditPost }[] }
	}
	const posts = json.data.children
		.map(c => c.data)
		.filter(isImagePost)

	cache = { at: Date.now(), posts }
	return posts
}

function isImagePost(p: RedditPost) {
	if (p.is_video || p.is_self || p.stickied || p.spoiler) return false
	try {
		const { hostname } = new URL(p.url)
		return IMAGE_HOSTS.includes(hostname) && IMAGE_EXT.test(p.url)
	} catch {
		return false
	}
}

function pick(posts: RedditPost[], nsfw: boolean) {
	// SFW mode only uses posts Reddit does not flag as 18+
	const pool = posts.filter(p => p.over_18 === nsfw && p.url !== lastUrl)
	if (!pool.length) return undefined
	return pool[Math.floor(Math.random() * pool.length)]!
}

const command = {
	// Discord's command search index expects a numeric id; set in start()
	id: '-1000',
	name: 'femboy',
	displayName: 'femboy',
	untranslatedName: 'femboy',
	description: 'Send a random image from r/femboys',
	displayDescription: 'Send a random image from r/femboys',
	untranslatedDescription: 'Send a random image from r/femboys',
	type: 1, // CHAT
	inputType: 1, // BUILT_IN
	applicationId: '-1',
	options: [
		{
			name: 'nsfw',
			displayName: 'nsfw',
			type: 5, // BOOLEAN
			description: 'Send an NSFW image (age-restricted channels only)',
			displayDescription: 'Send an NSFW image (age-restricted channels only)',
			required: false,
		},
	],
	async execute(args: CommandArg[], ctx: CommandContext) {
		const nsfw = args.find(a => a.name === 'nsfw')?.value === true

		if (nsfw && !ctx.channel?.nsfw) {
			toast('NSFW images can only be sent in age-restricted channels.')
			return
		}

		try {
			const post = pick(await fetchPosts(), nsfw)
			if (!post) {
				toast(`No ${nsfw ? 'NSFW' : 'SFW'} images found right now.`)
				return
			}
			lastUrl = post.url
			// Discord embeds the image from the direct link
			return { content: post.url }
		} catch (e) {
			toast('Could not load images from Reddit.')
			console.error('[femboy]', e)
		}
	},
}

export default plugin({
	start({ cleanup, logger }) {
		cleanup(
			getModules(withProps<CommandsModule>('getBuiltInCommands'), commands => {
				try {
					cleanup(
						after(commands, 'getBuiltInCommands', (_, ret) => {
							if (!Array.isArray(ret)) return ret
							// Take an id just below the lowest built-in command id
							const ids = ret
								.map(c => Number.parseInt((c as { id?: string })?.id ?? '', 10))
								.filter(Number.isFinite)
							if (ids.length) command.id = String(Math.min(...ids) - 1)
							return [...ret, command]
						}),
					)
				} catch (e) {
					logger.error('Failed to register /femboy', e)
				}
			}),
		)
	},
})
