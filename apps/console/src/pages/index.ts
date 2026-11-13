// Every console section, in menu order. Each owns its routes and the roles that may use them.
import type { Section } from "../app";
import { todaySection } from "./today";

export const registry: Section[] = [todaySection];
