// VALID_WORDS is loaded from data/words.js

const STARTERS = ['magic', 'flute', 'words'];
const ROUNDS_PER_DAY = 5;

// Earliest playable day - the day this game first existed.
const FIRST_DAY = '2026-03-09';

// Canonical address, used in shared results.
const SITE_URL = 'https://www.magicflutewords.com/';

const state = {
  date: '',              // day being played, as YYYY-MM-DD (UTC)
  answers: [],
  round: 0,              // current round (0-based)
  guesses: [],           // guesses for current round
  input: [],             // letters being typed
  gameOver: false,       // current round complete
  won: false,            // current round won
  stars: [],             // stars earned per completed round
};

// ── Days ─────────────────────────────────────────────────────
//
// A day is identified by its UTC calendar date as YYYY-MM-DD. ISO keys sort
// and compare lexicographically, so plain string comparison orders them.
//
// Players see days as game numbers rather than dates: game #1 is FIRST_DAY,
// game #2 the next UTC day, and so on. The number is purely a presentation
// layer - storage stays keyed by date and word selection still seeds from the
// UTC date, so a number is only ever a shorthand for its day.

function todayKey() {
  const d = new Date();
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function dayKey(year, month, day) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

const MS_PER_DAY = 86400000;

// UTC midnight timestamp for a YYYY-MM-DD key.
function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Game number for a day. FIRST_DAY is #1; each later UTC day is one higher.
function dayNumber(key) {
  return Math.round((keyToUTC(key) - keyToUTC(FIRST_DAY)) / MS_PER_DAY) + 1;
}

// The day a game number refers to, as a YYYY-MM-DD key.
function keyForNumber(n) {
  const t = keyToUTC(FIRST_DAY) + (n - 1) * MS_PER_DAY;
  const d = new Date(t);
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Highest playable game number - today's game.
function latestNumber() {
  return dayNumber(todayKey());
}

// True for a well-formed, real calendar date within the playable range.
function isPlayable(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  if (key < FIRST_DAY || key > todayKey()) return false;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates like 2026-02-31, which JS would roll forward.
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatDay(key, withYear) {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (withYear) opts.year = 'numeric';
  return new Date(key + 'T00:00:00Z').toLocaleDateString(undefined, opts);
}

// ── Word selection ───────────────────────────────────────────
//
// Pool: all valid words minus the three starters, sorted alphabetically
// for a stable, deterministic order regardless of Set iteration.
//
// Seed: the day's UTC calendar date expressed as YYYYMMDD (e.g. 20260314).
// The seed is multiplied by the prime 48271 so that a one-day increment
// jumps far across the pool rather than landing one step away. Each round
// index i is then multiplied by the prime 1000003 so that the five picks
// within a day are also well-scattered. Together these prevent adjacent
// days from sharing words.

function pickAnswers(key) {
  const pool = [...VALID_WORDS].filter(w => !STARTERS.includes(w)).sort();
  const seed = Number(key.slice(0, 4)) * 10000
             + Number(key.slice(5, 7)) * 100
             + Number(key.slice(8, 10));

  const answers = [];
  const used = new Set();
  for (let i = 0; i < ROUNDS_PER_DAY; i++) {
    let idx = (seed * 48271 + i * 1000003) % pool.length;
    while (used.has(idx)) idx = (idx + 1) % pool.length;
    used.add(idx);
    answers.push(pool[idx]);
  }
  return answers;
}

function currentAnswer() {
  return state.answers[state.round];
}

// ── Saved days ───────────────────────────────────────────────
//
// One record per day under a single key:
//   { "2026-03-14": { v: 1, stars: [5, 3], guesses: ["crane"] } }
//
// `stars` holds one entry per finished round, so its length is also the
// round the player is on and a length of ROUNDS_PER_DAY means the day is
// done. `guesses` carries the unfinished round's guesses so a reload
// resumes mid-word instead of handing out a fresh set of tries.

const SCORES_KEY = 'rcn-scores';
const RECORD_VERSION = 1;

function readRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCORES_KEY));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};   // absent, blocked, or corrupt - start from nothing
  }
}

function writeRecords(records) {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(records));
  } catch (e) {
    // Storage blocked or full - the day is still playable, just not saved.
  }
}

// Records come from storage the user can edit, or from a transfer link, so
// validate rather than trust. A finished day has no unfinished round, so any
// guesses it carries are dropped.
function cleanRecord(rec) {
  if (!rec || !Array.isArray(rec.stars)) return { stars: [], guesses: [] };

  const stars = rec.stars
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 5)
    .slice(0, ROUNDS_PER_DAY);
  const guesses = Array.isArray(rec.guesses) && stars.length < ROUNDS_PER_DAY
    ? rec.guesses.filter(w => typeof w === 'string' && VALID_WORDS.has(w))
    : [];

  return { stars, guesses };
}

function readDay(key) {
  return cleanRecord(readRecords()[key]);
}

