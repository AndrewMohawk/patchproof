.PHONY: doctor test smoke pilot evaluate reproduce export release-check release-packet verify-packet dev
doctor:
	node scripts/product-cli.ts doctor
test:
	npm run typecheck
	npm run check:contracts
	npm test
smoke:
	$(if $(CONFIG),node scripts/smoke-operator.ts start "$(CONFIG)",node scripts/product-cli.ts smoke)
pilot evaluate:
	$(if $(CONFIG),node scripts/live-experiment-operator.ts $@ "$(CONFIG)" "$(CONFIG_DIGEST)" "$(RUNTIME)" "$(RUNTIME_DIGEST)",node scripts/product-cli.ts $@)
release-check release-packet:
	node scripts/product-cli.ts $@ $(if $(INPUT),"$(INPUT)")
verify-packet:
	node scripts/product-cli.ts $@ "$(PACKET)" "$(DIGEST)"
reproduce:
	$(if $(CONFIG),node scripts/replay-operator.ts start "$(CONFIG)" "$(CONFIG_DIGEST)" "$(RUN)",node scripts/product-cli.ts reproduce "$(RUN)")
export:
	$(if $(CONFIG),node scripts/evidence-operator.ts export "$(CONFIG)" "$(CONFIG_DIGEST)" "$(RUN)",node scripts/product-cli.ts export "$(RUN)")
dev:
	npm run dev
