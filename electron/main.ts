import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';

process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
    dialog.showErrorBox('Error de Aplicacion', error.message + '\n\n' + error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

function ensureSmalExtension(filePath: string): string {
    const trimmed = filePath.trim();
    if (trimmed.toLowerCase().endsWith('.smal')) return trimmed;

    const ext = path.extname(trimmed);
    if (!ext) return `${trimmed}.smal`;

    return trimmed.slice(0, -ext.length) + '.smal';
}

function decodeProjectBuffer(buffer: Buffer): string {
    if (buffer.length >= 2) {
        // UTF-16 LE BOM
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            return buffer.slice(2).toString('utf16le');
        }

        // UTF-16 BE BOM
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            const be = buffer.slice(2);
            const le = Buffer.from(be);
            for (let i = 0; i + 1 < le.length; i += 2) {
                const tmp = le[i];
                le[i] = le[i + 1];
                le[i + 1] = tmp;
            }
            return le.toString('utf16le');
        }
    }

    // UTF-8 BOM
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return buffer.slice(3).toString('utf8');
    }

    const utf8 = buffer.toString('utf8');
    if (utf8.includes('\u0000')) {
        // Common fallback for old UTF-16 files without BOM
        return buffer.toString('utf16le');
    }

    return utf8;
}

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let pendingProjectPath: string | null = null;

const OPENABLE_EXTENSIONS = new Set(['.smal', '.json']);

type PopoutView =
    | 'impulsion'
    | 'gravedad'
    | 'normativa'
    | 'camaras'
    | 'resultados'
    | 'PROFILE_ROUTE'
    | 'PROFILE_ROUTE_GRAVITY';

type PopoutOpenPayload = {
    view: PopoutView;
    selection?: Record<string, unknown>;
    snapshotJson?: string;
    analysisSnapshotJson?: string;
};

type ProjectSnapshotPayload = {
    snapshotJson: string;
    sourceWindowId: string;
};

type AnalysisSnapshotPayload = {
    snapshotJson: string;
    sourceWindowId: string;
};

type PopoutBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type PopoutLayoutEntry = {
    view: PopoutView;
    selection: Record<string, unknown> | null;
    bounds: PopoutBounds;
    isMaximized: boolean;
};

type PopoutLayoutFileData = {
    popouts: PopoutLayoutEntry[];
    restoreOnStartup: boolean;
};

type PopoutWindowMeta = {
    view: PopoutView;
    selection: Record<string, unknown> | null;
};

const popoutWindows = new Map<string, BrowserWindow>();
const popoutWindowMeta = new Map<string, PopoutWindowMeta>();
let popoutSeq = 1;
let latestProjectSnapshotJson: string | null = null;
let latestAnalysisSnapshotJson: string | null = null;
let pendingPopoutLayout: PopoutLayoutEntry[] = [];
let popoutRestoreDone = false;
let shouldPersistPopoutLayout = true;
let persistPopoutLayoutTimer: NodeJS.Timeout | null = null;
let restorePopoutsOnStartup = true;

const POPOUT_LAYOUT_FILENAME = 'popout-layout.json';
const MAX_RESTORED_POPOUTS = 8;

const isPopoutView = (value: unknown): value is PopoutView => {
    return value === 'impulsion'
        || value === 'gravedad'
        || value === 'normativa'
        || value === 'camaras'
        || value === 'resultados'
        || value === 'PROFILE_ROUTE'
        || value === 'PROFILE_ROUTE_GRAVITY';
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value);
};

const normalizeSelection = (value: unknown): Record<string, unknown> | null => {
    return isRecord(value) ? value : null;
};

const toFiniteNumber = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

const normalizeBounds = (value: unknown): PopoutBounds | null => {
    if (!isRecord(value)) return null;

    const width = Math.max(760, Math.round(toFiniteNumber(value.width, 1400)));
    const height = Math.max(560, Math.round(toFiniteNumber(value.height, 900)));
    const x = Math.round(toFiniteNumber(value.x, 100));
    const y = Math.round(toFiniteNumber(value.y, 100));

    return { x, y, width, height };
};

function getPopoutLayoutPath() {
    return path.join(app.getPath('userData'), POPOUT_LAYOUT_FILENAME);
}

