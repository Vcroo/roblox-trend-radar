// Roblox Trend Radar: reads data/live.json (updated by GitHub Actions) and
// data/manual.json (edited by hand) and draws every tab.

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const pct0 = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIES = ['--accent', '--accent-2', '--accent-3', '--accent-4'];

// ---------- Tabs ----------

const tabs = [...document.querySelectorAll('.tabs button')];
function showPage(page) {
  if (!tabs.some((t) => t.dataset.page === page)) page = 'overview';
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.page === page)));
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== page; });
  if (location.hash.slice(1) !== page) history.replaceState(null, '', `#${page}`);
}
tabs.forEach((t) => t.addEventListener('click', () => showPage(t.dataset.page)));
window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));
showPage(location.hash.slice(1));

// ---------- Small drawing helpers ----------

function changeCell(value) {
  const span = el('span');
  if (value == null) { span.className = 'flat'; span.textContent = '—'; span.title = 'Not enough history yet'; return span; }
  span.className = value > 0.005 ? 'up' : value < -0.005 ? 'down' : 'flat';
  span.textContent = pct1.format(value);
  return span;
}

function sparkline(values, { width = 90, height = 26, color = cssVar('--accent') } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v) => (max === min ? height / 2 : height - 3 - ((v - min) / (max - min)) * (height - 6));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = document.createElementNS(NS, 'path');
  area.setAttribute('d', `${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`);
  area.setAttribute('fill', color);
  area.setAttribute('fill-opacity', '0.12');
  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.8');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', x(values.length - 1));
  dot.setAttribute('cy', y(values[values.length - 1]));
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', color);
  svg.append(area, line, dot);
  return svg;
}

function rankList(container, items, max) {
  container.replaceChildren(...items.map((d, i) => {
    const row = el('div', `rank-row${i === 0 ? ' first' : ''}`);
    const main = el('div', 'rank-main');
    const top = el('div', 'rank-top');
    const name = el('span', null, d.label);
    if (d.title) name.title = d.title;
    top.append(name, el('b', null, d.text));
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = `${Math.max(2, Math.min(100, (d.value / max) * 100))}%`;
    track.append(fill);
    main.append(top, track);
    row.append(el('span', 'rank-n', String(i + 1)), main);
    return row;
  }));
  if (!items.length) container.replaceChildren(el('p', 'empty', 'No data yet.'));
}

// Sortable, searchable table. columns: {key, label, num, cls, render(row) -> Node|string}
function table(tableEl, rows, columns, { sortKey, sortDir = 'desc', search } = {}) {
  let key = sortKey, dir = sortDir, query = '';
  const thead = el('thead'), tbody = el('tbody');
  const tr = el('tr');
  columns.forEach((c) => {
    const th = el('th', c.num ? 'num' : null, c.label);
    if (c.key && tableEl.classList.contains('sortable')) {
      th.dataset.key = c.key;
      th.tabIndex = 0;
      const go = () => {
        dir = key === c.key && dir === 'desc' ? 'asc' : 'desc';
        key = c.key;
        draw();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    }
    tr.append(th);
  });
  thead.append(tr);
  tableEl.replaceChildren(thead, tbody);

  function draw() {
    thead.querySelectorAll('th').forEach((th) => {
      if (th.dataset.key === key) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    const q = query.toLowerCase();
    let list = q ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)) || JSON.stringify(r).toLowerCase().includes(q)) : rows.slice();
    if (key) {
      list.sort((a, b) => {
        const va = a[key], vb = b[key];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    tbody.replaceChildren(...list.map((r) => {
      const row = el('tr');
      columns.forEach((c) => {
        const td = el('td', [c.num ? 'num' : '', c.cls ?? ''].join(' ').trim() || null);
        const v = c.render ? c.render(r) : r[c.key];
        if (v instanceof Node) td.append(v); else td.textContent = v ?? '—';
        row.append(td);
      });
      return row;
    }));
    if (!list.length) {
      const row = el('tr'); const td = el('td', 'empty', 'Nothing matches.'); td.colSpan = columns.length; row.append(td); tbody.append(row);
    }
  }
  if (search) search.addEventListener('input', () => { query = search.value.trim(); draw(); });
  draw();
}

function link(text, href) {
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
};
const daysOld = (iso) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 864e5)) : null);

// ---------- Scoring ideas against live genres ----------

