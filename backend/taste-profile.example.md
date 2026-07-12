# Taste profile (example)

Copy this to `taste-profile.md` and replace it with a prose summary of **your** taste, distilled
from your ratings. The LLM taste mode feeds this (not your raw ratings) into every `/score` call,
so keep it compact but specific. `taste-profile.md` is gitignored — it's per-deployment.

Easiest way to generate it: paste your rated films (title + verdict) into a capable LLM (Claude,
Gemini, …) and ask it to write 4–6 short paragraphs covering the sections below, grounded in the
actual titles. Then save the result as `backend/taste-profile.md` and redeploy.

---

**Overall.** One or two sentences on the through-line of what this viewer loves — e.g. "gravitates
to tightly-crafted, emotionally intense, auteur-driven films; rewards ambition and craft over
spectacle."

**Loves (Perfection / Go For It).** Favourite directors, actors, genres, tones, structures, eras,
and languages — with example titles. E.g. "Bong Joon-ho, Nolan, Villeneuve; slow-burn thrillers,
heist/mind-bender structures, moral ambiguity; Parasite, Oldboy, Whiplash, the Dark Knight trilogy."

**Turn-offs (Timepass / Skip).** What consistently underwhelms them and why. E.g. "formulaic
franchise filler and quippy MCU comedies (Thor: Love and Thunder, Captain Marvel); rates them
Timepass/Skip for weightless stakes and house-style humour."

**Nuances.** Anything that complicates the pattern — e.g. "will forgive a conventional romance if
the lead performances land; language mix leans Hindi/English with a strong South-Indian streak."
