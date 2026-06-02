import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/e2e.spec.ts',
        'src/index.ts',
        'src/**/types.ts',
        'src/types/**'
      ]
    }
  }
});
