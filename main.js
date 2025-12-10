const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const profilesPath = path.join(__dirname, 'profiles.json');
let profiles = [];
const connectionProcesses = new Map();
const vpnStatus = new Map();
const logs = [];
const MAX_LOGS = 200;

function addLog(level, message) {
  logs.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });

  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
}

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
          const status = 'disconnected';
          vpnStatus.set(id, status);
          return {
            id,
            name: profile.name,
            configPath: profile.configPath,
            status,
          };
        })
      : [];
    const shouldPersistIds = Array.isArray(parsed) && parsed.some((profile) => !profile.id || profile.status !== 'disconnected');
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

function runWgQuick(action, profile) {
  if (!profile) {
    return Promise.resolve({ ok: false, message: 'Profil introuvable', status: 'error' });
  }

  return new Promise((resolve) => {
    const processOutput = [];
    const profileLabel = profile.name || profile.id;
    const command = spawn('wg-quick', [action, profile.configPath]);
    const TIMEOUT_MS = 25000;
    let timedOut = false;
    let resolved = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      command.kill();
    }, TIMEOUT_MS);

    connectionProcesses.set(profile.id, command);

    command.stdout?.on('data', (data) => processOutput.push(data.toString()));
    command.stderr?.on('data', (data) => processOutput.push(data.toString()));

    command.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      connectionProcesses.delete(profile.id);
      setVpnStatus(profile.id, 'error');
      if (err.code === 'ENOENT') {
        const message =
          'La commande wg-quick est introuvable. Vérifie que WireGuard est installé et accessible dans le PATH.';
        addLog('error', `${message} (${profileLabel})`);
        resolve({ ok: false, message, status: 'error' });
        return;
      }
      const message = `Erreur lors de l\'exécution de wg-quick : ${err.message}`;
      addLog('error', message);
      resolve({ ok: false, message, status: 'error' });
    });

    command.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      connectionProcesses.delete(profile.id);

      if (timedOut) {
        const message = 'La connexion a expiré (timeout).';
        setVpnStatus(profile.id, 'error');
        addLog('error', `${message} (${profileLabel})`);
        resolve({ ok: false, message, status: 'error' });
        return;
      }

      if (code === 0) {
        const newStatus = action === 'up' ? 'connected' : 'disconnected';
        setVpnStatus(profile.id, newStatus);
        const message = action === 'up'
          ? `Connexion réussie pour ${profileLabel}.`
          : `Déconnexion réussie pour ${profileLabel}.`;
        addLog('info', message);
        resolve({ ok: true, message, status: newStatus });
      } else {
        setVpnStatus(profile.id, 'error');
        const output = processOutput.join('\n').trim();
        const message = output || `wg-quick a retourné le code ${code}`;
        addLog('error', `Échec wg-quick (${action}) pour ${profileLabel} : ${message}`);
        resolve({ ok: false, message, status: 'error' });
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
    return { ok: false, message: 'Profil introuvable', status: 'error' };
  }
  if (connectionProcesses.has(profileId)) {
    return { ok: false, message: 'Une opération est déjà en cours pour ce profil', status: vpnStatus.get(profileId) };
  }
  if (!profile.configPath) {
    return { ok: false, message: 'Le profil ne contient pas de chemin de configuration WireGuard.', status: 'error' };
  }
  const currentStatus = vpnStatus.get(profileId) || 'disconnected';
  if (currentStatus === 'connected' || currentStatus === 'connecting') {
    return { ok: false, message: 'Ce profil est déjà connecté ou en cours de connexion.', status: currentStatus };
  }

  setVpnStatus(profileId, 'connecting');
  addLog('info', `Tentative de connexion du profil ${profile.name}...`);
  const result = await runWgQuick('up', profile);
  return result;
});

ipcMain.handle('vpn:disconnect', async (_event, profileId) => {
  const profileIndex = findProfileIndex(profileId);
  const profile = profiles[profileIndex];
  if (!profile) {
    return { ok: false, message: 'Profil introuvable', status: 'error' };
  }
  if (connectionProcesses.has(profileId)) {
    return { ok: false, message: 'Une opération est déjà en cours pour ce profil', status: vpnStatus.get(profileId) };
  }
  if (!profile.configPath) {
    return { ok: false, message: 'Le profil ne contient pas de chemin de configuration WireGuard.', status: 'error' };
  }
  const currentStatus = vpnStatus.get(profileId) || 'disconnected';
  if (currentStatus !== 'connected') {
    return { ok: false, message: "Ce profil n'est pas connecté.", status: currentStatus };
  }

  setVpnStatus(profileId, 'connecting');
  addLog('info', `Tentative de déconnexion du profil ${profile.name}...`);
  const result = await runWgQuick('down', profile);
  return result;
});

ipcMain.handle('vpn:getLogs', async () => {
  addLog('info', "Rafraîchissement du journal demandé par l'utilisateur.");
  return logs;
});

ipcMain.handle('vpn:clearLogs', async () => {
  logs.length = 0;
  return logs;
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
