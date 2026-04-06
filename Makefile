.DEFAULT_GOAL := help

NPM ?= npm
DOCKER_COMPOSE ?= docker compose
SERVER_ENV_FILE ?= apps/server/.env
DEPLOYMENT_STYLE ?= server
P2P_STUN_URLS ?= stun:stun.l.google.com:19302
P2P_SIGNALING_PORT ?= 3002
P2P_SIGNALING_URL ?= http://localhost:$(P2P_SIGNALING_PORT)

SERVER_WORKSPACE := @minesweeper-flags/server
SIGNALING_WORKSPACE := @minesweeper-flags/signaling
CLIENT_WORKSPACE := @minesweeper-flags/client
SHARED_WORKSPACE := @minesweeper-flags/shared
ENGINE_WORKSPACE := @minesweeper-flags/game-engine
PUBLIC_COMPOSE_FILE := deploy/container/docker-compose.public.yml
P2P_COMPOSE_FILE := docker-compose.p2p.yml
PUBLIC_P2P_COMPOSE_FILE := deploy/container/docker-compose.public.p2p.yml
REDIS_HOST_COMPOSE_FILE := docker-compose.redis-host.yml

SERVER_ENV_PREFIX = set -a; if [ -f "$(SERVER_ENV_FILE)" ]; then . "$(SERVER_ENV_FILE)"; fi; set +a;
CLIENT_ENV_PREFIX = VITE_DEPLOYMENT_MODE=$(DEPLOYMENT_STYLE) VITE_P2P_STUN_URLS="$(if $(filter p2p,$(DEPLOYMENT_STYLE)),$(P2P_STUN_URLS),)" VITE_P2P_SIGNALING_URL="$(if $(filter p2p,$(DEPLOYMENT_STYLE)),$(P2P_SIGNALING_URL),)"
SIGNALING_ENV_PREFIX = DEPLOYMENT_MODE=local HOST=0.0.0.0 PORT=$(P2P_SIGNALING_PORT) STATE_BACKEND=memory

.PHONY: \
	help \
	install \
	dev \
	p2p-dev \
	p2p-dev-redis \
	server-dev \
	signaling-dev \
	client-dev \
	build \
	build-server \
	build-signaling \
	build-client \
	p2p-build-client \
	build-shared \
	build-engine \
	test \
	test-server \
	test-signaling \
	test-client \
	test-shared \
	test-engine \
	server-start \
	signaling-start \
	check \
	compose-config \
	compose-build \
	compose-p2p-build \
	compose-up \
	compose-p2p-up \
	compose-up-detached \
	compose-p2p-up-detached \
	compose-down \
	compose-logs \
	compose-ps \
	compose-public-config \
	compose-public-build \
	compose-public-p2p-build \
	compose-public-up \
	compose-public-p2p-up \
	compose-public-up-detached \
	compose-public-p2p-up-detached \
	compose-public-down \
	compose-public-logs \
	compose-public-ps

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_.-]+:.*## / {printf "%-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install workspace dependencies with npm ci
	$(NPM) ci

dev: ## Run the selected local deployment; DEPLOYMENT_STYLE=server|p2p
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(MAKE) p2p-dev P2P_STUN_URLS="$(P2P_STUN_URLS)" P2P_SIGNALING_URL="$(P2P_SIGNALING_URL)" P2P_SIGNALING_PORT="$(P2P_SIGNALING_PORT)"; \
	else \
		$(SERVER_ENV_PREFIX) $(NPM) run dev; \
	fi

p2p-dev: ## Run the local p2p client and signaling services
	@$(NPM) exec -- concurrently -k -n signaling,client -c magenta,cyan "$(SIGNALING_ENV_PREFIX) $(NPM) run dev -w $(SIGNALING_WORKSPACE)" "VITE_DEPLOYMENT_MODE=p2p VITE_P2P_STUN_URLS=\"$(P2P_STUN_URLS)\" VITE_P2P_SIGNALING_URL=\"$(P2P_SIGNALING_URL)\" $(NPM) run dev -w $(CLIENT_WORKSPACE)"

p2p-dev-redis: ## Run local p2p client/signaling with Redis-backed signaling for parity debugging
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f $(REDIS_HOST_COMPOSE_FILE) up -d redis
	@$(NPM) exec -- concurrently -k -n signaling,client -c magenta,cyan "DEPLOYMENT_MODE=local HOST=0.0.0.0 PORT=$(P2P_SIGNALING_PORT) STATE_BACKEND=redis REDIS_URL=redis://127.0.0.1:6379 REDIS_KEY_PREFIX=minesweeper-flags-local:signaling $(NPM) run dev -w $(SIGNALING_WORKSPACE)" "VITE_DEPLOYMENT_MODE=p2p VITE_P2P_STUN_URLS=\"$(P2P_STUN_URLS)\" VITE_P2P_SIGNALING_URL=\"$(P2P_SIGNALING_URL)\" $(NPM) run dev -w $(CLIENT_WORKSPACE)"; status=$$?; $(DOCKER_COMPOSE) -f docker-compose.yml -f $(REDIS_HOST_COMPOSE_FILE) down; exit $$status

server-dev: ## Run the server in watch mode; loads apps/server/.env if present
	@$(SERVER_ENV_PREFIX) $(NPM) run dev -w $(SERVER_WORKSPACE)

signaling-dev: ## Run the signaling service in watch mode for local p2p
	@$(SIGNALING_ENV_PREFIX) $(NPM) run dev -w $(SIGNALING_WORKSPACE)

