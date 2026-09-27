.PHONY: doctor test smoke pilot evaluate reproduce export release-check dev
doctor:
	node scripts/cli.ts doctor
test:
	npm run typecheck
	npm run check:contracts
	npm test
smoke pilot evaluate release-check:
	node scripts/cli.ts $@
reproduce export:
	node scripts/cli.ts $@ "$(RUN)" "$(DIGEST)"
dev:
	npm run dev
