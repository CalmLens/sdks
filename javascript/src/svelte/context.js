// The upload options `setCalmLensContext` gives every `CalmLensUploader` beneath a component.

import { getContext, setContext } from "svelte";
import { withProvidedOptions } from "../ui.js";

const KEY = Symbol("calmlens");

/**
 * Gives every `CalmLensUploader` in this component's descendants these upload options, such as
 * `uploadPresetId` and `tokenUrl`, so they needn't be passed to each one. Call it while the
 * component initialises. An option an uploader sets itself wins, and a nested call adds to the
 * outer one's options.
 *
 * @param {import("../ui.js").CalmLensProvidedOptions} options
 */
export const setCalmLensContext = (options) => {
  setContext(KEY, withProvidedOptions(getContext(KEY), options));
};

/** The options the nearest `setCalmLensContext` gave, if any. */
export const getCalmLensContext = () => getContext(KEY);
