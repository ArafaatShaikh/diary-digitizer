import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Exercise the production route and authentication logic with network adapters stubbed.
// No Supabase or Gemini credentials/network calls are used by these tests.
function routeFixture({
  allowed = true,
  output = JSON.stringify({
    items: [{ text: "Milk, 2 litres", completed: false }],
  }),
  finish = "STOP",
} = {}) {
  const state = {
    quotaCalls: 0,
    providerCalls: 0,
    options: null,
    profileOwner: null,
  };
  const db = {
    auth: {
      getUser: async (token) =>
        token === "valid"
          ? { data: { user: { id: "owner" } }, error: null }
          : { data: { user: null }, error: new Error("Invalid session") },
    },
    from: (table) => {
      assert.equal(table, "profiles");
      const query = {
        select: () => query,
        eq: (_column, value) => {
          state.profileOwner = value;
          return query;
        },
        maybeSingle: async () => ({
          data: { personal_lexicon: ["Milk"] },
          error: null,
        }),
      };
      return query;
    },
    rpc: async (name) => {
      assert.equal(name, "reserve_transcription");
      state.quotaCalls++;
      return { data: allowed, error: null };
    },
  };
  const adapters = {
    "@supabase/supabase-js": { createClient: () => db },
    "@google/genai": {
      GoogleGenAI: class {
        models = {
          generateContent: async (options) => {
            state.providerCalls++;
            state.options = options;
            return { text: output, candidates: [{ finishReason: finish }] };
          },
        };
      },
    },
  };
  const paths = {
    "@/lib/list-data": "lib/list-data.ts",
    "@/lib/server-auth": "lib/server-auth.ts",
    "@/lib/request-validation": "lib/request-validation.ts",
    "./request-validation": "lib/request-validation.ts",
    route: "app/api/transcribe/route.ts",
  };
  const cache = new Map();
  function load(name) {
    if (adapters[name]) return adapters[name];
    const path = paths[name];
    if (!path) throw new Error(`Unexpected module ${name}`);
    if (cache.has(path)) return cache.get(path).exports;
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const testModule = { exports: {} };
    cache.set(path, testModule);
    vm.runInNewContext(
      js,
      {
        module: testModule,
        exports: testModule.exports,
        require: load,
        Buffer,
        Response,
        process: {
          env: {
            NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon",
            GEMINI_API_KEY: "fake-key",
          },
        },
      },
      { filename: path },
    );
    return testModule.exports;
  }
  return { POST: load("route").POST, state };
}
function request(mode, token = "valid") {
  return new Request("http://test/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      ...(mode === undefined ? {} : { mode }),
      imageBase64: Buffer.from([255, 216, 255, 224]).toString("base64"),
      mimeType: "image/jpeg",
    }),
  });
}

test("list scan reserves one shared allowance and returns proposals without persisting them", async () => {
  const { POST, state } = routeFixture();
  const response = await POST(request("list"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [{ text: "Milk, 2 litres", completed: false }],
  });
  assert.equal(state.quotaCalls, 1);
  assert.equal(state.providerCalls, 1);
  assert.equal(state.profileOwner, "owner");
  assert.equal(state.options.config.responseMimeType, "application/json");
  assert.equal(
    state.options.config.responseJsonSchema.properties.items.maxItems,
    100,
  );
});
test("missing/invalid sessions and exhausted allowance never call Gemini", async () => {
  for (const token of ["", "invalid"]) {
    const { POST, state } = routeFixture();
    assert.equal((await POST(request("list", token))).status, 401);
    assert.equal(state.providerCalls, 0);
    assert.equal(state.quotaCalls, 0);
  }
  const { POST, state } = routeFixture({ allowed: false });
  assert.equal((await POST(request("list"))).status, 429);
  assert.equal(state.providerCalls, 0);
});
test("malformed or truncated list output is rejected rather than partially imported", async () => {
  for (const options of [
    { output: "{bad json" },
    { output: '{"items":[{"text":"Milk","completed":"false"}]}' },
    { output: '{"items":[]}' },
    { finish: "MAX_TOKENS" },
  ]) {
    const { POST, state } = routeFixture(options);
    assert.equal((await POST(request("list"))).status, 422);
    assert.equal(state.providerCalls, 1);
  }
});
test("page scans retain the text response and reject unknown modes before quota consumption", async () => {
  const { POST, state } = routeFixture({ output: "Original diary words" });
  const response = await POST(request(undefined));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "Original diary words" });
  assert.equal(state.options.config.responseMimeType, undefined);
  const invalid = routeFixture();
  assert.equal((await invalid.POST(request("unknown"))).status, 400);
  assert.equal(invalid.state.quotaCalls, 0);
});
