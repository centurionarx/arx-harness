/**
 * One provider's editor card, laid out for the adapter that owns the profile.
 *
 * A pi-ai route's primary field is a single write-only **API key** input (the
 * page never asks for an environment-variable name — a typed key stores
 * through `credentials.set` under the profile's reference, deriving
 * `<ROUTE>_API_KEY` when the profile has none. The profile records that
 * derivation as `apiKeyEnv` only when a key is entered; a blank key
 * materializes a reference-free profile for provider-native authentication);
 * the collapsed "Customized settings" area carries the curated extras
 * (`baseURL`, the model list, and the display name and wire protocol of a
 * route the adapter does not ship — the two fields the create card asked that
 * route for, editable here for the same reason).
 *
 * A CLI-backed route has no key, endpoint, or protocol to edit: the CLI signs
 * in with the login the host already holds, and nothing on this card stores or
 * reads a credential. Its card is the model list, shown unfolded because a
 * model with a context window is what the route cannot serve without.
 *
 * Reasoning effort is deliberately absent: it is a per-MODEL capability, and
 * the models under one provider disagree about it, so a provider-scoped
 * control can only be set to a value some of them reject. The composer's
 * model picker offers each model its own levels; `settings.yaml` keeps the
 * profile field for a deployment that knows its route. Everything else stays
 * owned by `settings.yaml`. Profile edits land as minimal `settings.mutate`
 * path ops against the stored section — the card names only the fields it can
 * see instead of rebuilding the whole subtree from a partial descriptor.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CredentialView, IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@arx-ai/arx-api-remotes/client'
import { CATALOG_RULES, modelDrafts, validateModelCatalog } from './model-catalog.ts'
import type { ModelCatalogFailure, ModelEntryFormat } from './model-catalog.ts'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf, protocolChoices } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One adapter's curated field set, or the hint alone for a namespace that has none. */
type EditorLayout = ModelEntryFormat | 'unknown'

/** Props of {@link ProviderEditor}. */
export interface ProviderEditorProps {
  /** Provider route id. */
  provider: string
  /** Display name for the card title. */
  displayName: string
  /** Hide the title row (the add card renders its own provider select). */
  hideTitle?: boolean
  /**
   * Whether the adapter reports this route as hand-declared — absent from its
   * installed catalog. Such a route carries its own wire protocol, chosen when
   * it was created and editable here for the same reason; a catalog route's
   * models each carry theirs, so a route-level protocol there could only
   * override every one of them and the card does not offer it.
   */
  declared?: boolean
  /** The owning namespace view (schema, layers, secrets). */
  namespace: SettingsNamespaceView
  /** Settings-owned synchronous schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
  /** Wire faces for writes and for interrogating a provider endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the editor; `changed` reports whether an Apply committed. */
  onClose: (changed: boolean) => void
}

