// @vitest-environment jsdom
// The built Models settings page composes both sign-in children through its
// child slots: chat sign-in for registered authorization flows and native
// product accounts. The keyless fixture registers no flow and reports no
// account, so each card renders its empty state from the real transport.
import { fireEvent, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('reaches chat sign-in and native product accounts from the built Models settings page', async () => {
  mountAssembledApp()
  await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  const dialog = await screen.findByRole('dialog', { name: 'Settings' })
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Models' }))
  const chat = await within(dialog).findByRole('region', { name: 'OpenAI Codex chat models' })
  expect(within(chat).getByText('The OpenAI authorization provider is unavailable.')).toBeTruthy()
  const native = await within(dialog).findByRole('region', { name: 'Native product accounts' })
  expect(within(native).getByRole('button', { name: 'Refresh account status' })).toBeTruthy()
  expect(within(document.body).queryByText('ARX Local Build')).toBeNull()
})
