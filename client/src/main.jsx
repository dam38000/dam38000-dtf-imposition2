import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AppDTF from './AppDTF.jsx'
import AppTest from './AppTest.jsx'

// Routage simple basé sur le pathname
const path = window.location.pathname;
const pages = {
  '/dtf': AppDTF,
  '/test': AppTest,
};
const PageComponent = pages[path] || App;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PageComponent />
  </StrictMode>,
)