async function readPopoutLayoutFromDisk(): Promise<PopoutLayoutFileData> {
    const fallback: PopoutLayoutFileData = { popouts: [], restoreOnStartup: true };
    const layoutPath = getPopoutLayoutPath();
    try {
        const content = await fs.readFile(layoutPath, 'utf-8');
        const parsed = JSON.parse(content);
        const rawEntries = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed?.popouts) ? parsed.popouts : []);
        const restoreOnStartup = parsed && typeof parsed === 'object' && parsed.restoreOnStartup === false
            ? false
            : true;

        const normalized: PopoutLayoutEntry[] = [];
        rawEntries.forEach((entry: unknown) => {
            if (!isRecord(entry)) return;
            if (!isPopoutView(entry.view)) return;

            const bounds = normalizeBounds(entry.bounds);
            if (!bounds) return;

            normalized.push({
                view: entry.view,
                selection: normalizeSelection(entry.selection),
                bounds,
                isMaximized: entry.isMaximized === true
            });
        });

        return {
            popouts: normalized,
            restoreOnStartup
        };
    } catch {
        return fallback;
    }
}

async function writePopoutLayoutToDisk(entries: PopoutLayoutEntry[]) {
    const layoutPath = getPopoutLayoutPath();
    const payload = JSON.stringify({ version: 1, restoreOnStartup: restorePopoutsOnStartup, popouts: entries }, null, 2);
    try {
        await fs.writeFile(layoutPath, payload, 'utf-8');
    } catch (error) {
        console.warn('[popout:layout] No se pudo guardar layout.', error);
    }
}

function writePopoutLayoutToDiskSync(entries: PopoutLayoutEntry[]) {
    const layoutPath = getPopoutLayoutPath();
    const payload = JSON.stringify({ version: 1, restoreOnStartup: restorePopoutsOnStartup, popouts: entries }, null, 2);
    try {
        fsSync.writeFileSync(layoutPath, payload, 'utf-8');
    } catch (error) {
        console.warn('[popout:layout] No se pudo guardar layout (sync).', error);
    }
}

function collectPopoutLayoutEntries(): PopoutLayoutEntry[] {
    const entries: PopoutLayoutEntry[] = [];

    for (const [id, w] of popoutWindows.entries()) {
        if (w.isDestroyed()) continue;

        const meta = popoutWindowMeta.get(id);
        if (!meta) continue;

        const rawBounds = w.isMaximized() ? w.getNormalBounds() : w.getBounds();
        const bounds = normalizeBounds(rawBounds);
        if (!bounds) continue;

        entries.push({
            view: meta.view,
            selection: meta.selection,
            bounds,
            isMaximized: w.isMaximized()
        });
    }

    return entries;
}

function schedulePopoutLayoutPersist() {
    if (!shouldPersistPopoutLayout) return;

    if (persistPopoutLayoutTimer) {
        clearTimeout(persistPopoutLayoutTimer);
    }

    persistPopoutLayoutTimer = setTimeout(() => {
        persistPopoutLayoutTimer = null;
        void writePopoutLayoutToDisk(collectPopoutLayoutEntries());
    }, 220);
}

function bindPopoutLayoutPersistence(w: BrowserWindow) {
    w.on('move', schedulePopoutLayoutPersist);
    w.on('resize', schedulePopoutLayoutPersist);
    w.on('maximize', schedulePopoutLayoutPersist);
    w.on('unmaximize', schedulePopoutLayoutPersist);
}

function buildWindowTarget(params: Record<string, string>): string | { file: string; query: Record<string, string> } {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
        const usp = new URLSearchParams(params);
        return `${devServerUrl}?${usp.toString()}`;
    }

    return {
        file: path.join(__dirname, '../dist/index.html'),
        query: params
    };
}

function sendProjectSnapshot(target: BrowserWindow, snapshotJson: string, sourceWindowId: string) {
    if (target.isDestroyed()) return;
    target.webContents.send('project:snapshot', {
        snapshotJson,
        sourceWindowId,
        ts: Date.now()
    });
}

function sendAnalysisSnapshot(target: BrowserWindow, snapshotJson: string, sourceWindowId: string) {
    if (target.isDestroyed()) return;
    target.webContents.send('analysis:snapshot', {
        snapshotJson,
        sourceWindowId,
        ts: Date.now()
    });
}

