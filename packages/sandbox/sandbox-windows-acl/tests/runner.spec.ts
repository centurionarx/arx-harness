/**
 * End-to-end runner tests: spawn the REAL runner entry through tsx (exactly
 * the argv shape arx-sandbox-local's confine() builds), with piped stdio
 * inherited through the runner into the confined child — the same chain a
 * production confined execution walks.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolvePwshPath } from '@arx-ai/arx-pwsh-local'
import { AclWriteGrant, tempWriteSid, workspaceWriteSid } from '../src/index.ts'

const isWin32 = process.platform === 'win32'
const runnerEntry = fileURLToPath(new URL('../src/runner.ts', import.meta.url))

// Functional probe, not where.exe: spawnSync never throws on a missing
// binary (status null) and where.exe exits 1 without pwsh — only an actual
// pwsh invocation's exit status is truth.
function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

function runRunner(args: string[], timeoutMs = 30_000) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', runnerEntry, ...args], {
    timeout: timeoutMs,
    encoding: 'utf8',
  })
}

/** One probe's outcome in the outside-the-roots rights matrix. */
interface ProbeCell {
  result: string
  detail: string
  stillExists?: boolean
  content?: string
}

// Files the outside-the-roots matrix plants in a directory the runner user
// fully controls; each probe targets its own victim.
const OUTSIDE_VICTIM_FILES = [
  'v-pwsh-remove.txt', 'v-cmd-del.txt', 'v-dotnet.txt', 'v-node-unlink.txt', 'v-rename.txt',
  'v-move.txt', 'v-masks.txt', 'v-dacl.txt', 'v-icacls.txt',
]

// The confined Node half of the matrix (CommonJS, written to the scratch
// directory at run time). argv: koffi entry path, outside directory,
// workspace directory, mode. It prints one `PROBE-JSON` line and never
// throws, so one native run reports every probe. The self-relative security
// descriptor grants Everyone FILE_ALL_ACCESS: SECURITY_DESCRIPTOR_RELATIVE
// (20 bytes) + ACL header (8) + ACCESS_ALLOWED_ACE (8) + S-1-1-0 (12).
const OUTSIDE_RIGHTS_PROBE = String.raw`'use strict'
const fs = require('node:fs')
const path = require('node:path')
const [koffiEntry, outside, workspace, mode] = process.argv.slice(2)
const results = {}
const errorCell = (error) => ({
  result: error && (error.code === 'EPERM' || error.code === 'EACCES') ? 'DENIED' : 'ERROR',
  detail: String(error && error.code) + ': ' + String(error && error.message),
})
const fsProbe = (name, operation) => {
  try { operation(); results[name] = { result: 'OK', detail: '' } } catch (error) { results[name] = errorCell(error) }
}
fsProbe('node-unlink', () => fs.unlinkSync(path.join(outside, 'v-node-unlink.txt')))
fsProbe('rename-in-place', () => fs.renameSync(path.join(outside, 'v-rename.txt'), path.join(outside, 'v-rename-renamed.txt')))
fsProbe('move-into-workspace', () => fs.renameSync(path.join(outside, 'v-move.txt'), path.join(workspace, 'moved-from-outside-' + mode + '.txt')))
fsProbe('rmdir', () => fs.rmdirSync(path.join(outside, 'v-empty-dir')))

let api
try {
  const koffi = require(koffiEntry)
  const kernel32 = koffi.load('kernel32.dll')
  const advapi32 = koffi.load('advapi32.dll')
  const PVOID = koffi.pointer('void')
  api = {
    createFileW: kernel32.func('__stdcall', 'CreateFileW', PVOID, ['str16', 'uint32', 'uint32', PVOID, 'uint32', 'uint32', PVOID]),
    openProcess: kernel32.func('__stdcall', 'OpenProcess', PVOID, ['uint32', 'int', 'uint32']),
    closeHandle: kernel32.func('__stdcall', 'CloseHandle', 'int', [PVOID]),
    getLastError: kernel32.func('__stdcall', 'GetLastError', 'uint32', []),
    setKernelObjectSecurity: advapi32.func('__stdcall', 'SetKernelObjectSecurity', 'int', [PVOID, 'uint32', PVOID]),
  }
  results['koffi-load'] = { result: 'OK', detail: koffiEntry }
} catch (error) {
  results['koffi-load'] = { result: 'ERROR', detail: String(error && error.message) }
}
const failed = (handle) => handle === null || handle === undefined || handle === 0n || handle === -1n
  || handle === 0xFFFFFFFFFFFFFFFFn || handle === 0 || handle === -1
const win32Cell = (label) => {
  const code = api.getLastError()
  return { result: code === 5 ? 'DENIED' : 'ERROR', detail: label + ' Win32 ' + code }
}
const nativeProbe = (name, body) => {
  if (api === undefined) { results[name] = { result: 'ERROR', detail: 'koffi unavailable' }; return }
  try { results[name] = body() } catch (error) { results[name] = { result: 'ERROR', detail: String(error && error.message) } }
}
const openProbe = (name, target, access, directory) => nativeProbe(name, () => {
  const handle = api.createFileW(target, access, 7, null, 3, directory ? 0x02000000 : 0, null)
  if (failed(handle)) return win32Cell('CreateFileW(0x' + access.toString(16) + ')')
  api.closeHandle(handle)
  return { result: 'OK', detail: 'CreateFileW granted 0x' + access.toString(16) }
})
const masks = path.join(outside, 'v-masks.txt')
openProbe('open-file-write-data', masks, 0x2, false)
openProbe('open-file-read-control', masks, 0x20000, false)
openProbe('open-file-delete', masks, 0x10000, false)
openProbe('open-file-write-dac', masks, 0x40000, false)
openProbe('open-file-write-owner', masks, 0x80000, false)
openProbe('open-dir-delete-child', outside, 0x40, true)

const everyoneFullAccess = () => {
  const sd = Buffer.alloc(48)
  sd.writeUInt8(1, 0)
  sd.writeUInt16LE(0x8004, 2)
  sd.writeUInt32LE(20, 16)
  sd.writeUInt8(2, 20)
  sd.writeUInt16LE(28, 22)
  sd.writeUInt16LE(1, 24)
  sd.writeUInt8(0, 28)
  sd.writeUInt16LE(20, 30)
  sd.writeUInt32LE(0x1F01FF, 32)
  sd.writeUInt8(1, 36)
  sd.writeUInt8(1, 37)
  sd.writeUInt8(1, 43)
  sd.writeUInt32LE(0, 44)
  return sd
}
nativeProbe('dacl-rewrite-then-write', () => {
  const target = path.join(outside, 'v-dacl.txt')
  const handle = api.createFileW(target, 0x40000, 7, null, 3, 0, null)
  if (failed(handle)) return win32Cell('CreateFileW(WRITE_DAC)')
  const applied = api.setKernelObjectSecurity(handle, 4, everyoneFullAccess())
  const refused = applied === 0 ? win32Cell('SetKernelObjectSecurity') : undefined
  api.closeHandle(handle)
  if (refused !== undefined) return refused
  try {
    fs.writeFileSync(target, 'escaped')
    return { result: 'OK', detail: 'DACL replaced with Everyone:FA, then the file was written' }
  } catch (error) {
    return { result: 'PARTIAL', detail: 'DACL replaced with Everyone:FA; write failed: ' + String(error && error.code) }
  }
})
const processProbe = (name, access) => nativeProbe(name, () => {
  const handle = api.openProcess(access, 0, process.ppid)
  if (failed(handle)) return win32Cell('OpenProcess(0x' + access.toString(16) + ')')
  api.closeHandle(handle)
  return { result: 'OK', detail: 'OpenProcess granted 0x' + access.toString(16) + ' on the runner pid ' + process.ppid }
})
processProbe('process-write-dac', 0x40000)
processProbe('process-vm-write', 0x28)
console.log('PROBE-JSON ' + JSON.stringify(results))
`