/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
): Record<string, unknown> {
  const subtree = schema.getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/**
 * The editor layout the owning namespace selects. Namespaces are an open set —
 * any adapter may register one — so a namespace this card has no form for gets
 * the hint that points at `settings.yaml`.
 */
function layoutOf(ns: string): EditorLayout {
  switch (ns) {
    case 'llm-pi-ai': return 'pi-ai'
    case 'llm-agent-cli': return 'agent-cli'
    default: return 'unknown'
  }
}

/* v8 ignore next 3 -- closed-union default only defends future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected provider editor layout')
}

/** The credential reference this profile resolves keys through. */
function refFor(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
  provider: string,
): string {
  const profile = schema.getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card.
 */
export function ProviderEditor(props: ProviderEditorProps): ReactNode {
  const { namespace, schema, settingsPath, api, t } = props
  const [draft, setDraft] = useState<Record<string, unknown>>(() => draftAt(schema, namespace, settingsPath))
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // A settings success advances both retry baselines immediately. Keeping the
  // derived fields in the draft prevents a pushed namespace refresh from
  // turning them into deletions when the following credential write is retried.
  const [committedOriginal, setCommittedOriginal] = useState<unknown>(
    () => schema.getPath(namespace.user, settingsPath),
  )
  const [expectedRevision, setExpectedRevision] = useState(() => namespace.revision)
  const root = useMemo(() => schema.rehydrate(namespace.schema), [namespace.schema, schema])
  const node = useMemo(() => schema.nodeAtPath(root, settingsPath), [root, schema, settingsPath])
  const fallback = schema.getPath(namespace.value, settingsPath)
  const disabled = props.readOnly || busy
  const layout = layoutOf(namespace.ns)
  const keyRef = refFor(schema, namespace, settingsPath, props.provider)
  // The same schema read the create card makes, so the choices offered here
  // and there cannot drift apart: both come from the adapter's own `Config`.
  // Only the pi-ai layout has a per-route protocol for the read to find, and
  // it rehydrates the whole section schema, so the other layouts skip it.
  const protocols = useMemo(
    () => layout === 'pi-ai' ? protocolChoices(namespace, schema) : [],
    [layout, namespace, schema],
  )

  useEffect(() => {
    // Only a key-bearing layout has a stored key worth a hint; asking about one
    // for a CLI-backed route would describe a reference nothing ever sets.
    if (layout !== 'pi-ai') return
    let stale = false
    setKeyState(undefined)
    // The key state is a placeholder hint, not a precondition for editing:
    // neither a business rejection nor a transport failure may reach the
    // browser as an unhandled rejection, so the card simply renders without
    // the "already configured" hint.
    void api.credentials.describe({ refs: [keyRef] }).then(
      (response) => {
        if (stale || !response.result.ok) return
        setKeyState(response.result.value.credentials[keyRef])
      },
      () => undefined,
    )
    return () => { stale = true }
  }, [api.credentials, keyRef, layout])

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = schema.getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    // A value of nothing but whitespace is cleared, not stored: `stringAt`
    // already reports it as absent, so the field would otherwise render empty
    // while the draft still carried the spaces into `settings.yaml`, where
    // both adapters would accept that non-empty string as a real value.
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined
      ? schema.deletePath(current, [key])
      : schema.setPath(current, [key], value))
  }

  // The model list is validated per row, so a bad row is named by its position
  // rather than by a blanket message. A namespace with no form has no rules to
  // judge its rows by, and its card cannot write them anyway.
  const rowFailure = (value: unknown): ModelCatalogFailure | undefined =>
    layout === 'unknown' ? undefined : validateModelCatalog(value, CATALOG_RULES[layout])
  const modelFailure = rowFailure(schema.getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)
  // What a probe or a write must carry: the typed key with paste whitespace
  // removed. A blank field yields an empty string, which both call sites read
  // as "no key supplied" rather than as a key — that is how a card whose
  // provider already has a stored key is edited without re-entering it.
  const keyValue = keyDraft.trim()
  // What the form currently shows, which is what an interrogation must ask:
  // an edited-but-unsaved endpoint, and a key typed but not yet stored.
  const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api')
  const probeBaseURL = stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL')
  const probe = {
    settingsNs: namespace.ns,
    // Naming the route lets an adapter that already describes it answer from
    // its own registry — better metadata, no network call, no endpoint needed.
    provider: props.provider,
    ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
    ...probeApi === undefined ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }
  /**
   * The write for this card, or a failure message. Every edit travels as
   * path ops against the STORED section: the draft comes from the redacted
   * descriptor, so a wholesale replace rebuilt from it could delete fields
   * outside the card. Ops name only the fields this card can see.
   */
  const applyOnce = async (): Promise<string | undefined> => {
    const ns = namespace.ns
    // A profile names the conventional reference only when this page is about
    // to store a key. Otherwise the provider keeps its native auth path.
    const next = stringAt(draft, 'apiKeyEnv') === undefined
      && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? schema.setPath(draft, ['apiKeyEnv'], keyRef)
      : draft
    // The same checker gates the submit button, so a card cannot reach this
    // with a bad row; it stays because nothing but this function decides what
    // is written.
    const failure = rowFailure(schema.getPath(next, ['models']))
    /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
    if (failure !== undefined) {
      return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`
    }
    const materializesNativeProfile = fallback === undefined
      && committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = materializesNativeProfile
      ? [{ op: 'set', path: [...settingsPath], value: {} }]
      : pathOps(settingsPath, committedOriginal, next)
    if (ops.length > 0) {
      const response = await api.settings.mutate({ ns, ops, expectedRevision })
      if (!response.result.ok) {
        return response.result.error.code === 'settings-conflict'
          ? t('conflict')
          : response.result.error.message
      }
      setCommittedOriginal(schema.getPath(response.result.value.user, settingsPath))
      setExpectedRevision(response.result.value.revision)
      setDraft(next)
    }
    if (keyValue.length > 0) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    setKeyDraft('')
    return undefined
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const failure = await applyOnce()
      if (failure !== undefined) {
        setFailure(failure)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure (disconnect, a request the host refuses) rejects
      // rather than answering; without this the card would stay busy forever
      // with no error shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  if (node === undefined) {
    // A directory entry addressing a position its schema cannot resolve is a
    // host-side inconsistency; showing it beats a blank card.
    return <p className={styles['error']}>{`${props.provider}: unresolvable settings path`}</p>
  }

  const keyLocked = keyState?.writable === false

  /**
   * The catalog beneath the user layer: what the composition entry pinned, or
   * else the schema default that `resolve` would supply. The effective value
   * cannot answer this — it still carries the stored override until the unset
   * is applied, so reading it would echo that override straight back the
   * moment reset drops it, leaving the rows unchanged until a reload.
   */
  const inheritedModels = (): unknown => {
    const pinned = schema.getPath(namespace.base, [...settingsPath, 'models'])
    return pinned ?? schema.nodeAtPath(root, [...settingsPath, 'models'])?.meta.default
  }

  // What a hand-declared route names for itself and nothing else can supply.
  const ownsIdentity = props.declared === true
  const modelsOverridden = schema.hasPath(draft, ['models'])
  const models = modelDrafts(modelsOverridden ? schema.getPath(draft, ['models']) : inheritedModels())
  // A layer beneath the user's to fall back to: a pi-ai route always has one,
  // its installed catalog; a CLI-backed route has one only when the
  // composition pinned models for it, and otherwise has nothing to restore.
  const inherits = layout === 'pi-ai' || schema.hasPath(namespace.base, [...settingsPath, 'models'])
  // The CLI-backed route serves exactly what it lists and refuses anything
  // else, so a card that would leave it listing nothing cannot apply.
  const needsModels = layout === 'agent-cli' && models.length === 0
  /** What the model-list editor takes: the rows, whose layer owns them, and the writes. */
  const catalogProps = {
    models,
    ...inherits
      ? {
        overridden: modelsOverridden,
        onReset: () => { setDraft(current => schema.deletePath(current, ['models'])) },
      }
      : {},
    t,
    disabled,
    onChange: (next: Record<string, unknown>[]) => {
      setDraft(current => schema.setPath(current, ['models'], next))
    },
  }

  /** The display-name field of a hand-declared route, the one name nothing else supplies. */
  const displayNameField = (): ReactNode => (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
      <input
        className={styles['input']}
        type="text"
        value={stringAt(draft, 'displayName') ?? ''}
        // What this route is called the moment the field is
        // cleared, which is the layer beneath the one this field
        // edits: a `cordis.yml` may pin a name for a route the
        // catalog does not ship, and only when nothing does is
        // the answer the route id. Reading the effective value
        // instead would echo the stored override back as the
        // thing clearing restores.
        placeholder={stringAt(schema.getPath(namespace.base, settingsPath), 'displayName')
          ?? props.provider}
        aria-label={t('customDisplayName')}
        disabled={disabled}
        onChange={(event) => { setField('displayName', event.target.value) }}
      />
    </div>
  )

  /** The pi-ai fields: the key, then the customized fold with the endpoint and the models. */
  const curatedFields = (): ReactNode => {
    const keyPlaceholder = keyLocked
      ? t('keyEnvLocked')
      : keyState?.configured === true ? t('keyStored') : t('keyPlaceholderNative')
    return (
      <>
        <div className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('keyInput')}</span>
          <input
            className={styles['input']}
            type="password"
            autoComplete="off"
            value={keyDraft}
            placeholder={keyPlaceholder}
            aria-label={t('keyInput')}
            aria-invalid={keyFailure !== undefined}
            disabled={disabled || keyLocked}
            onChange={(event) => { setKeyDraft(event.target.value) }}
          />
          {keyFailure === undefined ? null : <p className={styles['error']}>{t(keyFailure)}</p>}
        </div>
        <details className={styles['customized']}>
          <summary className={styles['customizedSummary']}>{t('customized')}</summary>
          <div className={styles['customizedBody']}>
            {/* The name and the protocol are the create card's two remaining
                profile fields; a route the adapter ships defaults both from
                its catalog entry and neither belongs on its card. */}
            {ownsIdentity ? displayNameField() : null}
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
              <input
                className={styles['input']}
                type="text"
                value={stringAt(draft, 'baseURL') ?? ''}
                placeholder={stringAt(fallback, 'baseURL') ?? t('baseUrlDefault')}
                aria-label={t('baseUrl')}
                disabled={disabled}
                onChange={(event) => {
                  setField('baseURL', event.target.value === '' ? undefined : event.target.value)
                }}
              />
            </div>
            {/* The protocol sits beside the endpoint it describes, as it does
                on the create card. */}
            {ownsIdentity
              ? (
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('customApi')}</span>
                  <select
                    className={`${styles['input']} ${styles['selectInput']}`}
                    value={probeApi ?? ''}
                    aria-label={t('customApi')}
                    disabled={disabled}
                    onChange={(event) => { setField('api', event.target.value) }}
                  >
                    {/* A profile naming no protocol — hand-written into
                        settings.yaml with no model to need one — selects
                        nothing rather than reading as if it had picked the
                        first choice. The option is named because a screen
                        reader announces it either way, and an empty one is
                        announced as a choice with no identity. */}
                    {probeApi === undefined ? <option value="">{t('customApiUnset')}</option> : null}
                    {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                </div>
              )
              : null}
            <ModelListEditor format="pi-ai" {...catalogProps} probe={probe} probeBlocked={keyFailure} api={api} />
          </div>
        </details>
      </>
    )
  }

  /**
   * The CLI-backed fields: what the route signs in with, the terms it runs
   * under, and the models it serves — with no key, endpoint, or protocol,
   * because the host's own CLI login is the whole credential.
   */
  const agentCliFields = (): ReactNode => (
    <>
      <p className={styles['intro']}>{t('agentCliCaption')}</p>
      <p className={styles['notice']}>{t('agentCliTerms')}</p>
      {ownsIdentity ? displayNameField() : null}
      <ModelListEditor format="agent-cli" {...catalogProps} probe={probe} api={api} />
    </>
  )

  /** The body the layout selects; a namespace with no form gets the hint alone. */
  const body = (): ReactNode => {
    switch (layout) {
      case 'pi-ai': return curatedFields()
      case 'agent-cli': return agentCliFields()
      case 'unknown': return <p className={styles['advancedHint']}>{`${t('advancedHint')} (${namespace.ns})`}</p>
      /* v8 ignore next -- closed-union default only defends future source widening */
      default: return assertNever(layout)
    }
  }

  return (
    <div className={styles['editor']}>
      {props.hideTitle === true
        ? null
        : (
          <div className={styles['editorHeader']}>
            <span className={styles['editorTitle']}>{props.displayName}</span>
            {props.provider !== props.displayName
              ? <span className={styles['editorRoute']}>{props.provider}</span>
              : null}
          </div>
        )}
      {body()}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {modelFailure === undefined
        ? needsModels ? <p className={styles['advancedHint']}>{t('agentCliNeedsModels')}</p> : null
        : (
          <p className={styles['advancedHint']}>
            {`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}
          </p>
        )}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || layout === 'unknown'
          || modelFailure !== undefined
          || keyFailure !== undefined
          || needsModels}
        submitLabel="apply"
        submitBusyLabel="applying"
        onCancel={() => { props.onClose(false) }}
        onSubmit={() => { void apply() }}
      />
    </div>
  )
}
