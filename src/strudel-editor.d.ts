declare module '@strudel/repl/repl-component.mjs' {}

/** Minimal duck-typed slice of CodeMirror 6's EditorView — just what we read for selection handling. */
interface CmLine {
  number: number;
  from: number;
  to: number;
  text: string;
}
interface CmEditorView {
  dom: HTMLElement;
  state: {
    selection: { main: { from: number; to: number; empty: boolean; head: number } };
    doc: {
      lineAt(pos: number): CmLine;
      toString(): string;
    };
  };
  coordsAtPos(pos: number): { top: number; left: number; bottom: number; right: number } | null;
}

interface StrudelMirrorInstance {
  root: HTMLElement;
  editor: CmEditorView;
  code: string;
  evaluate(autostart?: boolean): Promise<void>;
  stop(): Promise<void>;
  setCode(code: string): void;
  updateSettings(settings: Record<string, unknown>): void;
}

interface StrudelEditorElement extends HTMLElement {
  code: string;
  solo: boolean;
  sync: boolean;
  settings: Record<string, unknown>;
  editor: StrudelMirrorInstance | null;
}
