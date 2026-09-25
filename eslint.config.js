import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', '.idea'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // The simulation must be bit-identical on every JS engine (replay validation, J4):
    // no libm transcendentals, no Math.random, no three.js trig helpers.
    files: ['src/sim/**/*.ts', 'src/core/rng.ts', 'src/core/ecs.ts', 'src/core/events.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          'sin',
          'cos',
          'tan',
          'asin',
          'acos',
          'atan',
          'atan2',
          'exp',
          'expm1',
          'log',
          'log1p',
          'log2',
          'log10',
          'pow',
          'hypot',
          'cbrt',
          'sinh',
          'cosh',
          'tanh',
          'random',
        ].map((property) => ({
          object: 'Math',
          property,
          message: 'Use src/core/dmath (deterministic) in the simulation.',
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(slerp|slerpQuaternions|setFromEuler|setFromAxisAngle|setFromQuaternion|angleTo|applyAxisAngle|random)$/]',
          message: 'three.js trig helpers are not deterministic across engines; use src/sim/math.ts helpers.',
        },
      ],
    },
  },
);
