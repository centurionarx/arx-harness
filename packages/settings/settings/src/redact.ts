/**
 * Fail-closed projection of settings values and schemas for wire consumers.
 * Only data described by supported schema nodes is returned; schema callbacks
 * never run during redaction or serialization.
 * @module @arx-ai/arx-settings/redact
 */

import type z from '@arx-ai/schemastery'

/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root, including concrete dict keys and array indexes. */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** A detached value with secret fields and undeclared object keys removed. */
export interface RedactedValue {
  /** Projected data; a secret at the root yields undefined. */
  value: unknown
  /** Object-property slots include unset fields; dict and array slots require an entry. */
  secrets: RedactedSecret[]
}

/** Data and schema relations used without calling the live schema. */
interface SchemaNode {
  type: string
  meta: { role?: string; default?: unknown }
  value?: unknown
  dict?: Record<string, SchemaNode>
  inner?: SchemaNode
  sKey?: SchemaNode
  list?: SchemaNode[]
}

/** A checked schema graph; opaque secret nodes have no traversable children. */
type Plan = { node: SchemaNode; hasSecrets: boolean } & (
  | { type: 'secret' | 'string' | 'number' | 'boolean' | 'never' | 'const' }
  | { type: 'object'; dict: Record<string, Plan> }
  | { type: 'array'; inner: Plan }
  | { type: 'dict'; inner: Plan; sKey: Plan }
  | { type: 'union'; list: Plan[] }
)

/** Value-free failures: neither schema text nor supplied data is safe to quote. */
function unsupported(): never {
  throw new TypeError('settings schema cannot be safely redacted; use data schemas and mark opaque values as secret')
}

/** Exhaustiveness failure must not serialize the plan or its schema defaults. */
/* v8 ignore next 3 -- only the ignored default arm calls this; the closed Plan union cannot reach it. */
function assertNever(_plan: never): never {
  return unsupported()
}

function invalidValue(): never {
  throw new TypeError('settings value cannot be safely redacted; use data matching the registered schema')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

/** Clone metadata as JSON data without executing toJSON methods or retaining cycles. */
function cloneMetadata(value: unknown, visiting = new Set<object>()): unknown {
  if (isScalar(value)) return value
  if (typeof value !== 'object' || value === null || visiting.has(value)) return unsupported()
  visiting.add(value)
  try {
    if (Array.isArray(value)) return value.map(entry => cloneMetadata(entry, visiting))
    if (!isRecord(value)) return unsupported()
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, cloneMetadata(entry, visiting)]))
  } finally {
    visiting.delete(value)
  }
}

/** Check every branch, including absent fields and empty containers. Cycles are unsupported. */
function compile(schema: z<never>): Plan {
  const visiting = new Set<SchemaNode>()
  const completed = new Map<SchemaNode, Plan>()
  const visit = (node: SchemaNode | undefined): Plan => {
    if (node === undefined || visiting.has(node)) return unsupported()
    const cached = completed.get(node)
    if (cached !== undefined) return cached
    let plan: Plan
    if (node.meta.role === 'secret') {
      plan = { node, type: 'secret', hasSecrets: true }
    } else {
      visiting.add(node)
      const { type } = node
      switch (type) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'never':
        case 'const':
          if (type === 'const' && !isScalar(node.value)) return unsupported()
          plan = { node, type, hasSecrets: false }
          break
        case 'object': {
          if (node.dict === undefined) return unsupported()
          const dict = Object.fromEntries(Object.entries(node.dict).map(([key, child]) => [key, visit(child)]))
          plan = { node, type, dict, hasSecrets: Object.values(dict).some(child => child.hasSecrets) }
          break
        }
        case 'array':
        case 'dict': {
          const inner = visit(node.inner)
          if (type === 'dict') {
            const sKey = visit(node.sKey)
            if (sKey.hasSecrets) return unsupported()
            plan = { node, type, inner, sKey, hasSecrets: inner.hasSecrets }
          } else {
            plan = { node, type, inner, hasSecrets: inner.hasSecrets }
          }
          break
        }
        case 'union': {
          if (!node.list?.length) return unsupported()
          const list = node.list.map(child => visit(child))
          // A different branch may classify the same data as secret. Selecting
          // a branch by validation can also execute schema callbacks.
          if (list.some(child => child.hasSecrets)) return unsupported()
          plan = { node, type, list, hasSecrets: false }
          break
        }
        default:
          // Schemastery types are extensible. Intersections, transforms, lazy
          // nodes and unconstrained data require an explicit secret role until
          // this projection can prove their output safe.
          return unsupported()
      }
      visiting.delete(node)
    }
    completed.set(node, plan)
    return plan
  }
  return visit(schema)
}

