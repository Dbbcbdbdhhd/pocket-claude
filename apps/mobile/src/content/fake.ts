export const VIDEOS = [
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_2MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_2MB.mp4',
  'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_2MB.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://vjs.zencdn.net/v/oceans.mp4',
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-10s.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
  'https://storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4',
  'https://storage.googleapis.com/exoplayer-test-media-1/mp4/android-screens-10s.mp4',
];

const FIRST = ['luna', 'noah', 'mia', 'kai', 'zoe', 'leo', 'ava', 'finn', 'nora', 'milo', 'ivy', 'theo', 'ruby', 'owen', 'cleo', 'jude', 'iris', 'axel', 'elio', 'maya', 'arlo', 'sage', 'remy', 'wren'];
const SECOND = ['wanders', 'shoots', 'eats', 'travels', 'codes', 'climbs', 'frames', 'daily', 'studio', 'moments', 'light', 'roams', 'films', 'kitchen', 'trails', 'vibes'];
const CAPTIONS = [
  'golden hour never misses',
  'weekend reset',
  'no filter needed',
  'found this spot by accident',
  'coffee first, everything else later',
  'quiet mornings',
  'chasing light',
  'small moments, big mood',
  'trip dump, part one',
  'the view from here',
  'late night walks hit different',
  'back at it again',
  'sunday slow down',
  'city lights and good company',
  'take me back',
];
const TAGS = ['#photography', '#travel', '#wanderlust', '#nature', '#city', '#goodvibes', '#sunset', '#explore'];
const NOTES = ['Out of office', 'Playlist on repeat', 'Anyone up for coffee?', 'Shipping tonight', 'Offline till Monday', 'Gym o\'clock'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SESSION_SEED = Math.floor(Math.random() * 1_000_000);

function rngFor(scope: string, index: number): () => number {
  let h = SESSION_SEED ^ (index * 2654435761);
  for (let i = 0; i < scope.length; i++) h = Math.imul(h ^ scope.charCodeAt(i), 16777619);
  return mulberry32(h);
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] as T;
}

export interface Person {
  username: string;
  avatar: string;
}

