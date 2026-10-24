import { createApp } from "vue";
import App from "./App.vue";

export const mount = (target: HTMLElement) => {
  const app = createApp(App);
  app.mount(target);
  return () => app.unmount();
};
