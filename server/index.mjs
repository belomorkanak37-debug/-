import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WWW_ROOT = path.join(PROJECT_ROOT, 'www');

const PORT = Number(process.env.PORT || 4177);
const KP_BASE = 'https://kinopoiskapiunofficial.tech/api';

// Ключ хранится только на сервере/хостинге. Не добавляй его в HTML или репозиторий.
const KINOPOISK_API_KEY = process.env.KINOPOISK_API_KEY || '';

const TYPE_LABELS = {
  FILM: 'фильм',
  TV_SERIES: 'сериал',
  MINI_SERIES: 'сериал',
  TV_SHOW: 'шоу'
};

const GENRE_ALIASES = {
  'романтика': 'мелодрама',
  'мультфильм': 'мультфильм',
  'аниме': 'аниме'
};

const RUSSIA_COUNTRY = 'Россия';
const FOREIGN_COUNTRIES = [
  'США', 'Великобритания', 'Франция', 'Германия', 'Италия',
  'Испания', 'Канада', 'Япония', 'Корея Южная', 'Австралия'
];

const YEAR_RANGES = {
  fresh: { from: 2020, to: new Date().getFullYear() },
  y2010: { from: 2010, to: 2019 },
  y2000: { from: 2000, to: 2009 },
  y1990: { from: 1990, to: 1999 },
  retro: { from: 1888, to: 1989 }
};

let filtersCache = null;
let filtersCacheAt = 0;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text);
}

