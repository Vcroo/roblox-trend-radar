// Fetches live Roblox and Steam numbers, keeps a rolling history and writes
// data/live.json for the website. Runs on Node 20+ with no dependencies.
//
//   node scripts/update.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const DATA = new URL('../data/', import.meta.url);
const HISTORY_DAYS = 14;
const SORTS = ['top-playing-now', 'top-trending', 'up-and-coming'];
const STEAM_TOP = 60;
const STEAM_NEW_LOOKUPS = 40; // Steam's store API is rate limited, so look up a few new names per run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'roblox-trend-radar (github actions)' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(1500 * i);
    }
  }
}

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); } catch { return fallback; }
}

const writeJson = (name, value) => writeFile(new URL(name, DATA), JSON.stringify(value, null, 0) + '\n');

// ---------- Roblox ----------

async function robloxSorts() {
  const url = `https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${randomUUID()}&device=computer&country=all`;
  const json = await getJson(url);
  const out = {};
  for (const sort of json.sorts ?? []) {
    if (SORTS.includes(sort.sortId)) out[sort.sortId] = sort.games ?? [];
  }
  return out;
}

async function robloxDetails(ids) {
  const details = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const json = await getJson(`https://games.roblox.com/v1/games?universeIds=${chunk.join(',')}`);
    for (const g of json.data ?? []) details.set(g.id, g);
    await sleep(300);
  }
  return details;
}

// ---------- Steam ----------

async function steamTop() {
  const json = await getJson('https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/');
  return (json.response?.ranks ?? []).slice(0, STEAM_TOP);
}