export const avatarUri = (seed: string) => `https://i.pravatar.cc/150?u=${encodeURIComponent(seed)}`;
export const imageUri = (seed: string, size = 1080) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${size}/${size}`;

function personFor(rng: () => number): Person {
  const username = `${pick(rng, FIRST)}.${pick(rng, SECOND)}${rng() < 0.4 ? Math.floor(rng() * 90 + 10) : ''}`;
  return { username, avatar: avatarUri(username) };
}

export interface Post {
  id: string;
  user: Person;
  kind: 'image' | 'video';
  uri: string;
  poster: string;
  caption: string;
  likes: number;
  comments: number;
  minutesAgo: number;
  liked: boolean;
  hasStory: boolean;
}

export function makePost(index: number): Post {
  const rng = rngFor('post', index);
  const user = personFor(rng);
  const video = index % 5 === 3;
  const seed = `p${SESSION_SEED}-${index}`;
  return {
    id: `post-${index}`,
    user,
    kind: video ? 'video' : 'image',
    uri: video ? pick(rng, VIDEOS) : imageUri(seed),
    poster: imageUri(seed),
    caption: `${pick(rng, CAPTIONS)} ${pick(rng, TAGS)} ${pick(rng, TAGS)}`,
    likes: Math.floor(40 + rng() * rng() * 48000),
    comments: Math.floor(rng() * 420),
    minutesAgo: Math.floor(5 + index * 37 + rng() * 40),
    liked: false,
    hasStory: rng() < 0.3,
  };
}

export function makePosts(from: number, count: number): Post[] {
  return Array.from({ length: count }, (_, i) => makePost(from + i));
}

export interface Story {
  id: string;
  user: Person;
  seen: boolean;
  own?: boolean;
}

export const OWN: Person = { username: 'pocket_user', avatar: avatarUri('pocket_user') };

export function makeStories(): Story[] {
  const rng = rngFor('story', 0);
  const list: Story[] = [{ id: 'own', user: OWN, seen: true, own: true }];
  for (let i = 0; i < 14; i++) {
    const user = personFor(rng);
    list.push({ id: `story-${i}`, user, seen: i > 8 });
  }
  return list;
}

export interface Tile {
  id: string;
  kind: 'image' | 'video';
  uri: string;
}

export interface ExploreBlock {
  id: string;
  tallLeft: boolean;
  tiles: [Tile, Tile, Tile, Tile, Tile];
}

export function makeExploreBlock(index: number): ExploreBlock {
  const rng = rngFor('explore', index);
  const tile = (n: number): Tile => ({
    id: `ex-${index}-${n}`,
    kind: rng() < 0.22 ? 'video' : 'image',
    uri: imageUri(`e${SESSION_SEED}-${index}-${n}`, 540),
  });
  return { id: `block-${index}`, tallLeft: index % 2 === 0, tiles: [tile(0), tile(1), tile(2), tile(3), tile(4)] };
}

export interface Reel {
  id: string;
  user: Person;
  uri: string;
  poster: string;
  caption: string;
  audio: string;
  likes: number;
  comments: number;
}

const AUDIO = ['Original audio', 'Lo-fi beats', 'Summer nights', 'Night drive', 'Slow motion'];

export function makeReel(index: number): Reel {
  const rng = rngFor('reel', index);
  const user = personFor(rng);
  const uri = VIDEOS[index % VIDEOS.length] as string;
  return {
    id: `reel-${index}`,
    user,
    uri,
    poster: imageUri(`r${SESSION_SEED}-${index % VIDEOS.length}`, 720),
    caption: `${pick(rng, CAPTIONS)} ${pick(rng, TAGS)}`,
    audio: `${pick(rng, AUDIO)} · ${user.username}`,
    likes: Math.floor(200 + rng() * rng() * 900000),
    comments: Math.floor(rng() * 5000),
  };
}

export function makeSuggestedAccounts(count: number): Person[] {
  const rng = rngFor('accounts', 0);
  return Array.from({ length: count }, () => personFor(rng));
}

export function makeGrid(count: number, scope: string): Tile[] {
  const rng = rngFor(scope, 0);
  return Array.from({ length: count }, (_, i) => ({
    id: `${scope}-${i}`,
    kind: rng() < 0.2 ? 'video' : 'image',
    uri: imageUri(`${scope}-${SESSION_SEED}-${i}`, 540),
  }));
}

export const HIGHLIGHTS = ['Work', 'Travel', 'Setup', 'Coffee', 'Builds'].map((label) => ({
  id: label,
  label,
  uri: imageUri(`hl-${label}`, 200),
}));

export interface FakeMessage {
  id: string;
  mine: boolean;
  text: string;
}

export interface FakeConversation {
  id: string;
  person: Person;
  name: string;
  preview: string;
  minutesAgo: number;
  unread: boolean;
  active: boolean;
  messages: FakeMessage[];
}

const SCRIPTS: { name: string; username: string; lines: [boolean, string][] }[] = [
  {
    name: 'Mia Torres',
    username: 'mia.shoots',
    lines: [
      [false, 'did you see the sunset yesterday??'],
      [true, 'yes!! sent you the photo'],
      [false, 'got it, it is unreal'],
      [true, 'we should go again this weekend'],
      [false, 'down. saturday?'],
    ],
  },
  {
    name: 'Kai',
    username: 'kai.codes',
    lines: [
      [false, 'pushed the fix, can you review?'],
      [true, 'on it'],
      [true, 'left two comments, nothing blocking'],
      [false, 'perfect, merging'],
    ],
  },
  {
    name: 'Nora Lind',
    username: 'nora.trails',
    lines: [
      [false, 'trail map is in the group'],
      [true, 'thanks! bringing the good camera'],
      [false, 'leaving at 7, be on time this once'],
    ],
  },
  {
    name: 'Theo',
    username: 'theo.daily',
    lines: [
      [true, 'ramen tonight?'],
      [false, 'always'],
      [false, 'same place as last time'],
    ],
  },
  {
    name: 'Zoe Park',
    username: 'zoe.studio',
    lines: [
      [false, 'new reel goes live tomorrow'],
      [true, 'cannot wait to see it'],
    ],
  },
  {
    name: 'Leo Marsh',
    username: 'leo.roams',
    lines: [
      [false, 'sent a reel'],
      [true, 'haha this is so accurate'],
    ],
  },
];

export function makeConversations(): FakeConversation[] {
  const rng = rngFor('dm', 0);
  return SCRIPTS.map((s, i) => {
    const last = s.lines[s.lines.length - 1] as [boolean, string];
    return {
      id: `fake-${i}`,
      person: { username: s.username, avatar: avatarUri(s.username) },
      name: s.name,
      preview: last[0] ? `You: ${last[1]}` : last[1],
      minutesAgo: 20 + i * 140 + Math.floor(rng() * 60),
      unread: i === 0 || i === 3,
      active: i === 1 || i === 4,
      messages: s.lines.map(([mine, text], n) => ({ id: `fake-${i}-${n}`, mine, text })),
    };
  });
}

export function makeNotes(): { id: string; person: Person; text: string }[] {
  return makeSuggestedAccounts(5).map((person, i) => ({ id: `note-${i}`, person, text: NOTES[i % NOTES.length] as string }));
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function withCommas(n: number): string {
  return n.toLocaleString('en-US');
}

export function agoLong(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes ago`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}
