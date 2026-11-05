// hls.js's light build ships no declarations of its own; it has the full build's API.
declare module "hls.js/light" {
  export { default } from "hls.js";
}
