# Flats

Paste a Rightmove saved-search URL on the Searches page and Flats polls it (07:00–23:00 London time), notifying
about each new listing that meets the requirements.

## Commutes

To time commutes, set `TFL_API_KEY` to the primary key of a subscription on the
[TfL API portal](https://api-portal.tfl.gov.uk/) and add places on the Commutes page. Without it commutes are left
blank. It is read on start, so it takes effect from the next deploy, and a daily sweep then times the properties
already found.

## Requirements

The Requirements page edits one JSON document: `limits` on the facts a listing states (by default under 650 sq ft,
a service charge over £6,000 or a lease under 90 years rule a flat out; `null` turns one off), and the `questions`
Jev answers from each listing's description and key features. An `exclusion` question rules a flat out when Jev is
over 80% sure; the rest score it. As you type, the draft is tried on a flat of your choice, showing each answer's
probabilities and the resulting score, and only questions Jev has not answered in the same words are sent to it.

Saving rejects untriaged flats the limits now rule out and re-reads the rest, asking Jev only about reworded or new
questions; changing only labels or points costs nothing. Shared ownership is always ruled out. A new listing is
announced only once it has passed the limits and Jev's exclusions.

To read listings, set `TYPESAFE_API_KEY` to a key from the [TypeSafe console](https://console.typesafe.ai). Without
it, listings are judged by the limits alone and still announced.
