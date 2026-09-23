/**
 * Settings event contract: requests the settings shell answers for plugins
 * that cannot render it. The requester names a section; which plugin draws
 * the shell stays unknown to it, as the slot contract keeps it for sections.
 */

declare module '@arx-ai/cordis' {
  interface Events {
    /**
     * Open the settings panel on one registered section. The shell that
     * occupies `sidebar.settings` answers every request made while it is
     * mounted; an id no `settings.section` entry registers opens the panel on
     * its first section, as navigating to a section that unmounted does.
     * @param id - the `settings.section` entry id to show.
     * @mode emit
     */
    'settings/open-section'(id: string): void
  }
}

export {}
