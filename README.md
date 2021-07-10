<p align="center">
  <a href="https://stelace.com">
    <img src="https://user-images.githubusercontent.com/12909094/59638847-c41f1900-9159-11e9-9fa5-6d7806d57c92.png" width="640px" alt="Stelace platform runner" />
  </a>
</p>
<p align="center">
Open-source backend and API stack empowering dev teams to <strong>build, run and scale enduring platforms and marketplaces faster than ever</strong>.
</p>

<p align="center">
  <a href="https://stelace.com">Stelace.com</a> |
  <a href="https://stelace.com/docs">Documentation</a> |
  <a href="https://stelace.com/blog">Blog</a> |
  <a href="https://twitter.com/StelaceAPI">Twitter</a>
</p>

---

# Stelace API Server

Includes:

- [Search & matchmaking](https://stelace.com/docs/search/): storing and searching any kind of [_Asset_](https://stelace.com/docs/assets/) relevant to your platform, from products, cars and housing to profiles or skills.
- [User](https://stelace.com/docs/users) authentication, social login and Enterprise SSO
- Customizable [Transaction](https://stelace.com/docs/transactions) process
- Countless integrations with [Events](https://stelace.com/docs/command/events) and [Webhooks](https://stelace.com/docs/command/webhooks.html)
- Business automation with [Workflows](https://stelace.com/docs/command/workflows)
- [Content management API](https://stelace.com/docs/content) (headless CMS)
- Server [Plugin system](docs/plugins.md) to build literally anything
- … and [even more (docs)](https://stelace.com/docs)

For a full-stack experience, you can get started [here](https://stelace.com/docs/getting-started) with open-source Vue.js front-end templates.

[![CircleCI](https://circleci.com/gh/stelace/stelace.svg?style=svg)](https://circleci.com/gh/stelace/stelace)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fstelace%2Fstelace.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fstelace%2Fstelace?ref=badge_shield)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-yellow.svg)](https://standardjs.com)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

---

## Stelace as-a-service

The easiest way to deploy and leverage Stelace is with our official [managed infrastructure](https://stelace.com/pricing). You can have a fresh platform backend up and running in minutes with high-availability deployment, automatic scaling, built-in test and live environments and admin dashboard. SLA, dedicated infrastructure and premium support are also available for [Enterprise customers](https://stelace.com/contact).

---

## Contents

<!-- TOC depthFrom:2 -->

- [Stelace API Server](#stelace-api-server)
  - [Stelace as-a-service](#stelace-as-a-service)
  - [Contents](#contents)
  - [Built to last](#built-to-last)
  - [What is included](#what-is-included)
  - [Setup](#setup)
    - [Docker](#docker)
    - [Install yarn](#install-yarn)
    - [Clone](#clone)
  - [Development](#development)
    - [Start development databases](#start-development-databases)
    - [Run server](#run-server)
    - [Develop with API server container](#develop-with-api-server-container)
  - [Tests](#tests)
    - [Logs](#logs)
    - [Using API server container](#using-api-server-container)
  - [Production](#production)
  - [Versioning](#versioning)
  - [Contributing](#contributing)
  - [Dependencies](#dependencies)
  - [License](#license)
  - [We care about open-source](#we-care-about-open-source)

<!-- /TOC -->

## Built to last

With:

- NodeJS 12+
- PostgreSQL 10+
- ElasticSearch 7.x
- Redis 5.x
- Docker
- [Objection.js](https://github.com/Vincit/objection.js/) ORM (Knex)
- [Microservice-ready](https://inconshreveable.com/10-07-2015/the-neomonolith/) with [Côte](https://github.com/dashersw/cote)
- Tested with [AVA](https://github.com/avajs/ava) :rocket:
- Monitored with [Elastic APM](https://www.elastic.co/products/apm)

## What is included

__All APIs__ listed in [docs](https://stelace.com/docs) and [API Reference](https://docs.api.stelace.com).

Admin Dashboard UI is tied with our [Software-as-a-Service offer](https://stelace.com/pricing) and is not open-source. It certainly won’t ever be unless community and staff [collaborate](#contributing) to make this happen.

That’s it!

__This means you can freely switch between any of our SaaS plans and self-hosting at any time__ if you don’t need Stelace support or SLA and you’re ready to build your own admin UI, or you don’t need one :eyeglasses:.

_Note: for your app UI, we also crafted [open-source front-end templates](https://stelace.com/docs/getting-started)._

[![marketplace-demo-screenshot](https://stelace-instant-files.s3.amazonaws.com/p/238393/test/images/22d115c4e340b125120ce0f29ab36db8-stelace-marketplace-demo-laptop.png)](https://marketplace.demo.stelace.com)

## Setup

### Docker

Please go to [Docker website](https://docs.docker.com/install/#server) to install Docker CE/EE.
Choose the right installation guide for your system.

### Install yarn

Please refer to [official instructions](https://classic.yarnpkg.com/docs/install).

### Clone

```sh
git clone https://github.com/stelace/stelace.git && cd stelace && git checkout origin/master
```

## Development

We recommend using pre-configured Docker images for databases to ease development.

It’s how Stelace team develops and tests API server.

Please note that you should use proper databases in production though.

Let’s start with your own `.env` file to customize if needed:

```sh
cp .env.example .env
```

### Start development databases

Build the Docker images:

```sh
docker-compose build
```

And start the databases:

```sh
yarn docker:db
```

_Shorthand for: `docker-compose up -d elasticsearch postgresql redis`_

### Run server

> Note: These commands will fail if you do not have Node version 12.14 or higher.  It is recommended to build and test with Docker for more stability and less local customization.

- Run `yarn` to install dependencies.

- Run `yarn prepare` to install husky hooks

- Run the database migration to automatically create or update tables:

```sh
yarn knex migrate:latest # or `npm run knex migrate:latest`
```

- Install external [plugins](docs/plugins.md):

```sh
yarn plugins
```

- You can also seed the database with hard-coded development API keys, so you can always use the same keys for development with local server:

```sh
yarn seed
```

_Tip: use one of our [_Stelace Instant_ open-source templates](
  https://stelace.com/docs/getting-started
) for blazing fast full-stack development._


- Start the server:

```sh
yarn start # or `npm start`
```

### Develop with API server container

Stelace server is built on and deployed to Linux machines (Ubuntu), and you may have some trouble running server with another OS.

Docker can solve this with ease.

You just have to change host from `127.0.0.1` to `elasticsearch`, `postgresql` and `redis` in your `.env` file when using containerized API _and_ databases.

Here is how you can install dependencies and init database:

```sh
# ephemeral container with --rm option
docker-compose run --rm api yarn
docker-compose run --rm --no-deps api yarn knex migrate:latest # hard code api keys
docker-compose run --rm api yarn seed
```

_Note: project root directory is used as a Docker volume during development, including `node_modules` that are shared._
_You need to re-install dependencies when switching between plain server and server container setups._

Run:

```sh
docker-compose up -d
```

Useful commands to run from project root:

- Follow logs of a API container

`docker-compose logs -f api`

- Stop and remove containers

`docker-compose down`

- Remove volumes (can be useful to solve dev issues with corrupted data or after database upgrade)

`docker volume prune`

_Tip: Use `yarn docker:db:reset` to reset containers and volumes during development._
_This can be useful if you have any issue with corrupted database or redis store data, or if you want to upgrade databases (__warning__: containers data & volumes will be lost)._

## Tests

Tests are mostly integration tests with databases up and running to cover full API functionality.

Run `npm run test` or `yarn test` with ElasticSearch, PostgreSQL and Redis running and appropriate environment variables (hosts, ports, credentials).

You can use database Docker containers (see [Using API server container](#using-api-server-container)) with appropriate host (127.0.0.1) and ports (e.g. PostgreSQL: 6543).

Tests files are run in parallel with AVA, using multiple schemas in PostgreSQL database.

__Tests are quite CPU-intensive and you probably want to have 4 CPU cores to run them in good conditions.__

Please find more details in [server docs (testing)](docs/testing.md).

### Logs

Getting server logs in real-time can be very useful during development or tests.

You just have to set an environment variable:

```sh
ROARR_LOG=true yarn test
```

To see the output of `console.log` calls during AVA tests, add `--verbose` flag:

```sh
yarn test --verbose
```

### Using API server container

Stelace team uses an API server Docker image in production, so do CI tests.

You can use an [API server container](#develop-with-api-server-container) to run tests locally too.

Ensure ElasticSearch, PostgreSQL and Redis are running once you’ve started [database containers](
  #start-development-databases
):

```sh
# Install dependencies used by API server container if not done yet
docker-compose run --rm api yarn
# Checking that databases are up and running
docker-compose run --rm api /bin/sh -c \
'until nc -z -v -w30 elasticsearch 9200 && nc -z -v -w30 postgresql 5432 && nc -z -v -w30 redis 6379
do
  echo "Waiting for PostgreSQL, ElasticSearch and Redis…"
  sleep 2
done';
```

Run tests with containerized API:

```sh
docker-compose run --rm api yarn test
# instead of standard local server with `yarn test`
```

## Production

As mentioned above, we recommend using proper databases for production. You may self-host the databases or externalize them by using database providers.

Please find detailed procedures to [configure SSL for database](./docs/ssl-database.md).

## Versioning

Stelace API public versions introducing breaking changes are publicly dated like `2019-05-20` but the repository itself follows [semver](https://semver.org/) rules.
Dated version are the equivalent of `major` updates, as in semver `major.minor.patch`.

Old dated versions are supported thanks to transformers, inspired by [great examples](https://stripe.com/blog/api-versioning).

When introducing breaking changes (denoted by a new major version in this repository according to semver):

- Dated version is added to `src/versions/index.js`
- Appropriate transformers are added to request, response and validation subfolders
- Changes are documented using a `description` field in request transformers
- [Conventional commit](https://www.conventionalcommits.org) messages are used to keep track of breaking changes

## Contributing

Stelace is **open source** and contributions from the community are most welcome, including yours!

Before contributing to Stelace:

1. You’ll be prompted to read and sign our [**Contributor License Agreement**](https://cla-assistant.io/stelace/stelace), which ensures we can maintain appropriate governance of the project as a community in the long run.
2. Dig into [**CONTRIBUTING.MD**](CONTRIBUTING.md), about submitting issues, requesting new features, etc.
3. Ensure we collaborate [with mutual respect](https://github.com/stelace/stelace/docs/code-of-conduct.md).

## Dependencies

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fstelace%2Fstelace.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fstelace%2Fstelace?ref=badge_large)

## License

Stelace API server for Web platforms is licensed under the terms of the GNU General Public License Version 3.

Please [contact us](https://stelace.com/contact) to discuss other licensing options or have look at our [SaaS plans](https://stelace.com/pricing) for hosted backend and premium support.

__Stelace Copyright © 2018-present Sharinplace SAS.__

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

A copy of the GNU General Public License is included in this program,
and is also available at [https://www.gnu.org/licenses/gpl-3.0.txt](
  https://www.gnu.org/licenses/gpl-3.0.txt).

## We care about open-source

Made [with ❤️](https://www.youtube.com/watch?v=Xe1TZaElTAs) in Paris, France.
