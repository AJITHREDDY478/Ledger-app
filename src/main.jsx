import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const rootStyles = getComputedStyle(document.documentElement)
const themeColor = rootStyles.getPropertyValue('--bg')?.trim() || '#f3f5f7'

const themeMetaTags = document.querySelectorAll('meta[name="theme-color"]')
themeMetaTags.forEach((metaTag) => {
  metaTag.setAttribute('content', themeColor)
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
