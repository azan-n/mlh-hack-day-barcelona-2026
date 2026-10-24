import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { RawNote } from './types';

let basicPitch: BasicPitch | null = null;

function getBasicPitch(): BasicPitch {
  if (!basicPitch) {
    basicPitch = new BasicPitch(`${import.meta.env.BASE_URL}model/model.json`);
  }
  return basicPitch;
}

export async function transcribe(
  audioData: Float32Array,
  onProgress?: (percent: number) => void,
): Promise<RawNote[]> {
  const model = getBasicPitch();
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await model.evaluateModel(
    audioData,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (percent) => onProgress?.(percent),
  );

  const notes = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)));

  return notes.map((n) => ({
    startTimeSeconds: n.startTimeSeconds,
    durationSeconds: n.durationSeconds,
    pitchMidi: n.pitchMidi,
    amplitude: n.amplitude,
    pitchBends: n.pitchBends,
  }));
}
