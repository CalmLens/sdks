import { afterEach, describe, expect, it } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import * as react from "../src/react";
import { BINDINGS, type Mounted } from "./bindings";

const SRC = "https://cdn.calmlens.com/v1/assets/proj_8fK2mQx7Lp4NvB3tRz9Y/asset_1";
const asset = { src: SRC, alt: "A cat" };
const STYLESHEET_RULE = ".calmlens-asset {";

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  for (const style of document.querySelectorAll("style")) style.remove();
});

const pageStyles = () =>
  [...document.querySelectorAll("style")].filter((style) =>
    style.textContent?.includes(STYLESHEET_RULE),
  );

describe("the components' stylesheet", () => {
  it("is in React's server HTML once, ahead of the asset, however many components render", () => {
    const html = renderToString(
      createElement(
        Fragment,
        null,
        createElement(react.CalmLensAsset, asset),
        createElement(react.CalmLensAsset, { ...asset, src: `${SRC}2` }),
      ),
    );
    expect(html.split(STYLESHEET_RULE)).toHaveLength(2);
    expect(html.indexOf(STYLESHEET_RULE)).toBeLessThan(html.indexOf("<figure"));
  });

  it("is left out of React's output when unstyled", () => {
    const html = renderToString(createElement(react.CalmLensAsset, { ...asset, unstyled: true }));
    expect(html).not.toContain(STYLESHEET_RULE);
  });

  for (const binding of BINDINGS.filter((candidate) => candidate.name !== "React"))
    it(`is never added to the page by the ${binding.name} binding`, async () => {
      mounted = binding.mountAsset({ ...asset, info: undefined });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(pageStyles()).toHaveLength(0);
    });
});
