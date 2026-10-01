# Every street

Progress towards running every street in London, counted the way [CityStrides](https://citystrides.com) counts it.
Each tailnet login keeps its own runs and progress; the street network is shared.

- **Map**: every street in view, coloured complete, partial or untouched. Tap one for the nodes still to run.
- **Stats**: streets and nodes run overall and per borough, new streets per week, and the streets finished lately.
- **Suggest**: clusters of unfinished streets within 3 km of you, or of where the map was last left, best first.
- **Runs**: every imported run, and how many streets each was the one to complete.
- **Connect**: link Strava, upload GPX files, and see how the imports are going.

## What counts

A street is every named road of one name within one borough: trunk roads down to service roads and pedestrian
streets, leaving out motorways, footpaths, private roads and driveways. It is made of nodes, OpenStreetMap's own plus
extra ones wherever those are more than 50 m apart. A node is run once a track passes within 25 m of it, and a street
is complete at 90% of its nodes, so a street of fewer than ten needs them all.

The network comes from OpenStreetMap through the public [Overpass API](https://overpass-api.de), a tile of about
4 km at a time, twenty seconds apart. The first import starts with the first deploy and takes about an hour; it
then repeats monthly, or at once from the Connect page. Runs matched before a street existed are matched
again when it arrives.

## Strava

1. Create an API application at [strava.com/settings/api](https://www.strava.com/settings/api), with Authorization
   Callback Domain `apps.<tailnet>.ts.net`.
2. Set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` to its Client ID and Client Secret. They are read on start, so
   they take effect from the next deploy.
3. On the Connect page, connect with Strava. Your whole history is imported, then checked for new runs every half
   hour between 7:00 and 23:00.

Runs and trail runs count; walks and hikes too once switched on. A new application may only be connected by the
athlete who owns it, and reads 100 requests per quarter hour and 1,000 a day: a long history is imported across
several of those windows. A run that completes streets sends a notification saying how many.

Without Strava, export runs as GPX from any service and upload them on the Connect page. Strava's bulk export is a
zip of them; `.gpx` and `.gpx.gz` files both work.

## From Claude

Every action except connecting Strava is also an MCP tool at `/streets/mcp`: see
[`packages/core/README.md`](../../packages/core/README.md).
