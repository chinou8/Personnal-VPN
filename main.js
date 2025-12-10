const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const profilesPath = path.join(__dirname, 'profiles.json');
let profiles = [];
const connectionProcesses = new Map();

function ensureProfilesFile() {
  if (!fs.existsSync(profilesPath)) {
    const defaultProfiles = [
      {
        name: 'Serveur Maison',
        configPath: 'C\\\\vpn\\\\maison.conf',
        status: 'disconnected',
      },
    ];
    fs.writeFileSync(profilesPath, JSON.stringify(defaultProfiles, null, 2), 'utf-8');
  }
}

function loadProfiles() {
  try {
    const raw = fs.readFileSync(profilesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    profiles = Array.isArray(parsed)
      ? parsed.map((profile) => ({
          name: profile.name,
          configPath: profile.configPath,
          status: profile.status || 'disconnected',
        }))
      : [];
  } catch (error) {
    console.error('Erreur lors du chargement des profils', error);
    profiles = [];
  }
}

function saveProfiles() {
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
}

function getProfilesWithId() {
  return profiles.map((profile, index) => ({ id: index, ...profile }));
}

function updateProfileStatus(index, status) {
  if (profiles[index]) {
    profiles[index].status = status;
    saveProfiles();
  }
}

function runWgQuick(action, profileId) {
  const profile = profiles[profileId];
  if (!profile) {
    return Promise.resolve({ success: false, message: 'Profil introuvable' });
  }

  return new Promise((resolve) => {
    const process = spawn('wg-quick', [action, profile.configPath]);
    connectionProcesses.set(profileId, process);

    process.on('exit', (code) => {
      connectionProcesses.delete(profileId);
      if (code === 0) {
        const newStatus = action === 'up' ? 'connected' : 'disconnected';
        updateProfileStatus(profileId, newStatus);
        resolve({ success: true });
      } else {
        updateProfileStatus(profileId, 'error');
        resolve({ success: false, message: `wg-quick a retourné le code ${code}` });
      }
    });

    process.on('error', (err) => {
      connectionProcesses.delete(profileId);
      updateProfileStatus(profileId, 'error');
      resolve({ success: false, message: err.message });
    });
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
}

function createAppMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [{ role: 'toggleDevTools', label: 'Outils de développement' }],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos de Personnal-VPN',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'À propos',
              message: 'Personnal-VPN',
              detail:
                'Personnal-VPN est un client VPN personnel construit avec Electron et piloté par WireGuard pour des connexions sécurisées.',
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

ipcMain.handle('profiles:list', async () => {
  return getProfilesWithId();
});

ipcMain.handle('profiles:add', async (_event, profile) => {
  if (!profile || !profile.name || !profile.configPath) {
    dialog.showErrorBox('Profil invalide', 'Le nom et le chemin du fichier .conf sont requis.');
    return getProfilesWithId();
  }

  profiles.push({
    name: profile.name,
    configPath: profile.configPath,
    status: 'disconnected',
  });
  saveProfiles();
  return getProfilesWithId();
});

ipcMain.handle('vpn:getStatus', async () => {
  return getProfilesWithId();
});

ipcMain.handle('vpn:connect', async (_event, profileId) => {
  const profile = profiles[profileId];
  if (!profile) {
    return { success: false, message: 'Profil introuvable' };
  }
  if (connectionProcesses.has(profileId)) {
    return { success: false, message: 'Une opération est déjà en cours pour ce profil' };
  }
  if (profile.status === 'connected') {
    return { success: false, message: 'Le profil est déjà connecté' };
  }
  updateProfileStatus(profileId, 'connecting');
  return runWgQuick('up', profileId);
});

ipcMain.handle('vpn:disconnect', async (_event, profileId) => {
  const profile = profiles[profileId];
  if (!profile) {
    return { success: false, message: 'Profil introuvable' };
  }
  if (connectionProcesses.has(profileId)) {
    return { success: false, message: 'Une opération est déjà en cours pour ce profil' };
  }
  if (profile.status === 'disconnected') {
    return { success: false, message: 'Le profil est déjà déconnecté' };
  }
  updateProfileStatus(profileId, 'disconnecting');
  return runWgQuick('down', profileId);
});

app.whenReady().then(() => {
  ensureProfilesFile();
  loadProfiles();
  Menu.setApplicationMenu(createAppMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
