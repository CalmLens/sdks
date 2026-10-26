---
"@calmlens/sdk": minor
---

Breaking: the UI components no longer add their stylesheet to the page at runtime. The React components render it with them, and React places it in the page's head once, including when rendering on the server, so React 19 or later is required. With Vue, Svelte or the web components, import `@calmlens/sdk/styles.css` once. `injectCalmLensStyles` is removed, and `unstyled` is now a React-only prop.
