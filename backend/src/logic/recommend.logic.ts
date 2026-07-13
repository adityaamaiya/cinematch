import type { ILogic, ITmdbService, Mood, Recommendation } from '../types/index.js';
import { Profile } from '../models/profile.model.js';
import { DEFAULT_GENRE_IDS, GENRE_NAME_TO_ID, MOOD_GENRES } from '../constants/moods.js';
import { verdictBand } from '../lib/affinity.js';
import type { MovieLookup } from './movieLookup.js';
import type { LlmRecommend } from './llmRecommend.logic.js';

export interface RecommendInput {
  mood?: Mood;
  genre?: string;
  limit: number;
  userKey: string;
}

// Two modes: LLM (taste-profile picks, when Gemini is configured) with a genre-discover fallback
// (mood/genre → TMDB discover) so recommend + mood chips still work with no key.
export class RecommendLogic implements ILogic<RecommendInput, Recommendation[]> {
  constructor(
    private readonly tmdb: ITmdbService,
    private readonly lookup: MovieLookup,
    private readonly llmRecommend?: LlmRecommend,
  ) {}

  async execute(input: RecommendInput): Promise<Recommendation[]> {
    if (this.llmRecommend) {
      const llm = await this.recommendViaLlm(input).catch(() => null);
      // Non-empty LLM result wins; otherwise fall through to discover (Gemini down / all dropped).
      if (llm && llm.length) return llm;
    }
    return this.recommendViaDiscover(input);
  }

  // LLM suggestions → drop already-watched → resolve on TMDB (drops hallucinations) → verdict band.
  private async recommendViaLlm(input: RecommendInput): Promise<Recommendation[]> {
    const [suggestions, rated] = await Promise.all([
      this.llmRecommend!.execute({ mood: input.mood, genre: input.genre, limit: input.limit }),
      Profile.getRatedMovies(input.userKey).catch(() => []),
    ]);
    const watched = new Set(rated.map((m) => key(m.title, m.year)));
    const preferredLanguages = await Profile.findLanguagePriority(input.userKey).catch(() => []);

    const recs: Recommendation[] = [];
    for (const s of suggestions) {
      if (recs.length >= input.limit) break;
      if (watched.has(key(s.title, s.year))) continue;
      const movie = await this.lookup.execute({ title: s.title, year: s.year, preferredLanguages });
      if (!movie) continue; // TMDB can't find it → probable hallucination
      recs.push({
        title: movie.title,
        year: movie.year,
        verdict: movie.released !== false ? verdictBand(movie.rating) : 'Skip',
        tmdbRating: movie.rating,
        posterUrl: movie.posterUrl,
      });
    }
    return recs;
  }

  // Fallback: explicit genre → mood preset → Drama, then TMDB discover by rating. Also drops
  // already-watched (over-fetching to survive the drops) so mood picks exclude rated titles even
  // when the LLM is down.
  private async recommendViaDiscover(input: RecommendInput): Promise<Recommendation[]> {
    const genreIds = this.resolveGenreIds(input);
    const [movies, rated] = await Promise.all([
      this.tmdb.discover(genreIds, input.limit + 10),
      Profile.getRatedMovies(input.userKey).catch(() => []),
    ]);
    const watched = new Set(rated.map((m) => key(m.title, m.year)));
    const recs: Recommendation[] = [];
    for (const movie of movies) {
      if (recs.length >= input.limit) break;
      if (watched.has(key(movie.title, movie.year))) continue;
      recs.push({
        title: movie.title,
        year: movie.year,
        verdict: movie.released !== false ? verdictBand(movie.rating) : 'Skip',
        tmdbRating: movie.rating,
        posterUrl: movie.posterUrl,
      });
    }
    return recs;
  }

  private resolveGenreIds(input: RecommendInput): number[] {
    if (input.genre) {
      const id = GENRE_NAME_TO_ID[input.genre.trim().toLowerCase()];
      if (id) return [id];
    }
    if (input.mood) return MOOD_GENRES[input.mood];
    return DEFAULT_GENRE_IDS;
  }
}

// Watched-key: title+year so a same-name different-year film isn't wrongly dropped.
const key = (title: string, year?: number): string => `${title.trim().toLowerCase()}|${year ?? ''}`;
