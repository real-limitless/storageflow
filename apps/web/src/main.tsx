import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "@/router";
import "@/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");
createRoot(root).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