function readArrayParam(searchParams, name) {
  const values = searchParams.getAll(name).flatMap(value => String(value).split(','));
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function clamp(number, min, max) {
  const n = Number(number);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function cleanString(value) {
  return String(value || '').trim().toLowerCase();
}

async function kpGet(endpoint, params = {}) {
  if (!KINOPOISK_API_KEY) {
    const error = new Error('Не задан ключ источника данных. Добавь переменную окружения KINOPOISK_API_KEY на сервере.');
    error.status = 500;
    throw error;
  }

  const url = new URL(`${KP_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': KINOPOISK_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}

    if (!response.ok) {
      const message = json?.message || json?.status_message || text || response.statusText;
      const error = new Error(`Источник данных ответил с ошибкой ${response.status}: ${message}`);
      error.status = response.status;
      error.details = json || text;
      throw error;
    }

    return json;
  } catch (error) {
    if (error.status) throw error;
    const message = error.name === 'AbortError'
      ? 'таймаут запроса к kinopoiskapiunofficial.tech'
      : `${error.message || error}${error.cause?.code ? ` (${error.cause.code})` : ''}`;
    const wrapped = new Error(`Источник данных временно не отвечает: ${message}`);
    wrapped.status = 502;
    wrapped.details = { endpoint, params };
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

async function getFilters() {
  const now = Date.now();
  if (filtersCache && now - filtersCacheAt < 24 * 60 * 60 * 1000) return filtersCache;

  // У сервиса встречаются обе версии пути в гайдах/обёртках, пробуем новую и старую.
  try {
    filtersCache = await kpGet('/v2.2/films/filters');
  } catch (error) {
    if (error.status !== 404) throw error;
    filtersCache = await kpGet('/v2.1/films/filters');
  }
  filtersCacheAt = now;
  return filtersCache;
}

async function genreIdByName(name) {
  const filters = await getFilters();
  const target = cleanString(GENRE_ALIASES[name] || name);
  const genre = (filters.genres || []).find(item => cleanString(item.genre) === target);
  return genre?.id || null;
}

async function countryIdByName(name) {
  const filters = await getFilters();
  const target = cleanString(name);
  const country = (filters.countries || []).find(item => cleanString(item.country) === target);
  return country?.id || null;
}

async function buildCountryId(mode, selectedOrigin) {
  if (selectedOrigin === 'russian') return countryIdByName(RUSSIA_COUNTRY);
  if (selectedOrigin !== 'foreign') return null;

  const preferred = mode.flavor === 'anime'
    ? ['Япония']
    : mode.flavor === 'cartoon'
      ? ['США', 'Япония', 'Франция', 'Великобритания', 'Канада']
      : FOREIGN_COUNTRIES;

  for (let i = 0; i < preferred.length; i++) {
    const name = pick(preferred);
    const id = await countryIdByName(name);
    if (id) return id;
  }
  return null;
}

function selectedYearRange(selectedYears) {
  if (!selectedYears.length) return null;
  const key = selectedYears.find(value => YEAR_RANGES[value]) || selectedYears[0];
  return YEAR_RANGES[key] || null;
}

async function buildGenreId(mode, selectedGenres) {
  // У Kinopoisk API жанры работают строго, поэтому для рандома берём один главный жанр.
  // Для аниме/мультфильмов главный жанр фиксируем, чтобы не выпадали обычные фильмы.
  if (mode.flavor === 'anime') return genreIdByName('аниме');
  if (mode.flavor === 'cartoon') return genreIdByName('мультфильм');
  if (selectedGenres.length) return genreIdByName(pick(selectedGenres));
  return null;
}

function chooseMode(types) {
  const selected = types.length ? types : ['movie', 'series', 'cartoon', 'anime'];
  const mode = pick(selected);

  if (mode === 'series') return { type: pick(['TV_SERIES', 'MINI_SERIES']), flavor: 'series' };
  if (mode === 'cartoon') return { type: pick(['ALL', 'FILM', 'TV_SERIES']), flavor: 'cartoon' };
  if (mode === 'anime') return { type: pick(['ALL', 'FILM', 'TV_SERIES']), flavor: 'anime' };
  return { type: 'FILM', flavor: 'movie' };
}

function itemGenres(item) {
  return Array.isArray(item?.genres) ? item.genres.map(g => g.genre).filter(Boolean) : [];
}

function itemCountries(item) {
  return Array.isArray(item?.countries) ? item.countries.map(c => c.country).filter(Boolean) : [];
}

function hasGenre(item, genre) {
  return itemGenres(item).map(cleanString).includes(cleanString(genre));
}

function isAnime(item) {
  return hasGenre(item, 'аниме') || cleanString(item?.type) === 'anime';
}

function isCartoon(item) {
  return hasGenre(item, 'мультфильм');
}

function matchesRequestedMode(item, mode) {
  const typeRaw = cleanString(item?.type);
  const anime = isAnime(item);
  const cartoon = isCartoon(item);

  if (mode.flavor === 'anime') return anime;
  if (mode.flavor === 'cartoon') return cartoon && !anime;
  if (mode.flavor === 'series') return ['tv_series', 'mini_series'].includes(typeRaw) && !anime && !cartoon;
  if (mode.flavor === 'movie') return typeRaw === 'film' && !anime && !cartoon;
  return true;
}

function matchesSelectedOrigin(item, selectedOrigin) {
  if (!selectedOrigin) return true;
  const countries = itemCountries(item).map(cleanString);
  const isRussian = countries.includes(cleanString(RUSSIA_COUNTRY));
  if (selectedOrigin === 'russian') return isRussian;
  if (selectedOrigin === 'foreign') return countries.length ? !isRussian : true;
  return true;
}

function matchesSelectedYear(item, range) {
  if (!range) return true;
  const year = Number(item?.year);
  if (!Number.isFinite(year)) return true;
  return year >= range.from && year <= range.to;
}

function itemTitle(item) {
  return item?.nameRu || item?.nameOriginal || item?.nameEn || item?.name || '';
}

function parseRating(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function matchesSelectedGenres(item, selectedGenres) {
  if (!selectedGenres.length) return true;
  const names = itemGenres(item).map(cleanString);
  return selectedGenres.some(name => {
    const target = cleanString(GENRE_ALIASES[name] || name);
    return names.includes(target);
  });
}

async function searchByFilters(params) {
  // Основной современный путь.
  try {
    return await kpGet('/v2.2/films', params);
  } catch (error) {
    // Старый путь из части клиентов/документации.
    if (error.status === 404 || error.status === 400) {
      return await kpGet('/v2.1/films/search-by-filters', params);
    }
    throw error;
  }
}

async function getFilmDetails(id) {
  try {
    return await kpGet(`/v2.2/films/${id}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function discoverRandom(searchParams) {
  const types = readArrayParam(searchParams, 'types');
  const selectedGenres = readArrayParam(searchParams, 'genres');
  const selectedYears = readArrayParam(searchParams, 'years');
  const yearRange = selectedYearRange(selectedYears);
  const origins = readArrayParam(searchParams, 'origins');
  const selectedOrigin = origins.includes('russian') && !origins.includes('foreign')
    ? 'russian'
    : origins.includes('foreign') && !origins.includes('russian')
      ? 'foreign'
      : '';
  let lastError = null;

  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const mode = chooseMode(types);
      const genreId = await buildGenreId(mode, selectedGenres);
      const countryId = await buildCountryId(mode, selectedOrigin);

      const baseParams = {
        order: pick(['RATING', 'NUM_VOTE', 'YEAR']),
        type: mode.type,
        ratingFrom: mode.flavor === 'movie' ? 6 : 5,
        ratingTo: 10,
        page: 1
      };
      if (yearRange) {
        baseParams.yearFrom = yearRange.from;
        baseParams.yearTo = yearRange.to;
      }
      if (genreId) baseParams.genres = genreId;
      if (countryId) baseParams.countries = countryId;

      const firstPage = await searchByFilters(baseParams);
      const totalPages = clamp(firstPage?.totalPages || firstPage?.pagesCount || 1, 1, 20);
      const randomPage = Math.floor(Math.random() * totalPages) + 1;
      const pageData = randomPage === 1 ? firstPage : await searchByFilters({ ...baseParams, page: randomPage });
      const rawItems = pageData?.items || pageData?.films || [];

      let candidates = rawItems.filter(item => {
        const rating = parseRating(item.ratingKinopoisk || item.rating || item.ratingImdb);
        return itemTitle(item)
          && (item.posterUrlPreview || item.posterUrl)
          && rating >= 5
          && matchesRequestedMode(item, mode)
          && matchesSelectedOrigin(item, selectedOrigin)
          && matchesSelectedYear(item, yearRange);
      });

      // Если пользователь выбрал жанр, стараемся показать совпадение, но не падаем, если API вернул слишком узкую выборку.
      const strict = candidates.filter(item => matchesSelectedGenres(item, selectedGenres));
      if (strict.length) candidates = strict;

      if (!candidates.length) {
        lastError = new Error('По этим фильтрам ничего не нашлось. Пробуем ещё раз.');
        continue;
      }

      const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 6);
      for (const chosen of shuffled) {
        const id = chosen.kinopoiskId || chosen.filmId;
        const details = id ? await getFilmDetails(id) : null;
        const merged = { ...chosen, ...(details || {}) };
        if (!matchesRequestedMode(merged, mode)) continue;
        if (!matchesSelectedOrigin(merged, selectedOrigin)) continue;
        if (!matchesSelectedYear(merged, yearRange)) continue;
        return normalizeKinopoiskItem({ item: chosen, details, requestedMode: mode });
      }

      lastError = new Error('Попался тайтл не из той полки. Перетряхиваем ещё раз.');
      continue;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Не удалось подобрать тайтл. Попробуй сбросить фильтры.');
}

function normalizeKinopoiskItem({ item, details, requestedMode }) {
  const merged = { ...item, ...(details || {}) };
  const id = merged.kinopoiskId || merged.filmId;
  const genres = itemGenres(merged);
  const lowerGenres = genres.map(cleanString);
  const typeRaw = merged.type || item.type || '';
  let typeLabel = TYPE_LABELS[typeRaw] || (requestedMode.flavor === 'series' ? 'сериал' : 'фильм');

  if (lowerGenres.includes('аниме')) typeLabel = 'аниме';
  else if (lowerGenres.includes('мультфильм')) typeLabel = 'мультфильм';

  const rating = parseRating(merged.ratingKinopoisk || merged.rating || item.ratingKinopoisk || item.rating);
  const title = merged.nameRu || merged.nameOriginal || item.nameRu || item.nameOriginal || 'Без названия';
  const originalTitle = merged.nameOriginal || merged.nameEn || item.nameOriginal || item.nameEn || '';

  return {
    source: 'Кинопоиск',
    id,
    typeLabel,
    title,
    originalTitle: originalTitle && originalTitle !== title ? originalTitle : '',
    year: merged.year || item.year || '',
    rating,
    votes: merged.ratingKinopoiskVoteCount || merged.ratingVoteCount || 0,
    genres,
    countries: itemCountries(merged),
    description: merged.description || merged.shortDescription || item.description || item.shortDescription || '',
    posterUrl: merged.posterUrlPreview || item.posterUrlPreview || merged.posterUrl || item.posterUrl || '',
    kinopoiskUrl: merged.webUrl || (id ? `https://www.kinopoisk.ru/film/${id}/` : '')
  };
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

async function serveStatic(res, pathname) {
  let safePath = decodeURIComponent(pathname);
  if (safePath === '/') safePath = '/index.html';
  const filePath = path.normalize(path.join(WWW_ROOT, safePath));
  if (!filePath.startsWith(WWW_ROOT)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const cacheControl = ext === '.html' || ext === '.js' || ext === '.webmanifest'
      ? 'no-cache'
      : 'public, max-age=604800';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
    res.end(data);
  } catch (_) {
    sendJson(res, 404, { error: 'Not Found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    if (url.pathname === '/api/random') {
      const item = await discoverRandom(url.searchParams);
      sendJson(res, 200, item);
      return;
    }

    if (url.pathname === '/api/ping') {
      const filters = await getFilters();
      sendJson(res, 200, {
        ok: true,
        genres: Array.isArray(filters.genres) ? filters.genres.length : 0,
        countries: Array.isArray(filters.countries) ? filters.countries.length : 0
      });
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    const status = error.status && Number.isInteger(error.status) ? error.status : 500;
    sendJson(res, status, {
      error: error.message || String(error),
      details: error.details || null
    });
  }
});

server.listen(PORT, () => {
  console.log(`Чё позырить? сервер запущен на порту ${PORT}`);
  console.log(`Локально: http://localhost:${PORT}/`);
  console.log(`Проверка связи: http://localhost:${PORT}/api/ping`);
});