function saveDay() {
  const records = readRecords();
  records[state.date] = {
    v: RECORD_VERSION,
    stars: state.stars,
    // A won round is already banked in `stars`; keeping its guesses would
    // replay them into the next round on reload.
    guesses: state.gameOver ? [] : state.guesses,
  };
  writeRecords(records);
}

function loadDay(key) {
  const saved = readDay(key);

  state.date = key;
  state.answers = pickAnswers(key);
  state.stars = saved.stars;
  state.round = saved.stars.length;
  state.guesses = state.round < ROUNDS_PER_DAY ? saved.guesses : [];
  state.input = [];
  state.gameOver = false;
  state.won = false;

  syncUrl(key);
  render();
}

// Keep the game in the URL so a chosen day survives a reload and can be linked.
// New links carry the game number (?g=N); the legacy ?d=YYYY-MM-DD form is no
// longer written but is still honored on load so old links keep working.
function syncUrl(key) {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('d');
    if (key === todayKey()) url.searchParams.delete('g');
    else url.searchParams.set('g', String(dayNumber(key)));
    history.replaceState(null, '', url);
  } catch (e) {
    // Some browsers reject replaceState on file:// - the game still works.
  }
}

function initialDay() {
  let params = null;
  try {
    params = new URLSearchParams(location.search);
  } catch (e) {
    return todayKey();
  }

  const g = params.get('g');
  if (g && /^\d+$/.test(g)) {
    const key = keyForNumber(Number(g));
    if (isPlayable(key)) return key;
  }

  const d = params.get('d');   // legacy links
  if (isPlayable(d)) return d;

  return todayKey();
}

// ── Game logic ───────────────────────────────────────────────

function evaluate(guess, answer) {
  const result = Array(5).fill('absent');
  const ans = answer.split('');
  const gue = guess.split('');

  // Pass 1: correct positions
  for (let i = 0; i < 5; i++) {
    if (gue[i] === ans[i]) {
      result[i] = 'correct';
      ans[i] = null;
      gue[i] = null;
    }
  }

  // Pass 2: present letters
  for (let i = 0; i < 5; i++) {
    if (!gue[i]) continue;
    const j = ans.indexOf(gue[i]);
    if (j !== -1) {
      result[i] = 'present';
      ans[j] = null;
    }
  }

  return result;
}

function submitGuess() {
  if (state.input.length < 5) return false;
  const guess = state.input.join('');

  if (!VALID_WORDS.has(guess)) return false;

  state.guesses.push(guess);
  state.input = [];

  if (guess === currentAnswer()) {
    state.gameOver = true;
    state.won = true;
    state.stars.push(Math.max(0, 6 - state.guesses.length));
  }

  saveDay();
  return true;
}

let statsAutoShownForDate = null;

function nextRound() {
  state.round++;
  if (state.round >= ROUNDS_PER_DAY) {
    render();
    if (statsAutoShownForDate !== state.date) {
      statsAutoShownForDate = state.date;
      openStats();
    }
    return;
  }
  state.guesses = [];
  state.input = [];
  state.gameOver = false;
  state.won = false;
  saveDay();
  render();
}

// ── Input handling ───────────────────────────────────────────

function handleKey(key) {
  if (state.round >= ROUNDS_PER_DAY) return;

  if (state.gameOver) {
    if (key === 'Enter') nextRound();
    return;
  }

  let shake = false;

  if (key === 'Backspace') {
    state.input.pop();
  } else if (key === 'Enter') {
    const isInvalid = state.input.length === 5 && !VALID_WORDS.has(state.input.join(''));
    submitGuess();
    if (isInvalid) shake = true;
  } else if (/^[a-z]$/.test(key) && state.input.length < 5) {
    state.input.push(key);
  }

  render();

  if (shake) shakeActiveRow();
}

// ── Rendering ────────────────────────────────────────────────

function render() {
  renderProgress();
  renderBoard();
  renderKeyboard();
  renderResult();
  renderDayInfo();
}

