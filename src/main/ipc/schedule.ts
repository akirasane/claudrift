import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import { ScheduleEnabledSchema, ScheduleIdSchema, ScheduleInputSchema } from '../../shared/schedule'
import type { ScheduledTask } from '../../shared/schedule'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface ScheduleIpcDeps {
  list(): ScheduledTask[]
  upsert(input: unknown): ScheduledTask
  remove(id: string): boolean
  setEnabled(id: string, enabled: boolean): ScheduledTask | undefined
  run(id: string): Promise<boolean>
}

export function registerScheduleIpc(deps: ScheduleIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.scheduleList, () => deps.list())
  ipcMain.handle(IpcChannels.scheduleSave, (_e, raw: unknown) => deps.upsert(ScheduleInputSchema.parse(raw)))
  ipcMain.handle(IpcChannels.scheduleDelete, (_e, raw: unknown) => deps.remove(ScheduleIdSchema.parse(raw).id))
  ipcMain.handle(IpcChannels.scheduleEnable, (_e, raw: unknown) => {
    const a = ScheduleEnabledSchema.parse(raw)
    return deps.setEnabled(a.id, a.enabled)
  })
  ipcMain.handle(IpcChannels.scheduleRun, (_e, raw: unknown) => deps.run(ScheduleIdSchema.parse(raw).id))
  return removeHandlers(
    IpcChannels.scheduleList,
    IpcChannels.scheduleSave,
    IpcChannels.scheduleDelete,
    IpcChannels.scheduleEnable,
    IpcChannels.scheduleRun
  )
}