client-dev: ## Run the Vite client dev server for the selected deployment style
	@$(CLIENT_ENV_PREFIX) $(NPM) run dev -w $(CLIENT_WORKSPACE)

build: ## Build all workspaces
	$(NPM) run build

build-server: ## Build the server workspace
	$(NPM) run build -w $(SERVER_WORKSPACE)

build-signaling: ## Build the signaling workspace
	$(NPM) run build -w $(SIGNALING_WORKSPACE)

build-client: ## Build the client workspace for the selected deployment style
	@$(CLIENT_ENV_PREFIX) $(NPM) run build -w $(CLIENT_WORKSPACE)

p2p-build-client: ## Build the client workspace in p2p mode
	@$(MAKE) build-client DEPLOYMENT_STYLE=p2p P2P_STUN_URLS="$(P2P_STUN_URLS)"

build-shared: ## Build the shared package
	$(NPM) run build -w $(SHARED_WORKSPACE)

build-engine: ## Build the game engine package
	$(NPM) run build -w $(ENGINE_WORKSPACE)

test: ## Run all workspace tests
	$(NPM) run test

test-server: ## Run the server test suite
	$(NPM) run test -w $(SERVER_WORKSPACE)

test-signaling: ## Run the signaling test suite
	$(NPM) run test -w $(SIGNALING_WORKSPACE)

test-client: ## Run the client test suite
	$(NPM) run test -w $(CLIENT_WORKSPACE)

test-shared: ## Run the shared package test suite
	$(NPM) run test -w $(SHARED_WORKSPACE)

test-engine: ## Run the game engine test suite
	$(NPM) run test -w $(ENGINE_WORKSPACE)

server-start: build-server ## Build and run the compiled server; loads apps/server/.env if present
	@$(SERVER_ENV_PREFIX) $(NPM) run start -w $(SERVER_WORKSPACE)

signaling-start: build-signaling ## Build and run the compiled signaling service for local p2p
	@$(SIGNALING_ENV_PREFIX) $(NPM) run start -w $(SIGNALING_WORKSPACE)

check: ## Run the main local verification flow
	$(MAKE) test
	$(MAKE) build
	$(MAKE) compose-config
	$(MAKE) compose-public-config

compose-config: ## Validate docker compose configuration
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(P2P_COMPOSE_FILE) config; \
	else \
		$(DOCKER_COMPOSE) config; \
	fi

compose-build: ## Build the selected local Docker Compose images
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) build signaling client; \
	else \
		$(DOCKER_COMPOSE) build server client; \
	fi

compose-p2p-build: ## Build the local p2p client image only
	@$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(P2P_COMPOSE_FILE) build

compose-up: ## Start the selected local Docker Compose deployment in the foreground
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(P2P_COMPOSE_FILE) up --build; \
	else \
		$(DOCKER_COMPOSE) up --build; \
	fi

compose-p2p-up: ## Start the local p2p client deployment in the foreground
	@$(MAKE) compose-up DEPLOYMENT_STYLE=p2p P2P_STUN_URLS="$(P2P_STUN_URLS)"

compose-up-detached: ## Start the selected local Docker Compose deployment in the background
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(P2P_COMPOSE_FILE) up --build -d; \
	else \
		$(DOCKER_COMPOSE) up --build -d; \
	fi

compose-p2p-up-detached: ## Start the local p2p client deployment in the background
	@$(MAKE) compose-up-detached DEPLOYMENT_STYLE=p2p P2P_STUN_URLS="$(P2P_STUN_URLS)"

compose-down: ## Stop the local Docker Compose stack
	$(DOCKER_COMPOSE) down

compose-logs: ## Tail local Docker Compose logs
	$(DOCKER_COMPOSE) logs -f

compose-ps: ## Show local Docker Compose service status
	$(DOCKER_COMPOSE) ps

compose-public-config: ## Validate the parity/public Docker Compose overlay
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(PUBLIC_P2P_COMPOSE_FILE) config; \
	else \
		$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) config; \
	fi

compose-public-build: ## Build the selected parity/public Docker Compose images
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) build signaling client; \
	else \
		$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) build server client; \
	fi

compose-public-p2p-build: ## Build the parity/public p2p client image only
	@$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(PUBLIC_P2P_COMPOSE_FILE) build

compose-public-up: ## Start the selected parity/public Docker Compose deployment in the foreground
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(PUBLIC_P2P_COMPOSE_FILE) up --build; \
	else \
		$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) up --build; \
	fi

compose-public-p2p-up: ## Start the parity/public p2p client deployment in the foreground
	@$(MAKE) compose-public-up DEPLOYMENT_STYLE=p2p P2P_STUN_URLS="$(P2P_STUN_URLS)"

compose-public-up-detached: ## Start the selected parity/public Docker Compose deployment in the background
	@if [ "$(DEPLOYMENT_STYLE)" = "p2p" ]; then \
		$(CLIENT_ENV_PREFIX) $(DOCKER_COMPOSE) -f $(PUBLIC_P2P_COMPOSE_FILE) up --build -d; \
	else \
		$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) up --build -d; \
	fi

compose-public-p2p-up-detached: ## Start the parity/public p2p client deployment in the background
	@$(MAKE) compose-public-up-detached DEPLOYMENT_STYLE=p2p P2P_STUN_URLS="$(P2P_STUN_URLS)"

compose-public-down: ## Stop the parity/public Docker Compose stack
	$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) down

compose-public-logs: ## Tail parity/public Docker Compose logs
	$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) logs -f

compose-public-ps: ## Show parity/public Docker Compose service status
	$(DOCKER_COMPOSE) -f $(PUBLIC_COMPOSE_FILE) ps
