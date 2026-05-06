// Loaded by panel/index.html. Inline scripts are blocked by the default
// nodal-plugin:// CSP — keep the JS in this sibling file.

const valueEl = document.getElementById('value')
const unitEl = document.getElementById('unit')
const tsEl = document.getElementById('ts')
const btn = document.getElementById('measure')

function render(reading) {
  if (!reading || typeof reading !== 'object') return
  valueEl.textContent = String(reading.value)
  unitEl.textContent = reading.unit
  tsEl.textContent = new Date(reading.timestamp).toLocaleTimeString()
}

// Plugin → panel: live ticks pushed every second from activate().
window.nodalcore?.onMessage(render)

// Panel → plugin: explicit measurement on demand.
btn.addEventListener('click', async () => {
  try {
    const r = await window.nodalcore?.postMessage({ type: 'measure' })
    render(r)
  } catch (err) {
    tsEl.textContent = 'measure failed: ' + err.message
  }
})
