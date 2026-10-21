import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { validateTemplate } from "./template.mjs";

const example = readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");
const configured = () =>
  example
    .replaceAll("frontend.invalid", "play.my-fork.test")
    .replaceAll("api.invalid", "api.my-fork.test");

test("the public template cannot build a frontend until its hosts are configured", () => {
  // Given the unchanged public Blueprint.
  const source = example;

  // When the deployment guard checks it without the example-only exception.
  const check = () => validateTemplate(source);

  // Then deployment stops before a frontend can contact a server.
  assert.throws(check, /Configure your own/);
});

test("a fork with consistent private host settings passes the guard", () => {
  // Given a Blueprint whose four URL settings use the fork's own hosts.
  const source = configured();

  // When the deployment guard checks the configured Blueprint.
  const result = validateTemplate(source);

  // Then both resolved origins belong to the fork.
  assert.deepEqual(result, {
    frontendOrigin: "https://play.my-fork.test",
    serverOrigin: "https://api.my-fork.test"
  });
});

test("the original demo hostnames are rejected even in example validation", () => {
  // Given a configured Blueprint with the original demo API restored.
  const source = configured().replaceAll("api.my-fork.test", "minesweeper-flags-api.onrender.com");

  // When example validation runs with placeholders allowed.
  const check = () => validateTemplate(source, { allowPlaceholders: true });

  // Then the exception cannot allow traffic to the original demo.
  assert.throws(check, /Configure your own/);
});

test("a health rewrite pointing at a different server is rejected", () => {
  // Given an otherwise configured Blueprint with an unrelated health backend.
  const doc = parse(configured());
  doc.services.find((service) => service.runtime === "static").routes[0].destination =
    "https://another.test/health";

  // When deployment configuration is validated.
  const check = () => validateTemplate(stringify(doc));

  // Then the socket and health backend mismatch is detected.
  assert.throws(check, /must match/);
});

test("a CSP that still allows an unrelated API is rejected", () => {
  // Given an otherwise configured Blueprint with an extra CSP connection origin.
  const source = configured().replace(
    "connect-src 'self'",
    "connect-src https://unrelated.test 'self'"
  );

  // When deployment configuration is validated.
  const check = () => validateTemplate(source);

  // Then the unrelated connection destination is rejected.
  assert.throws(check, /must match/);
});