function renderProgress() {
  const container = document.getElementById('word-progress');
  container.innerHTML = '';

  if (state.round >= ROUNDS_PER_DAY) return;

  for (let i = 0; i < ROUNDS_PER_DAY; i++) {
    const slot = document.createElement('div');
    slot.className = 'progress-slot';

    if (i < state.stars.length) {
      // Completed round - show star count
      slot.classList.add('completed');
      slot.textContent = '★' + state.stars[i];
    } else if (i === state.round) {
      // Current round
      slot.classList.add('active');
      slot.textContent = i + 1;
    } else {
      // Future round
      slot.textContent = i + 1;
    }

    container.appendChild(slot);
  }
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  // Day complete - show all five answers as correct tiles
  if (state.round >= ROUNDS_PER_DAY) {
    for (let w = 0; w < state.answers.length; w++) {
      const answer = state.answers[w];
      const row = document.createElement('div');
      row.className = 'summary-row';

      const slot = document.createElement('div');
      slot.className = 'progress-slot completed';
      slot.textContent = '★' + state.stars[w];
      row.appendChild(slot);

      for (let i = 0; i < 5; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.textContent = answer[i].toUpperCase();
        row.appendChild(tile);
      }
      row.appendChild(makeDefineLink(answer));
      board.appendChild(row);
    }
    return;
  }

  const answer = currentAnswer();

  // Starter rows (always pre-evaluated against the current answer)
  for (const starter of STARTERS) {
    board.appendChild(makeRow(starter, evaluate(starter, answer)));
  }

  // Player-submitted guesses
  for (const guess of state.guesses) {
    board.appendChild(makeRow(guess, evaluate(guess, answer)));
  }

  // Active input row
  if (!state.gameOver) {
    const guess = state.input.join('');
    const isInvalid = state.input.length === 5 && !VALID_WORDS.has(guess);
    const row = document.createElement('div');
    row.className = 'row active';
    row.id = 'active-row';
    for (let i = 0; i < 5; i++) {
      const tile = document.createElement('div');
      tile.className = 'tile' + (isInvalid ? ' invalid' : '');
      tile.textContent = (state.input[i] || '').toUpperCase();
      row.appendChild(tile);
    }
    board.appendChild(row);
  }

  // Keep the latest content in view
  const lastRow = board.lastElementChild;
  if (lastRow) lastRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function makeRow(word, evaluation) {
  const row = document.createElement('div');
  row.className = 'row';
  for (let i = 0; i < 5; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile ' + evaluation[i];
    tile.textContent = word[i].toUpperCase();
    row.appendChild(tile);
  }
  return row;
}

// A magnifying glass beside a summary word, opening a Google search for its
// definition in a new tab. rel guards against the new tab reaching back via
// window.opener.
function makeDefineLink(word) {
  const link = document.createElement('a');
  link.className = 'define-link';
  link.href = 'https://www.google.com/search?q=' + encodeURIComponent('define ' + word);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // Inline SVG so the glyph inherits currentColor and stays flat/monochrome.
  link.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/>' +
    '<line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
  link.setAttribute('aria-label', 'Look up the definition of ' + word);
  link.title = 'Definition of ' + word.toUpperCase();
  return link;
}

function renderKeyboard() {
  const answer = currentAnswer();
  const priority = { correct: 3, present: 2, absent: 1 };
  const keyState = {};

  if (answer) {
    for (const word of [...STARTERS, ...state.guesses]) {
      const ev = evaluate(word, answer);
      for (let i = 0; i < 5; i++) {
        const letter = word[i];
        const s = ev[i];
        if (!keyState[letter] || priority[s] > priority[keyState[letter]]) {
          keyState[letter] = s;
        }
      }
    }
  }

  document.querySelectorAll('.key[data-key]').forEach(btn => {
    const k = btn.dataset.key;
    if (k.length !== 1) return; // skip Enter / Backspace
    btn.className = 'key' + (keyState[k] ? ' ' + keyState[k] : '');
  });
}

function buildShareText() {
  const num = dayNumber(state.date);
  const total = state.stars.reduce((a, b) => a + b, 0);
  const starLines = state.stars
    .map(s => '★'.repeat(s) + '☆'.repeat(5 - s))
    .join('\n');
  return 'Magic Flute Words #' + num + '\n'
       + formatDay(state.date, true) + '\n'
       + '★ ' + total + ' / ' + (ROUNDS_PER_DAY * 5) + '\n'
       + starLines + '\n'
       + SITE_URL + '?g=' + num;
}

function shareScores() {
  const text = buildShareText();
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    copyScores();
  }
}

function copyScores() {
  const text = buildShareText();
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  }).catch(() => {});
}

function renderResult() {
  const el = document.getElementById('result');
  el.innerHTML = '';

  if (state.round >= ROUNDS_PER_DAY) {
    const total = state.stars.reduce((a, b) => a + b, 0);

    const score = document.createElement('span');
    score.textContent = '★ ' + total + ' / ' + (ROUNDS_PER_DAY * 5);
    el.appendChild(score);

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const shareBtn = document.createElement('button');
    shareBtn.id = 'share-btn';
    shareBtn.className = 'result-action';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', shareScores);
    actions.appendChild(shareBtn);

    const copyBtn = document.createElement('button');
    copyBtn.id = 'copy-btn';
    copyBtn.className = 'result-action secondary';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', copyScores);
    actions.appendChild(copyBtn);

    el.appendChild(actions);
    return;
  }

  if (!state.won) return;

  const filled = Math.max(0, 6 - state.guesses.length);

  const stars = document.createElement('span');
  stars.textContent = '★'.repeat(filled) + '☆'.repeat(5 - filled);
  el.appendChild(stars);

  const hint = document.createElement('span');
  hint.className = 'result-hint';
  const isLast = state.round >= ROUNDS_PER_DAY - 1;
  hint.textContent = isLast ? 'Enter → daily score' : 'Enter → next word';
  el.appendChild(hint);
}

