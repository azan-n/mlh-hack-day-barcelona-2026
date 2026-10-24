import { Midi } from '@tonejs/midi';
import type { RawNote } from './types';

export function notesToMidiBlob(notes: RawNote[]): Blob {
  const midi = new Midi();
  const track = midi.addTrack();
  for (const n of notes) {
    track.addNote({
      midi: Math.round(n.pitchMidi),
      time: n.startTimeSeconds,
      duration: n.durationSeconds,
      velocity: Math.max(0, Math.min(1, n.amplitude)),
    });
  }
  return new Blob([midi.toArray().buffer as ArrayBuffer], { type: 'audio/midi' });
}

export function downloadMidi(notes: RawNote[], filename = 'hum-to-strudel.mid'): void {
  const blob = notesToMidiBlob(notes);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
