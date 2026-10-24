import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

export const mount = (target: HTMLElement) => {
  const root = createRoot(target);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return () => root.unmount();
};
