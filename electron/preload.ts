import { contextBridge, ipcRenderer } from 'electron';

const registerOpenProjectListener = (callback: (path: string) => void) => {
    const listener = (_event: any, projectPath: string) => {
        callback(projectPath);
    };

    ipcRenderer.on('open-project-from-file', listener);
    return () => ipcRenderer.removeListener('open-project-from-file', listener);
};

contextBridge.exposeInMainWorld('electronAPI', {
    openFile: () => ipcRenderer.invoke('file:open'),
    loadProject: (filePath: string) => ipcRenderer.invoke('file:load', filePath),
    saveFile: (path: string, content: string) => ipcRenderer.invoke('file:save', { path, content }),
    saveFileAs: (content: string) => ipcRenderer.invoke('file:save-as', content),
    exitApp: () => ipcRenderer.invoke('app:exit'),

    // Splash Screen IPC
    sendLoadingProgress: (progress: number, message: string) => ipcRenderer.send('app:loading-progress', { progress, message }),
    sendAppReady: () => ipcRenderer.send('app:ready'),
    onLoadingProgress: (callback: (event: any, data: { progress: number, message: string }) => void) =>
        ipcRenderer.on('app:loading-progress', callback),

    // Window close handling
    onCheckUnsavedChanges: (callback: () => void) => {
        ipcRenderer.on('window:check-unsaved-changes', callback);
        return () => ipcRenderer.removeListener('window:check-unsaved-changes', callback);
    },
    sendUnsavedChangesResponse: (hasChanges: boolean) => ipcRenderer.send('window:unsaved-changes-response', hasChanges),
    onSaveAndClose: (callback: () => void) => {
        ipcRenderer.on('window:save-and-close', callback);
        return () => ipcRenderer.removeListener('window:save-and-close', callback);
    },
    sendSaveCompleted: () => ipcRenderer.send('window:save-completed'),
    onOpenProject: (callback: (path: string) => void) => registerOpenProjectListener(callback),

    openPopout: (payload: { view: string; selection?: Record<string, unknown>; snapshotJson?: string; analysisSnapshotJson?: string }) => ipcRenderer.invoke('popout:open', payload),
    closePopout: (windowId: string) => ipcRenderer.invoke('popout:close', windowId),
    closeAllPopouts: () => ipcRenderer.invoke('popout:closeAll'),
    listPopouts: () => ipcRenderer.invoke('popout:list'),
    getPopoutInit: (windowId: string) => ipcRenderer.invoke('popout:getInit', windowId),
    getPopoutRestoreOnStartup: () => ipcRenderer.invoke('popout:getRestoreOnStartup'),
    setPopoutRestoreOnStartup: (enabled: boolean) => ipcRenderer.invoke('popout:setRestoreOnStartup', enabled),

    sendProjectSnapshot: (payload: { snapshotJson: string; sourceWindowId: string }) => ipcRenderer.send('project:snapshot', payload),
    getLatestProjectSnapshot: () => ipcRenderer.invoke('project:getLatestSnapshot'),
    onProjectSnapshot: (callback: (payload: { snapshotJson: string; sourceWindowId: string; ts: number }) => void) => {
        const listener = (_event: any, data: any) => callback(data);
        ipcRenderer.on('project:snapshot', listener);
        return () => ipcRenderer.removeListener('project:snapshot', listener);
    },
    sendAnalysisSnapshot: (payload: { snapshotJson: string; sourceWindowId: string }) => ipcRenderer.send('analysis:snapshot', payload),
    getLatestAnalysisSnapshot: () => ipcRenderer.invoke('analysis:getLatestSnapshot'),
    onAnalysisSnapshot: (callback: (payload: { snapshotJson: string; sourceWindowId: string; ts: number }) => void) => {
        const listener = (_event: any, data: any) => callback(data);
        ipcRenderer.on('analysis:snapshot', listener);
        return () => ipcRenderer.removeListener('analysis:snapshot', listener);
    },
    onPopoutInit: (callback: (payload: any) => void) => {
        const listener = (_event: any, data: any) => callback(data);
        ipcRenderer.on('popout:init', listener);
        return () => ipcRenderer.removeListener('popout:init', listener);
    },
});

contextBridge.exposeInMainWorld('api', {
    onOpenProject: (callback: (path: string) => void) => registerOpenProjectListener(callback)
});
