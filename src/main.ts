import './style.css';
import '@strudel/repl/repl-component.mjs';
import { AudioRecorder, decodeBlobToAudioBuffer, resampleForBasicPitch } from './audioRecorder';
import { transcribe } from './basicPitchTranscribe';
import { cleanNotes } from './harness';
import { buildStrudelPattern, ensureDirtSamplesLoaded, upsertPatternLayer } from './strudelCodeGen';
import { downloadMidi } from './midiExport';
import { generateLine, listLmStudioModels } from './llm';
import type { HarnessOptions, RawNote } from './types';

const DEFAULT_CODE = ensureDirtSamplesLoaded('$: s("bd ~ sd ~").gain(0.8)');

// `<strudel-editor>` is the real Strudel REPL as a web component — its own
// StrudelMirror (CodeMirror + autocomplete + Ctrl/Alt-Enter to evaluate,
// Ctrl/Alt-. to stop) and its own prebake (sample/synth loading), all from a
// single self-contained bundle.
const editorRoot = document.getElementById('editorRoot') as HTMLElement;
const editorEl = document.createElement('strudel-editor') as StrudelEditorElement;
editorEl.setAttribute('code', DEFAULT_CODE);
editorRoot.appendChild(editorEl);
if (editorEl.editor) {
  editorEl.editor.root.classList.add('strudel-editor');
  editorEl.editor.updateSettings({
    ...editorEl.settings,
    isAutoCompletionEnabled: true,
    isTooltipEnabled: true,
    isLineNumbersDisplayed: true,
  });
}

const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
const stopRecordBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;
const recordStatus = document.getElementById('recordStatus') as HTMLSpanElement;

const bpmInput = document.getElementById('bpm') as HTMLInputElement;
const gridSelect = document.getElementById('grid') as HTMLSelectElement;
const scaleSelect = document.getElementById('scale') as HTMLSelectElement;
const rootSelect = document.getElementById('root') as HTMLSelectElement;
const minAmpInput = document.getElementById('minAmp') as HTMLInputElement;
const soundInput = document.getElementById('sound') as HTMLInputElement;
const applyBtn = document.getElementById('applyBtn') as HTMLButtonElement;

const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
const hushBtn = document.getElementById('hushBtn') as HTMLButtonElement;
const downloadMidiBtn = document.getElementById('downloadMidiBtn') as HTMLButtonElement;

const modelInput = document.getElementById('modelInput') as HTMLInputElement;
const modelDatalist = document.getElementById('modelDatalist') as HTMLDataListElement;

const generateForm = document.getElementById('generateForm') as HTMLFormElement;
const generateInput = document.getElementById('generateInput') as HTMLInputElement;
const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
const generateStatus = document.getElementById('generateStatus') as HTMLSpanElement;

const iterateForm = document.getElementById('iterateForm') as HTMLFormElement;
const iterateInput = document.getElementById('iterateInput') as HTMLInputElement;

const recorder = new AudioRecorder();
let rawNotes: RawNote[] = [];
let lastGeneratedLine: string | null = null;

/** Single write path for the editor buffer — always keeps the dirt-samples line present. */
function setEditorCode(code: string): void {
  editorEl.editor?.setCode(ensureDirtSamplesLoaded(code));
}

function readHarnessOptions(): HarnessOptions {
  return {
    bpm: Number(bpmInput.value) || 120,
    stepsPerBeat: Number(gridSelect.value) || 4,
    minAmplitude: Number(minAmpInput.value) || 0,
    scale: scaleSelect.value as HarnessOptions['scale'],
    rootPitchClass: Number(rootSelect.value) || 0,
  };
}

/**
 * `forceNewLayer: true` (a fresh recording) always appends a new `$:` layer,
 * so repeated recordings stack up instead of overwriting each other.
 * `forceNewLayer: false` (re-applying cleanup settings to the same take)
 * replaces the layer this same take last produced, so tweaking knobs and
 * re-applying doesn't pile up duplicates of the same recording.
 */
function insertTranscribedPattern(forceNewLayer: boolean): void {
  if (rawNotes.length === 0 || !editorEl.editor) return;
  const opts = readHarnessOptions();
  const harness = cleanNotes(rawNotes, opts);
  const pattern = buildStrudelPattern(harness, soundInput.value.trim() || 'triangle');
  const { code, line } = upsertPatternLayer(editorEl.editor.code, pattern, harness.cycleBeats, opts.bpm, forceNewLayer ? null : lastGeneratedLine);
  lastGeneratedLine = line;
  setEditorCode(code);
}

recordBtn.addEventListener('click', async () => {
  try {
    await recorder.start();
    recordBtn.disabled = true;
    stopRecordBtn.disabled = false;
    recordStatus.textContent = 'recording...';
  } catch (err) {
    recordStatus.textContent = `mic error: ${(err as Error).message}`;
  }
});

