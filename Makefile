.PHONY: doctor test smoke pilot evaluate reproduce export release-check release-packet verify-packet dev
doctor:
	node scripts/product-cli.ts doctor
test:
	npm run typecheck
	npm run check:contracts
	npm test
smoke pilot evaluate:
	node scripts/product-cli.ts $@
release-check release-packet:
	node scripts/product-cli.ts $@ $(if $(INPUT),"$(INPUT)")
verify-packet:
	node scripts/product-cli.ts $@ "$(PACKET)" "$(DIGEST)"
reproduce export:
	node scripts/product-cli.ts $@ "$(RUN)"
dev:
	npm run dev
