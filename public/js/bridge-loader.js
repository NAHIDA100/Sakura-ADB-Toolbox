// Load the browser HTTP bridge only when the Electron preload did not provide
// the IPC bridge. In Electron window.sakura already exists before page scripts.
if (!window.sakura) {
  document.write('<script src="js/web-bridge.js"><\/script>');
}