function renderDayInfo() {
  const dateBtn = document.getElementById('date-btn');
  const dayStars = document.getElementById('day-stars');

  const isToday = state.date === todayKey();
  const num = dayNumber(state.date);
  dateBtn.textContent = isToday
    ? '#' + num + ' · Today'
    : '#' + num + ' · ' + formatDay(state.date);
  dateBtn.classList.toggle('past', !isToday);
  dateBtn.title = 'Change game - playing #' + num + ' (' + formatDay(state.date, true) + ')';

  const total = state.stars.reduce((a, b) => a + b, 0);
  dayStars.textContent = '★ ' + total;
}

// ── Visual feedback ──────────────────────────────────────────

function shakeActiveRow() {
  const row = document.getElementById('active-row');
  if (!row) return;
  row.classList.add('shake');
  row.addEventListener('animationend', () => row.classList.remove('shake'), { once: true });
}

// ── Modals ───────────────────────────────────────────────────

let returnFocusTo = null;

function openModal(id, fallbackFocusId) {
  const active = document.activeElement;
  returnFocusTo = (active && active !== document.body)
    ? active
    : document.getElementById(fallbackFocusId);

  const modal = document.getElementById(id);
  modal.hidden = false;
  modal.querySelector('.modal-close').focus();
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
  if (returnFocusTo) returnFocusTo.focus();
  returnFocusTo = null;
}

function openModalEl() {
  return document.querySelector('.modal-backdrop:not([hidden])');
}

// ── Help modal ───────────────────────────────────────────────

// First-visit flag. If storage is unavailable (private mode, file:// in some
// browsers) we treat help as already seen rather than reopening every load.

const HELP_SEEN_KEY = 'rcn-help-seen';

function hasSeenHelp() {
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === '1';
  } catch (e) {
    return true;
  }
}

function markHelpSeen() {
  try {
    localStorage.setItem(HELP_SEEN_KEY, '1');
  } catch (e) {
    // Storage blocked - the modal still works, it just won't be remembered.
  }
}

function openHelp() {
  document.getElementById('help-modal').hidden = false;
  document.querySelector('.modal-close').focus();
  markHelpSeen();
}

function closeHelp() {
  document.getElementById('help-modal').hidden = true;
  document.getElementById('help-btn').focus();
}
// ── Game picker modal ────────────────────────────────────────
//
// Lists every playable game by number, newest first, with the stars earned so
// far. A summary line above the list totals and averages the played games.

const DAY_MAX = ROUNDS_PER_DAY * 5;

function openGamePicker() {
  renderGameSummary();
  renderGameList();
  openModal('date-modal', 'date-btn');
}

function renderGameSummary() {
  const el = document.getElementById('game-summary');

  let played = 0;
  let total = 0;
  for (let n = 1; n <= latestNumber(); n++) {
    const { stars } = readDay(keyForNumber(n));
    if (stars.length === 0) continue;
    played++;
    total += stars.reduce((a, b) => a + b, 0);
  }

  if (played === 0) {
    el.textContent = 'No games played yet - pick one below.';
    return;
  }

  const avg = (total / played).toFixed(1);
  el.textContent = played + ' played · ★ ' + total + ' / ' + (played * DAY_MAX)
                 + ' · ' + avg + ' avg';
}

function renderGameList() {
  const list = document.getElementById('game-list');
  list.innerHTML = '';

  const today = todayKey();

  for (let n = latestNumber(); n >= 1; n--) {
    const key = keyForNumber(n);
    const { stars } = readDay(key);
    const total = stars.reduce((a, b) => a + b, 0);

    const row = document.createElement('button');
    row.className = 'game-row';
    if (key === state.date) row.classList.add('current');
    row.addEventListener('click', () => {
      closeModal('date-modal');
      loadDay(key);
    });

    const num = document.createElement('span');
    num.className = 'game-num';
    num.textContent = '#' + n;

    const date = document.createElement('span');
    date.className = 'game-date';
    date.textContent = key === today ? 'Today' : formatDay(key, true);

    const score = document.createElement('span');
    score.className = 'game-score';
    if (stars.length >= ROUNDS_PER_DAY) {
      score.classList.add('done');
      score.textContent = '★ ' + total + ' / ' + DAY_MAX;
    } else if (stars.length > 0) {
      score.classList.add('progress');
      score.textContent = '★ ' + total + ' · ' + stars.length + '/' + ROUNDS_PER_DAY;
    } else {
      score.textContent = '-';
    }

    row.append(num, date, score);
    list.appendChild(row);
  }
}

// ── Stats modal ─────────────────────────────────────────────

