.PHONY: daily jira render serve clean-ingest help render-followups followup-add followup-done followup-push followup-list

PYTHON ?= .venv/bin/python

help:
	@echo "make daily              - Merge all staged ingest/last_*.json -> items.yaml + render board + render follow-ups"
	@echo "make jira               - Jira-only refresh (legacy, reads only last_jira_currentUser.json)"
	@echo "make render             - Re-render board from items.yaml"
	@echo "make render-followups   - Re-render follow_ups.html from follow_ups.yaml"
	@echo "make serve              - Launch local server for board.html / index.html"
	@echo ""
	@echo "Follow-up CLI:"
	@echo "  make followup-add TITLE=... [URL=...] [CONTEXT=...] [PEOPLE=...] [DAYS=3] [SOURCE=slack|jira|...]"
	@echo "  make followup-done ID=fu-YYYYMMDD-NNN"
	@echo "  make followup-push ID=fu-... DAYS=1"
	@echo "  make followup-list"
	@echo ""
	@echo "Before 'make daily', run the agent prompt 'daily backlog refresh' so the"
	@echo "ingest/last_*.json files are fresh. See ingest/DAILY_REFRESH.md."

daily:
	$(PYTHON) scripts/daily_refresh.py
	$(PYTHON) scripts/render_followups.py

jira:
	$(PYTHON) scripts/refresh_from_jira.py

render:
	$(PYTHON) scripts/render_board.py

render-followups:
	$(PYTHON) scripts/render_followups.py

serve:
	$(PYTHON) scripts/serve_board.py

# --- Follow-up tracker ---
# Usage: make followup-add TITLE="Reply to Davi" URL="https://..." DAYS=2 CONTEXT="waiting on PR"
followup-add:
	@if [ -z "$(TITLE)" ]; then echo "TITLE=... is required"; exit 2; fi
	$(PYTHON) scripts/add_followup.py add \
		--title $(call q,$(TITLE)) \
		$(if $(URL),--url $(call q,$(URL))) \
		$(if $(CONTEXT),--context $(call q,$(CONTEXT))) \
		$(if $(PEOPLE),--people $(call q,$(PEOPLE))) \
		$(if $(SOURCE),--source $(SOURCE)) \
		--days $(or $(DAYS),2)
	$(PYTHON) scripts/render_followups.py

followup-done:
	@if [ -z "$(ID)" ]; then echo "ID=fu-... is required"; exit 2; fi
	$(PYTHON) scripts/add_followup.py done --id $(ID)
	$(PYTHON) scripts/render_followups.py

followup-push:
	@if [ -z "$(ID)" ]; then echo "ID=fu-... is required"; exit 2; fi
	$(PYTHON) scripts/add_followup.py push --id $(ID) --days $(or $(DAYS),1)
	$(PYTHON) scripts/render_followups.py

followup-list:
	$(PYTHON) scripts/add_followup.py list

# Quote a make variable so it survives shell word-splitting in recipes.
q = '$(subst ','\'',$1)'
