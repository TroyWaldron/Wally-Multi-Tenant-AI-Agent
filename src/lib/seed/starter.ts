// Starter data: Novate Solutions as the agency, Sunsational Tobago as tenant
// zero with a receptionist and an accountant. Used by the demo store and by
// the "Load starter data" button in Settings (Supabase mode).
import faq from "@/lib/seed/sunsational-faq.json";
import { getRole } from "@/lib/roles";
import type { Agent, Tenant } from "@/lib/types";

export const STARTER_AGENCY = { name: "Novate Solutions", slug: "novate" };

export const STARTER_TENANT: Pick<Tenant, "name" | "slug"> & Partial<Tenant> = {
  name: "Sunsational Tobago",
  slug: "sunsational-tobago",
  industry: "Villa rentals & property management",
  country: "TT",
  timezone: "America/Port_of_Spain",
  currency: "TTD",
  status: "trial",
  profile: {
    about:
      "Property management, villa rental agency and real estate services in Tobago. Manages Sugar Haven Villas, Tropicbird Townhouse, Twin Tides Villas and Villa Arizia.",
    hours: "Mon-Sat 8am-6pm AST; WhatsApp answered 7 days",
    phone: "1 (868) 782-5152",
    email: "reservations@sunsationaltobago.com",
    website: "https://www.sunsationaltobago.com",
    address: "Room 1, English Plaza, Northside Rd, Mason Hall, Tobago",
  },
  branding: {
    color: "#123B5D",
    welcome: "Hi, I'm Sunny from Sunsational Tobago. Looking for a villa, or have a question about your stay?",
    position: "right",
  },
};

const VILLAS = `Villas managed by Sunsational Tobago (rates in TT$ per night; seasonal rates and promotions may apply, always quote through the quote_price workflow when available):
- Sugar Haven Villa 1 and Villa 2, Silver Palms, Bon Accord: 3 bedrooms each, private pool. Up to 8 guests TT$1,600, up to 10 guests TT$1,800.
- Sugar Haven Villas (Both): 6 bedrooms. Up to 16 guests TT$3,200, up to 20 guests TT$3,600.
- Twin Tides Villa Cove and Villa Coral, Silver Palms, Bon Accord: 4 ensuite bedrooms each; can be booked together as Twin Tides Villas (Both).
- Tropicbird Townhouse, Forest Hills Villas, Mason Hall: flexible 1 to 3 bedrooms.
- Villa Arizia, Alfred Crescent, Bon Accord: 4 bedrooms, 5 king beds.
Booking a combined listing blocks the individual villas for those nights and vice versa.`;

export const STARTER_KNOWLEDGE = [
  { title: "Our villas and base rates", content: VILLAS, source: "sunsationaltobago.com/villas" },
  ...faq,
];

type AgentSeed = Omit<Agent, "id" | "createdAt" | "updatedAt" | "tenantId">;

function fromRole(key: string, overrides: Partial<AgentSeed>): AgentSeed {
  const role = getRole(key)!;
  return {
    templateKey: key,
    name: role.name,
    title: role.name,
    avatar: null,
    status: "draft",
    model: "claude-opus-5",
    fallbackModel: "claude-haiku-4-5",
    effort: "medium",
    instructions: "",
    personality: role.defaultPersonality,
    boundaries: role.defaultBoundaries,
    channels: ["playground"],
    voice: {},
    monthlyBudgetUsd: 25,
    ...overrides,
  };
}

export const STARTER_AGENTS: AgentSeed[] = [
  fromRole("receptionist", {
    name: "Sunny",
    title: "Guest Receptionist",
    status: "live",
    channels: ["playground", "web", "whatsapp"],
    instructions:
      "Prices are in TT$; offer US$ only if the guest asks. For stays within 21 days of arrival, remind the guest that full payment is due up front. Hand anything about owner property management to the team as a lead.\n\nWorkflow inputs: check_availability needs {villa, check_in, check_out} with dates as YYYY-MM-DD. create_enquiry needs {name, email, phone, villa, check_in, check_out, guests}; get the guest's email first. Villa ids: sugar-haven-villa-1, sugar-haven-villa-2, sugar-haven-villas (both), twin-tides-cove, twin-tides-coral, twin-tides-villas (both), tropicbird-townhouse, villa-arizia.",
  }),
  fromRole("accountant", {
    name: "Ledger",
    title: "Bookkeeper",
    effort: "high",
    instructions:
      "Commission and owner payouts follow each booking's commission rate. VAT in Trinidad & Tobago is 12.5%; confirm the business's VAT registration with the owner before including VAT on any draft.",
  }),
  fromRole("coordinator", { name: "Coco", title: "Turnover Coordinator" }),
];
