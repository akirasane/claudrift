import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/toaster'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { exportConversation } from './export-action'

vi.mock('@/components/ui/toaster', async (orig) => {
  const real = await orig<typeof import('@/components/ui/toaster')>()
  const t = Object.assign(vi.fn(), { error: vi.fn() })
  return { ...real, toast: t }
})

let exportMarkdown: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.mocked(toast).mockClear()
  exportMarkdown = vi.fn(async () => 'C:\\out\\chat.md')
  ;(window as unknown as { claudrift: unknown }).claudrift = { dialog: { exportMarkdown } }
  useChatStore.setState({ convs: {}, localToConv: {} })
  useWorkspaceStore.setState({ tabs: [], activeConvId: undefined })
})

describe('exportConversation', () => {
  it('refuses an empty conversation', async () => {
    useChatStore.getState().createConv({ convId: 'c', cwd: 'C:\\p' })
    await exportConversation('c')
    expect(exportMarkdown).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('sends the markdown and the title to the save dialog', async () => {
    useChatStore.getState().createConv({ convId: 'c', cwd: 'C:\\p' })
    useChatStore.setState((s) => ({
      convs: { ...s.convs, c: { ...s.convs['c']!, items: [{ kind: 'user', id: 'u', text: 'hello world' }] } }
    }))
    useWorkspaceStore.setState({ tabs: [{ convId: 'c', cwd: 'C:\\p', title: 'My chat', openedAt: 1, lastActiveAt: 1 }] })
    await exportConversation('c')
    const arg = exportMarkdown.mock.calls[0]![0] as { defaultName: string; content: string }
    expect(arg.defaultName).toBe('My chat')
    expect(arg.content).toContain('## User\n\nhello world')
    expect(toast).toHaveBeenCalledWith('Conversation exported', { description: 'C:\\out\\chat.md' })
  })

  it('stays quiet when the dialog is cancelled', async () => {
    exportMarkdown.mockResolvedValue(null)
    useChatStore.getState().createConv({ convId: 'c', cwd: 'C:\\p' })
    useChatStore.setState((s) => ({
      convs: { ...s.convs, c: { ...s.convs['c']!, items: [{ kind: 'user', id: 'u', text: 'x' }] } }
    }))
    await exportConversation('c')
    expect(toast).not.toHaveBeenCalled()
  })
})
