import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppPMT from './pmt/AppPMT.jsx'
import AppDTF from './AppDTF.jsx'
import AppTest from './test/AppTest.jsx'

// Routage simple basé sur le pathname
const path = window.location.pathname;
const pages = {
  '/dtf': AppDTF,
  '/test': AppTest,
};
const PageComponent = pages[path] || AppPMT;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PageComponent />
  </StrictMode>,
)