async function openPopoutWindow(
    payload: PopoutOpenPayload,
    options?: { bounds?: PopoutBounds | null; isMaximized?: boolean }
): Promise<{ windowId: string }> {
    const view: PopoutView = isPopoutView(payload?.view) ? payload.view : 'resultados';
    const selection = normalizeSelection(payload?.selection);

    if (typeof payload?.snapshotJson === 'string' && payload.snapshotJson.length > 0) {
        latestProjectSnapshotJson = payload.snapshotJson;
    }

    if (typeof payload?.analysisSnapshotJson === 'string') {
        latestAnalysisSnapshotJson = payload.analysisSnapshotJson;
    }

    const id = `popout-${popoutSeq++}`;

    const bounds = normalizeBounds(options?.bounds || null);
    const w = new BrowserWindow({
        x: bounds?.x,
        y: bounds?.y,
        width: bounds?.width || 1400,
        height: bounds?.height || 900,
        resizable: true,
        movable: true,
        autoHideMenuBar: true,
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    popoutWindows.set(id, w);
    popoutWindowMeta.set(id, { view, selection });
    bindPopoutLayoutPersistence(w);

    const params: Record<string, string> = {
        windowId: id,
        popout: '1',
        view
    };

    const selectionSubTab = selection && typeof selection.subtab === 'string'
        ? selection.subtab
        : undefined;
    if (selectionSubTab) {
        params.subtab = selectionSubTab;
    }

    const target = buildWindowTarget(params);

    if (typeof target === 'string') {
        await w.loadURL(target);
    } else {
        await w.loadFile(target.file, { query: target.query });
    }

    if (options?.isMaximized) {
        w.maximize();
    }

    w.once('closed', () => {
        popoutWindows.delete(id);
        popoutWindowMeta.delete(id);
        schedulePopoutLayoutPersist();
    });

    w.webContents.once('did-finish-load', () => {
        if (latestProjectSnapshotJson) {
            sendProjectSnapshot(w, latestProjectSnapshotJson, 'main');
        }

        if (latestAnalysisSnapshotJson) {
            sendAnalysisSnapshot(w, latestAnalysisSnapshotJson, 'main');
        }

        w.webContents.send('popout:init', {
            windowId: id,
            view,
            selection
        });
    });

    schedulePopoutLayoutPersist();
    return { windowId: id };
}

async function restorePopoutsFromLayout() {
    if (popoutRestoreDone) return;
    popoutRestoreDone = true;

    if (!restorePopoutsOnStartup) return;
    if (pendingPopoutLayout.length === 0) return;

    const restoreQueue = pendingPopoutLayout.slice(0, MAX_RESTORED_POPOUTS);
    shouldPersistPopoutLayout = false;

    try {
        for (const entry of restoreQueue) {
            await openPopoutWindow(
                {
                    view: entry.view,
                    selection: entry.selection || undefined
                },
                {
                    bounds: entry.bounds,
                    isMaximized: entry.isMaximized
                }
            );
        }
    } catch (error) {
        console.warn('[popout:layout] No se pudo restaurar layout completo.', error);
    } finally {
        shouldPersistPopoutLayout = true;
        schedulePopoutLayoutPersist();
    }
}

function resolveProjectPathFromArgs(args: string[]): string | null {
    for (const rawArg of args) {
        if (typeof rawArg !== 'string') continue;
        const normalizedArg = rawArg.trim().replace(/^"+|"+$/g, '');
        if (!normalizedArg) continue;

        const ext = path.extname(normalizedArg).toLowerCase();
        if (!OPENABLE_EXTENSIONS.has(ext)) continue;

        return normalizedArg;
    }

    return null;
}

function flushPendingProjectOpen() {
    if (!pendingProjectPath || !mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
    const projectPath = pendingProjectPath;
    pendingProjectPath = null;
    mainWindow.webContents.send('open-project-from-file', projectPath);
}

function openProject(projectPath: string) {
    if (!projectPath) return;
    pendingProjectPath = projectPath;
    flushPendingProjectOpen();
}

// Determine icon path based on environment
const iconPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../public/icon.png')
    : path.join(__dirname, '../dist/icon.png');

function createSplashWindow(onSplashShown?: () => void) {
    let bootStarted = false;
    const startBoot = () => {
        if (bootStarted) return;
        bootStarted = true;
        if (onSplashShown) onSplashShown();
    };

    splashWindow = new BrowserWindow({
        width: 500,
        height: 300,
        show: false,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        splashWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/splash.html`);
    } else {
        splashWindow.loadFile(path.join(__dirname, '../dist/splash.html'));
    }

    splashWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.show();
            splashWindow.focus();
        }
        startBoot();
    });

    setTimeout(startBoot, 1500);

    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

function createMainWindow() {
    rendererReady = false;
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1200,
        minHeight: 760,
        show: false, // Hidden initially
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        autoHideMenuBar: true,
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?windowId=main`);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            query: { windowId: 'main' }
        });
    }

    mainWindow.maximize();

    // Handle window close with confirmation
    mainWindow.on('close', (e) => {
        if (mainWindow) {
            e.preventDefault();
            mainWindow.webContents.send('window:check-unsaved-changes');
        }
    });

    mainWindow.on('closed', () => {
        rendererReady = false;
        mainWindow = null;
    });
}

ipcMain.on('app:loading-progress', (_, data) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('app:loading-progress', data);
    }
});

