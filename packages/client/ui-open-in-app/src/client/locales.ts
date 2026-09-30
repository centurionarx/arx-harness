/** `open-in-app` namespace dictionary: the session-header split button and the application names it lists. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'open-in-app'

/** English copy; `app.<catalog id>` keys name the host catalog's applications. */
export const en = {
  'open.title': 'Open in {app}',
  'open.more': 'More ways to open',
  'open.default': '{app} (default)',
  'open.error': 'Could not open. Try again.',
  'app.finder': 'Finder',
  'app.explorer': 'File Explorer',
  'app.filemanager': 'Files',
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.vscodeinsiders': 'VS Code Insiders',
  'app.windsurf': 'Windsurf',
  'app.zed': 'Zed',
  'app.sublimetext': 'Sublime Text',
  'app.xcode': 'Xcode',
  'app.androidstudio': 'Android Studio',
  'app.intellij': 'IntelliJ IDEA',
  'app.pycharm': 'PyCharm',
  'app.webstorm': 'WebStorm',
  'app.phpstorm': 'PhpStorm',
  'app.goland': 'GoLand',
  'app.rider': 'Rider',
  'app.rustrover': 'RustRover',
  'app.fork': 'Fork',
  'app.sourcetree': 'Sourcetree',
  'app.github': 'GitHub Desktop',
  'app.tower': 'Tower',
  'app.gitkraken': 'GitKraken',
  'app.smartgit': 'SmartGit',
  'app.sublimemerge': 'Sublime Merge',
  'app.ghostty': 'Ghostty',
  'app.warp': 'Warp',
  'app.iterm': 'iTerm2',
  'app.kitty': 'kitty',
  'app.terminal': 'Terminal',
  'app.windowsterminal': 'Windows Terminal',
  'app.powershell': 'Windows PowerShell',
  'app.pwsh': 'PowerShell 7',
  'app.gitbash': 'Git Bash',
  'app.gnometerminal': 'GNOME Terminal',
  'app.konsole': 'Konsole',
} as const

/** Key domain of the `open-in-app` namespace. */
export type OpenInAppKey = keyof typeof en

/** Brazilian Portuguese copy; application brand names stay as their vendors write them. */
export const pt = {
  'open.title': 'Abrir em {app}',
  'open.more': 'Outras formas de abrir',
  'open.default': '{app} (padrão)',
  'open.error': 'Não foi possível abrir. Tente de novo.',
  // The parity gate needs every key in both dictionaries, so the brand names
  // the vendors do not translate repeat the English ones.
  /* jscpd:ignore-start */
  'app.finder': 'Finder',
  'app.explorer': 'Explorador de Arquivos',
  'app.filemanager': 'Arquivos',
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.vscodeinsiders': 'VS Code Insiders',
  'app.windsurf': 'Windsurf',
  'app.zed': 'Zed',
  'app.sublimetext': 'Sublime Text',
  'app.xcode': 'Xcode',
  'app.androidstudio': 'Android Studio',
  'app.intellij': 'IntelliJ IDEA',
  'app.pycharm': 'PyCharm',
  'app.webstorm': 'WebStorm',
  'app.phpstorm': 'PhpStorm',
  'app.goland': 'GoLand',
  'app.rider': 'Rider',
  'app.rustrover': 'RustRover',
  'app.fork': 'Fork',
  'app.sourcetree': 'Sourcetree',
  'app.github': 'GitHub Desktop',
  'app.tower': 'Tower',
  'app.gitkraken': 'GitKraken',
  'app.smartgit': 'SmartGit',
  'app.sublimemerge': 'Sublime Merge',
  'app.ghostty': 'Ghostty',
  'app.warp': 'Warp',
  'app.iterm': 'iTerm2',
  'app.kitty': 'kitty',
  'app.terminal': 'Terminal',
  'app.windowsterminal': 'Terminal do Windows',
  'app.powershell': 'Windows PowerShell',
  'app.pwsh': 'PowerShell 7',
  'app.gitbash': 'Git Bash',
  'app.gnometerminal': 'Terminal do GNOME',
  'app.konsole': 'Konsole',
  /* jscpd:ignore-end */
} satisfies Record<OpenInAppKey, string>

/**
 * The dictionary key naming one host catalog id.
 * @param id - catalog id from the host's application list.
 * @returns its `app.<id>` key, or undefined for an id this dictionary does not name.
 */
export function appKey(id: string): OpenInAppKey | undefined {
  const key = `app.${id}`
  return Object.hasOwn(en, key) ? key as OpenInAppKey : undefined
}
