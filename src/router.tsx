import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { initSentry } from "./lib/sentry";

export const getRouter = () => {
  initSentry();
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
