const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesApi", Object.freeze({
  list: () => ipcRenderer.invoke("notes:list"),
  create: title => ipcRenderer.invoke("notes:create", title),
  save: note => ipcRenderer.invoke("notes:save", note),
  delete: id => ipcRenderer.invoke("notes:delete", id),
  import: () => ipcRenderer.invoke("notes:import"),
  export: note => ipcRenderer.invoke("notes:export", note),
}));
