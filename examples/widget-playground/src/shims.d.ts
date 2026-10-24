// The shell imports each demo; vue-tsc and svelte-check type-check the components themselves.
declare module "*.vue" {
  const component: import("vue").Component;
  export default component;
}
declare module "*.svelte" {
  const component: import("svelte").Component;
  export default component;
}
