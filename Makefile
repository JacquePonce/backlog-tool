.PHONY: daily jira render serve clean-ingest help

PYTHON ?= .venv/bin/python

help:
	@echo "make daily   - Merge all staged ingest/last_*.json -> items.yaml + render board"
	@echo "make jira    - Jira-only refresh (legacy, reads only last_jira_currentUser.json)"
	@echo "make render  - Re-render board from items.yaml"
	@echo "make serve   - Launch local server for board.html / index.html"
	@echo ""
	@echo "Before 'make daily', run the agent prompt 'daily backlog refresh' so the"
	@echo "ingest/last_*.json files are fresh. See ingest/DAILY_REFRESH.md."

daily:
	$(PYTHON) scripts/daily_refresh.py

jira:
	$(PYTHON) scripts/refresh_from_jira.py

render:
	$(PYTHON) scripts/render_board.py

serve:
	$(PYTHON) scripts/serve_board.py