function computeStats() {
  const records = readRecords();
  const allKeys = Object.keys(records).filter(isPlayable).sort();

  let played = 0;
  let completed = 0;
  let totalStars = 0;
  let totalRounds = 0;
  const starDist = [0, 0, 0, 0, 0, 0];
  let perfectDays = 0;
  const completedKeys = [];

  for (const key of allKeys) {
    const { stars } = readDay(key);
    if (stars.length === 0) continue;

    played++;
    for (const s of stars) {
      starDist[s]++;
      totalStars += s;
      totalRounds++;
    }

    if (stars.length === ROUNDS_PER_DAY) {
      completed++;
      completedKeys.push(key);
      if (stars.every(s => s === 5)) perfectDays++;
    }
  }

  let maxStreak = 0;
  let currentStreak = 0;

  if (completedKeys.length > 0) {
    let runLength = 1;
    for (let i = 1; i < completedKeys.length; i++) {
      const gap = (keyToUTC(completedKeys[i]) - keyToUTC(completedKeys[i - 1])) / MS_PER_DAY;
      runLength = gap === 1 ? runLength + 1 : 1;
      if (runLength > maxStreak) maxStreak = runLength;
    }
    if (runLength > maxStreak) maxStreak = runLength;

    const last = completedKeys[completedKeys.length - 1];
    const daysSinceLast = Math.round((keyToUTC(todayKey()) - keyToUTC(last)) / MS_PER_DAY);

    if (daysSinceLast <= 1) {
      currentStreak = 1;
      for (let i = completedKeys.length - 2; i >= 0; i--) {
        const gap = (keyToUTC(completedKeys[i + 1]) - keyToUTC(completedKeys[i])) / MS_PER_DAY;
        if (gap === 1) currentStreak++;
        else break;
      }
    }
  }

  const avgPerRound = totalRounds > 0 ? totalStars / totalRounds : 0;

  return { played, completed, currentStreak, maxStreak, starDist, avgPerRound, perfectDays, totalStars, totalRounds };
}

function renderStatsContent() {
  const el = document.getElementById('stats-content');
  el.innerHTML = '';

  const stats = computeStats();

  const tiles = document.createElement('div');
  tiles.className = 'stat-tiles';

  const maxPossible = stats.totalRounds * 5;
  const pct = maxPossible > 0 ? Math.round(stats.totalStars / maxPossible * 100) : 0;

  const tileData = [
    { value: stats.played, label: 'Played' },
    { value: stats.completed + '/' + stats.played, label: 'Done' },
    { value: stats.totalStars + '/' + maxPossible, label: 'Stars' },
    { value: pct + '%', label: 'Success' },
  ];

  for (const t of tileData) {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';

    const val = document.createElement('div');
    val.className = 'stat-value';
    val.textContent = t.value;

    const lbl = document.createElement('div');
    lbl.className = 'stat-label';
    lbl.textContent = t.label;

    tile.append(val, lbl);
    tiles.appendChild(tile);
  }

  el.appendChild(tiles);

  const heading = document.createElement('h3');
  heading.textContent = 'Star Distribution';
  el.appendChild(heading);

  const totalRounds = stats.starDist.reduce((a, b) => a + b, 0);

  if (totalRounds === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No rounds played yet.';
    el.appendChild(empty);
    return;
  }

  const maxCount = Math.max(...stats.starDist);
  const gold = [181, 154, 16];
  const gray = [135, 138, 140];

  const dist = document.createElement('div');
  dist.className = 'star-dist';

  for (let s = 5; s >= 0; s--) {
    const row = document.createElement('div');
    row.className = 'star-dist-row';

    const label = document.createElement('span');
    label.className = 'star-dist-label';
    label.textContent = s + '★';

    const bar = document.createElement('div');
    bar.className = 'star-dist-bar';
    const pct = maxCount > 0 ? (stats.starDist[s] / maxCount) * 100 : 0;
    bar.style.width = Math.max(pct, 4) + '%';
    const t = maxCount > 0 ? 1 - stats.starDist[s] / maxCount : 1;
    bar.style.background = 'rgb(' + Math.round(gold[0] + t * (gray[0] - gold[0]))
      + ',' + Math.round(gold[1] + t * (gray[1] - gold[1]))
      + ',' + Math.round(gold[2] + t * (gray[2] - gold[2])) + ')';

    const roundPct = totalRounds > 0 ? Math.round(stats.starDist[s] / totalRounds * 100) : 0;

    const count = document.createElement('span');
    count.className = 'star-dist-count';
    count.textContent = stats.starDist[s] + ' (' + roundPct + '%)';

    const track = document.createElement('div');
    track.className = 'star-dist-track';
    track.appendChild(bar);

    row.append(label, track, count);
    dist.appendChild(row);
  }

  el.appendChild(dist);

  const footer = document.createElement('p');
  footer.className = 'stats-footer';
  const parts = [];
  if (stats.perfectDays > 0) {
    parts.push(stats.perfectDays + ' perfect ' + (stats.perfectDays === 1 ? 'day' : 'days'));
  }
  if (parts.length > 0) {
    footer.textContent = parts.join(' · ');
    el.appendChild(footer);
  }
}

function openStats() {
  renderStatsContent();
  openModal('stats-modal', 'stats-btn');
}

