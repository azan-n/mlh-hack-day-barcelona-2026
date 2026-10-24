import type { HarnessOptions, HarnessResult, QuantizedNote, RawNote, ScaleName } from './types';

const SCALES: Record<ScaleName, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

/** Snaps a MIDI pitch to the nearest pitch class present in the given scale. */
function snapToScale(midi: number, rootPitchClass: number, scaleIntervals: number[]): number {
  const pc = (((midi - rootPitchClass) % 12) + 12) % 12;
  let best = midi;
  let bestDelta = Infinity;
  for (const interval of scaleIntervals) {
    // shift into [-6, 5] so we find the nearest octave-wrapped occurrence of this scale tone
    const delta = (((interval - pc + 6 + 12) % 12) - 6);
    if (Math.abs(delta) < Math.abs(bestDelta)) {
      bestDelta = delta;
      best = midi + delta;
    }
  }
  return best;
}

/**
 * The "cleanup harness": takes raw Basic Pitch note events (which are noisy,
 * loosely timed, and often chromatic) and turns them into a small set of
 * quantized, scale-snapped, polyphony-aware voices suitable for a Strudel
 * mini-notation pattern.
 */
export function cleanNotes(raw: RawNote[], opts: HarnessOptions): HarnessResult {
  const beatsPerSecond = opts.bpm / 60;
  const scaleIntervals = SCALES[opts.scale];

  const beatNotes = raw
    .filter((n) => n.amplitude >= opts.minAmplitude)
    .map((n) => ({
      startBeat: n.startTimeSeconds * beatsPerSecond,
      durationBeats: Math.max(n.durationSeconds * beatsPerSecond, 1 / opts.stepsPerBeat),
      pitchMidi:
        opts.scale === 'chromatic'
          ? Math.round(n.pitchMidi)
          : snapToScale(Math.round(n.pitchMidi), opts.rootPitchClass, scaleIntervals),
    }));

  if (beatNotes.length === 0) {
    return { voices: [], totalSteps: opts.stepsPerBeat * 4, cycleBeats: 4, stepsPerBeat: opts.stepsPerBeat };
  }

  const lastEndBeat = Math.max(...beatNotes.map((n) => n.startBeat + n.durationBeats));
  const cycleBeats = Math.max(4, Math.round(lastEndBeat / 4) * 4);
  const totalSteps = cycleBeats * opts.stepsPerBeat;

  let stepped = beatNotes.map((n) => {
    let startStep = Math.round(n.startBeat * opts.stepsPerBeat);
    let durationSteps = Math.max(1, Math.round(n.durationBeats * opts.stepsPerBeat));
    if (startStep >= totalSteps) startStep = totalSteps - 1;
    if (startStep + durationSteps > totalSteps) durationSteps = totalSteps - startStep;
    return { startStep, durationSteps, pitchMidi: n.pitchMidi };
  });

  // Drop exact duplicates (same start step + pitch), keep sorted by time.
  stepped.sort((a, b) => a.startStep - b.startStep || a.pitchMidi - b.pitchMidi);
  const deduped: typeof stepped = [];
  for (const n of stepped) {
    const dup = deduped.find((d) => d.startStep === n.startStep && d.pitchMidi === n.pitchMidi);
    if (!dup) deduped.push(n);
  }

  // Greedily pack notes into the minimum number of non-overlapping voices.
  const voiceEnds: number[] = [];
  const voices: QuantizedNote[][] = [];
  for (const n of deduped) {
    let placed = false;
    for (let v = 0; v < voiceEnds.length; v++) {
      if (voiceEnds[v] <= n.startStep) {
        voices[v].push({ ...n, voice: v });
        voiceEnds[v] = n.startStep + n.durationSteps;
        placed = true;
        break;
      }
    }
    if (!placed) {
      voices.push([{ ...n, voice: voices.length }]);
      voiceEnds.push(n.startStep + n.durationSteps);
    }
  }

  // Glue together touching same-pitch notes within a voice (legato).
  for (const voice of voices) {
    for (let i = voice.length - 2; i >= 0; i--) {
      if (voice[i].pitchMidi === voice[i + 1].pitchMidi && voice[i].startStep + voice[i].durationSteps === voice[i + 1].startStep) {
        voice[i].durationSteps += voice[i + 1].durationSteps;
        voice.splice(i + 1, 1);
      }
    }
  }

  return { voices, totalSteps, cycleBeats, stepsPerBeat: opts.stepsPerBeat };
}
