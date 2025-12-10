const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vpnApi', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  addProfile: (profile) => ipcRenderer.invoke('profiles:add', profile),
  deleteProfile: (profileId) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (profileId) => ipcRenderer.invoke('vpn:connect', profileId),
  disconnect: (profileId) => ipcRenderer.invoke('vpn:disconnect', profileId),
  getStatus: () => ipcRenderer.invoke('vpn:getStatus'),
  getLogs: () => ipcRenderer.invoke('vpn:getLogs'),
  clearLogs: () => ipcRenderer.invoke('vpn:clearLogs'),
});
