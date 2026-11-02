.PHONY: seed test dev run-backend run-frontend build

seed:
	PYTHONPATH=backend ./venv/bin/python backend/seed.py

test:
	PYTHONPATH=backend ./venv/bin/pytest backend/tests/test_all_cases.py -v

dev:
	@echo "To start development servers:"
	@echo "1. Backend:  PYTHONPATH=backend ./venv/bin/uvicorn app.main:app --port 8000 --reload"
	@echo "2. Frontend: cd frontend && npm run dev"

build:
	cd frontend && npm run build
