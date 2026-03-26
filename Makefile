.DEFAULT_GOAL := help

NPM ?= npm
DOCKER_COMPOSE ?= docker compose
SERVER_ENV_FILE ?= apps/server/.env

SERVER_WORKSPACE := @minesweeper-flags/server
CLIENT_WORKSPACE := @minesweeper-flags/client
SHARED_WORKSPACE := @minesweeper-flags/shared
ENGINE_WORKSPACE := @minesweeper-flags/game-engine

SERVER_ENV_PREFIX = set -a; if [ -f "$(SERVER_ENV_FILE)" ]; then . "$(SERVER_ENV_FILE)"; fi; set +a;

.PHONY: \
	help \
	install \
	dev \
	server-dev \
	client-dev \
	build \
	build-server \
	build-client \
	build-shared \
	build-engine \
	test \
	test-server \
	test-client \
	test-shared \
	test-engine \
	server-start \
	check \
	compose-config \
	compose-build \
	compose-up \
	compose-up-detached \
	compose-down \
	compose-logs \
	compose-ps

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_.-]+:.*## / {printf "%-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install workspace dependencies with npm ci
	$(NPM) ci

dev: ## Run server and client in watch mode; loads apps/server/.env if present
	@$(SERVER_ENV_PREFIX) $(NPM) run dev

server-dev: ## Run the server in watch mode; loads apps/server/.env if present
	@$(SERVER_ENV_PREFIX) $(NPM) run dev -w $(SERVER_WORKSPACE)

client-dev: ## Run the Vite client dev server
	$(NPM) run dev -w $(CLIENT_WORKSPACE)

build: ## Build all workspaces
	$(NPM) run build

build-server: ## Build the server workspace
	$(NPM) run build -w $(SERVER_WORKSPACE)

build-client: ## Build the client workspace
	$(NPM) run build -w $(CLIENT_WORKSPACE)

build-shared: ## Build the shared package
	$(NPM) run build -w $(SHARED_WORKSPACE)

build-engine: ## Build the game engine package
	$(NPM) run build -w $(ENGINE_WORKSPACE)

test: ## Run all workspace tests
	$(NPM) run test

test-server: ## Run the server test suite
	$(NPM) run test -w $(SERVER_WORKSPACE)

test-client: ## Run the client test suite
	$(NPM) run test -w $(CLIENT_WORKSPACE)

test-shared: ## Run the shared package test suite
	$(NPM) run test -w $(SHARED_WORKSPACE)

test-engine: ## Run the game engine test suite
	$(NPM) run test -w $(ENGINE_WORKSPACE)

server-start: build-server ## Build and run the compiled server; loads apps/server/.env if present
	@$(SERVER_ENV_PREFIX) $(NPM) run start -w $(SERVER_WORKSPACE)

check: ## Run the main local verification flow
	$(MAKE) test
	$(MAKE) build
	$(MAKE) compose-config

compose-config: ## Validate docker compose configuration
	$(DOCKER_COMPOSE) config

compose-build: ## Build the local Docker Compose images
	$(DOCKER_COMPOSE) build server client

compose-up: ## Start the local Docker Compose stack in the foreground
	$(DOCKER_COMPOSE) up --build

compose-up-detached: ## Start the local Docker Compose stack in the background
	$(DOCKER_COMPOSE) up --build -d

compose-down: ## Stop the local Docker Compose stack
	$(DOCKER_COMPOSE) down

compose-logs: ## Tail local Docker Compose logs
	$(DOCKER_COMPOSE) logs -f

compose-ps: ## Show local Docker Compose service status
	$(DOCKER_COMPOSE) ps
