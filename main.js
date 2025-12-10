const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const profilesPath = path.join(__dirname, 'profiles.json');
let profiles = [];
const connectionProcesses = new Map();
const vpnStatus = new Map();

function generateProfileId() {
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function ensureProfilesFile() {
  if (!fs.existsSync(profilesPath)) {
    const defaultProfiles = [
      {
        id: generateProfileId(),
        name: 'Serveur Maison',
        configPath: 'C\\\\vpn\\\\maison.conf',
      },
    ];
    fs.writeFileSync(profilesPath, JSON.stringify(defaultProfiles, null, 2), 'utf-8');
  }
}

function loadProfiles() {
  try {
    const raw = fs.readFileSync(profilesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    vpnStatus.clear();
    profiles = Array.isArray(parsed)
      ? parsed.map((profile) => {
          const id = profile.id || generateProfileId();
          const status = profile.status || 'disconnected';
          vpnStatus.set(id, status);
          return {
            id,
            name: profile.name,
            configPath: profile.configPath,
            status,
          };
        })
      : [];
    const shouldPersistIds = Array.isArray(parsed) && parsed.some((profile) => !profile.id);
    if (shouldPersistIds) {
      saveProfiles();
    }
  } catch (error) {
    console.error('Erreur lors du chargement des profils', error);
    profiles = [];
  }
}

function saveProfiles() {
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
}

function initializeVpnStatus() {
  profiles.forEach((profile) => {
    if (!vpnStatus.has(profile.id)) {
      vpnStatus.set(profile.id, profile.status || 'disconnected');
    }
  });
}

function getProfilesWithId() {
  return profiles.map((profile) => ({
    ...profile,
    status: vpnStatus.get(profile.id) || 'disconnected',
  }));
}

function findProfileIndex(profileId) {
  return profiles.findIndex((profile) => profile.id === profileId);
}

function setVpnStatus(profileId, status) {
  vpnStatus.set(profileId, status);
  const index = findProfileIndex(profileId);
  if (index !== -1) {
    profiles[index].status = status;
    saveProfiles();
  }
}

function runWgQuick(action, profileId) {
  const profileIndex = findProfileIndex(profileId);
  const profile = profiles[profileIndex];
  if (!profile) {
    return Promise.resolve({ success: false, message: 'Profil introuvable' });
  }

  return new Promise((resolve) => {
    const processOutput = [];
    const command = spawn('wg-quick', [action, profile.configPath]);
    connectionProcesses.set(profileId, command);

    command.stdout?.on('data', (data) => processOutput.push(data.toString()));
    command.stderr?.on('data', (data) => processOutput.push(data.toString()));

    command.on('error', (err) => {
      connectionProcesses.delete(profileId);
      setVpnStatus(profileId, 'error');
      if (err.code === 'ENOENT') {
        resolve({
          success: false,
          message:
            "La commande wg-quick est introuvable. Vérifiez que WireGuard est installé et accessible dans le PATH Windows.",
        });
        return;
      }
      resolve({ success: false, message: err.message });
    });

    command.on('close', (code) => {
      connectionProcesses.delete(profileId);
      if (code === 0) {
        const newStatus = action === 'up' ? 'connected' : 'disconnected';
        setVpnStatus(profileId, newStatus);
        resolve({ success: true });
      } else {
        setVpnStatus(profileId, 'error');
        const output = processOutput.join('\n').trim();
        resolve({ success: false, message: output || `wg-quick a retourné le code ${code}` });
      }
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
  const name = profile?.name?.trim();
  const configPath = profile?.configPath?.trim();

  if (!name || !configPath) {
    dialog.showErrorBox('Profil invalide', 'Le nom et le chemin du fichier .conf sont requis.');
    return getProfilesWithId();
  }

  const newProfile = {
    id: generateProfileId(),
    name,
    configPath,
    status: 'disconnected',
  };

  profiles.push(newProfile);
  vpnStatus.set(newProfile.id, 'disconnected');
  saveProfiles();
  return getProfilesWithId();
});

ipcMain.handle('profiles:delete', async (_event, profileId) => {
  const index = findProfileIndex(profileId);
  if (index === -1) {
    return getProfilesWithId();
  }

  const process = connectionProcesses.get(profileId);
  if (process) {
    process.kill();
    connectionProcesses.delete(profileId);
  }

  profiles.splice(index, 1);
  vpnStatus.delete(profileId);
  saveProfiles();
  return getProfilesWithId();
});

ipcMain.handle('vpn:getStatus', async () => {
  const status = {};
  profiles.forEach((profile) => {
    status[profile.id] = vpnStatus.get(profile.id) || 'disconnected';
  });
  return status;
});

ipcMain.handle('vpn:connect', async (_event, profileId) => {
  const profileIndex = findProfileIndex(profileId);
  const profile = profiles[profileIndex];
  if (!profile) {
    return { success: false, message: 'Profil introuvable' };
  }
  if (connectionProcesses.has(profileId)) {
    return { success: false, message: 'Une opération est déjà en cours pour ce profil' };
  }
  if (!profile.configPath) {
    return { success: false, message: 'Le profil ne contient pas de chemin de configuration WireGuard.' };
  }
  const currentStatus = vpnStatus.get(profileId) || 'disconnected';
  if (currentStatus === 'connected' || currentStatus === 'connecting') {
    return { success: false, message: 'Le profil est déjà connecté ou en cours de connexion' };
  }
  setVpnStatus(profileId, 'connecting');
  return runWgQuick('up', profileId);
});

ipcMain.handle('vpn:disconnect', async (_event, profileId) => {
  const profileIndex = findProfileIndex(profileId);
  const profile = profiles[profileIndex];
  if (!profile) {
    return { success: false, message: 'Profil introuvable' };
  }
  if (connectionProcesses.has(profileId)) {
    return { success: false, message: 'Une opération est déjà en cours pour ce profil' };
  }
  if (!profile.configPath) {
    return { success: false, message: 'Le profil ne contient pas de chemin de configuration WireGuard.' };
  }
  const currentStatus = vpnStatus.get(profileId) || 'disconnected';
  if (currentStatus === 'disconnected') {
    return { success: false, message: 'Le profil est déjà déconnecté' };
  }
  setVpnStatus(profileId, 'connecting');
  return runWgQuick('down', profileId);
});

app.whenReady().then(() => {
  ensureProfilesFile();
  loadProfiles();
  initializeVpnStatus();
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