/**
 * The confined PowerShell half of the matrix: one `PROBE <name> <result>
 * <detail>` line per probe. Read-only PowerShell runs in ConstrainedLanguage,
 * which refuses `[System.IO.File]::Delete`, so that probe runs only under
 * workspace-write.
 * @param outside - the directory holding the victims.
 * @param mode - the confined mode the script runs under.
 * @returns the `-Command` script.
 */
function outsidePwshProbe(outside: string, mode: 'read-only' | 'workspace-write'): string {
  // Single-quoted PowerShell only: the script crosses two command-line
  // quoting layers (Node spawn, then the runner's CreateProcessAsUserW).
  const quoted = (name: string) => `'${join(outside, name)}'`
  const flat = (expression: string) => `(${expression} -replace '\\s+',' ')`
  return [
    "$ErrorActionPreference='Continue';",
    "('PROBE language-mode INFO ' + $ExecutionContext.SessionState.LanguageMode);",
    `try{Remove-Item -LiteralPath ${quoted('v-pwsh-remove.txt')} -Force -ErrorAction Stop;'PROBE pwsh-remove-item OK'}catch{'PROBE pwsh-remove-item FAILED ' + ${flat('$_.Exception.Message')}};`,
    `$p=${quoted('v-cmd-del.txt')};$o=(cmd.exe /d /c del /q $p 2>&1 | Out-String);('PROBE cmd-del EXIT' + $LASTEXITCODE + ' ' + ${flat('$o')});`,
    mode === 'workspace-write'
      ? `try{[System.IO.File]::Delete(${quoted('v-dotnet.txt')});'PROBE dotnet-file-delete OK'}catch{'PROBE dotnet-file-delete FAILED ' + ${flat('$_.Exception.Message')}};`
      : "'PROBE dotnet-file-delete NOT-RUN ConstrainedLanguage refuses System.IO.File';",
    `$p=${quoted('v-icacls.txt')};$o=(icacls.exe $p /grant '*S-1-1-0:(M)' 2>&1 | Out-String);$c=$LASTEXITCODE;$w='not attempted';`
      + "if($c -eq 0){try{Set-Content -LiteralPath $p -Value escaped -ErrorAction Stop;$w='written'}catch{$w=$_.Exception.Message}};"
      + `$r='DENIED';if($c -eq 0){$r='GRANTED'};('PROBE icacls-grant-then-write ' + $r + ' icacls exit ' + $c + '; ' + ${flat('$o')} + '; write: ' + ${flat('$w')});`,
  ].join('')
}

/**
 * Vitest's partial-object matcher, typed as the opaque expectation it is.
 * @param fields - the fields the observed cell must carry.
 * @returns the asymmetric matcher.
 */
