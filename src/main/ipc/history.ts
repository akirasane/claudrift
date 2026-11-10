import { ipcMain } from 'electron'
import {
  HistoryDeleteSchema,
  HistoryListSchema,
  HistoryLoadSchema,
  HistoryRenameSchema,
  HistorySaveSummarySchema,
  HistorySearchSchema,
  HistorySummarizeSchema,
  IpcChannels
} from '../../shared/ipc'
import type { HistorySearchHit, HistorySessionInfo, ProjectInfo, SessionEvent } from '../../shared/events'
import { HistoryService } from '../services/history-service'
import { HistorySearchService } from '../services/history-search'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerHistoryIpc(
  service: HistoryService = new HistoryService(),
  search: HistorySearchService = new HistorySearchService()
): Disposer {
  ipcMain.handle(IpcChannels.historyListProjects, (): Promise<ProjectInfo[]> => service.listProjects())
  ipcMain.handle(IpcChannels.historyList, (_e, raw: unknown): Promise<HistorySessionInfo[]> => {
    return service.list(HistoryListSchema.parse(raw).cwd)
  })
  ipcMain.handle(IpcChannels.historyLoad, (_e, raw: unknown): Promise<SessionEvent[]> => {
    const a = HistoryLoadSchema.parse(raw)
    return service.load(a.sessionId, a.cwd)
  })
  ipcMain.handle(
    IpcChannels.historySearch,
    (_e, raw: unknown): Promise<HistorySearchHit[]> => search.search(HistorySearchSchema.parse(raw).query)
  )
  ipcMain.handle(IpcChannels.historyDelete, async (_e, raw: unknown): Promise<void> => {
    const a = HistoryDeleteSchema.parse(raw)
    await service.delete(a.sessionId, a.cwd)
  })
  ipcMain.handle(IpcChannels.historyRename, async (_e, raw: unknown): Promise<void> => {
    const a = HistoryRenameSchema.parse(raw)
    await service.rename(a.sessionId, a.title, a.cwd)
  })
  ipcMain.handle(IpcChannels.historySummarize, (_e, raw: unknown): Promise<string> => {
    const a = HistorySummarizeSchema.parse(raw)
    return service.summarize(a.sessionId, a.cwd)
  })
  ipcMain.handle(IpcChannels.historySaveSummary, (_e, raw: unknown): Promise<string> => {
    const a = HistorySaveSummarySchema.parse(raw)
    return service.saveSummary(a.cwd, a.title, a.summary)
  })
  return removeHandlers(
    IpcChannels.historyListProjects,
    IpcChannels.historyList,
    IpcChannels.historyLoad,
    IpcChannels.historySearch,
    IpcChannels.historyDelete,
    IpcChannels.historyRename,
    IpcChannels.historySummarize,
    IpcChannels.historySaveSummary
  )
}