function walk(plan: Plan, value: unknown, path: string[], secrets: RedactedSecret[], visiting: Set<object>): unknown {
  if (plan.type === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  const absent = value === undefined || value === null
  if (absent && plan.type !== 'object') return value
  if (typeof value === 'object' && value !== null) {
    if (visiting.has(value)) return invalidValue()
    visiting.add(value)
  }
  try {
    switch (plan.type) {
      case 'object': {
        if (!absent && !isRecord(value)) return invalidValue()
        const source = isRecord(value) ? value : undefined
        const entries = Object.entries(plan.dict).map(([key, child]) =>
          [key, walk(child, source?.[key], [...path, key], secrets, visiting)] as const)
        return absent ? value : Object.fromEntries(entries.filter(([, entry]) => entry !== undefined))
      }
      case 'dict': {
        if (!isRecord(value)) return invalidValue()
        const entries = Object.entries(value).map(([key, entry]) => {
          walk(plan.sKey, key, path, [], visiting)
          return [key, walk(plan.inner, entry, [...path, key], secrets, visiting)] as const
        })
        return Object.fromEntries(entries.filter(([, entry]) => entry !== undefined))
      }
      case 'array':
        if (!Array.isArray(value)) return invalidValue()
        return value.map((entry, index) => walk(plan.inner, entry, [...path, String(index)], secrets, visiting))
      case 'union':
        // The union-to-branch edge reuses input, rather than descending into it.
        if (typeof value === 'object' && value !== null) visiting.delete(value)
        for (const child of plan.list) {
          try {
            return walk(child, value, path, secrets, visiting)
          } catch {
            // A structurally incompatible branch reports only invalidValue().
          }
        }
        return invalidValue()
      case 'const':
        if (value !== plan.node.value) return invalidValue()
        return value
      case 'string':
      case 'number':
      case 'boolean':
        if (typeof value !== plan.type || !isScalar(value)) return invalidValue()
        return value
      case 'never':
        return invalidValue()
      /* v8 ignore next 2 -- Plan is a closed union and every member is handled above. */
      default:
        return assertNever(plan.type)
    }
  } finally {
    if (typeof value === 'object' && value !== null) visiting.delete(value)
  }
}

/**
 * Remove secrets and undeclared keys without evaluating schema callbacks.
 * Supports objects, arrays, dictionaries, primitives and secret-free unions.
 * Unsupported or recursive schemas and incompatible values throw value-free
 * errors, even when the unsupported branch has no current value. A secret-role
 * node is opaque and may wrap any schema. Inputs are never mutated.
 * @param schema - live schema describing the value.
 * @param value - resolved value or an unresolved composition/user layer.
 * @returns detached projected data and ordered secret positions.
 */
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const secrets: RedactedSecret[] = []
  return { value: walk(compile(schema), value, [], secrets, new Set()), secrets }
}

/**
 * Serialize a checked schema as Schemastery's uid/refs envelope, sanitizing
 * defaults at every node and replacing opaque secrets with write-only strings.
 * Shared references remain shared; executable schema relations are never emitted.
 * @param schema - live schema to describe without exposing secret defaults.
 * @returns detached, data-only schema envelope suitable for wire consumers.
 */
export function redactSchema(schema: z<never>): unknown {
  const root = compile(schema)
  const ids = new Map<Plan, number>()
  const refs: Record<string, unknown> = {}
  const serialize = (plan: Plan): number => {
    const known = ids.get(plan)
    if (known !== undefined) return known
    const uid = ids.size
    ids.set(plan, uid)
    if (plan.type === 'secret') {
      refs[String(uid)] = { type: 'string', meta: { role: 'secret' } }
      return uid
    }
    const { default: fallback, ...metadata } = plan.node.meta
    // Metadata is plugin-authored UI data, not a place for credentials. Clone
    // it without invoking schema.toJSON() or callback serialization.
    const meta = cloneMetadata(metadata) as Record<string, unknown>
    if (fallback !== undefined) Object.assign(meta, { default: walk(plan, fallback, [], [], new Set()) })
    refs[String(uid)] = {
      type: plan.type,
      meta,
      ...plan.type === 'const' ? { value: plan.node.value } : {},
      ...plan.type === 'object'
        ? { dict: Object.fromEntries(Object.entries(plan.dict).map(([key, child]) => [key, serialize(child)])) } : {},
      ...'inner' in plan ? { inner: serialize(plan.inner) } : {},
      ...plan.type === 'dict' ? { sKey: serialize(plan.sKey) } : {},
      ...plan.type === 'union' ? { list: plan.list.map(serialize) } : {},
    }
    return uid
  }
  return { uid: serialize(root), refs }
}
