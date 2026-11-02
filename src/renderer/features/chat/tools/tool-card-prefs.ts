import * as React from 'react'
import { create } from 'zustand'

interface ToolCardPrefsState {
  expanded: boolean
  set: (v: boolean) => void
}

/** The toolCardsExpanded preference mirrored for the renderer. Collapsed until the real value is read. */
export const useToolCardPrefs = create<ToolCardPrefsState>((set) => ({ expanded: false, set: (expanded) => set({ expanded }) }))

let started = false

/** Reads the preference once and follows changes. Safe without window.ccwrap (stays collapsed). */
export function useToolCardsExpanded(): boolean {
  const v = useToolCardPrefs((s) => s.expanded)
  React.useEffect(() => {
    if (started) return
    const api = window.ccwrap?.prefs
    if (!api) return
    started = true
    void Promise.resolve(api.get?.())
      .then((p) => useToolCardPrefs.getState().set(p?.toolCardsExpanded === true))
      .catch(() => undefined)
    api.onChanged?.((p) => useToolCardPrefs.getState().set(p?.toolCardsExpanded === true))
  }, [])
  return v
}

/** Test seam. */
export function resetToolCardPrefsForTest(expanded = false): void {
  started = false
  useToolCardPrefs.getState().set(expanded)
}
