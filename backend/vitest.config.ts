import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment — this is a backend API, no DOM needed.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
