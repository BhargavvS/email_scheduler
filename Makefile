.PHONY: docker-build docker-build-backend docker-build-frontend docker-up docker-down docker-logs clean help

# Config
IMAGE_BACKEND ?= reachinbox-scheduler-backend
IMAGE_FRONTEND ?= reachinbox-scheduler-frontend
TAG ?= latest

# Default: build both images
docker-build: docker-build-backend docker-build-frontend ## Build all docker images

docker-build-backend: ## Build backend image (Express + worker + Prisma)
	docker build -t $(IMAGE_BACKEND):$(TAG) -f Dockerfile .

docker-build-frontend: ## Build frontend image (Next.js)
	docker build -t $(IMAGE_FRONTEND):$(TAG) -f frontend/Dockerfile ./frontend

docker-up: ## Start postgres + redis + built images via compose (if compose defines app services)
	docker compose up -d

docker-down: ## Stop compose services
	docker compose down

docker-logs: ## Tail logs for postgres & redis
	docker compose logs -f

clean: ## Remove built images
	docker rmi $(IMAGE_BACKEND):$(TAG) $(IMAGE_FRONTEND):$(TAG) 2>/dev/null || true

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-24s\033[0m %s\n", $$1, $$2}'