stopRecordBtn.addEventListener('click', async () => {
  stopRecordBtn.disabled = true;
  recordStatus.textContent = 'decoding...';
  const blob = await recorder.stop();
  recordBtn.disabled = false;

  const audioBuffer = await decodeBlobToAudioBuffer(blob);
  const resampled = await resampleForBasicPitch(audioBuffer);

  recordStatus.textContent = 'transcribing...';
  rawNotes = await transcribe(resampled, (pct) => {
    recordStatus.textContent = `transcribing... ${Math.round(pct * 100)}%`;
  });

  recordStatus.textContent = `done — ${rawNotes.length} raw notes detected`;
  applyBtn.disabled = false;
  downloadMidiBtn.disabled = rawNotes.length === 0;
  insertTranscribedPattern(true);
});

applyBtn.addEventListener('click', () => insertTranscribedPattern(false));

playBtn.addEventListener('click', () => {
  editorEl.editor?.evaluate();
});

hushBtn.addEventListener('click', () => {
  editorEl.editor?.stop();
});

downloadMidiBtn.addEventListener('click', () => {
  downloadMidi(rawNotes);
});

// --- LM Studio model list (best-effort; its local server may not be running) ---
listLmStudioModels()
  .then((models) => {
    modelDatalist.innerHTML = '';
    for (const name of models) {
      const option = document.createElement('option');
      option.value = name;
      modelDatalist.appendChild(option);
    }
    if (!modelInput.value && models[0]) modelInput.value = models[0];
  })
  .catch(() => {
    modelInput.placeholder = 'LM Studio not reachable';
  });

// --- Generating new layers via a local LM Studio model ---
// Two entry points, one underlying call: the toolbar box works on the whole
// buffer (for open-ended requests like "add a beat" / "make it more
// atmospheric" that aren't about any one line), and the floating form that
// appears on text selection scopes the request to that line as style
// context (and defaults to "vary this line" if you submit it empty).
let selectedLineRange: { from: number; to: number; text: string } | null = null;

function updateSelection(): void {
  const view = editorEl.editor?.editor;
  if (!view) return;
  const sel = view.state.selection.main;
  if (sel.empty) {
    iterateForm.hidden = true;
    selectedLineRange = null;
    return;
  }
  const fromLine = view.state.doc.lineAt(sel.from);
  const toLine = view.state.doc.lineAt(sel.to);
  const text = view.state.doc.toString().slice(fromLine.from, toLine.to);
  selectedLineRange = { from: fromLine.from, to: toLine.to, text };

  const coords = view.coordsAtPos(sel.head);
  if (!coords) return;
  iterateForm.hidden = false;
  iterateForm.style.top = `${Math.max(8, coords.top - 44)}px`;
  iterateForm.style.left = `${coords.left}px`;
}

if (editorEl.editor) {
  editorEl.editor.editor.dom.addEventListener('mouseup', updateSelection);
  editorEl.editor.editor.dom.addEventListener('keyup', updateSelection);
}

/**
 * Calls the model and splices the resulting `$:` layer into the editor.
 * If `focusText` is given, the new layer is inserted right after it;
 * otherwise it's appended at the end of the buffer.
 */
async function generateAndInsert(instruction: string, focusText: string | null): Promise<void> {
  if (!editorEl.editor) throw new Error('editor not ready');
  const model = modelInput.value.trim();
  if (!model) throw new Error('set a model');

  const newLine = await generateLine(model, instruction, editorEl.editor.code, focusText ?? undefined);
  const fullCode = editorEl.editor.code;
  let updated: string;
  if (focusText) {
    // Re-find the focus text in case it moved while we were waiting on LM Studio; fall back to the end of the buffer.
    const insertAt = fullCode.indexOf(focusText);
    const insertPoint = insertAt >= 0 ? insertAt + focusText.length : fullCode.length;
    updated = `${fullCode.slice(0, insertPoint)}\n${newLine}${fullCode.slice(insertPoint)}`;
  } else {
    updated = `${fullCode.replace(/\s+$/, '')}\n${newLine}`;
  }
  setEditorCode(updated);
}

generateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const instruction = generateInput.value.trim();
  if (!instruction) return;
  generateBtn.disabled = true;
  generateStatus.textContent = '… thinking';
  try {
    await generateAndInsert(instruction, selectedLineRange?.text ?? null);
    generateInput.value = '';
    generateStatus.textContent = 'added ✓';
    setTimeout(() => (generateStatus.textContent = ''), 1500);
  } catch (err) {
    console.error('generate failed', err);
    generateStatus.textContent = `⚠ ${(err as Error).message}`;
  } finally {
    generateBtn.disabled = false;
  }
});

iterateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedLineRange) return;
  const instruction = iterateInput.value.trim();
  const originalPlaceholder = iterateInput.placeholder;
  iterateInput.disabled = true;
  try {
    await generateAndInsert(instruction, selectedLineRange.text);
    iterateForm.hidden = true;
    iterateInput.value = '';
  } catch (err) {
    console.error('generate failed', err);
    iterateInput.placeholder = `⚠ ${(err as Error).message}`;
    setTimeout(() => (iterateInput.placeholder = originalPlaceholder), 2000);
  } finally {
    iterateInput.disabled = false;
  }
});

iterateInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    iterateForm.hidden = true;
    editorEl.editor?.editor.dom.focus();
  }
});
