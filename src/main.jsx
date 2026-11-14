import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { initPullToRefresh } from "./pullToRefresh.js";

try { initPullToRefresh(); } catch (e) {}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
