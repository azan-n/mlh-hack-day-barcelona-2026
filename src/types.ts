export interface RawNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

export type ScaleName = 'chromatic' | 'major' | 'minor' | 'majorPentatonic' | 'minorPentatonic';

export interface HarnessOptions {
  bpm: number;
  stepsPerBeat: number;
  minAmplitude: number;
  scale: ScaleName;
  rootPitchClass: number;
}

export interface QuantizedNote {
  startStep: number;
  durationSteps: number;
  pitchMidi: number;
  voice: number;
}

export interface HarnessResult {
  voices: QuantizedNote[][];
  totalSteps: number;
  cycleBeats: number;
  stepsPerBeat: number;
}
