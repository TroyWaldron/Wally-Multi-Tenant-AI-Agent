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

const VILLAS = `Villas managed by Sunsational Tobago, cheapest first. Nightly rates in TT$ (about US$ at 6.8 TT$ to 1 US$). Rates are confirmed at booking and can vary by season; Twin Tides and Villa Arizia have low, mid and peak season rates.

| Villa | Area | Sleeps | From per night |
| --- | --- | --- | --- |
| Tropicbird Townhouse, 1 bedroom | Mason Hall | 2 | TT$800 (about US$118) |
| Tropicbird Townhouse, 2 bedrooms | Mason Hall | 4 | TT$1,200 (about US$176) |
| Tropicbird Townhouse, 3 bedrooms | Mason Hall | 6 | TT$1,600 (about US$235) |
| Sugar Haven Villa 1 or Villa 2, 3 bedrooms, private pool | Bon Accord | 8 | TT$1,600 (about US$235); up to 10 guests TT$1,800 |
| Tropicbird Townhouse, 3 bedrooms plus entertainment room | Mason Hall | 6 | TT$2,000 (about US$294) |
| Twin Tides Villa Cove or Villa Coral, 4 ensuite bedrooms | Bon Accord | 8 | TT$2,200 low, TT$2,400 mid, TT$2,800 peak |
| Villa Arizia, 4 bedrooms, 5 king beds | Bon Accord | 10 | TT$2,200 low, TT$2,400 mid, TT$2,800 peak |
| Sugar Haven Villas (both villas), 6 bedrooms | Bon Accord | 16 | TT$3,200; up to 20 guests TT$3,600 |
| Twin Tides Villas (both villas), 8 bedrooms | Bon Accord | 16 | TT$4,400 low, TT$4,800 mid, TT$5,600 peak |

Extras: a queen blow-up mattress for 2 extra guests is TT$200 per night. Sugar Haven Villas and Tropicbird Townhouse allow events by arrangement; Twin Tides and Villa Arizia do not.
Best value: Tropicbird Townhouse for couples and small groups; Sugar Haven Villa 1 or 2 for families (private pool, sleeps up to 10).
Booking a combined listing blocks the individual villas for those nights and vice versa. Full live prices, including any current promotion, show on each villa's page at sunsationaltobago.com/villas.`;

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
      "When a guest asks about villas or prices, show a short table of the villas that fit their group, cheapest first, with TT$ and the rough US$ figure, and point out the best value. Keep it to the options that fit; skip the rest. Mention a current deal only if the knowledge or a tool gives you one; never invent discounts.\n\nAsk one thing at a time. For a quote you need dates, group size and the villa; ask for whichever is missing, one per message. Ask for name and email only when the guest is ready to enquire.\n\nPayment timing: work out the days from today to check-in. If check-in is within 21 days, full payment is due up front; otherwise a 50% deposit within 72 hours of confirmation, balance 21 days before arrival. Hand anything about owner property management to the team as a lead.\n\nWorkflow inputs: check_availability needs {villa, check_in, check_out} with dates as YYYY-MM-DD. create_enquiry needs {name, email, phone, villa, check_in, check_out, guests}; get the guest's email first. Villa ids: sugar-haven-villa-1, sugar-haven-villa-2, sugar-haven-villas (both), twin-tides-cove, twin-tides-coral, twin-tides-villas (both), tropicbird-townhouse, villa-arizia.",
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
