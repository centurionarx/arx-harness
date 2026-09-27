// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@arx-ai/arx-api-remotes/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { makeTranslate } from '@arx-ai/arx-client-test-runtime'
import { en, pt } from '../src/client/locales.ts'
import { en as commonEn } from '@arx-ai/arx-client-locale/src/locales/en.ts'
import { pt as commonPt } from '@arx-ai/arx-client-locale/src/locales/pt.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = makeTranslate(en, commonEn)
const tPt: ComponentProps<typeof ModelSelect>['t'] = makeTranslate(pt, commonPt)

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: 'Select model, current DeepSeek-V4-Flash, reasoning effort High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /Effort/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('Select model, current DeepSeek-V4-Flash, reasoning effort Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Select model, current Model, reasoning effort Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Effort/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('labels the shared effort ids in the active locale and keeps the Host name for any other id', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'xhigh', name: 'Xhigh' },
              { id: 'max', name: 'Max' },
              { id: 'turbo', name: 'Turbo', description: 'Vendor level' },
            ],
          },
        }],
      }],
      current: { provider: 'provider', model: 'model', reasoningEffort: 'xhigh' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={tPt}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Selecionar modelo, atual: Model, esforço de raciocínio Extra',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Esforço/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Padrão', 'Baixo', 'Extra', 'Máx', 'TurboVendor level'])
  })

  it('labels an effort the model no longer lists: a shared id in the locale, any other id as reported', () => {
    const models = [{ id: 'model', name: 'Model', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }]
    const directory = createSnapshotStore(state({
      groups: [{ id: 'provider', name: 'Provider', models }],
      current: { provider: 'provider', model: 'model', reasoningEffort: 'medium' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)
    expect(screen.getByRole('button', { name: 'Select model, current Model, reasoning effort Medium' })).toBeTruthy()
    cleanup()
    directory.set(state({
      groups: [{ id: 'provider', name: 'Provider', models }],
      current: { provider: 'provider', model: 'model', reasoningEffort: 'turbo' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)
    expect(screen.getByRole('button', { name: 'Select model, current Model, reasoning effort turbo' })).toBeTruthy()
  })

  describe('effort in the same menu as the model', () => {
    const routes = (current: ModelSelection | null): ModelDirectoryState => state({
      current,
      groups: [{
        id: 'route',
        name: 'Route',
        models: [
          { id: 'plain', name: 'Plain' },
          { id: 'thinker', name: 'Thinker', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
          { id: 'single', name: 'Single', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } },
        ],
      }],
    })

    function mount(
      directory: ReturnType<typeof createSnapshotStore<ModelDirectoryState>>,
      select: (selection: ModelSelection) => Promise<boolean>,
    ) {
      render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
      fireEvent.click(screen.getByRole('button', { name: /^Select model/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    }

    it('opens the picked model\'s effort pane and submits the level for that model', async () => {
      const directory = createSnapshotStore<ModelDirectoryState>(routes({ provider: 'route', model: 'plain' }))
      const select = vi.fn(async (selection: ModelSelection) => {
        directory.set(routes({ ...selection, ...selection.reasoningEffort === undefined ? { reasoningEffort: 'high' } : {} }))
        return true
      })
      mount(directory, select)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Thinker' }))
      await waitFor(() => {
        expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Low', 'High'])
      })
      expect(select).toHaveBeenCalledWith({ provider: 'route', model: 'thinker' })
      const high = screen.getByRole('menuitemradio', { name: 'High' })
      expect(high.getAttribute('aria-checked')).toBe('true')
      expect(document.activeElement).toBe(high)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Low' }))
      await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
      expect(select).toHaveBeenLastCalledWith({ provider: 'route', model: 'thinker', reasoningEffort: 'low' })
    })

    it('describes the picked model while the directory still reports the previous one', async () => {
      const directory = createSnapshotStore<ModelDirectoryState>(routes({ provider: 'route', model: 'plain' }))
      const select = vi.fn(async () => true)
      mount(directory, select)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Thinker' }))
      await waitFor(() => {
        expect(screen.getByRole('menuitemradio', { name: 'High' }).getAttribute('aria-checked')).toBe('true')
      })
      // Choosing the default level again only closes: it is the level the pick applied.
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
      await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
      expect(select).toHaveBeenCalledTimes(1)
    })

    it('closes after picking a model with at most one effort row', async () => {
      const directory = createSnapshotStore<ModelDirectoryState>(routes({ provider: 'route', model: 'thinker' }))
      const select = vi.fn(async (selection: ModelSelection) => {
        directory.set(routes(selection))
        return true
      })
      mount(directory, select)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Single' }))
      await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
      cleanup()
      mount(directory, select)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Plain' }))
      await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    })

    it('re-picking the current model opens its pane, and Escape returns to the root pane', async () => {
      const directory = createSnapshotStore<ModelDirectoryState>(routes({ provider: 'route', model: 'thinker', reasoningEffort: 'low' }))
      const select = vi.fn(async () => true)
      mount(directory, select)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Thinker' }))
      await waitFor(() => {
        expect(screen.getByRole('menuitemradio', { name: 'Low' }).getAttribute('aria-checked')).toBe('true')
      })
      expect(select).not.toHaveBeenCalled()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(screen.getByRole('menuitem', { name: /Effort/ })).toBeTruthy()
    })
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: 'Select model' })
    expect(trigger.textContent).toContain('Select model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /Effort/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Select model|current/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('Model operation failed: model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
