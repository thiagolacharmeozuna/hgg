const { contextBridge, ipcRenderer, webUtils } = require('electron');
let last = [];
document.addEventListener('drop', e => {
  last = [...((e.dataTransfer && e.dataTransfer.files) || [])].map(f => { try { return webUtils.getPathForFile(f); } catch { return ''; } }).filter(Boolean);
}, true);
const inv = c => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  data: inv('data'), save: inv('save'), findCover: inv('findCover'), pickFile: inv('pickFile'), copyImg: inv('copyImg'),
  steamScan: inv('steamScan'), launch: inv('launch'), quit: inv('quit'), lastDrop: () => last.slice()
});
