#!/usr/bin/env node
// Renders scripts/web/og.html to public/og-image.png (1200x630), the share image of every page.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(pathToFileURL(resolve("scripts/web/og.html")).href);
await p.waitForTimeout(500);
await p.screenshot({ path: "public/og-image.png" });
await b.close();
