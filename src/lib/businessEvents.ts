// Business events a client's own systems can send to Wally, with the outcome
// each one counts as. Plain data so the console can list them too.
export const BUSINESS_EVENTS = [
  { event: "booking_created", label: "New booking request", outcome: "booking_enquiry" },
  { event: "booking_approved", label: "Booking confirmed", outcome: "booking" },
  { event: "booking_cancelled", label: "Booking cancelled", outcome: null },
  { event: "payment_recorded", label: "Payment received", outcome: "payment" },
  { event: "lead_created", label: "New lead", outcome: "lead" },
  { event: "maintenance_ticket_created", label: "Maintenance ticket opened", outcome: "ticket_opened" },
  { event: "review_received", label: "Guest review received", outcome: null },
] as const;
