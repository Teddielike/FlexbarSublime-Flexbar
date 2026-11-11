import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'src/plugin.js',
  output: {
    file: 'de.teddielike.flexbar-sublime-text.plugin/backend/plugin.cjs',
    format: 'cjs',
    exports: 'auto'
  },
  plugins: [
    json(),
    nodeResolve({
      browser: false,
      exportConditions: ['node'],
      preferBuiltins: true
    }),
    commonjs()
  ],
  external: [/^node:/]
};
