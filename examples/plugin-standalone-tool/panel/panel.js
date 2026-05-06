// Loaded by panel/index.html. Inline scripts are blocked by the default
// nodal-plugin:// CSP — keep the JS in this sibling file.

document.getElementById('origin').textContent = location.origin
document.getElementById('ts').textContent = new Date().toLocaleTimeString()

window.nodalcore?.onMessage((data) => {
  // No-op for now — example just demonstrates the receive-only path.
  console.log('[panel] received', data)
})
