import "@calmlens/sdk/styles.css";
import { mount } from "svelte";
import Demo from "./svelte/Demo.svelte";

mount(Demo, { target: document.getElementById("app") as HTMLElement });