function containing(fields: Partial<ProbeCell>): unknown {
  return expect.objectContaining(fields)
}

/**
 * Parse both halves' output into probe cells (process-boundary JSON and lines).
 * @param stdout - the confined run's captured stdout.
 * @returns the probe cells keyed by probe name.
 */
function parseProbeOutput(stdout: string): Record<string, ProbeCell> {
  const cells: Record<string, ProbeCell> = {}
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const json = /^PROBE-JSON (.*)$/.exec(line)
    if (json !== null) {
      const parsed: unknown = JSON.parse(json[1] ?? '{}')
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [name, value] of Object.entries(parsed)) {
          const cell = value as { result?: unknown; detail?: unknown }
          cells[name] = { result: String(cell.result), detail: String(cell.detail) }
        }
      }
      continue
    }
    const probe = /^PROBE (\S+) (\S+) ?(.*)$/.exec(line)
    if (probe !== null) cells[probe[1] ?? ''] = { result: probe[2] ?? '', detail: probe[3] ?? '' }
  }
  return cells
}

describe.skipIf(!isWin32 || !pwshAvailable())('windows-acl runner', () => {
  let scratchRoot!: string
  let writableDir!: string
  let isolatedTemp!: string
  let secretFile!: string
  let escapeFile!: string
  let worldWritableDir!: string
  // The ambient-writable probe target: a subdirectory of C:\Users\Public.
  // INTERACTIVE/LOCAL are absent from BOTH restricting lists, so the Public
  // tree's INTERACTIVE grant must NOT satisfy the write check — the ambient
  // boundary the dual-list design closes (bot-reported blind spot). The
  // Public tree may be unavailable or unwritable for the test user on some
  // hosts; the probe test skips itself when the directory cannot be created.
  let publicProbeDir: string | undefined

  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'arx-acl-runner-'))
    writableDir = join(scratchRoot, 'writable')
    mkdirSync(writableDir)
    isolatedTemp = mkdtempSync(join(tmpdir(), 'arx-acl-runner-temp-'))
    secretFile = join(scratchRoot, 'secret.txt')
    writeFileSync(secretFile, 'top secret - must stay readable to prove the read boundary')
    escapeFile = join(scratchRoot, 'escaped.txt')
    worldWritableDir = join(scratchRoot, 'world-writable')
    mkdirSync(worldWritableDir)
    const worldGrant = spawnSync('icacls', [worldWritableDir, '/grant', '*S-1-1-0:(OI)(CI)(M)'], { encoding: 'utf8' })
    if (worldGrant.status !== 0) {
      throw new Error(`icacls Everyone grant failed: ${worldGrant.stdout}\n${worldGrant.stderr}`)
    }
    try {
      publicProbeDir = mkdtempSync(join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'arx-acl-public-'))
    } catch {
      publicProbeDir = undefined
    }
  })

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
    rmSync(isolatedTemp, { recursive: true, force: true })
    if (publicProbeDir !== undefined) rmSync(publicProbeDir, { recursive: true, force: true })
  })

  it('workspace-write: the confined child writes granted directories only', () => {
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      // The private-temp capability lets PowerShell complete its startup
      // AppLocker probe, so without a host policy workspace-write stays in
      // FullLanguage. Read-only cannot create those scratch files and fails
      // that probe closed to ConstrainedLanguage (pinned below).
      '\'LANGMODE: \' + $ExecutionContext.SessionState.LanguageMode;',
      `try{Set-Content -Path '${writableDir}\\child-wrote.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      "try{Set-Content -Path (Join-Path $env:TEMP 'child-wrote.txt') -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};",
      `try{Set-Content -Path '${escapeFile}' -Value ok -ErrorAction Stop;'ESCAPE-WRITE: OK (ESCAPE!)'}catch{'ESCAPE-WRITE: DENIED'};`,
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'};`,
      // Authenticated Users is absent from BOTH lists: the WMI namespace
      // security check fails (0x80041003) — CIM is unavailable under every
      // confined mode (the documented contract; the C:\-root tree-creation
      // escape is closed in both as the other side of the trade).
      "try{Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Out-Null;'CIM: OK'}catch{'CIM: DENIED'}",
    ].join('')
    const result = runRunner([
      '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
      '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('LANGMODE: FullLanguage')
    expect(result.stdout).toContain('TARGET-WRITE: OK')
    expect(result.stdout).toContain('TEMP-WRITE: OK')
    expect(result.stdout).toContain('ESCAPE-WRITE: DENIED')
    expect(result.stdout).toContain('SECRET-READ: OK')
    expect(result.stdout).toContain('CIM: DENIED')
    expect(existsSync(escapeFile)).toBe(false)
    expect(existsSync(join(writableDir, 'child-wrote.txt'))).toBe(true)
  }, 30_000)

  it('read-only: no write-SID grants — workspace/temp writes denied, reads and $null redirection fine, CIM unavailable', () => {
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      '\'LANGMODE: \' + $ExecutionContext.SessionState.LanguageMode;',
      `try{Set-Content -Path '${writableDir}\\readonly-child-wrote.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      `try{Set-Content -Path '${isolatedTemp}\\readonly-child-wrote.txt' -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};`,
      // Set-Content NUL fails at the PowerShell/.NET layer even though the
      // device DACL's Everyone rights remain an ambient backend boundary.
      'try{Set-Content -Path \'NUL\' -Value ok -ErrorAction Stop;\'NUL-WRITE: OK\'}catch{\'NUL-WRITE: DENIED\'};',
      // PowerShell's $null redirection discards without opening NUL — must keep working.
      'echo hi > $null;\'DOLLAR-NULL: OK\';',
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'};`,
      // BOTH lists drop Authenticated Users: the WMI namespace security
      // check fails (0x80041003) — the documented CIM boundary of every
      // confined mode, the price of the zero ambient-write surface.
      "try{Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Out-Null;'CIM: OK'}catch{'CIM: DENIED'}",
    ].join('')
    const result = runRunner([
      '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'read-only',
      '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('LANGMODE: ConstrainedLanguage')
    expect(result.stdout).toContain('TARGET-WRITE: DENIED')
    expect(result.stdout).toContain('TEMP-WRITE: DENIED')
    expect(result.stdout).toContain('NUL-WRITE: DENIED')
    expect(result.stdout).toContain('DOLLAR-NULL: OK')
    expect(result.stdout).toContain('SECRET-READ: OK')
    expect(result.stdout).toContain('CIM: DENIED')
    expect(existsSync(join(writableDir, 'readonly-child-wrote.txt'))).toBe(false)
  }, 30_000)

  it('workspace-write: Remove-Item and Rename-Item succeed in the granted workspace (DELETE + FILE_DELETE_CHILD)', () => {
    // Deleting a file and renaming a directory both hit the second access
    // check on the workspace itself: the grant must carry DELETE (on the
    // object) and FILE_DELETE_CHILD (on its parent).
    const victimFile = join(writableDir, 'delete-me.txt')
    writeFileSync(victimFile, 'remove me')
    const victimDir = join(writableDir, 'rename-me')
    mkdirSync(victimDir)
    const renamedDir = join(writableDir, 'renamed-by-child')
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Remove-Item -LiteralPath '${victimFile}' -ErrorAction Stop;'DELETE-FILE: OK'}catch{'DELETE-FILE: DENIED'};`,
      `try{Rename-Item -LiteralPath '${victimDir}' -NewName 'renamed-by-child' -ErrorAction Stop;'RENAME-DIR: OK'}catch{'RENAME-DIR: DENIED'}`,
    ].join('')
    const result = runRunner([
      '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
      '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('DELETE-FILE: OK')
    expect(result.stdout).toContain('RENAME-DIR: OK')
    expect(existsSync(victimFile)).toBe(false)
    expect(existsSync(renamedDir)).toBe(true)
  }, 30_000)

  it('outside the granted roots: deletion, renames, and DACL rewrites are denied under BOTH modes', () => {
    // WRITE_RESTRICTED considers the restricting SIDs only for write access,
    // and FILE_GENERIC_WRITE excludes DELETE, FILE_DELETE_CHILD, WRITE_DAC,
    // and WRITE_OWNER. The matrix exercises each of those rights, and the
    // tools that use them, on victims in a directory the runner user fully
    // controls outside every granted root, plus WRITE_DAC and VM-write opens
    // on the runner process. Every probe must be denied and every victim
    // must keep its content; the failure message prints each probe's
    // Windows response.
    const probeScript = join(scratchRoot, 'outside-rights-probe.cjs')
    writeFileSync(probeScript, OUTSIDE_RIGHTS_PROBE)
    const koffiEntry = createRequire(import.meta.url).resolve('koffi')
    const observed: Record<string, Record<string, ProbeCell>> = {}
    const expected: Record<string, Record<string, unknown>> = {}
    const transcript: string[] = []
    for (const mode of ['read-only', 'workspace-write'] as const) {
      const outside = mkdtempSync(join(scratchRoot, `outside-${mode}-`))
      const control = join(outside, 'control.txt')
      writeFileSync(control, 'original')
      rmSync(control) // precondition: the unconfined runner user may delete here
      for (const name of OUTSIDE_VICTIM_FILES) writeFileSync(join(outside, name), 'original')
      mkdirSync(join(outside, 'v-empty-dir'))

      const runnerPrefix = ['--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode, '--']
      const pwshRun = runRunner([...runnerPrefix, 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', outsidePwshProbe(outside, mode)])
      const nodeRun = runRunner([...runnerPrefix, process.execPath, probeScript, koffiEntry, outside, writableDir, mode])
      for (const [half, run] of [['pwsh', pwshRun], ['node', nodeRun]] as const) {
        transcript.push(`[${mode}] ${half} status=${String(run.status)} signal=${String(run.signal)} error=${String(run.error?.message)}`)
        transcript.push(`[${mode}] ${half} stdout: ${run.stdout.trim()}`)
        if (run.stderr.trim() !== '') transcript.push(`[${mode}] ${half} stderr: ${run.stderr.trim().slice(0, 2000)}`)
      }

      const cells = { ...parseProbeOutput(pwshRun.stdout), ...parseProbeOutput(nodeRun.stdout) }
      const cell = (name: string): ProbeCell => cells[name] ?? { result: 'MISSING', detail: 'the probe printed no line' }
      const survives = (name: string) => existsSync(join(outside, name))
      const content = (name: string) => existsSync(join(outside, name)) ? readFileSync(join(outside, name), 'utf8') : '<deleted>'
      observed[mode] = {
        'runner-exit': { result: `pwsh ${String(pwshRun.status)} node ${String(nodeRun.status)}`, detail: '' },
        'pwsh-remove-item': { ...cell('pwsh-remove-item'), stillExists: survives('v-pwsh-remove.txt') },
        'cmd-del': { ...cell('cmd-del'), stillExists: survives('v-cmd-del.txt') },
        'dotnet-file-delete': { ...cell('dotnet-file-delete'), stillExists: survives('v-dotnet.txt') },
        'node-unlink': { ...cell('node-unlink'), stillExists: survives('v-node-unlink.txt') },
        'rename-in-place': { ...cell('rename-in-place'), stillExists: survives('v-rename.txt') },
        'move-into-workspace': { ...cell('move-into-workspace'), stillExists: survives('v-move.txt') },
        'rmdir': { ...cell('rmdir'), stillExists: survives('v-empty-dir') },
        'open-file-write-data': cell('open-file-write-data'),
        'open-file-delete': cell('open-file-delete'),
        'open-file-write-dac': cell('open-file-write-dac'),
        'open-file-write-owner': cell('open-file-write-owner'),
        'open-dir-delete-child': cell('open-dir-delete-child'),
        'dacl-rewrite-then-write': { ...cell('dacl-rewrite-then-write'), content: content('v-dacl.txt') },
        'icacls-grant-then-write': { ...cell('icacls-grant-then-write'), content: content('v-icacls.txt') },
        'process-write-dac': cell('process-write-dac'),
        'process-vm-write': cell('process-vm-write'),
      }
      const survived = containing({ stillExists: true })
      const denied = containing({ result: 'DENIED' })
      expected[mode] = {
        'runner-exit': containing({ result: 'pwsh 0 node 0' }),
        'pwsh-remove-item': survived,
        'cmd-del': survived,
        'dotnet-file-delete': survived,
        'node-unlink': survived,
        'rename-in-place': survived,
        'move-into-workspace': survived,
        'rmdir': survived,
        'open-file-write-data': denied,
        'open-file-delete': denied,
        'open-file-write-dac': denied,
        'open-file-write-owner': denied,
        'open-dir-delete-child': denied,
        'dacl-rewrite-then-write': containing({ result: 'DENIED', content: 'original' }),
        'icacls-grant-then-write': containing({ result: 'DENIED', content: 'original' }),
        'process-write-dac': denied,
        'process-vm-write': denied,
      }
      for (const info of ['language-mode', 'koffi-load', 'open-file-read-control']) {
        transcript.push(`[${mode}] info ${info}: ${cell(info).result} ${cell(info).detail}`)
      }
    }
    const matrix = Object.entries(observed).flatMap(([mode, rows]) => Object.entries(rows).map(([probe, row]) =>
      `${mode} | ${probe} | ${row.result} | ${row.stillExists === undefined ? '' : `stillExists=${String(row.stillExists)}`}${row.content === undefined ? '' : `content=${JSON.stringify(row.content)}`} | ${row.detail}`))
    expect(observed, ['Outside-the-roots rights matrix:', ...matrix, '', 'Runs:', ...transcript].join('\n')).toEqual(expected)
  }, 120_000)

  it('paired SIDs: the runner trusts caller-owned private-temp grants and materializes nothing itself', () => {
    const seamWorkspace = join(scratchRoot, 'seam-workspace')
    mkdirSync(seamWorkspace)
    const writeSid = workspaceWriteSid(seamWorkspace)
    const privateTemp = join(isolatedTemp, 'private-subdir')
    mkdirSync(privateTemp)
    const privateTempSid = tempWriteSid(privateTemp)
    const grant = AclWriteGrant.create(privateTempSid)
    grant.add(privateTemp)
    try {
      const probe = [
        "$ErrorActionPreference='SilentlyContinue';",
        `try{Set-Content -Path '${seamWorkspace}\\server-granted.txt' -Value ok -ErrorAction Stop;'WORKSPACE-WRITE: OK'}catch{'WORKSPACE-WRITE: DENIED'};`,
        `try{Set-Content -Path '${privateTemp}\\server-granted.txt' -Value ok -ErrorAction Stop;'PRIVATE-TEMP-WRITE: OK'}catch{'PRIVATE-TEMP-WRITE: DENIED'};`,
        "'TEMP-ENV: ' + $env:TEMP;",
        "'TMP-ENV: ' + $env:TMP",
      ].join('')
      const result = runRunner([
        '--workspace', seamWorkspace, '--temp', privateTemp, '--mode', 'workspace-write', '--write-sid', writeSid,
        '--temp-write-sid', privateTempSid,
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      // The runner granted nothing (only the caller's temp-SID grant
      // stands): the workspace write is denied, the private temp write lands,
      // and the child's TMP/TEMP point at the private subdirectory.
      expect(result.stdout).toContain('WORKSPACE-WRITE: DENIED')
      expect(result.stdout).toContain('PRIVATE-TEMP-WRITE: OK')
      expect(result.stdout).toContain(`TEMP-ENV: ${privateTemp}`)
      expect(result.stdout).toContain(`TMP-ENV: ${privateTemp}`)
      expect(existsSync(join(seamWorkspace, 'server-granted.txt'))).toBe(false)
      expect(existsSync(join(privateTemp, 'server-granted.txt'))).toBe(true)
    } finally {
      grant.dispose()
      rmSync(privateTemp, { recursive: true, force: true })
    }
  }, 30_000)

  it('temp capabilities isolate sibling sessions that share one workspace SID', () => {
    const writeSid = workspaceWriteSid(writableDir)
    const tempA = join(isolatedTemp, 'session-a')
    const tempB = join(isolatedTemp, 'session-b')
    mkdirSync(tempA)
    mkdirSync(tempB)
    const sidA = tempWriteSid(tempA)
    const sidB = tempWriteSid(tempB)
    const workspaceGrant = AclWriteGrant.create(writeSid)
    const grantA = AclWriteGrant.create(sidA)
    const grantB = AclWriteGrant.create(sidB)
    workspaceGrant.add(writableDir)
    grantA.add(tempA)
    grantB.add(tempB)
    const sharedWorkspaceFile = join(writableDir, 'shared-between-sessions.txt')
    const probe = [
      "const fs = require('node:fs');",
      "const targets = [['OWN', process.argv[1]], ['SIBLING', process.argv[2]], ['WORKSPACE', process.argv[3]]];",
      "if (process.argv[4]) targets.push(['SIBLING-EXISTING', process.argv[4]]);",
      'for (const [name, target] of targets) {',
      "try { fs.writeFileSync(target, name); console.log(name + ': OK'); } catch { console.log(name + ': DENIED'); }",
      '}',
    ].join('')
    try {
      const resultA = runRunner([
        '--workspace', writableDir, '--temp', tempA, '--mode', 'workspace-write',
        '--write-sid', writeSid, '--temp-write-sid', sidA,
        '--', process.execPath, '-e', probe, join(tempA, 'a.txt'), join(tempB, 'a-escaped.txt'), sharedWorkspaceFile,
      ])
      expect(resultA.status, `stderr: ${resultA.stderr}`).toBe(0)
      expect(resultA.stdout).toContain('OWN: OK')
      expect(resultA.stdout).toContain('SIBLING: DENIED')
      expect(resultA.stdout).toContain('WORKSPACE: OK')

      const resultB = runRunner([
        '--workspace', writableDir, '--temp', tempB, '--mode', 'workspace-write',
        '--write-sid', writeSid, '--temp-write-sid', sidB,
        '--', process.execPath, '-e', probe, join(tempB, 'b.txt'), join(tempA, 'b-escaped.txt'), sharedWorkspaceFile, join(tempA, 'a.txt'),
      ])
      expect(resultB.status, `stderr: ${resultB.stderr}`).toBe(0)
      expect(resultB.stdout).toContain('OWN: OK')
      expect(resultB.stdout).toContain('SIBLING: DENIED')
      expect(resultB.stdout).toContain('SIBLING-EXISTING: DENIED')
      expect(resultB.stdout).toContain('WORKSPACE: OK')
      expect(existsSync(join(tempB, 'a-escaped.txt'))).toBe(false)
      expect(existsSync(join(tempA, 'b-escaped.txt'))).toBe(false)
      expect(readFileSync(join(tempA, 'a.txt'), 'utf8')).toBe('OWN')
    } finally {
      workspaceGrant.dispose()
      grantA.dispose()
      grantB.dispose()
      rmSync(tempA, { recursive: true, force: true })
      rmSync(tempB, { recursive: true, force: true })
    }
  }, 30_000)

  it('agentless workspace-write creates a fresh private temp per call and removes it on exit', () => {
    const captureA = join(writableDir, 'agentless-temp-a.txt')
    const captureB = join(writableDir, 'agentless-temp-b.txt')
    for (const capture of [captureA, captureB]) {
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], process.env.TEMP)", capture,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    }
    const tempA = readFileSync(captureA, 'utf8')
    const tempB = readFileSync(captureB, 'utf8')
    expect(tempA).not.toBe(tempB)
    expect(tempA.startsWith(isolatedTemp)).toBe(true)
    expect(tempB.startsWith(isolatedTemp)).toBe(true)
    expect(existsSync(tempA)).toBe(false)
    expect(existsSync(tempB)).toBe(false)
  }, 30_000)

  it('agentless workspace-write rejects a temp root inside the workspace before spawning', () => {
    const overlapWorkspace = join(scratchRoot, 'overlap-workspace')
    const nestedTempRoot = join(overlapWorkspace, 'temp')
    const marker = join(overlapWorkspace, 'command-ran.txt')
    mkdirSync(overlapWorkspace)
    mkdirSync(nestedTempRoot)

    const result = runRunner([
      '--workspace', overlapWorkspace, '--temp', nestedTempRoot, '--mode', 'workspace-write',
      '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(127)
    expect(result.stderr).toContain('windows-acl-run: Windows ACL temp root must be outside the workspace')
    expect(existsSync(marker)).toBe(false)
  }, 15_000)

  it('confined children spawn grandchildren with inherited stdio; piped capture stays denied (named-pipe default SD template)', () => {
    // Two-layer pin of the grandchild-spawn boundary:
    //  - the token default DACL carries a restricting-SID ACE (set in init),
    //    so ANONYMOUS pipe creation (CreatePipe — the token-default-DACL
    //    consumer) works and inherited/ignored stdio spawns succeed;
    //  - libuv's pipe-stdio uses NAMED pipes, whose default security
    //    descriptor is the Win32 layer's user-mode default SD template
    //    (built by KernelBase — owner/SYSTEM/Admins full, Everyone/ANONYMOUS
    //    read-only) — NOT the token default DACL, which is what the kernel
    //    applies to a raw SD-null create — so the client-end open requests
    //    write access no restricting SID is
    //    granted: ERROR_ACCESS_DENIED, surfaced as spawn EPERM. That is the
    //    POC-documented "no output redirection" boundary of WRITE_RESTRICTED
    //    tokens; piped capture cannot work and is pinned as DENIED.
    const probe = [
      "const { spawnSync } = require('child_process');",
      "const t = (name, opts) => { const s = spawnSync(process.execPath, ['-e', '1'], { encoding: 'utf8', ...opts }); console.log(name + ':' + (s.status === 0 ? 'OK' : 'DENIED')); };",
      "t('inherit', { stdio: 'inherit' });",
      "t('ignore', { stdio: 'ignore' });",
      "t('pipe', { stdio: 'pipe' });",
    ].join('')
    for (const mode of ['workspace-write', 'read-only'] as const) {
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode,
        '--', 'node', '-e', probe,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      expect(result.stdout, `mode: ${mode}`).toContain('inherit:OK')
      expect(result.stdout, `mode: ${mode}`).toContain('ignore:OK')
      expect(result.stdout, `mode: ${mode}`).toContain('pipe:DENIED')
    }
  }, 30_000)

  it('mode-downgrade leak regression: a STANDING workspace grant is inert under read-only and effective again on re-upgrade', () => {
    // The reported defect: a session that materialized its grant in
    // workspace-write keeps the ACE standing for the server lifetime. After
    // switching to read-only, the restricted token's read-only list must carry NO
    // capability SID — the standing ACE stays but the pass-2 check cannot use
    // it, so the workspace write is denied (previously it LEAKED). The
    // switch back reuses the SAME standing ACE: the re-upgrade write lands
    // without any re-grant.
    const writeSid = workspaceWriteSid(writableDir)
    const privateTemp = join(isolatedTemp, 'mode-switch-temp')
    mkdirSync(privateTemp)
    const privateTempSid = tempWriteSid(privateTemp)
    const grant = AclWriteGrant.create(writeSid)
    grant.add(writableDir)
    try {
      const downgradeProbe = [
        "$ErrorActionPreference='SilentlyContinue';",
        `try{Set-Content -Path '${writableDir}\\downgraded.txt' -Value ok -ErrorAction Stop;'DOWNGRADE-WRITE: OK (LEAK!)'}catch{'DOWNGRADE-WRITE: DENIED'}`,
      ].join('')
      const downgraded = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'read-only',
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', downgradeProbe,
      ])
      expect(downgraded.status, `stderr: ${downgraded.stderr}`).toBe(0)
      expect(downgraded.stdout).toContain('DOWNGRADE-WRITE: DENIED')
      expect(existsSync(join(writableDir, 'downgraded.txt'))).toBe(false)

      const reupgradeProbe = [
        "$ErrorActionPreference='SilentlyContinue';",
        `try{Set-Content -Path '${writableDir}\\reupgraded.txt' -Value ok -ErrorAction Stop;'REUPGRADE-WRITE: OK'}catch{'REUPGRADE-WRITE: DENIED'}`,
      ].join('')
      const reupgraded = runRunner([
        '--workspace', writableDir, '--temp', privateTemp, '--mode', 'workspace-write', '--write-sid', writeSid,
        '--temp-write-sid', privateTempSid,
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', reupgradeProbe,
      ])
      expect(reupgraded.status, `stderr: ${reupgraded.stderr}`).toBe(0)
      expect(reupgraded.stdout).toContain('REUPGRADE-WRITE: OK')
      expect(existsSync(join(writableDir, 'reupgraded.txt'))).toBe(true)
    } finally {
      grant.dispose()
      rmSync(privateTemp, { recursive: true, force: true })
    }
  }, 30_000)

  it('ambient-writable escape regression: a C:\\Users\\Public subdirectory is denied under BOTH modes (INTERACTIVE absent from both lists)', (ctx) => {
    // The Public tree grants write to INTERACTIVE; the D1-D6 matrix pinned
    // that removing INTERACTIVE from the restricting lists closes the escape.
    // The committed suites never probed it — this pins the ambient boundary
    // end to end with the real restricted token.
    if (publicProbeDir === undefined) {
      ctx.skip() // Public unavailable/unwritable on this host
      return
    }
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Set-Content -Path '${publicProbeDir}\\public-escaped.txt' -Value ok -ErrorAction Stop;'PUBLIC-WRITE: OK (ESCAPE!)'}catch{'PUBLIC-WRITE: DENIED'}`,
    ].join('')
    for (const mode of ['read-only', 'workspace-write'] as const) {
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode,
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      expect(result.stdout, `mode: ${mode}`).toContain('PUBLIC-WRITE: DENIED')
      expect(existsSync(join(publicProbeDir, 'public-escaped.txt')), `mode: ${mode}`).toBe(false)
    }
  }, 30_000)

  it('Everyone-Modify boundary: denied at the implicit Medium label, writable only where the object is labeled Low, under BOTH modes', () => {
    // Everyone is a required keep-alive restricting SID: without it early DLL
    // initialization and CNG fail. A normal DACL that grants Everyone Modify
    // therefore clears the WRITE_RESTRICTED pass-2 check, but the Low-integrity
    // token still fails the mandatory check on every object at the implicit
    // Medium label. The gap narrows to Low-labeled objects that grant Everyone
    // write access, pinned beside the provider's `partial` enforcement report.
    const lowWorldWritableDir = join(scratchRoot, 'world-writable-low')
    mkdirSync(lowWorldWritableDir)
    for (const args of [['/grant', '*S-1-1-0:(OI)(CI)(M)'], ['/setintegritylevel', '(OI)(CI)L']]) {
      const setup = spawnSync('icacls', [lowWorldWritableDir, ...args], { encoding: 'utf8' })
      expect(setup.status, `icacls ${args.join(' ')}: ${setup.stdout}\n${setup.stderr}`).toBe(0)
    }
    for (const mode of ['read-only', 'workspace-write'] as const) {
      for (const [directory, expected] of [[worldWritableDir, false], [lowWorldWritableDir, true]] as const) {
        const target = join(directory, `${mode}.txt`)
        const result = runRunner([
          '--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode,
          '--', process.execPath, '-e', "try { require('node:fs').writeFileSync(process.argv[1], 'written') } catch (error) { console.log(error.code) }", target,
        ])
        expect(result.status, `mode: ${mode}\nstderr: ${result.stderr}`).toBe(0)
        expect(existsSync(target), `mode: ${mode}, directory: ${directory}, child stdout: ${result.stdout}`).toBe(expected)
      }
    }
  }, 60_000)

  it('the Low label reaches files that existed before the first grant, and a standing grant without it is relabeled', () => {
    // A fresh workspace: the first grant must propagate the inheritable Low
    // label onto the existing nested file, or the Low-integrity child cannot
    // write it. A workspace whose standing exact ACE predates the label
    // (simulated by relabeling it Medium) takes one re-apply on the next grant.
    const fresh = join(scratchRoot, 'label-fresh-workspace')
    const relabeled = join(scratchRoot, 'label-relabeled-workspace')
    for (const root of [fresh, relabeled]) {
      mkdirSync(join(root, 'nested'), { recursive: true })
      writeFileSync(join(root, 'nested', 'existing.txt'), 'before')
    }
    const standing = AclWriteGrant.create(workspaceWriteSid(relabeled))
    standing.add(relabeled, true)
    standing.dispose() // frees the SID; the standing ACE and label stay
    const medium = spawnSync('icacls', [relabeled, '/setintegritylevel', '(OI)(CI)M'], { encoding: 'utf8' })
    expect(medium.status, `icacls: ${medium.stdout}\n${medium.stderr}`).toBe(0)
    for (const root of [fresh, relabeled]) {
      const temp = mkdtempSync(join(tmpdir(), 'arx-acl-label-temp-'))
      try {
        const result = runRunner([
          '--workspace', root, '--temp', temp, '--mode', 'workspace-write',
          '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], 'after')", join(root, 'nested', 'existing.txt'),
        ])
        expect(result.status, `workspace: ${root}\nstderr: ${result.stderr}`).toBe(0)
        expect(readFileSync(join(root, 'nested', 'existing.txt'), 'utf8'), `workspace: ${root}`).toBe('after')
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    }
  }, 60_000)

  it('partial boundary: a workspace hard link lets the grant reach an external file object', () => {
    // NTFS ACLs belong to the file object, not one pathname. Propagating the
    // workspace write-SID ACE through an existing hard-link alias therefore
    // grants the external alias too. pnpm workspaces commonly contain hard
    // links, so rejecting every multiply-linked file is not a viable profile.
    const hardlinkWorkspace = join(scratchRoot, 'hardlink-workspace')
    const hardlinkTemp = join(scratchRoot, 'hardlink-temp')
    const externalFile = join(scratchRoot, 'hardlink-target.txt')
    const workspaceLink = join(hardlinkWorkspace, 'hardlink-alias.txt')
    mkdirSync(hardlinkWorkspace)
    mkdirSync(hardlinkTemp)
    writeFileSync(externalFile, 'original')
    linkSync(externalFile, workspaceLink)
    const result = runRunner([
      // This workspace has not been granted before the alias exists: the first
      // recursive materialization reaches the shared file security descriptor.
      '--workspace', hardlinkWorkspace, '--temp', hardlinkTemp, '--mode', 'workspace-write',
      '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], 'mutated')", workspaceLink,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(readFileSync(externalFile, 'utf8')).toBe('mutated')
  }, 30_000)

  it('runner-side failure: signature on stderr and exit 127, the command never runs', () => {
    const result = runRunner(['--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write'])
    expect(result.status).toBe(127)
    expect(result.stderr).toContain('windows-acl-run: ')
  }, 15_000)

  it('runner-side failure: seam-managed SID flags must be paired and match their owning paths', () => {
    const writeSid = workspaceWriteSid(writableDir)
    const tempSid = tempWriteSid(isolatedTemp)
    const cases = [
      ['--write-sid', writeSid],
      ['--write-sid', 'S-1-4-1-2', '--temp-write-sid', tempSid],
      ['--write-sid', writeSid, '--temp-write-sid', 'S-1-4-1-2-1'],
    ]
    for (const args of cases) {
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        ...args,
        '--', process.execPath, '-e', 'process.exit(99)',
      ])
      expect(result.status, `args: ${args.join(' ')}\nstderr: ${result.stderr}`).toBe(127)
      expect(result.stderr).toContain('windows-acl-run: ')
    }
  }, 15_000)
})
