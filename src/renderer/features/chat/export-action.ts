import { toast } from '@/components/ui/toaster'
import { tabTitle } from '@/features/tabs/tab-status'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { conversationToMarkdown } from './export-markdown'

/** Asks for a file with a save dialog and writes the conversation there as Markdown. */
export async function exportConversation(convId: string): Promise<void> {
  const conv = useChatStore.getState().convs[convId]
  if (!conv || conv.items.length === 0) {
    toast.error('Nothing to export', { description: 'This conversation has no messages yet.' })
    return
  }
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.convId === convId)
  const title = tab ? tabTitle(tab, conv) : 'Conversation'
  const content = conversationToMarkdown(conv, {
    title,
    cwd: conv.cwd,
    ...(conv.meta.model ? { model: conv.meta.model } : {}),
    exportedAt: new Date()
  })
  try {
    const path = await window.claudrift.dialog.exportMarkdown({ defaultName: title, content })
    if (path) toast('Conversation exported', { description: path })
  } catch (err) {
    toast.error('Could not export', { description: err instanceof Error ? err.message : String(err) })
  }
}
