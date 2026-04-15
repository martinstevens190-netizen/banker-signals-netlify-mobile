import OpenAI from 'openai';
import { APP_TIMEZONE, localNow } from './utils.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SPORTS_API_BASE_URL = process.env.SPORTS_API_BASE_URL || 'https://api.the-odds-api.com';
const ODDS_REGION = process.env.ODDS_REGION || 'au,uk,eu';
const ODDS_FORMAT = process.env.ODDS_FORMAT || 'decimal';
const ODDS_MARKETS = process.env.ODDS_MARKETS || 'h2h,totals';
const MAX_FIXTURES_FOR_AI = Number(process.env.MAX_FIXTURES_FOR_AI || 160);
const MAX_SCAN_HOURS = Number(process.env.MAX_SCAN_HOURS || 24);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing in Netlify environment variables.`);
  return value;
}

function melbourneLabel(iso) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function hoursFromNow(iso) {
  return (new Date(iso).getTime() - Date.now()) / 3600000;
}

function isWithinNextScanWindow(iso) {
  const hours = hoursFromNow(iso);
  return hours > 0 && hours <= MAX_SCAN_HOURS;
}

async function getActiveSoccerSportKeys() {
  const explicit = (process.env.ODDS_SPORT_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;

  const apiKey = requireEnv('SPORTS_API_KEY');
  const url = `${SPORTS_API_BASE_URL}/v4/sports/?apiKey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Odds API sports list failed: ${response.status}`);
  const sports = await response.json();

  return sports
    .filter((sport) => sport.group === 'Soccer' && sport.active && !sport.has_outrights)
    .map((sport) => sport.key);
}

async function fetchOddsForSport(sportKey) {
  const apiKey = requireEnv('SPORTS_API_KEY');
  const url = `${SPORTS_API_BASE_URL}/v4/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=${encodeURIComponent(ODDS_REGION)}&markets=${encodeURIComponent(ODDS_MARKETS)}&oddsFormat=${encodeURIComponent(ODDS_FORMAT)}&dateFormat=iso`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Odds API odds call failed for ${sportKey}: ${response.status}`);
  return response.json();
}

function bestH2HPrices(event) {
  const prices = { home: null, away: null, draw: null };
  for (const bookmaker of event.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== 'h2h') continue;
      for (const outcome of market.outcomes || []) {
        const price = Number(outcome.price);
        if (!Number.isFinite(price)) continue;
        if (outcome.name === event.home_team) prices.home = prices.home === null ? price : Math.max(prices.home, price);
        if (outcome.name === event.away_team) prices.away = prices.away === null ? price : Math.max(prices.away, price);
        if (String(outcome.name).toLowerCase() === 'draw') prices.draw = prices.draw === null ? price : Math.max(prices.draw, price);
      }
    }
  }
  return prices;
}

function totalsSnapshot(event) {
  const seen = [];
  for (const bookmaker of event.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== 'totals') continue;
      const over = (market.outcomes || []).find((o) => String(o.name).toLowerCase() === 'over');
      const under = (market.outcomes || []).find((o) => String(o.name).toLowerCase() === 'under');
      const point = over?.point ?? under?.point;
      if (point === undefined || point === null) continue;
      const line = `${point}`;
      if (seen.find((item) => item.line === line)) continue;
      seen.push({
        line,
        over: over?.price ?? null,
        under: under?.price ?? null,
      });
      if (seen.length >= 3) return seen;
    }
  }
  return seen;
}

function normalizeEvent(event) {
  return {
    fixtureId: event.id,
    league: event.sport_title,
    sportKey: event.sport_key,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    kickoffUtc: event.commence_time,
    kickoffMelbourne: melbourneLabel(event.commence_time),
    bestH2H: bestH2HPrices(event),
    totals: totalsSnapshot(event),
    bookmakerCount: (event.bookmakers || []).length,
  };
}

async function getUpcomingFixtures() {
  const sportKeys = await getActiveSoccerSportKeys();
  const results = await Promise.allSettled(sportKeys.map(fetchOddsForSport));
  const events = [];
  const failedSports = [];

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      events.push(...result.value);
    } else if (result.status === 'rejected') {
      failedSports.push(sportKeys[i]);
    }
  }

  const rawEventsCount = events.length;
  const eligible = [];
  const uniqueIds = new Set();

  for (const event of events) {
    if (!event?.id || !event?.commence_time) continue;
    if (uniqueIds.has(event.id)) continue;
    uniqueIds.add(event.id);
    if (!isWithinNextScanWindow(event.commence_time)) continue;
    eligible.push(normalizeEvent(event));
  }

  const fixtures = eligible
    .sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc))
    .slice(0, MAX_FIXTURES_FOR_AI);

  return {
    fixtures,
    debug: {
      requestedSportKeys: sportKeys.length,
      failedSportKeys: failedSports.length,
      failedSports,
      rawEventsCount,
      eligibleEventsCount: eligible.length,
      returnedFixturesCount: fixtures.length,
      scanWindowHours: MAX_SCAN_HOURS,
      regions: ODDS_REGION,
      markets: ODDS_MARKETS,
    },
  };
}

