import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFileRef, ConfigSnapshot } from '@shared/config'
import { BackupsButton } from './BackupsButton'

const ref: ConfigFileRef = { kind: 'memory', scope: 'user' }
const backups = vi.fn()
const readBackup = vi.fn()
const restore = vi.fn()

beforeEach(() => {
  backups.mockReset()
  readBackup.mockReset()
  restore.mockReset()
  ;(window as unknown as { claudrift: unknown }).claudrift = { config: { backups, readBackup, restore } }
})

describe('BackupsButton', () => {
  it('shows an empty state when there are no backups', async () => {
    backups.mockResolvedValue([])
    render(<BackupsButton fileRef={ref} baseHash="h1" onRestored={() => {}} />)
    await userEvent.click(screen.getByTestId('backups-open'))
    expect(await screen.findByTestId('backups-empty')).toBeTruthy()
  })

  it('previews the newest backup and restores it with the base hash', async () => {
    backups.mockResolvedValue([{ path: 'C:\\b\\new.bak', mtimeMs: 2000, size: 3 }, { path: 'C:\\b\\old.bak', mtimeMs: 1000, size: 2 }])
    readBackup.mockResolvedValue('old text')
    const snap: ConfigSnapshot = { ref, path: 'C:\\x\\CLAUDE.md', exists: true, text: 'old text', hash: 'h2' }
    restore.mockResolvedValue({ ok: true, snapshot: snap })
    const onRestored = vi.fn()
    render(<BackupsButton fileRef={ref} baseHash="h1" onRestored={onRestored} />)
    await userEvent.click(screen.getByTestId('backups-open'))
    await waitFor(() => expect(screen.getByTestId('backups-preview').textContent).toBe('old text'))
    expect(readBackup).toHaveBeenCalledWith({ ref, backupPath: 'C:\\b\\new.bak' })
    await userEvent.click(screen.getByTestId('backups-restore'))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(snap))
    expect(restore).toHaveBeenCalledWith({ ref, backupPath: 'C:\\b\\new.bak', baseHash: 'h1' })
  })

  it('shows the error and does not report a restore when the file changed', async () => {
    backups.mockResolvedValue([{ path: 'C:\\b\\new.bak', mtimeMs: 2000, size: 3 }])
    readBackup.mockResolvedValue('x')
    restore.mockResolvedValue({ ok: false, code: 'conflict', message: 'changed' })
    const onRestored = vi.fn()
    render(<BackupsButton fileRef={ref} baseHash="h1" onRestored={onRestored} />)
    await userEvent.click(screen.getByTestId('backups-open'))
    await userEvent.click(await screen.findByTestId('backups-restore'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onRestored).not.toHaveBeenCalled()
  })
})
