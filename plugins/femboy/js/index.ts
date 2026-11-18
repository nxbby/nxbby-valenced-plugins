import { ToastActionCreators } from '@valenced/discord/actions'

const SUBREDDITS = { nsfw: 'femboys', sfw: 'sfwfeminineboys' } as const

// Tried in order until one works
const feeds = (sub: string) => [
	`https://www.reddit.com/r/${sub}/hot.json?limit=100&raw_json=1`,
	`https://api.reddit.com/r/${sub}/hot?limit=100&raw_json=1`,
	`https://old.reddit.com/r/${sub}/hot.json?limit=100&raw_json=1`,
]
// Third-party relay, only used if Reddit itself cannot be reached
const relay = (sub: string) => `https://meme-api.com/gimme/${sub}/50`
const HEADERS = {
	Accept: 'application/json',
	'User-Agent':
		'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
}
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

const cache = new Map<string, { at: number; posts: RedditPost[] }>()
let lastUrl: string | undefined

function toast(text: string) {
	ToastActionCreators.open('femboy-command', { text, variant: 'critical' })
}

async function fetchPosts(sub: string): Promise<RedditPost[]> {
	const hit = cache.get(sub)
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.posts

	const errors: string[] = []
	const remember = (posts: RedditPost[]) => {
		cache.set(sub, { at: Date.now(), posts })
		return posts
	}

	for (const url of feeds(sub)) {
		try {
			const json = (await getJson(url)) as {
				data: { children: { data: RedditPost }[] }
			}
			return remember(json.data.children.map(c => c.data).filter(isImagePost))
		} catch (e) {
			errors.push(`${new URL(url).hostname} ${errorText(e)}`)
		}
	}

	try {
		const json = (await getJson(relay(sub))) as {
			memes: { url: string; nsfw: boolean; spoiler: boolean }[]
		}
		return remember(
			json.memes
				.map(m => ({
					url: m.url,
					over_18: m.nsfw,
					spoiler: m.spoiler,
					is_video: false,
					is_self: false,
					stickied: false,
				}))
				.filter(isImagePost),
		)
	} catch (e) {
		errors.push(`relay ${errorText(e)}`)
	}

	throw new Error(errors.join(', '))
}

async function getJson(url: string): Promise<unknown> {
	const res = await fetch(url, { headers: HEADERS })
	if (!res.ok) throw new Error(String(res.status))
	return res.json()
}

function errorText(e: unknown) {
	return e instanceof Error ? e.message : String(e)
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
	// NSFW mode takes any post from r/femboys. SFW mode also drops anything
	// Reddit flags as 18+, in case a post slips into the SFW subreddit.
	const pool = posts.filter(p => (nsfw || !p.over_18) && p.url !== lastUrl)
	if (!pool.length) return undefined
	return pool[Math.floor(Math.random() * pool.length)]!
}

export default plugin({
	start({ cleanup, commands }) {
		cleanup(
			commands.register({
				name: 'femboy',
				description: 'Send a random femboy image (SFW by default)',
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
						const sub = nsfw ? SUBREDDITS.nsfw : SUBREDDITS.sfw
						const post = pick(await fetchPosts(sub), nsfw)
						if (!post) {
							toast(`No ${nsfw ? 'NSFW' : 'SFW'} images found right now.`)
							return
						}
						lastUrl = post.url
						// Discord embeds the image from the direct link
						return { content: post.url }
					} catch (e) {
						console.error('[femboy]', e)
						toast(`Could not load images: ${errorText(e)}`.slice(0, 160))
					}
				},
			}),
		)
	},
})