function buildUserMessage(promptName, promptBody, fixtures) {
  return [
    `Prompt name: ${promptName}`,
    `Prompt instructions: ${promptBody}`,
    '',
    'Rules:',
    '- Use ONLY the fixtures in the JSON below.',
    '- Use ONLY the user prompt and the raw fixture/odds data below.',
    '- Do NOT use outside prediction sites, tipsters, or invented team news.',
    `- Focus on yet-to-start matches in the next ${MAX_SCAN_HOURS} hours only.`,
    '- Return the banker games first. Keep it concise and practical.',
    '',
    'Fixtures JSON:',
    JSON.stringify(fixtures, null, 2),
  ].join('\n');
}

function failedInfo(debug) {
  if (!debug.failedSportKeys) return '';
  if (debug.failedSportKeys === 0) return '';
  const preview = (debug.failedSports || []).slice(0, 5).join(', ');
  return `Some sport feeds failed to load (${debug.failedSportKeys}/${debug.requestedSportKeys})${preview ? `: ${preview}` : ''}.`;
}

function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      banker: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' },
      },
      setA: {
        type: 'array',
        items: { type: 'string' },
      },
      setB: {
        type: 'array',
        items: { type: 'string' },
      },
      passList: {
        type: 'array',
        items: { type: 'string' },
      },
      summary: { type: 'string' },
      notificationTitle: { type: 'string' },
      notificationBody: { type: 'string' },
    },
    required: ['title', 'banker', 'setA', 'setB', 'passList', 'summary', 'notificationTitle', 'notificationBody'],
  };
}

async function runOpenAIScan(promptName, promptBody, fixtures) {
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'banker_scan',
        schema: schema(),
        strict: true,
      },
    },
    messages: [
      {
        role: 'system',
        content: [
          'You are a cautious pre-game banker scanner.',
          'Use only the supplied fixtures and odds data.',
          'Never use outside websites or external predictions.',
          'Return banker-focused selections in plain betting language.',
        ].join(' '),
      },
      {
        role: 'user',
        content: buildUserMessage(promptName, promptBody, fixtures),
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned an empty response.');
  return JSON.parse(raw);
}

export async function buildScanOutput({ promptName, promptBody, settings = {} }) {
  requireEnv('OPENAI_API_KEY');
  requireEnv('SPORTS_API_KEY');

  const bands = settings.bands || {
    shots_total: { upper: '28+', lower: '19+', recommended: '22+' },
    shots_on_target: { upper: '11+', lower: '7+', recommended: '8+' },
  };

  const { fixtures, debug } = await getUpcomingFixtures();
  if (!fixtures.length) {
    const explanation = [
      `No eligible yet-to-start football fixtures were found in the next ${MAX_SCAN_HOURS} hours.`,
      `The raw fixture feed returned ${debug.rawEventsCount} football events before filtering.`,
      `Regions used: ${debug.regions}. Markets used: ${debug.markets}.`,
      failedInfo(debug),
    ].filter(Boolean);

    return {
      title: '✅ Banker scan completed',
      createdAt: localNow().toISO(),
      source: 'odds-api-openai',
      promptName,
      promptBody,
      promptRan: false,
      banker: explanation,
      setA: [],
      setB: [],
      passList: [],
      summary: `No qualifying fixtures survived the next-${MAX_SCAN_HOURS}-hours football filter.`,
      bands,
      notificationTitle: '✅ Banker scan completed',
      notificationBody: `No eligible football fixtures found in the next ${MAX_SCAN_HOURS} hours.`,
      fixturesChecked: 0,
      filterDebug: debug,
    };
  }

  const ai = await runOpenAIScan(promptName, promptBody, fixtures);
  return {
    title: ai.title,
    createdAt: localNow().toISO(),
    source: 'odds-api-openai',
    promptName,
    promptBody,
    promptRan: true,
    banker: ai.banker,
    setA: ai.setA,
    setB: ai.setB,
    passList: ai.passList,
    summary: ai.summary,
    bands,
    fixturesChecked: fixtures.length,
    fixturesPreview: fixtures.slice(0, 10),
    filterDebug: debug,
    notificationTitle: ai.notificationTitle,
    notificationBody: ai.notificationBody,
  };
}
