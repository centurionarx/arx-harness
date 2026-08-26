#!/usr/bin/env node

import { Context } from '@arx-ai/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@arx-ai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@arx-ai/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
