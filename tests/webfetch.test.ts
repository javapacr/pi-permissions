import assert from "node:assert/strict";
import { test } from "node:test";
import { matchDomainRule, normalizeDomain, domainToRegex } from "../rules/webfetch.ts";

const match = (pattern: string, hostname: string) => matchDomainRule([pattern], hostname);

test("apex-only, subdomain and dot-bounded wildcard forms (artifact §3)", () => {
	// domain:example.com — apex only.
	assert.equal(match("example.com", "example.com"), true);
	assert.equal(match("example.com", "api.example.com"), false);
	assert.equal(match("example.com", "evil-example.com"), false);
	// Case-insensitive, trailing "." stripped.
	assert.equal(match("EXAMPLE.com", "example.com."), true);

	// *.example.com — subdomains at any depth, NOT the apex.
	assert.equal(match("*.example.com", "api.example.com"), true);
	assert.equal(match("*.example.com", "a.b.example.com"), true);
	assert.equal(match("*.example.com", "example.com"), false);
	assert.equal(match("*.example.com", "notexample.com"), false);

	// Leading-dot form ≡ *.example.com.
	assert.equal(match(".example.com", "api.example.com"), true);
	assert.equal(match(".example.com", "example.com"), false);

	// Wildcards are dot-bounded: example.* matches example.org but not example.evil.com.
	assert.equal(match("example.*", "example.org"), true);
	assert.equal(match("example.*", "example.evil.com"), false);

	// domain:* matches everything.
	assert.equal(match("*", "anything.example.net"), true);
	assert.equal(match("domain:*", "anything"), true);
	assert.equal(match(".*", "anything"), true);
});

test("domain: prefix is accepted and normalized", () => {
	assert.equal(normalizeDomain("domain:Example.COM "), "example.com");
	assert.equal(domainToRegex("domain:*.example.com").test("a.example.com"), true);
	assert.equal(match("domain:example.com", "example.com"), true);
});

test("comma-separated domain lists — any match wins", () => {
	assert.equal(matchDomainRule(["a.com", "b.com"], "a.com"), true);
	assert.equal(matchDomainRule(["a.com", "b.com"], "b.com"), true);
	assert.equal(matchDomainRule(["a.com", "b.com"], "c.com"), false);
	assert.equal(matchDomainRule(["a.com", "*.b.com"], "x.b.com"), true);
});

test("missing hostname never matches", () => {
	assert.equal(matchDomainRule(["*"], undefined), false);
	assert.equal(matchDomainRule(["example.com"], undefined), false);
});
