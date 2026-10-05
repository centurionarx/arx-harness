/** jsdom implements dialog elements but not their native modal methods; no inert or focus-wrap simulation. */
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: {
    configurable: true,
    value(this: HTMLDialogElement): void { this.open = true },
  },
  close: {
    configurable: true,
    value(this: HTMLDialogElement): void {
      if (!this.open) return
      this.open = false
      queueMicrotask(() => { this.dispatchEvent(new Event('close')) })
    },
  },
})
