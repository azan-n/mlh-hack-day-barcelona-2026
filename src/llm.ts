// LM Studio's local server speaks the OpenAI API (chat/completions + models)
// once you enable "Local Server" in the app — http://localhost:1234/v1 by
// default, regardless of OS.
const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1';

interface LmStudioModelsResponse {
  data?: { id: string }[];
}

interface LmStudioChatResponse {
  choices?: { message?: { content?: string } }[];
}

export async function listLmStudioModels(): Promise<string[]> {
  const res = await fetch(`${LM_STUDIO_BASE_URL}/models`);
  if (!res.ok) throw new Error(`LM Studio returned ${res.status}`);
  const data = (await res.json()) as LmStudioModelsResponse;
  return (data.data ?? []).map((m) => m.id);
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

const DEFAULT_INSTRUCTION = 'Write a musically interesting variation of the focused line — same instrument/idiom, but rhythmically or melodically different (a fill, an inversion, a different subdivision, an octave shift, added ornamentation, etc).';

/**
 * Asks a local LM Studio model to write one new Strudel layer from a
 * free-text instruction (e.g. "add atmospheric strings", "make it busier").
 * `focusLine`, if given, is a line currently selected in the editor — used
 * as style/instrument context, not a literal target to edit.
 */
export async function generateLine(model: string, instruction: string, fullContext: string, focusLine?: string): Promise<string> {
  const focusBlock = focusLine
    ? `\nThe user has this line selected/focused — use it for style, instrument, or key/scale context if relevant, but you don't have to literally edit it:\n${focusLine}\n`
    : '';

  const prompt = `You are a live-coding assistant for Strudel, a JavaScript pattern language for algorithmic music (similar to Tidal Cycles).

Syntax rules — follow these exactly:
- Mini-notation strings like "bd ~ sd ~" or "[c4@2 ~ e4]" describe rhythms/sequences. "~" is a rest and must be its own space-separated token (never glued to a note like "a4~c5").
- \`.s("name")\` sets the SOUND/SAMPLE/SYNTH to use — "name" must be one of: a dirt-samples sample like bd, sd, hh, cp, arpy, bass, casio, jazz (dirt-samples is already loaded in this buffer), or a synth waveform like sine, triangle, sawtooth, square. Never put a note name in \`.s()\`.
- \`.note("...")\` or \`n("...")\` sets the PITCHES to play (note names like c4, e4, g4, or scale degrees) — this is separate from \`.s()\`, e.g. \`note("c4 e4 g4").s("triangle")\`.
- Strudel buffers can hold multiple simultaneously-playing layers, each written as a separate top-level line in the form \`$: <pattern expression>\` (the \`$:\` label is required and makes the layer play alongside the others — e.g. \`$: s("bd ~ sd ~").gain(0.8)\` or \`$: note("c4 e4 g4").s("triangle")\`).

Full pattern currently in the editor, for context:
${fullContext}
${focusBlock}
Instruction: ${instruction.trim() || DEFAULT_INSTRUCTION}

Write exactly ONE new layer that satisfies the instruction, as a single line in the form \`$: <pattern expression>\`. Respond with ONLY that one line of code. No markdown code fences, no explanation, no comments.`;

  const res = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      // Skips the model's reasoning pass for thinking-capable models (e.g.
      // gemma-4-e2b) — ~20s+ down to well under a second for this task,
      // which doesn't need chain-of-thought for a one-line code completion.
      // Ignored harmlessly by models that don't support it.
      reasoning_effort: 'none',
    }),
  });
  if (!res.ok) {
    throw new Error(`LM Studio returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as LmStudioChatResponse;
  const cleaned = stripCodeFence(data.choices?.[0]?.message?.content ?? '');
  const firstLine = (cleaned.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
  // Guarantee the `$:` (or `<label>:`) prefix even if the model drops it —
  // an unlabeled line wouldn't join the other layers when evaluated.
  return /^[\w$]+\s*:/.test(firstLine) ? firstLine : `$: ${firstLine}`;
}
