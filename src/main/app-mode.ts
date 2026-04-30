// Production vs test mode. Persisted in electron-store under "appMode".
// Default: production.

import Store from 'electron-store'
import type { AppMode } from '@shared/types'

interface ModeSchema {
  appMode: AppMode
}

const store = new Store<ModeSchema>({
  name: 'app-mode',
  defaults: { appMode: 'production' }
})

export function getAppMode(): AppMode {
  return store.get('appMode')
}

export function setAppMode(mode: AppMode): void {
  store.set('appMode', mode)
}