ipcMain.on('app:ready', () => {
    rendererReady = true;
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }
    flushPendingProjectOpen();
    void restorePopoutsFromLayout();
});

ipcMain.handle('file:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'SMCALC Projects', extensions: ['smal'] },
            { name: 'Legacy JSON', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (canceled || filePaths.length === 0) {
        return null;
    }

    try {
        const rawBuffer = await fs.readFile(filePaths[0]);
        const content = decodeProjectBuffer(rawBuffer);
        return { path: filePaths[0], content };
    } catch (error) {
        console.warn('[file:open] Non-fatal read error while opening.', error);
        return { path: filePaths[0], content: '{}' };
    }
});

ipcMain.handle('file:load', async (_, filePath: string) => {
    try {
        const rawBuffer = await fs.readFile(filePath);
        const content = decodeProjectBuffer(rawBuffer);
        return { path: filePath, content };
    } catch (error) {
        console.warn('[file:load] Non-fatal read error. Returning safe fallback.', error);
        return { path: filePath, content: '{}' };
    }
});

ipcMain.handle('file:save', async (_, { path, content }) => {
    await fs.writeFile(path, content, 'utf-8');
    return true;
});

ipcMain.handle('file:save-as', async (_, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: 'proyecto.smal',
        filters: [{ name: 'SMCALC Projects', extensions: ['smal'] }]
    });
    if (canceled || !filePath) {
        return null;
    }

    const normalizedPath = ensureSmalExtension(filePath);
    if (normalizedPath !== filePath) {
        console.warn(`[file:save-as] Extension normalizada automáticamente a .smal: ${normalizedPath}`);
    }

    await fs.writeFile(normalizedPath, content, 'utf-8');
    return normalizedPath;
});

ipcMain.handle('popout:open', async (_evt, payload: PopoutOpenPayload) => {
    return openPopoutWindow(payload);
});

ipcMain.handle('popout:close', async (_evt, windowId: string) => {
    const windowToClose = popoutWindows.get(windowId);
    if (windowToClose && !windowToClose.isDestroyed()) {
        windowToClose.close();
    }
    return true;
});

ipcMain.handle('popout:closeAll', async () => {
    const windows = Array.from(popoutWindows.values());
    shouldPersistPopoutLayout = false;

    try {
        for (const w of windows) {
            if (!w.isDestroyed()) {
                w.close();
            }
        }

        popoutWindows.clear();
        popoutWindowMeta.clear();
        await writePopoutLayoutToDisk([]);
    } finally {
        shouldPersistPopoutLayout = true;
    }

    return true;
});

ipcMain.handle('popout:list', async () => {
    return Array.from(popoutWindows.keys());
});

ipcMain.handle('popout:getInit', async (_evt, windowId: string) => {
    if (typeof windowId !== 'string' || !windowId) return null;
    const meta = popoutWindowMeta.get(windowId);
    if (!meta) return null;

    return {
        windowId,
        view: meta.view,
        selection: meta.selection
    };
});

ipcMain.handle('popout:getRestoreOnStartup', async () => {
    return restorePopoutsOnStartup;
});

