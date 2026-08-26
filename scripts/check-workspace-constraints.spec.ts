/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@arx-ai/arx-experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@arx-ai/arx-prototype' },
    })).toEqual([
      '@arx-ai/arx-prototype: experimental package name must start with "@arx-ai/arx-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@arx-ai/arx-experimental-prototype: experimental package must set "private": true',
      '@arx-ai/arx-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@arx-ai/arx-consumer',
          [section]: { '@arx-ai/arx-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@arx-ai/arx-consumer: ${section}.@arx-ai/arx-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@arx-ai/arx-test-only',
        devDependencies: { '@arx-ai/arx-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@arx-ai/arx-experimental-consumer',
        dependencies: { '@arx-ai/arx-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@arx-ai/arx-python-runtime',
        dependencies: { '@arx-ai/arx-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@arx-ai/arx-python-runtime: dependencies.@arx-ai/arx-experimental-prototype must not reference an experimental package',
    ])
  })
})