async function steamNames(appids, cache) {
  const missing = appids.filter((id) => !cache[id]).slice(0, STEAM_NEW_LOOKUPS);
  for (const id of missing) {
    try {
      const json = await getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`, 2);
      const d = json[id]?.data;
      cache[id] = d
        ? { name: d.name, genres: (d.genres ?? []).map((g) => g.description), released: d.release_date?.date ?? null, free: !!d.is_free }
        : { name: `App ${id}`, genres: [], released: null, free: false };
    } catch {
      // Leave it for the next run.
    }
    await sleep(1300);
  }
  return cache;
}

// ---------- History and maths ----------

function addPoint(history, key, t, value) {
  const series = (history[key] ??= []);
  const last = series[series.length - 1];
  if (last && t - last[0] < 30 * 60 * 1000) last[1] = value; // runs closer than 30 min overwrite
  else series.push([t, value]);
}

function prune(history, now) {
  const cutoff = now - HISTORY_DAYS * 864e5;
  for (const key of Object.keys(history)) {
    history[key] = history[key].filter(([t]) => t >= cutoff);
    if (!history[key].length) delete history[key];
  }
}

// Value closest to `ago` milliseconds before now, if we have one within 40% of that window.
function valueAgo(series, now, ago) {
  if (!series?.length) return null;
  const target = now - ago;
  let best = null;
  for (const p of series) if (!best || Math.abs(p[0] - target) < Math.abs(best[0] - target)) best = p;
  return Math.abs(best[0] - target) <= ago * 0.4 ? best[1] : null;
}

const change = (now, then) => (then ? (now - then) / then : null);

function spark(series, now, days = 7, points = 28) {
  if (!series?.length) return [];
  const from = now - days * 864e5;
  const pts = series.filter(([t]) => t >= from);
  if (pts.length <= points) return pts.map(([, v]) => v);
  const step = pts.length / points;
  return Array.from({ length: points }, (_, i) => pts[Math.floor(i * step)][1]);
}

// Roblox gives almost every game minimumAge 0, so group by its content maturity label.
const AGE_BANDS = ['Minimal', 'Mild', 'Moderate', '12+ or older'];
const ageBand = (g) => {
  if (g.minimumAge >= 12 || g.contentMaturity === 'restricted') return '12+ or older';
  if (g.contentMaturity === 'moderate') return 'Moderate';
  if (g.contentMaturity === 'mild') return 'Mild';
  return 'Minimal';
};

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const scale10 = (v, max) => (max > 0 ? round((v / max) * 10) : 0);

// ---------- Main ----------

async function main() {
  await mkdir(DATA, { recursive: true });
  const now = Date.now();
  const history = await readJson('history.json', { roblox: {}, steam: {} });
  const steamCache = await readJson('steam_apps.json', {});
  const previous = await readJson('live.json', null);
  const errors = [];

  // Roblox
  let roblox = previous?.roblox ?? null;
  try {
    const sorts = await robloxSorts();
    const byId = new Map();
    for (const [sortId, games] of Object.entries(sorts)) {
      games.forEach((g, i) => {
        const e = byId.get(g.universeId) ?? { ...g, lists: {} };
        e.lists[sortId] = i + 1;
        e.playerCount = g.playerCount;
        byId.set(g.universeId, e);
      });
    }
    const details = await robloxDetails([...byId.keys()]);

    const games = [...byId.values()].map((g) => {
      const d = details.get(g.universeId) ?? {};
      const players = d.playing ?? g.playerCount ?? 0;
      const key = String(g.universeId);
      addPoint(history.roblox, key, now, players);
      const series = history.roblox[key];
      const likes = g.totalUpVotes + g.totalDownVotes;
      return {
        id: g.universeId,
        placeId: g.rootPlaceId,
        name: g.name,
        genre: d.genre_l1 || g.genreL1 || 'Other',
        subgenre: d.genre_l2 || null,
        players,
        visits: d.visits ?? null,
        favorites: d.favoritedCount ?? null,
        created: d.created ?? null,
        updated: d.updated ?? null,
        maxPlayers: d.maxPlayers ?? null,
        likeRatio: likes ? round(g.totalUpVotes / likes, 3) : null,
        age: ageBand(g),
        maturity: g.contentMaturity ?? null,
        lists: g.lists,
        change24h: change(players, valueAgo(series, now, 864e5)),
        change7d: change(players, valueAgo(series, now, 7 * 864e5)),
        spark: spark(series, now),
      };
    });

    const top = games.filter((g) => g.lists['top-playing-now']).sort((a, b) => b.players - a.players);
    const trendingIds = new Set(games.filter((g) => g.lists['top-trending'] || g.lists['up-and-coming']).map((g) => g.id));
    const totalPlayers = top.reduce((s, g) => s + g.players, 0);
    addPoint(history.roblox, '_total', now, totalPlayers);

    // Genres: how many players, how much buzz, and how crowded.
    const groups = d3group(games, (g) => g.genre);
    const genreRows = [...groups].map(([genre, list]) => {
      const inTop = list.filter((g) => g.lists['top-playing-now']);
      const players = inTop.reduce((s, g) => s + g.players, 0);
      const leader = inTop.reduce((a, b) => (b.players > (a?.players ?? -1) ? b : a), null);
      return {
        genre,
        players,
        share: totalPlayers ? players / totalPlayers : 0,
        topGames: inTop.length,
        buzzGames: list.filter((g) => trendingIds.has(g.id)).length,
        leader: leader?.name ?? null,
        leaderShare: players && leader ? leader.players / players : 0,
      };
    }).filter((r) => r.players > 0 || r.buzzGames > 0);
    const maxPlayers = Math.max(...genreRows.map((r) => r.players));
    const maxBuzz = Math.max(...genreRows.map((r) => r.buzzGames));
    for (const r of genreRows) {
      r.demand = scale10(r.players, maxPlayers);
      r.momentum = scale10(r.buzzGames, maxBuzz);
      r.room = round(10 * (1 - r.leaderShare));
      r.score = round(0.35 * r.demand + 0.4 * r.momentum + 0.25 * r.room);
    }
    genreRows.sort((a, b) => b.score - a.score);

    // Age ratings of what people play right now.
    const ages = AGE_BANDS.map((band) => {
      const list = top.filter((g) => g.age === band);
      const players = list.reduce((s, g) => s + g.players, 0);
      return { band, games: list.length, players, share: totalPlayers ? players / totalPlayers : 0 };
    });

    const newCutoff = now - 120 * 864e5;
    const rising = games
      .filter((g) => trendingIds.has(g.id))
      .map((g) => ({ ...g, isNew: g.created ? Date.parse(g.created) >= newCutoff : false }))
      .sort((a, b) => (b.change24h ?? -1) - (a.change24h ?? -1) || b.players - a.players)
      .slice(0, 40);

    roblox = {
      totalPlayers,
      totalSpark: spark(history.roblox._total, now),
      totalChange24h: change(totalPlayers, valueAgo(history.roblox._total, now, 864e5)),
      top: top.slice(0, 50),
      rising,
      genres: genreRows,
      ages,
    };
  } catch (err) {
    errors.push(`Roblox: ${err.message}`);
  }

  // Steam
  let steam = previous?.steam ?? null;
  try {
    const ranks = await steamTop();
    await steamNames(ranks.map((r) => r.appid), steamCache);
    const games = ranks.map((r) => {
      const key = String(r.appid);
      addPoint(history.steam, key, now, r.concurrent_in_game);
      const series = history.steam[key];
      const info = steamCache[r.appid] ?? {};
      return {
        appid: r.appid,
        rank: r.rank,
        name: info.name ?? `App ${r.appid}`,
        genres: info.genres ?? [],
        released: info.released ?? null,
        free: info.free ?? false,
        players: r.concurrent_in_game,
        peakToday: r.peak_in_game,
        change24h: change(r.concurrent_in_game, valueAgo(series, now, 864e5)),
        change7d: change(r.concurrent_in_game, valueAgo(series, now, 7 * 864e5)),
        spark: spark(series, now),
      };
    });
    steam = { top: games };
  } catch (err) {
    errors.push(`Steam: ${err.message}`);
  }

  prune(history.roblox, now);
  prune(history.steam, now);
  await writeJson('history.json', history);
  await writeJson('steam_apps.json', steamCache);
  await writeJson('live.json', {
    updated: new Date(now).toISOString(),
    robloxUpdated: errors.some((e) => e.startsWith('Roblox')) ? previous?.robloxUpdated ?? null : new Date(now).toISOString(),
    steamUpdated: errors.some((e) => e.startsWith('Steam')) ? previous?.steamUpdated ?? null : new Date(now).toISOString(),
    errors,
    roblox,
    steam,
  });

  console.log(`Updated. Roblox games: ${roblox?.top?.length ?? 0}, Steam games: ${steam?.top?.length ?? 0}.`);
  if (errors.length) {
    console.warn(errors.join('\n'));
    if (!roblox && !steam) process.exit(1);
  }
}

function d3group(list, keyOf) {
  const m = new Map();
  for (const item of list) {
    const k = keyOf(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
