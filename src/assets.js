// Asset path hook. The normal build serves textures/ and audio/ next to the page; the offline build
// (scripts/build-offline.mjs) embeds them in the HTML as data URIs under window.__ASSETS so the game
// runs from a single file with no server and no network.
export const asset = (path) => (globalThis.__ASSETS && globalThis.__ASSETS[path]) || path;
