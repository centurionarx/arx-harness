/**
 * First native inline publisher. Recovery values stay in one-use closures;
 * admitted recovery documents suppress URL-bearing hashchange delivery.
 */
export const NATIVE_RECOVERY_SCRIPT = '(()=>{const entry=location.pathname;let owned;'
    + 'const publish=()=>{let fragment=location.hash||undefined;'
    + 'if(fragment!==undefined)history.replaceState(null,"",location.pathname+location.search);'
    + 'owned?.clear();const clear=()=>{fragment=undefined;'
    + 'if(globalThis.__ARX_RECOVERY_FRAGMENT__===handle)delete globalThis.__ARX_RECOVERY_FRAGMENT__;'
    + 'if(owned===handle)owned=undefined;};'
    + 'const handle=Object.freeze({take(){const value=fragment;clear();return value;},clear});'
    + 'owned=handle;globalThis.__ARX_RECOVERY_FRAGMENT__=handle;'
    + 'dispatchEvent(new Event("arx-recovery-required"));};'
    + 'const changed=event=>{event.stopImmediatePropagation();if(location.hash!=="")publish();};'
    + 'const restored=event=>{if(!/^(#reset=|#invite=)/.test(location.hash))return;event.stopImmediatePropagation();publish();};'
    + 'if(entry==="/reset"||entry==="/invite"){addEventListener("hashchange",changed,{capture:true});addEventListener("popstate",restored,{capture:true});}'
    + 'addEventListener("pagehide",()=>{removeEventListener("hashchange",changed,{capture:true});removeEventListener("popstate",restored,{capture:true});owned?.clear();},{once:true});'
    + 'publish();})()'
