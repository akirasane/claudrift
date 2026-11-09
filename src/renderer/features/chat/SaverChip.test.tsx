import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '@shared/app'
import { useChatStore } from '@/stores/chat-store'
import { SaverChip } from './SaverChip'

function mount(convId: string): void {
  render(<SaverChip convId={convId} />)
}

beforeEach(() => {
  useChatStore.setState({ savers: {}, convs: {} })
  ;(window as unknown as { claudrift: unknown }).claudrift = { prefs: { get: async () => ({ ...DEFAULT_PREFS, ultraSaver: true }) } }
})

describe('SaverChip', () => {
  it('starts from the app default and flips for this chat only', async () => {
    mount('a')
    await waitFor(() => expect(screen.getByTestId('saver-chip')).toHaveTextContent('Saver on'))
    fireEvent.click(screen.getByTestId('saver-chip'))
    expect(screen.getByTestId('saver-chip')).toHaveTextContent('Saver off')
    expect(useChatStore.getState().savers).toEqual({ a: false })
  })

  it('is locked once the chat has a live session', async () => {
    useChatStore.getState().createConv({ convId: 'b', cwd: 'C:/p' })
    useChatStore.getState().bindLocalId('b', 'live-1')
    mount('b')
    await waitFor(() => expect(screen.getByTestId('saver-chip')).toBeDisabled())
    useChatStore.getState().setSaver('b', false)
    expect(useChatStore.getState().savers['b']).toBeUndefined()
  })
})