ipcMain.handle('popout:setRestoreOnStartup', async (_evt, enabled: boolean) => {
    restorePopoutsOnStartup = enabled !== false;
    await writePopoutLayoutToDisk(collectPopoutLayoutEntries());
    return restorePopoutsOnStartup;
});

ipcMain.on('project:snapshot', (_evt, payload: ProjectSnapshotPayload) => {
    if (!payload || typeof payload.snapshotJson !== 'string' || payload.snapshotJson.length === 0) {
        return;
    }

    const sourceWindowId = typeof payload.sourceWindowId === 'string' && payload.sourceWindowId
        ? payload.sourceWindowId
        : 'main';

    latestProjectSnapshotJson = payload.snapshotJson;

    for (const [id, w] of popoutWindows.entries()) {
        if (id === sourceWindowId || w.isDestroyed()) continue;
        sendProjectSnapshot(w, payload.snapshotJson, sourceWindowId);
    }

    if (mainWindow && !mainWindow.isDestroyed() && sourceWindowId !== 'main') {
        sendProjectSnapshot(mainWindow, payload.snapshotJson, sourceWindowId);
    }
});

ipcMain.handle('project:getLatestSnapshot', async () => {
    return latestProjectSnapshotJson;
});

ipcMain.on('analysis:snapshot', (_evt, payload: AnalysisSnapshotPayload) => {
    if (!payload || typeof payload.snapshotJson !== 'string') {
        return;
    }

    const sourceWindowId = typeof payload.sourceWindowId === 'string' && payload.sourceWindowId
        ? payload.sourceWindowId
        : 'main';

    latestAnalysisSnapshotJson = payload.snapshotJson;

    for (const [id, w] of popoutWindows.entries()) {
        if (id === sourceWindowId || w.isDestroyed()) continue;
        sendAnalysisSnapshot(w, payload.snapshotJson, sourceWindowId);
    }

    if (mainWindow && !mainWindow.isDestroyed() && sourceWindowId !== 'main') {
        sendAnalysisSnapshot(mainWindow, payload.snapshotJson, sourceWindowId);
    }
});

ipcMain.handle('analysis:getLatestSnapshot', async () => {
    return latestAnalysisSnapshotJson;
});

ipcMain.handle('app:exit', () => {
    app.quit();
});

// Handle unsaved changes response from renderer
ipcMain.on('window:unsaved-changes-response', async (_, hasChanges: boolean) => {
    if (!mainWindow) return;

    if (hasChanges) {
        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Guardar y cerrar', 'Cerrar sin guardar', 'Cancelar'],
            defaultId: 0,
            cancelId: 2,
            title: 'Cambios sin guardar',
            message: 'El proyecto tiene cambios sin guardar.',
            detail: '¿Desea guardar antes de cerrar?'
        });

        if (choice === 0) {
            // Save and close
            mainWindow.webContents.send('window:save-and-close');
        } else if (choice === 1) {
            // Close without saving
            mainWindow.destroy();
            app.quit();
        }
        // choice === 2: Cancel (do nothing)
    } else {
        // No changes, close directly
        mainWindow.destroy();
        app.quit();
    }
});

// Handle save completion from renderer
ipcMain.on('window:save-completed', () => {
    if (mainWindow) {
        mainWindow.destroy();
        app.quit();
    }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (_, commandLine) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }

        const projectPath = resolveProjectPathFromArgs(commandLine);
        if (projectPath) {
            openProject(projectPath);
        }
    });

    app.whenReady().then(async () => {
        const layoutData = await readPopoutLayoutFromDisk();
        pendingPopoutLayout = layoutData.popouts;
        restorePopoutsOnStartup = layoutData.restoreOnStartup;

        const startupProjectPath = resolveProjectPathFromArgs(process.argv);
        if (startupProjectPath) {
            pendingProjectPath = startupProjectPath;
        }

        createSplashWindow(() => {
            if (!mainWindow) {
                createMainWindow();
            }
        });
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (persistPopoutLayoutTimer) {
        clearTimeout(persistPopoutLayoutTimer);
        persistPopoutLayoutTimer = null;
    }

    writePopoutLayoutToDiskSync(collectPopoutLayoutEntries());
    shouldPersistPopoutLayout = false;
});

