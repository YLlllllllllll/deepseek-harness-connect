const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('remoteServers',{
  request:(method,args)=>ipcRenderer.invoke('servers:request',method,args),
});
