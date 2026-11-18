import { ToastActionCreators } from '@valenced/discord/actions'

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
	const posts = json.data.children.map(c => c.data).filter(isImagePost)

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

export default plugin({
	start({ cleanup, commands }) {
		cleanup(
			commands.register({
				name: 'femboy',
				description: 'Send a random image from r/femboys',
				options: [
					{
						name: 'nsfw',
						description: 'Send an NSFW image (age-restricted channels only)',
						type: 5, // BOOLEAN
						required: false,
					},
				],
				async execute(args, ctx) {
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
			}),
		)
	},
})
