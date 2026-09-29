# Flats

Paste a Rightmove saved-search URL on the Searches page and Flats polls it (07:00–23:00 London time), notifying
about new listings and dropping shared ownership, flats under 650 sq ft, service charges over £6,000 and leases under 90 years.

## Commutes

To time commutes, set `TFL_API_KEY` to the primary key of a subscription on the
[TfL API portal](https://api-portal.tfl.gov.uk/) and add places on the Commutes page. Without it commutes are left
blank. It is read on start, so it takes effect from the next deploy, and a daily sweep then times the properties
already found.

## Reading listings with Jev

To read listings, set `TYPESAFE_API_KEY` to a key from the [TypeSafe console](https://console.typesafe.ai). Jev then
answers the questions in `src/api/questions.ts` from each listing's description and key features, and rejects
untriaged retirement, cash-only and auction flats. Rewording a question re-asks it everywhere on the next daily
sweep; changing only its points does not.
