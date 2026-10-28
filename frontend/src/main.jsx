/**
 * @file main.jsx
 * @description Application entry point.
 *
 * Bootstraps the React app by mounting it into the `#root` div defined in
 * index.html. The entire component tree is wrapped in two providers:
 *
 *  - React.StrictMode  — development-only wrapper that surfaces deprecated
 *                        API usage, unexpected side effects, and other
 *                        potential issues. Has zero runtime cost in production.
 *
 *  - BrowserRouter     — provides HTML5 history-based client-side routing to
 *                        all descendant components via react-router-dom.
 *                        Enables <Link>, <Route>, useNavigate, etc. throughout
 *                        the app without any additional setup.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Mount the app. `document.getElementById('root')` targets the single <div
// id="root"> in index.html — this is the standard Vite + React entry pattern.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);