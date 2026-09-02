import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { candidateBashPaths, resolveBashPath } from '@arx-ai/arx-bash-local'

const WIN32_ENV: NodeJS.ProcessEnv = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  'PATH': 'C:\\Program Files\\Git\\bin;"D:\\setx quoted";C:\\Windows\\System32;C:\\git-on-path',
}

/** The expected candidate names, built through the same join the resolver uses. */
const expected = (env: NodeJS.ProcessEnv = WIN32_ENV) => [
  join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
  join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'bash.exe'),
  join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
]

describe('candidateBashPaths', () => {
  it('lists well-known Git for Windows locations before PATH entries', () => {
    const candidates = candidateBashPaths(WIN32_ENV)
    expect(candidates.slice(0, 3)).toEqual(expected())
  })

  it('strips quotes from PATH entries but skips the WSL System32 tree', () => {
    const candidates = candidateBashPaths(WIN32_ENV)
    expect(candidates[3]).toBe(join(WIN32_ENV.PATH!.split(';')[0]!, 'bash.exe'))
    expect(candidates[4]).toBe(join('D:\\setx quoted', 'bash.exe'))
    expect(candidates).toContain(join('C:\\git-on-path', 'bash.exe'))
    expect(candidates.some(candidate => /system32/i.test(candidate))).toBe(false)
  })

  it('returns the first existing Git Bash candidate on win32', () => {
    const root = mkdtempSync(join(tmpdir(), 'arx-bash-first-'))
    mkdirSync(join(root, 'Git', 'bin'), { recursive: true })
    writeFileSync(join(root, 'Git', 'bin', 'bash.exe'), '')
    const result = resolveBashPath(undefined, { ProgramFiles: root, PATH: root }, 'win32')
    expect(result).toBe(join(root, 'Git', 'bin', 'bash.exe'))
  })

  it('walks candidates past non-existent entries to PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'arx-bash-walk-'))
    mkdirSync(join(root, 'on-path'), { recursive: true })
    writeFileSync(join(root, 'on-path', 'bash.exe'), '')
    const env: NodeJS.ProcessEnv = {
      ProgramFiles: join(root, 'absent-program-files'),
      'ProgramFiles(x86)': join(root, 'absent-x86'),
      'PATH': join(root, 'on-path'),
    }
    expect(resolveBashPath(undefined, env, 'win32')).toBe(join(root, 'on-path', 'bash.exe'))
  })

  it('defaults missing environment probes to the Git for Windows defaults', () => {
    const candidates = candidateBashPaths({ PATH: 'C:\\Program Files\\Git\\usr\\bin' })
    expect(candidates.slice(0, 3)).toEqual(expected({ ProgramFiles: undefined }))
    expect(candidates[candidates.length - 1]).toBe(join('C:\\Program Files\\Git\\usr\\bin', 'bash.exe'))
  })

  it('probes emptiness of every candidate shape through the real filesystem', () => {
    const root = mkdtempSync(join(tmpdir(), 'arx-bash-resolve-'))
    mkdirSync(join(root, 'file-shell'), { recursive: true })
    mkdirSync(join(root, 'file-shell', 'bash.exe'), { recursive: true })
    mkdirSync(join(root, 'missing-shell'), { recursive: true })
    const env: NodeJS.ProcessEnv = {
      ProgramFiles: join(root, 'file-shell'),
      PATH: join(root, 'missing-shell'),
    }
    // A directory named bash.exe is never a spawnable candidate and a missing
    // tree reports nothing; with every probe failing, resolution throws.
    expect(() => resolveBashPath(undefined, env, 'win32')).toThrowError(/no Git Bash executable found/)
  })
})

describe('resolveBashPath', () => {
  it('returns a non-empty configured path verbatim on every platform', () => {
    expect(resolveBashPath('C:\\custom\\bash.exe', WIN32_ENV, 'win32')).toBe('C:\\custom\\bash.exe')
    expect(resolveBashPath('/usr/local/bin/bash', undefined, 'linux')).toBe('/usr/local/bin/bash')
  })

  it('treats an empty configured value as unconfigured', () => {
    expect(resolveBashPath('', undefined, 'linux')).toBe('bash')
  })

  it('resolves by name on POSIX platforms', () => {
    expect(resolveBashPath(undefined, WIN32_ENV, 'linux')).toBe('bash')
    expect(resolveBashPath(undefined, WIN32_ENV, 'darwin')).toBe('bash')
  })

  it('returns the first existing Git Bash candidate on win32', () => {
    const root = mkdtempSync(join(tmpdir(), 'arx-bash-first-'))
    mkdirSync(join(root, 'Git', 'bin'), { recursive: true })
    writeFileSync(join(root, 'Git', 'bin', 'bash.exe'), '')
    const result = resolveBashPath(undefined, { ProgramFiles: root, PATH: root }, 'win32')
    expect(result).toBe(join(root, 'Git', 'bin', 'bash.exe'))
  })

  it('refuses loudly naming the search and the config escape when no Git Bash exists', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' }
    expect(() => resolveBashPath(undefined, env, 'win32')).toThrowError(/no Git Bash executable found/)
    expect(() => resolveBashPath(undefined, env, 'win32')).toThrowError(/bashPath/)
  })
})
