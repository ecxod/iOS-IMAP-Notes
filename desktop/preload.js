const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesApi", Object.freeze({
  list: () => ipcRenderer.invoke("notes:list"),
  create: input => ipcRenderer.invoke("notes:create", input),
  save: note => ipcRenderer.invoke("notes:save", note),
  delete: id => ipcRenderer.invoke("notes:delete", id),
  sync: () => ipcRenderer.invoke("notes:sync"),
  import: () => ipcRenderer.invoke("notes:import"),
  export: note => ipcRenderer.invoke("notes:export", note),
  settings: Object.freeze({
    list: () => ipcRenderer.invoke("settings:list"),
    save: settings => ipcRenderer.invoke("settings:save", settings),
    test: account => ipcRenderer.invoke("settings:test", account),
  }),
  updates: Object.freeze({
    getState: () => ipcRenderer.invoke("updates:get-state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStateChange: callback => ipcRenderer.on("updates:state", (_event, state) => callback(state)),
  }),
}));
