import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import SkillRegistry from '@arx-ai/arx-skill'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@arx-ai/arx-skill'
import * as SkillGit from '../src/index.ts'

const harness = vi.hoisted(() => ({
  controls: [] as SkillProviderControl[],
  disposal: [] as ReturnType<typeof vi.fn<() => Promise<void>>>[],
  list: vi.fn<() => Promise<readonly SkillCandidate[]>>(),
}))
vi.mock('@arx-ai/arx-skill-filesystem', () => ({
  FileSystemSkillProvider: class {
    constructor(_ctx: Context, control: SkillProviderControl) {
      harness.controls.push(control)
      harness.disposal.push(this.dispose)
    }
    list() { return harness.list() }
    dispose = vi.fn(async () => {})
  },
}))
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  harness.controls.length = 0
  harness.disposal.length = 0
  vi.restoreAllMocks()
})

it('disposes every active discovery delegate, ignores its transient invalidation, and refuses new work', async () => {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  let captured: SkillProvider | undefined
  const register = ctx.skills.registerProvider.bind(ctx.skills)
  vi.spyOn(ctx.skills, 'registerProvider').mockImplementation(create => register((control) => {
    const provider = create(control); captured = provider; return provider
  }))
  SkillGit.apply(ctx, {
    projects: [{ cwd: process.cwd(), sources: [{ repository: process.cwd(), commit: 'a'.repeat(40), selectedDirs: ['skills'] }] }],
  })
  if (captured === undefined) throw new Error('Expected registered Git provider')
  const provider = captured
  vi.spyOn(ctx.skillGit, 'materializeDirectories').mockResolvedValue({
    root: process.cwd(), repository: process.cwd(), commit: 'a'.repeat(40), files: [],
  })
  const pending = Promise.withResolvers<readonly SkillCandidate[]>()
  harness.list.mockReturnValue(pending.promise)
  const listing = provider.list({ cwd: process.cwd() })
  await vi.waitFor(() => { expect(harness.list).toHaveBeenCalledOnce() })
  const changed = vi.fn()
  ctx.on('skills/change', changed)
  harness.controls[1]!.invalidate()
  expect(changed).not.toHaveBeenCalled()
  await ctx.fiber.dispose()
  expect(harness.disposal).toHaveLength(2)
  for (const dispose of harness.disposal) expect(dispose).toHaveBeenCalledOnce()
  await expect(provider.list({ cwd: process.cwd() })).rejects.toThrow('provider is disposed')
  pending.resolve([])
  expect(await listing).toEqual([])
})
