// Every console section, in menu order. Each owns its routes and the roles that may use them.
import type { Section } from "../app";
import { catalogSection } from "./catalog";
import { exceptionsSection } from "./exceptions";
import { paymentsSection } from "./payments";
import { returnsSection } from "./returns";
import { ridersSection } from "./riders";
import { todaySection } from "./today";

export const registry: Section[] = [todaySection, paymentsSection, ridersSection, exceptionsSection, returnsSection, catalogSection];