// ── Transfer ─────────────────────────────────────────────────
//
// Saved games live only in this browser's localStorage, and there is no
// server, so moving them to another device means carrying them in a link:
// this page's address plus #transfer=CODE. CODE is compact and URL-safe:
//
//   1.200.55432.54321..32cranetoast
//
// the format version, the first game number carried, then one dot-separated
// segment per consecutive game: its finished rounds' stars as digits, then
// the unfinished round's guesses as back-to-back five-letter words. An empty
// segment is a game not played. Being in the fragment, the code isn't sent
// to the web host.
//
// Importing merges rather than replaces: for each game the record further
// along wins (more finished rounds, then more guesses) and a tie keeps the
// one already here, so an import never loses progress on this device.
//
// #moved=JSON is the one-off variant sent by the old pauloq.com/55/ address
// (tools/moved-redirect.html). It forwards that origin's raw rcn-scores
// record so players keep their games across the change of domain.

const TRANSFER_VERSION = '1';

function encodeTransfer() {
  const records = readRecords();
  const segs = [];
  let first = 0;
  for (let n = 1; n <= latestNumber(); n++) {
    const { stars, guesses } = cleanRecord(records[keyForNumber(n)]);
    const seg = stars.join('') + guesses.join('');
    if (!first && !seg) continue;
    if (!first) first = n;
    segs.push(seg);
  }
  while (segs.length && !segs[segs.length - 1]) segs.pop();
  return first ? [TRANSFER_VERSION, first, ...segs].join('.') : '';
}

// Records carried by a transfer code, or null if it isn't one.
function decodeTransfer(code) {
  const parts = code.split('.');
  if (parts[0] !== TRANSFER_VERSION || !/^[1-9]\d*$/.test(parts[1] || '')) return null;

  const first = Number(parts[1]);
  const records = {};
  for (let i = 2; i < parts.length; i++) {
    const m = /^([0-5]{0,5})((?:[a-z]{5})*)$/.exec(parts[i]);
    if (!m) return null;
    const key = keyForNumber(first + i - 2);
    if (!parts[i] || !isPlayable(key)) continue;
    records[key] = cleanRecord({
      stars: m[1].split('').map(Number),
      guesses: m[2].match(/.{5}/g) || [],
    });
  }
  return records;
}

// Records forwarded by the old address, or null if they don't parse.
function decodeMoved(json) {
  let parsed = null;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const records = {};
  for (const key of Object.keys(parsed)) {
    if (isPlayable(key)) records[key] = cleanRecord(parsed[key]);
  }
  return records;
}

// Accepts a whole transfer link or just its code. Long links sometimes get
// wrapped or followed by punctuation when pasted, so whitespace is dropped
// and the code ends at the first character it can't contain.
function extractTransferCode(text) {
  const compact = text.replace(/\s+/g, '').toLowerCase();
  const at = compact.indexOf('transfer=');
  const code = at === -1 ? compact : compact.slice(at + 'transfer='.length);
  return code.replace(/[^0-9a-z.].*$/, '');
}

function isFurtherAlong(a, b) {
  if (a.stars.length !== b.stars.length) return a.stars.length > b.stars.length;
  return a.guesses.length > b.guesses.length;
}

// Days in `incoming` that would move this device's records forward.
function importChanges(incoming) {
  const records = readRecords();
  return Object.keys(incoming)
    .filter(key => isFurtherAlong(incoming[key], cleanRecord(records[key])))
    .sort();
}

function applyImport(incoming, keys) {
  const records = readRecords();
  for (const key of keys) {
    const { stars, guesses } = incoming[key];
    records[key] = { v: RECORD_VERSION, stars, guesses };
  }
  writeRecords(records);
  markHelpSeen();
  loadDay(state.date);   // the day on screen may be one that just changed
}

function describeGames(records, keys) {
  const stars = keys.reduce((sum, key) => sum + records[key].stars.reduce((a, b) => a + b, 0), 0);
  return keys.length + (keys.length === 1 ? ' game' : ' games') + ' (★ ' + stars + ')';
}

// ── Transfer modal ───────────────────────────────────────────

let transferUrl = '';

function openTransfer() {
  renderTransferLink();
  document.getElementById('transfer-input').value = '';
  setTransferStatus('');
  openModal('transfer-modal', 'stats-btn');
}

function renderTransferLink() {
  const code = encodeTransfer();
  // Point at wherever the game is running, so the link lands in the same
  // site (and so the same storage) on the other device.
  const base = /^https?:$/.test(location.protocol)
    ? location.origin + location.pathname
    : SITE_URL;
  transferUrl = code ? base + '#transfer=' + code : '';

  // Describe the link by decoding it, so the summary reflects exactly what
  // the other device will receive.
  const sending = code ? decodeTransfer(code) : {};
  const keys = Object.keys(sending);
  document.getElementById('transfer-summary').textContent = keys.length
    ? 'This link carries ' + describeGames(sending, keys) + '.'
    : 'No games played on this device yet.';

  const share = document.getElementById('transfer-share');
  const copy = document.getElementById('transfer-copy');
  share.hidden = !navigator.share;
  share.disabled = !transferUrl;
  copy.disabled = !transferUrl;
  copy.classList.toggle('primary', !navigator.share);
}

