// Runtime configuration, read by the page before the bundle loads.
//
// The container rewrites this file at startup from its environment, so a
// deployment can point players at its own relay without the bundle being
// rebuilt. null means "work it out from where the page was served", which is
// what you want when running locally.
window.SKETCHBOOK_CONFIG = { partyServer: null };
