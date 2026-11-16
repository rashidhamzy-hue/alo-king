// SR1: the reading step for search lives in packages/search (pure code, no dependency), so the website reads its search box with the very
// same function as the chat (invariant 19) without importing agent code; the agents import it from here.
export * from "@ak/search/reading";