function setTransferStatus(text, isError) {
  const el = document.getElementById('transfer-status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function shareTransfer() {
  navigator.share({ title: 'Magic Flute Words stats', url: transferUrl }).catch(() => {});
}

function copyTransfer() {
  const btn = document.getElementById('transfer-copy');
  const failed = () => setTransferStatus("Couldn't copy the link here - try Share instead.", true);
  try {
    navigator.clipboard.writeText(transferUrl).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
    }).catch(failed);
  } catch (e) {
    failed();   // no clipboard API outside https
  }
}

function importPasted() {
  const input = document.getElementById('transfer-input');
  const code = extractTransferCode(input.value);
  if (!code) {
    setTransferStatus('Paste a transfer link first.', true);
    return;
  }

  const incoming = decodeTransfer(code);
  if (!incoming) {
    setTransferStatus("That doesn't look like a complete transfer link.", true);
    return;
  }

  const keys = importChanges(incoming);
  if (keys.length === 0) {
    setTransferStatus('Nothing new - this device already has those games.');
    return;
  }

  applyImport(incoming, keys);
  input.value = '';
  renderTransferLink();
  setTransferStatus('Imported ' + describeGames(incoming, keys) + '.');
}

// ── Import from a link ───────────────────────────────────────

// Reads a transfer (or domain-move) link from the address, then clears it
// right away so a reload doesn't offer it again. On page load this runs before
// analytics start (see startAnalytics), so they don't see it then.
function takeImportFromUrl() {
  const hash = location.hash;
  let pending = null;

  if (hash.startsWith('#transfer=')) {
    pending = { records: decodeTransfer(extractTransferCode(hash)), moved: false };
  } else if (hash.startsWith('#moved=')) {
    let json = null;
    try {
      json = decodeURIComponent(hash.slice('#moved='.length));
    } catch (e) {
      // Mangled escapes - treat like any other unreadable payload.
    }
    pending = { records: json && decodeMoved(json), moved: true };
  } else {
    return null;
  }

  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    // Some browsers reject replaceState on file:// - the import still works.
  }
  return pending;
}

let pendingImport = null;

// Asks before merging a link's games into this device. Returns whether the
// dialog opened: a move from the old address that brings nothing new is
// passed over silently, since the player never asked for it.
function offerImport({ records, moved }) {
  const keys = records ? importChanges(records) : [];
  if (moved && keys.length === 0) return false;

  const message = document.getElementById('import-message');
  const canImport = keys.length > 0;

  if (canImport) {
    pendingImport = { records, keys };
    message.textContent = moved
      ? 'Magic Flute Words has moved to magicflutewords.com. Bring along your '
        + describeGames(records, keys) + ' from the old address?'
      : 'Import ' + describeGames(records, keys) + ' from another device?';
  } else {
    pendingImport = null;
    message.textContent = records
      ? 'This device already has every game in that link.'
      : 'This transfer link is incomplete or damaged. Try copying it again.';
  }

  document.getElementById('import-note').hidden = !canImport;
  document.getElementById('import-confirm').hidden = !canImport;
  document.getElementById('import-cancel').textContent = canImport ? 'Not now' : 'OK';
  openModal('import-modal', 'stats-btn');
  return true;
}

function confirmImport() {
  closeModal('import-modal');
  if (!pendingImport) return;
  applyImport(pendingImport.records, pendingImport.keys);
  pendingImport = null;
  openStats();
}

// ── Analytics consent ────────────────────────────────────────
//
// Google Analytics is loaded from here rather than from the page's <head>, so
// on page load it starts only after takeImportFromUrl() has cleared any
// transfer link from the address, and only with consent where that's needed:
//
// - In a European time zone, or one that hides the location, gtag.js loads
//   only once the player accepts in the consent banner.
// - Elsewhere it loads right away, but consent still defaults to denied for
//   visitors Google itself locates in the EEA, UK or Switzerland, in case the
//   time zone is misleading - for them it runs without cookies.
// - A player who declines never loads it.
//
// Ad signals are denied everywhere - the game shows no ads. The choice is kept
// in localStorage, and Cookie settings (help and stats modals) reopens the
// banner to change it.

const GA_ID = 'G-K1YMM1CQY8';
const CONSENT_KEY = 'rcn-consent';

// The EEA (with the EU regions Google may report as their own countries), the
// UK and Switzerland, as ISO 3166 codes.
const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  'IS', 'LI', 'NO', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'GB', 'CH',
];

// Time zones that ask first: all of Europe (more than strictly needed - asking
// too many is the safe side), EU regions elsewhere, and zones that hide the
// location, like the UTC that privacy-hardened browsers report.
const CONSENT_ZONES = /^(Europe\/|Arctic\/|Etc\/|UTC$|GMT$|Atlantic\/(Azores|Canary|Faroe|Madeira|Reykjavik)$|Asia\/(Nicosia|Famagusta)$|Indian\/(Reunion|Mayotte)$|America\/(Cayenne|Guadeloupe|Martinique|Marigot)$)/;

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }

