import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // We import @strudel/repl/repl-component.mjs (source, not the
    // pre-bundled dist) so <strudel-editor> shares the same module
    // instances as the rest of the app. Its prebake() pulls these in via
    // dynamic import(); listing them here avoids a mid-session
    // re-optimization that would reload a package and orphan anything
    // already registered against the old module instance (e.g. samples
    // silently stop resolving).
    include: [
      '@strudel/core',
      '@strudel/mini',
      '@strudel/tonal',
      '@strudel/webaudio',
      '@strudel/codemirror',
      '@strudel/draw',
      '@strudel/hydra',
      '@strudel/soundfonts',
      '@strudel/midi',
      '@strudel/transpiler',
      '@strudel/repl',
    ],
  },
});
