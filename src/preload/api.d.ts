import type { ClaudriftApi } from '../shared/ipc'
declare global {
  interface Window {
    claudrift: ClaudriftApi
  }
}
export {}
