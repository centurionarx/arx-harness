import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../vitest.shared.ts'

// The repository config excludes POSIX hook suites on Windows; these driver tests mock only subprocesses.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    pool: 'forks',
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-invariants.ts'],
    include: [
      'packages/hooks/hook-protocol/tests/**/*.spec.ts',
      'packages/hooks/hooks-claude-code/tests/lifecycle.spec.ts',
      'packages/hooks/hooks-codex/tests/lifecycle.spec.ts',
    ],
  },
})
