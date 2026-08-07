import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DialogProvider } from './components/DialogProvider.jsx'
import './pages/MobileApp.css'
import './pages/Orders.mobile.css'
import './pages/Customers.mobile.css'
import './pages/Shipping.mobile.css'
import './pages/Products.mobile.css'
import './pages/Suppliers.mobile.css'

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("ERP app install support could not be registered.", error);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
)
