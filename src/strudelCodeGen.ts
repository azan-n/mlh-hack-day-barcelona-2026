import type { HarnessResult, QuantizedNote } from './types';

const NOTE_NAMES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];

export function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function weightToken(symbol: string, weight: number): string {
  return weight === 1 ? symbol : `${symbol}@${weight}`;
}

function buildVoiceMini(voice: QuantizedNote[], totalSteps: number): string {
  const tokens: string[] = [];
  let cursor = 0;
  for (const n of voice) {
    if (n.startStep > cursor) {
      tokens.push(weightToken('~', n.startStep - cursor));
    }
    tokens.push(weightToken(midiToNoteName(n.pitchMidi), n.durationSteps));
    cursor = n.startStep + n.durationSteps;
  }
  if (cursor < totalSteps) {
    tokens.push(weightToken('~', totalSteps - cursor));
  }
  return `[${tokens.join(' ')}]`;
}

/** Builds a single Strudel pattern expression (not yet `.play()`ed) from cleaned note voices. */
export function buildStrudelPattern(harness: HarnessResult, sound: string): string {
  if (harness.voices.length === 0) {
    return 'silence';
  }
  const voiceStrs = harness.voices.map((v) => `note("${buildVoiceMini(v, harness.totalSteps)}")`);
  const body = voiceStrs.length === 1 ? voiceStrs[0] : `stack(\n  ${voiceStrs.join(',\n  ')}\n)`;
  return `${body}.s("${sound}")`;
}

/**
 * Inserts a pattern as a `$:`-labeled layer (Strudel's convention for
 * stacking multiple independently-evaluated patterns in one buffer — see
 * https://strudel.cc, `label: pattern` compiles to `pattern.p('label')`).
 *
 * Tempo is set with `.cpm(bpm / cycleBeats)` chained directly onto the
 * line, not a shared global `setcpm(...)`. `.cpm()` is a per-pattern method
 * (`pat._fast(cpm / 60 / scheduler.cps)`) that locks just this layer to the
 * given cycles-per-minute regardless of the global clock — so each
 * recording keeps the cycle length it was quantized against even if a
 * later recording (with a different cycleBeats) changes the global tempo.
 *
 * If `previousLine` is given and still appears verbatim in `code`, its
 * *last* occurrence is replaced in place (re-applying cleanup settings
 * updates the same layer instead of piling up duplicates — last, not
 * first, because two layers can end up with identical text, e.g.
 * re-recording the same phrase, and the most recent one is always the one
 * `previousLine` is meant to track); otherwise the new layer is appended.
 */
export function upsertPatternLayer(code: string, pattern: string, cycleBeats: number, bpm: number, previousLine: string | null): { code: string; line: string } {
  const cpm = bpm / cycleBeats;
  const line = `$: ${pattern}.cpm(${cpm})`;
  const idx = previousLine === null ? -1 : code.lastIndexOf(previousLine);
  const next =
    previousLine !== null && idx >= 0
      ? code.slice(0, idx) + line + code.slice(idx + previousLine.length)
      : `${code.replace(/\s+$/, '')}\n${line}`;
  return { code: next, line };
}

const DIRT_SAMPLES_LINE = `samples('github:tidalcycles/dirt-samples')`;
const DIRT_SAMPLES_RE = /^samples\(.*dirt-samples.*\)\s*$/m;

/**
 * Makes sure `samples('github:tidalcycles/dirt-samples')` is present as the
 * first line of the buffer. The sample pack is already loaded invisibly via
 * prebake, but keeping the call visible in the code (a) makes the buffer
 * work standalone if copy-pasted into strudel.cc, and (b) gives the LLM a
 * concrete, correct set of sound names (bd, sd, hh, cp, arpy, ...) to use
 * in `.s(...)` calls instead of hallucinating ones that don't exist.
 */
export function ensureDirtSamplesLoaded(code: string): string {
  return DIRT_SAMPLES_RE.test(code) ? code : `${DIRT_SAMPLES_LINE}\n${code}`;
}
