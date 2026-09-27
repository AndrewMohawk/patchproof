.PHONY: doctor test smoke pilot evaluate reproduce export release-check dev
doctor:
	node scripts/product-cli.ts doctor
test:
	npm run typecheck
	npm run check:contracts
	npm test
smoke pilot evaluate release-check:
	node scripts/product-cli.ts $@
reproduce export:
	node scripts/product-cli.ts $@ "$(RUN)"
dev:
	npm run dev
