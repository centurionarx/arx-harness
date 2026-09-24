// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('offers model selection before opening a session and reaches account Settings in the built graph', async () => {
  mountAssembledApp()
  await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10000 })
  const chooser = await screen.findByRole('button', { name: /Select model/ })
  expect(chooser.hasAttribute('disabled')).toBe(false)
  fireEvent.click(await screen.findByRole('button', { name: 'Settings', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'Models', exact: true }))
  const title = await screen.findByText('Native product accounts')
  expect(title).toBeTruthy()
  await screen.findByText('OpenAI Codex chat models')
  expect(within(document.body).queryByText('ARX Local Build')).toBeNull()
})