function scoreIdeas(manual, live) {
  const shares = Object.fromEntries(manual.audience.groups.map((g) => [g.group, g.share]));
  const genres = new Map((live?.roblox?.genres ?? []).map((g) => [g.genre, g]));
  return manual.ideas.map((idea) => {
    const g = genres.get(idea.genre);
    const buzz = g ? g.momentum : 0;
    const room = g ? g.room : 10;
    const reach = idea.fit_under13 * shares.under13 + idea.fit_teen * shares.teen + idea.fit_adult * shares.adult;
    const score = 0.4 * buzz + 0.3 * room + 0.3 * reach;
    return { ...idea, buzz, room, reach: Math.round(reach * 10) / 10, score: Math.round(score * 10) / 10, leader: g?.leader ?? null };
  }).sort((a, b) => b.score - a.score);
}

// ---------- Render ----------

function render(live, manual) {
  const R = live?.roblox, S = live?.steam;
  const ideas = scoreIdeas(manual, live);

  $('#updated').textContent = `Roblox updated ${ago(live?.robloxUpdated)} · Steam ${ago(live?.steamUpdated)}`;
  $('#reviewed').textContent = `Social & audience reviewed ${manual.reviewed}`;
  if (live?.errors?.length) {
    $('#alert').hidden = false;
    $('#alert').textContent = `The last update couldn't reach every source, so some numbers are older: ${live.errors.join(' · ')}`;
  }

  // Overview KPIs
  if (R) {
    $('#k-total').textContent = compact.format(R.totalPlayers);
    const foot = $('#k-total-foot');
    foot.replaceChildren(`Across the top ${R.top.length} games`);
    if (R.totalChange24h != null) foot.append(' · ', changeCell(R.totalChange24h), ' in 24h');
    $('#k-total-spark').replaceChildren(sparkline(R.totalSpark, { width: 220, height: 36 }));
    const top = R.top[0];
    $('#k-top').textContent = top.name;
    $('#k-top-foot').textContent = `${compact.format(top.players)} players · ${top.genre}`;
    const g = R.genres[0];
    $('#k-genre').textContent = g.genre;
    $('#k-genre-foot').textContent = `Score ${g.score} · ${g.buzzGames} games on the trending lists`;
  }
  $('#k-idea').textContent = ideas[0].idea;
  $('#k-idea-foot').textContent = `Score ${ideas[0].score} out of 10`;

  const risers = (R?.rising ?? []).slice();
  const hasGrowth = risers.some((r) => r.change24h != null);
  $('#takeaway').textContent = R
    ? `${compact.format(R.totalPlayers)} people are playing Roblox's top games right now. ${R.genres[0].genre} is the hottest genre, and "${ideas[0].idea}" is the best idea to build.`
    : 'Live data is not available yet.';

  // Overview: rising and genres
  if (hasGrowth) {
    const list = risers.filter((r) => r.change24h != null).sort((a, b) => b.change24h - a.change24h).slice(0, 6);
    const max = Math.max(...list.map((r) => Math.max(r.change24h, 0)), 0.01);
    rankList($('#ov-rising'), list.map((r) => ({ label: r.name, value: Math.max(r.change24h, 0), text: pct1.format(r.change24h) })), max);
  } else {
    const list = risers.slice().sort((a, b) => b.players - a.players).slice(0, 6);
    const max = Math.max(...list.map((r) => r.players), 1);
    rankList($('#ov-rising'), list.map((r) => ({ label: r.name, value: r.players, text: `${compact.format(r.players)} playing` })), max);
    $('#ov-rising').prepend(el('p', 'note', 'Growth appears after a day of history. Showing the biggest trending games for now.'));
  }
  if (R) rankList($('#ov-genres'), R.genres.slice(0, 6).map((g) => ({ label: g.genre, value: g.score, text: g.score.toFixed(1) })), 10);

  // Roblox live table
  if (R) {
    const rows = R.top.map((g, i) => ({ ...g, rank: i + 1, likePct: g.likeRatio }));
    table($('#roblox-table'), rows, [
      { key: 'rank', label: '#', num: true },
      { key: 'name', label: 'Game', cls: 'name', render: (r) => link(r.name, `https://www.roblox.com/games/${r.placeId}`) },
      { key: 'genre', label: 'Genre', render: (r) => el('span', 'tag', r.genre) },
      { key: 'players', label: 'Playing', num: true, cls: 'big', render: (r) => compact.format(r.players) },
      { key: 'change24h', label: '24h', num: true, render: (r) => changeCell(r.change24h) },
      { key: 'change7d', label: '7 days', num: true, render: (r) => changeCell(r.change7d) },
      { label: 'Trend', render: (r) => sparkline(r.spark) },
      { key: 'likePct', label: 'Likes', num: true, render: (r) => (r.likeRatio == null ? '—' : pct0.format(r.likeRatio)) },
      { key: 'visits', label: 'Visits', num: true, render: (r) => (r.visits == null ? '—' : compact.format(r.visits)) },
      { key: 'age', label: 'Maturity' },
    ], { sortKey: 'players', search: $('#roblox-search') });
  }

  // Rising cards
  $('#rising-cards').replaceChildren(...risers.map((g) => {
    const card = el('article', 'card gcard');
    const row = el('div', 'row');
    const h = el('h3'); h.append(link(g.name, `https://www.roblox.com/games/${g.placeId}`));
    const badges = el('div', 'badges');
    if (g.isNew) badges.append(el('span', 'tag new', 'New'));
    if (g.lists['top-trending']) badges.append(el('span', 'tag', `Trending #${g.lists['top-trending']}`));
    if (g.lists['up-and-coming']) badges.append(el('span', 'tag', `Up-and-coming #${g.lists['up-and-coming']}`));
    row.append(h);
    const stats = el('div', 'stats');
    const stat = (label, value) => { const d = el('div'); const b = el('b'); b.append(value); d.append(b, el('span', 'note', label)); return d; };
    stats.append(stat('playing', compact.format(g.players)), stat('24h', changeCell(g.change24h)));
    if (g.likeRatio != null) stats.append(stat('likes', pct0.format(g.likeRatio)));
    const age = daysOld(g.created);
    const meta = el('p', 'note', `${g.genre}${g.subgenre ? ` · ${g.subgenre}` : ''}${age != null ? ` · ${age} days old` : ''} · ${g.age}`);
    card.append(row, badges, stats, sparkline(g.spark, { width: 260, height: 34 }), meta);
    return card;
  }));
  if (!risers.length) $('#rising-cards').replaceChildren(el('p', 'empty', 'No data yet.'));

  // Genres
  if (R) {
    table($('#genre-table'), R.genres, [
      { key: 'genre', label: 'Genre', cls: 'name' },
      { key: 'score', label: 'Score', num: true, cls: 'big', render: (r) => r.score.toFixed(1) },
      { key: 'players', label: 'Playing', num: true, render: (r) => compact.format(r.players) },
      { key: 'share', label: 'Share', num: true, render: (r) => pct0.format(r.share) },
      { key: 'buzzGames', label: 'Trending games', num: true },
      { key: 'topGames', label: 'Top games', num: true },
      { key: 'room', label: 'Room', num: true, render: (r) => r.room.toFixed(1) },
      { key: 'leader', label: 'Biggest game', cls: 'muted' },
    ], { sortKey: 'score' });
  }

  // Steam
  if (S) {
    const rows = S.top.map((g) => ({ ...g, genreText: g.genres.filter((x) => x !== 'Free To Play').slice(0, 3).join(', ') }));
    table($('#steam-table'), rows, [
      { key: 'rank', label: '#', num: true },
      { key: 'name', label: 'Game', cls: 'name', render: (r) => link(r.name, `https://store.steampowered.com/app/${r.appid}`) },
      { key: 'genreText', label: 'Genres', cls: 'muted' },
      { key: 'players', label: 'Playing', num: true, cls: 'big', render: (r) => compact.format(r.players) },
      { key: 'change24h', label: '24h', num: true, render: (r) => changeCell(r.change24h) },
      { key: 'change7d', label: '7 days', num: true, render: (r) => changeCell(r.change7d) },
      { label: 'Trend', render: (r) => sparkline(r.spark, { color: cssVar('--accent-2') }) },
      { key: 'released', label: 'Released', cls: 'muted' },
    ], { sortKey: 'players', search: $('#steam-search') });

    const byGenre = new Map();
    for (const g of S.top) for (const genre of g.genres) {
      if (genre === 'Free To Play' || genre === 'Early Access') continue;
      byGenre.set(genre, (byGenre.get(genre) ?? 0) + g.players);
    }
    const genreList = [...byGenre].sort((a, b) => b[1] - a[1]).slice(0, 7);
    rankList($('#steam-genres'), genreList.map(([label, v]) => ({ label, value: v, text: compact.format(v) })), genreList[0]?.[1] ?? 1);

    const sr = S.top.filter((g) => g.change24h != null).sort((a, b) => b.change24h - a.change24h).slice(0, 6);
    if (sr.length) {
      const max = Math.max(...sr.map((g) => Math.max(g.change24h, 0)), 0.01);
      rankList($('#steam-rising'), sr.map((g) => ({ label: g.name, value: Math.max(g.change24h, 0), text: pct1.format(g.change24h) })), max);
    } else {
      $('#steam-rising').replaceChildren(el('p', 'empty', 'Growth appears after a day of history.'));
    }
  }

  // Social
  $('#social-note').textContent = `There's no free trend API for TikTok or Instagram, so this list is updated by hand. Last reviewed ${manual.reviewed}.`;
  $('#social-cards').replaceChildren(...manual.social.map((t) => {
    const card = el('article', 'card gcard');
    const row = el('div', 'row');
    row.append(el('h3', null, t.trend), el('span', 'tag', t.platform));
    const dl = el('dl');
    const item = (label, text, cls) => { const d = el('div', cls); d.append(el('dt', null, label), el('dd', null, text)); return d; };
    dl.append(item('Signal', t.signal), item('What attracts players', t.attracts), item('Roblox idea', t.idea, 'idea'));
    card.append(row, dl);
    return card;
  }));

  // Audience donut
  const A = manual.audience;
  $('#aud-note').textContent = `${A.note} (${A.period})`;
  const colors = SERIES.map(cssVar);
  const donut = el('div', 'donut');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-90 -90 180 180');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Roblox players by age group');
  let angle = -Math.PI / 2;
  const gap = 0.03;
  A.groups.forEach((g, i) => {
    const a0 = angle + gap / 2, a1 = angle + g.share * 2 * Math.PI - gap / 2;
    angle += g.share * 2 * Math.PI;
    const R1 = 88, R0 = 62, large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M${p(R1, a0)}A${R1},${R1} 0 ${large} 1 ${p(R1, a1)}L${p(R0, a1)}A${R0},${R0} 0 ${large} 0 ${p(R0, a0)}Z`);
    path.setAttribute('fill', colors[i]);
    svg.append(path);
  });
  const biggest = A.groups.reduce((a, b) => (b.share > a.share ? b : a));
  const center = el('div', 'donut-c');
  center.append(el('b', null, pct0.format(biggest.share)), el('span', null, biggest.label));
  donut.append(svg, center);
  const legend = el('div', 'legend');
  A.groups.forEach((g, i) => {
    const r = el('div'); const sw = el('i'); sw.style.background = colors[i];
    r.append(sw, el('span', null, g.label), el('b', null, pct0.format(g.share)), el('small', null, g.likes));
    legend.append(r);
  });
  $('#aud-donut').replaceChildren(donut, legend);

  if (R) {
    const total = Math.max(...R.ages.map((a) => a.players), 1);
    rankList($('#aud-maturity'), R.ages.map((a) => ({ label: `${a.band} · ${a.games} games`, value: a.players, text: pct0.format(a.share) })), total);
  }

  table($('#fit-table'), manual.ideas, [
    { key: 'idea', label: 'Idea', cls: 'name' },
    ...[['fit_under13', 'Under 13'], ['fit_teen', '13 to 17'], ['fit_adult', '18+']].map(([key, label]) => ({
      key, label, num: true, cls: 'heat',
      render: (r) => { const s = el('span', null, String(r[key])); s.style.background = `color-mix(in srgb, ${colors[0]} ${r[key] * 8}%, transparent)`; return s; },
    })),
  ]);

  // Ideas
  table($('#ideas-table'), ideas, [
    { key: 'idea', label: 'Idea', cls: 'name' },
    { key: 'score', label: 'Score', num: true, cls: 'big', render: (r) => r.score.toFixed(1) },
    { key: 'genre', label: 'Genre', render: (r) => el('span', 'tag', r.genre) },
    { key: 'buzz', label: 'Buzz', num: true, render: (r) => r.buzz.toFixed(1) },
    { key: 'room', label: 'Room', num: true, render: (r) => r.room.toFixed(1) },
    { key: 'reach', label: 'Reach', num: true, render: (r) => r.reach.toFixed(1) },
    { key: 'effort', label: 'Effort', render: (r) => el('span', `effort ${r.effort.toLowerCase()}`, r.effort) },
    { key: 'why', label: 'Why', cls: 'muted' },
  ], { sortKey: 'score' });
}

async function load() {
  const bust = `?t=${Math.floor(Date.now() / 60000)}`;
  const [live, manual] = await Promise.all([
    fetch(`data/live.json${bust}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`data/manual.json${bust}`).then((r) => r.json()),
  ]);
  render(live, manual);
}

load().catch((err) => {
  $('#alert').hidden = false;
  $('#alert').textContent = `Couldn't load the data: ${err.message}`;
});
