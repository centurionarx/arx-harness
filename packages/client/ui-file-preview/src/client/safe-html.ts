/** HTML remains isolated even if a sanitizer misses unfamiliar markup. */
const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
const BLOCKED = 'script,iframe,object,embed,link,meta,base,form,svg,math,audio,video,source,track'
const URL_ATTRIBUTES = new Set(['src', 'srcset', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'background', 'srcdoc'])

/**
 * Strip active elements and URL attributes before opaque sandbox rendering.
 * @param source - untrusted HTML document bytes decoded as UTF-8.
 * @returns a reconstructed document with a restrictive CSP.
 */
export function safeHtmlDocument(source: string): string {
  const template = document.createElement('template')
  template.innerHTML = source
  for (const element of template.content.querySelectorAll(BLOCKED)) element.remove()
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on') || URL_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + CSP + '"></head><body>'
    + template.innerHTML + '</body></html>'
}
