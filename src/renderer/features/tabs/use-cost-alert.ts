import { useEffect } from 'react'
import { toast } from '@/components/ui/toaster'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { tabTitle } from './tab-status'

/** True when the total just crossed a non-zero limit. `previous` is the last total seen (0 if none). */
export function crossedCostAlert(limitUsd: number, previous: number, total: number): boolean {
  return limitUsd > 0 && Number.isFinite(total) && previous < limitUsd && total >= limitUsd
}

export function formatCostAlert(limitUsd: number, total: number): string {
  return `Cost reached $${total.toFixed(2)} (limit $${limitUsd.toFixed(2)})`
}

/** One toast per conversation when its total cost passes the `costAlertUsd` preference (0 = off). */
export function useCostAlerts(): void {
  useEffect(() => {
    let limit = 0
    const seen = new Map<string, number>()
    const alerted = new Set<string>()
    const api = window.claudrift?.prefs
    void Promise.resolve(api?.get?.())
      .then((p) => {
        limit = p?.costAlertUsd ?? 0
      })
      .catch(() => undefined)
    const offPrefs = api?.onChanged?.((p) => {
      limit = p?.costAlertUsd ?? 0
    })
    for (const c of Object.values(useChatStore.getState().convs)) {
      if (c.lastResult) seen.set(c.convId, c.lastResult.costUsd)
    }
    const offStore = useChatStore.subscribe((s, prev) => {
      if (s.convs === prev.convs) return
      for (const c of Object.values(s.convs)) {
        const total = c.lastResult?.costUsd
        if (total === undefined) continue
        const before = seen.get(c.convId) ?? 0
        seen.set(c.convId, total)
        if (alerted.has(c.convId) || !crossedCostAlert(limit, before, total)) continue
        alerted.add(c.convId)
        const tab = useWorkspaceStore.getState().tabs.find((t) => t.convId === c.convId)
        toast(`${tab ? tabTitle(tab, c) : 'A chat'}: cost alert`, {
          id: `cost-${c.convId}`,
          description: formatCostAlert(limit, total),
          ...(tab ? { action: { label: 'Show', onClick: () => useWorkspaceStore.getState().activateTab(c.convId) } } : {})
        })
      }
    })
    return () => {
      offStore()
      if (typeof offPrefs === 'function') offPrefs()
    }
  }, [])
}
