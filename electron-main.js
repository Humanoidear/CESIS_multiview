import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let serverProcess;

const PORT = process.env.PORT || 8080;

function createWindow() {
    const iconPath = join(__dirname, 'build', 'icon.png');

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        },
        backgroundColor: '#050505',
        title: 'CESIS Multiview',
        icon: iconPath
    });

    // Load the app
    mainWindow.loadURL(`http://localhost:${PORT}`);

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startServer() {
    return new Promise((resolve, reject) => {
        // Start the Express server as a child process
        serverProcess = spawn('node', ['index.js'], {
            cwd: __dirname,
            stdio: 'inherit',
            env: { ...process.env }
        });

        serverProcess.on('error', (err) => {
            console.error('Failed to start server:', err);
            reject(err);
        });

        // Wait a bit for the server to start
        setTimeout(() => {
            resolve();
        }, 2000);
    });
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}

app.whenReady().then(async () => {
    try {
        await startServer();
        createWindow();
    } catch (err) {
        console.error('Failed to start application:', err);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopServer();
});
