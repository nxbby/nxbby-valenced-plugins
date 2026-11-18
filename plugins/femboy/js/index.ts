import { ToastActionCreators } from '@valenced/discord/actions'

const SUBREDDITS = { nsfw: 'femboys', sfw: 'sfwfeminineboys' } as const

// Same sorts as Reddit's own sort menu
const SORTS = ['best', 'hot', 'new', 'top', 'controversial', 'rising'] as const
// Time ranges Reddit offers for Top and Controversial
const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'] as const

type Sort = (typeof SORTS)[number]
type Time = (typeof TIMES)[number]

// Labels shown in the pick lists
const SORT_LABELS: Record<Sort, string> = {
	best: 'Best',
	hot: 'Hot',
	new: 'New',
	top: 'Top',
	controversial: 'Controversial',
	rising: 'Rising',
}
const TIME_LABELS: Record<Time, string> = {
	hour: 'Past hour',
	day: 'Past 24 hours',
	week: 'Past week',
	month: 'Past month',
	year: 'Past year',
	all: 'All time',
}

const isSort = (v: string): v is Sort => (SORTS as readonly string[]).includes(v)
const isTime = (v: string): v is Time => (TIMES as readonly string[]).includes(v)

// Tried in order until one works
const feeds = (sub: string, sort: Sort, time: Time) => {
	// Reddit's "Best" is the same order as "Hot" inside a subreddit
	const path = sort === 'best' ? 'hot' : sort
	const t = sort === 'top' || sort === 'controversial' ? `&t=${time}` : ''
	return [
		`https://www.reddit.com/r/${sub}/${path}.json?limit=100&raw_json=1${t}`,
		`https://api.reddit.com/r/${sub}/${path}?limit=100&raw_json=1${t}`,
		`https://old.reddit.com/r/${sub}/${path}.json?limit=100&raw_json=1${t}`,
	]
}
// Third-party relay, only used if Reddit itself cannot be reached
const relay = (sub: string) => `https://meme-api.com/gimme/${sub}/50`

const HEADERS = {
	Accept: 'application/json',
	'User-Agent':
		'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
}
const CACHE_MS = 5 * 60 * 1000
const MAX_RECENT = 40
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
// Images sent recently, so the same one is not picked again right away
const recent: string[] = []

function toast(text: string) {
	ToastActionCreators.open('femboy-command', { text, variant: 'critical' })
}

async function fetchPosts(
	sub: string,
	sort: Sort,
	time: Time,
): Promise<RedditPost[]> {
	const key = `${sub}/${sort}/${time}`
	const hit = cache.get(key)
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.posts

	const errors: string[] = []
	const remember = (posts: RedditPost[]) => {
		cache.set(key, { at: Date.now(), posts })
		return posts
	}

	for (const url of feeds(sub, sort, time)) {
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
	const eligible = posts.filter(p => nsfw || !p.over_18)

	let pool = eligible.filter(p => !recent.includes(p.url))
	if (!pool.length) {
		// Everything here was sent recently: start over
		recent.length = 0
		pool = eligible
	}
	if (!pool.length) return undefined

	const post = pool[Math.floor(Math.random() * pool.length)]!
	recent.push(post.url)
	if (recent.length > MAX_RECENT) recent.shift()
	return post
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
					{
						name: 'sort',
						description: 'How to sort posts, like Reddit (default: hot)',
						type: 3, // STRING
						required: false,
						choices: SORTS.map(v => ({ name: SORT_LABELS[v], value: v })),
					},
					{
						name: 'time',
						description: 'Time range for top and controversial (default: day)',
						type: 3, // STRING
						required: false,
						choices: TIMES.map(v => ({ name: TIME_LABELS[v], value: v })),
					},
				],
				async execute(args, ctx) {
					const value = (name: string) => {
						const v = args.find(a => a.name === name)?.value
						return typeof v === 'string' ? v.trim().toLowerCase() : undefined
					}

					const nsfw = args.find(a => a.name === 'nsfw')?.value === true
					const sort = value('sort') ?? 'hot'
					const time = value('time') ?? 'day'

					if (!isSort(sort)) {
						toast(`Unknown sort. Use: ${SORTS.join(', ')}`)
						return
					}
					if (!isTime(time)) {
						toast(`Unknown time range. Use: ${TIMES.join(', ')}`)
						return
					}
					if (nsfw && !ctx.channel?.nsfw) {
						toast('NSFW images can only be sent in age-restricted channels.')
						return
					}

					try {
						const sub = nsfw ? SUBREDDITS.nsfw : SUBREDDITS.sfw
						const post = pick(await fetchPosts(sub, sort, time), nsfw)
						if (!post) {
							toast(`No ${nsfw ? 'NSFW' : 'SFW'} images found right now.`)
							return
						}
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
