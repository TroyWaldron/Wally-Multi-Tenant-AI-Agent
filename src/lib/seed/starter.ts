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

const VILLAS = `Villas managed by Sunsational Tobago: Tropicbird Townhouse (Mason Hall, 1 to 3 bedrooms), Sugar Haven Villa 1 and Villa 2 (Bon Accord, 3 bedrooms each, private pool), Twin Tides Villa Cove and Villa Coral (Bon Accord, 4 ensuite bedrooms each), Villa Arizia (Bon Accord, 4 bedrooms, 5 king beds), plus the "both villas" listings for Sugar Haven and Twin Tides.
Prices, deals and availability change, so they are never kept here: always get them live with the quote_price workflow.`;

export const STARTER_KNOWLEDGE = [
  { title: "Our villas and where prices come from", content: VILLAS, source: "sunsationaltobago.com/villas" },
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
      "Prices, deals and availability always come live from the quote_price workflow, never from memory or the knowledge base, because the team changes rates. quote_price takes {guests, check_in, check_out, villa}, all optional; with dates it also returns a full quote and whether each option is free. When a guest asks about villas or prices, show a short table of the options that fit their group, cheapest first, with TT$ and the rough US$ figure, and point out the best value. Mention a deal only when quote_price returns one.\n\nAsk one thing at a time. For a quote you need dates, group size and the villa; ask for whichever is missing, one per message. Ask for name and email only when the guest is ready to enquire.\n\nPayment timing: work out the days from today to check-in. If check-in is within 21 days, full payment is due up front; otherwise a 50% deposit within 72 hours of confirmation, balance 21 days before arrival. Hand anything about owner property management to the team as a lead.\n\nWorkflow inputs: check_availability needs {villa, check_in, check_out} with dates as YYYY-MM-DD. create_enquiry needs {name, email, phone, villa, check_in, check_out, guests}; get the guest's email first. Villa ids: sugar-haven-villa-1, sugar-haven-villa-2, sugar-haven-villas (both), twin-tides-cove, twin-tides-coral, twin-tides-villas (both), tropicbird-townhouse, villa-arizia.",
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
