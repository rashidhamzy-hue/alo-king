// Every console section, in menu order. Each owns its routes and the roles that may use them.
import type { Section } from "../app";
import { casesSection } from "./cases";
import { approvalsSection } from "./approvals";
import { catalogSection } from "./catalog";
import { dayCloseSection } from "./dayclose";
import { dayOpenSection } from "./dayopen";
import { exceptionsSection } from "./exceptions";
import { foodFactsSection } from "./foodfacts";
import { fxSection } from "./fx";
import { intakeSection } from "./intake";
import { merchantsSection } from "./merchants";
import { moneySection } from "./money";
import { picturesSection } from "./pictures";
import { zonesSection } from "./zones";
import { paymentsSection } from "./payments";
import { returnsSection } from "./returns";
import { receivingSection } from "./receiving";
import { refundsSection } from "./refunds";
import { ridersSection } from "./riders";
import { todaySection } from "./today";

export const registry: Section[] = [todaySection, dayOpenSection, paymentsSection, ridersSection, exceptionsSection, returnsSection, refundsSection, casesSection, approvalsSection, moneySection, dayCloseSection, receivingSection, catalogSection, foodFactsSection, intakeSection, fxSection, zonesSection, merchantsSection, picturesSection];
