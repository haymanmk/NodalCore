import { createRoot } from 'react-dom/client'
import { App } from '@nodalcore/renderer'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
