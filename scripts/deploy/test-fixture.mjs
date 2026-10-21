import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("./render.mjs", import.meta.url));
const config = {
  workspaceId: "tea-fixture",
  repository: "test-owner/flags",
  frontend: { serviceId: "srv-frontend", url: "https://frontend.example.test" },
  server: { serviceId: "srv-server", url: "https://api.example.test" }
};

const fakeCli = String.raw`#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');
const a=process.argv.slice(2),dir=process.env.FIXTURE_DIR;
fs.appendFileSync(p.join(dir,'calls.jsonl'),JSON.stringify(['render',...a])+'\n');
const output=x=>console.log(JSON.stringify(x));
if(a[0]==='workspace') output({id:'tea-fixture'});
else if(a[0]==='services') output(JSON.parse(fs.readFileSync(p.join(dir,'services.json'))));
else if(a[0]==='deploys'&&a[1]==='list') {
 const f=p.join(dir,a[2]+'.sha');
 output([{id:'dep-fixture',status:'live',commit:{id:fs.existsSync(f)?fs.readFileSync(f,'utf8'):process.env.FIXTURE_COMMIT}}]);
} else if(a[0]==='deploys'&&a[1]==='create') {
 if(process.env.FAIL_SERVICE===a[2]) process.exit(1);
 fs.writeFileSync(p.join(dir,a[2]+'.sha'),a[a.indexOf('--commit')+1]);
 output({id:'dep-fixture',status:'live'});
} else process.exit(2);
`;
const fakeGh = String.raw`#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');
fs.appendFileSync(p.join(process.env.FIXTURE_DIR,'calls.jsonl'),JSON.stringify(['gh',...process.argv.slice(2)])+'\n');
console.log(JSON.stringify({check_runs:['check','images'].map((name,id)=>({name,id,app:{slug:'github-actions'},status:'completed',conclusion:process.env.FAIL_CI===name?'failure':'success'}))}));
`;
const fakeNetwork = String.raw`import{appendFileSync}from'node:fs';import{join}from'node:path';
globalThis.fetch=async url=>{
appendFileSync(join(process.env.FIXTURE_DIR,'calls.jsonl'),JSON.stringify(['fetch',String(url)])+'\n');
if(!String(url).startsWith('https://api.example.test/')&&!String(url).startsWith('https://frontend.example.test/'))throw Error('Unexpected URL');
return new Response(JSON.stringify(String(url).endsWith('/ready')?{status:'ready'}:{status:'ok',activeRooms:process.env.ACTIVE_ROOMS==='yes'?1:0,maxRooms:4}));};
`;

export function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "flags-deploy-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, "repo");
  const bin = join(directory, "bin");
  mkdirSync(repository);
  mkdirSync(bin);
  mkdirSync(join(repository, ".deploy"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Andrew McDonald");
  git("config", "user.email", "andrewmcdonald42@gmail.com");
  writeFileSync(join(repository, ".gitignore"), ".deploy/\n");
  writeFileSync(join(repository, "README.md"), "Initial release\n");
  git("add", ".gitignore", "README.md");
  git("commit", "-m", "Initial release");
  execFileSync("git", ["init", "--bare", join(directory, "remote")], { stdio: "ignore" });
  git(
    "config",
    `url.${join(directory, "remote")}.insteadOf`,
    "https://github.com/test-owner/flags"
  );
  git("remote", "add", "origin", "https://github.com/test-owner/flags");
  git("push", "origin", "main");
  const sha = git("rev-parse", "HEAD");
  const services = ["frontend", "server"].map((name) => ({
    service: {
      id: config[name].serviceId,
      ownerId: config.workspaceId,
      repo: "https://github.com/test-owner/flags",
      branch: "main",
      type: name === "frontend" ? "static_site" : "web_service",
      autoDeployTrigger: "off",
      suspended: "not_suspended",
      serviceDetails: { url: config[name].url, plan: "free", previews: { generation: "off" } }
    }
  }));
  writeFileSync(join(directory, "services.json"), JSON.stringify(services));
  writeFileSync(join(repository, ".deploy/config.json"), JSON.stringify(config), { mode: 0o600 });
  writeFileSync(join(bin, "render"), fakeCli, { mode: 0o700 });
  writeFileSync(join(bin, "gh"), fakeGh, { mode: 0o700 });
  const preload = join(directory, "network.mjs");
  writeFileSync(preload, fakeNetwork);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RENDER_CLI: join(bin, "render"),
    DEPLOY_DIR: join(repository, ".deploy"),
    FIXTURE_DIR: directory,
    FIXTURE_COMMIT: sha,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(preload).href}`
  };
  return {
    directory,
    repository,
    git,
    sha,
    services,
    run: (command, target = "all", extra = {}) =>
      spawnSync(process.execPath, [entry, command, target, extra.COMMIT || "origin/main"], {
        cwd: repository,
        env: { ...env, ...extra },
        encoding: "utf8",
        timeout: 20_000
      }),
    calls: () => {
      const file = join(directory, "calls.jsonl");
      try {
        return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    }
  };
}
