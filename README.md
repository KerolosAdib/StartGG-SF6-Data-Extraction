# start.gg Scraper

A data pipeline that pulls fighting game tournament results from the
[start.gg](https://www.start.gg/) GraphQL API into PostgreSQL. It runs on AWS as a
scheduled container (ECS Fargate) writing to Aurora Serverless v2, with all
infrastructure defined in Terraform.

Tracked games: Street Fighter 6, Tekken 8, Guilty Gear -Strive-, 2XKO,
Under Night In-Birth II Sys:Celes, BlazBlue: Central Fiction, Skullgirls 2nd Encore
and Granblue Fantasy Versus: Rising.

---

## Pipeline

Each run processes every tracked game (or one, with `GAME_ID`) through five stages:

| Stage | Steps | What it stores |
| --- | --- | --- |
| `tournaments` | fetchTournaments | Tournaments for the game, paged by start date |
| `events` | fetchEvents | The game's events in each tournament |
| `entrants` | entrantIds, participants, playerIds, seeding, newPlayers, saveEntrants | Entrants, seeds, placements, players |
| `sets` | phases, setsFromPhases, groupsFromPhases, setsFromGroups, setDetails, gamesFromSets, markSynced | Completed sets, individual games and character picks |
| `playerVerification` | verify, fix | Refreshed player tags and profile slugs |

Two modes, chosen with `SCRAPER_MODE`:

- **`startgg-full`** walks every tournament from the saved cursor.
- **`startgg-incremental`** only checks tournaments from the last 7 days.

Both modes upsert, so data start.gg reports as changed is updated rather than duplicated.

### Checkpoints and resuming

Progress is saved per game in `startgg_scraper_meta`: the current stage, the step
within it, and a cursor for exactly where that step stopped. Data a stage has
gathered but not finished with (event, phase and set IDs, entrant details) is kept
in `startgg_scraper_staging`. Each API request's results and the new cursor are
saved in one transaction, so a run that stops for any reason continues from the
last completed request.

When start.gg stops responding, the client checks whether the API is reachable with
a minimal query. If it isn't, the run waits (up to 30 minutes, checking every
minute) instead of failing. Stopping a task (`SIGTERM`) releases the run's lock and
keeps its position.

### start.gg API limits

- About 80 requests per 60 seconds; the client stays at 1 request per second.
- Requests over roughly 30 seconds fail with a 504, so batch sizes in
  [`src/config.js`](src/config.js) are tuned to finish well under that.
  `scripts/benchmarkSetIds.js` measures request times for different batch sizes.
- A phase only returns its first 10,000 sets. Larger phases are read through their
  phase groups instead (`scripts/checkPhaseSetLimit.js` checks this limit).

---

## Database

| Table | Contents |
| --- | --- |
| `startgg_videogames` | Tracked games |
| `startgg_tournaments` | Tournament name, slug and dates |
| `startgg_events` | Events per game, with entrant counts and `synced_at` |
| `startgg_players` | Gamertag, profile slug and picture |
| `startgg_entrants` | One entry in an event, with seed, placement and DQ flag |
| `startgg_entrant_players` | Links entrants to their player(s) |
| `startgg_sets` | Completed sets: entrants, games won, winner, DQ |
| `startgg_set_games` | Individual games within a set |
| `startgg_set_game_selections` | Character picked by each entrant in each game |
| `startgg_scraper_meta` | Checkpoint per game |
| `startgg_scraper_staging` | Data gathered by an unfinished stage |

Migrations live in [`migrations/`](migrations) and are applied in filename order by
`node scripts/migrate.js`, which records each one in `schema_migrations`.

---

## Running locally

Requirements: Node.js 20+, a [start.gg API token](https://developer.start.gg/), and
Postgres 16 (Podman or Docker).

```bash
npm install
cp .env.example .env            # fill in START_GG_AUTH_TOKEN and the PG* settings

podman run -d --name startgg-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 docker.io/library/postgres:16
node scripts/migrate.js

npm run start:incremental       # last 7 days of tournaments
GAME_ID=32 npm run start:full   # full history of one game
```

Logs go to stdout and `logs/`.

### Configuration

| Variable | Purpose |
| --- | --- |
| `START_GG_AUTH_TOKEN` | start.gg API token |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Postgres connection |
| `SCRAPER_MODE` | `startgg-full` or `startgg-incremental` |
| `GAME_ID` | Optional: only this start.gg game ID |
| `DB_SSL_CA` | Path to the RDS CA bundle; set in the container image |

Games, batch sizes, rate limits and outage waiting are set in
[`src/config.js`](src/config.js).

---

## AWS deployment

[`infra/`](infra) defines:

- **Aurora Serverless v2** (PostgreSQL 16), scaling 0-4 ACU and pausing after 10 idle
  minutes; credentials managed in Secrets Manager.
- **ECS Fargate** task (0.5 vCPU, 1 GB) running the image from **ECR**; the start.gg
  token comes from an SSM SecureString parameter.
- **EventBridge Scheduler**: incremental sync Monday-Saturday at 03:00 and a full
  sync Sundays at 01:00 (Pacific).
- **CloudWatch Logs** with 14-day retention.

Deploying:

```bash
# Infrastructure
cd infra && terraform init && terraform apply && cd ..

# Image
ECR=$(terraform -chdir=infra output -raw ecr_url)
aws ecr get-login-password | podman login --username AWS --password-stdin "${ECR%%/*}"
podman build -t "$ECR:latest" . && podman push "$ECR:latest"

# Migrations, then a run
aws ecs run-task --cluster startgg-scraper --task-definition startgg-scraper --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform -chdir=infra output -raw subnets)],securityGroups=[$(terraform -chdir=infra output -raw task_sg)],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"scraper","command":["node","scripts/migrate.js"]}]}'
```

Follow a run with `aws logs tail /ecs/startgg-scraper --follow`.

---

## Project structure

```
├── Dockerfile
├── infra/                      # Terraform: Aurora, ECS, ECR, scheduler, IAM
├── migrations/                 # Schema migrations, applied in order
├── scripts/
│   ├── migrate.js              # Applies pending migrations
│   ├── benchmarkSetIds.js      # Times start.gg requests for different batch sizes
│   └── checkPhaseSetLimit.js   # Checks the 10,000-sets-per-phase limit
└── src/
    ├── index.js                # Entry point: picks the mode and games
    ├── config.js               # Games, batch sizes, rate limits
    ├── db/postgres.js          # Connection pool and query helpers
    ├── lib/                    # Checkpoints, staging, logging, rate limiting, retries
    └── scrapers/startgg/
        ├── client.js           # GraphQL client with retries and outage waiting
        ├── queries.js          # Batched GraphQL query builders
        ├── pipeline.js         # Runs the stages for one game
        └── stages/             # tournaments, events, entrants, sets, playerVerification
```
