// Maps raw TMDB responses → our domain types. The service owns the HTTP call + candidate selection
// (pickBest) + genre-map loading; this adapter owns the pure response shaping. All methods are sync.
// Main entry: adapt(search item + genre map → TmdbMovie); the rest map the sub-endpoints.
import type { IAdapter, MovieCredits, TmdbMovie, WatchInfo, WatchProvider } from '../types/index.js';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

// --- raw TMDB shapes (what the API returns) ---
export interface TmdbSearchItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string; // movie
  name?: string; // tv
  release_date?: string; // movie
  first_air_date?: string; // tv
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  poster_path?: string | null;
  original_language?: string;
}

interface TmdbProvider {
  provider_name: string;
  logo_path?: string | null;
}
export interface TmdbRegion {
  link?: string;
  flatrate?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
}
export interface TmdbCreditsRaw {
  cast?: { name?: string; order?: number }[];
  crew?: { name?: string; job?: string }[];
}
export interface TmdbVideo {
  site?: string;
  type?: string;
  key?: string;
  official?: boolean;
}

/** A search item plus the loaded genre id→name map — everything adapt() needs to be pure + sync. */
export interface TmdbMovieRaw {
  item: TmdbSearchItem;
  genres: Map<number, string>;
}

export class TmdbAdapter implements IAdapter<TmdbMovieRaw, TmdbMovie> {
  adapt({ item, genres }: TmdbMovieRaw): TmdbMovie {
    const releaseDate = item.release_date ?? item.first_air_date ?? undefined;
    const today = new Date().toISOString().slice(0, 10);
    return {
      tmdbId: item.id,
      mediaType: item.media_type === 'tv' ? 'tv' : 'movie',
      title: item.title ?? item.name ?? 'Unknown',
      year: this.yearOf(item),
      rating: item.vote_average ?? 0,
      voteCount: item.vote_count,
      genres: (item.genre_ids ?? []).map((id) => genres.get(id)).filter((g): g is string => !!g),
      language: item.original_language,
      posterUrl: item.poster_path ? `${IMAGE_BASE}${item.poster_path}` : undefined,
      releaseDate,
      released: !!releaseDate && releaseDate <= today,
    };
  }

  yearOf(item: TmdbSearchItem): number | undefined {
    const date = item.release_date ?? item.first_air_date;
    const y = date ? Number(date.slice(0, 4)) : NaN;
    return Number.isFinite(y) ? y : undefined;
  }

  // Director (crew) + top-billed actor (cast order 0). Either may be missing (esp. for TV).
  credits(raw: TmdbCreditsRaw): MovieCredits {
    const director = (raw.crew ?? []).find((c) => c.job === 'Director')?.name;
    const leadActor = [...(raw.cast ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0]?.name;
    return { director, leadActor };
  }

  // One country's JustWatch availability → WatchInfo, or null when nothing's listed.
  watch(region: TmdbRegion | undefined): WatchInfo | null {
    if (!region) return null;
    const map = (list?: TmdbProvider[]): WatchProvider[] =>
      (list ?? []).map((p) => ({
        name: p.provider_name,
        logoUrl: p.logo_path ? `${LOGO_BASE}${p.logo_path}` : undefined,
      }));
    const info: WatchInfo = {
      link: region.link,
      flatrate: map(region.flatrate),
      rent: map(region.rent),
      buy: map(region.buy),
    };
    return info.flatrate.length || info.rent.length || info.buy.length ? info : null;
  }

  // First official YouTube trailer (falls back to any trailer, then a teaser) as a watch URL.
  trailer(videos: TmdbVideo[]): string | undefined {
    const yt = videos.filter((v) => v.site === 'YouTube' && v.key);
    const best =
      yt.find((v) => v.type === 'Trailer' && v.official) ??
      yt.find((v) => v.type === 'Trailer') ??
      yt.find((v) => v.type === 'Teaser') ??
      yt[0];
    return best?.key ? `https://www.youtube.com/watch?v=${best.key}` : undefined;
  }
}
