import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'storybook-static/**', '.storybook/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  {
    // only the classic hooks-correctness rules - eslint-plugin-react-hooks's
    // "recommended" preset now bundles the full React Compiler readiness
    // rule set (e.g. react-hooks/immutability), which flags this codebase's
    // routine in-place mutation of loaded THREE.js objects (materials,
    // geometries) as errors - that's normal three.js/r3f style here, not a
    // bug, and this library isn't targeting the React Compiler
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // react-three-fiber's JSX intrinsics (mesh, meshStandardMaterial,
      // custom props like `attach`/`args`/`castShadow`) aren't standard DOM
      // elements/attributes, which is all this rule knows about; r3f's own
      // JSX namespace typings already validate these at the TS level
      'react/no-unknown-property': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  },
  prettier
);
