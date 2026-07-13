// Regenerates the taste-profile prose from the user's ratings and installs it live. This is the
// "compression" step: hundreds of {title, verdict} rows → a small prose blob the cheap runtime
// taste model (LlmTaste) reasons over on every /score. Runs infrequently (auto every N ratings, the
// manual "Refresh taste" button, or `npm run gen-taste`), so a big output budget is fine.
//
// The current profile is fed back in as a style/depth EXEMPLAR so successive regens keep the shape
// the original (Opus-authored) profile established, rather than drifting shorter each time.
import { writeFile } from 'node:fs/promises';
import type { ILlm, ILogger, ILogic, RatedMovie, TasteProfileRef } from '../types/index.js';
import { Profile } from '../models/profile.model.js';

export interface GenerateTasteInput {
  userKey: string;
}

// Generous budget: the runtime taste call is capped at 2048 (tiny JSON), but a full prose profile is
// longer and these are thinking models — too tight a budget yields an empty MAX_TOKENS reply.
const REGEN_MAX_OUTPUT_TOKENS = 8192;

export class GenerateTasteLogic implements ILogic<GenerateTasteInput, boolean> {
  constructor(
    private readonly llm: ILlm,
    private readonly tasteRef: TasteProfileRef,
    /** Absolute path to taste-profile.md — the regen persists the prose here for restart survival. */
    private readonly profilePath: string,
    private readonly logger: ILogger,
  ) {}

  // Returns true when the profile was regenerated + installed, false on any failure (caller treats a
  // failure as a no-op — the previous profile + version stay intact).
  async execute({ userKey }: GenerateTasteInput): Promise<boolean> {
    const rated = await Profile.getRatedMovies(userKey);
    if (!rated.length) {
      this.logger.warn('taste regen skipped — no ratings');
      return false;
    }
    try {
      const { text } = await this.llm.generate(this.prompt(rated), false, undefined, REGEN_MAX_OUTPUT_TOKENS);
      const prose = text.trim().replace(/^```(?:markdown|md)?\s*|\s*```$/g, '').trim();
      if (!prose) throw new Error('empty regen output');

      // Persist first (so a restart survives), then install live + bump the version (busts the
      // taste cache), then reset the counter.
      await writeFile(this.profilePath, prose + '\n', 'utf8');
      this.tasteRef.text = prose;
      this.tasteRef.version = await Profile.bumpTasteVersion(userKey);
      await Profile.resetRegenCounter(userKey);
      this.logger.info(`taste profile regenerated (v${this.tasteRef.version}) from ${rated.length} ratings`);
      return true;
    } catch (err) {
      this.logger.error('taste regen failed — keeping previous profile', err);
      return false;
    }
  }

  private prompt(rated: RatedMovie[]): string {
    // One line per rating; the verdict is the signal. Newest first (as stored).
    const list = rated
      .map((r) => `- ${r.title}${r.year ? ` (${r.year})` : ''} [${r.type}] → ${r.verdict}`)
      .join('\n');

    const exemplar = this.tasteRef.text.trim();
    const exemplarBlock = exemplar
      ? `\nHere is the CURRENT taste profile. Match its structure, depth, tone, and section layout —
produce an updated version of the same quality, not a shorter summary:\n\n${exemplar}\n`
      : '';

    return `You are building a personal "taste profile" for one film viewer, written as prose that a
smaller model will later read to predict whether they'll enjoy a given title. Reason over their
ratings below (verdict scale: Skip < Timepass < Go For It < Perfection) and describe their taste:
the tones, themes, structures, genres, languages, directors, and eras they gravitate to or avoid.
Be specific and cite patterns you actually see in the list. Do NOT list every film back; synthesise.
Output ONLY the profile prose (Markdown ok), no preamble.
${exemplarBlock}
Their ${rated.length} ratings (newest first):
${list}`;
  }
}
