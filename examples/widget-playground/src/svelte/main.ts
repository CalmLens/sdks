import { mount as mountSvelte, unmount } from "svelte";
import App from "./App.svelte";

export const mount = (target: HTMLElement) => {
  const app = mountSvelte(App, { target });
  return () => {
    void unmount(app);
  };
};