let consent = null;            // 'granted', 'denied', or null (not chosen)
let analyticsLoaded = false;

function readConsent() {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch (e) {
    return null;   // storage blocked - ask again each visit
  }
}

function asksFirst() {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    // No time zone to go by - treat it like a hidden one.
  }
  return zone === '' || CONSENT_ZONES.test(zone);
}

function loadAnalytics() {
  if (analyticsLoaded) return;
  analyticsLoaded = true;
  gtag('js', new Date());
  gtag('config', GA_ID);
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(script);
}

// Expires the _ga and _ga_<ID> cookies, which GA sets on the bare domain.
function clearAnalyticsCookies() {
  const domain = location.hostname.split('.').slice(-2).join('.');
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (!name.startsWith('_ga')) continue;
    document.cookie = name + '=; Max-Age=0; path=/';
    document.cookie = name + '=; Max-Age=0; path=/; domain=' + domain;
  }
}

function startAnalytics() {
  const noAds = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
  gtag('consent', 'default', { ...noAds, analytics_storage: 'denied', region: CONSENT_REGIONS });
  gtag('consent', 'default', { ...noAds, analytics_storage: 'granted' });

  consent = readConsent();
  if (consent) gtag('consent', 'update', { analytics_storage: consent });

  if (consent === 'granted' || (!consent && !asksFirst())) loadAnalytics();
  else if (!consent) showConsentBanner();
}

function showConsentBanner() {
  const status = document.getElementById('consent-status');
  status.textContent = consent === 'granted' ? 'You currently accept.'
                     : consent === 'denied' ? 'You currently decline.'
                     : '';
  status.hidden = !consent;
  document.getElementById('consent-banner').hidden = false;
}

function setConsent(choice) {
  consent = choice;
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch (e) {
    // Storage blocked - the choice holds for this visit only.
  }
  gtag('consent', 'update', { analytics_storage: choice });
  if (choice === 'granted') loadAnalytics();
  else clearAnalyticsCookies();
  document.getElementById('consent-banner').hidden = true;
}

// ── Event wiring ─────────────────────────────────────────────

document.addEventListener('keydown', e => {
  const modal = openModalEl();
  if (modal) {
    if (e.key === 'Escape') closeModal(modal.id);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Backspace' || e.key === 'Enter') {
    handleKey(e.key);
  } else if (/^[a-zA-Z]$/.test(e.key)) {
    handleKey(e.key.toLowerCase());
  }
});

document.querySelectorAll('.key[data-key]').forEach(btn => {
  btn.addEventListener('click', () => handleKey(btn.dataset.key));
});

document.querySelectorAll('.modal-backdrop').forEach(modal => {
  modal.querySelector('.modal-close')
    .addEventListener('click', () => closeModal(modal.id));
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal(modal.id);
  });
});

document.getElementById('help-btn').addEventListener('click', openHelp);
document.getElementById('stats-btn').addEventListener('click', openStats);

document.getElementById('date-btn').addEventListener('click', openGamePicker);
document.getElementById('date-today').addEventListener('click', () => {
  closeModal('date-modal');
  loadDay(todayKey());
});

document.getElementById('transfer-btn').addEventListener('click', () => {
  closeModal('stats-modal');
  openTransfer();
});
document.getElementById('date-transfer').addEventListener('click', () => {
  closeModal('date-modal');
  openTransfer();
});
document.getElementById('transfer-share').addEventListener('click', shareTransfer);
document.getElementById('transfer-copy').addEventListener('click', copyTransfer);
document.getElementById('transfer-import').addEventListener('click', importPasted);
document.getElementById('import-confirm').addEventListener('click', confirmImport);
document.getElementById('import-cancel').addEventListener('click', () => closeModal('import-modal'));

document.getElementById('consent-accept').addEventListener('click', () => setConsent('granted'));
document.getElementById('consent-decline').addEventListener('click', () => setConsent('denied'));
document.querySelectorAll('.cookie-settings').forEach(btn => {
  btn.addEventListener('click', () => {
    closeModal(btn.closest('.modal-backdrop').id);
    showConsentBanner();
    document.getElementById('consent-accept').focus();
  });
});

// A transfer link opened in a tab already showing the game only changes the
// fragment, which doesn't reload the page.
window.addEventListener('hashchange', () => {
  const pending = takeImportFromUrl();
  if (!pending) return;
  const open = openModalEl();
  if (open) closeModal(open.id);
  offerImport(pending);
});

// ── Boot ─────────────────────────────────────────────────────

document.getElementById('date-earliest').textContent =
  '#1 (' + formatDay(FIRST_DAY, true) + ')';
const linkedImport = takeImportFromUrl();
startAnalytics();   // only now that any transfer link is out of the address
loadDay(initialDay());
if (!(linkedImport && offerImport(linkedImport)) && !hasSeenHelp()) openHelp();
