"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const registerOpenProjectListener = (callback) => {
    const listener = (_event, projectPath) => {
        callback(projectPath);
    };
    electron_1.ipcRenderer.on('open-project-from-file', listener);
    return () => electron_1.ipcRenderer.removeListener('open-project-from-file', listener);
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    openFile: () => electron_1.ipcRenderer.invoke('file:open'),
    loadProject: (filePath) => electron_1.ipcRenderer.invoke('file:load', filePath),
    saveFile: (path, content) => electron_1.ipcRenderer.invoke('file:save', { path, content }),
    saveFileAs: (content) => electron_1.ipcRenderer.invoke('file:save-as', content),
    exitApp: () => electron_1.ipcRenderer.invoke('app:exit'),
    // Splash Screen IPC
    sendLoadingProgress: (progress, message) => electron_1.ipcRenderer.send('app:loading-progress', { progress, message }),
    sendAppReady: () => electron_1.ipcRenderer.send('app:ready'),
    onLoadingProgress: (callback) => electron_1.ipcRenderer.on('app:loading-progress', callback),
    // Window close handling
    onCheckUnsavedChanges: (callback) => {
        electron_1.ipcRenderer.on('window:check-unsaved-changes', callback);
        return () => electron_1.ipcRenderer.removeListener('window:check-unsaved-changes', callback);
    },
    sendUnsavedChangesResponse: (hasChanges) => electron_1.ipcRenderer.send('window:unsaved-changes-response', hasChanges),
    onSaveAndClose: (callback) => {
        electron_1.ipcRenderer.on('window:save-and-close', callback);
        return () => electron_1.ipcRenderer.removeListener('window:save-and-close', callback);
    },
    sendSaveCompleted: () => electron_1.ipcRenderer.send('window:save-completed'),
    onOpenProject: (callback) => registerOpenProjectListener(callback),
    openPopout: (payload) => electron_1.ipcRenderer.invoke('popout:open', payload),
    closePopout: (windowId) => electron_1.ipcRenderer.invoke('popout:close', windowId),
    closeAllPopouts: () => electron_1.ipcRenderer.invoke('popout:closeAll'),
    listPopouts: () => electron_1.ipcRenderer.invoke('popout:list'),
    getPopoutInit: (windowId) => electron_1.ipcRenderer.invoke('popout:getInit', windowId),
    getPopoutRestoreOnStartup: () => electron_1.ipcRenderer.invoke('popout:getRestoreOnStartup'),
    setPopoutRestoreOnStartup: (enabled) => electron_1.ipcRenderer.invoke('popout:setRestoreOnStartup', enabled),
    sendProjectSnapshot: (payload) => electron_1.ipcRenderer.send('project:snapshot', payload),
    getLatestProjectSnapshot: () => electron_1.ipcRenderer.invoke('project:getLatestSnapshot'),
    onProjectSnapshot: (callback) => {
        const listener = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('project:snapshot', listener);
        return () => electron_1.ipcRenderer.removeListener('project:snapshot', listener);
    },
    sendAnalysisSnapshot: (payload) => electron_1.ipcRenderer.send('analysis:snapshot', payload),
    getLatestAnalysisSnapshot: () => electron_1.ipcRenderer.invoke('analysis:getLatestSnapshot'),
    onAnalysisSnapshot: (callback) => {
        const listener = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('analysis:snapshot', listener);
        return () => electron_1.ipcRenderer.removeListener('analysis:snapshot', listener);
    },
    onPopoutInit: (callback) => {
        const listener = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('popout:init', listener);
        return () => electron_1.ipcRenderer.removeListener('popout:init', listener);
    },
});
electron_1.contextBridge.exposeInMainWorld('api', {
    onOpenProject: (callback) => registerOpenProjectListener(callback)
});
