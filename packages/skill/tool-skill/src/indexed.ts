/** Optional, user-only /name lookup for a local skills-globais TSV index. */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@arx-ai/cordis'
import { isSkillName, type SkillDefinition } from '@arx-ai/arx-skill'
import { loadIndexedSkill } from '@arx-ai/arx-skill-filesystem'

const MAX_INDEX_BYTES = 2 * 1024 * 1024

/**
 * The TSV is a discovery hint, never an authorization or body source.
 * @param ctx Context whose filesystem policy reads the selected body.
 * @param root Absolute catalog root configured by the host.
 * @param name Name from a direct user gesture.
 * @param signal Cancellation of the current turn.
 * @returns The loaded skill or undefined for a miss or rejected body.
 */
export async function lookupIndexedSkill(
  ctx: Context,
  root: string,
  name: string,
  signal?: AbortSignal,
): Promise<SkillDefinition | undefined> {
  if (!isSkillName(name) || !isAbsolute(root)) return undefined
  signal?.throwIfAborted()
  const index = join(root, 'catalogo', 'indice-skills.tsv')
  let data: Buffer
  try {
    const info = await stat(index)
    if (!info.isFile() || info.size > MAX_INDEX_BYTES) return undefined
    data = await readFile(index, { signal })
  } catch (error) {
    signal?.throwIfAborted()
    if (typeof error === 'object' && error !== null && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
    throw error
  }
  if (data.length > MAX_INDEX_BYTES) return undefined
  let matches = 0
  for (const line of data.toString('utf8').split('\n')) {
    if (line.startsWith('#')) continue
    const fields = line.split('\t')
    if (fields.length !== 3) continue
    if (fields[0]?.trim().replace(/^\*/, '') === name) matches += 1
  }
  if (matches !== 1) return undefined
  // Name is grammar-validated, so the only possible address is root/name/SKILL.md.
  // The loader checks realpath containment and parses the actual file and policy.
  return await loadIndexedSkill(ctx, root, name, signal)
}
