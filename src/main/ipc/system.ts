import { ipcMain, dialog, shell } from 'electron'
import { IPC } from '../../shared/types'
import { getMainWindow } from '../index'

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC.OPEN_FOLDER_PICKER, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.OPEN_FILE_PICKER, async (_evt, filters?: Electron.FileFilter[]) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_evt, url: string) => {
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(IPC.OPEN_PATH, async (_evt, filePath: string) => {
    await shell.openPath(filePath)
    return true
  })
}
